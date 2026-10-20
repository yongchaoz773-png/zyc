'use strict';

function assertNumber(value, field) {
  if (value === null || value === undefined || value === '') {
    return { ok: false, code: 'MISSING_VALUE', message: `${field}缺失` };
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return { ok: false, code: 'INVALID_NUMBER', message: `${field}必须是有限数值` };
  }
  return { ok: true, value };
}

function calculateYoY(current, previous, options = {}) {
  const currentCheck = assertNumber(current, '本期值');
  const previousCheck = assertNumber(previous, '上年同期值');
  if (!currentCheck.ok) return currentCheck;
  if (!previousCheck.ok) return previousCheck;
  if (options.currentPeriodType && options.previousPeriodType && options.currentPeriodType !== options.previousPeriodType) {
    return { ok: false, code: 'PERIOD_MISMATCH', message: '累计期间与单季度数据不可直接计算同比' };
  }
  if (options.currentUnit && options.previousUnit && options.currentUnit !== options.previousUnit) {
    return { ok: false, code: 'UNIT_MISMATCH', message: '本期与同期单位不一致' };
  }
  if (previous === 0) return { ok: false, code: 'ZERO_BASE', message: '上年同期基数为零，改为展示金额变化' };
  if (previous < 0) {
    return {
      ok: false,
      code: current >= 0 ? 'TURNAROUND' : 'NEGATIVE_BASE',
      message: current >= 0 ? '指标由负转正，不机械计算同比增速' : '上年同期为负数，不机械计算普通同比',
      delta: current - previous
    };
  }
  return { ok: true, value: ((current - previous) / previous) * 100, unit: '%' };
}

function calculateMargin(revenue, cost, options = {}) {
  const r = assertNumber(revenue, '收入');
  const c = assertNumber(cost, '成本');
  if (!r.ok) return r;
  if (!c.ok) return c;
  if (revenue === 0) return { ok: false, code: 'ZERO_REVENUE', message: '收入为零，无法计算毛利率' };
  if (options.revenueUnit && options.costUnit && options.revenueUnit !== options.costUnit) {
    return { ok: false, code: 'UNIT_MISMATCH', message: '收入与成本单位不一致' };
  }
  return { ok: true, value: ((revenue - cost) / revenue) * 100, unit: '%' };
}

function calculatePercentagePointChange(currentPercent, previousPercent) {
  const a = assertNumber(currentPercent, '本期百分比');
  const b = assertNumber(previousPercent, '同期百分比');
  if (!a.ok) return a;
  if (!b.ok) return b;
  return { ok: true, value: currentPercent - previousPercent, unit: '百分点' };
}

function validateReportedGrowth(current, previous, reported, tolerance = 0.02) {
  const calculated = calculateYoY(current, previous);
  if (!calculated.ok) return calculated;
  const check = assertNumber(reported, '披露增速');
  if (!check.ok) return check;
  const difference = Math.abs(calculated.value - reported);
  return {
    ok: difference <= tolerance,
    code: difference <= tolerance ? 'MATCH' : 'REPORTED_MISMATCH',
    calculated: calculated.value,
    reported,
    difference,
    message: difference <= tolerance ? '披露值与重算结果一致' : '披露值与重算结果不一致，请检查单位、期间或重述'
  };
}

module.exports = { calculateYoY, calculateMargin, calculatePercentagePointChange, validateReportedGrowth };
