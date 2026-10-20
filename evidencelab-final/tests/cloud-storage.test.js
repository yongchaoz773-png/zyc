'use strict';

const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');
const authHandler = require('../api/auth');
const tasksHandler = require('../api/tasks');
const { buildAnalysis } = require('../lib/engine');
const { buildResearchTask } = require('../lib/research');
const { createTaskStore, taskToRow } = require('../lib/task-store');
const { getAuthenticatedSession } = require('../lib/supabase');

function sampleTask() {
  return buildResearchTask(buildAnalysis('宁德时代2025年营业收入同比增长。', '300750.SZ'));
}
function fetchResponse(payload, status = 200) {
  return { ok: status >= 200 && status < 300, status, async text() { return payload === null ? '' : JSON.stringify(payload); } };
}
function invoke(handler, req) {
  return new Promise((resolve, reject) => {
    const res = { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; }, getHeader(k) { return this.headers[k]; }, end(body) { try { resolve({ status: this.statusCode, body: JSON.parse(body), headers: this.headers }); } catch (error) { reject(error); } } };
    Promise.resolve(handler(req, res)).catch(reject);
  });
}

test('task row derives owner on the server and preserves structured research fields', () => {
  const task = sampleTask();
  task.user_id = 'attacker';
  const row = taskToRow(task, 'server-authenticated-user');
  assert.equal(row.user_id, 'server-authenticated-user');
  assert.equal(row.client_task_id, task.id);
  assert.equal(row.schema_version, 2);
  assert.equal(row.claim, task.thesis.original);
  assert.ok(Array.isArray(row.metric_keys));
});

test('task store sends the user JWT and never a service-role credential', async () => {
  const calls = [];
  const task = sampleTask();
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    const row = { ...taskToRow(task, 'user-1'), id: 'record-1', version: 1, updated_at: '2026-10-20T00:00:00Z' };
    return fetchResponse([row]);
  };
  const store = createTaskStore({ config: { url: 'https://example.supabase.co', key: 'publishable-key' }, accessToken: 'user-jwt', userId: 'user-1', fetchImpl });
  const saved = await store.create(task);
  assert.equal(saved.cloudPersistence.recordId, 'record-1');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer user-jwt');
  assert.equal(calls[0].options.headers.apikey, 'publishable-key');
  assert.equal(JSON.parse(calls[0].options.body).user_id, 'user-1');
});

test('optimistic update reports conflict when the expected version no longer matches', async () => {
  const store = createTaskStore({
    config: { url: 'https://example.supabase.co', key: 'publishable-key' }, accessToken: 'jwt', userId: 'user-1',
    fetchImpl: async (url) => { assert.match(url, /version=eq\.3/); return fetchResponse([]); }
  });
  await assert.rejects(() => store.update('record-1', sampleTask(), 3), error => error.code === 'VERSION_CONFLICT' && error.statusCode === 409);
});

test('task store list, detail, successful update and delete use record and version filters', async () => {
  const task = sampleTask();
  const baseRow = { ...taskToRow(task, 'user-1'), id: 'record-1', version: 1, updated_at: '2026-10-20T00:00:00Z' };
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (options.method === 'PATCH') return fetchResponse([{ ...baseRow, version: 2, updated_at: '2026-10-20T01:00:00Z' }]);
    if (options.method === 'DELETE') return fetchResponse([baseRow]);
    return fetchResponse([baseRow]);
  };
  const store = createTaskStore({ config: { url: 'https://example.supabase.co', key: 'publishable-key' }, accessToken: 'jwt', userId: 'user-1', fetchImpl });
  assert.equal((await store.list()).length, 1);
  assert.equal((await store.get('record-1')).cloudPersistence.recordId, 'record-1');
  assert.equal((await store.update('record-1', task, 1)).cloudPersistence.version, 2);
  assert.deepEqual(await store.remove('record-1', 2), { deleted: true, id: 'record-1' });
  assert.match(calls[1].url, /id=eq\.record-1/);
  assert.match(calls[2].url, /version=eq\.1/);
  assert.equal(Object.hasOwn(JSON.parse(calls[2].options.body), 'user_id'), false);
  assert.match(calls[3].url, /version=eq\.2/);
});

test('task deletion requires an expected version instead of silently overwriting concurrency', async () => {
  const store = createTaskStore({
    config: { url: 'https://example.supabase.co', key: 'publishable-key' }, accessToken: 'jwt', userId: 'user-1',
    fetchImpl: async () => { throw new Error('request must not run'); }
  });
  await assert.rejects(() => store.remove('record-1'), error => error.code === 'VERSION_REQUIRED' && error.statusCode === 422);
});

