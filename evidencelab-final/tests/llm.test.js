'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  DeepSeekError, getDeepSeekConfig, parseThesisWithLLM, requestDeepSeek,
  validateExplanation, validateSemanticPlan
} = require('../lib/llm');
const { parseEnv } = require('../lib/env');

function jsonResponse(content, status = 200, finishReason = 'stop') {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return status >= 200 && status < 300
        ? { choices: [{ finish_reason: finishReason, message: { content: JSON.stringify(content) } }] }
        : { error: { message: 'redacted upstream error' } };
    }
  };
}

const semanticPayload = {
  normalizedClaim: '宁德时代营业收入增速高于归母净利润增速',
  entities: {
    company: '宁德时代', ticker: '300750.SZ', reportPeriod: '2025年度', comparisonPeriod: '2024年度',
    metrics: ['营业收入', '归母净利润'], relationship: '前者同比增速高于后者'
  },
  claimType: 'metric-comparison',
  subclaims: [{ id: 'llm-q1', text: '比较两个指标的同口径同比增速', claimType: 'metric-comparison', requiredMetrics: ['营业收入', '归母净利润'], requiredEvidence: ['同一报告期原始披露'] }],
  ambiguities: [], missingFields: [], needsClarification: false,
  suggestedQuestions: ['两个指标是否来自同一报告期？']
};

test('DeepSeek config uses the official Chat Completions endpoint without exposing the key', () => {
  const config = getDeepSeekConfig({ DEEPSEEK_API_KEY: 'unit-test-secret', DEEPSEEK_BASE_URL: 'https://api.deepseek.com/', DEEPSEEK_MODEL: 'deepseek-flash' });
  assert.equal(config.endpoint, 'https://api.deepseek.com/chat/completions');
  assert.equal(config.model, 'deepseek-flash');
  assert.equal(config.configured, true);
  const publicShape = { provider: 'DeepSeek', model: config.model, configured: config.configured };
  assert.equal(JSON.stringify(publicShape).includes('unit-test-secret'), false);
});

test('DeepSeek request sends server authorization and parses a validated semantic plan', async () => {
  let captured;
  const plan = await parseThesisWithLLM('宁德时代2025年营业收入同比增速高于归母净利润同比增速。', { company: '300750.SZ' }, {
    env: { DEEPSEEK_API_KEY: 'unit-test-secret', DEEPSEEK_BASE_URL: 'https://api.deepseek.com', DEEPSEEK_MODEL: 'deepseek-flash' },
    fetchImpl: async (url, init) => { captured = { url, init }; return jsonResponse(semanticPayload); }
  });
  assert.equal(captured.url, 'https://api.deepseek.com/chat/completions');
  assert.equal(captured.init.headers.Authorization, 'Bearer unit-test-secret');
  const body = JSON.parse(captured.init.body);
  assert.equal(body.model, 'deepseek-flash');
  assert.deepEqual(body.response_format, { type: 'json_object' });
  assert.equal(body.stream, false);
  assert.equal(plan.claimType, 'metric-comparison');
  assert.equal(plan.subclaims.length, 1);
});

test('DeepSeek adapter retries a retryable upstream response once', async () => {
  let calls = 0;
  const value = await requestDeepSeek([{ role: 'user', content: 'return json' }], {
    env: { DEEPSEEK_API_KEY: 'unit-test-secret' }, sleep: async () => {},
    fetchImpl: async () => { calls += 1; return calls === 1 ? jsonResponse({}, 503) : jsonResponse({ ok: true }); }
  });
  assert.deepEqual(value, { ok: true });
  assert.equal(calls, 2);
});

test('DeepSeek invalid key fails explicitly without retry', async () => {
  let calls = 0;
  await assert.rejects(() => requestDeepSeek([{ role: 'user', content: 'json' }], {
    env: { DEEPSEEK_API_KEY: 'invalid-unit-test-key' }, sleep: async () => {},
    fetchImpl: async () => { calls += 1; return jsonResponse({}, 401); }
  }), error => error instanceof DeepSeekError && error.code === 'AUTH_FAILED');
  assert.equal(calls, 1);
});

test('DeepSeek timeout retries once and remains a timeout error', async () => {
  let calls = 0;
  await assert.rejects(() => requestDeepSeek([{ role: 'user', content: 'json' }], {
    env: { DEEPSEEK_API_KEY: 'unit-test-secret' }, sleep: async () => {},
    fetchImpl: async () => { calls += 1; const error = new Error('aborted'); error.name = 'AbortError'; throw error; }
  }), error => error instanceof DeepSeekError && error.code === 'TIMEOUT');
  assert.equal(calls, 2);
});

test('DeepSeek malformed JSON and invalid schema are rejected', async () => {
  await assert.rejects(() => requestDeepSeek([{ role: 'user', content: 'json' }], {
    env: { DEEPSEEK_API_KEY: 'unit-test-secret' },
    fetchImpl: async () => ({ ok: true, status: 200, async json() { return { choices: [{ finish_reason: 'stop', message: { content: 'not-json' } }] }; } })
  }), error => error.code === 'INVALID_RESPONSE');
  assert.throws(() => validateSemanticPlan({ normalizedClaim: 'x', subclaims: [] }, 'x'), error => error.code === 'INVALID_RESPONSE');
});

test('model explanation must cite real evidence and cannot invent numeric facts', () => {
  const analysis = {
    claim: '测试命题', verdict: '命题不成立', summary: '收入增长17.04%，利润增长42.28%。',
    evidence: { support: [], oppose: [{ id: 'D1', finding: '17.04%低于42.28%', metrics: [] }], unknown: [] }
  };
  const accepted = validateExplanation({ explanation: '直接比较显示17.04%低于42.28%，因此命题不成立。', evidenceIds: ['D1'], suggestedQuestions: [] }, analysis);
  assert.deepEqual(accepted.evidenceIds, ['D1']);
  assert.throws(() => validateExplanation({ explanation: '另一指标增长99%。', evidenceIds: ['D1'] }, analysis), error => error.code === 'INVALID_RESPONSE');
  assert.throws(() => validateExplanation({ explanation: '命题不成立。', evidenceIds: ['FAKE'] }, analysis), error => error.code === 'INVALID_RESPONSE');
});

test('.env.local parser supports templates without logging or evaluating values', () => {
  const parsed = parseEnv('DEEPSEEK_API_KEY="secret"\n# comment\nDEEPSEEK_MODEL=deepseek-flash\n');
  assert.deepEqual(parsed, { DEEPSEEK_API_KEY: 'secret', DEEPSEEK_MODEL: 'deepseek-flash' });
});
