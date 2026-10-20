'use strict';

const SCHEMA_VERSION = 2;

function nowIso() { return new Date().toISOString(); }
function makeId(prefix, seed = '') {
  let hash = 2166136261;
  for (const ch of seed) { hash ^= ch.charCodeAt(0); hash = Math.imul(hash, 16777619); }
  return `${prefix}-${Math.abs(hash >>> 0).toString(36).toUpperCase()}`;
}

function expandSubquestion(q, period) {
  return {
    ...q,
    objective: q.question,
    requiredEvidence: q.requiredEvidence || (q.linkedEvidence?.length ? '财务指标与对应原始报告' : '待补充结构化指标或原始材料'),
    comparisonPeriod: period ? `${period.current} vs ${period.compare}` : '待确认',
    criterion: q.status === '无法验证' ? '取得可比口径数据后再判断' : '原始披露 + 代码重算 + 反向证据复核',
    evidenceStatus: q.status,
    missingData: q.missingData || (q.status === '无法验证' || q.status === '待验证' ? ['当前数据集未覆盖所需明细'] : []),
    importance: q.id === 'q1' || q.id === 'q2' ? '高' : '中'
  };
}

function expandEvidence(item, direction, sources, claim, period) {
  const source = sources.find(s => s.id === item.sourceId) || {};
  return {
    ...item,
    direction,
    thesis: claim,
    subquestionIds: [],
    evidenceType: source.type || item.tag || '待分类',
    sourceName: source.publisher || '待确认',
    sourceTitle: source.title || '待确认',
    originalValueOrExcerpt: item.finding,
    statisticalPeriod: period?.current || '待确认',
    publishedAt: source.publishedAt || null,
    retrievedAt: '2026-10-19T00:00:00+08:00',
    sourceUrl: source.url || null,
    formula: item.formula || ({
      S1: '(本期主营收入 - 上期主营收入) / 上期主营收入 × 100%',
      S2: '(本期扣非归母净利润 - 上期扣非归母净利润) / 上期扣非归母净利润 × 100%',
      S3: '(主营收入 - 主营成本) / 主营收入；本期毛利率 - 上期毛利率（百分点）',
      S4: '(本期经营现金流 - 上期经营现金流) / 上期经营现金流 × 100%',
      O1: '(本期投资收益 - 上期投资收益) / 上期投资收益 × 100%',
      O2: '(本期非经常性损益 - 上期非经常性损益) / 归母净利润增量 × 100%'
    }[item.id] || null),
    limitations: item.reasoning,
    reliability: source.id === 'annual-report' || source.url?.includes('cninfo.com.cn') ? '高：上市公司正式披露/巨潮资讯原始文件' : '中：公告转录或二手入口，需回查原文'
  };
}

function buildConflictRecord(analysis) {
  if (Array.isArray(analysis.conflicts)) return analysis.conflicts.map(item => JSON.parse(JSON.stringify(item)));
  if (analysis.verdictKey !== 'qualified-support') return [];
  return [{
    id: 'C1',
    evidenceIds: ['S2', 'O1', 'O2'],
    reason: '扣非净利润与主营毛利改善支持经营改善，但投资收益和非经常性损益同步增加，无法仅凭净利润增速完成利润来源归因。',
    eachSideCanProve: {
      support: '剔除非经常性损益后盈利增长仍成立，且主营业务毛利率改善。',
      oppose: '非主营项目对利润增量存在贡献，全部归因于主营业务不成立。'
    },
    preferredEvidence: '正式年报中的主营收入/成本与扣非净利润更适合判断经营改善；投资收益附注用于限制“全部来自主营”的因果外推。',
    unresolved: '缺少销量、售价、产品结构、原材料成本和投资收益对税后净利润的完整桥接。',
    requiredData: '同口径产品线量价成本、分部利润、投资收益税后影响及会计口径变更说明。',
    resolutionStatus: '保留冲突'
  }];
}

