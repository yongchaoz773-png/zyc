'use strict';

const { getFinancialData } = require('../lib/financial-data');

(async () => {
  const result = await getFinancialData({ company: '300750.SZ', period: '2025年度', refresh: true, force: true });
  console.log(JSON.stringify({
    checkedAt: new Date().toISOString(),
    structuredOnlineData: result.status.structuredOnlineData,
    valueMode: result.facts[0]?.dataMode,
    status: result.status,
    sourceChecks: result.sourceChecks
  }, null, 2));
  process.exitCode = result.sourceChecks.every(item => item.available) ? 0 : 2;
})().catch(error => {
  console.error(JSON.stringify({ error: error.code || 'CHECK_FAILED', message: error.message }));
  process.exitCode = 1;
});
