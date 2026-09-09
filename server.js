const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { URL } = require('node:url');

const PROJECT_ROOT = __dirname;
const STATIC_ROOT = path.join(PROJECT_ROOT, 'start');

// Carrega configurações locais antes de lê-las. Variáveis já exportadas pelo
// processo têm precedência e nunca são sobrescritas pelo arquivo .env.
function loadDotEnv(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const separator = trimmed.indexOf('=');
      if (separator < 1) continue;
      const key = trimmed.slice(0, separator).trim();
      let value = trimmed.slice(separator + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (!process.env[key]) process.env[key] = value;
    }
  } catch (error) {
    if (error.code !== 'ENOENT') console.warn('[SERVER] Não foi possível ler .env:', error.message);
  }
}

loadDotEnv(path.join(PROJECT_ROOT, '.env'));

const PORT = Number(process.env.PORT || 3000);
const configuredHost = process.env.HOST || '127.0.0.1';
const HOST = configuredHost.includes('://') ? '127.0.0.1' : configuredHost;
if (configuredHost !== HOST) {
  console.warn('[SERVER] HOST deve ser apenas um hostname/IP; usando 127.0.0.1 para uma URL configurada.');
}
const WAHA_BASE_URL = String(process.env.WAHA_BASE_URL || '').replace(/\/$/, '');
const WAHA_API_KEY = process.env.WAHA_API_KEY || '';
const WAHA_USERNAME = process.env.WAHA_USERNAME || '';
const WAHA_PASSWORD = process.env.WAHA_PASSWORD || '';
const WAHA_SESSION = process.env.WAHA_SESSION || 'default';
const DEFAULT_COUNTRY_CODE = String(process.env.DEFAULT_COUNTRY_CODE || '55').replace(/\D/g, '');
const CACHE_TTL_MS = Number(process.env.PROFILE_PICTURE_CACHE_TTL_MS || 24 * 60 * 60 * 1000);
const REQUEST_TIMEOUT_MS = Number(process.env.WAHA_REQUEST_TIMEOUT_MS || 8000);
const MAX_REQUESTS_PER_WINDOW = Number(process.env.PROFILE_PICTURE_RATE_LIMIT || 30);
const RATE_WINDOW_MS = 60 * 1000;

const profileCache = new Map();
const rateLimit = new Map();

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(payload);
}

function failure(res, status, error) {
  return json(res, status, { success: false, image: null, error });
}

function normalizePhone(input) {
  const digits = String(input || '').replace(/\D/g, '');
  if (!digits || digits.length < 10 || digits.length > 15) return null;

  // The frontend may send either a national BR number or one with DDI 55.
  // Existing DDIs are preserved; short BR numbers receive the configured DDI.
  if (DEFAULT_COUNTRY_CODE && digits.length <= 11 && !digits.startsWith(DEFAULT_COUNTRY_CODE)) {
    return `${DEFAULT_COUNTRY_CODE}${digits}`;
  }
  return digits;
}

function isRateLimited(ip) {
  const now = Date.now();
  const current = rateLimit.get(ip);
  if (!current || now - current.startedAt >= RATE_WINDOW_MS) {
    rateLimit.set(ip, { startedAt: now, count: 1 });
    return false;
  }
  current.count += 1;
  return current.count > MAX_REQUESTS_PER_WINDOW;
}

function getWahaError(status) {
  if (status === 401 || status === 403) return 'Autenticação da integração WhatsApp recusada';
  if (status === 404) return 'Número ou foto de perfil não encontrada';
  if (status === 408 || status === 504) return 'Tempo esgotado ao consultar o WhatsApp';
  if (status >= 500) return 'Serviço do WhatsApp indisponível';
  return 'Erro da integração WhatsApp';
}

