'use strict';

const METRICS = [
  { key: 'adjustedNetProfit', label: '扣非归母净利润', patterns: [/扣非归母净利润/, /扣非净利润/] },
  { key: 'netProfit', label: '归母净利润', patterns: [/归母净利润/, /归属于[^，。；]*净利润/] },
  { key: 'mainRevenue', label: '主营业务收入', patterns: [/主营业务收入/, /主营收入/] },
  { key: 'revenue', label: '营业收入', patterns: [/营业收入/, /总营收/, /营收/] },
  { key: 'operatingCashFlow', label: '经营活动现金流净额', patterns: [/经营活动现金流(?:净额)?/, /经营现金流/] },
  { key: 'mainMargin', label: '主营业务毛利率', patterns: [/主营业务毛利率/, /主营毛利率/, /毛利率/] },
  { key: 'investmentIncome', label: '投资收益', patterns: [/投资收益/] },
  { key: 'nonRecurring', label: '非经常性损益', patterns: [/非经常性损益/, /非经损益/] },
  { key: 'salesVolume', label: '销量', patterns: [/销量/, /销售量/, /出货量/] },
  { key: 'price', label: '价格', patterns: [/售价/, /价格/, /涨价/, /平均单价/] },
  { key: 'productMix', label: '产品结构', patterns: [/产品结构/, /产品组合/] },
  { key: 'cost', label: '成本', patterns: [/单位成本/, /原材料成本/, /成本/] },
  { key: 'mainBusiness', label: '主营业务', patterns: [/主营业务/, /主营经营/] }
];

const OTHER_COMPANIES = [
  { name: '比亚迪', ticker: '002594.SZ', pattern: /比亚迪|BYD/i },
  { name: '贵州茅台', ticker: '600519.SH', pattern: /贵州茅台|茅台/ },
  { name: '小米集团', ticker: '01810.HK', pattern: /小米集团|小米/ },
  { name: '腾讯', ticker: '00700.HK', pattern: /腾讯/ },
  { name: '阿里巴巴', ticker: '09988.HK', pattern: /阿里巴巴/ }
];

function normalizeTicker(value) {
  const text = String(value || '').trim().toUpperCase();
  if (/^300750(?:\.SZ)?$/.test(text)) return '300750.SZ';
  if (/^\d{6}\.(?:SZ|SH)$/.test(text)) return text;
  if (/^\d{6}$/.test(text)) return `${text}.${/^(?:000|001|002|300)/.test(text) ? 'SZ' : 'SH'}`;
  return text || null;
}

function parseCompany(claim, inputCompany, data) {
  if (/宁德时代|CATL|300750(?:\.SZ)?/i.test(claim)) {
    return { name: data.company.name, ticker: data.company.ticker, source: 'claim', dataSupported: true };
  }
  const namedOther = OTHER_COMPANIES.find(item => item.pattern.test(claim));
  if (namedOther) return { ...namedOther, source: 'claim', dataSupported: false };
  const tickerMatch = claim.match(/\b((?:000|001|002|300|600|601|603|605|688)\d{3})(?:\.(SZ|SH))?\b/i);
  if (tickerMatch) {
    const ticker = normalizeTicker(`${tickerMatch[1]}${tickerMatch[2] ? `.${tickerMatch[2]}` : ''}`);
    return { name: ticker === data.company.ticker ? data.company.name : '未接入公司', ticker, source: 'claim', dataSupported: ticker === data.company.ticker };
  }
  const ticker = normalizeTicker(inputCompany);
  if (ticker) return { name: ticker === data.company.ticker ? data.company.name : '未接入公司', ticker, source: 'request-scope', dataSupported: ticker === data.company.ticker };
  return { name: null, ticker: null, source: null, dataSupported: false };
}

function parsePeriod(claim, contextPeriod, data) {
  const text = `${claim} ${contextPeriod || ''}`;
  const halfYear = text.match(/(20\d{2})年?(?:上半年|半年度)/);
  if (halfYear) {
    const year = Number(halfYear[1]);
    return {
      current: `${year}年上半年`, compare: `${year - 1}年上半年`, asOf: year === 2026 ? data.sources.find(source => source.id === 'half-year-report')?.publishedAt || null : null,
      source: claim.includes(halfYear[0]) ? 'claim' : 'request-scope', dataSupported: year === 2026
    };
  }
  const yearMatch = text.match(/(20\d{2})年/);
  if (yearMatch) {
    const year = Number(yearMatch[1]);
    return {
      current: `${year}年度`, compare: `${year - 1}年度`, asOf: year === 2025 ? data.period.asOf : null,
      source: claim.includes(yearMatch[0]) ? 'claim' : 'request-scope', dataSupported: year === 2025
    };
  }
  return { current: null, compare: null, asOf: null, source: null, dataSupported: false };
}

