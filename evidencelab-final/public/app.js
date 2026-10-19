(() => {
  'use strict';
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const STORAGE_KEY = 'evidencelab.tasks.v2';
  const LEGACY_KEY = 'evidencelab.tasks.v1';
  const state = { analysis: null, task: null, tab: 'support', busy: false, filters: { type: '', source: '' }, lastSubmit: '' };
  let toastTimer;

  function esc(value) {
    return String(value ?? '').replace(/[&<>'"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[ch]));
  }
  function toast(message) {
    const node = $('#toast'); node.textContent = message; node.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => node.classList.remove('show'), 2800);
  }
  function openModal(title, kicker, html) {
    $('#modal-title').textContent = title; $('#modal-kicker').textContent = kicker; $('#modal-body').innerHTML = html;
    $('#modal-backdrop').classList.remove('hidden');
  }
  function closeModal() { $('#modal-backdrop').classList.add('hidden'); }
  function sourceById(id) { return (state.analysis?.sources || []).find(source => source.id === id); }
  async function api(url, options = {}) {
    const response = await fetch(url, { ...options, headers: { 'Content-Type': 'application/json', ...(options.headers || {}) } });
    let payload = {};
    try { payload = await response.json(); } catch (_) { payload = { message: '服务返回了无法解析的内容。' }; }
    if (!response.ok) { const error = new Error(payload.message || `请求失败（${response.status}）`); error.payload = payload; error.status = response.status; throw error; }
    return payload;
  }
  function download(name, content, type) {
    const url = URL.createObjectURL(new Blob(['\ufeff', content], { type }));
    const link = document.createElement('a'); link.href = url; link.download = name; document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url);
  }

  function readTasks() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (!parsed || parsed.schemaVersion !== 2 || !Array.isArray(parsed.tasks)) throw new Error('存储结构不受支持');
        return parsed.tasks;
      }
      const legacy = localStorage.getItem(LEGACY_KEY);
      if (legacy) {
        const parsed = JSON.parse(legacy);
        const tasks = Array.isArray(parsed) ? parsed.map(item => ({ ...item, schemaVersion: 1, legacy: true })) : [];
        writeTasks(tasks); return tasks;
      }
      return [];
    } catch (error) {
      try { const raw = localStorage.getItem(STORAGE_KEY); if (raw) localStorage.setItem(`${STORAGE_KEY}.corrupt.${Date.now()}`, raw); localStorage.removeItem(STORAGE_KEY); } catch (_) {}
      toast('检测到损坏或旧版存储，已隔离并回到空任务列表。'); return [];
    }
  }
  function writeTasks(tasks) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ schemaVersion: 2, savedAt: new Date().toISOString(), tasks })); return true; }
    catch (_) { toast('浏览器本地存储不可用，请改用 JSON 导出。'); return false; }
  }
  function updateTaskCount() { $('#task-count').textContent = readTasks().length; }

  function setBusy(busy) {
    state.busy = busy; const button = $('#verify-button'); button.disabled = busy;
    button.innerHTML = busy ? '正在核验…' : '<span>⌕</span> 验证命题 <span class="button-arrow">→</span>';
  }
  async function verifyClaim(claim, options = {}) {
    const clean = String(claim || '').trim();
    if (!clean) { toast('请输入需要验证的投资命题。'); $('#claim-input').focus(); return; }
    if (clean.length > 1200) { toast('命题不能超过 1200 个字符。'); return; }
    const fingerprint = `${clean}|${options.company || '300750.SZ'}`;
    if (state.busy || (state.lastSubmit === fingerprint && Date.now() - (state.lastSubmitAt || 0) < 1200)) { toast('相同任务正在处理，请勿重复提交。'); return; }
    state.lastSubmit = fingerprint; state.lastSubmitAt = Date.now(); setBusy(true);
    $('#analysis-status').textContent = '正在解析命题并构建证据链…';
    try {
      const result = await api('/api/analyze', { method: 'POST', body: JSON.stringify({ claim: clean, company: options.company || '300750.SZ' }) });
      renderAnalysis(result); toast(result.supported ? '命题已拆解，证据链已更新。' : '需要补充关键信息；系统未生成未经核验的结论。');
    } catch (error) {
      $('#analysis-status').textContent = `核验失败 · ${error.payload?.error || error.status || '网络异常'}`;
      $('#clarification-box').innerHTML = `<strong>暂未覆盖本次分析</strong><p>${esc(error.message)}</p><p>已有结果仍保留；接口失败不会被记为反对证据。</p>`;
      $('#clarification-box').classList.remove('hidden'); toast(error.message);
    } finally { setBusy(false); }
  }

  function renderAnalysis(result) {
    state.analysis = result; state.task = result.researchTask || null; state.tab = 'support'; state.filters = { type: '', source: '' };
    $('#claim-input').value = result.claim || '';
    $('#analysis-id').textContent = state.task?.id || `EV-${Date.now().toString(36).toUpperCase()}`;
    $('#analysis-status').textContent = result.supported ? '命题已拆解 · 证据链已生成' : '信息不足 · 等待澄清';
    $('#ai-mode-pill').textContent = result.mode === 'llm+rules' ? '模型解析 + 规则裁决' : '可解释规则引擎';
    $('#verdict-kicker').textContent = result.supported ? '部分支持 · 保留归因边界' : '证据不足 · 不作确定判断';
    $('#verdict-title').innerHTML = esc(result.verdictTitle || result.verdict || '暂无法验证').replace(/\n/g, '<br>');
    $('#verdict-summary').textContent = result.summary || '';
    $('#score-value').textContent = Number(result.evidenceStrength || 0);
    const progress = $('.score-progress'); if (progress) progress.style.strokeDasharray = `${result.evidenceStrength || 0} 100`;
    renderClarifications(result); renderSubquestions(); renderEvidenceFilters(); renderEvidence(); renderConditions(); renderSemanticPlan(result.semanticPlan);
  }
  function renderClarifications(result) {
    const box = $('#clarification-box');
    if (!result.needsClarification) { box.classList.add('hidden'); box.innerHTML = ''; return; }
    box.innerHTML = `<strong>先澄清 3 个关键条件</strong><p>${esc((result.clarifications || []).join('；'))}</p><div class="field-grid"><label class="field-group"><span>公司/代码</span><input class="field-input" id="clarify-company" placeholder="如：300750.SZ"></label><label class="field-group"><span>报告期</span><input class="field-input" id="clarify-period" placeholder="如：2025年度同比"></label></div><label class="field-group"><span>指标口径</span><select class="field-select" id="clarify-metric"><option>扣非归母净利润</option><option>归母净利润</option><option>经营现金流</option><option>主营毛利率</option></select></label><button class="outline-button small" data-action="apply-clarification">应用澄清并重新拆解</button>`;
    box.classList.remove('hidden');
  }
  function renderSemanticPlan(plan) {
    const node = $('#semantic-plan');
    if (!plan) { node.classList.add('hidden'); node.innerHTML = ''; return; }
    node.innerHTML = `<strong>模型仅参与语义拆解</strong><p>${esc(plan.normalizedClaim)}</p><p>${esc(plan.trustBoundary)}</p>`; node.classList.remove('hidden');
  }
  function renderSubquestions() {
    const items = state.task?.subquestions || state.analysis?.subquestions || [];
    $('#verified-count').textContent = items.filter(q => !/待验证|无法验证/.test(q.evidenceStatus || q.status)).length;
    $('#subquestion-list').innerHTML = items.map((q, index) => {
      const status = q.evidenceStatus || q.status || '待验证';
      const className = /反向/.test(status) ? 'status-oppose' : /无法|待验证/.test(status) ? 'status-unknown' : 'status-support';
      const action = className === 'status-oppose' ? 'show-oppose' : className === 'status-unknown' ? 'show-unknown' : 'show-support';
      return `<div class="subquestion"><span class="subq-index">${String(index + 1).padStart(2, '0')}</span><div class="subq-body"><strong>${esc(q.question)}</strong><span>${esc(q.requiredEvidence || q.criterion || '验证目标与所需材料')}</span></div><span class="status-pill ${className}">${esc(status)}</span><button class="tiny-icon-button" data-action="${action}">↗</button></div>`;
    }).join('');
  }
  function renderEvidenceFilters() {
    const all = state.task?.evidence || ['support','oppose','unknown'].flatMap(key => state.analysis?.evidence?.[key] || []);
    const types = [...new Set(all.map(item => item.evidenceType || item.tag).filter(Boolean))];
    const sources = [...new Set(all.map(item => item.sourceId).filter(Boolean))];
    $('#filter-type').innerHTML = '<option value="">全部</option>' + types.map(value => `<option value="${esc(value)}">${esc(value)}</option>`).join('');
    $('#filter-source').innerHTML = '<option value="">全部</option>' + sources.map(id => `<option value="${esc(id)}">${esc(sourceById(id)?.title || id)}</option>`).join('');
  }
  function evidenceForTab() {
    if (state.task?.evidence) return state.task.evidence.filter(item => item.direction === state.tab);
    return state.analysis?.evidence?.[state.tab] || [];
  }
  function renderEvidence() {
    ['support','oppose','unknown'].forEach(key => { $(`[data-tab="${key}"]`)?.classList.toggle('active', state.tab === key); $(`#${key}-count`).textContent = state.analysis?.evidence?.[key]?.length || 0; });
    let items = evidenceForTab();
    if (state.filters.type) items = items.filter(item => (item.evidenceType || item.tag) === state.filters.type);
    if (state.filters.source) items = items.filter(item => item.sourceId === state.filters.source);
    const label = state.tab === 'support' ? '支持' : state.tab === 'oppose' ? '反对' : '无法验证';
    $('#evidence-list').innerHTML = items.length ? items.map((item, index) => {
      const source = sourceById(item.sourceId) || {};
      const formula = item.formula ? `<details><summary>展开计算公式与输入</summary><div class="formula-box">${esc(item.formula)}</div>${(item.metrics || []).map(metric => `<span class="citation-chip">${esc(metric.label)}：${esc(metric.value)}</span>`).join('')}</details>` : '';
      return `<article class="evidence-card"><div class="evidence-card-head"><span class="evidence-id ${state.tab}">${esc(item.id || `${label}-${index + 1}`)}</span><div class="evidence-title-copy"><h3>${esc(item.title)}</h3><div class="evidence-meta"><span class="type-label ${state.tab}">${label}</span><span>${esc(item.evidenceType || item.tag || '')}</span><span class="strength-label">可靠性：${esc(item.reliability || item.strength || '待评估')}</span></div></div></div><p class="evidence-finding"><b>原始事实/数值：</b>${esc(item.originalValueOrExcerpt || item.finding)}</p><p class="evidence-reasoning"><b>规则解释：</b>${esc(item.reasoning)}</p>${formula}<div class="evidence-source-row"><div class="evidence-source"><b>${esc(source.title || item.sourceTitle || item.sourceId)}</b><span>${esc(source.publishedAt || item.publishedAt || '')}</span><span>${esc(item.location || '')}</span></div>${source.url ? `<button class="source-link" data-source="${esc(item.sourceId)}">查看原始材料 ↗</button>` : ''}</div></article>`;
    }).join('') : '<div class="integrity-banner">当前筛选下没有证据。缺少证据不等于命题错误，也不会自动归入反对。</div>';
  }
  function renderConditions() {
    const items = state.task?.changeConditions || (state.analysis?.changeConditions || []).map((x, i) => ({ ...x, id: `CC${i + 1}`, triggerThreshold: x.trigger, possibleDirection: x.impact }));
    $('#change-list').innerHTML = items.slice(0, 3).map(item => `<div class="change-item"><span class="change-symbol ${/下调|削弱|反转/.test(item.possibleDirection || item.impact) ? 'red-symbol' : 'amber-symbol'}">!</span><div><strong>${esc(item.title)}</strong><p>${esc(item.triggerThreshold || item.trigger)}</p></div></div>`).join('');
  }

  function showSources() {
    const html = (state.analysis?.sources || []).map(source => `<details><summary>${esc(source.title)}</summary><p><b>发布方：</b>${esc(source.publisher)}　<b>日期：</b>${esc(source.publishedAt)}</p><p><b>材料类型：</b>${esc(source.type)}　<b>定位：</b>${esc((source.sections || []).join('；'))}</p><p>${esc(source.note)}</p><p><a href="${esc(source.url)}" target="_blank" rel="noopener noreferrer">打开原始来源 ↗</a></p></details>`).join('');
    openModal('数据来源与可追溯性', 'SOURCE REGISTRY', `${html}<div class="integrity-banner">公开披露为历史快照；扶摇与 iFinD MCP 未授权、未接通。页面不会把快照称为实时数据。</div>`);
  }
  function sourceModal(id) {
    const source = sourceById(id); if (!source) { toast('来源信息不存在。'); return; }
    openModal(source.title, 'PRIMARY SOURCE', `<p><b>发布方：</b>${esc(source.publisher)}</p><p><b>发布日期：</b>${esc(source.publishedAt)}</p><p><b>章节定位：</b>${esc((source.sections || []).join('；'))}</p><p>${esc(source.note)}</p><p><a href="${esc(source.url)}" target="_blank" rel="noopener noreferrer">打开原始文件 ↗</a></p>`);
  }
  function showConflicts() {
    const items = state.task?.conflicts || [];
    openModal('证据冲突记录', 'CONFLICT REVIEW', items.length ? items.map(item => `<details open><summary>${esc(item.id)} · ${esc(item.resolutionStatus)}</summary><p><b>冲突原因：</b>${esc(item.reason)}</p><p><b>支持侧能证明：</b>${esc(item.eachSideCanProve?.support)}</p><p><b>反对侧能证明：</b>${esc(item.eachSideCanProve?.oppose)}</p><p><b>裁决规则：</b>${esc(item.preferredEvidence)}</p><p><b>仍未解决：</b>${esc(item.unresolved)}</p><p><b>所需补充：</b>${esc(item.requiredData)}</p></details>`).join('') : '<div class="integrity-banner">当前任务没有可裁决的冲突；可能因为证据不足，而不是证据一致。</div>');
  }
  function showConditions() {
    const items = state.task?.changeConditions || [];
    openModal('结论变化条件', 'CHANGE CONDITIONS', `<p>所有阈值均为可配置研究假设，不是行业公认标准或自动监控承诺。</p><div id="condition-editor">${items.map((item, i) => `<div class="editor-row"><div><input class="field-input condition-title" data-index="${i}" value="${esc(item.title)}"><textarea class="field-textarea condition-trigger" data-index="${i}">${esc(item.triggerThreshold)}</textarea><small>${esc(item.thresholdBasis)}</small></div><button class="text-button danger-text" data-remove-condition="${i}">删除</button></div>`).join('')}</div><div class="editor-actions"><button class="outline-button small" data-action="add-condition">新增条件</button><button class="primary-button small" data-action="save-conditions">保存修改</button></div>`);
  }
  function editSubquestions() {
    const items = state.task?.subquestions || [];
    openModal('编辑验证计划', 'SUBQUESTION EDITOR', `<p>可修改、删除或新增子问题。保存后会提升命题版本并写入审计记录。</p><div id="subquestion-editor">${items.map((item, i) => `<div class="editor-row"><div><input class="field-input subq-text" data-index="${i}" value="${esc(item.question)}"><input class="field-input subq-criterion" data-index="${i}" value="${esc(item.criterion || '')}" placeholder="判定标准"></div><button class="text-button danger-text" data-remove-subquestion="${i}">删除</button></div>`).join('')}</div><div class="editor-actions"><button class="outline-button small" data-action="add-subquestion">新增子问题</button><button class="primary-button small" data-action="save-subquestions">保存并生成新版本</button></div>`);
  }

  function saveCurrentTask() {
    if (!state.task) { toast('请先完成一次命题验证。'); return; }
    const tasks = readTasks(); const snapshot = JSON.parse(JSON.stringify(state.task)); snapshot.updatedAt = new Date().toISOString(); snapshot.lastResearchAt = snapshot.updatedAt;
    const index = tasks.findIndex(item => item.id === snapshot.id);
    if (index >= 0) { snapshot.version = Math.max(Number(tasks[index].version || 1), Number(snapshot.version || 1)) + 1; snapshot.auditEvents.push({ id: `AUDIT-${snapshot.auditEvents.length + 1}`, type: 'TASK_SAVED', at: snapshot.updatedAt, version: snapshot.version, detail: '覆盖保存当前研究状态' }); tasks[index] = snapshot; }
    else tasks.unshift(snapshot);
    if (writeTasks(tasks)) { state.task = snapshot; updateTaskCount(); toast(index >= 0 ? '任务已更新并保留新版本。' : '研究任务已保存到当前浏览器。'); }
  }
  function listTasks() {
    const tasks = readTasks(); updateTaskCount();
    const html = tasks.length ? tasks.map(task => `<article class="task-row"><div class="task-row-head"><div><strong>${esc(task.thesis?.revised || task.claim || '旧版任务')}</strong><p>${esc(task.thesis?.subject?.name || task.company || '待确认')} · ${esc(task.conclusions?.at(-1)?.status || task.verdict || '待验证')} · v${esc(task.version || 1)}</p><small>更新：${esc(new Date(task.updatedAt || task.savedAt || Date.now()).toLocaleString('zh-CN'))}　待验证：${esc(task.unresolvedQuestions?.length || 0)}</small></div><span class="status-pill status-unknown">${esc(task.status || 'researching')}</span></div><div class="task-actions"><button class="text-button" data-restore-task="${esc(task.id)}">恢复任务</button><button class="text-button" data-revalidate-task="${esc(task.id)}">重新验证</button><button class="text-button" data-complete-task="${esc(task.id)}">标记完成</button><button class="text-button danger-text" data-delete-task="${esc(task.id)}">删除</button></div></article>`).join('') : '<div class="integrity-banner">暂无已保存任务。任务会保存在当前浏览器，也可导出 JSON 备份。</div>';
    openModal('研究任务', 'LOCAL TASKS', html);
  }
  function restoreTask(id) {
    const task = readTasks().find(item => item.id === id); if (!task || !task.analysis) { toast('该任务为旧版或数据不完整，请重新验证。'); return; }
    renderAnalysis({ ...task.analysis, researchTask: task }); closeModal(); toast('已恢复研究任务。');
  }
  function mutateStoredTask(id, operation) {
    const tasks = readTasks(); const index = tasks.findIndex(item => item.id === id); if (index < 0) return;
    if (operation === 'delete') tasks.splice(index, 1);
    if (operation === 'complete') { tasks[index].status = 'completed'; tasks[index].updatedAt = new Date().toISOString(); }
    writeTasks(tasks); listTasks();
  }
  function revalidateTask(id) {
    const task = readTasks().find(item => item.id === id); if (!task) return;
    closeModal(); verifyClaim(task.thesis?.original || task.claim, { company: task.thesis?.subject?.ticker || '300750.SZ' });
  }

  function buildMarkdown() {
    const task = state.task; if (!task) return '';
    const conclusion = task.conclusions.at(-1);
    const group = direction => task.evidence.filter(item => item.direction === direction).map(item => `- **[${item.id}] ${item.title}**：${item.originalValueOrExcerpt}\n  - 解释与边界：${item.reasoning}\n  - 来源：${item.sourceTitle}（${item.sourceUrl || '无链接'}）`).join('\n');
    return `# EvidenceLab 研究纪要\n\n- 任务 ID：${task.id}\n- Schema：v${task.schemaVersion}\n- 命题版本：v${task.thesis.version}\n- 结论版本：v${conclusion.version}\n- 研究时间：${task.lastResearchAt}\n- 数据截止：${task.dataSnapshot.asOf || '待确认'}\n- 数据模式：历史公开披露快照（非实时）\n\n## 原始命题\n\n${task.thesis.original}\n\n## 修订命题\n\n${task.thesis.revised}\n\n## 结论\n\n**${conclusion.status}**\n\n${conclusion.rationale}\n\n适用边界：${conclusion.applicability}\n\n## 支持证据\n\n${group('support')}\n\n## 反对证据\n\n${group('oppose')}\n\n## 无法验证\n\n${group('unknown')}\n\n## 冲突记录\n\n${task.conflicts.map(x => `- **${x.id}**：${x.reason}（${x.resolutionStatus}）`).join('\n')}\n\n## 结论变化条件\n\n${task.changeConditions.map(x => `- **${x.id} ${x.title}**：${x.triggerThreshold}\n  - 依据：${x.thresholdBasis}\n  - 影响：${x.possibleDirection}`).join('\n')}\n\n## 合规说明\n\n仅用于研究辅助，不构成投资建议；缺失数据不等于反证。`;
  }
  function exportMarkdown() { if (!state.task) { toast('暂无可导出的研究任务。'); return; } download(`${state.task.id}.md`, buildMarkdown(), 'text/markdown;charset=utf-8'); toast('已导出 Markdown 研究纪要。'); }
  function exportJson() { if (!state.task) { toast('暂无可导出的研究任务。'); return; } download(`${state.task.id}.json`, JSON.stringify(state.task, null, 2), 'application/json;charset=utf-8'); toast('已导出完整 JSON 研究任务。'); }

  async function compare() {
    openModal('继续比较', 'PERIOD COMPARISON', '<p>正在统一期间、单位与口径…</p>');
    try {
      const result = await api('/api/compare');
      const rows = result.metrics.map(item => `<tr><td>${esc(item.label)}</td><td>${esc((item.current / 100000).toFixed(2))} 亿元</td><td>${esc((item.previous / 100000).toFixed(2))} 亿元</td><td>${esc(item.growth.toFixed(2))}%</td></tr>`).join('');
      $('#modal-body').innerHTML = `<table><thead><tr><th>指标</th><th>本期</th><th>同期</th><th>同比</th></tr></thead><tbody>${rows}</tbody></table><div class="modal-callout">${esc(result.insight)}</div><p><b>口径说明：</b>${esc(result.disclaimer)}</p><p><a href="${esc(result.source.url)}" target="_blank" rel="noopener noreferrer">打开来源 ↗</a></p>`;
    } catch (error) { $('#modal-body').innerHTML = `<div class="integrity-banner">${esc(error.message)} 比较失败不会被视为反证。</div>`; }
  }
  async function answerFollowup(question) {
    const clean = String(question || '').trim(); if (!clean) { toast('请输入要追问的问题。'); return; }
    const output = $('#followup-answer'); output.textContent = '正在限定在当前证据范围内回答…'; output.classList.remove('hidden');
    try {
      const result = await api('/api/followup', { method: 'POST', body: JSON.stringify({ question: clean, taskId: state.task?.id }) });
      output.innerHTML = `<div>${esc(result.answer)}</div>${result.citations?.length ? `<div class="citation-chips">${result.citations.map(id => `<span class="citation-chip">引用 ${esc(id)}</span>`).join('')}</div>` : `<div class="integrity-banner">${esc(result.missingInformation?.join('；'))}</div>`}`;
    } catch (error) { output.textContent = error.message; }
  }
  function showDisclaimer() {
    openModal('数据、AI 与合规边界', 'LIMITATIONS', '<h3>数据</h3><p>当前仅使用巨潮资讯公开定期报告的历史快照，不是实时行情。扶摇、iFinD MCP 均未接入。</p><h3>AI</h3><p>默认使用确定性规则引擎；可选模型只做命题语义拆解，不能覆盖财务事实、证据分类和最终裁决。</p><h3>结论</h3><p>证据充分度是透明规则覆盖度，不是概率。工具不提供买卖建议、收益承诺或自动交易。</p><h3>监测</h3><p>当前为手动重新验证与定期复核，没有后台实时监控或通知能力。</p>');
  }
  function showErrorSimulator() {
    openModal('接口异常演练', 'RESILIENCE LAB', `<p>点击状态码调用真实本地 API 的模拟分支。已有分析会保留，失败只会标记为“无法验证”。</p><div class="error-demo-grid">${['401','403','429','500','503','empty','schema'].map(code => `<button data-simulate="${code}">${code}</button>`).join('')}</div><div id="simulation-result" class="integrity-banner hidden"></div>`);
  }
  async function runSimulation(code) {
    const output = $('#simulation-result'); output.classList.remove('hidden'); output.textContent = '请求中…';
    try { await api(`/api/analyze?simulate=${encodeURIComponent(code)}`, { method: 'POST', body: JSON.stringify({ claim: $('#claim-input').value }) }); }
    catch (error) { output.textContent = `${error.status} · ${error.payload?.error}：${error.message}；证据影响：无法验证，不归为反对。`; }
  }

  document.addEventListener('change', event => {
    if (event.target.id === 'filter-type') { state.filters.type = event.target.value; renderEvidence(); }
    if (event.target.id === 'filter-source') { state.filters.source = event.target.value; renderEvidence(); }
  });
  document.addEventListener('click', event => {
    const tab = event.target.closest('[data-tab]');
    if (tab) { state.tab = tab.dataset.tab; renderEvidence(); return; }
    const source = event.target.closest('[data-source]'); if (source) { sourceModal(source.dataset.source); return; }
    const example = event.target.closest('[data-example]'); if (example) { $('#claim-input').value = example.dataset.example; $('#example-menu').classList.add('hidden'); return; }
    const question = event.target.closest('[data-question]'); if (question) { $('#followup-input').value = question.dataset.question; answerFollowup(question.dataset.question); return; }
    const simulate = event.target.closest('[data-simulate]'); if (simulate) { runSimulation(simulate.dataset.simulate); return; }
    const restore = event.target.closest('[data-restore-task]'); if (restore) { restoreTask(restore.dataset.restoreTask); return; }
    const revalidate = event.target.closest('[data-revalidate-task]'); if (revalidate) { revalidateTask(revalidate.dataset.revalidateTask); return; }
    const complete = event.target.closest('[data-complete-task]'); if (complete) { mutateStoredTask(complete.dataset.completeTask, 'complete'); return; }
    const remove = event.target.closest('[data-delete-task]'); if (remove) { mutateStoredTask(remove.dataset.deleteTask, 'delete'); return; }
    const removeSubq = event.target.closest('[data-remove-subquestion]'); if (removeSubq) { removeSubq.closest('.editor-row').remove(); return; }
    const removeCondition = event.target.closest('[data-remove-condition]'); if (removeCondition) { removeCondition.closest('.editor-row').remove(); return; }
    const action = event.target.closest('[data-action]')?.dataset.action; if (!action) return;
    if (action === 'close-modal') closeModal();
    if (action === 'examples') $('#example-menu').classList.toggle('hidden');
    if (action === 'revise') { $('#claim-input').focus(); $('#claim-input').select(); }
    if (action === 'new-task') { $('#claim-input').value = ''; $('#claim-input').focus(); toast('请输入新命题；当前已保存任务不会被删除。'); }
    if (action === 'export') exportMarkdown();
    if (action === 'export-json') exportJson();
    if (action === 'save') saveCurrentTask();
    if (action === 'compare') compare();
    if (action === 'conditions') showConditions();
    if (action === 'conflicts' || action === 'verdict-detail') showConflicts();
    if (action === 'sources') showSources();
    if (action === 'edit-subquestions') editSubquestions();
    if (action === 'disclaimer' || action === 'help') showDisclaimer();
    if (action === 'simulate-error') showErrorSimulator();
    if (action === 'clear-filters') { state.filters = { type: '', source: '' }; $('#filter-type').value = ''; $('#filter-source').value = ''; renderEvidence(); }
    if (/^show-(support|oppose|unknown)$/.test(action)) { state.tab = action.replace('show-', ''); renderEvidence(); $('#evidence-panel').scrollIntoView({ behavior: 'smooth' }); }
    if (action === 'copy-id') navigator.clipboard?.writeText($('#analysis-id').textContent).then(() => toast('分析编号已复制。')).catch(() => toast($('#analysis-id').textContent));
    if (action === 'apply-clarification') {
      const company = $('#clarify-company')?.value.trim(); const period = $('#clarify-period')?.value.trim(); const metric = $('#clarify-metric')?.value;
      const claim = `${company || '宁德时代'}${period || '2025年度'}${metric}是否主要由主营业务改善驱动？`; closeModal(); verifyClaim(claim, { company: company || '300750.SZ' });
    }
    if (action === 'add-subquestion') $('#subquestion-editor').insertAdjacentHTML('beforeend', '<div class="editor-row"><div><input class="field-input subq-text" placeholder="新的可验证子问题"><input class="field-input subq-criterion" placeholder="判定标准"></div><button class="text-button danger-text" data-remove-subquestion="new">删除</button></div>');
    if (action === 'save-subquestions' && state.task) {
      const rows = $$('.editor-row', $('#subquestion-editor'));
      const next = rows.map((row, i) => ({ ...(state.task.subquestions[i] || {}), id: state.task.subquestions[i]?.id || `q${i + 1}`, question: $('.subq-text', row).value.trim(), criterion: $('.subq-criterion', row).value.trim(), status: state.task.subquestions[i]?.status || '待验证', evidenceStatus: state.task.subquestions[i]?.evidenceStatus || '待验证' })).filter(item => item.question);
      if (next.length < 3 || next.length > 6) { toast('验证计划应保留 3–6 个子问题。'); return; }
      state.task.subquestions = next; state.task.thesis.version += 1; state.task.version += 1; state.task.auditEvents.push({ id: `AUDIT-${state.task.auditEvents.length + 1}`, type: 'SUBQUESTIONS_EDITED', at: new Date().toISOString(), version: state.task.version, detail: '用户编辑验证计划' }); renderSubquestions(); closeModal(); toast('验证计划已保存为新版本。');
    }
    if (action === 'add-condition') $('#condition-editor').insertAdjacentHTML('beforeend', '<div class="editor-row"><div><input class="field-input condition-title" placeholder="监测指标或事件"><textarea class="field-textarea condition-trigger" placeholder="触发阈值"></textarea><small>用户设定，待确认</small></div><button class="text-button danger-text" data-remove-condition="new">删除</button></div>');
    if (action === 'save-conditions' && state.task) {
      const rows = $$('.editor-row', $('#condition-editor'));
      state.task.changeConditions = rows.map((row, i) => ({ ...(state.task.changeConditions[i] || {}), id: state.task.changeConditions[i]?.id || `CC${i + 1}`, title: $('.condition-title', row).value.trim(), triggerThreshold: $('.condition-trigger', row).value.trim(), thresholdBasis: state.task.changeConditions[i]?.thresholdBasis || '用户设定，待确认', editable: true })).filter(item => item.title && item.triggerThreshold);
      state.task.version += 1; state.task.auditEvents.push({ id: `AUDIT-${state.task.auditEvents.length + 1}`, type: 'CONDITIONS_EDITED', at: new Date().toISOString(), version: state.task.version, detail: '用户编辑结论变化条件' }); renderConditions(); closeModal(); toast('结论变化条件已保存。');
    }
  });
  $('#claim-form').addEventListener('submit', event => { event.preventDefault(); verifyClaim($('#claim-input').value); });
  $('#followup-form').addEventListener('submit', event => { event.preventDefault(); answerFollowup($('#followup-input').value); });
  $('#modal-backdrop').addEventListener('click', event => { if (event.target.id === 'modal-backdrop') closeModal(); });
  document.addEventListener('keydown', event => { if (event.key === 'Escape') { closeModal(); $('#example-menu').classList.add('hidden'); } });
  $$('.nav-item').forEach(button => button.addEventListener('click', () => {
    $$('.nav-item').forEach(item => item.classList.remove('active')); button.classList.add('active');
    if (button.dataset.nav === 'tasks') listTasks();
    else if (button.dataset.nav === 'sources') showSources();
    else if (button.dataset.nav === 'evidence') $('#evidence-panel').scrollIntoView({ behavior: 'smooth' });
    else window.scrollTo({ top: 0, behavior: 'smooth' });
  }));

  updateTaskCount();
  verifyClaim($('#claim-input').value);
})();
