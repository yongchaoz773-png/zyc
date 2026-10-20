const test = require('node:test');
const assert = require('node:assert/strict');
const analyze = require('../api/analyze');
const followup = require('../api/followup');

function invoke(handler, req) {
  return new Promise((resolve, reject) => {
    const res = {
      statusCode: 200,
      headers: {},
      setHeader(name, value) { this.headers[name] = value; },
      end(body) { try { resolve({ status: this.statusCode, body: JSON.parse(body) }); } catch (error) { reject(error); } }
    };
    Promise.resolve(handler(req, res)).catch(reject);
  });
}

test('analyze API rejects empty and overlong claims', async () => {
  const empty = await invoke(analyze, { method: 'POST', query: {}, body: { claim: '' } });
  assert.equal(empty.status, 400);
  assert.equal(empty.body.error, 'EMPTY_CLAIM');
  const long = await invoke(analyze, { method: 'POST', query: {}, body: { claim: 'a'.repeat(1201) } });
  assert.equal(long.status, 413);
  assert.equal(long.body.error, 'CLAIM_TOO_LONG');
});

test('analyze API returns schema-v2 traceable task', async () => {
  const result = await invoke(analyze, { method: 'POST', query: {}, body: { claim: '宁德时代2025年盈利改善主要来自主营业务，而非非经常性损益。', company: '300750.SZ' } });
  assert.equal(result.status, 200);
  assert.equal(result.body.researchTask.schemaVersion, 2);
  assert.equal(result.body.researchTask.evidence.length, 8);
  assert.equal(result.body.researchTask.conflicts.length, 1);
  assert.equal(result.body.financialData.facts.length, 18);
  assert.equal(result.body.researchTask.dataSnapshot.facts.length, 18);
  assert.equal(result.body.researchTask.dataSnapshot.structuredOnlineData, false);
});

test('analyze API carries company, period and multiple metric scope into parsing', async () => {
  const result = await invoke(analyze, {
    method: 'POST', query: {}, body: {
      claim: '前者同比增速高于后者。',
      company: '300750.SZ',
      period: '2025年度 vs 2024年度',
      metrics: ['营业收入', '归母净利润']
    }
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.needsClarification, false);
  assert.deepEqual(result.body.parsedClaim.metrics.map(item => item.key), ['revenue', 'netProfit']);
  assert.equal(result.body.verdictKey, 'refuted');
  assert.equal(result.body.researchTask.conclusions[0].status, '命题不成立');
});

for (const [code, status, error] of [
  ['401', 401, 'AUTH_REQUIRED'], ['403', 403, 'PERMISSION_DENIED'], ['429', 429, 'RATE_LIMITED'],
  ['500', 500, 'UPSTREAM_ERROR'], ['503', 503, 'UPSTREAM_UNAVAILABLE'], ['empty', 502, 'EMPTY_DATA'], ['schema', 502, 'INVALID_PROVIDER_SCHEMA']
]) {
  test(`analyze API maps simulated ${code} without treating it as opposition`, async () => {
    const result = await invoke(analyze, { method: 'POST', query: { simulate: code }, body: { claim: 'x' } });
    assert.equal(result.status, status);
    assert.equal(result.body.error, error);
    assert.equal(result.body.evidenceImpact, 'unknown-not-opposition');
  });
}

test('follow-up cites evidence when covered and admits insufficiency when not covered', async () => {
  const covered = await invoke(followup, { method: 'POST', body: { question: '投资收益对利润归因有什么影响？' } });
  assert.deepEqual(covered.body.citations, ['O1', 'O2', 'S2', 'S3']);
  const uncovered = await invoke(followup, { method: 'POST', body: { question: '海外市占率会怎样？' } });
  assert.equal(uncovered.body.evidenceBounded, false);
  assert.ok(uncovered.body.missingInformation.length > 0);
});

function semanticResponse() {
  return {
    normalizedClaim: '宁德时代营业收入增速高于归母净利润增速',
    entities: { company: '宁德时代', ticker: '300750.SZ', reportPeriod: '2025年度', comparisonPeriod: '2024年度', metrics: ['营业收入', '归母净利润'], relationship: '高于' },
    claimType: 'metric-comparison',
    subclaims: [{ id: 'llm-q1', text: '比较同口径同比增速', claimType: 'metric-comparison', requiredMetrics: ['营业收入', '归母净利润'], requiredEvidence: ['年度报告'] }],
    ambiguities: [], missingFields: [], needsClarification: false, suggestedQuestions: []
  };
}

function mockDeepSeekResponse(content, status = 200) {
  return {
    ok: status === 200, status,
    async json() { return status === 200 ? { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(content) } }] } : { error: { message: 'redacted' } }; }
  };
}

