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
