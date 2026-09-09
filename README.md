# Site estático com API de foto de perfil do WhatsApp

## Análise do projeto original

O ZIP recebido é um **site estático exportado**, composto por HTML, CSS, imagens e JavaScript. Não havia `package.json`, servidor, rota backend, arquivo `.env`, integração WAHA, cliente WhatsApp Web ou outra API de WhatsApp. O frontend já chamava `/api/profile-picture?phone=...` em `js/profile-picture.js` e em `start/js/profile-picture.js`, e atualizava os elementos `#imgProfile`, `#fotoperfil`, `#fotoperfiltoda` e `#perfiltfotto`.

Consequentemente, não era possível reutilizar uma integração existente nem confirmar a URL `pps.whatsapp.net` a partir do projeto. A implementação abaixo adiciona apenas a infraestrutura de servidor necessária e não gera placeholder ou foto fictícia.

## Arquivos criados

| Arquivo | Finalidade |
|---|---|
| `server.js` | Servidor Node.js, arquivos estáticos e rota `/api/profile-picture`. |
| `package.json` | Scripts mínimos para iniciar e testar o servidor. |
| `.env.example` | Nomes e valores de exemplo das configurações, sem credenciais. |
| `server.test.js` | Testes de normalização de telefone. |
| `README.md` | Documentação de instalação, configuração e testes. |

## Arquivos modificados

Nenhum arquivo frontend foi modificado. O contrato já existente em `profile-picture.js` foi preservado.

## API utilizada

Como o projeto não possuía integração, o backend usa um adaptador configurável para **WAHA (WhatsApp HTTP API)**. O endpoint oficial consultado é:

```text
GET {WAHA_BASE_URL}/api/contacts/profile-picture?contactId={telefone}&session={WAHA_SESSION}
```

A resposta esperada do WAHA contém `profilePictureURL`. Essa URL é repassada sem download, proxy ou transformação, permitindo que URLs temporárias do WhatsApp permaneçam intactas. O WAHA precisa estar conectado a uma sessão real do WhatsApp e corretamente configurado fora deste projeto.

## De onde a foto é obtida

A foto é obtida pela sessão WAHA configurada, que consulta a conta real do WhatsApp correspondente ao número. Sem `WAHA_BASE_URL`, a API responde `503 Integração WhatsApp não configurada`; ela nunca inventa uma imagem, usa avatar ou finge sucesso.

## Endpoint do site

```text
GET /api/profile-picture?phone=NUMERO
```

Exemplos de entrada aceitos:

```text
/api/profile-picture?phone=5519912345678
/api/profile-picture?phone=19912345678
```

Números com formatação têm os caracteres não numéricos removidos. Números nacionais brasileiros de 10 ou 11 dígitos recebem o DDI `55`; números que já possuem DDI são preservados.

## Respostas

Sucesso:

```json
{
  "success": true,
  "image": "https://pps.whatsapp.net/..."
}
```

Sem foto ou número não localizado:

```json
{
  "success": false,
  "image": null,
  "error": "Foto de perfil não encontrada"
}
```

Número inválido:

```json
{
  "success": false,
  "image": null,
  "error": "Número de telefone inválido"
}
```

Integração ausente ou indisponível produz uma resposta JSON consistente com status HTTP `503`, `502` ou `504`, conforme o caso.

## Configuração

Copie `.env.example` para `.env` ou exporte as variáveis no ambiente do processo. O servidor carrega `.env` automaticamente, sem dependência adicional; variáveis já exportadas têm precedência. Use, por exemplo:

```bash
export WAHA_BASE_URL="http://127.0.0.1:3001"
export WAHA_API_KEY="sua-chave-no-ambiente"
export WAHA_SESSION="default"
npm start
```

