const cache = new Map();
const rateLimit = new Map();

const CACHE_TTL_MS = Number(process.env.PROFILE_PICTURE_CACHE_TTL_MS || 24 * 60 * 60 * 1000);
const REQUEST_TIMEOUT_MS = Number(process.env.WAHA_REQUEST_TIMEOUT_MS || 8000);
const MAX_REQUESTS_PER_WINDOW = Number(process.env.PROFILE_PICTURE_RATE_LIMIT || 30);
const RATE_WINDOW_MS = 60 * 1000;
const DEFAULT_COUNTRY_CODE = String(process.env.DEFAULT_COUNTRY_CODE || '55').replace(/\D/g, '');

function normalizePhone(input) {
  const digits = String(input || '').replace(/\D/g, '');
  if (!digits || digits.length < 10 || digits.length > 15) return null;
  if (DEFAULT_COUNTRY_CODE && digits.length <= 11 && !digits.startsWith(DEFAULT_COUNTRY_CODE)) {
    return `${DEFAULT_COUNTRY_CODE}${digits}`;
  }
  return digits;
}

function response(res, status, body) {
  res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  return res.json(body);
}

function fail(res, status, error) {
  return response(res, status, { success: false, image: null, error });
}

function limited(ip) {
  const now = Date.now();
  const item = rateLimit.get(ip);
  if (!item || now - item.startedAt >= RATE_WINDOW_MS) {
    rateLimit.set(ip, { startedAt: now, count: 1 });
    return false;
  }
  item.count += 1;
  return item.count > MAX_REQUESTS_PER_WINDOW;
}

function upstreamError(status) {
  if (status === 401 || status === 403) return 'Autenticação da integração WhatsApp recusada';
  if (status === 404) return 'Número ou foto de perfil não encontrada';
  if (status === 408 || status === 504) return 'Tempo esgotado ao consultar o WhatsApp';
  if (status >= 500) return 'Serviço do WhatsApp indisponível';
  return 'Erro da integração WhatsApp';
}

async function findPicture(phone) {
  const baseUrl = String(process.env.WAHA_BASE_URL || '').replace(/\/$/, '');
  if (!baseUrl) {
    const error = new Error('Integração WhatsApp não configurada');
    error.code = 'NOT_CONFIGURED';
    throw error;
  }

  const endpoint = new URL('/api/contacts/profile-picture', `${baseUrl}/`);
  endpoint.searchParams.set('contactId', phone);
  endpoint.searchParams.set('session', process.env.WAHA_SESSION || 'default');

  const headers = { Accept: 'application/json' };
  if (process.env.WAHA_API_KEY) headers['X-Api-Key'] = process.env.WAHA_API_KEY;
  if (process.env.WAHA_USERNAME || process.env.WAHA_PASSWORD) {
    headers.Authorization = `Basic ${Buffer.from(`${process.env.WAHA_USERNAME || ''}:${process.env.WAHA_PASSWORD || ''}`).toString('base64')}`;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const upstream = await fetch(endpoint, { headers, signal: controller.signal, redirect: 'error' });
    if (!upstream.ok) {
      const error = new Error(upstreamError(upstream.status));
      error.status = upstream.status;
      throw error;
    }
    const data = await upstream.json();
    const image = typeof data.profilePictureURL === 'string'
      ? data.profilePictureURL
      : typeof data.profilePictureUrl === 'string' ? data.profilePictureUrl : null;
    if (!image || !/^https:\/\/(?:pps\.whatsapp\.net|[^/]+)\//i.test(image)) {
      const error = new Error('Foto de perfil não encontrada');
      error.code = 'NOT_FOUND';
      throw error;
    }
    return image;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return fail(res, 405, 'Método não permitido');

  const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
  if (limited(ip)) return fail(res, 429, 'Muitas solicitações; tente novamente mais tarde');

  const phone = normalizePhone(req.query?.phone);
  if (!phone) return fail(res, 400, 'Número de telefone inválido');

  const cached = cache.get(phone);
  if (cached && cached.expiresAt > Date.now()) return response(res, 200, { success: true, image: cached.image });

  console.log('[PROFILE-PICTURE] Buscando foto para:', phone);
  try {
    const image = await findPicture(phone);
    cache.set(phone, { image, expiresAt: Date.now() + CACHE_TTL_MS });
    console.log('[PROFILE-PICTURE] Foto encontrada');
    return response(res, 200, { success: true, image });
  } catch (error) {
    if (error.name === 'AbortError') return fail(res, 504, 'Tempo esgotado ao consultar o WhatsApp');
    if (error.code === 'NOT_CONFIGURED') return fail(res, 503, 'Integração WhatsApp não configurada');
    if (error.code === 'NOT_FOUND' || error.status === 404) return fail(res, 200, 'Foto de perfil não encontrada');
    console.error('[PROFILE-PICTURE] Erro na consulta ao WhatsApp:', error.message);
    return fail(res, 502, upstreamError(error.status));
  }
};

module.exports.normalizePhone = normalizePhone;
