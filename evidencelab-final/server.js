const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const analyzeHandler = require('./api/analyze');
const healthHandler = require('./api/health');
const followupHandler = require('./api/followup');
const compareHandler = require('./api/compare');
const PORT = Number(process.env.PORT || 4173);
const PUBLIC = path.join(__dirname, 'public');
const MIME = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'application/javascript; charset=utf-8', '.json':'application/json; charset=utf-8', '.svg':'image/svg+xml' };
function adaptHandler(handler, req, res) {
  res.status = code => { res.statusCode = code; return res; };
  const u = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  req.query = Object.fromEntries(u.searchParams.entries());
  let raw = ''; let tooLarge = false;
  req.on('data', chunk => { raw += chunk; if (raw.length > 100000) tooLarge = true; });
  req.on('end', () => {
    if (tooLarge) { res.statusCode = 413; return res.end(JSON.stringify({ error: 'PAYLOAD_TOO_LARGE', message: '请求体不能超过 100KB。' })); }
    if (raw) {
      try { req.body = JSON.parse(raw); }
      catch (_) { res.statusCode = 400; return res.end(JSON.stringify({ error: 'INVALID_JSON', message: '请求体不是合法 JSON。' })); }
    }
    Promise.resolve(handler(req, res)).catch(() => { if (!res.writableEnded) { res.statusCode = 500; res.end(JSON.stringify({ error: 'INTERNAL_ERROR', message: '服务处理失败。' })); } });
  });
}
http.createServer((req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Content-Security-Policy', "default-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'self'");
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (url.pathname === '/api/analyze') return adaptHandler(analyzeHandler, req, res);
  if (url.pathname === '/api/health') return adaptHandler(healthHandler, req, res);
  if (url.pathname === '/api/followup') return adaptHandler(followupHandler, req, res);
  if (url.pathname === '/api/compare') return adaptHandler(compareHandler, req, res);
  let pathname = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
  const file = path.normalize(path.join(PUBLIC, pathname));
  const relative = path.relative(PUBLIC, file);
  if (relative.startsWith('..') || path.isAbsolute(relative)) { res.statusCode = 403; return res.end('Forbidden'); }
  fs.readFile(file, (err, data) => {
    if (err) { res.statusCode = 404; return res.end('Not found'); }
    res.statusCode = 200;
    res.setHeader('Content-Type', MIME[path.extname(file)] || 'application/octet-stream');
    res.end(data);
  });
}).listen(PORT, () => console.log(`EvidenceLab running at http://localhost:${PORT}`));