async function fetchProfilePicture(phone) {
  if (!WAHA_BASE_URL) {
    const error = new Error('WAHA_BASE_URL não configurada');
    error.code = 'NOT_CONFIGURED';
    throw error;
  }

  const endpoint = new URL('/api/contacts/profile-picture', `${WAHA_BASE_URL}/`);
  endpoint.searchParams.set('contactId', phone);
  endpoint.searchParams.set('session', WAHA_SESSION);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const headers = { Accept: 'application/json' };
    if (WAHA_API_KEY) headers['X-Api-Key'] = WAHA_API_KEY;
    if (WAHA_USERNAME || WAHA_PASSWORD) {
      headers.Authorization = `Basic ${Buffer.from(`${WAHA_USERNAME}:${WAHA_PASSWORD}`).toString('base64')}`;
    }
    const upstream = await fetch(endpoint, {
      method: 'GET',
      headers,
      signal: controller.signal,
      redirect: 'error',
    });

    if (!upstream.ok) {
      const error = new Error(getWahaError(upstream.status));
      error.status = upstream.status;
      throw error;
    }

    const data = await upstream.json();
    const image = typeof data.profilePictureURL === 'string'
      ? data.profilePictureURL
      : typeof data.profilePictureUrl === 'string'
        ? data.profilePictureUrl
        : null;

    if (!image || !/^https:\/\/(?:pps\.whatsapp\.net|[^/]+)\//i.test(image)) {
      const error = new Error('Foto de perfil não encontrada');
      error.code = 'NOT_FOUND';
      throw error;
    }
    return image;
  } finally {
    clearTimeout(timeout);
  }
}

async function handleProfilePicture(req, res, requestUrl) {
  const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress || 'unknown';
  if (isRateLimited(ip)) return failure(res, 429, 'Muitas solicitações; tente novamente mais tarde');

  const phone = normalizePhone(requestUrl.searchParams.get('phone'));
  if (!phone) {
    console.warn('[PROFILE-PICTURE] Número inválido');
    return failure(res, 400, 'Número de telefone inválido');
  }

  const cached = profileCache.get(phone);
  if (cached && cached.expiresAt > Date.now()) {
    console.log('[PROFILE-PICTURE] Foto encontrada em cache para:', phone);
    return json(res, 200, { success: true, image: cached.image });
  }

  console.log('[PROFILE-PICTURE] Buscando foto para:', phone);
  try {
    const image = await fetchProfilePicture(phone);
    profileCache.set(phone, { image, expiresAt: Date.now() + CACHE_TTL_MS });
    console.log('[PROFILE-PICTURE] Foto encontrada');
    return json(res, 200, { success: true, image });
  } catch (error) {
    if (error.name === 'AbortError') {
      console.warn('[PROFILE-PICTURE] Timeout na consulta ao WhatsApp');
      return failure(res, 504, 'Tempo esgotado ao consultar o WhatsApp');
    }
    if (error.code === 'NOT_CONFIGURED') {
      console.error('[PROFILE-PICTURE] Integração WAHA não configurada');
      return failure(res, 503, 'Integração WhatsApp não configurada');
    }
    if (error.code === 'NOT_FOUND' || error.status === 404) {
      console.log('[PROFILE-PICTURE] Foto não encontrada');
      return failure(res, 200, 'Foto de perfil não encontrada');
    }
    console.error('[PROFILE-PICTURE] Erro na consulta ao WhatsApp:', error.message);
    return failure(res, error.status === 401 || error.status === 403 ? 502 : 502, getWahaError(error.status));
  }
}

function safeStaticPath(urlPath) {
  const decoded = decodeURIComponent(urlPath === '/' ? '/index.html' : urlPath);
  const candidate = path.resolve(STATIC_ROOT, `.${decoded}`);
  return candidate.startsWith(`${STATIC_ROOT}${path.sep}`) ? candidate : null;
}

function serveStatic(req, res, requestUrl) {
  const filePath = safeStaticPath(requestUrl.pathname);
  if (!filePath) return json(res, 400, { error: 'Caminho inválido' });
  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) return json(res, 404, { error: 'Arquivo não encontrado' });
    const ext = path.extname(filePath).toLowerCase();
    const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf' };
    res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff' });
    fs.createReadStream(filePath).pipe(res);
  });
}

const server = http.createServer((req, res) => {
  const requestUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' });
    return res.end();
  }
  if (req.method !== 'GET') return failure(res, 405, 'Método não permitido');
  if (requestUrl.pathname === '/api/profile-picture') return handleProfilePicture(req, res, requestUrl);
  return serveStatic(req, res, requestUrl);
});

if (require.main === module) {
  server.listen(PORT, HOST, () => console.log(`[SERVER] Site disponível em http://${HOST}:${PORT}`));
}

module.exports = { normalizePhone, server };
