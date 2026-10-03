const $ = (id) => document.getElementById(id);
const token = document.querySelector('meta[name="fileaction-token"]').content;
const state = { doc: null, analysis: null, draft: null, revision: 0, background: [], snapshot: [], memory: null, config: null, busy: false, epoch: 0, controller: null, editing: null };

function el(tag, content, className) {
  const node = document.createElement(tag);
  if (content !== undefined) node.textContent = content;
  if (className) node.className = className;
  return node;
}
function notice(message, error = false) {
  $('notice').textContent = message;
  $('notice').classList.toggle('error', error);
  $('notice').hidden = !message;
}
async function api(path, data, signal) {
  const response = await fetch(path, {
    method: data === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', 'X-FileAction-Token': token },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }), signal,
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || '请求失败，请重试。');
  return result;
}
function setBusy(value, message = '') {
  state.busy = value;
  document.body.classList.toggle('busy', value);
  document.querySelectorAll('[data-lock]').forEach((node) => { node.disabled = value; });
  $('cancel').hidden = !value || !state.doc;
  $('loading').hidden = !value;
  $('loading').textContent = message;
}
async function operation(message, work) {
  if (state.busy) return;
  const epoch = ++state.epoch;
  const controller = new AbortController();
  state.controller = controller;
  const timer = setTimeout(() => controller.abort(), 110000);
  setBusy(true, message);
  try { await work(controller.signal, () => state.epoch === epoch); }
  catch (error) {
    if (epoch === state.epoch) {
      if (error.name === 'AbortError') {
        notice('请求已中断或超时。结果没有生效，可以重新尝试。', true);
        if (state.doc) api('/api/cancel', { id: state.doc.id }).catch(() => {});
      } else notice(error.message, true);
    }
  } finally {
    clearTimeout(timer);
    if (epoch === state.epoch) { setBusy(false); state.controller = null; }
  }
}
function clearResults() {
  state.analysis = null; state.draft = null; state.revision = 0;
  $('analysis-section').hidden = true; $('draft-section').hidden = true;
  $('insights').replaceChildren(); $('draft').value = ''; $('action-confirm').checked = false;
  $('step-analysis').className = ''; $('step-action').className = '';
}
function renderConfig() {
  const c = state.config;
  $('model-status').textContent = c?.configured ? `○ ${c.model} · 已配置` : '○ 模型未配置';
  $('model-status').classList.toggle('connected', Boolean(c?.configured));
  $('send-scope').textContent = `我同意将本文件提取的文字、本次背景和已保存背景发送给${c?.configured ? ` ${c.model}（${c.base_url}）` : '配置的模型'}，用于解读。`;
  $('formats').textContent = c?.pdf ? 'TXT · Markdown · Word · PDF（文字层） / 最大 8 MB' : 'TXT · Markdown · Word / PDF 需安装解析组件 / 最大 8 MB';
}
async function refreshMemory() {
  state.memory = await api('/api/memory');
  $('memory-count').textContent = state.memory.entries.length;
  renderMemory();
}
function renderSnapshot() {
  $('snapshot-note').textContent = state.snapshot.length
    ? `本次还会参考 ${state.snapshot.length} 条已确认长期背景。可在「我的背景」查看与修改。`
    : '尚未保存长期背景。可以直接开始，本次回答不会自动保存。';
}
function renderSources() {
  $('sources').replaceChildren();
  for (const segment of state.doc.segments) {
    const line = el('div', undefined, 'source-line');
    line.id = 'source-' + segment.id;
    line.append(el('small', `${segment.id} · ${segment.location}`), el('p', segment.text));
    $('sources').append(line);
  }
  $('source-count').textContent = `${state.doc.segments.length} 处原文`;
}
function locate(id) {
  document.querySelectorAll('.source-line.highlight').forEach((n) => n.classList.remove('highlight'));
  const node = $('source-' + id);
  if (node) {
    node.classList.add('highlight');
    $('sources').scrollTo({ top: node.offsetTop - $('sources').offsetTop - 12, behavior: 'smooth' });
    if (window.innerWidth <= 850) node.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}
async function upload(name, bytes) {
  if (state.busy) return;
  if (bytes.byteLength > 8 * 1024 * 1024) { notice('文件最大 8 MB，请拆分后上传。', true); return; }
  await operation('正在读取文件…', async (signal, active) => {
    // 分块编码，避免大文件展开参数导致 RangeError。
    let binary = '';
    for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    const doc = await api('/api/documents', { name, content: btoa(binary) }, signal);
    if (!active()) return;
    if (state.doc) await api('/api/forget', { id: state.doc.id });
    state.doc = doc;
    clearResults();
    state.snapshot = structuredClone(state.memory.entries);
    $('send-consent').checked = false;
    $('welcome').hidden = true; $('workspace').hidden = false;
    $('doc-name').textContent = doc.name;
    $('doc-meta').textContent = `${doc.characters.toLocaleString()} 字 · 仅在本机解析 · 尚未发送给模型`;
    $('current-file').textContent = doc.name;
    renderSources(); renderSnapshot();
    notice('文件已读取。可以补充相关背景，也可以留空开始解读。');
  });
}
async function finish() {
  if (state.busy) return;
  if (state.doc) {
    try { await api('/api/forget', { id: state.doc.id }); }
    catch (e) { notice(e.message, true); return; }
  }
  state.doc = null; state.snapshot = [];
  clearResults();
  $('background').value = ''; $('send-consent').checked = false;
  $('workspace').hidden = true; $('welcome').hidden = false;
  $('sources').replaceChildren(); $('current-file').textContent = '还没有打开文件';
  $('upload').value = '';
  notice('本次已结束，文件与解读已从服务内存移除。只有你明确保存的背景会保留。');
}
function renderAnalysis() {
  const a = state.analysis;
  $('overview').textContent = a.overview;
  $('insights').replaceChildren();
  a.insights.forEach((insight, i) => {
    const card = el('article', undefined, 'insight');
    card.append(el('h3', `${String(i + 1).padStart(2, '0')}  ${insight.title}`), el('p', insight.meaning, 'meaning'));
    const dl = el('dl');
    const backgrounds = insight.background_refs.map((index) => state.background[index]);
    insight.memory_refs.forEach((id) => { const m = state.snapshot.find((e) => e.id === id); if (m) backgrounds.push(`${m.content}（已保存背景）`); });
    for (const [name, value, type] of [
      ['原文明示', insight.document_fact, ''],
      ['结合背景', backgrounds.join('；') || '本次没有与此条相关的已确认背景', ''],
      ['系统推断', insight.inference || '无额外推断', ''],
      ['尚待确认', insight.unknown || '未提出其他未知；仍请核对原文', 'unknown'],
    ]) { const row = el('div', undefined, 'reason-row ' + type); row.append(el('dt', name), el('dd', value)); dl.append(row); }
    card.append(dl);
    insight.evidence.forEach((e) => {
      const button = el('button', undefined, 'evidence');
      button.append(el('small', `${e.source_id} · 查看原文 ↗`), el('span', `“${e.quote}”`));
      button.addEventListener('click', () => locate(e.source_id)); card.append(button);
    });
    $('insights').append(card);
  });
  $('questions-wrap').hidden = !a.questions.length;
  $('questions').replaceChildren(...a.questions.map((q, i) => el('p', `${i + 1}. ${q}`, 'question')));
  $('candidates-wrap').hidden = !a.memory_candidates.length;
  $('candidates').replaceChildren();
  for (const candidate of a.memory_candidates) {
    const row = el('div', undefined, 'candidate');
    const copy = el('div'); copy.append(el('p', candidate.content), el('small', candidate.reason));
    const button = el('button', '审阅并保存', 'quiet'); button.dataset.lock = '';
    button.addEventListener('click', () => editMemory({ ...candidate, source: `用户审阅模型候选 · ${state.doc.name} · ${candidate.reason}` }));
    row.append(copy, button); $('candidates').append(row);
  }
  $('action-options').replaceChildren();
  for (const action of a.actions) {
    const button = el('button', action); button.dataset.lock = '';
    button.addEventListener('click', () => {
      $('goal').value = action;
      $('action-options').querySelectorAll('button').forEach((b) => b.classList.toggle('selected', b === button));
      $('action-confirm').checked = false;
    });
    $('action-options').append(button);
  }
  $('goal').value = a.actions[0] || '';
  $('analysis-section').hidden = false;
  $('step-analysis').className = 'done'; $('step-action').className = 'active';
}
function download(name, content) {
  const url = URL.createObjectURL(new Blob([content], { type: 'text/markdown;charset=utf-8' }));
  const a = el('a'); a.href = url; a.download = name.replace(/[\\/:*?"<>|]/g, '-'); a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}
function analysisMarkdown() {
  const a = state.analysis;
  let value = `# 文启解读 · ${state.doc.name}\n\n模型解读，需核对。生成时间：${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}\n\n${a.overview}\n`;
  for (const insight of a.insights) {
    value += `\n## ${insight.title}\n\n${insight.meaning}\n\n- 原文明示：${insight.document_fact}\n- 结合背景：${insight.background_refs.map((i) => state.background[i]).concat(insight.memory_refs.map((id) => state.snapshot.find((m) => m.id === id)?.content)).filter(Boolean).join('；') || '无相关已确认背景'}\n- 系统推断：${insight.inference || '无'}\n- 尚待确认：${insight.unknown || '无'}\n`;
    for (const e of insight.evidence) {
      const source = state.doc.segments.find((s) => s.id === e.source_id);
      value += `\n依据 ${e.source_id}（${source.location}）：${e.quote}\n`;
    }
  }
  if (a.questions.length) value += '\n## 待确认问题\n\n' + a.questions.map((q) => '- ' + q).join('\n') + '\n';
  return value;
}
function renderMemory() {
  const m = state.memory;
  if (!m) return;
  $('memory-usage').textContent = `个人背景 ${m.usage.user} / ${m.limits.user} 字　长期事项 ${m.usage.memory} / ${m.limits.memory} 字`;
  $('memory-list').replaceChildren();
  if (!m.entries.length) $('memory-list').append(el('p', '还没有长期背景。使用文启时，你可以决定哪些内容值得保留。', 'memory-empty'));
  for (const entry of m.entries) {
    const row = el('div', undefined, 'memory-entry');
    row.append(el('p', entry.content), el('small', `${entry.target === 'user' ? '个人背景' : '长期事项'} · ${entry.source} · ${entry.updated}`));
    const buttons = el('div', undefined, 'button-row');
    const edit = el('button', '修改'); edit.addEventListener('click', () => editMemory(entry));
    const remove = el('button', '删除'); remove.addEventListener('click', async () => {
      if (!confirm(`从本机长期记忆删除这条内容？\n\n${entry.content}`)) return;
      remove.disabled = true;
      try {
        await api('/api/memory', { action: 'remove', target: entry.target, entry_id: entry.id, consent: true, expected_revision: m.revision });
        await memoryChanged();
      } catch (e) { notice(e.message, true); remove.disabled = false; }
    });
    buttons.append(edit, remove); row.append(buttons); $('memory-list').append(row);
  }
}
function editMemory(entry = {}) {
  state.editing = { ...entry, expected_revision: state.memory.revision };
  $('memory-edit-title').textContent = entry.id ? '修改已保存背景' : '确认并保存背景';
  $('memory-target').value = entry.target || 'user'; $('memory-target').disabled = Boolean(entry.id);
  $('memory-content').value = entry.content || ''; $('memory-consent').checked = false;
  $('memory-source').textContent = entry.source || '来源：用户手动确认'; $('memory-result').textContent = '';
  $('edit-memory-dialog').showModal();
}
async function memoryChanged() {
  await refreshMemory();
  if (state.doc) {
    await api('/api/refresh-memory', { id: state.doc.id });
    state.snapshot = structuredClone(state.memory.entries);
    clearResults(); renderSnapshot();
    $('send-consent').checked = false;
    notice('长期背景已更新。当前解读已失效，请重新解读，让结果使用最新背景。');
  } else notice('长期背景已更新，下次打开文件会参考这些信息。');
}

$('upload').addEventListener('change', async (e) => {
  const file = e.target.files[0]; if (file) await upload(file.name, new Uint8Array(await file.arrayBuffer()));
});
for (const event of ['dragover', 'dragleave', 'drop']) $('upload-zone').addEventListener(event, async (e) => {
  e.preventDefault(); $('upload-zone').classList.toggle('dragging', event === 'dragover');
  if (event === 'drop' && !state.busy) { const f = e.dataTransfer.files[0]; if (f) await upload(f.name, new Uint8Array(await f.arrayBuffer())); }
});
$('sample').addEventListener('click', () => upload('合成体验-奖学金通知.txt', new TextEncoder().encode(
  '合成体验材料：以下学校、项目和要求均为虚构，仅用于体验。\n星河大学项目创新奖学金申请通知\n面向全日制在校本科生，鼓励具有软件或科研项目实践经历的同学申请。\n申请人须提交项目成果说明、成绩单，以及个人申请陈述。\n申请人须确认本学年没有重复获得同类资助。\n申请截止时间：2026年10月20日17:00。\n材料须由本人核对，并通过学校指定平台提交；准备材料不代表资格通过。')));
$('new-session').addEventListener('click', finish); $('finish').addEventListener('click', finish);
$('analyze').addEventListener('click', async () => {
  if (!state.doc) return;
  if (!state.config?.configured) { notice('请先配置模型接口，再开始真实解读。', true); openSettings(); return; }
  if (!$('send-consent').checked) { notice('请先确认文件与背景的发送范围。', true); return; }
  clearResults();
  state.background = $('background').value.split('\n').map((v) => v.trim()).filter(Boolean);
  await operation('模型正在结合背景解读…', async (signal, active) => {
    const got = await api('/api/analyze', { id: state.doc.id, background: state.background, consent: true }, signal);
    if (!active()) return;
    state.analysis = got.analysis; state.revision = got.revision; state.snapshot = got.memory;
    renderAnalysis(); $('doc-meta').textContent = `${state.doc.characters.toLocaleString()} 字 · ${state.config.model} 返回 · 引用已与原文逐字核对`;
    notice('解读已返回。请核对原文、背景和未知，再决定是否继续。');
  });
});
$('background').addEventListener('input', () => {
  if (state.analysis || state.draft) {
    clearResults(); $('send-consent').checked = false;
    api('/api/cancel', { id: state.doc.id }).catch((e) => notice(e.message, true));
    notice('背景已修改，旧解读和初稿已失效。请重新解读。');
  }
});
$('cancel').addEventListener('click', async () => {
  if (!state.doc) return;
  ++state.epoch; state.controller?.abort(); state.controller = null;
  try { await api('/api/cancel', { id: state.doc.id }); notice('本次请求已取消，迟到结果不会生效。已发出的模型请求可能仍产生费用。'); }
  catch (e) { notice(e.message, true); }
  clearResults(); setBusy(false);
});
$('skip-questions').addEventListener('click', () => notice('你选择暂不补充。未知会继续明确标注，可以只理解后结束，也可以选择生成初稿。'));
$('generate').addEventListener('click', async () => {
  if (!state.analysis) { notice('请先完成有效解读。', true); return; }
  if (!$('action-confirm').checked) { notice('请先确认继续生成初稿及发送范围。', true); return; }
  const goal = $('goal').value.trim();
  if (!goal) { notice('请填写希望准备的产物。', true); return; }
  state.draft = null; $('draft-section').hidden = true; $('draft').value = '';
  await operation('正在准备你的可编辑初稿…', async (signal, active) => {
    const got = await api('/api/action', { id: state.doc.id, revision: state.revision, goal, confirmed: true, consent: true }, signal);
    if (!active()) return;
    state.draft = got.draft; $('draft-title').textContent = got.draft.title; $('draft').value = got.draft.markdown;
    $('draft-section').hidden = false; $('step-action').className = 'done';
    $('draft-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
    notice('模型初稿已生成。请核对并修改，再导出。');
  });
});
$('export-analysis').addEventListener('click', () => { if (state.analysis) download('文启解读-' + state.doc.name + '.md', analysisMarkdown()); });
$('export-draft').addEventListener('click', () => {
  if (state.draft) download(state.draft.title + '.md', `> 文启产物：模型初稿，经用户可编辑，需本人核对；尚未对外发送。\n\n${$('draft').value}`);
});
$('copy-draft').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText($('draft').value); notice('正文已复制。'); }
  catch { notice('浏览器未允许剪贴板访问，可以在正文框中全选复制。', true); }
});
function openSettings() {
  const c = state.config;
  $('base-url').value = c?.base_url || ''; $('model-name').value = c?.model || '';
  $('api-key').value = ''; $('json-mode').checked = Boolean(c?.json_mode);
  $('config-result').textContent = c?.configured ? '已有设置。修改时请重新输入密钥。' : '填写后保存，再测试连接。';
  $('settings-dialog').showModal();
}
$('settings-open').addEventListener('click', openSettings); $('model-status').addEventListener('click', openSettings);
document.querySelectorAll('[data-close]').forEach((button) => button.addEventListener('click', () => $(button.dataset.close).close()));
$('settings-form').addEventListener('submit', async (e) => {
  e.preventDefault(); const button = e.submitter; button.disabled = true;
  try {
    const got = await api('/api/config', { base_url: $('base-url').value, api_key: $('api-key').value, model: $('model-name').value, json_mode: $('json-mode').checked });
    state.config = { ...state.config, ...got }; $('api-key').value = '';
    $('send-consent').checked = false; $('action-confirm').checked = false;
    if (state.doc) { await api('/api/cancel', { id: state.doc.id }); clearResults(); }
    renderConfig(); $('config-result').textContent = '设置已保存在服务内存中。可以测试连接；测试成功后再开始解读。';
  } catch (error) { $('config-result').textContent = error.message; }
  finally { button.disabled = false; }
});
$('test-connection').addEventListener('click', async () => {
  const button = $('test-connection'); button.disabled = true; $('config-result').textContent = '正在测试已保存的连接…';
  try { const got = await api('/api/connect', {}); $('config-result').textContent = got.message; }
  catch (error) { $('config-result').textContent = error.message; }
  finally { button.disabled = false; }
});
$('memory-open').addEventListener('click', async () => {
  try { await refreshMemory(); $('memory-dialog').showModal(); } catch (e) { notice(e.message, true); }
});
$('add-memory').addEventListener('click', () => editMemory());
$('memory-form').addEventListener('submit', async (e) => {
  e.preventDefault(); const button = e.submitter; button.disabled = true;
  try {
    await api('/api/memory', { action: state.editing.id ? 'replace' : 'add', target: $('memory-target').value,
      content: $('memory-content').value, entry_id: state.editing.id || '', consent: $('memory-consent').checked,
      source: state.editing.source || '用户手动确认', expected_revision: state.editing.expected_revision });
    $('edit-memory-dialog').close(); await memoryChanged();
  } catch (error) { $('memory-result').textContent = error.message; }
  finally { button.disabled = false; }
});
for (const [id, target, name] of [['export-user-memory', 'user', 'USER.md'], ['export-task-memory', 'memory', 'MEMORY.md']]) {
  $(id).addEventListener('click', async () => {
    try {
      const response = await fetch(`/api/memory/${target}.md`, { headers: { 'X-FileAction-Token': token } });
      if (!response.ok) throw new Error('导出失败，请刷新重试。');
      download(name, await response.text());
    } catch (e) { notice(e.message, true); }
  });
}
try { state.config = await api('/api/status'); renderConfig(); await refreshMemory(); }
catch (e) { notice('无法连接本机服务：' + e.message, true); }