function findMetrics(claim, contextMetrics = []) {
  const explicit = [];
  for (const definition of METRICS) {
    let bestIndex = Infinity;
    for (const pattern of definition.patterns) {
      const match = pattern.exec(claim);
      if (match && match.index < bestIndex) bestIndex = match.index;
    }
    if (bestIndex !== Infinity) explicit.push({ key: definition.key, label: definition.label, source: 'claim', index: bestIndex });
  }
  explicit.sort((a, b) => a.index - b.index);
  let unique = explicit.filter((item, index, items) => items.findIndex(candidate => candidate.key === item.key) === index);
  if (unique.some(item => item.key === 'mainRevenue')) {
    const withoutMainRevenue = claim.replace(/主营业务收入|主营收入/g, '');
    if (!/营业收入|总营收|营收/.test(withoutMainRevenue)) unique = unique.filter(item => item.key !== 'revenue');
  }
  if (unique.some(item => item.key === 'adjustedNetProfit')) {
    const withoutAdjusted = claim.replace(/扣非归母净利润|扣非净利润/g, '');
    if (!/归母净利润|归属于[^，。；]*净利润/.test(withoutAdjusted)) unique = unique.filter(item => item.key !== 'netProfit');
  }
  if (!unique.some(item => ['netProfit', 'adjustedNetProfit'].includes(item.key)) && /盈利改善|利润增长|利润改善/.test(claim)) {
    unique.unshift({ key: 'netProfit', label: '归母净利润', source: 'inferred-from-profit-claim', index: -1 });
  }
  if (Array.isArray(contextMetrics)) {
    for (const value of contextMetrics) {
      const definition = METRICS.find(item => item.patterns.some(pattern => pattern.test(String(value))));
      if (definition && !unique.some(item => item.key === definition.key)) {
        unique.push({ key: definition.key, label: definition.label, source: 'clarification', index: unique.length });
      }
    }
  }
  return unique.map(({ index, ...item }) => item);
}

function parseRelationship(claim, metricCount) {
  if (/全部由|完全由|全部来自|完全来自|唯一(?:由|来自)|仅由/.test(claim)) return { kind: 'exclusive-causal', label: '排他性因果归因' };
  if (/主要由|主要来自|驱动|归因|导致|贡献/.test(claim)) return { kind: 'causal', label: '因果归因' };
  if (/不低于/.test(claim)) return { kind: 'at-least', label: '不低于' };
  if (/不超过/.test(claim)) return { kind: 'at-most', label: '不超过' };
  if (/高于|快于|大于|超过/.test(claim)) return { kind: metricCount >= 2 ? 'greater-than' : 'threshold-greater-than', label: '高于' };
  if (/低于|慢于|小于/.test(claim)) return { kind: metricCount >= 2 ? 'less-than' : 'threshold-less-than', label: '低于' };
  if (/匹配|一致|同步/.test(claim)) return { kind: 'alignment', label: '匹配性' };
  if (/下降|下滑|减少|转负/.test(claim)) return { kind: 'decrease', label: '下降' };
  if (/增长|上升|改善|同比/.test(claim)) return { kind: 'increase', label: '增长' };
  return { kind: null, label: null };
}

function parseThesis(claimInput, context, data) {
  const claim = String(claimInput || '').trim();
  const company = parseCompany(claim, context.company, data);
  const period = parsePeriod(claim, context.period, data);
  const metrics = findMetrics(claim, context.metrics);
  const relationship = parseRelationship(claim, metrics.length);
  const missingFields = [];
  if (!company.ticker) missingFields.push('company');
  if (!period.current) missingFields.push('period');
  if (!metrics.length) missingFields.push('metrics');
  const numericThreshold = /-?\d+(?:\.\d+)?\s*%/.test(claim);
  if (metrics.length === 1 && ['threshold-greater-than', 'threshold-less-than'].includes(relationship.kind) && !numericThreshold) missingFields.push('metrics');
  if (!relationship.kind) missingFields.push('relationship');

  let claimType = 'unsupported';
  const metricKeys = metrics.map(item => item.key);
  if (relationship.kind === 'exclusive-causal') claimType = 'exclusive-causal';
  else if (relationship.kind === 'causal') claimType = 'causal-attribution';
  else if (metricKeys.includes('operatingCashFlow') && metricKeys.some(key => ['netProfit', 'adjustedNetProfit'].includes(key)) && relationship.kind === 'alignment') claimType = 'cashflow-alignment';
  else if (metrics.length >= 2 && ['greater-than', 'less-than'].includes(relationship.kind)) claimType = 'metric-comparison';
  else if (metrics.length === 1 && ['threshold-greater-than', 'threshold-less-than', 'at-least', 'at-most'].includes(relationship.kind)) claimType = 'metric-threshold';
  else if (metrics.length >= 2 && ['increase', 'decrease'].includes(relationship.kind) && /但|而|同时|且|并且/.test(claim)) claimType = 'compound-metric-change';
  else if (metrics.length >= 1 && ['increase', 'decrease'].includes(relationship.kind)) claimType = 'metric-change';

  return { claim, company, period, metrics, relationship, claimType, missingFields };
}

module.exports = { METRICS, normalizeTicker, parseThesis };
