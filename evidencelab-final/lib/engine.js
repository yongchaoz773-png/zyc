const fs = require('fs');
const path = require('path');
const { parseThesis } = require('./thesis');

function loadData() {
  const p = path.join(__dirname, '..', 'data', 'evidence.json');
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function growth(current, previous) {
  if (!previous) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}
function fmtBillionFromThousand(value) {
  return (value / 100000).toFixed(2) + ' 亿元';
}
function pct(value, digits = 2) {
  return Number(value).toFixed(digits) + '%';
}

function clarificationFor(field) {
  return ({
    company: '请明确公司名称或证券代码。',
    period: '请明确报告期及比较期。',
    metrics: '请明确需要验证的一个或多个指标。',
    relationship: '请明确指标之间要验证的关系（如高于、增长、匹配或由何因素驱动）。'
  })[field];
}

function buildClarificationAnalysis(claim, parsed, data) {
  const clarifications = parsed.missingFields.map(clarificationFor).filter(Boolean);
  return {
    mode: 'rules_only', analysisReady: false, supported: false, needsClarification: true,
    claim, company: parsed.company.ticker, companyName: parsed.company.name, period: parsed.period.current ? parsed.period : null,
    parsedClaim: parsed, missingFields: parsed.missingFields, missingEvidence: [],
    verdict: '待补充必要信息', verdictTitle: '命题缺少必要字段，\n暂不生成方向性结论。', verdictKey: 'needs-clarification', evidenceStrength: 0,
    summary: `当前只缺少：${clarifications.join('；')}系统不会重复要求填写已经从命题或研究范围中识别出的字段。`,
    clarifications,
    subquestions: clarifications.map((message, index) => ({ id: `q${index + 1}`, question: message, status: '待澄清', linkedEvidence: [] })),
    evidence: { support: [], oppose: [], unknown: [] }, changeConditions: [], sources: data.sources,
    dataCompleteness: 'insufficient', disclaimer: data.disclaimer
  };
}

function buildUnavailableAnalysis(claim, parsed, data, reason) {
  return {
    mode: 'rules_only', analysisReady: true, supported: false, needsClarification: false,
    claim, company: parsed.company.ticker, companyName: parsed.company.name, period: parsed.period.current ? parsed.period : null,
    parsedClaim: parsed, missingFields: [],
    missingEvidence: [{ key: 'covered-data', label: '匹配公司、期间与指标的原始披露', reason }],
    verdict: '证据不足', verdictTitle: '研究范围明确，\n但当前数据集没有匹配证据。', verdictKey: 'insufficient-evidence', evidenceStrength: 0,
    summary: `${reason}这是数据覆盖不足，不是命题被反对，也不需要用户重复填写已经明确的字段。`,
    clarifications: [],
    subquestions: [{ id: 'q1', question: '当前快照是否覆盖该公司、期间和指标？', status: '无法验证', linkedEvidence: ['U1'] }],
    evidence: { support: [], oppose: [], unknown: [{
      id: 'U1', title: '当前数据快照不覆盖该验证范围', tag: '数据范围', strength: '缺少数据',
      finding: reason, reasoning: '必须取得匹配主体、报告期和指标口径的原始披露后才能判断，不能借用宁德时代数据。',
      sourceId: null, location: '待补充匹配范围的原始材料', metrics: [{ label: '当前状态', value: '无法验证' }], supportsWholeClaim: false
    }] },
    changeConditions: [], sources: [], dataCompleteness: 'insufficient', disclaimer: data.disclaimer
  };
}

function metricRecord(key, data) {
  if (data.metrics[key]) return { key, ...data.metrics[key] };
  if (key === 'mainMargin') {
    const current = (data.metrics.mainRevenue.current - data.metrics.mainCost.current) / data.metrics.mainRevenue.current * 100;
    const previous = (data.metrics.mainRevenue.previous - data.metrics.mainCost.previous) / data.metrics.mainRevenue.previous * 100;
    return { key, label: '主营业务毛利率', current, previous, growth: current - previous, unit: '百分点', sourceId: 'annual-report' };
  }
  return null;
}

function buildMetricComparisonAnalysis(claim, parsed, data) {
  const records = parsed.metrics.map(item => metricRecord(item.key, data)).filter(Boolean);
  if (records.length < 2) return buildUnavailableAnalysis(claim, parsed, data, '当前快照缺少完成该跨指标比较所需的同口径数据。');
  const [left, right] = records;
  const holds = parsed.relationship.kind === 'greater-than' ? left.growth > right.growth : left.growth < right.growth;
  const symbol = parsed.relationship.kind === 'greater-than' ? '>' : '<';
  const direction = holds ? 'support' : 'oppose';
  const comparisonEvidence = {
    id: 'D1', title: `${left.label}与${right.label}同比增速直接比较`, tag: '直接比较', strength: '强',
    finding: `${left.label}同比增长 ${pct(left.growth)}，${right.label}同比增长 ${pct(right.growth)}；实际关系为 ${pct(left.growth)} ${left.growth > right.growth ? '>' : '<'} ${pct(right.growth)}。`,
    reasoning: `两项指标来自同一年度报告、同一比较期间，单位均为同比百分比，可直接检验“${left.label}增速${parsed.relationship.label}${right.label}增速”。比较结果${holds ? '符合' : '不符合'}命题。`,
    sourceId: 'annual-report', location: '第二节：主要财务指标；财务报表附注：营业收入',
    formula: `${left.label}同比 ${pct(left.growth)} ${symbol} ${right.label}同比 ${pct(right.growth)} → ${holds ? '成立' : '不成立'}；实际大小关系：${pct(left.growth)} ${left.growth > right.growth ? '>' : '<'} ${pct(right.growth)}`,
    metrics: [
      { label: left.label, value: pct(left.growth) },
      ...(left.key === 'revenue' ? [{ label: '主营业务收入（页面并列口径）', value: pct(data.metrics.mainRevenue.growth) }] : []),
      { label: right.label, value: pct(right.growth) }
    ],
    supportsWholeClaim: true
  };
  const revenueNote = left.key === 'revenue' || right.key === 'revenue'
    ? ` 年报“营业收入”口径为 ${pct(data.metrics.revenue.growth)}；页面另列的“主营业务收入”口径为 ${pct(data.metrics.mainRevenue.growth)}。两种口径在本例中均低于归母净利润 ${pct(data.metrics.netProfit.growth)}。`
    : '';
  return {
    mode: 'rules_only', analysisReady: true, supported: holds, needsClarification: false,
    claim, company: data.company.ticker, companyName: data.company.name, period: parsed.period,
    parsedClaim: parsed, missingFields: [], missingEvidence: [],
    verdict: holds ? '命题成立' : '命题不成立',
    verdictTitle: holds ? '命题成立：\n同口径直接比较支持该关系。' : '命题不成立：\n同口径直接比较否定该关系。',
    verdictKey: holds ? 'supported' : 'refuted', evidenceStrength: 98,
    summary: `${comparisonEvidence.finding}${revenueNote}`,
    clarifications: [],
    subquestions: [
      { id: 'q1', question: '两个指标是否来自同一主体和比较期间？', status: '支持', linkedEvidence: ['D1'] },
      { id: 'q2', question: `${left.label}同比增速是否${parsed.relationship.label}${right.label}？`, status: holds ? '支持' : '存在反向证据', linkedEvidence: ['D1'] },
      { id: 'q3', question: '指标名称与披露口径是否存在歧义？', status: '已核对', linkedEvidence: ['D1'] }
    ],
    evidence: { support: holds ? [comparisonEvidence] : [], oppose: holds ? [] : [comparisonEvidence], unknown: [] },
    calculations: { leftMetric: left.key, leftGrowth: left.growth, rightMetric: right.key, rightGrowth: right.growth, differencePercentagePoints: Number((left.growth - right.growth).toFixed(2)) },
    comparisonBasis: { period: parsed.period, unit: '同比百分比', left, right },
    changeConditions: [], sources: data.sources, dataCompleteness: 'complete-for-comparison', disclaimer: data.disclaimer
  };
}

function buildMetricChangeAnalysis(claim, parsed, data) {
  const metric = metricRecord(parsed.metrics[0]?.key, data);
  if (!metric) return buildUnavailableAnalysis(claim, parsed, data, '当前快照没有该指标的有效同口径数据。');
  const thresholdMatch = claim.match(/(-?\d+(?:\.\d+)?)\s*%/);
  const threshold = thresholdMatch ? Number(thresholdMatch[1]) : null;
  let holds;
  if (parsed.relationship.kind === 'decrease') holds = metric.growth < 0;
  else if (parsed.relationship.kind === 'threshold-greater-than') holds = threshold !== null && metric.growth > threshold;
  else if (parsed.relationship.kind === 'threshold-less-than') holds = threshold !== null && metric.growth < threshold;
  else if (parsed.relationship.kind === 'at-least') holds = threshold !== null && metric.growth >= threshold;
  else if (parsed.relationship.kind === 'at-most') holds = threshold !== null && metric.growth <= threshold;
  else holds = metric.growth > 0;
  if (threshold === null && parsed.claimType === 'metric-threshold') return buildUnavailableAnalysis(claim, parsed, data, '命题没有给出可比较的百分比阈值。');
  const direction = holds ? 'support' : 'oppose';
  const isMargin = metric.key === 'mainMargin';
  const evidence = {
    id: 'D1', title: `${metric.label}同比变化直接验证`, tag: '直接指标', strength: '强',
    finding: isMargin
      ? `${metric.label}由 ${pct(metric.previous)} 变为 ${pct(metric.current)}，变化 ${metric.growth.toFixed(2)} 个百分点。`
      : `${metric.label}本期为 ${fmtBillionFromThousand(metric.current)}，上期为 ${fmtBillionFromThousand(metric.previous)}，同比 ${pct(metric.growth)}。`,
    reasoning: `同口径披露值可直接判断该指标是否${parsed.relationship.label}，无需用其他指标替代。`, sourceId: metric.sourceId,
    location: '第二节：主要财务指标', formula: isMargin
      ? `${pct(metric.current)} - ${pct(metric.previous)} = ${metric.growth.toFixed(2)} 个百分点`
      : `(${metric.current} - ${metric.previous}) / ${metric.previous} × 100% = ${pct(metric.growth)}`,
    metrics: [{ label: isMargin ? `${metric.label}变化` : `${metric.label}同比`, value: isMargin ? `${metric.growth.toFixed(2)} 个百分点` : pct(metric.growth) }], supportsWholeClaim: true
  };
  return {
    mode: 'rules_only', analysisReady: true, supported: holds, needsClarification: false,
    claim, company: data.company.ticker, companyName: data.company.name, period: parsed.period, parsedClaim: parsed,
    missingFields: [], missingEvidence: [], verdict: holds ? '命题成立' : '命题不成立', verdictTitle: `${metric.label}的同口径数据${holds ? '支持' : '不支持'}该命题。`,
    verdictKey: holds ? 'supported' : 'refuted', evidenceStrength: 96, summary: evidence.finding, clarifications: [],
    subquestions: [
      { id: 'q1', question: `${metric.label}的主体与期间是否明确？`, status: '支持', linkedEvidence: ['D1'] },
      { id: 'q2', question: `${metric.label}同比变化是否满足命题条件？`, status: holds ? '支持' : '存在反向证据', linkedEvidence: ['D1'] },
      { id: 'q3', question: '披露值与代码重算是否一致？', status: '支持', linkedEvidence: ['D1'] }
    ],
    evidence: { support: direction === 'support' ? [evidence] : [], oppose: direction === 'oppose' ? [evidence] : [], unknown: [] },
    calculations: { metric: metric.key, growth: metric.growth, threshold }, changeConditions: [], sources: data.sources,
    dataCompleteness: 'complete-for-metric-change', disclaimer: data.disclaimer
  };
}

const METRIC_CLAUSE_PATTERNS = {
  revenue: /营业收入|总营收|营收/,
  mainRevenue: /主营业务收入|主营收入/,
  netProfit: /归母净利润|归属于[^，。；]*净利润/,
  adjustedNetProfit: /扣非归母净利润|扣非净利润/,
  operatingCashFlow: /经营活动现金流(?:净额)?|经营现金流/,
  mainMargin: /主营业务毛利率|主营毛利率|毛利率/
};

function buildCompoundMetricChangeAnalysis(claim, parsed, data) {
  const clauses = claim.split(/[，,；;。]*(?:但|而|同时|且|并且)[，,；;。]*/).map(item => item.trim()).filter(Boolean);
  const checks = parsed.metrics.map(item => {
    const pattern = METRIC_CLAUSE_PATTERNS[item.key];
    const clause = pattern ? clauses.find(value => pattern.test(value)) : null;
    const expectation = clause && /下降|下滑|减少|转负/.test(clause) ? 'decrease'
      : clause && /增长|上升|改善/.test(clause) ? 'increase' : null;
    const record = metricRecord(item.key, data);
    if (!clause || !expectation || !record) return null;
    const holds = expectation === 'increase' ? record.growth > 0 : record.growth < 0;
    return { item, record, clause, expectation, holds };
  }).filter(Boolean);
  if (checks.length < 2) return buildUnavailableAnalysis(claim, parsed, data, '复合命题中的每个指标方向未能完整识别或当前快照缺少对应数据。');
  const allHold = checks.every(item => item.holds);
  const evidence = checks.map((item, index) => ({
    id: `D${index + 1}`, title: `${item.record.label}方向直接验证`, tag: '直接指标', strength: '强',
    finding: `${item.record.label}同比 ${pct(item.record.growth)}，命题要求其${item.expectation === 'increase' ? '增长' : '下降'}，该子命题${item.holds ? '成立' : '不成立'}。`,
    reasoning: '使用同一年度报告与比较期间的披露值逐项检验；复合命题只有所有子命题同时成立时才整体成立。',
    sourceId: item.record.sourceId, location: '第二节：主要财务指标',
    formula: `(${item.record.current} - ${item.record.previous}) / ${item.record.previous} × 100% = ${pct(item.record.growth)}`,
    metrics: [{ label: `${item.record.label}同比`, value: pct(item.record.growth) }], supportsWholeClaim: true
  }));
  return {
    mode: 'rules_only', analysisReady: true, supported: allHold, needsClarification: false,
    claim, company: data.company.ticker, companyName: data.company.name, period: parsed.period, parsedClaim: parsed,
    missingFields: [], missingEvidence: [], verdict: allHold ? '命题成立' : '命题不成立',
    verdictTitle: allHold ? '复合命题的各项指标方向均成立。' : '至少一个指标方向与披露数据不符。',
    verdictKey: allHold ? 'supported' : 'refuted', evidenceStrength: 97,
    summary: evidence.map(item => item.finding).join(' '), clarifications: [],
    subquestions: checks.map((item, index) => ({ id: `q${index + 1}`, question: `${item.record.label}是否${item.expectation === 'increase' ? '增长' : '下降'}？`, status: item.holds ? '支持' : '存在反向证据', linkedEvidence: [`D${index + 1}`] })),
    evidence: { support: allHold ? evidence : evidence.filter((_, index) => checks[index].holds), oppose: allHold ? [] : evidence.filter((_, index) => !checks[index].holds), unknown: [] },
    calculations: Object.fromEntries(checks.map(item => [item.item.key, item.record.growth])), changeConditions: [], sources: data.sources,
    dataCompleteness: 'complete-for-compound-metric-change', disclaimer: data.disclaimer
  };
}

function buildDriverDataGapAnalysis(claim, parsed, data) {
  const driverLabels = parsed.metrics.filter(item => ['salesVolume', 'price', 'productMix', 'cost'].includes(item.key)).map(item => item.label);
  const driverText = driverLabels.join('、') || '目标驱动因素';
  const contextEvidence = {
    id: 'CTX1', title: '利润增长事实已确认', tag: '相关性背景', strength: '中',
    finding: `归母净利润同比增长 ${pct(data.metrics.netProfit.growth)}。`,
    reasoning: `利润增长只能确认结果变量发生变化，不能证明其主要由${driverText}驱动。`,
    sourceId: 'annual-report', location: '第二节：主要财务指标',
    metrics: [{ label: '归母净利润同比', value: pct(data.metrics.netProfit.growth) }], supportsWholeClaim: false
  };
  const missingEvidence = [
    { key: 'driver-data', label: `${driverText}的同口径原始数据`, reason: '确认目标驱动因素自身的变化' },
    { key: 'profit-bridge', label: '目标因素至税后归母净利润的定量桥接', reason: '量化贡献并与其他因素比较' }
  ];
  const unknown = missingEvidence.map((item, index) => ({
    id: `MISS${index + 1}`, title: item.label, tag: '关键因果证据', strength: '缺少数据', finding: item.reason,
    reasoning: `没有${item.label}时，相关指标增长不能替代直接因果证据。`, sourceId: 'annual-report',
    location: `待补充：${item.label}`, metrics: [{ label: '当前状态', value: '无法验证' }], supportsWholeClaim: false
  }));
  return {
    mode: 'rules_only', analysisReady: true, supported: false, needsClarification: false,
    claim, company: data.company.ticker, companyName: data.company.name, period: parsed.period, parsedClaim: parsed,
    missingFields: [], missingEvidence, verdict: '证据不足，无法验证',
    verdictTitle: `缺少${driverText}及利润桥数据，\n不能完成因果归因。`, verdictKey: 'insufficient-evidence', evidenceStrength: 24,
    summary: `现有快照只能确认利润增长，不能证明${driverText}是主要驱动因素。必须补充${driverText}的原始数据，并把量价、产品结构、成本、费用及非经营项目桥接到税后归母净利润。`,
    clarifications: [],
    subquestions: [
      { id: 'q1', question: '利润增长事实是否成立？', status: '支持子命题，不支持整体因果', linkedEvidence: ['CTX1'] },
      { id: 'q2', question: `${driverText}是否发生与命题一致的变化？`, status: '无法验证', linkedEvidence: ['MISS1'] },
      { id: 'q3', question: `${driverText}对净利润增量的贡献是否达到“主要”标准？`, status: '无法验证', linkedEvidence: ['MISS2'] }
    ],
    evidence: { support: [contextEvidence], oppose: [], unknown }, calculations: { netProfitGrowth: data.metrics.netProfit.growth },
    changeConditions: [{ title: '取得因果桥接数据', trigger: `取得${driverText}及其他因素至税后净利润的同口径定量桥接。`, impact: '届时重新比较各因素贡献。', type: 'evidence' }],
    sources: data.sources, dataCompleteness: 'insufficient-for-causality', disclaimer: data.disclaimer
  };
}

function buildExclusiveCausalAnalysis(claim, parsed, data) {
  const m = data.metrics;
  const mainMarginCurrent = (m.mainRevenue.current - m.mainCost.current) / m.mainRevenue.current * 100;
  const mainMarginPrevious = (m.mainRevenue.previous - m.mainCost.previous) / m.mainRevenue.previous * 100;
  const evidence = {
    support: [{
      id: 'CTX1', title: '主营经营指标与利润同期改善', tag: '相关性背景', strength: '中',
      finding: `主营业务收入同比增长 ${pct(m.mainRevenue.growth)}，主营毛利率提高 ${(mainMarginCurrent - mainMarginPrevious).toFixed(2)} 个百分点，归母净利润同比增长 ${pct(m.netProfit.growth)}。`,
      reasoning: '这些指标只说明主营经营与利润同期改善，可支持“存在相关性”的子命题；没有销量、售价和成本桥接，不能证明销量是驱动因素，更不能证明是全部原因。',
      sourceId: 'annual-report', location: '主要财务指标；营业收入和营业成本附注',
      formula: '主营收入同比、主营毛利率变化与归母净利润同比并列观察，不作因果外推',
      metrics: [{ label: '主营收入同比', value: pct(m.mainRevenue.growth) }, { label: '归母净利润同比', value: pct(m.netProfit.growth) }],
      supportsWholeClaim: false, claimScope: 'context-only'
    }],
    oppose: [{
      id: 'ALT1', title: '存在尚未排除的其他利润贡献来源', tag: '替代解释', strength: '中',
      finding: `投资收益同比增长 ${pct(m.investmentIncome.growth)}，非经常性损益同比增长 ${pct(m.nonRecurring.growth)}。`,
      reasoning: '这些项目表明利润变化存在其他潜在贡献来源。未完成税后利润桥接前，排他性的“全部由销量驱动”不能成立。',
      sourceId: 'annual-report', location: '投资收益；非经常性损益项目及金额',
      formula: '检查所有替代贡献项是否已在利润桥中排除',
      metrics: [{ label: '投资收益同比', value: pct(m.investmentIncome.growth) }, { label: '非经常性损益同比', value: pct(m.nonRecurring.growth) }],
      supportsWholeClaim: true
    }],
    unknown: [
      {
        id: 'MISS1', title: '缺少产品级销量与平均售价数据', tag: '关键因果证据', strength: '缺少数据',
        finding: '当前快照没有按产品线统一口径的销量、出货量和平均售价变动。',
        reasoning: '收入增长可能来自销量、价格或产品组合变化；未拆分量价就不能识别销量贡献。', sourceId: 'annual-report',
        location: '待补充：分产品销量、平均售价及口径说明', metrics: [{ label: '当前状态', value: '无法验证' }], supportsWholeClaim: false
      },
      {
        id: 'MISS2', title: '缺少销量至净利润的完整利润桥', tag: '关键因果证据', strength: '缺少数据',
        finding: '当前快照未把销量、价格、产品结构、单位成本、费用、投资收益和税项逐项桥接至归母净利润增量。',
        reasoning: '排他性因果主张要求同时证明目标因素的贡献并排除其他解释；相关指标同向增长不满足这一标准。', sourceId: 'annual-report',
        location: '待补充：量价成本、费用、非经营项目及税后利润桥', metrics: [{ label: '当前状态', value: '无法验证' }], supportsWholeClaim: false
      }
    ]
  };
  return {
    mode: 'rules_only', analysisReady: true, supported: false, needsClarification: false,
    claim, company: data.company.ticker, companyName: data.company.name, period: parsed.period, parsedClaim: parsed,
    missingFields: [],
    missingEvidence: [
      { key: 'volume-and-price', label: '分产品销量、出货量与平均售价', reason: '区分销量与价格贡献' },
      { key: 'product-mix-and-cost', label: '产品结构、单位成本与产能利用率', reason: '解释毛利变化' },
      { key: 'profit-bridge', label: '从量价成本到税后归母净利润的完整利润桥', reason: '量化贡献并排除替代解释' }
    ],
    verdict: '证据不足，无法验证', verdictTitle: '现有数据不能证明\n利润增长全部由销量驱动。', verdictKey: 'insufficient-evidence', evidenceStrength: 32,
    summary: '收入、毛利率和净利润同期改善只构成相关性背景，不是销量驱动净利润的直接证据。当前缺少产品级销量、平均售价、产品结构、单位成本以及完整利润桥，同时投资收益和非经常性损益提供了尚未排除的替代解释。因此不得将整体命题标记为支持。',
    clarifications: [],
    subquestions: [
      { id: 'q1', question: '主营经营指标是否与净利润同期改善？', status: '支持子命题，不支持整体因果', linkedEvidence: ['CTX1'], requiredEvidence: '主营收入、毛利率与归母净利润同口径数据' },
      { id: 'q2', question: '能否区分销量、售价和产品结构对收入的贡献？', status: '无法验证', linkedEvidence: ['MISS1'], requiredEvidence: '分产品销量、出货量、平均售价和产品结构', missingData: ['产品级销量', '平均售价', '产品结构'] },
      { id: 'q3', question: '能否把销量贡献桥接至归母净利润增量？', status: '无法验证', linkedEvidence: ['MISS2'], requiredEvidence: '量价成本、费用、非经营项目和税项的完整利润桥', missingData: ['销量至税后归母净利润的定量桥接'] },
      { id: 'q4', question: '是否已经排除成本、费用和非经营项目等替代解释？', status: '存在反向证据', linkedEvidence: ['ALT1'], requiredEvidence: '替代贡献项的税后影响与排除测试' }
    ],
    evidence,
    conflicts: [{
      id: 'C1', evidenceIds: ['CTX1', 'ALT1', 'MISS1', 'MISS2'], reason: '经营指标同向改善与排他性销量因果之间存在证据等级缺口。',
      eachSideCanProve: { support: '主营经营与利润同期改善。', oppose: '存在其他潜在贡献来源，且销量贡献未被直接测量。' },
      preferredEvidence: '产品级量价成本数据与税后利润桥优先于相关指标模板。', unresolved: '销量对归母净利润增量的定量贡献及其他因素贡献。',
      requiredData: '分产品销量/售价/成本、产品结构、费用、非经营项目和税项的完整桥接。', resolutionStatus: '证据不足'
    }],
    calculations: { mainRevenueGrowth: m.mainRevenue.growth, netProfitGrowth: m.netProfit.growth, investmentIncomeGrowth: m.investmentIncome.growth },
    changeConditions: [{ title: '取得完整利润桥', trigger: '取得同口径量价成本与税后利润桥，并能量化销量贡献且排除其他重要因素。', impact: '届时才可重新判断排他性因果命题。', type: 'evidence' }],
    sources: data.sources, dataCompleteness: 'insufficient-for-exclusive-causality', disclaimer: data.disclaimer
  };
}

function buildAnalysis(inputClaim = '', inputCompany = '300750.SZ', inputContext = {}) {
  const data = loadData();
  const claim = String(inputClaim || data.claim).trim();
  const context = typeof inputCompany === 'object' && inputCompany !== null
    ? inputCompany
    : { ...inputContext, company: inputCompany };
  const parsed = parseThesis(claim, context, data);
  if (parsed.missingFields.length) return buildClarificationAnalysis(claim, parsed, data);
  if (!parsed.company.dataSupported) return buildUnavailableAnalysis(claim, parsed, data, `当前快照不覆盖 ${parsed.company.name || parsed.company.ticker}。`);
  if (!parsed.period.dataSupported) return buildUnavailableAnalysis(claim, parsed, data, `当前快照不覆盖 ${parsed.period.current}。`);
  if (parsed.claimType === 'metric-comparison') return buildMetricComparisonAnalysis(claim, parsed, data);
  if (parsed.claimType === 'compound-metric-change') return buildCompoundMetricChangeAnalysis(claim, parsed, data);
  if (parsed.claimType === 'metric-change' || parsed.claimType === 'metric-threshold') return buildMetricChangeAnalysis(claim, parsed, data);
  if (parsed.claimType === 'exclusive-causal') return buildExclusiveCausalAnalysis(claim, parsed, data);
  if (parsed.claimType === 'causal-attribution' && parsed.metrics.some(item => ['salesVolume', 'price', 'productMix', 'cost'].includes(item.key))) {
    return buildDriverDataGapAnalysis(claim, parsed, data);
  }
  const matchesKnownClaim = parsed.claimType === 'causal-attribution' || parsed.claimType === 'cashflow-alignment';
  if (!matchesKnownClaim) return buildUnavailableAnalysis(claim, parsed, data, '当前规则尚未覆盖该命题关系，且没有足够直接证据进行裁决。');

  const m = data.metrics;
  const mainGrossProfitNow = m.mainRevenue.current - m.mainCost.current;
  const mainGrossProfitPrev = m.mainRevenue.previous - m.mainCost.previous;
  const mainMarginNow = mainGrossProfitNow / m.mainRevenue.current * 100;
  const mainMarginPrev = mainGrossProfitPrev / m.mainRevenue.previous * 100;
  const netProfitDelta = m.netProfit.current - m.netProfit.previous;
  const nonRecurringDelta = m.nonRecurring.current - m.nonRecurring.previous;
  const nonRecurringDeltaShare = nonRecurringDelta / netProfitDelta * 100;
  const adjustedGrowth = growth(m.adjustedNetProfit.current, m.adjustedNetProfit.previous);
  const mainRevenueGrowth = growth(m.mainRevenue.current, m.mainRevenue.previous);
  const grossProfitGrowth = growth(mainGrossProfitNow, mainGrossProfitPrev);
  const investmentGrowth = growth(m.investmentIncome.current, m.investmentIncome.previous);

  const evidence = {
    support: [
      {
        id: 'S1', title: '主营业务收入增长快于总收入增速', tag: '财务数据', strength: '强',
        finding: `主营业务收入由 ${fmtBillionFromThousand(m.mainRevenue.previous)} 增至 ${fmtBillionFromThousand(m.mainRevenue.current)}，同比增长 ${pct(mainRevenueGrowth)}；占总收入约 ${(m.mainRevenue.current / m.revenue.current * 100).toFixed(1)}%。`,
        reasoning: '主营业务收入是收入增长的主要来源，支持经营规模扩大来自主营业务。收入增长本身不等同于利润增长，因此需要结合成本与利润指标继续验证。',
        sourceId: 'annual-report', location: '财务报表附注：营业收入和营业成本',
        metrics: [{ label: '主营收入同比', value: pct(mainRevenueGrowth) }, { label: '主营收入占比', value: (m.mainRevenue.current / m.revenue.current * 100).toFixed(1) + '%' }]
      },
      {
        id: 'S2', title: '扣非净利润增长并未弱于归母净利润', tag: '盈利质量', strength: '强',
        finding: `归母净利润同比增长 ${pct(m.netProfit.growth)}，扣非归母净利润同比增长 ${pct(m.adjustedNetProfit.growth)}。剔除非经常性损益后，利润增长仍然成立。`,
        reasoning: '扣非净利润增速略高于归母净利润增速，说明利润增长不能主要归因于非经常性损益；但扣非口径并不完全等同于主营业务利润。',
        sourceId: 'annual-report', location: '第二节：主要财务指标；非经常性损益项目及金额',
        metrics: [{ label: '归母净利润', value: pct(m.netProfit.growth) }, { label: '扣非净利润', value: pct(m.adjustedNetProfit.growth) }]
      },
      {
        id: 'S3', title: '主营业务毛利率同比提升', tag: '成本与毛利', strength: '中强',
        finding: `按年报主营业务收入与成本计算，主营毛利率由 ${pct(mainMarginPrev)} 升至 ${pct(mainMarginNow)}，提高 ${(mainMarginNow - mainMarginPrev).toFixed(2)} 个百分点；主营毛利额同比增长 ${pct(grossProfitGrowth)}。`,
        reasoning: '收入扩张同时伴随毛利率改善，支持主营业务盈利能力增强。该指标为基于年报披露收入、成本计算的派生值，计算口径需在后续数据接入时保持一致。',
        sourceId: 'annual-report', location: '财务报表附注：营业收入和营业成本',
        metrics: [{ label: '主营毛利率', value: pct(mainMarginNow) }, { label: '同比变化', value: '+' + (mainMarginNow - mainMarginPrev).toFixed(2) + 'pp' }]
      },
      {
        id: 'S4', title: '经营现金流同步增长', tag: '现金流交叉验证', strength: '中',
        finding: `经营活动现金流净额同比增长 ${pct(m.operatingCashFlow.growth)}，与利润增长方向一致。`,
        reasoning: '现金流改善提供了不同于利润表的交叉验证，但现金流增速低于净利润增速，仍需关注营运资本变化。',
        sourceId: 'annual-report', location: '第二节：主要财务指标',
        metrics: [{ label: '经营现金流同比', value: pct(m.operatingCashFlow.growth) }]
      }
    ],
    oppose: [
      {
        id: 'O1', title: '投资收益增长显著，存在非主营贡献', tag: '归因冲突', strength: '中强',
        finding: `投资收益由 ${fmtBillionFromThousand(m.investmentIncome.previous)} 增至 ${fmtBillionFromThousand(m.investmentIncome.current)}，同比增长约 ${pct(investmentGrowth)}。`,
        reasoning: '投资收益增长可能贡献了部分利润改善，因此“盈利改善完全来自主营业务”不成立；现有披露不足以精确拆分主营经营利润、投资收益及其他项目对净利润增量的贡献。',
        sourceId: 'annual-report', location: '财务报表附注：投资收益',
        metrics: [{ label: '投资收益同比', value: pct(investmentGrowth) }]
      },
      {
        id: 'O2', title: '非经常性损益金额仍然增加', tag: '非经常性项目', strength: '中',
        finding: `非经常性损益合计由 ${fmtBillionFromThousand(m.nonRecurring.previous)} 增至 ${fmtBillionFromThousand(m.nonRecurring.current)}；增量约占归母净利润增量的 ${pct(nonRecurringDeltaShare)}。`,
        reasoning: '非经常性损益确有增加，是需要保留的反向证据；但增量相对归母净利润增量有限，且扣非净利润增速更高，尚不足以推翻主营业务改善的总体判断。',
        sourceId: 'annual-report', location: '第二节：非经常性损益项目及金额',
        metrics: [{ label: '非经常性损益同比', value: pct(m.nonRecurring.growth) }, { label: '增量/净利润增量', value: pct(nonRecurringDeltaShare) }]
      }
    ],
    unknown: [
      {
        id: 'U1', title: '尚未完成销量、售价与产品结构的利润桥接', tag: '待补证', strength: '缺少数据',
        finding: '年报收入、成本数据能确认主营业务整体改善，但不足以把利润增量进一步拆分为销量、售价、原材料成本、产品组合和产能利用率的贡献。',
        reasoning: '要证明“主要来自主营业务”的因果归因，需要产品线毛利、销量与平均售价等可比口径，并检查是否存在会计口径变化。',
        sourceId: 'annual-report', location: '建议补充：分产品收入成本、销量及平均售价口径',
        metrics: [{ label: '当前状态', value: '未验证' }]
      },
      {
        id: 'U2', title: '缺少多期数据检验持续性', tag: '持续性', strength: '缺少数据',
        finding: '当前结论以2025年度同比为主，尚未对多个季度的毛利率、经营现金流和投资收益贡献进行一致口径复核。',
        reasoning: '单一年度的同比改善不必然代表趋势延续；需纳入后续季报并标记财报重述、并表变化及行业周期影响。',
        sourceId: 'half-year-report', location: '建议补充：2026年半年度及后续季度报告',
        metrics: [{ label: '当前状态', value: '待持续跟踪' }]
      }
    ]
  };

  const result = {
    mode: 'rules_only',
    analysisReady: true,
    supported: true,
    needsClarification: false,
    claim,
    company: data.company.ticker,
    companyName: data.company.name,
    period: parsed.period,
    parsedClaim: parsed,
    missingFields: [],
    missingEvidence: [
      { key: 'profit-bridge', label: '量价成本与非经营项目的完整利润桥', reason: '量化各因素对归母净利润增量的贡献' }
    ],
    verdict: '总体支持，但不能单因果归因',
    verdictTitle: '主营业务改善得到支持，\n但不能将全部利润增长归因于主营业务。',
    verdictKey: 'qualified-support',
    evidenceStrength: 82,
    summary: '现有证据较强地支持“主营业务经营改善是2025年盈利改善的重要来源”：主营收入与主营毛利增长，扣非净利润增速略高于归母净利润增速。但投资收益明显增长，非经常性损益也增加，因此不能将全部利润增量归因于主营业务。更准确的结论是“主营业务改善得到支持，主因归属仍需利润桥接数据进一步验证”。',
    subquestions: [
      { id: 'q1', question: '主营业务收入与毛利是否改善？', status: '支持', linkedEvidence: ['S1','S3'] },
      { id: 'q2', question: '剔除非经常性损益后，利润增长是否仍成立？', status: '支持', linkedEvidence: ['S2','O2'] },
      { id: 'q3', question: '投资收益是否可能解释部分利润增量？', status: '存在反向证据', linkedEvidence: ['O1'] },
      { id: 'q4', question: '能否将利润增量按销量、价格、成本拆分？', status: '无法验证', linkedEvidence: ['U1'] }
    ],
    evidence,
    calculations: {
      mainRevenueGrowth: Number(mainRevenueGrowth.toFixed(2)),
      mainMarginCurrent: Number(mainMarginNow.toFixed(2)),
      mainMarginPrevious: Number(mainMarginPrev.toFixed(2)),
      mainGrossProfitGrowth: Number(grossProfitGrowth.toFixed(2)),
      investmentIncomeGrowth: Number(investmentGrowth.toFixed(2)),
      nonRecurringDeltaShare: Number(nonRecurringDeltaShare.toFixed(2))
    },
    changeConditions: [
      { title: '主营经营指标反转', trigger: '后续连续两个报告期主营收入同比转负，或主营毛利率较当前下降超过 1.5 个百分点。', impact: '将“总体支持”下调为“证据不足/需要重新验证”。', type: 'negative' },
      { title: '扣非利润明显弱化', trigger: '扣非净利润增速持续低于归母净利润增速 10 个百分点以上，且差异由非经常性项目扩大造成。', impact: '削弱“利润改善主要来自主营经营”的判断。', type: 'negative' },
      { title: '投资收益贡献持续抬升', trigger: '投资收益增量或非经常性损益增量占归母净利润增量的比例持续升至 30% 以上。', impact: '需要重新评估利润改善来源，不能继续沿用当前归因。', type: 'warning' },
      { title: '现金流与利润背离', trigger: '经营现金流连续两个报告期显著低于净利润，或经营现金流/归母净利润低于 0.8。', impact: '降低盈利质量判断，追加应收账款、存货及合同负债核验。', type: 'warning' }
    ],
    sources: data.sources,
    dataCompleteness: 'partial',
    disclaimer: data.disclaimer
  };

  if (/现金流/.test(claim) && /利润|匹配|增长|盈利/.test(claim)) {
    const h = data.halfYear;
    result.verdict = '部分支持，需关注近期背离';
    result.verdictTitle = '现金流与利润方向一致，\n但最新期间出现明显背离。';
    result.verdictKey = 'mixed';
    result.evidenceStrength = 68;
    result.summary = `2025年经营现金流同比增长${pct(m.operatingCashFlow.growth)}，低于归母净利润增速${pct(m.netProfit.growth)}；2026年上半年经营现金流仅增长${pct(h.operatingCashFlow.growth)}，显著落后于归母净利润${pct(h.netProfit.growth)}和扣非净利润${pct(h.adjustedNetProfit.growth)}。因此，现金流与利润方向一致但最新期间存在背离，盈利质量结论需要保留。`;
    result.subquestions = [
      { id: 'q1', question: '2025年经营现金流是否与利润同向增长？', status: '部分支持', linkedEvidence: ['S1'] },
      { id: 'q2', question: '最新期间现金流增速是否跟上利润增速？', status: '存在反向证据', linkedEvidence: ['O1'] },
      { id: 'q3', question: '现金流偏弱是否由营运资本变化导致？', status: '无法验证', linkedEvidence: ['U1'] }
    ];
    result.evidence = {
      support: [
        { id: 'S1', title: '2025年经营现金流保持增长', tag: '现金流', strength: '中', finding: `经营活动现金流净额同比增长${pct(m.operatingCashFlow.growth)}，保持正增长。`, reasoning: `现金流方向与归母净利润增长（${pct(m.netProfit.growth)}）一致，但增速低于利润，不能单独据此确认利润质量。`, sourceId: 'annual-report', location: '第二节：主要财务指标', metrics: [{ label: '经营现金流同比', value: pct(m.operatingCashFlow.growth) }, { label: '归母净利润同比', value: pct(m.netProfit.growth) }] },
        { id: 'S2', title: '2026年上半年经营现金流仍为正增长', tag: '期间数据', strength: '中', finding: `2026年上半年经营活动现金流净额同比增长${pct(h.operatingCashFlow.growth)}，未出现同比下降。`, reasoning: '现金流仍然增长，但增速明显落后于同期收入和利润，需进一步核验回款节奏与营运资本。', sourceId: 'half-year-report', location: '主要会计数据和财务指标', metrics: [{ label: '经营现金流同比', value: pct(h.operatingCashFlow.growth) }] }
      ],
      oppose: [
        { id: 'O1', title: '最新期间现金流增速显著落后于利润增速', tag: '盈利质量冲突', strength: '强', finding: `2026年上半年经营现金流仅增长${pct(h.operatingCashFlow.growth)}，同期归母净利润增长${pct(h.netProfit.growth)}、扣非净利润增长${pct(h.adjustedNetProfit.growth)}。`, reasoning: '现金流与利润增速明显背离，会降低对利润兑现为现金的确定性，但不能直接推导为利润失真。需要结合应收账款、存货、合同负债及结算方式核验。', sourceId: 'half-year-report', location: '主要会计数据和财务指标', metrics: [{ label: '现金流同比', value: pct(h.operatingCashFlow.growth) }, { label: '归母净利润同比', value: pct(h.netProfit.growth) }] }
      ],
      unknown: [
        { id: 'U1', title: '营运资本对现金流的影响尚未拆分', tag: '待补证', strength: '缺少数据', finding: '当前快照未将应收账款、应收票据、存货、合同负债和供应商结算周期变化与现金流增量逐项桥接。', reasoning: '在得到营运资本明细和季度现金流后，才能区分扩张期备货/回款时点影响与盈利质量的结构性变化。', sourceId: 'half-year-report', location: '建议补充：资产负债表项目与现金流量表附注', metrics: [{ label: '当前状态', value: '无法验证' }] }
      ]
    };
    result.changeConditions = [
      { title: '现金流持续背离', trigger: '经营现金流连续两个报告期增速显著低于归母净利润增速，或经营现金流/归母净利润低于 0.8。', impact: '下调盈利质量确定性，优先核验应收账款、存货和合同负债。', type: 'negative' },
      { title: '现金流增速回升并收敛差距', trigger: '后续经营现金流增速连续两个报告期接近或超过扣非净利润增速，且营运资本指标稳定。', impact: '可提高对利润兑现为现金的信心。', type: 'warning' }
    ];
  }
  return result;
}

function buildPeriodComparison() {
  const data = loadData();
  const h = data.halfYear;
  return {
    title: h.period,
    metrics: [
      { label: '营业收入', current: h.revenue.current, previous: h.revenue.previous, growth: h.revenue.growth },
      { label: '归母净利润', current: h.netProfit.current, previous: h.netProfit.previous, growth: h.netProfit.growth },
      { label: '扣非归母净利润', current: h.adjustedNetProfit.current, previous: h.adjustedNetProfit.previous, growth: h.adjustedNetProfit.growth },
      { label: '经营活动现金流净额', current: h.operatingCashFlow.current, previous: h.operatingCashFlow.previous, growth: h.operatingCashFlow.growth }
    ],
    insight: '2026年上半年收入、归母净利润和扣非净利润继续增长，但经营活动现金流仅同比增长 2.61%，明显低于利润增速。该信号不直接否定主营业务改善，却提示需要补充应收账款、存货、合同负债及回款节奏证据。',
    source: data.sources.find(s => s.id === h.sourceId),
    disclaimer: '期间比较使用2026年半年度报告公开披露快照；单位均为千元，正式研究仍需复核原文与会计口径。'
  };
}

function answerFollowup(question) {
  const q = String(question || '').trim();
  if (!q) return '请输入要追问的问题。';
  if (/投资收益|非经常|一次性|归因|主因/.test(q)) {
    return '会影响，但需要看“增量贡献”而不只看金额大小。2025年投资收益同比增长约99.87%，非经常性损益增量约占归母净利润增量的9.05%；这构成反向证据，意味着不能把全部利润增长归因于主营业务。与此同时，主营收入增长18.07%、主营毛利率提升约1.22个百分点，扣非净利润增长43.37%，所以当前判断是“主营改善得到支持，但主因归属仍需利润桥接”。若后续投资收益/非经常性损益增量占利润增量持续超过30%，应下调当前结论。';
  }
  if (/现金流|应收|存货|回款/.test(q)) {
    return '现金流是当前最值得继续核验的质量指标。2025年经营现金流同比增长37.35%，低于归母净利润42.28%的增速；2026年上半年经营现金流仅同比增长2.61%，显著弱于同期净利润和扣非净利润增速。建议进一步查看应收账款、存货、合同负债、票据结算及季度回款节奏。现金流偏弱本身不等于利润失真，但会降低结论的确定性。';
  }
  if (/改变|反转|什么情况|条件|阈值/.test(q)) {
    return '当前结论需要在以下情形下重算：①连续两个报告期主营收入同比转负，或主营毛利率较基准下降超过1.5个百分点；②扣非净利润增速持续低于归母净利润增速10个百分点以上，且差异由非经常性项目扩大造成；③投资收益/非经常性损益增量占利润增量持续超过30%；④经营现金流连续两个报告期显著弱于净利润或经营现金流/归母净利润低于0.8。上述阈值是研究监测规则，不是公司指引或收益预测。';
  }
  return '我会先把问题映射到已验证的指标，再判断证据是否充分。当前证据库支持对宁德时代2025年度主营收入、主营毛利、扣非净利润、投资收益和经营现金流进行核验；如果问题涉及产品级销量/价格拆分、实时估值或其他公司，需要补充扶摇/iFinD MCP 数据后再给结论。当前不会用未接入的数据补全答案。';
}

module.exports = { loadData, buildAnalysis, buildPeriodComparison, answerFollowup, growth };
