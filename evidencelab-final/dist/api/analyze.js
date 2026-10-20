const { buildAnalysis } = require('../lib/engine');
const { getDeepSeekConfig, parseThesisWithLLM, explainAnalysisWithLLM, publicLlmError } = require('../lib/llm');
const { buildResearchTask } = require('../lib/research');
const { readJsonBody, sendInputError } = require('../lib/http');
const { FinancialDataError, getFinancialData } = require('../lib/financial-data');

const SIMULATIONS = {
  '401': [401, 'AUTH_REQUIRED', '数据源认证失败，请检查服务端凭证。'],
  '403': [403, 'PERMISSION_DENIED', '当前账号无权访问该数据源。'],
  '429': [429, 'RATE_LIMITED', '数据源请求过于频繁，请稍后重试。'],
  '500': [500, 'UPSTREAM_ERROR', '上游数据源内部错误，已保留可用快照。'],
  '503': [503, 'UPSTREAM_UNAVAILABLE', '上游数据接口暂不可用，请重试或查看已缓存证据。'],
  'empty': [502, 'EMPTY_DATA', '数据源返回空数据，不能据此判断命题。'],
  'schema': [502, 'INVALID_PROVIDER_SCHEMA', '数据源返回格式不符合约定。']
};

function modelStatus(config, overrides = {}) {
  return {
    provider: 'DeepSeek',
    model: config?.model || null,
    configured: Boolean(config?.configured),
    connection: 'not-attempted',
    semanticParse: 'not-attempted',
    explanation: 'not-attempted',
    fallbackUsed: !config?.configured,
    message: config?.configured ? '等待当前请求验证。' : 'DeepSeek 未配置，当前请求使用规则引擎。',
    ...overrides
  };
}

function scopeFromValidatedPlan(claim, requestScope, plan) {
  const text = String(claim || '');
  const companyMentioned = [plan.entities.company, plan.entities.ticker].find(value => value && text.toUpperCase().includes(value.toUpperCase()));
  const reportYear = plan.entities.reportPeriod.match(/20\d{2}/)?.[0];
  const directMetrics = plan.entities.metrics.filter(metric => metric && text.includes(metric));
  return {
    company: requestScope.company || companyMentioned || '',
    period: requestScope.period || (reportYear && text.includes(reportYear) ? plan.entities.reportPeriod : ''),
    metrics: requestScope.metrics.length ? requestScope.metrics : directMetrics
  };
}

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
    const period = body.period || (req.query && req.query.period) || '';
    const metrics = Array.isArray(body.metrics) ? body.metrics : [];
    if (!String(claim).trim()) {
      res.statusCode = 400;
      return res.end(JSON.stringify({ error: 'EMPTY_CLAIM', message: '请输入需要验证的投资命题。' }));
    }
    if (String(claim).length > 1200) {
      res.statusCode = 413;
      return res.end(JSON.stringify({ error: 'CLAIM_TOO_LONG', message: '命题不能超过 1200 个字符，请先提炼核心假设。' }));
    }
    const requestScope = { company, period, metrics };
    let financialData;
    try {
      financialData = await getFinancialData({ company, period, refresh: body.refreshData === true });
    } catch (error) {
      if (!(error instanceof FinancialDataError)) throw error;
      financialData = {
        facts: [], sources: [], sourceChecks: [], snapshotAsOf: null,
        status: {
          provider: 'public-disclosure-snapshot', mode: 'unavailable', structuredOnlineData: false,
          fallbackUsed: false, sourceVerification: 'not-requested', errorCode: error.code, message: error.message
        }
      };
    }
    let config;
    let configError;
    try { config = getDeepSeekConfig(); } catch (error) { configError = error; }
    let result;
    if (!config || !config.configured) {
      result = buildAnalysis(claim, company, { period, metrics });
      const failure = configError ? publicLlmError(configError) : null;
      result.llmStatus = modelStatus(config, failure ? {
        configured: false, connection: 'configuration-error', fallbackUsed: true,
        errorCode: failure.code, message: failure.message
      } : {});
    } else {
      const deadline = Date.now() + config.totalTimeoutMs;
      try {
        const semanticPlan = await parseThesisWithLLM(claim, requestScope, { config, deadline });
        const validatedScope = scopeFromValidatedPlan(claim, requestScope, semanticPlan);
        result = buildAnalysis(claim, validatedScope.company, { period: validatedScope.period, metrics: validatedScope.metrics });
        result.semanticPlan = semanticPlan;
        result.mode = 'deepseek+rules';
        result.llmStatus = modelStatus(config, {
          connection: 'verified-this-request', semanticParse: 'success', fallbackUsed: false,
          message: '当前请求已收到并校验 DeepSeek 结构化响应；规则引擎独立完成事实核验与裁决。'
        });
        try {
          result.modelExplanation = await explainAnalysisWithLLM(result, { config, deadline });
          result.llmStatus.explanation = 'success';
        } catch (error) {
          const failure = publicLlmError(error);
          result.llmStatus.explanation = 'failed';
          result.llmStatus.fallbackUsed = true;
          result.llmStatus.errorCode = failure.code;
          result.llmStatus.message = `命题解析成功；模型解释未采用。${failure.message}`;
        }
      } catch (error) {
        const failure = publicLlmError(error);
        result = buildAnalysis(claim, company, { period, metrics });
        result.llmStatus = modelStatus(config, {
          connection: 'failed', semanticParse: 'failed', fallbackUsed: true,
          errorCode: failure.code, message: failure.message
        });
      }
    }
    result.financialData = financialData;
    result.researchTask = buildResearchTask(result);
    res.statusCode = 200;
    return res.end(JSON.stringify(result));
  } catch (err) {
    if (sendInputError(res, err)) return;
    res.statusCode = 500;
    return res.end(JSON.stringify({ error: 'ANALYSIS_FAILED', message: '分析服务暂时不可用。请重试，或查看已缓存证据。', detail: process.env.NODE_ENV === 'development' ? String(err.message || err) : undefined }));
  }
};
