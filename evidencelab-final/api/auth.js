'use strict';

const { assertSameOrigin, readJsonBody, sendInputError } = require('../lib/http');
const { SupabaseError, authRequest, clearSessionCookies, getAuthenticatedSession, requireSupabaseConfig, setSessionCookies } = require('../lib/supabase');

function publicUser(user) {
  return user ? { id: user.id, email: user.email || null, emailConfirmedAt: user.email_confirmed_at || null } : null;
}

function sendError(res, error) {
  if (!(error instanceof SupabaseError)) return false;
  res.statusCode = error.statusCode;
  res.end(JSON.stringify({ error: error.code, message: error.message }));
  return true;
}

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  try {
    assertSameOrigin(req);
    const config = requireSupabaseConfig();
    const action = String(req.query?.action || (req.method === 'GET' ? 'session' : '')).toLowerCase();
    if (req.method === 'GET' && action === 'session') {
      try {
        const session = await getAuthenticatedSession(req, res, { config });
        res.statusCode = 200;
        return res.end(JSON.stringify({ configured: true, authenticated: true, user: publicUser(session.user) }));
      } catch (error) {
        if (error instanceof SupabaseError && error.statusCode === 401) {
          res.statusCode = 200;
          return res.end(JSON.stringify({ configured: true, authenticated: false, user: null }));
        }
        throw error;
      }
    }
    if (req.method !== 'POST' || !['signup', 'login', 'logout'].includes(action)) {
      res.statusCode = 405;
      return res.end(JSON.stringify({ error: 'METHOD_NOT_ALLOWED', message: '不支持该认证操作。' }));
    }
    if (action === 'logout') {
      const cookies = require('../lib/supabase').parseCookies(req);
      if (cookies.el_access_token) {
        try { await authRequest('logout?scope=local', {}, { config, accessToken: cookies.el_access_token }); } catch (_) {}
      }
      clearSessionCookies(req, res);
      res.statusCode = 200;
      return res.end(JSON.stringify({ authenticated: false }));
    }
    const body = readJsonBody(req);
    const email = String(body.email || '').trim();
    const password = String(body.password || '');
    if (!/^\S+@\S+\.\S+$/.test(email) || password.length < 8 || password.length > 128) {
      res.statusCode = 422;
      return res.end(JSON.stringify({ error: 'INVALID_CREDENTIAL_INPUT', message: '请输入有效邮箱和 8 至 128 位密码。' }));
    }
    const pathname = action === 'signup' ? 'signup' : 'token?grant_type=password';
    const { payload } = await authRequest(pathname, { email, password }, { config });
    if (payload?.access_token && payload?.refresh_token) setSessionCookies(req, res, payload);
    res.statusCode = action === 'signup' ? 201 : 200;
    return res.end(JSON.stringify({
      configured: true,
      authenticated: Boolean(payload?.access_token),
      confirmationRequired: action === 'signup' && !payload?.access_token,
      user: publicUser(payload?.user)
    }));
  } catch (error) {
    if (sendInputError(res, error) || sendError(res, error)) return;
    res.statusCode = 500;
    return res.end(JSON.stringify({ error: 'AUTH_FAILED', message: '认证服务暂时不可用。' }));
  }
};
