const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateYoY, calculateMargin, calculatePercentagePointChange, validateReportedGrowth } = require('../lib/finance');

test('normal YoY growth is calculated as a percentage', () => {
  const result = calculateYoY(120, 100, { currentUnit: '千元', previousUnit: '千元' });
  assert.equal(result.ok, true);
  assert.equal(result.value, 20);
});

test('zero base and missing values are rejected', () => {
  assert.equal(calculateYoY(10, 0).code, 'ZERO_BASE');
  assert.equal(calculateYoY(null, 10).code, 'MISSING_VALUE');
});

test('negative base and turnaround do not use ordinary growth formula', () => {
  assert.equal(calculateYoY(-5, -10).code, 'NEGATIVE_BASE');
  assert.equal(calculateYoY(5, -10).code, 'TURNAROUND');
});

test('period and unit mismatches are rejected', () => {
  assert.equal(calculateYoY(120, 100, { currentPeriodType: 'single-quarter', previousPeriodType: 'cumulative' }).code, 'PERIOD_MISMATCH');
  assert.equal(calculateYoY(120, 100, { currentUnit: '元', previousUnit: '千元' }).code, 'UNIT_MISMATCH');
  assert.equal(calculateMargin(120, 80, { revenueUnit: '元', costUnit: '千元' }).code, 'UNIT_MISMATCH');
});

test('margin and percentage-point change are distinguished', () => {
  assert.equal(calculateMargin(200, 150).value, 25);
  const pp = calculatePercentagePointChange(25, 22.5);
  assert.equal(pp.value, 2.5);
  assert.equal(pp.unit, '百分点');
});

test('reported growth is cross-checked against raw values', () => {
  assert.equal(validateReportedGrowth(120, 100, 20).code, 'MATCH');
  assert.equal(validateReportedGrowth(120, 100, 18).code, 'REPORTED_MISMATCH');
});
