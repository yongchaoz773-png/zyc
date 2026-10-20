'use strict';

const fs = require('fs');
const path = require('path');

const SNAPSHOT_PATH = path.join(__dirname, '..', 'data', 'evidence.json');
const DEFAULT_TIMEOUT_MS = 3500;
const DEFAULT_CACHE_TTL_MS = 15 * 60 * 1000;

const runtime = {
  lastAttemptAt: null,
  lastSuccessAt: null,
  lastError: null,
  cache: new Map()
};

class FinancialDataError extends Error {
  constructor(code, message, statusCode = 502) {
    super(message);
    this.name = 'FinancialDataError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

function loadSnapshot() {
  return JSON.parse(fs.readFileSync(SNAPSHOT_PATH, 'utf8'));
}

function parsePositiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function periodYear(value) {
  return String(value || '').match(/20\d{2}/)?.[0] || null;
}

function assertCoveredScope(snapshot, company, period) {
  const normalizedCompany = String(company || snapshot.company.ticker).trim().toUpperCase();
  const companyAliases = [snapshot.company.ticker, snapshot.company.name, snapshot.company.ticker.replace(/\.(SZ|SH)$/i, '')]
    .map(value => String(value).toUpperCase());
  if (!companyAliases.includes(normalizedCompany)) {
    throw new FinancialDataError('DATA_SCOPE_NOT_COVERED', '当前金融数据快照不覆盖该公司。', 404);
  }
  const requestedYear = periodYear(period);
  const coveredYear = periodYear(snapshot.period.current);
  if (requestedYear && requestedYear !== coveredYear) {
    throw new FinancialDataError('PERIOD_NOT_COVERED', `当前金融数据快照仅覆盖 ${snapshot.period.current}。`, 404);
  }
}

function normalizeFacts(snapshot) {
  const sourceMap = new Map(snapshot.sources.map(source => [source.id, source]));
  const currentYear = periodYear(snapshot.period.current);
  const previousYear = periodYear(snapshot.period.compare);
  const fetchedAt = `${snapshot.asOf || snapshot.period.asOf}T00:00:00+08:00`;
  return Object.entries(snapshot.metrics).flatMap(([metric, record]) => {
    const source = sourceMap.get(record.sourceId);
    if (!source) throw new FinancialDataError('INVALID_SNAPSHOT', `指标 ${metric} 缺少来源。`);
    return [
      { suffix: 'current', value: record.current, period: snapshot.period.current, year: currentYear },
      { suffix: 'previous', value: record.previous, period: snapshot.period.compare, year: previousYear }
    ].map(item => ({
      evidenceId: `${record.sourceId}:${metric}:${item.year || item.suffix}`,
      companyCode: snapshot.company.ticker,
      metric,
      metricLabel: record.label,
      value: item.value,
      unit: record.unit,
      period: item.period,
      accountingScope: '合并口径（以来源披露为准）',
      sourceName: source.title,
      sourceUrl: source.url,
      publishedAt: source.publishedAt,
      fetchedAt,
      dataMode: 'snapshot'
    }));
  });
}

async function fetchWithTimeout(url, options, timeoutMs, fetchImpl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...options, signal: controller.signal, redirect: 'follow' });
  } finally {
    clearTimeout(timer);
  }
}

async function verifyOneSource(source, options = {}) {
  const fetchImpl = options.fetchImpl || global.fetch;
  if (typeof fetchImpl !== 'function') throw new FinancialDataError('FETCH_UNAVAILABLE', '当前运行时不支持来源可用性检查。');
  const timeoutMs = parsePositiveInteger(options.timeoutMs || process.env.FINANCIAL_SOURCE_VERIFY_TIMEOUT_MS, DEFAULT_TIMEOUT_MS);
  let response;
  let lastError;
  let attempts = 0;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    attempts = attempt;
    try {
      response = await fetchWithTimeout(source.url, { method: 'HEAD' }, timeoutMs, fetchImpl);
      if (!response.ok && [403, 405].includes(response.status)) {
        response = await fetchWithTimeout(source.url, { method: 'GET', headers: { Range: 'bytes=0-0' } }, timeoutMs, fetchImpl);
      }
      if (response.ok || response.status < 500 || attempt === 2) break;
    } catch (error) {
      lastError = error;
      if (attempt === 2) {
        const reason = error?.name === 'AbortError' ? 'timeout' : 'network-error';
        return { sourceId: source.id, url: source.url, available: false, checkedAt: new Date().toISOString(), status: null, reason, attempts: attempt };
      }
    }
  }
  return {
    sourceId: source.id,
    url: source.url,
    available: Boolean(response.ok),
    checkedAt: new Date().toISOString(),
    status: response.status,
    reason: response.ok ? null : `http-${response.status}`,
    attempts
  };
}

