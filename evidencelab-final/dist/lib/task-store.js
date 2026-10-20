'use strict';

const { validateResearchTask } = require('./research');
const { SupabaseError, baseHeaders, requestJson } = require('./supabase');

function taskToRow(task, userId) {
  const validation = validateResearchTask(task);
  if (!validation.ok) throw new SupabaseError('INVALID_TASK', validation.errors.join('；'), 422);
  return {
    user_id: userId,
    client_task_id: String(task.id),
    claim: String(task.thesis.original),
    company_name: task.thesis.subject?.name || null,
    company_code: task.thesis.subject?.ticker || null,
    current_period: task.thesis.period?.current || null,
    comparison_period: task.thesis.period?.compare || null,
    metric_keys: (task.thesis.metrics || []).map(item => typeof item === 'string' ? item : item.key).filter(Boolean),
    status: task.status || 'researching',
    schema_version: task.schemaVersion,
    subquestions: task.subquestions || [],
    evidence: task.evidence || [],
    sources: task.sources || [],
    conclusions: task.conclusions || [],
    model_status: task.analysis?.llmStatus || {},
    rule_result: {
      verdictKey: task.analysis?.verdictKey || null,
      supported: Boolean(task.analysis?.supported),
      evidenceStrength: task.analysis?.evidenceStrength ?? null,
      calculations: task.analysis?.calculations || {},
      missingEvidence: task.analysis?.missingEvidence || [],
      dataCompleteness: task.analysis?.dataCompleteness || null,
      mode: task.analysis?.mode || 'rules_only'
    },
    data_snapshot: task.dataSnapshot || {},
    task_payload: task,
    last_researched_at: task.lastResearchAt || task.updatedAt || new Date().toISOString()
  };
}

function rowToTask(row) {
  const task = JSON.parse(JSON.stringify(row.task_payload));
  task.status = row.status;
  task.updatedAt = row.updated_at;
  task.cloudPersistence = { recordId: row.id, version: row.version, updatedAt: row.updated_at };
  return task;
}

function createTaskStore({ config, accessToken, userId, fetchImpl = global.fetch }) {
  if (!userId || !accessToken) throw new SupabaseError('AUTH_REQUIRED', '缺少已验证的用户会话。', 401);
  const baseUrl = `${config.url}/rest/v1/research_tasks`;
  const headers = extra => ({ ...baseHeaders(config, accessToken), ...extra });
  const call = (url, options) => requestJson(url, options, fetchImpl);

  return {
    async list() {
      const { payload } = await call(`${baseUrl}?select=*&order=updated_at.desc&limit=100`, { method: 'GET', headers: headers() });
      return (payload || []).map(rowToTask);
    },
    async get(id) {
      const { payload } = await call(`${baseUrl}?id=eq.${encodeURIComponent(id)}&select=*`, { method: 'GET', headers: headers() });
      if (!payload?.length) throw new SupabaseError('TASK_NOT_FOUND', '任务不存在或无权访问。', 404);
      return rowToTask(payload[0]);
    },
    async create(task) {
      const row = taskToRow(task, userId);
      const { payload } = await call(baseUrl, {
        method: 'POST', headers: headers({ Prefer: 'return=representation' }), body: JSON.stringify(row)
      });
      return rowToTask(payload[0]);
    },
    async update(id, task, expectedVersion) {
      if (!Number.isInteger(expectedVersion) || expectedVersion < 1) throw new SupabaseError('VERSION_REQUIRED', '更新云端任务必须提供有效的 expectedVersion。', 422);
      const row = taskToRow(task, userId);
      delete row.user_id;
      row.version = expectedVersion + 1;
      const { payload } = await call(`${baseUrl}?id=eq.${encodeURIComponent(id)}&version=eq.${expectedVersion}`, {
        method: 'PATCH', headers: headers({ Prefer: 'return=representation' }), body: JSON.stringify(row)
      });
      if (!payload?.length) throw new SupabaseError('VERSION_CONFLICT', '云端任务已被其他会话更新，请刷新后再试。', 409);
      return rowToTask(payload[0]);
    },
    async remove(id, expectedVersion) {
      if (!Number.isInteger(expectedVersion) || expectedVersion < 1) throw new SupabaseError('VERSION_REQUIRED', '删除云端任务必须提供有效的 expectedVersion。', 422);
      const { payload } = await call(`${baseUrl}?id=eq.${encodeURIComponent(id)}&version=eq.${expectedVersion}`, {
        method: 'DELETE', headers: headers({ Prefer: 'return=representation' })
      });
      if (!payload?.length) throw new SupabaseError('VERSION_CONFLICT', '云端任务版本冲突，请刷新后再试。', 409);
      return { deleted: true, id };
    },
    async importLocal(tasks) {
      if (!Array.isArray(tasks) || tasks.length < 1 || tasks.length > 20) throw new SupabaseError('INVALID_IMPORT', '一次只能导入 1 至 20 个任务。', 422);
      const rows = tasks.map(task => taskToRow(task, userId));
      const { payload } = await call(`${baseUrl}?on_conflict=user_id,client_task_id`, {
        method: 'POST', headers: headers({ Prefer: 'resolution=ignore-duplicates,return=representation' }), body: JSON.stringify(rows)
      });
      return { requested: rows.length, inserted: payload?.length || 0, skipped: rows.length - (payload?.length || 0), tasks: (payload || []).map(rowToTask) };
    }
  };
}

module.exports = { createTaskStore, rowToTask, taskToRow };
