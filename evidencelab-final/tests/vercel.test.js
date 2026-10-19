'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const analyze = require('../api/analyze');
const compare = require('../api/compare');
const followup = require('../api/followup');
const health = require('../api/health');

function invoke(handler, request = {}) {
  const req = { method: 'GET', query: {}, headers: {}, ...request };
  return new Promise((resolve, reject) => {
    const res = {
      statusCode: 200,
      headers: {},
      setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
      end(body = '') {
        try { resolve({ status: this.statusCode, headers: this.headers, body: body ? JSON.parse(body) : null }); }
        catch (error) { reject(error); }
      }
    };
    Promise.resolve(handler(req, res)).catch(reject);
  });
}

test('Vercel-shaped requests reach all four API Functions', async () => {
  const results = await Promise.all([
    invoke(health),
    invoke(analyze, { method: 'POST', body: { claim: '宁德时代2025年盈利改善主要来自主营业务，而非非经常性损益。' } }),
    invoke(compare),
    invoke(followup, { method: 'POST', body: { question: '现金流如何？' } })
  ]);
  assert.deepEqual(results.map(item => item.status), [200, 200, 200, 200]);
  assert.equal(results[0].body.dataFreshness, 'non-real-time');
  assert.equal(results[1].body.researchTask.schemaVersion, 2);
  assert.equal(results[2].body.metrics.length, 4);
  assert.deepEqual(results[3].body.citations, ['S4', 'U2']);
});

test('Vercel string bodies are parsed consistently', async () => {
  const result = await invoke(followup, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ question: '投资收益是否影响归因？' })
  });
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.citations, ['O1', 'O2', 'S2', 'S3']);
});

test('malformed JSON and non-object JSON return explicit 400 errors', async () => {
  const malformed = await invoke(analyze, { method: 'POST', body: '{bad json' });
  assert.equal(malformed.status, 400);
  assert.equal(malformed.body.error, 'INVALID_JSON');
  const array = await invoke(followup, { method: 'POST', body: '[]' });
  assert.equal(array.status, 400);
  assert.equal(array.body.error, 'INVALID_REQUEST');
});

test('oversized Vercel requests are rejected before business logic', async () => {
  const result = await invoke(analyze, {
    method: 'POST',
    headers: { 'content-length': '100001' },
    body: { claim: 'x' }
  });
  assert.equal(result.status, 413);
  assert.equal(result.body.error, 'PAYLOAD_TOO_LARGE');
});

test('method guards are consistent across Functions', async () => {
  const results = await Promise.all([
    invoke(health, { method: 'POST' }),
    invoke(compare, { method: 'DELETE' }),
    invoke(followup, { method: 'GET' }),
    invoke(analyze, { method: 'DELETE' })
  ]);
  assert.deepEqual(results.map(item => item.status), [405, 405, 405, 405]);
});
