const fs = require('fs');
const path = require('path');

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
function buildAnalysis(inputClaim = '', inputCompany = '300750.SZ') {
  const data = loadData();
  const claim = String(inputClaim || data.claim).trim();
  const mentionsSupportedCompany = /宁德时代|300750|CATL/i.test(claim);
  const selectedCompanyIsSupported = /宁德时代|300750|CATL/i.test(String(inputCompany || ''));
  const knownOtherCompany = /比亚迪|BYD|贵州茅台|茅台|小米集团|腾讯|阿里巴巴|招商银行|工商银行|中国平安|美的集团|格力电器|中芯国际|阳光电源|隆基绿能|亿纬锂能/i.test(claim);
  const otherTicker = Array.from(claim.matchAll(/\b(?:000|001|002|300|600|601|603|605|688)\d{3}\b/g)).some(match => match[0] !== '300750');
  const supportedCompany = !knownOtherCompany && !otherTicker && (mentionsSupportedCompany || selectedCompanyIsSupported);
  const matchesKnownClaim = /主营业务|盈利改善|扣非|非经常性损益|利润增长|利润改善|现金流/.test(claim);
  if (!supportedCompany || !matchesKnownClaim) {
    return {
      mode: 'rules_only',
      supported: false,
      needsClarification: true,
      claim,
      company: inputCompany,
      verdict: '暂无法验证',
      verdictKey: 'unknown',
      evidenceStrength: 0,
      summary: '当前可核验数据集仅覆盖宁德时代2025年度报告及2026年半年度报告摘要。该命题尚未匹配到足够的公司、期间或指标证据，系统不会用相似公司数据替代，也不会生成未经核验的结论。',
      clarifications: [
        '请明确公司名称或证券代码。',
        '请明确比较期间（如2025年度同比或2026年上半年同比）。',
        '请明确“盈利改善”的口径：归母净利润、扣非净利润、主营业务毛利还是经营现金流。'
      ],
      subquestions: [
        { id: 'q1', question: '利润增长是否显著高于收入增长？', status: '待验证' },
        { id: 'q2', question: '扣除非经常性损益后，利润增长是否仍然成立？', status: '待验证' },
        { id: 'q3', question: '主营业务收入、成本与毛利率是否改善？', status: '待验证' },
        { id: 'q4', question: '投资收益、补助或其他一次性项目是否显著影响利润？', status: '待验证' }
      ],
      evidence: { support: [], oppose: [], unknown: [] },
      sources: data.sources,
      disclaimer: data.disclaimer
    };
  }

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
    supported: true,
    needsClarification: false,
    claim,
    company: data.company.ticker,
    companyName: data.company.name,
    period: data.period,
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