Se o domínio WAHA estiver protegido por **HTTP Basic**, como `https://waha.nexaaisolutions.com.br`, configure também `WAHA_USERNAME` e `WAHA_PASSWORD` no ambiente do backend. O servidor envia essas credenciais somente na chamada server-side para o WAHA; elas nunca chegam ao navegador.

Para o dashboard informado, a configuração base é:

```bash
WAHA_BASE_URL=https://waha.nexaaisolutions.com.br
WAHA_SESSION=default
```

Use em `WAHA_SESSION` o nome exato mostrado na área **Sessions**. A informação `WORKING: 1` indica que há uma sessão funcionando, mas não revela necessariamente o nome dela. O erro HTTP `401 Unauthorized` sem autenticação confirma que o domínio está acessível e protegido.

A chave fica apenas no backend. Não coloque `WAHA_API_KEY` em nenhum JavaScript público.

O valor de `WAHA_BASE_URL` deve apontar para o servidor WAHA, não para a porta deste site, caso sejam processos separados.

`HOST` é apenas o endereço local de binding, como `127.0.0.1`; não use uma URL HTTPS nele. Como o frontend chama uma rota relativa, mantenha `PORT=3000` quando abrir o site em `http://127.0.0.1:3000/`.

## Testes

Os testes unitários não exigem uma sessão WhatsApp:

```bash
npm test
```

Para testar a rota sem integração configurada:

```bash
npm start
curl -i "http://127.0.0.1:3000/api/profile-picture?phone=5519912345678"
```

O resultado esperado é JSON com `success: false` e `error: "Integração WhatsApp não configurada"`, até que WAHA esteja configurado.

Com WAHA conectado e as variáveis definidas, chame:

```bash
curl -i "http://127.0.0.1:3000/api/profile-picture?phone=5519912345678&timestamp=$(date +%s)"
```

Depois, valide que `success` é `true`, que `image` é uma URL HTTPS e que a URL continua acessível. Abra uma página do site pelo mesmo servidor para testar o frontend e observe os quatro seletores de imagem. O backend aplica cache de servidor por padrão por 24 horas, limite básico por IP e timeout de 8 segundos; o parâmetro `timestamp` do frontend continua aceito e não é usado para burlar o cache do servidor.

## Deploy na Vercel

Na Vercel, não use `node server.js` como Build Command nem como função. A Vercel executa funções serverless dentro de `api/`; por isso o projeto contém `api/profile-picture.js` e `vercel.json`. O `server.js` continua disponível apenas para execução local.

No painel da Vercel, cadastre em **Project Settings → Environment Variables**:

```text
WAHA_BASE_URL=https://waha.nexaaisolutions.com.br
WAHA_API_KEY=...
WAHA_USERNAME=...
WAHA_PASSWORD=...
WAHA_SESSION=default
DEFAULT_COUNTRY_CODE=55
PROFILE_PICTURE_CACHE_TTL_MS=86400000
WAHA_REQUEST_TIMEOUT_MS=8000
PROFILE_PICTURE_RATE_LIMIT=30
```

Não cadastre `HOST` ou `PORT` para a função serverless. Se houver um Build Command personalizado no projeto Vercel, remova-o ou use `npm run build`. O log correto deve executar o build curto `Static site and Vercel functions ready`, sem iniciar um processo que imprime `Site disponível em http://127.0.0.1:3000`.

Depois do deploy, teste:

```text
https://SEU-DOMINIO.vercel.app/api/profile-picture?phone=11995251265
```

O frontend pode ser acessado em `https://SEU-DOMINIO.vercel.app/`, que é reescrito para `start/`. Variáveis de ambiente configuradas na Vercel exigem um novo deploy para entrarem em vigor.

## Limitações importantes

O projeto fictício não traz uma sessão WhatsApp, credenciais ou número real para teste de ponta a ponta. Portanto, não é possível afirmar neste ambiente que uma foto real foi retornada. Essa confirmação depende de um WAHA real, autenticado e conectado, configurado pelo operador do sistema.