test('expired access cookie refreshes through Supabase and writes HttpOnly replacement cookies', async () => {
  const req = { headers: { cookie: 'el_access_token=expired; el_refresh_token=refresh-token', 'x-forwarded-proto': 'https' } };
  const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, getHeader(k) { return this.headers[k]; } };
  let call = 0;
  const fetchImpl = async () => {
    call += 1;
    if (call === 1) return fetchResponse({ message: 'expired' }, 401);
    return fetchResponse({ access_token: 'new-access', refresh_token: 'new-refresh', expires_in: 3600, user: { id: 'user-1', email: 'user@example.com' } });
  };
  const session = await getAuthenticatedSession(req, res, { config: { url: 'https://example.supabase.co', key: 'publishable-key' }, fetchImpl });
  assert.equal(session.user.id, 'user-1');
  assert.equal(call, 2);
  assert.equal(res.headers['Set-Cookie'].length, 2);
  assert.ok(res.headers['Set-Cookie'].every(value => /HttpOnly/.test(value) && /Secure/.test(value) && /SameSite=Lax/.test(value)));
});

test('invalid refresh token clears cookies and becomes an explicit expired session', async () => {
  const req = { headers: { cookie: 'el_access_token=expired; el_refresh_token=invalid', 'x-forwarded-proto': 'https' } };
  const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, getHeader(k) { return this.headers[k]; } };
  const fetchImpl = async () => fetchResponse({ message: 'invalid token' }, 401);
  await assert.rejects(
    () => getAuthenticatedSession(req, res, { config: { url: 'https://example.supabase.co', key: 'publishable-key' }, fetchImpl }),
    error => error.code === 'AUTH_REQUIRED' && error.statusCode === 401
  );
  assert.equal(res.headers['Set-Cookie'].length, 2);
  assert.ok(res.headers['Set-Cookie'].every(value => /Max-Age=0/.test(value)));
});

test('local import uses owner-scoped conflict key and reports deduplicated rows', async () => {
  const task = sampleTask();
  let request;
  const store = createTaskStore({
    config: { url: 'https://example.supabase.co', key: 'publishable-key' }, accessToken: 'jwt', userId: 'user-1',
    fetchImpl: async (url, options) => { request = { url, options }; return fetchResponse([]); }
  });
  const result = await store.importLocal([task]);
  assert.match(request.url, /on_conflict=user_id,client_task_id/);
  assert.match(request.options.headers.Prefer, /ignore-duplicates/);
  assert.deepEqual(result, { requested: 1, inserted: 0, skipped: 1, tasks: [] });
});

test('cloud APIs return explicit not-configured status and do not fake success', async () => {
  const beforeUrl = process.env.SUPABASE_URL;
  const beforeKey = process.env.SUPABASE_PUBLISHABLE_KEY;
  delete process.env.SUPABASE_URL; delete process.env.SUPABASE_PUBLISHABLE_KEY;
  try {
    const auth = await invoke(authHandler, { method: 'GET', query: {}, headers: {} });
    const tasks = await invoke(tasksHandler, { method: 'GET', query: {}, headers: {} });
    assert.equal(auth.status, 503); assert.equal(auth.body.error, 'CLOUD_NOT_CONFIGURED');
    assert.equal(tasks.status, 503); assert.equal(tasks.body.error, 'CLOUD_NOT_CONFIGURED');
  } finally {
    if (beforeUrl === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = beforeUrl;
    if (beforeKey === undefined) delete process.env.SUPABASE_PUBLISHABLE_KEY; else process.env.SUPABASE_PUBLISHABLE_KEY = beforeKey;
  }
});

test('cookie-authenticated write APIs reject cross-site browser requests before processing', async () => {
  const headers = { origin: 'https://attacker.example', host: 'evidencelab.example', 'x-forwarded-proto': 'https', 'sec-fetch-site': 'cross-site' };
  const auth = await invoke(authHandler, { method: 'POST', query: { action: 'logout' }, headers, body: {} });
  const tasks = await invoke(tasksHandler, { method: 'POST', query: {}, headers, body: { task: sampleTask() } });
  assert.equal(auth.status, 403); assert.equal(auth.body.error, 'CSRF_REJECTED');
  assert.equal(tasks.status, 403); assert.equal(tasks.body.error, 'CSRF_REJECTED');
});

test('database migration enables owner-only RLS and rollback is present', () => {
  const root = path.join(__dirname, '..');
  const sql = fs.readFileSync(path.join(root, 'supabase', 'migrations', '001_research_tasks.sql'), 'utf8');
  assert.match(sql, /enable row level security/i);
  assert.match(sql, /force row level security/i);
  assert.match(sql, /to authenticated/i);
  assert.match(sql, /auth\.uid\(\)\) = user_id/g);
  assert.match(sql, /revoke all on table public\.research_tasks from anon/i);
  assert.ok(fs.existsSync(path.join(root, 'supabase', 'rollback', '001_research_tasks.down.sql')));
});
