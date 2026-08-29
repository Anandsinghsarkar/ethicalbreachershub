import backend from '../backend-core.js';

function runtimeEnv() {
  const env = {
    ALLOWED_ORIGIN: process.env.ALLOWED_ORIGIN || '*',
    FIREBASE_WEB_API_KEY: process.env.FIREBASE_WEB_API_KEY || 'AIzaSyAsGtblJRafRcfPDxSwXIlklMqBSKfo8Eo',
    FIREBASE_DATABASE_URL: process.env.FIREBASE_DATABASE_URL || 'https://asprivetchat-default-rtdb.asia-southeast1.firebasedatabase.app',
    FIREBASE_CLIENT_EMAIL: process.env.FIREBASE_CLIENT_EMAIL || '',
    FIREBASE_PRIVATE_KEY: process.env.FIREBASE_PRIVATE_KEY || '',
    FIREBASE_SERVICE_ACCOUNT_JSON: process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '',
    RAZORPAY_KEY_ID: process.env.RAZORPAY_KEY_ID || '',
    RAZORPAY_KEY_SECRET: process.env.RAZORPAY_KEY_SECRET || '',
    RAZORPAY_WEBHOOK_SECRET: process.env.RAZORPAY_WEBHOOK_SECRET || '',
    DAILY_CLAIM_CREDITS: process.env.DAILY_CLAIM_CREDITS || '5',
    ADMIN_EMAIL: process.env.ADMIN_EMAIL || '',
    ADMIN_PASSWORD: process.env.ADMIN_PASSWORD || ''
  };

  if (env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    try {
      const serviceAccount = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_JSON);
      env.FIREBASE_CLIENT_EMAIL ||= serviceAccount.client_email || '';
      env.FIREBASE_PRIVATE_KEY ||= serviceAccount.private_key || '';
    } catch (e) {
      console.error('Invalid FIREBASE_SERVICE_ACCOUNT_JSON:', e.message);
    }
  }
  return env;
}

async function rawBody(req) {
  const chunks = [];
  let total = 0;
  const max = 2 * 1024 * 1024;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > max) throw new Error('REQUEST_TOO_LARGE');
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function backendPath(req) {
  const url = new URL(req.url || '/', 'https://localhost');
  let p = url.pathname.replace(/^\/api\/?/, '/');
  if (p === '/razorpay/webhook') p = '/razorpay-webhook';
  return p;
}

export default async function handler(req, res) {
  try {
    const path = backendPath(req);
    const proto = String(req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim();
    const host = String(req.headers['x-forwarded-host'] || req.headers.host || 'localhost').split(',')[0].trim();
    const inputUrl = new URL(req.url || '/', `${proto}://${host}`);
    const targetUrl = `${proto}://${host}${path}${inputUrl.search}`;

    const headers = new Headers();
    for (const [name, value] of Object.entries(req.headers || {})) {
      if (Array.isArray(value)) value.forEach(v => headers.append(name, v));
      else if (value != null) headers.set(name, String(value));
    }

    const init = { method: req.method || 'GET', headers };
    if (!['GET', 'HEAD'].includes(init.method)) {
      const body = await rawBody(req);
      if (body.length) init.body = body;
    }

    const webReq = new Request(targetUrl, init);
    const webRes = await backend.fetch(webReq, runtimeEnv());
    res.statusCode = webRes.status;
    webRes.headers.forEach((value, key) => res.setHeader(key, value));
    const out = Buffer.from(await webRes.arrayBuffer());
    res.end(out);
  } catch (err) {
    console.error('Vercel adapter error:', err);
    res.statusCode = err?.message === 'REQUEST_TOO_LARGE' ? 413 : 500;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ success: false, error: 'SERVER_ADAPTER_ERROR' }));
  }
}
