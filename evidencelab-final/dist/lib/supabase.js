'use strict';

const ACCESS_COOKIE = 'el_access_token';
const REFRESH_COOKIE = 'el_refresh_token';
const DEFAULT_TIMEOUT_MS = 6000;

class SupabaseError extends Error {
  constructor(code, message, statusCode = 502, detail = null) {
    super(message);
    this.name = 'SupabaseError';
    this.code = code;
    this.statusCode = statusCode;
    this.detail = detail;
  }
}

function getSupabaseConfig() {
  const url = String(process.env.SUPABASE_URL || '').trim().replace(/\/$/, '');
  const key = String(process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || '').trim();
  const missing = [];
  if (!url) missing.push('SUPABASE_URL');
  if (!key) missing.push('SUPABASE_PUBLISHABLE_KEY');
  let invalid = null;
  if (url) {
    try { if (new URL(url).protocol !== 'https:') invalid = 'SUPABASE_URL 必须使用 HTTPS。'; }
    catch (_) { invalid = 'SUPABASE_URL 格式无效。'; }
  }
  return { url, key, configured: missing.length === 0 && !invalid, missing, invalid };
}

function requireSupabaseConfig() {
  const config = getSupabaseConfig();
  if (!config.configured) {
    throw new SupabaseError('CLOUD_NOT_CONFIGURED', config.invalid || `云端持久化未配置：缺少 ${config.missing.join('、')}。`, 503);
  }
  return config;
}

function parseCookies(req) {
  const output = {};
  for (const item of String(req.headers?.cookie || '').split(';')) {
    const index = item.indexOf('=');
    if (index < 1) continue;
    const key = item.slice(0, index).trim();
    try { output[key] = decodeURIComponent(item.slice(index + 1).trim()); } catch (_) { output[key] = ''; }
  }
  return output;
}

function isSecureRequest(req) {
  return String(req.headers?.['x-forwarded-proto'] || '').split(',')[0].trim() === 'https' || process.env.NODE_ENV === 'production';
}

function appendSetCookie(res, value) {
  const prior = typeof res.getHeader === 'function' ? res.getHeader('Set-Cookie') : res.__setCookies;
  const next = prior ? (Array.isArray(prior) ? [...prior, value] : [prior, value]) : [value];
  if (typeof res.setHeader === 'function') res.setHeader('Set-Cookie', next);
  res.__setCookies = next;
}

function cookieValue(name, value, req, maxAge) {
  const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${Math.max(0, Math.floor(maxAge))}`];
  if (isSecureRequest(req)) parts.push('Secure');
  return parts.join('; ');
}

function setSessionCookies(req, res, session) {
  appendSetCookie(res, cookieValue(ACCESS_COOKIE, session.access_token, req, Number(session.expires_in) || 3600));
  appendSetCookie(res, cookieValue(REFRESH_COOKIE, session.refresh_token, req, 60 * 60 * 24 * 30));
}

function clearSessionCookies(req, res) {
  appendSetCookie(res, cookieValue(ACCESS_COOKIE, '', req, 0));
  appendSetCookie(res, cookieValue(REFRESH_COOKIE, '', req, 0));
}

async function requestJson(url, options = {}, fetchImpl = global.fetch) {
  if (typeof fetchImpl !== 'function') throw new SupabaseError('FETCH_UNAVAILABLE', '当前运行时不支持云端请求。');
  const controller = new AbortController();
  const timeoutMs = Number(process.env.SUPABASE_TIMEOUT_MS) > 0 ? Number(process.env.SUPABASE_TIMEOUT_MS) : DEFAULT_TIMEOUT_MS;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetchImpl(url, { ...options, signal: controller.signal });
  } catch (error) {
    const code = error?.name === 'AbortError' ? 'CLOUD_TIMEOUT' : 'CLOUD_UNAVAILABLE';
    throw new SupabaseError(code, code === 'CLOUD_TIMEOUT' ? '云端请求超时。' : '无法连接云端服务。', 503);
  } finally {
    clearTimeout(timer);
  }
  let payload = null;
  const text = await response.text();
  if (text) {
    try { payload = JSON.parse(text); } catch (_) { payload = { message: '上游返回了无法解析的响应。' }; }
  }
  if (!response.ok) {
    const upstreamMessage = payload?.msg || payload?.message || payload?.error_description || payload?.error || `HTTP ${response.status}`;
    const statusCode = [400, 401, 403, 409, 422, 429].includes(response.status) ? response.status : 502;
    throw new SupabaseError(response.status === 401 ? 'AUTH_REQUIRED' : 'CLOUD_REQUEST_FAILED', String(upstreamMessage), statusCode, payload);
  }
  return { payload, response };
}

function baseHeaders(config, accessToken) {
  return {
    apikey: config.key,
    'Content-Type': 'application/json',
    ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {})
  };
}

async function authRequest(pathname, body, options = {}) {
  const config = options.config || requireSupabaseConfig();
  const method = options.method || 'POST';
  return requestJson(`${config.url}/auth/v1/${pathname}`, {
    method,
    headers: baseHeaders(config, options.accessToken),
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  }, options.fetchImpl);
}

async function getAuthenticatedSession(req, res, options = {}) {
  const config = options.config || requireSupabaseConfig();
  const cookies = parseCookies(req);
  let accessToken = cookies[ACCESS_COOKIE];
  const refreshToken = cookies[REFRESH_COOKIE];
  if (!accessToken && !refreshToken) throw new SupabaseError('AUTH_REQUIRED', '请先登录后再使用云端任务。', 401);
  try {
    const { payload: user } = await authRequest('user', undefined, { config, accessToken, method: 'GET', fetchImpl: options.fetchImpl });
    return { user, accessToken, config };
  } catch (error) {
    if (error.statusCode !== 401 || !refreshToken) throw error;
  }
  let session;
  try {
    ({ payload: session } = await authRequest('token?grant_type=refresh_token', { refresh_token: refreshToken }, { config, fetchImpl: options.fetchImpl }));
  } catch (error) {
    if ([400, 401].includes(error.statusCode)) {
      clearSessionCookies(req, res);
      throw new SupabaseError('AUTH_REQUIRED', '登录会话已失效，请重新登录。', 401);
    }
    throw error;
  }
  if (!session?.access_token || !session?.refresh_token || !session?.user?.id) {
    clearSessionCookies(req, res);
    throw new SupabaseError('AUTH_REQUIRED', '登录会话已失效，请重新登录。', 401);
  }
  setSessionCookies(req, res, session);
  accessToken = session.access_token;
  return { user: session.user, accessToken, config };
}

module.exports = {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  SupabaseError,
  authRequest,
  baseHeaders,
  clearSessionCookies,
  getAuthenticatedSession,
  getSupabaseConfig,
  parseCookies,
  requestJson,
  requireSupabaseConfig,
  setSessionCookies
};
