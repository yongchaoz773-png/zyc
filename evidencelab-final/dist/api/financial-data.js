'use strict';

const { FinancialDataError, getFinancialData, publicDisclosureProvider } = require('../lib/financial-data');
const { readJsonBody, sendInputError } = require('../lib/http');

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  if (!['GET', 'POST'].includes(req.method)) {
    res.statusCode = 405;
    return res.end(JSON.stringify({ error: 'METHOD_NOT_ALLOWED', message: '仅支持 GET 或 POST。' }));
  }
  try {
    const body = req.method === 'POST' ? readJsonBody(req) : {};
    const query = req.query || {};
    if (req.method === 'GET' && query.action === 'companies') {
      res.statusCode = 200;
      return res.end(JSON.stringify({ provider: publicDisclosureProvider.id, companies: publicDisclosureProvider.searchCompanies(query.q) }));
    }
    const result = await getFinancialData({
      company: body.company || query.company,
      period: body.period || query.period,
      refresh: body.refresh === true || query.refresh === '1',
      force: body.force === true || query.force === '1'
    });
    res.statusCode = 200;
    return res.end(JSON.stringify(result));
  } catch (error) {
    if (sendInputError(res, error)) return;
    if (error instanceof FinancialDataError) {
      res.statusCode = error.statusCode;
      return res.end(JSON.stringify({ error: error.code, message: error.message }));
    }
    res.statusCode = 502;
    return res.end(JSON.stringify({ error: 'FINANCIAL_DATA_FAILED', message: '金融数据适配层暂时不可用。' }));
  }
};
