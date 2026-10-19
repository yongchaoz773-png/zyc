const test = require('node:test');
const assert = require('node:assert/strict');
const { buildAnalysis, buildPeriodComparison, answerFollowup, loadData } = require('../lib/engine');

test('dataset includes a traceable primary report URL', () => {
  const data = loadData();
  const source = data.sources.find(s => s.id === 'annual-report');
  assert.ok(source);
  assert.match(source.url, /cninfo\.com\.cn/);
  assert.equal(data.metrics.adjustedNetProfit.growth, 43.37);
});

test('known CATL thesis produces support, opposition and unknown evidence', () => {
  const result = buildAnalysis('宁德时代2025年盈利改善主要来自主营业务，而非非经常性损益。', '300750.SZ');
  assert.equal(result.supported, true);
  assert.equal(result.verdictKey, 'qualified-support');
  assert.ok(result.evidence.support.length >= 3);
  assert.ok(result.evidence.oppose.length >= 1);
  assert.ok(result.evidence.unknown.length >= 1);
  assert.ok(result.changeConditions.length >= 3);
});

test('unknown company or unsupported claim does not fabricate evidence', () => {
  const result = buildAnalysis('某公司估值回落但基本面未恶化。', '600000.SH');
  assert.equal(result.supported, false);
  assert.equal(result.verdict, '暂无法验证');
  assert.equal(result.evidence.support.length, 0);
  assert.ok(result.clarifications.length >= 2);
});


test('explicitly named unsupported company never receives CATL evidence', () => {
  const result = buildAnalysis('比亚迪2025年盈利改善主要来自主营业务。', '300750.SZ');
  assert.equal(result.supported, false);
  assert.equal(result.evidence.support.length, 0);
});

test('period comparison preserves cash-flow divergence as a caveat', () => {
  const result = buildPeriodComparison();
  assert.equal(result.metrics.find(m => m.label === '经营活动现金流净额').growth, 2.61);
  assert.match(result.insight, /现金流/);
});


test('cash-flow thesis exposes current-period divergence instead of reusing the main-business verdict', () => {
  const result = buildAnalysis('宁德时代2025年经营现金流与利润增长是否匹配？', '300750.SZ');
  assert.equal(result.verdictKey, 'mixed');
  assert.match(result.summary, /2\.61%/);
  assert.ok(result.evidence.oppose.some(e => /现金流增速/.test(e.title)));
});

test('follow-up answers remain bounded to available evidence', () => {
  const answer = answerFollowup('如果投资收益占比继续上升，会改变结论吗？');
  assert.match(answer, /99\.87%/);
  assert.match(answer, /30%/);
});
