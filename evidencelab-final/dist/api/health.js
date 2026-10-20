const { getDeepSeekConfig, publicLlmError } = require('../lib/llm');
const { getProviderHealth } = require('../lib/financial-data');
const { getSupabaseConfig } = require('../lib/supabase');

module.exports = function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') {
    res.statusCode = 405;
    return res.end(JSON.stringify({ error: 'METHOD_NOT_ALLOWED', message: '仅支持 GET。' }));
  }
  let llm;
  try {
    const config = getDeepSeekConfig();
    llm = {
      provider: 'DeepSeek', model: config.model, configured: config.configured,
      connection: 'not-probed-by-health',
      message: config.configured ? '已配置服务端密钥；仅 /api/analyze 的当前请求成功后才标记连接成功。' : '未配置密钥，分析接口将使用规则引擎。'
    };
  } catch (error) {
    const failure = publicLlmError(error);
    llm = { provider: 'DeepSeek', model: null, configured: false, connection: 'configuration-error', errorCode: failure.code, message: failure.message };
  }
  res.statusCode = 200;
  const supabase = getSupabaseConfig();
  res.end(JSON.stringify({
    status: 'ok', mode: 'historical-public-snapshot', dataFreshness: 'non-real-time',
    providerAdapters: getProviderHealth(),
    llm,
    taskStorage: supabase.configured
      ? { mode: 'supabase-when-authenticated', crossBrowserSync: true, serverDatabase: 'configured-not-probed' }
      : { mode: 'browser-local-fallback', crossBrowserSync: false, serverDatabase: 'not-configured' },
    schemaVersion: 2, asOf: '2026-10-19'
  }));
};
