'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildAnalysis } = require('../lib/engine');
const { buildResearchTask } = require('../lib/research');

test('regression A: explicit cross-metric comparison is parsed and refuted by direct values', () => {
  const result = buildAnalysis('宁德时代2025年营业收入同比增速高于归母净利润同比增速。', '300750.SZ');
  assert.equal(result.needsClarification, false);
  assert.equal(result.parsedClaim.company.ticker, '300750.SZ');
  assert.equal(result.parsedClaim.period.current, '2025年度');
  assert.deepEqual(result.parsedClaim.metrics.map(item => item.key), ['revenue', 'netProfit']);
  assert.equal(result.parsedClaim.relationship.kind, 'greater-than');
  assert.equal(result.verdictKey, 'refuted');
  assert.equal(result.supported, false);
  assert.equal(result.calculations.leftGrowth, 17.04);
  assert.equal(result.calculations.rightGrowth, 42.28);
  assert.match(result.summary, /主营业务收入.*18\.07%/);
  assert.equal(result.evidence.support.length, 0);
  assert.equal(result.evidence.oppose[0].id, 'D1');
});

test('regression B: exclusive volume causality remains evidence-insufficient', () => {
  const result = buildAnalysis('宁德时代2025年归母净利润增长全部由主营业务销量增长驱动。', '300750.SZ');
  const task = buildResearchTask(result);
  assert.equal(result.needsClarification, false);
  assert.equal(result.parsedClaim.claimType, 'exclusive-causal');
  assert.equal(result.supported, false);
  assert.equal(result.verdictKey, 'insufficient-evidence');
  assert.match(result.summary, /不能证明|不得将整体命题标记为支持/);
  assert.ok(result.missingEvidence.some(item => /销量/.test(item.label)));
  assert.ok(result.missingEvidence.some(item => /利润桥/.test(item.label)));
  assert.ok(result.evidence.support.every(item => item.supportsWholeClaim === false));
  assert.deepEqual(task.conclusions[0].supportEvidenceIds, []);
  assert.deepEqual(task.conclusions[0].contextEvidenceIds, ['CTX1']);
  assert.equal(task.status, 'evidence-insufficient');
});

test('regression C: known request scope prevents redundant clarification', () => {
  const result = buildAnalysis('归母净利润同比增长。', '300750.SZ', { period: '2025年度 vs 2024年度' });
  assert.equal(result.needsClarification, false);
  assert.deepEqual(result.missingFields, []);
  assert.equal(result.parsedClaim.company.source, 'request-scope');
  assert.equal(result.parsedClaim.period.source, 'request-scope');
  assert.deepEqual(result.parsedClaim.metrics.map(item => item.key), ['netProfit']);
  assert.equal(result.verdictKey, 'supported');

  const actuallyMissing = buildAnalysis('归母净利润同比增长。', null);
  assert.deepEqual(actuallyMissing.missingFields.sort(), ['company', 'period']);
  assert.equal(actuallyMissing.clarifications.length, 2);
});

test('regression D: sequential claims generate isolated plans, evidence and task records', () => {
  const first = buildResearchTask(buildAnalysis('宁德时代2025年营业收入同比增速高于归母净利润同比增速。', '300750.SZ'));
  const second = buildResearchTask(buildAnalysis('宁德时代2025年归母净利润增长全部由主营业务销量增长驱动。', '300750.SZ'));
  assert.notEqual(first.id, second.id);
  assert.equal(first.conclusions[0].status, '命题不成立');
  assert.equal(second.conclusions[0].status, '证据不足，无法验证');
  assert.equal(second.thesis.original, '宁德时代2025年归母净利润增长全部由主营业务销量增长驱动。');
  assert.ok(second.subquestions.some(item => /销量、售价和产品结构/.test(item.question)));
  assert.ok(second.evidence.some(item => item.id === 'MISS1'));
  assert.ok(!second.evidence.some(item => item.id === 'D1'));
  assert.equal(second.analysis.verdictKey, 'insufficient-evidence');
});
