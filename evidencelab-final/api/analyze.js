const { buildAnalysis } = require('../lib/engine');
const { parseThesisWithLLM } = require('../lib/llm');
const { buildResearchTask } = require('../lib/research');
const { readJsonBody, sendInputError } = require('../lib/http');

const SIMULATIONS = {
  '401': [401, 'AUTH_REQUIRED', '数据源认证失败，请检查服务端凭证。'],
  '403': [403, 'PERMISSION_DENIED', '当前账号无权访问该数据源。'],
  '429': [429, 'RATE_LIMITED', '数据源请求过于频繁，请稍后重试。'],
  '500': [500, 'UPSTREAM_ERROR', '上游数据源内部错误，已保留可用快照。'],
  '503': [503, 'UPSTREAM_UNAVAILABLE', '上游数据接口暂不可用，请重试或查看已缓存证据。'],
  'empty': [502, 'EMPTY_DATA', '数据源返回空数据，不能据此判断命题。'],
  'schema': [502, 'INVALID_PROVIDER_SCHEMA', '数据源返回格式不符合约定。']
};

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST' && req.method !== 'GET') {
    res.statusCode = 405;
    return res.end(JSON.stringify({ error: 'METHOD_NOT_ALLOWED', message: '仅支持 POST 或 GET。' }));
  }
  const simulation = req.query && SIMULATIONS[req.query.simulate];
  if (simulation) {
    res.statusCode = simulation[0];
    return res.end(JSON.stringify({ error: simulation[1], message: `演示模式：${simulation[2]}`, evidenceImpact: 'unknown-not-opposition' }));
  }
  try {
    const body = readJsonBody(req);
    const claim = body.claim || (req.query && req.query.claim) || '';
    const company = body.company || (req.query && req.query.company) || '300750.SZ';
    if (!String(claim).trim()) {
      res.statusCode = 400;
      return res.end(JSON.stringify({ error: 'EMPTY_CLAIM', message: '请输入需要验证的投资命题。' }));
    }
    if (String(claim).length > 1200) {
      res.statusCode = 413;
      return res.end(JSON.stringify({ error: 'CLAIM_TOO_LONG', message: '命题不能超过 1200 个字符，请先提炼核心假设。' }));
    }
    const result = buildAnalysis(claim, company);
    result.llmStatus = process.env.OPENAI_API_KEY ? 'configured' : 'not-configured';
    if (process.env.OPENAI_API_KEY) {
      try {
        const semanticPlan = await parseThesisWithLLM(claim || result.claim, company);
        if (semanticPlan) { result.semanticPlan = semanticPlan; result.mode = 'llm+rules'; result.llmStatus = 'available'; }
      } catch (_) {
        result.llmStatus = 'fallback';
        result.llmFallbackReason = '语义解析服务暂不可用，已回退到规则引擎；财务证据与结论逻辑未受影响。';
      }
    }
    result.researchTask = buildResearchTask(result);
    res.statusCode = 200;
    return res.end(JSON.stringify(result));
  } catch (err) {
    if (sendInputError(res, err)) return;
    res.statusCode = 500;
    return res.end(JSON.stringify({ error: 'ANALYSIS_FAILED', message: '分析服务暂时不可用。请重试，或查看已缓存证据。', detail: process.env.NODE_ENV === 'development' ? String(err.message || err) : undefined }));
  }
};