function buildResearchTask(analysis, overrides = {}) {
  const createdAt = nowIso();
  const id = overrides.id || makeId('TASK', `${analysis.claim}|${analysis.company || ''}`);
  const subquestions = (analysis.subquestions || []).map(q => expandSubquestion(q, analysis.period));
  const evidence = ['support', 'oppose', 'unknown'].flatMap(direction =>
    (analysis.evidence?.[direction] || []).map(item => expandEvidence(item, direction, analysis.sources || [], analysis.claim, analysis.period))
  );
  for (const q of subquestions) {
    for (const evidenceId of q.linkedEvidence || []) {
      const match = evidence.find(item => item.id === evidenceId);
      if (match && !match.subquestionIds.includes(q.id)) match.subquestionIds.push(q.id);
    }
  }
  const conflicts = buildConflictRecord(analysis);
  const conditions = (analysis.changeConditions || []).map((item, index) => ({
    id: `CC${index + 1}`,
    title: item.title,
    monitoredMetricOrEvent: item.title,
    currentReference: index === 0 && analysis.calculations ? `主营毛利率 ${analysis.calculations.mainMarginCurrent}%` : '见当前研究快照',
    triggerThreshold: item.trigger,
    thresholdBasis: '可配置研究规则（用户设定），不是行业公认标准',
    revalidateSubquestionIds: subquestions.map(q => q.id),
    possibleDirection: item.impact,
    conditionType: /连续|低于|超过|转负/.test(item.trigger) ? '数据阈值' : '事件触发',
    editable: true
  }));
  const taskStatus = analysis.needsClarification
    ? 'needs-clarification'
    : analysis.verdictKey === 'insufficient-evidence'
      ? 'evidence-insufficient'
      : 'researching';
  return {
    schemaVersion: SCHEMA_VERSION,
    id,
    status: taskStatus,
    createdAt,
    updatedAt: createdAt,
    lastResearchAt: createdAt,
    version: 1,
    thesis: {
      id: makeId('THESIS', analysis.claim),
      version: 1,
      original: analysis.claim,
      revised: analysis.revisedClaim || analysis.claim,
      subject: { name: analysis.companyName || '待确认', ticker: analysis.company || '待确认', type: '公司' },
      period: analysis.period || { current: '待确认', compare: '待确认', asOf: null },
      type: ({ 'metric-comparison': '跨指标比较', 'compound-metric-change': '复合指标方向验证', 'metric-change': '单指标验证', 'metric-threshold': '阈值验证', 'exclusive-causal': '排他性因果归因', 'causal-attribution': '盈利归因', 'cashflow-alignment': '盈利质量' })[analysis.parsedClaim?.claimType] || '待分类',
      metrics: analysis.parsedClaim?.metrics || [],
      relationship: analysis.parsedClaim?.relationship || null,
      ambiguities: analysis.clarifications || [],
      criteria: '以同口径同比、扣非利润、主营毛利和非主营项目增量交叉验证；缺失项保留为无法验证。'
    },
    subquestions,
    sources: analysis.sources || [],
    evidence,
    conflicts,
    conclusions: [{
      id: 'CONCLUSION-1', version: 1, status: analysis.verdict, rationale: analysis.summary,
      supportEvidenceIds: evidence.filter(x => x.direction === 'support' && x.supportsWholeClaim !== false).map(x => x.id),
      contextEvidenceIds: evidence.filter(x => x.direction === 'support' && x.supportsWholeClaim === false).map(x => x.id),
      opposeEvidenceIds: evidence.filter(x => x.direction === 'oppose').map(x => x.id),
      unknownEvidenceIds: evidence.filter(x => x.direction === 'unknown').map(x => x.id),
      applicability: '仅适用于已披露的2025年度及列示的2026年半年度历史快照；不外推未来业绩。',
      generatedAt: createdAt
    }],
    changeConditions: conditions,
    dataSnapshot: {
      id: makeId('SNAPSHOT', String(analysis.period?.asOf || 'unknown')),
      mode: analysis.financialData?.status?.mode || 'historical-public-snapshot',
      asOf: analysis.period?.asOf || null,
      retrievedAt: '2026-10-19T00:00:00+08:00',
      providers: [analysis.financialData?.status?.provider || '巨潮资讯公开披露'],
      completeness: analysis.dataCompleteness || (analysis.needsClarification ? 'insufficient' : 'partial'),
      structuredOnlineData: Boolean(analysis.financialData?.status?.structuredOnlineData),
      sourceVerification: analysis.financialData?.status?.sourceVerification || 'not-requested',
      statusMessage: analysis.financialData?.status?.message || null,
      facts: analysis.financialData?.facts || []
    },
    unresolvedQuestions: [
      ...evidence.filter(x => x.direction === 'unknown').map(x => x.title),
      ...(analysis.missingEvidence || []).map(item => item.label || item.reason).filter(Boolean)
    ].filter((item, index, items) => items.indexOf(item) === index),
    auditEvents: [{
      id: 'AUDIT-1', type: 'TASK_CREATED', at: createdAt, version: 1,
      detail: analysis.mode === 'deepseek+rules' ? 'DeepSeek 生成语义结构；规则引擎生成证据与初始研究任务' : '规则引擎生成初始研究任务'
    }],
    analysis: JSON.parse(JSON.stringify(analysis))
  };
}

function validateResearchTask(task) {
  const errors = [];
  if (!task || typeof task !== 'object') return { ok: false, errors: ['任务必须是对象'] };
  if (task.schemaVersion !== SCHEMA_VERSION) errors.push('schemaVersion 不受支持');
  if (!task.id || !task.thesis?.original) errors.push('缺少任务 ID 或命题');
  if (!Array.isArray(task.subquestions)) errors.push('subquestions 必须为数组');
  if (!Array.isArray(task.evidence)) errors.push('evidence 必须为数组');
  if (!Array.isArray(task.conclusions)) errors.push('conclusions 必须为数组');
  return { ok: errors.length === 0, errors };
}

module.exports = { SCHEMA_VERSION, buildResearchTask, validateResearchTask };