test('analyze API reports explicit rule fallback when DeepSeek is not configured', async () => {
  const previous = process.env.DEEPSEEK_API_KEY;
  delete process.env.DEEPSEEK_API_KEY;
  try {
    const result = await invoke(analyze, { method: 'POST', query: {}, body: { claim: '宁德时代2025年营业收入同比增速高于归母净利润同比增速。', company: '300750.SZ' } });
    assert.equal(result.status, 200);
    assert.equal(result.body.mode, 'rules_only');
    assert.equal(result.body.llmStatus.configured, false);
    assert.equal(result.body.llmStatus.fallbackUsed, true);
    assert.equal(result.body.verdictKey, 'refuted');
  } finally {
    if (previous === undefined) delete process.env.DEEPSEEK_API_KEY; else process.env.DEEPSEEK_API_KEY = previous;
  }
});

test('analyze API uses validated DeepSeek structure but preserves the rule verdict', async () => {
  const previousKey = process.env.DEEPSEEK_API_KEY;
  const previousModel = process.env.DEEPSEEK_MODEL;
  const previousFetch = global.fetch;
  process.env.DEEPSEEK_API_KEY = 'unit-test-secret';
  process.env.DEEPSEEK_MODEL = 'deepseek-flash';
  let calls = 0;
  global.fetch = async () => {
    calls += 1;
    return calls === 1
      ? mockDeepSeekResponse(semanticResponse())
      : mockDeepSeekResponse({ explanation: '直接比较表明该命题不成立。', evidenceIds: ['D1'], suggestedQuestions: ['两个指标口径是否一致？'] });
  };
  try {
    const result = await invoke(analyze, { method: 'POST', query: {}, body: { claim: '宁德时代2025年营业收入同比增速高于归母净利润同比增速。', company: '300750.SZ' } });
    assert.equal(result.status, 200);
    assert.equal(result.body.mode, 'deepseek+rules');
    assert.equal(result.body.llmStatus.connection, 'verified-this-request');
    assert.equal(result.body.llmStatus.explanation, 'success');
    assert.equal(result.body.verdictKey, 'refuted');
    assert.deepEqual(result.body.modelExplanation.evidenceIds, ['D1']);
    assert.equal(calls, 2);
    assert.equal(JSON.stringify(result.body).includes('unit-test-secret'), false);
  } finally {
    global.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.DEEPSEEK_API_KEY; else process.env.DEEPSEEK_API_KEY = previousKey;
    if (previousModel === undefined) delete process.env.DEEPSEEK_MODEL; else process.env.DEEPSEEK_MODEL = previousModel;
  }
});

test('analyze API degrades on invalid DeepSeek credentials without changing evidence direction', async () => {
  const previousKey = process.env.DEEPSEEK_API_KEY;
  const previousFetch = global.fetch;
  process.env.DEEPSEEK_API_KEY = 'invalid-unit-test-key';
  global.fetch = async () => mockDeepSeekResponse({}, 401);
  try {
    const result = await invoke(analyze, { method: 'POST', query: {}, body: { claim: '宁德时代2025年归母净利润增长全部由主营业务销量增长驱动。', company: '300750.SZ' } });
    assert.equal(result.status, 200);
    assert.equal(result.body.mode, 'rules_only');
    assert.equal(result.body.llmStatus.errorCode, 'AUTH_FAILED');
    assert.equal(result.body.llmStatus.fallbackUsed, true);
    assert.equal(result.body.verdictKey, 'insufficient-evidence');
  } finally {
    global.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.DEEPSEEK_API_KEY; else process.env.DEEPSEEK_API_KEY = previousKey;
  }
});
