module.exports = function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') {
    res.statusCode = 405;
    return res.end(JSON.stringify({ error: 'METHOD_NOT_ALLOWED', message: '仅支持 GET。' }));
  }
  res.statusCode = 200;
  res.end(JSON.stringify({ status: 'ok', mode: 'historical-public-snapshot', dataFreshness: 'non-real-time', providerAdapters: { publicDisclosure: 'ready', fuyiao: 'not-configured', ifindMcp: 'not-configured' }, llm: process.env.OPENAI_API_KEY ? 'configured' : 'not-configured', schemaVersion: 2, asOf: '2026-10-19' }));
};
