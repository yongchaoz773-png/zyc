'use strict';

const { assertSameOrigin, readJsonBody, sendInputError } = require('../lib/http');
const { getAuthenticatedSession, SupabaseError } = require('../lib/supabase');
const { createTaskStore } = require('../lib/task-store');

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  try {
    assertSameOrigin(req);
    const session = await getAuthenticatedSession(req, res);
    const store = createTaskStore({ config: session.config, accessToken: session.accessToken, userId: session.user.id });
    const action = String(req.query?.action || '').toLowerCase();
    let output;
    if (req.method === 'GET') output = req.query?.id ? await store.get(req.query.id) : await store.list();
    else if (req.method === 'POST') {
      const body = readJsonBody(req);
      output = action === 'import' ? await store.importLocal(body.tasks) : await store.create(body.task);
    } else if (req.method === 'PATCH') {
      const body = readJsonBody(req);
      output = await store.update(req.query?.id || body.id, body.task, Number(body.expectedVersion));
    } else if (req.method === 'DELETE') {
      const body = readJsonBody(req);
      output = await store.remove(req.query?.id || body.id, body.expectedVersion === undefined ? undefined : Number(body.expectedVersion));
    } else {
      res.statusCode = 405;
      return res.end(JSON.stringify({ error: 'METHOD_NOT_ALLOWED', message: '不支持该任务操作。' }));
    }
    res.statusCode = 200;
    return res.end(JSON.stringify(output));
  } catch (error) {
    if (sendInputError(res, error)) return;
    if (error instanceof SupabaseError) {
      res.statusCode = error.statusCode;
      return res.end(JSON.stringify({ error: error.code, message: error.message }));
    }
    res.statusCode = 500;
    return res.end(JSON.stringify({ error: 'TASK_STORAGE_FAILED', message: '云端任务服务暂时不可用，未写入虚假成功记录。' }));
  }
};