async function verifySources(sources, options = {}) {
  const ttlMs = parsePositiveInteger(options.cacheTtlMs || process.env.FINANCIAL_CACHE_TTL_MS, DEFAULT_CACHE_TTL_MS);
  const now = Date.now();
  const checks = [];
  for (const source of sources) {
    const cached = runtime.cache.get(source.url);
    if (!options.force && cached && now - cached.cachedAt < ttlMs) {
      checks.push({ ...cached.result, cache: 'hit' });
      continue;
    }
    const result = await verifyOneSource(source, options);
    runtime.cache.set(source.url, { cachedAt: Date.now(), result });
    checks.push({ ...result, cache: 'miss' });
  }
  return checks;
}

async function getFinancialData(options = {}) {
  const snapshot = loadSnapshot();
  assertCoveredScope(snapshot, options.company, options.period);
  const facts = normalizeFacts(snapshot);
  const status = {
    provider: 'public-disclosure-snapshot',
    mode: 'snapshot',
    structuredOnlineData: false,
    fallbackUsed: false,
    sourceVerification: 'not-requested',
    message: '使用历史公开财报的结构化快照；不是实时行情，也不是在线结构化数据接口。'
  };
  let sourceChecks = [];
  if (options.refresh) {
    runtime.lastAttemptAt = new Date().toISOString();
    sourceChecks = await verifySources(snapshot.sources, { ...options, force: Boolean(options.force) });
    const allAvailable = sourceChecks.every(item => item.available);
    if (allAvailable) {
      runtime.lastSuccessAt = new Date().toISOString();
      runtime.lastError = null;
      status.mode = 'source-verified-snapshot';
      status.sourceVerification = sourceChecks.every(item => item.cache === 'hit') ? 'cached-success' : 'success';
      status.message = '已在线确认原始披露文件可访问；指标值仍来自历史结构化快照，不代表已接入在线财务数据。';
    } else {
      runtime.lastError = sourceChecks.filter(item => !item.available).map(item => `${item.sourceId}:${item.reason}`).join(', ');
      status.fallbackUsed = true;
      status.sourceVerification = 'failed';
      status.message = '原始披露文件可用性检查未全部成功，继续使用可追溯的历史快照；没有将失败当作实时数据成功。';
    }
  }
  return {
    company: snapshot.company,
    period: snapshot.period,
    facts,
    sources: snapshot.sources,
    status,
    sourceChecks,
    snapshotAsOf: snapshot.asOf,
    disclaimer: snapshot.disclaimer
  };
}

function getProviderHealth() {
  return {
    publicDisclosureSnapshot: {
      configured: true,
      structuredOnlineData: false,
      sourceVerificationAvailable: typeof global.fetch === 'function',
      runtimeScope: 'current-function-instance-non-durable',
      lastAttemptAt: runtime.lastAttemptAt,
      lastSuccessAt: runtime.lastSuccessAt,
      lastError: runtime.lastError
    },
    fuyiao: { configured: false, connection: 'not-attempted', reason: '未提供官方接口文档与凭证，未实现猜测性调用。' },
    ifindMcp: { configured: false, connection: 'not-attempted', reason: '未提供 MCP 端点、工具契约与凭证。' }
  };
}

const publicDisclosureProvider = {
  id: 'public-disclosure-snapshot',
  dataMode: 'snapshot',
  searchCompanies(query = '') {
    const snapshot = loadSnapshot();
    const needle = String(query).trim().toUpperCase();
    const aliases = [snapshot.company.name, snapshot.company.ticker, snapshot.company.ticker.replace(/\.(SZ|SH)$/i, '')];
    return !needle || aliases.some(value => String(value).toUpperCase().includes(needle))
      ? [{ ...snapshot.company, coverage: [snapshot.period.current, snapshot.period.compare], dataMode: 'snapshot' }]
      : [];
  },
  getFinancialData,
  getDisclosures(company) {
    const snapshot = loadSnapshot();
    assertCoveredScope(snapshot, company);
    return snapshot.sources.map(source => ({ ...source, dataMode: 'source-document-link', retrievedAt: `${snapshot.asOf}T00:00:00+08:00` }));
  }
};

function resetRuntimeForTests() {
  runtime.lastAttemptAt = null;
  runtime.lastSuccessAt = null;
  runtime.lastError = null;
  runtime.cache.clear();
}

module.exports = {
  FinancialDataError,
  getFinancialData,
  getProviderHealth,
  loadSnapshot,
  normalizeFacts,
  publicDisclosureProvider,
  resetRuntimeForTests,
  verifySources
};
