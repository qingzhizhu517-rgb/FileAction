const $ = (id) => document.getElementById(id);
const token = document.querySelector('meta[name="fileaction-token"]').content;
const state = { doc: null, analysis: null, draft: null, revision: 0, background: [], snapshot: [], memory: null, config: null, busy: false, epoch: 0, controller: null, editing: null, cancellation: Promise.resolve(), turns: 0, retryMessage: null, workspaces: [], tabs: [], knowledgeEditing: null, restoring: false, draftTimer: null, draftQueue: Promise.resolve() };

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
async function apiStream(path, data, signal, onDelta) {
  if(legacyBackend())throw new Error('当前是保留临时文件的旧服务。自动档案和流式对话请打开 http://127.0.0.1:8788/。');
  const response=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json','X-FileAction-Token':token},body:JSON.stringify({...data,stream:true}),signal});
  if(!response.ok){const got=await response.json();throw new Error(got.error || '流式请求失败');}
  if(!response.headers.get('content-type')?.startsWith('application/x-ndjson'))throw new Error('服务未返回流式输出，请刷新后重试。');
  const reader=response.body.getReader(),decoder=new TextDecoder();let pending='',result=null,ended=false;
  function event(line){
    if(!line.trim())return;
    const value=JSON.parse(line);
    if(value.type==='error')throw new Error(value.error);
    if(value.type==='delta')onDelta(value.field,value.text);
    if(value.type==='done'){result=value.result;ended=true;}
  }
  try{
    while(true){
      const {value,done}=await reader.read();pending+=decoder.decode(value || new Uint8Array(),{stream:!done});
      let cut;while((cut=pending.indexOf('\n'))>=0){event(pending.slice(0,cut));pending=pending.slice(cut+1);}
      if(done)break;
    }
    if(pending.trim())event(pending);
    if(!ended)throw new Error('输出连接中断，未保存不完整回复。');
    return result;
  }finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
}
function streamingOutput(container,title) {
  const node=el('section',undefined,'stream-preview');node.append(el('div',title,'message-label'));
  const status=el('small','正在接收模型输出，完成后核对引用……','stream-status');node.append(status);
  const fields={};container.append(node);
  const labels={response:'文启',summary:'文件总结',overview:'结合档案',positioning:'阅读视角',title:'初稿标题',markdown:'初稿正文'};
  return {
    delta(field,text){
      if(!labels[field] || !text)return;
      if(!fields[field]){const part=el('div',undefined,'stream-field');part.dataset.field=field;part.append(el('h3',labels[field]));fields[field]=el('p',undefined,'stream-text');part.append(fields[field]);node.insertBefore(part,status);}
      fields[field].append(document.createTextNode(text));
      status.textContent='正在输出……内容与依据完成后保存';
    },
    finish(){node.remove();},
    fail(){node.classList.add('stream-failed');status.textContent='本次输出未完成或未通过校验，尚未保存。可以重试。';},
  };
}
function renderProfileBasis() {
  $('profile-basis').replaceChildren();
  const rows=state.doc?.profile_basis || [];
  $('profile-basis-note').textContent=state.doc?.analysis ? '标出本轮已引用、已提供的档案。新沉淀标为可参考；修改后下一轮读取新值。' : '下一次阅读可参考这些档案。修改后直接保存，不需要逐条确认。';
  if(!rows.length)$('profile-basis').append(el('p',legacyBackend() ? '旧服务保留原有临时文件。新版档案依据请在 8788 查看。' : '暂无可参考的档案。文件沉淀形成后会自动归档。','subtle'));
  for(const entry of rows){
    const card=el('article',undefined,'profile-card');card.dataset.entryId=entry.id;card.dataset.field=entry.field || entry.target;
    card.append(el('div',`${entry.label || (entry.target==='user' ? '个人背景' : '长期事项')} · ${entry.used ? '本轮已引用' : entry.provided ? '本轮已提供' : '可参考'}`,'profile-label'),el('p',entry.content));
    const kinds={user_fact:'用户自述',document_fact:'来源文件事实',inference:'AI 推断 · 未确认',unknown:'待核实',global_ref:'来自已有档案',user_edit:'用户修改 · 优先使用'};
    card.append(el('small',`${kinds[entry.kind] || '用户记录'}${entry.file_name ? ' · '+entry.file_name : ''}`));
    const detail=el('details');detail.append(el('summary','查看档案依据'),el('p',entry.quote || entry.source,'profile-quote'));card.append(detail);
    if(entry.file_id===state.doc.file_id && entry.source_id){const source=el('button',`${entry.source_id} · 文件原文 ↗`,'text-button');source.addEventListener('click',()=>locate(entry.source_id));detail.append(source);}
    const edit=el('button','修改档案','profile-edit');edit.dataset.lock='';edit.disabled=state.busy;
    edit.addEventListener('click',async()=>{try{await refreshMemory();const latest=state.memory.entries.find(e=>e.id===entry.id);if(!latest)throw new Error('该档案已移除，请重新打开会话。');editMemory(latest);}catch(e){notice(e.message,true);}});
    card.append(edit);$('profile-basis').append(card);
  }
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
  $('send-scope').textContent = `我同意将文件文字、文件沉淀和用户档案发送给 ${destination}，先给我总结。`;
  $('upload-scope').textContent = `上传后自动将文件文字、文件沉淀和用户档案发送给 ${destination}，先给我总结。也可以不勾选，先在 Agent 中查看原文。`;
  $('formats').textContent = c?.pdf ? 'TXT · Markdown · Word · PDF（文字层） / 最大 8 MB' : 'TXT · Markdown · Word / PDF 需安装解析组件 / 最大 8 MB';
}
async function refreshMemory() {
  state.memory = await api('/api/memory');
  $('memory-count').textContent = state.memory.entries.length;
  renderMemory();
  if(legacyBackend())notice('旧服务的临时文件仍保留。新版自动档案与流式对话请打开 http://127.0.0.1:8788/。');
}
function legacyBackend(){return Boolean(state.memory && state.memory.limits.file===undefined);}
function renderSnapshot() {
  $('snapshot-note').textContent = state.snapshot.length
    ? `本次可参考 ${state.snapshot.length} 条用户档案。可在「用户档案」查看与修改。`
    : '尚未保存用户档案，可以直接开始。文件沉淀会在侧栏整理，随时可改。';
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
function renderStorage() {
  const c = state.config?.storage, doc = state.doc;
  if (!doc) return;
  const sync = doc.sync || {};
  $('cos-file-state').textContent = sync.pending ? `待同步 · ${sync.error || '最新更改尚未写入 COS'}`
    : doc.persistent ? `COS 工作区 · 已同步 · ${doc.stored?.bucket || ''}` : '临时工作区 · 仅本次服务内存';
  $('cos-scope').textContent = c?.configured ? `原文件、全部会话和文件沉淀将保存到 ${c.bucket}（${c.region}）。关闭后保留。` : '请先配置 COS。临时工作区在服务停止后无法恢复。';
  $('cos-consent').closest('label').hidden = Boolean(doc.persistent);
  $('store-original').hidden = Boolean(doc.persistent);
  $('retry-sync').hidden = !sync.pending;
  $('knowledge-status').textContent = legacyBackend() ? '旧服务保留模式，文件沉淀未自动归入新版档案。新对话请在 8788 打开。' : sync.pending ? '最新沉淀还未同步到 COS，可重试保存。' : doc.persistent ? '沉淀自动归入用户档案，工作区同步到 COS。' : '沉淀已归入本机用户档案；文件与对话仍是临时工作区。';
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
  if(legacyBackend()){notice('这里保留旧临时文件。请在 http://127.0.0.1:8788/ 上传新文件并使用新版。',true);return;}
  if (state.busy) return;
  if (bytes.byteLength > 8 * 1024 * 1024) { notice('文件最大 8 MB，请拆分后上传。', true); return; }
  const authorized = $('upload-consent').checked;
  let uploaded = null;
  await operation('正在读取文件…', async (signal, active) => {
    let binary = '';
    for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    const doc = await api('/api/documents', { name, content: btoa(binary), persist: $('persist-consent').checked }, signal);
    if (!active()) return;
    showDocument(doc); uploaded = doc.id;
    notice('已进入 Agent 对话。你可以先看原文，或让文启总结。');
  });
  if (uploaded && state.doc?.id === uploaded && authorized && !state.doc.messages?.length) {
    $('send-consent').checked = true;
    await askAgent('');
  }
}
async function finish() {
  if (state.busy) return;
  try {
    await flushDraft();
    if (state.doc) await api('/api/workspace/close', { id: state.doc.id });
    state.doc = null; state.snapshot = []; clearResults();
    localStorage.removeItem('wenqi-active-file');
    $('workspace').hidden = true; $('welcome').hidden = false;
    $('current-file').textContent = '还没有打开文件'; $('upload').value = '';
    await refreshWorkspaces(); notice('工作区已关闭，对话和文件沉淀会保留。临时工作区需要启用 COS 才能跨服务重启恢复。');
  } catch (e) { notice(e.message, true); }
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
  if (a.overview !== a.response && (state.snapshot.length || state.doc.knowledge?.entries.length || !first)) bubble.append(el('p', a.overview, 'personal-meaning'));
  if (a.positioning) {
    const guess = el('div', undefined, 'positioning');
    const knownRole = (state.historyKnowledge || state.doc.knowledge)?.entries.some(e => e.field==='role' && ['user_fact','global_ref','user_edit'].includes(e.kind));
    guess.append(el('small', knownRole ? '本文件阅读身份 · 来自沉淀，可修改' : first ? '可能的阅读视角 · 仅是猜测，待你确认' : '本轮阅读视角 · 按对话更新，仍可纠正'), el('p', a.positioning)); bubble.append(guess);
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
  if (!state.restoring) { $('agent-start').hidden = true; $('chat-form').hidden = false; $('export-analysis').hidden = false; }
  $('retry-chat').hidden = true;
  if (!state.restoring) bubble.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
async function askAgent(message, retry = false) {
  if (!state.doc || state.busy) return;
  if (!state.config?.configured) { notice('请先配置模型接口，再开始真实对话。', true); openSettings(); return; }
  if (!$('send-consent').checked) { notice('请先确认文件与已保存背景的发送范围。', true); return; }
  await state.cancellation; await flushDraft();
  if (message && !retry) messageBubble('user', message);
  state.retryMessage = message;
  clearResults();
  await operation(state.turns ? '文启正在思考你的问题…' : '文启正在读文件，准备第一轮总结…', async (signal, active) => {
    const output=streamingOutput($('agent-thread'),'文启 · 流式输出');
    let got;
    try{got=await apiStream('/api/chat',{id:state.doc.id,message,consent:true},signal,(field,text)=>{if(active())output.delta(field,text);});output.finish();}
    catch(e){output.fail();throw e;}
    if (!active()) return;
    showDocument(got.document); state.retryMessage = null; await refreshMemory(); await refreshWorkspaces();
    $('agent-thread').lastElementChild?.scrollIntoView({behavior:'smooth',block:'start'});
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
  $('memory-usage').textContent = `个人背景 ${m.usage.user} / ${m.limits.user} 字　长期事项 ${m.usage.memory} / ${m.limits.memory} 字　自动沉淀 ${m.entries.filter(e=>e.auto).length} 条`;
  $('memory-list').replaceChildren();
  if (!m.entries.length) $('memory-list').append(el('p', '还没有用户档案。文件沉淀会自动加入，你可以随时修改或删除。', 'memory-empty'));
  const kinds={user_fact:'用户自述',document_fact:'文件事实',inference:'AI 推断 · 未确认',unknown:'待核实',global_ref:'已有档案',user_edit:'用户修改'};
  for (const entry of m.entries) {
    const row = el('div', undefined, 'memory-entry');
    row.append(el('p', entry.content), el('small', `${entry.target === 'file' ? '自动文件沉淀 · '+(kinds[entry.kind] || '已归档') : entry.target === 'user' ? '个人背景' : '长期事项'} · ${entry.source} · ${entry.updated}`));
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
  $('memory-edit-title').textContent = entry.id ? '修改用户档案' : '添加用户档案';
  $('memory-target').value = entry.target || 'user'; $('memory-target').disabled = Boolean(entry.id);
  $('memory-content').value = entry.content || ''; $('memory-content').maxLength=entry.auto ? 2000 : 3000;
  $('memory-target').querySelector('option[value=file]').disabled=!entry.auto;
  $('memory-source').textContent = entry.source || '来源：用户手动确认'; $('memory-result').textContent = '';
  $('edit-memory-dialog').showModal();
}
async function memoryChanged() {
  await refreshMemory();
  if (state.doc) {
    await flushDraft(); await api('/api/refresh-memory', { id: state.doc.id });
    showDocument(await api('/api/workspace/open', { file_id: state.doc.file_id, thread_id: state.doc.id }));
    notice('用户档案已更新，历史对话保留；下条回复将读取最新档案。');
  } else notice('用户档案已更新，下次打开文件会参考这些信息。');
}

$('upload').addEventListener('change', async (e) => {
  const file = e.target.files[0]; if (file) await upload(file.name, new Uint8Array(await file.arrayBuffer()));
});
for (const event of ['dragover', 'dragleave', 'drop']) $('upload-zone').addEventListener(event, async (e) => {
  e.preventDefault(); $('upload-zone').classList.toggle('dragging', event === 'dragover');
  if (event === 'drop' && !state.busy) { const f = e.dataTransfer.files[0]; if (f) await upload(f.name, new Uint8Array(await f.arrayBuffer())); }
});
$('sample').addEventListener('click', () => upload('合成体验-奖学金通知.txt', new TextEncoder().encode(
  '合成体验材料：以下学校、项目和要求均为虚构，仅用于体验。\n星河大学项目创新奖学金申请通知\n面向全日制在校本科生，鼓励具有软件或科研项目实践经历的同学申请。\n申请人须提交项目成果说明、成绩单，以及个人申请陈述。\n申请人须确认本学年没有重复获得同类资助。\n申请截止时间：2026年10月20日17:00（北京时间）。\n报名链接：https://example.com/synthetic-apply（合成示例链接）\n材料须由本人核对，并通过学校指定平台提交；准备材料不代表资格通过。')));
$('new-session').addEventListener('click', finish); $('finish').addEventListener('click', finish);
$('analyze').addEventListener('click', () => askAgent(state.doc?.messages?.length ? '请按最新文件沉淀和用户档案继续解释这份文件。' : ''));
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
    const output=streamingOutput(document.querySelector('.work-column'),'文启 · 正在生成初稿');
    let got;
    try{got=await apiStream('/api/action',{id:state.doc.id,revision:state.revision,goal,confirmed:true,consent:true},signal,(field,text)=>{if(active())output.delta(field,text);});output.finish();}
    catch(e){output.fail();throw e;}
    if (!active()) return;
    state.doc.draft = got.draft; state.doc.sync = got.sync; renderStorage(); state.draft = got.draft; $('draft-title').textContent = got.draft.title; $('draft').value = got.draft.markdown;
    $('draft-section').hidden = false; $('action-section').hidden = true;
    $('draft-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
    notice('模型初稿已生成。请核对并修改，再导出。');
  });
});
$('export-analysis').addEventListener('click', () => { if (state.analysis) download('文启解读-' + state.doc.name + '.md', analysisMarkdown()); });
$('export-draft').addEventListener('click', async () => {
  try { await flushDraft(); } catch (e) { notice(e.message, true); }
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
      showDocument(await api('/api/workspace/open', { file_id: state.doc.file_id, thread_id: state.doc.id }));
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
      content: $('memory-content').value, entry_id: state.editing.id || '', consent: true,
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
    $('cos-consent').checked = false; renderStorage(); await refreshWorkspaces();
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
    showDocument(await api('/api/workspace/open', { file_id: state.doc.file_id, thread_id: state.doc.id }));
    await refreshWorkspaces(); notice(state.doc.sync.pending ? '原文件已保存，但工作区快照还未同步，请重试。' : '原文件、对话和文件沉淀已保存到 COS，后续更改会自动同步。', Boolean(state.doc.sync.pending));
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
const knowledgeLabels = {role:'阅读身份',background:'相关背景',conditions:'已知条件',notes:'文件要点',pending:'待核实事项'};
function rememberTabs() {
  localStorage.setItem('wenqi-open-files', JSON.stringify(state.tabs.map(t => t.id)));
  if (state.doc) localStorage.setItem('wenqi-active-file', state.doc.file_id);
}
async function refreshWorkspaces() {
  state.workspaces = (await api('/api/workspaces')).workspaces;
  if (!state.tabs.length) {
    try { const ids = JSON.parse(localStorage.getItem('wenqi-open-files') || '[]'); state.tabs = state.workspaces.filter(w => ids.includes(w.id)); } catch { state.tabs = []; }
  }
  state.tabs = state.tabs.filter(t => state.workspaces.some(w => w.id === t.id));
  for (const id of ['recent-workspaces', 'sidebar-workspaces']) $(id).replaceChildren();
  $('current-file').hidden=state.workspaces.length>0;
  $('recent-count').textContent = `${state.workspaces.length} 个工作区`;
  $('workspace-storage-note').textContent = '已保存的工作区从 COS 恢复；临时工作区只保留到本次服务停止。';
  if (!state.workspaces.length) $('recent-workspaces').append(el('p','还没有聊过的文件。拖入第一份文件开始。','subtle'));
  for (const w of state.workspaces) {
    const row = el('article',undefined,'workspace-card');
    const open = el('button',w.name,'workspace-open'); open.dataset.lock = ''; open.disabled = state.busy;
    open.addEventListener('click',()=>openWorkspace(w.id));
    row.append(open,el('p',w.preview || '已读取，随时开始聊。','workspace-preview'),el('small',`${w.thread_ids.length} 个会话 · ${w.sync?.pending ? '待同步' : w.persistent ? 'COS 已保存' : '临时工作区'}${w.available ? '' : ' · 请恢复对应 COS 配置'}`));
    const remove = el('button','移除','workspace-delete'); remove.dataset.lock = ''; remove.disabled = state.busy;
    remove.addEventListener('click',async()=>{
      if (!confirm(`移除「${w.name}」和全部会话、文件沉淀？\n已登记的 COS 原文件和工作区快照也将删除。用户档案不受影响。`)) return;
      await operation('正在移除工作区…',async()=>{
        await api('/api/workspace/delete',{file_id:w.id,consent:true});
        state.tabs = state.tabs.filter(t=>t.id!==w.id); rememberTabs();
        await refreshWorkspaces(); notice('工作区已移除。');
      },false);
    });row.append(remove);$('recent-workspaces').append(row);
    const side = el('button',w.name,'sidebar-file'); side.dataset.lock = ''; side.disabled = state.busy;
    side.classList.toggle('selected',state.doc?.file_id===w.id);side.addEventListener('click',()=>openWorkspace(w.id));$('sidebar-workspaces').append(side);
  }
  renderTabs();
}
function renderTabs() {
  $('workspace-tabs').replaceChildren();
  for (const t of state.tabs) {
    const item = el('div',undefined,'file-tab');item.classList.toggle('selected',t.id===state.doc?.file_id);
    const open = el('button',t.name);open.dataset.lock='';open.disabled=state.busy;open.addEventListener('click',()=>openWorkspace(t.id));
    const close = el('button','×','tab-close');close.title='关闭标签，对话保留';close.dataset.lock='';close.disabled=state.busy;
    close.addEventListener('click',async()=>{ if(t.id===state.doc?.file_id) await finish(); state.tabs=state.tabs.filter(v=>v.id!==t.id);rememberTabs();renderTabs(); });
    item.append(open,close);$('workspace-tabs').append(item);
  }
  $('thread-tabs').replaceChildren();
  for (const t of state.doc?.threads || []) {
    const button=el('button',t.title,'thread-tab');button.dataset.lock='';button.disabled=state.busy;button.classList.toggle('selected',t.id===state.doc.id);
    button.addEventListener('click',()=>openWorkspace(state.doc.file_id,t.id));$('thread-tabs').append(button);
  }
  if (state.doc) {
    const add=el('button','＋ 新开会话','new-thread');add.dataset.lock='';add.disabled=state.busy;
    add.addEventListener('click',async()=>{
      try {await flushDraft();} catch(e){notice(e.message,true);return;}
      await operation('正在新建会话…',async()=>{
        const doc=await api('/api/workspace/thread',{file_id:state.doc.file_id,title:`会话 ${state.doc.threads.length+1}`});
        showDocument(doc);await refreshWorkspaces();notice('新会话已打开，共享这份文件的沉淀。');
      });
    });$('thread-tabs').append(add);
  }
}
async function openWorkspace(fileId, threadId) {
  if (state.busy) return;
  try {await flushDraft();} catch(e){notice(e.message,true);return;}
  await operation('正在打开文件工作区…',async()=>{
    showDocument(await api('/api/workspace/open',{file_id:fileId,...(threadId ? {thread_id:threadId} : {})}));
    await refreshWorkspaces();notice('');
  });
}
function showDocument(doc) {
  state.doc=doc;clearResults();state.turns=0;state.retryMessage=null;state.background=[];
  state.snapshot=structuredClone(doc.memory || []);
  if (!state.tabs.some(t=>t.id===doc.file_id)) state.tabs.push({id:doc.file_id,name:doc.name});
  rememberTabs();
  $('agent-thread').replaceChildren();$('chat-input').value='';$('retry-chat').hidden=true;
  $('welcome').hidden=true;$('workspace').hidden=false;
  $('doc-name').textContent=doc.name;$('current-file').textContent=doc.name;
  $('doc-meta').textContent=`${doc.characters.toLocaleString()} 字 · ${doc.threads.length} 个会话`;
  $('send-consent').checked=Boolean(doc.send_authorized);$('cos-consent').checked=false;
  state.restoring=true;
  if (!doc.messages?.length) messageBubble('system','文件已解析。可以直接先看总结，背景和行动都按你的需要继续。');
  for (const message of doc.messages || []) {
    if (message.role==='assistant' && message.analysis) {
      state.snapshot=message.memory || doc.memory || [];state.historyKnowledge=message.knowledge || {entries:[]};state.analysis=message.analysis;renderAnalysis();
    } else messageBubble(message.role,message.content);
  }
  state.restoring=false;state.historyKnowledge=null;state.snapshot=structuredClone(doc.analysis ? state.snapshot : doc.memory || []);
  state.analysis=doc.analysis ? state.analysis : null;state.revision=doc.revision;
  if (!doc.analysis) document.querySelectorAll('.action-choice,.skip-questions').forEach(b=>{b.dataset.expired='true';b.disabled=true;});
  $('agent-start').hidden=Boolean(doc.messages?.length && doc.send_authorized);
  $('analyze').textContent=doc.messages?.length ? '按最新沉淀继续聊 ↗' : '让文启先总结文件 ↗';
  $('chat-form').hidden=!doc.messages?.length || !doc.send_authorized;
  $('export-analysis').hidden=!state.analysis;
  $('context-note').hidden=!doc.outdated;
  $('context-note').textContent='沉淀或档案已更新，历史对话保留。下条回复会读取最新修改；旧回复中的行动入口已停用。';
  if (doc.draft) {state.draft=structuredClone(doc.draft);$('draft-title').textContent=doc.draft.title;$('draft').value=doc.draft.markdown;$('draft-section').hidden=false;}
  renderSources();renderSnapshot();renderKnowledge();renderProfileBasis();renderHighlights();renderStorage();renderTabs();
}
function renderHighlights() {
  $('summary-highlights').replaceChildren();
  for(const h of state.doc?.highlights || []) {
    const card=el('article',undefined,`summary-highlight ${h.kind}`);
    card.append(el('small',h.title || ({deadline:'截止时间',date:'相关日期',registration_link:'报名链接',link:'文件链接',requirement:'材料 / 条件'}[h.kind] || '文件要点')));
    if(h.kind==='link') {const a=el('a',h.value);a.href=h.value;a.target='_blank';a.rel='noopener noreferrer';card.append(a);}
    else card.append(el('strong',h.value));
    if(h.countdown) {
      let value;
      if(h.date_info?.timestamp) {
        const seconds=Math.floor((new Date(h.date_info.timestamp).getTime()-Date.now())/1000);
        value=seconds<=0 ? '已截止' : `倒计时 ${Math.floor(seconds/86400)} 天 ${Math.floor(seconds%86400/3600)} 小时`;
      } else value=h.countdown.state==='expired' ? '已过截止日期' : `距截止日期约 ${h.countdown.days} 天`;
      card.append(el('span',value,'countdown'));
    }
    if(h.date_info?.note) card.append(el('small',h.date_info.note,'date-note'));
    const source=el('button',`${h.source_id} · 原文 ↗`,'highlight-source');source.addEventListener('click',()=>locate(h.source_id));card.append(source);
    $('summary-highlights').append(card);
  }
}
function renderKnowledge() {
  $('file-knowledge').replaceChildren();
  document.querySelector('.knowledge-panel>.subtle').textContent=legacyBackend() ? '这里保留旧服务的文件卡片。自动归档功能在新版 8788。' : '自动加入用户档案，保留原文与对话来源。修改后下一轮重载。';
  document.querySelector('.composer-bottom small').textContent=legacyBackend() ? '旧服务保留临时文件；新版对话请在 8788 打开。' : '发送即同意将本次文件、已保存背景和对话发给同一模型。文件沉淀会自动加入用户档案，可在右侧直接修改。';
  const entries=state.doc?.knowledge?.entries || [];
  if(!entries.length) $('file-knowledge').append(el('p','还没有文件沉淀。聊过之后会在这里整理，也可以主动补充。','subtle'));
  for(const entry of entries) {
    const card=el('article',undefined,'knowledge-card');card.append(el('h3',entry.label || knowledgeLabels[entry.field]),el('p',entry.value),el('small',entry.source));
    const detail=el('details');detail.append(el('summary','查看来源'),el('p',entry.quote,'knowledge-quote'));card.append(detail);
    if(entry.source_id) {const source=el('button',`${entry.source_id} · 原文 ↗`,'text-button');source.addEventListener('click',()=>locate(entry.source_id));detail.append(source);}
    const buttons=el('div',undefined,'button-row');
    const edit=el('button','修改','knowledge-edit');edit.dataset.lock='';edit.disabled=state.busy;edit.addEventListener('click',()=>editKnowledge(entry));
    buttons.append(edit);card.append(buttons);$('file-knowledge').append(card);
  }
}
function editKnowledge(entry={}) {
  state.knowledgeEditing={file_id:state.doc.file_id,expected_revision:state.doc.knowledge.revision,...entry};
  $('knowledge-field').value=entry.field || 'background';$('knowledge-field').disabled=Boolean(entry.field);
  $('knowledge-value').value=entry.value || '';$('knowledge-result').textContent='';$('knowledge-remove').hidden=!entry.field;
  $('knowledge-dialog').showModal();
}
async function saveKnowledge(value) {
  const editing=state.knowledgeEditing;
  await flushDraft();
  await api('/api/workspace/knowledge',{file_id:editing.file_id,field:$('knowledge-field').value,value,expected_revision:editing.expected_revision});
  $('knowledge-dialog').close();
  showDocument(await api('/api/workspace/open',{file_id:state.doc.file_id,thread_id:state.doc.id}));
  await refreshMemory();await refreshWorkspaces();notice('文件沉淀和用户档案已同步更新，下条回复会优先使用你的修改。');
}
$('knowledge-add').addEventListener('click',()=>editKnowledge());
$('knowledge-form').addEventListener('submit',async e=>{
  e.preventDefault();e.submitter.disabled=true;
  try{await saveKnowledge($('knowledge-value').value);}catch(error){$('knowledge-result').textContent=error.message;}finally{e.submitter.disabled=false;}
});
$('knowledge-remove').addEventListener('click',async()=>{
  if(!confirm('从这份文件的沉淀中移除该内容？Agent 将不再自动恢复这个字段。'))return;
  try{await saveKnowledge('');}catch(e){$('knowledge-result').textContent=e.message;}
});
async function flushDraft() {
  clearTimeout(state.draftTimer);
  if(!state.doc || !state.draft) return state.draftQueue;
  const id=state.doc.id, value=$('draft').value;
  if(value===state.draft.markdown) return state.draftQueue;
  state.draft.markdown=value;
  state.draftQueue=state.draftQueue.catch(()=>{}).then(async()=>{
    const got=await api('/api/workspace/draft',{id,markdown:value});
    if(state.doc?.id===id){state.doc.sync=got.sync;state.doc.draft.markdown=value;renderStorage();}
  }).catch(e=>{if(state.doc?.id===id)state.draft.markdown=null;throw e;});
  return state.draftQueue;
}
$('draft').addEventListener('input',()=>{clearTimeout(state.draftTimer);state.draftTimer=setTimeout(()=>flushDraft().catch(e=>notice(e.message,true)),1000);});
$('draft').addEventListener('blur',()=>flushDraft().catch(e=>notice(e.message,true)));
$('retry-sync').addEventListener('click',async()=>{
  if(!state.config?.storage?.configured){openCOS();return;}
  await operation('正在重试 COS 保存…',async()=>{
    await api('/api/workspace/sync',{file_id:state.doc.file_id,consent:true});
    showDocument(await api('/api/workspace/open',{file_id:state.doc.file_id,thread_id:state.doc.id}));await refreshWorkspaces();
    notice(state.doc.sync.pending ? state.doc.sync.error : '工作区已同步到 COS。',Boolean(state.doc.sync.pending));
  },false);
});
setInterval(()=>{if(state.doc)renderHighlights();},60000);

try { state.config = await api('/api/status'); renderConfig(); await refreshMemory(); await refreshWorkspaces();
  const saved = localStorage.getItem('wenqi-active-file'); if (saved && state.workspaces.some(w => w.id === saved && w.available)) await openWorkspace(saved);
}
catch (e) { notice('无法连接本机服务：' + e.message, true); }
