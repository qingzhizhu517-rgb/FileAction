const $ = (id) => document.getElementById(id);
const token = document.querySelector('meta[name="fileaction-token"]').content;
const state = { doc: null, analysis: null, draft: null, revision: 0, background: [], snapshot: [], memory: null, config: null, busy: false, epoch: 0, controller: null, editing: null, cancellation: Promise.resolve(), turns: 0, retryMessage: null };

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
function setBusy(value, message = '', cancellable = true) {
  state.busy = value;
  document.body.classList.toggle('busy', value);
  document.querySelectorAll('[data-lock]').forEach((node) => { node.disabled = value || node.dataset.expired === 'true'; });
  $('cancel').hidden = !value || !state.doc || !cancellable;
  $('loading').hidden = !value;
  $('loading').textContent = message;
}
async function operation(message, work, cancellable = true) {
  if (state.busy) return;
  const epoch = ++state.epoch;
  const controller = new AbortController();
  state.controller = controller;
  const timer = setTimeout(() => controller.abort(), 110000);
  setBusy(true, message, cancellable);
  try { await work(controller.signal, () => state.epoch === epoch); }
  catch (error) {
    if (epoch === state.epoch) {
      if (error.name === 'AbortError') {
        notice(cancellable ? '请求已中断或超时。结果没有生效，可以重新尝试。' : '请求已中断或超时。如正在保存到 COS，云端可能已收到文件，请检查文件库或 COS 控制台。', true);
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
  $('draft-section').hidden = true; $('action-section').hidden = true;
  $('draft').value = ''; $('action-confirm').checked = false;
  $('export-analysis').hidden = true;
  document.querySelectorAll('.turn-options .action-choice, .turn-options .skip-questions').forEach((button) => {
    button.dataset.expired = 'true'; button.disabled = true;
  });
}
function renderConfig() {
  const c = state.config;
  $('model-status').textContent = c?.configured ? `○ ${c.model} · 已配置` : '○ 模型未配置';
  $('model-status').classList.toggle('connected', Boolean(c?.configured));
  const destination = c?.configured ? `${c.model}（${c.base_url}）` : '配置的模型';
  $('send-scope').textContent = `我同意将文件文字和已保存背景发送给 ${destination}，先给我总结。`;
  $('upload-scope').textContent = `上传后自动将文件文字和已保存背景发送给 ${destination}，先给我总结。也可以不勾选，先在 Agent 中查看原文。`;
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
function messageBubble(role, content) {
  const bubble = el('section', undefined, `chat-message ${role}-message`);
  bubble.append(el('div', role === 'user' ? '你' : role === 'assistant' ? '文启' : '文件已读取', 'message-label'));
  if (content) bubble.append(el('p', content, 'message-text'));
  $('agent-thread').append(bubble);
  return bubble;
}
function showDocument(doc) {
  state.doc = doc; clearResults(); state.turns = 0; state.retryMessage = null; state.background = [];
  state.snapshot = structuredClone(doc.memory || []);
  $('agent-thread').replaceChildren(); $('chat-input').value = '';
  $('source-details').open = false; document.querySelector('.storage-details').open = false;
  $('chat-form').hidden = true; $('agent-start').hidden = false; $('retry-chat').hidden = true;
  $('send-consent').checked = false; $('cos-consent').checked = false;
  $('welcome').hidden = true; $('workspace').hidden = false;
  $('doc-name').textContent = doc.name;
  $('doc-meta').textContent = `${doc.characters.toLocaleString()} 字 · 已解析`;
  $('current-file').textContent = doc.name;
  messageBubble('system', '文件已在本机解析。文启会先总结，再按内容和你的问题继续聊；不必先填写个人资料。');
  renderSources(); renderSnapshot(); renderStorage();
}
function renderStorage() {
  const c = state.config?.storage;
  const stored = state.doc?.stored;
  $('cos-file-state').textContent = stored ? `已保存到 COS · ${stored.bucket}` : '原文件尚未保存到 COS';
  $('cos-scope').textContent = c?.configured ? `原文件将保存到 ${c.bucket}（${c.region}），结束会话不会删除云端文件。` : '请先配置 COS。未配置时只在本机内存预览，不持久化原文件。';
  $('cos-consent').closest('label').hidden = Boolean(stored);
  $('store-original').hidden = Boolean(stored);
}
function locate(id) {
  document.querySelectorAll('.source-line.highlight').forEach((n) => n.classList.remove('highlight'));
  const node = $('source-' + id);
  if (node) {
    $('source-details').open = true;
    node.classList.add('highlight');
    $('sources').scrollTo({ top: node.offsetTop - $('sources').offsetTop - 12, behavior: 'smooth' });
    if (window.innerWidth <= 850) node.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}
async function upload(name, bytes) {
  if (state.busy) return;
  if (bytes.byteLength > 8 * 1024 * 1024) { notice('文件最大 8 MB，请拆分后上传。', true); return; }
  const authorized = $('upload-consent').checked;
  let uploaded = null;
  await operation('正在读取文件…', async (signal, active) => {
    let binary = '';
    for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    const doc = await api('/api/documents', { name, content: btoa(binary) }, signal);
    if (!active()) return;
    if (state.doc) await api('/api/forget', { id: state.doc.id });
    showDocument(doc); uploaded = doc.id;
    notice('已进入 Agent 对话。你可以先看原文，或让文启总结。');
  });
  if (uploaded && state.doc?.id === uploaded && authorized) {
    $('send-consent').checked = true;
    await askAgent('');
  }
}
async function finish() {
  if (state.busy) return;
  if (state.doc) {
    try { await api('/api/forget', { id: state.doc.id }); }
    catch (e) { notice(e.message, true); return; }
  }
  state.doc = null; state.snapshot = [];
  clearResults();
  $('send-consent').checked = false; $('upload-consent').checked = false;
  $('workspace').hidden = true; $('welcome').hidden = false;
  $('sources').replaceChildren(); $('current-file').textContent = '还没有打开文件';
  $('upload').value = '';
  notice('本次已结束，文件与解读已从服务内存移除。明确保存的背景和 COS 文件会保留，可分别管理。');
}
function chooseAction(goal) {
  if (!state.analysis || state.busy) return;
  $('goal').value = goal; $('action-confirm').checked = false;
  $('action-section').hidden = false;
  $('action-section').scrollIntoView({ behavior: 'smooth', block: 'center' });
}
function renderAnalysis() {
  const a = state.analysis;
  document.querySelectorAll('.turn-options .action-choice, .turn-options .skip-questions').forEach((button) => {
    button.dataset.expired = 'true'; button.disabled = true;
  });
  const first = state.turns === 0;
  const bubble = messageBubble('assistant', a.response);
  if (first) {
    bubble.append(el('h3', '先看这份文件', 'summary-label'), el('p', a.summary, 'file-summary'));
  }
  if (a.overview !== a.response && (state.snapshot.length || !first)) bubble.append(el('p', a.overview, 'personal-meaning'));
  if (a.positioning) {
    const guess = el('div', undefined, 'positioning');
    guess.append(el('small', first ? '可能的阅读视角 · 仅是猜测，待你确认' : '本轮阅读视角 · 按对话更新，仍可纠正'), el('p', a.positioning)); bubble.append(guess);
  }
  const detail = el('details', undefined, 'insight-details');
  detail.append(el('summary', '查看依据与未知'));
  for (const insight of a.insights) {
    const card = el('div', undefined, 'insight');
    card.append(el('h3', insight.title), el('p', insight.meaning, 'meaning'));
    const dl = el('dl');
    const background = insight.background_refs.map((i) => state.background[i]).concat(insight.memory_refs.map((id) => state.snapshot.find((m) => m.id === id)?.content)).filter(Boolean).join('；');
    for (const [label, value] of [['原文明示', insight.document_fact], ['背景来源', background || '本条未引用已保存条目；本次自述可在对话中核对'], ['系统推断', insight.inference || '无额外推断'], ['尚待确认', insight.unknown || '请核对原文']]) {
      const row = el('div', undefined, 'reason-row'); row.append(el('dt', label), el('dd', value)); dl.append(row);
    }
    card.append(dl);
    for (const e of insight.evidence) {
      const button = el('button', undefined, 'evidence');
      button.append(el('small', `${e.source_id} · 查看原文 ↗`), el('span', `“${e.quote}”`));
      button.addEventListener('click', () => locate(e.source_id)); card.append(button);
    }
    detail.append(card);
  }
  bubble.append(detail);
  if (a.questions.length) {
    const questions = el('div', undefined, 'agent-questions');
    questions.append(el('small', '如果你愿意，这些信息可以帮我判断得更准：'));
    a.questions.forEach((q) => questions.append(el('p', q, 'agent-question')));
    questions.append(el('small', '可以回答其中一条、直接追问，或不补充。'));
    bubble.append(questions);
  }
  if (a.memory_candidates.length) {
    const candidates = el('details', undefined, 'candidates'); candidates.append(el('summary', '你可以审阅的沉淀建议 · 尚未保存'));
    for (const candidate of a.memory_candidates) {
      const row = el('div', undefined, 'candidate'); const copy = el('div');
      copy.append(el('p', candidate.content), el('small', candidate.reason));
      const button = el('button', '审阅并保存', 'quiet'); button.dataset.lock = '';
      button.addEventListener('click', () => editMemory({ ...candidate, source: `用户审阅对话候选 · ${state.doc.name} · ${candidate.reason}` }));
      row.append(copy, button); candidates.append(row);
    }
    bubble.append(candidates);
  }
  const options = el('div', undefined, 'turn-options');
  for (const action of a.actions) {
    const button = el('button', '准备：' + action, 'action-choice'); button.dataset.lock = '';
    button.addEventListener('click', () => { if (state.analysis === a) chooseAction(action); }); options.append(button);
  }
  if (a.questions.length) {
    const skip = el('button', '先不补充', 'skip-questions'); skip.dataset.lock = '';
    skip.addEventListener('click', () => { if (state.analysis === a) askAgent('我暂时不补充个人信息，请仅根据文件帮我理解，不再追问个人情况。'); }); options.append(skip);
  }
  const end = el('button', '看完了，到这里结束', 'end-chat'); end.dataset.lock = ''; end.addEventListener('click', finish); options.append(end);
  bubble.append(options);
  state.turns += 1;
  $('agent-start').hidden = true; $('chat-form').hidden = false; $('export-analysis').hidden = false;
  $('retry-chat').hidden = true;
  bubble.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
async function askAgent(message, retry = false) {
  if (!state.doc || state.busy) return;
  if (!state.config?.configured) { notice('请先配置模型接口，再开始真实对话。', true); openSettings(); return; }
  if (!$('send-consent').checked) { notice('请先确认文件与已保存背景的发送范围。', true); return; }
  await state.cancellation;
  if (message && !retry) messageBubble('user', message);
  state.retryMessage = message;
  clearResults();
  await operation(state.turns ? '文启正在思考你的问题…' : '文启正在读文件，准备第一轮总结…', async (signal, active) => {
    const got = await api('/api/chat', { id: state.doc.id, message, consent: true }, signal);
    if (!active()) return;
    state.analysis = got.analysis; state.revision = got.revision; state.snapshot = got.memory; state.background = got.background;
    renderAnalysis(); state.retryMessage = null;
    $('doc-meta').textContent = `${state.doc.characters.toLocaleString()} 字 · ${state.config.model} · 第 ${state.turns} 轮对话`;
    notice('');
  });
  if (!state.analysis && state.doc && state.retryMessage !== null) $('retry-chat').hidden = false;
}
function download(name, content) {
  const url = URL.createObjectURL(new Blob([content], { type: 'text/markdown;charset=utf-8' }));
  const a = el('a'); a.href = url; a.download = name.replace(/[\\/:*?"<>|]/g, '-'); a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}
function analysisMarkdown() {
  const a = state.analysis;
  let value = `# 文启解读 · ${state.doc.name}\n\n模型解读，需核对。生成时间：${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}\n\n${a.summary}\n\n${a.response}\n\n${a.overview}\n`;
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
    clearResults(); renderSnapshot(); state.turns = 0; state.retryMessage = null;
    $('agent-thread').replaceChildren(); messageBubble('system', '背景已更新，可以让文启按最新背景重新总结。');
    $('agent-start').hidden = false; $('chat-form').hidden = true; $('retry-chat').hidden = true;
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
$('analyze').addEventListener('click', () => askAgent(''));
$('retry-chat').addEventListener('click', () => askAgent(state.retryMessage ?? '', true));
$('chat-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const message = $('chat-input').value.trim();
  if (!message) { notice('写一句想了解的内容即可，也可以直接结束。'); return; }
  $('chat-input').value = ''; await askAgent(message);
});
$('cancel').addEventListener('click', async () => {
  if (!state.doc) return;
  ++state.epoch; state.controller?.abort(); state.controller = null;
  try { await api('/api/cancel', { id: state.doc.id }); notice('本次请求已取消，迟到结果不会生效。已发出的请求可能仍产生费用。'); }
  catch (e) { notice(e.message, true); }
  clearResults(); setBusy(false); $('retry-chat').hidden = state.retryMessage === null;
});
$('close-action').addEventListener('click', () => { $('action-section').hidden = true; });
$('generate').addEventListener('click', async () => {
  if (!state.analysis) { notice('请先取得有效的 Agent 回复。', true); return; }
  if (!$('action-confirm').checked) { notice('请先确认继续生成初稿及发送范围。', true); return; }
  const goal = $('goal').value.trim();
  if (!goal) { notice('请填写希望准备的产物。', true); return; }
  state.draft = null; $('draft-section').hidden = true; $('draft').value = '';
  await operation('正在准备你的可编辑初稿…', async (signal, active) => {
    const got = await api('/api/action', { id: state.doc.id, revision: state.revision, goal, confirmed: true, consent: true }, signal);
    if (!active()) return;
    state.draft = got.draft; $('draft-title').textContent = got.draft.title; $('draft').value = got.draft.markdown;
    $('draft-section').hidden = false; $('action-section').hidden = true;
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
  if (c?.persistent) $('config-result').textContent = '模型已由后台配置，可直接使用。这里的临时修改只在本次服务运行期间有效。';
  $('model-config-note').textContent = c?.persistent
    ? '模型已接入后台，重启后会自动加载。密钥保存在本机受控配置中，不会返回给浏览器。'
    : '使用 OpenAI 兼容接口。页面临时配置仅在服务内存中；后台受控配置可在重启后自动加载。';
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
    if (state.doc) {
      await api('/api/refresh-memory', { id: state.doc.id });
      showDocument({ ...state.doc, memory: state.memory.entries });
    }
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
function openCOS() {
  const c = state.config?.storage;
  $('cos-bucket').value = c?.bucket || ''; $('cos-region').value = c?.region || '';
  for (const id of ['cos-secret-id', 'cos-secret-key', 'cos-token']) $(id).value = '';
  $('cos-result').textContent = c?.configured ? '已配置。更改时请重新输入访问密钥。' : '尚未配置，原文件不会持久化到本地。';
  $('cos-dialog').showModal();
}
$('cos-settings-open').addEventListener('click', openCOS);
$('cos-form').addEventListener('submit', async (e) => {
  e.preventDefault(); const button = e.submitter; button.disabled = true;
  try {
    const got = await api('/api/cos/config', { bucket: $('cos-bucket').value, region: $('cos-region').value,
      secret_id: $('cos-secret-id').value, secret_key: $('cos-secret-key').value, token: $('cos-token').value });
    state.config.storage = got;
    for (const id of ['cos-secret-id', 'cos-secret-key', 'cos-token']) $(id).value = '';
    $('cos-consent').checked = false; renderStorage();
    $('cos-result').textContent = 'COS 设置已保存在本机服务内存中。请在文件页确认后实际上传，验证连接。';
  } catch (error) { $('cos-result').textContent = error.message; }
  finally { button.disabled = false; }
});
$('store-original').addEventListener('click', async () => {
  if (!state.doc) return;
  if (!state.config?.storage?.configured) { openCOS(); return; }
  if (!$('cos-consent').checked) { notice('请先确认将这份原文件保存到腾讯云 COS。', true); return; }
  await operation('正在上传到腾讯云 COS…', async (signal, active) => {
    const record = await api('/api/cos/store', { id: state.doc.id, consent: true }, signal);
    if (!active()) return;
    state.doc.stored = record; renderStorage();
    notice('原文件已上传到 COS，云端大小校验通过。可以在 COS 文件库重新打开。');
  }, false);
});
$('store-draft').addEventListener('click', async () => {
  if (!state.draft) return;
  if (!state.config?.storage?.configured) { openCOS(); return; }
  if (!confirm(`将当前编辑框中的产物保存到腾讯云 COS？\n\n${state.draft.title}\n存储桶：${state.config.storage.bucket}`)) return;
  await operation('正在保存产物到 COS…', async (signal, active) => {
    await api('/api/cos/draft', { title: state.draft.title, markdown: $('draft').value, consent: true }, signal);
    if (active()) notice('当前编辑后的产物已保存到 COS，可以在文件库查看。');
  }, false);
});
async function renderFiles() {
  const got = await api('/api/files'); $('files-list').replaceChildren();
  if (!got.files.length) $('files-list').append(el('p', state.config?.storage?.configured ? '当前存储桶还没有通过本机文启保存的文件。' : '请先配置 COS，再保存文件。', 'memory-empty'));
  for (const file of got.files.slice().reverse()) {
    const row = el('div', undefined, 'memory-entry');
    row.append(el('p', file.name), el('small', `${file.kind === 'draft' ? '编辑产物' : '原文件'} · ${file.size.toLocaleString()} 字节 · ${file.created}`));
    const buttons = el('div', undefined, 'button-row');
    const open = el('button', '打开'); open.addEventListener('click', async () => {
      open.disabled = true;
      try {
        const doc = await api('/api/cos/open', { id: file.id });
        if (state.doc) await api('/api/forget', { id: state.doc.id });
        showDocument(doc); $('files-dialog').close();
        notice('已从 COS 读取文件，SHA-256 完整性校验通过。已进入 Agent，可先总结再聊。');
      } catch (e) { $('files-result').textContent = e.message; }
      finally { open.disabled = false; }
    });
    const downloadFile = el('button', '下载'); downloadFile.addEventListener('click', async () => {
      downloadFile.disabled = true;
      try {
        const got = await api('/api/cos/download', { id: file.id });
        const a = el('a'); a.href = got.url; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.click();
        $('files-result').textContent = '已打开 5 分钟有效的临时签名下载链接。请勿转发该链接。';
      } catch (e) { $('files-result').textContent = e.message; }
      finally { downloadFile.disabled = false; }
    });
    const remove = el('button', '删除云端文件'); remove.addEventListener('click', async () => {
      if (!confirm(`确认从腾讯云 COS 删除该文件？\n\n${file.name}\n普通删除在启用版本控制的桶中可能只生成删除标记，历史版本需在控制台管理。`)) return;
      remove.disabled = true;
      try { await api('/api/cos/delete', { id: file.id, consent: true }); await renderFiles(); $('files-result').textContent = '云端删除请求已完成，本机索引已移除。'; }
      catch (e) { $('files-result').textContent = e.message; remove.disabled = false; }
    });
    buttons.append(open, downloadFile, remove); row.append(buttons); $('files-list').append(row);
  }
}
$('files-open').addEventListener('click', async () => {
  try { $('files-result').textContent = ''; await renderFiles(); $('files-dialog').showModal(); }
  catch (e) { notice(e.message, true); }
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
