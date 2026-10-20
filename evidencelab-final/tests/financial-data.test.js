'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const handler = require('../api/financial-data');
const { FinancialDataError, getFinancialData, loadSnapshot, normalizeFacts, publicDisclosureProvider, resetRuntimeForTests } = require('../lib/financial-data');

function response(status = 200) { return { ok: status >= 200 && status < 300, status }; }
function invoke(req) {
  return new Promise((resolve, reject) => {
    const res = { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(body) { try { resolve({ status: this.statusCode, body: JSON.parse(body) }); } catch (error) { reject(error); } } };
    Promise.resolve(handler(req, res)).catch(reject);
  });
}

test('financial snapshot normalizes every metric into traceable current and comparison facts', () => {
  const snapshot = loadSnapshot();
  const facts = normalizeFacts(snapshot);
  assert.equal(facts.length, Object.keys(snapshot.metrics).length * 2);
  for (const fact of facts) {
    for (const key of ['evidenceId', 'companyCode', 'metric', 'value', 'unit', 'period', 'accountingScope', 'sourceName', 'sourceUrl', 'publishedAt', 'fetchedAt', 'dataMode']) {
      assert.notEqual(fact[key], undefined, `${key} is required`);
    }
    assert.equal(fact.dataMode, 'snapshot');
  }
});

test('financial adapter rejects uncovered company and period instead of reusing CATL data', async () => {
  await assert.rejects(() => getFinancialData({ company: '600000.SH' }), error => error instanceof FinancialDataError && error.code === 'DATA_SCOPE_NOT_COVERED');
  await assert.rejects(() => getFinancialData({ company: '300750.SZ', period: '2023年度' }), error => error instanceof FinancialDataError && error.code === 'PERIOD_NOT_COVERED');
});

test('provider company search and disclosure lookup expose only covered snapshot scope', () => {
  assert.equal(publicDisclosureProvider.searchCompanies('300750').length, 1);
  assert.equal(publicDisclosureProvider.searchCompanies('600000').length, 0);
  const disclosures = publicDisclosureProvider.getDisclosures('宁德时代');
  assert.ok(disclosures.length >= 2);
  assert.ok(disclosures.every(item => item.url && item.publishedAt && item.dataMode === 'source-document-link'));
});

test('source refresh verifies URLs, caches checks, but keeps structured values in snapshot mode', async () => {
  resetRuntimeForTests();
  let calls = 0;
  const fetchImpl = async () => { calls += 1; return response(200); };
  const first = await getFinancialData({ refresh: true, fetchImpl });
  const second = await getFinancialData({ refresh: true, fetchImpl });
  assert.equal(first.status.mode, 'source-verified-snapshot');
  assert.equal(first.status.structuredOnlineData, false);
  assert.ok(first.facts.every(fact => fact.dataMode === 'snapshot'));
  assert.equal(second.status.sourceVerification, 'cached-success');
  assert.equal(calls, first.sources.length);
});

test('source verification failure explicitly falls back to snapshot', async () => {
  resetRuntimeForTests();
  let calls = 0;
  const result = await getFinancialData({ refresh: true, fetchImpl: async () => { calls += 1; throw new Error('offline'); } });
  assert.equal(result.status.mode, 'snapshot');
  assert.equal(result.status.fallbackUsed, true);
  assert.equal(result.status.sourceVerification, 'failed');
  assert.ok(result.sourceChecks.every(item => item.available === false));
  assert.equal(calls, result.sources.length * 2);
});

test('source verification timeout is bounded and reported without changing snapshot facts', async () => {
  resetRuntimeForTests();
  const fetchImpl = async (_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => { const error = new Error('aborted'); error.name = 'AbortError'; reject(error); });
  });
  const result = await getFinancialData({ refresh: true, timeoutMs: 1, fetchImpl });
  assert.equal(result.status.fallbackUsed, true);
  assert.ok(result.sourceChecks.every(item => item.reason === 'timeout' && item.attempts === 2));
  assert.ok(result.facts.every(item => item.dataMode === 'snapshot'));
});

test('malformed snapshot source references fail schema normalization explicitly', () => {
  const snapshot = loadSnapshot();
  snapshot.metrics.revenue.sourceId = 'missing-source';
  assert.throws(() => normalizeFacts(snapshot), error => error instanceof FinancialDataError && error.code === 'INVALID_SNAPSHOT');
});

test('financial data Function returns facts and strict no-data errors', async () => {
  const ok = await invoke({ method: 'GET', query: { company: '300750.SZ' }, headers: {} });
  assert.equal(ok.status, 200);
  assert.ok(ok.body.facts.length > 0);
  const miss = await invoke({ method: 'GET', query: { company: '600000.SH' }, headers: {} });
  assert.equal(miss.status, 404);
  assert.equal(miss.body.error, 'DATA_SCOPE_NOT_COVERED');
});
