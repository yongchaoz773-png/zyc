'use strict';

const MAX_BODY_BYTES = 100000;

class RequestInputError extends Error {
  constructor(statusCode, code, message) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

function readJsonBody(req) {
  const contentLength = Number(req.headers && req.headers['content-length']);
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    throw new RequestInputError(413, 'PAYLOAD_TOO_LARGE', '请求体不能超过 100KB。');
  }

  let body;
  try {
    body = req.body;
  } catch (_) {
    throw new RequestInputError(400, 'INVALID_JSON', '请求体不是合法 JSON。');
  }
  if (body === undefined || body === null || body === '') return {};

  if (Buffer.isBuffer(body)) body = body.toString('utf8');
  if (typeof body === 'string') {
    if (Buffer.byteLength(body, 'utf8') > MAX_BODY_BYTES) {
      throw new RequestInputError(413, 'PAYLOAD_TOO_LARGE', '请求体不能超过 100KB。');
    }
    try {
      body = JSON.parse(body);
    } catch (_) {
      throw new RequestInputError(400, 'INVALID_JSON', '请求体不是合法 JSON。');
    }
  }

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new RequestInputError(400, 'INVALID_REQUEST', '请求体必须是 JSON 对象。');
  }
  return body;
}

function sendInputError(res, error) {
  if (!(error instanceof RequestInputError)) return false;
  res.statusCode = error.statusCode;
  res.end(JSON.stringify({ error: error.code, message: error.message }));
  return true;
}

function assertSameOrigin(req) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(String(req.method || 'GET').toUpperCase())) return;
  const headers = req.headers || {};
  const fetchSite = String(headers['sec-fetch-site'] || '').toLowerCase();
  if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none') {
    throw new RequestInputError(403, 'CSRF_REJECTED', '拒绝跨站写请求。');
  }
  const origin = String(headers.origin || '').trim();
  if (!origin) return;
  const forwardedHost = String(headers['x-forwarded-host'] || headers.host || '').split(',')[0].trim();
  const forwardedProto = String(headers['x-forwarded-proto'] || (process.env.NODE_ENV === 'production' ? 'https' : 'http')).split(',')[0].trim();
  if (!forwardedHost || origin !== `${forwardedProto}://${forwardedHost}`) {
    throw new RequestInputError(403, 'CSRF_REJECTED', '请求来源与当前站点不一致。');
  }
}

module.exports = { MAX_BODY_BYTES, RequestInputError, assertSameOrigin, readJsonBody, sendInputError };
