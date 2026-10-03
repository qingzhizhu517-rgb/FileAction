const $ = (id) => document.getElementById(id);
const token = document.querySelector('meta[name="fileaction-token"]').content;
const state = { doc: null, analysis: null, draft: null, revision: 0, background: [], snapshot: [], memory: null, config: null, busy: false, epoch: 0, controller: null, editing: null, cancellation: Promise.resolve(), turns: 0, retryMessage: null, workspaces: [], tabs: [], knowledgeEditing: null, restoring: false, draftTimer: null, draftQueue: Promise.resolve() };
const READING_MARKER='\n\n〔文启附带的阅读方式，不是用户身份事实〕\n';
function readingRequest(message,repair=false){
  const date=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai'}).format(new Date());
  return (message || '请按我的用户档案，帮我理解这份文件对我的意义。')+READING_MARKER+
    `阅读日期：${date}（北京时间）。请像我的个人助手，先回应问题，解释与我的已知身份、方向或约束相关的意义、取舍和下一步。`+
    '速览已展示日期、入口和材料，勿重复。summary≤200字、response≤120字。insights突出与你有关并列实际memory_refs，不问已知身份，核心问题可跳过。'+
    '其他文件的具体资格、截止日期和要求不要套到本文件；已截止要说明，宽泛背景不代表资格通过。'+
    'file_knowledge_updates仅记录我的自述或个人档案，notes仅为我的目标和偏好。文件摘要、报名规则、日期和猜测不沉淀；无新增个人信息给[]。档案中的document_fact不是我的个人背景。'+
    '先输出response、overview。Agent问题和猜测不是本人自述；阅读方式不得沉淀。quote须逐字复制一个segment.text，保留空格标点。'+
    (repair ? '上次引用校验失败：请重抄错误quote并核对source_id，选足以支持判断的短片段，勿改写或跨段。' : '');
}

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
function streamingOutput(container,title,firstReading=false) {
  const node=el('section',undefined,'stream-preview');node.append(el('div',title,'message-label'));
  if(firstReading)node.classList.add('reading-stream');
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
    fail(error){
      node.classList.add('stream-failed');status.setAttribute('role','alert');
      let reason=error?.message || '无法确认模型已完成输出。';
      if(error?.name==='AbortError')reason='请求已中断或超时。';
      else if(error instanceof SyntaxError)reason='收到的流式数据格式不正确。';
      else if(error instanceof TypeError && /fetch|network|load failed/i.test(reason))reason='浏览器与本地服务的连接失败，请检查服务是否仍在运行。';
      status.textContent=`${reason}\n本次回复尚未保存，临时文字仅供参考。可以重试。`;
    },
  };
}
function renderProfileBasis() {
  $('profile-basis').replaceChildren();
  const rows=state.doc?.profile_basis || [];
  $('profile-context-summary').textContent=`本轮参考的用户档案 · ${rows.length} 条`;
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
  let timer = setTimeout(() => controller.abort(), 110000);
  const renewDeadline=()=>{clearTimeout(timer);timer=setTimeout(()=>controller.abort(),110000);};
  setBusy(true, message, cancellable);
  try { await work(controller.signal, () => state.epoch === epoch,renewDeadline); }
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
  document.querySelectorAll('.turn-options .action-choice, .turn-options .skip-questions, .clarification-trigger').forEach((button) => {
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
  if (content) {
    const marker=role==='user' ? content.lastIndexOf(READING_MARKER) : -1;
    bubble.append(el('p',marker<0 ? content : content.slice(0,marker),'message-text'));
    if(marker>=0){const preference=el('details',undefined,'reading-preference');const date=content.slice(marker+READING_MARKER.length).match(/^阅读日期：([0-9-]+)/)?.[1];preference.append(el('summary','已附带：结合我的档案回答'),el('p',`${date ? '本次阅读日期：'+date+'（北京时间）。' : ''}结合已有档案与当前目标，说明具体关联、取舍和下一步；不套用其他文件的要求，不重复询问已知身份。被引用的问题和 AI 猜测不算本人确认。`,'subtle'));bubble.append(preference);}
  }
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
    $('source-preview').replaceChildren();
    for(const segment of state.doc.segments){
      const line=el('div',undefined,'source-preview-line');line.dataset.sourceId=segment.id;
      line.append(el('small',`${segment.id} · ${segment.location}`),el('p',segment.text));
      if(segment.id===id){line.classList.add('is-target');line.tabIndex=-1;}
      $('source-preview').append(line);
    }
    const segment=state.doc.segments.find(s=>s.id===id);
    $('source-dialog-title').textContent=state.doc.name;
    $('source-dialog-location').textContent=`${id} · ${segment.location} · 已高亮出处，可上下阅读`;
    if(!$('source-dialog').open)$('source-dialog').showModal();
    const target=$('source-preview').querySelector('.is-target');
    requestAnimationFrame(()=>{if(!$('source-dialog').open)return;target.focus({preventScroll:true});$('source-preview').scrollTop+=target.getBoundingClientRect().top-$('source-preview').getBoundingClientRect().top-24;});
  } else {
    notice('当前文件中没有找到这处原文，请重新打开文件后再试。',true);
  }
}
function clarificationButton(question,analysis,label='点击回答',kind='question'){
  const button=el('button',label,'clarification-trigger');button.type='button';button.dataset.lock='';
  button.addEventListener('click',()=>{
    if(state.busy || state.analysis!==analysis || button.dataset.expired==='true')return;
    state.clarification={id:state.doc.id,analysis,question:question.slice(0,1400),kind};
    $('clarification-title').textContent=kind==='positioning' ? '补充或纠正阅读视角' : '回答这条问题';
    $('clarification-question').textContent=question;
    $('clarification-answer').value='';
    $('clarification-answer').placeholder=kind==='positioning' ? '说说你的实际阅读目的，例如自己考虑申请、帮别人整理，或只想了解……' : '按你的实际情况回答，也可以说明目前还不确定……';
    $('clarification-dialog').showModal();$('clarification-answer').focus();
  });return button;
}
$('clarification-skip').addEventListener('click',()=>$('clarification-dialog').close());
$('clarification-dialog').addEventListener('close',()=>{state.clarification=null;});
$('clarification-form').addEventListener('submit',async e=>{
  e.preventDefault();const context=state.clarification,answer=$('clarification-answer').value.trim();
  if(!answer)return;
  if(!context || state.doc?.id!==context.id || state.analysis!==context.analysis || state.busy){notice('这条问题已更新，请回应最新一轮问题。',true);$('clarification-dialog').close();return;}
  const message=`关于“${context.question}”，我的补充是：${answer}`;
  $('clarification-dialog').close();await askAgent(message);
});
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
  document.querySelectorAll('.turn-options .action-choice, .turn-options .skip-questions, .clarification-trigger').forEach((button) => {
    button.dataset.expired = 'true'; button.disabled = true;
  });
  const first = state.turns === 0;
  const bubble = messageBubble('assistant', first ? '' : a.response);
  let fileOverview=null;
  if (first) {
    fileOverview=el('details',undefined,'file-overview');fileOverview.append(el('summary','文件概要 · 展开查看'),el('p',a.summary,'file-summary'));
  }
  if(first){
    const focus=el('section',undefined,'personal-focus');focus.append(el('h3','与你有关'),el('small',state.snapshot.length ? '结合你的信息，先看这些影响与选择' : '先看影响与选择；个人情况不明的部分会注明'));
    for(const insight of a.insights.slice(0,3)){
      const row=el('article',undefined,'personal-focus-item');row.append(el('h4',insight.title),el('p',insight.meaning));focus.append(row);
    }
    bubble.append(focus);
    const response=el('details',undefined,'response-context');response.append(el('summary','文启的补充说明 · 展开查看'),el('p',a.response,'message-text'));
    if(a.overview!==a.response)response.append(el('p',a.overview,'personal-meaning'));
    bubble.append(response);
  }
  if (a.positioning) {
    const guess = el('div', undefined, 'positioning');
    const knownRole = (state.historyKnowledge || state.doc.knowledge)?.entries.some(e => e.field==='role' && isPersonalKnowledge(e));
    guess.append(el('small', knownRole ? '结合你的沉淀 · 阅读视角仍可纠正' : first ? '可能的阅读视角 · 仅是猜测，可补充或纠正' : '本轮阅读视角 · 按对话更新，仍可纠正'), el('p', a.positioning),clarificationButton(a.positioning,a,'补充或纠正阅读视角','positioning')); bubble.append(guess);
  }
  if(fileOverview)bubble.append(fileOverview);
  const detail = el('details', undefined, 'insight-details');
  detail.append(el('summary', '查看依据与未知'));
  for (const insight of a.insights) {
    const card = el('div', undefined, 'insight');
    card.append(el('h3', insight.title), el('p', insight.meaning, 'meaning'));
    const dl = el('dl');
    const background = insight.background_refs.map((i) => state.background[i]).concat(insight.memory_refs.map((id) => state.snapshot.find((m) => m.id === id)?.content)).filter(Boolean).join('；');
    for (const [label, value] of [['原文明示', insight.document_fact], ['背景来源', background || '本条未引用已保存条目；本次自述可在对话中核对'], ['系统推断', insight.inference || '无额外推断'], ['尚待确认', insight.unknown || '请核对原文']]) {
      const row = el('div', undefined, 'reason-row'); row.append(el('dt', label), el('dd', value)); dl.append(row);
      if(label==='尚待确认' && insight.unknown && !['无','无。','无须补充'].includes(insight.unknown.trim()))row.lastElementChild.append(clarificationButton(insight.unknown,a,'补充这项信息'));
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
    a.questions.forEach((q) => {const button=clarificationButton(q,a,q);button.classList.add('agent-question');button.append(el('span','点击回答 ↗','question-hint'));questions.append(button);});
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
  await operation(state.turns ? '文启正在思考你的问题…' : '文启正在读文件，准备第一轮总结…', async (signal, active,renewDeadline) => {
    let output=streamingOutput($('agent-thread'),'文启 · 流式输出',state.turns===0);
    let got;
    for(let attempt=0;attempt<2;attempt++){
      try{
        const requestMessage=readingRequest(message,attempt===1);
        if(requestMessage.length>4000)throw new Error('回答内容较长，请控制在3500字以内。');
        got=await apiStream('/api/chat',{id:state.doc.id,message:requestMessage,consent:true},signal,(field,text)=>{if(active() && field!=='summary')output.delta(field,text);});output.finish();break;
      }catch(e){
        const citationFailure=/原文引用校验失败/.test(e.message || '');
        if(attempt===0 && citationFailure && active() && !signal.aborted){
          output.finish();
          output=streamingOutput($('agent-thread'),'文启 · 正在校对原文引用',state.turns===0);
          notice('原文引用未匹配，正在自动纠正一次。未通过校验的临时输出不会保存。');
          $('loading').textContent='正在重新核对引用，请稍候；仍可取消。';
          renewDeadline();continue;
        }
        if(attempt===1 && citationFailure)e=new Error('已自动纠正一次，仍未能匹配原文。'+e.message);
        output.fail(e);throw e;
      }
    }
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
    catch(e){output.fail(e);throw e;}
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
const knowledgeLabels = {role:'我的阅读身份',background:'我的相关经历',conditions:'我的实际条件',notes:'我的目标与偏好',pending:'我的待补充信息'};
function isPersonalKnowledge(entry){
  if(['user_fact','user_edit'].includes(entry.kind))return true;
  if(entry.kind!=='global_ref')return false;
  // 旧档案中的文件事实不能通过 global_ref 又被当成本人信息。
  return (state.doc?.memory || []).some(m=>
    (['user_fact','user_edit'].includes(m.kind) || (!m.kind && ['user','memory'].includes(m.target))) &&
    typeof m.content==='string' && entry.quote && m.content.includes(entry.quote));
}
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
  if(state.doc?.file_id!==doc.file_id)$('profile-context').open=false;
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
  if (!doc.analysis) document.querySelectorAll('.action-choice,.skip-questions,.clarification-trigger').forEach(b=>{b.dataset.expired='true';b.disabled=true;});
  $('agent-start').hidden=Boolean(doc.messages?.length && doc.send_authorized);
  $('analyze').textContent=doc.messages?.length ? '按最新沉淀继续聊 ↗' : '让文启先总结文件 ↗';
  $('chat-form').hidden=!doc.messages?.length || !doc.send_authorized;
  $('export-analysis').hidden=!state.analysis;
  $('context-note').hidden=!doc.outdated;
  $('context-note').textContent='沉淀或档案已更新，历史对话保留。下条回复会读取最新修改；旧回复中的行动入口已停用。';
  if (doc.draft) {state.draft=structuredClone(doc.draft);$('draft-title').textContent=doc.draft.title;$('draft').value=doc.draft.markdown;$('draft-section').hidden=false;}
  renderSources();renderSnapshot();renderKnowledge();renderProfileBasis();renderHighlights();renderStorage();renderTabs();
}
// 直接从已解析原文整理速览，也修正旧工作区缓存的错误分类。
function quicklookItems(doc) {
  const dates=[],links=[],requirements=[],seenDates=new Set(),seenLinks=new Set(),seenRequirements=new Set();
  const datePattern=/(?:\d{4}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日?|\d{4}\s*[/.-]\s*\d{1,2}\s*[/.-]\s*\d{1,2}|\d{1,2}\s*月\s*\d{1,2}\s*日)(?:[T\s]*\d{1,2}[:：]\d{2}(?::\d{2})?)?/g;
  for(const s of doc?.segments || []) {
    const text=s.text || '',base={source_id:s.id,quote:text};
    const urlRanges=[...text.matchAll(/https?:\/\/[^\s<>"\u3000。；，、（）]+/g)];
    const dateMatches=[...text.matchAll(datePattern)].filter(d=>!urlRanges.some(u=>d.index>=u.index && d.index<u.index+u[0].length));
    for(const match of dateMatches) {
      const value=match[0].trim(),parts=value.match(/\d+/g).map(Number),full=parts[0]>=1000;
      const [year,month,day,hour,minute,second]=full ? parts : [2000,...parts];
      const valid=new Date(Date.UTC(year,month-1,day));
      if(valid.getUTCFullYear()!==year || valid.getUTCMonth()!==month-1 || valid.getUTCDate()!==day || (hour!==undefined && (hour>23 || minute>59 || (second || 0)>59)))continue;
      const before=text.slice(0,match.index).split(/[。；;\n]/).pop();
      const after=text.slice(match.index+value.length).split(/[。；;\n]/)[0];
      const labels=[...before.matchAll(/(?:报名|申请|缴费|付款|提交|报送|材料|活动|考试|笔试|口试|开赛|比赛|领取|公示|截止|截至|最迟)[^\d，,：:（）()]{0,8}/g)];
      const title=(labels.at(-1)?.[0] || '相关日期').trim();
      const deadline=/截止|截至|最迟|期限|结束/.test(title) || /^[\s（()）]*[，,]?[^。；]{0,8}(?:截止|截至)/.test(after);
      const key=title.replace(/\s/g,'')+'|'+parts.join('-');if(seenDates.has(key))continue;seenDates.add(key);
      let info=null;
      if(full) {
        const date=`${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
        const context=before+value+after;
        const offset=/北京时间|(?:UTC|GMT)\s*\+0?8(?::00)?/i.test(context) ? '+08:00' : /\b(?:UTC|GMT)\b(?!\s*[+-]\d)/i.test(context) ? '+00:00' : null;
        const timestamp=dateMatches.length===1 && hour!==undefined && offset ? `${date}T${String(hour).padStart(2,'0')}:${String(minute).padStart(2,'0')}:${String(second || 0).padStart(2,'0')}${offset}` : null;
        info={date,timestamp};
      }
      dates.push({...base,kind:deadline ? 'deadline' : 'date',title:deadline && title==='相关日期' ? '截止日期' : title,value,date_info:info});
    }
    const urls=[...text.matchAll(/https?:\/\/[^\s<>"\u3000。；，、（）]+/g)].map(m=>({value:m[0].replace(/[.,;）)\]}]+$/,''),index:m.index}));
    for(const value of s.links || [])if(!urls.some(u=>u.value===value))urls.push({value,index:text.indexOf(value)});
    for(const item of urls) {
      let url;try{url=new URL(item.value);}catch{continue;}
      if(!['http:','https:'].includes(url.protocol) || !url.hostname || url.username || url.password || /[\r\n]/.test(item.value))continue;
      if(seenLinks.has(url.href))continue;seenLinks.add(url.href);
      // 多个链接各自根据紧邻前文分类，避免整段的“报名”污染指南、附件。
      const before=item.index>=0 ? text.slice(0,item.index).split(/[。；;，,\n]/).pop().slice(-45) : urls.length===1 ? text.slice(-45) : '';
      const title=/流程|操作|指南|说明|教程/.test(before) ? '操作指南' : /附件|下载|材料|申请表|表格/.test(before) ? '附件 / 材料' : /报名|申请|注册/.test(before) ? '报名入口' : '参考链接';
      links.push({...base,kind:'link',title,value:url.href,host:url.host});
    }
    if(/须提交|需提交|材料要求|必备材料|申请条件|报名条件/.test(text)) {
      for(const item of text.split(/[；;\n]/).map(t=>t.trim()).filter(Boolean)) {
        const key=item.replace(/\s/g,'');if(seenRequirements.has(key))continue;seenRequirements.add(key);
        requirements.push({...base,kind:'requirement',value:item});
      }
    }
  }
  return {dates,links,requirements};
}
function renderHighlights() {
  const container=$('summary-highlights');container.replaceChildren();
  const groups=quicklookItems(state.doc);
  $('file-quicklook').hidden=!Object.values(groups).some(items=>items.length);
  for(const [key,title] of [['dates','时间节点'],['links','入口与资料'],['requirements','材料与条件']]) {
    const items=groups[key];if(!items.length)continue;
    const group=el('article',undefined,`quicklook-group quicklook-${key}`);group.append(el('h3',title));
    const extra=el('details',undefined,'quicklook-more');extra.append(el('summary',`其余 ${Math.max(0,items.length-3)} 项`));
    for(const [index,h] of items.entries()) {
      const row=el('div',undefined,`summary-highlight ${h.kind}`);
      if(key==='dates') {
        row.append(el('small',h.title,'highlight-label'),el('strong',h.value,'highlight-value'));
        if(h.kind==='deadline' && h.date_info) {
          const clock=el('div',undefined,'countdown');clock.dataset.clock=JSON.stringify(h.date_info);
          clock.append(el('small',h.date_info.timestamp ? '倒计时 · 距截止' : '距截止日期 · 按日期估算','countdown-label'),el('strong','','countdown-value'));row.append(clock);
        }
        if(h.kind==='deadline' && !h.date_info?.timestamp)row.append(el('small',!h.date_info ? '年份不完整，请核对原文。' : '仅按日期估算，具体时刻或时区请核对原文。','date-note'));
      } else if(key==='links') {
        const a=el('a',`${h.title} ↗`,'registration-entry');a.href=h.value;a.target='_blank';a.rel='noopener noreferrer';
        row.append(a,el('span',h.host,'link-address'));
      } else {
        const list=el('ul',undefined,'requirement-list');list.append(el('li',h.value.length>110 ? h.value.slice(0,110)+'…' : h.value));row.append(list);
      }
      const source=el('button',`${h.source_id} · 原文 ↗`,'highlight-source');source.addEventListener('click',()=>locate(h.source_id));row.append(source);
      if(index<3)group.append(row);else extra.append(row);
    }
    if(items.length>3)group.append(extra);
    container.append(group);
  }
  updateCountdowns();
}
function updateCountdowns() {
  const currentDate=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai'}).format(new Date());
  for(const clock of document.querySelectorAll('.countdown[data-clock]')) {
    const info=JSON.parse(clock.dataset.clock);let value='请核对截止时间',expired=false;
    if(info.timestamp) {
      const seconds=Math.floor((new Date(info.timestamp).getTime()-Date.now())/1000);
      if(Number.isFinite(seconds)){expired=seconds<=0;value=expired ? '已截止' : `${Math.floor(seconds/86400)} 天 ${Math.floor(seconds%86400/3600)} 小时 ${Math.floor(seconds%3600/60)} 分`;}
    } else if(info.date) {
      const days=Math.round((Date.parse(info.date+'T00:00:00Z')-Date.parse(currentDate+'T00:00:00Z'))/86400000);
      if(Number.isFinite(days)){expired=days<0;value=expired ? '已过截止日期' : days===0 ? '截止日期是今天 · 具体时刻待核对' : `约 ${days} 天`;}
    }
    clock.classList.toggle('expired',expired);clock.querySelector('.countdown-value').textContent=value;
  }
}
setInterval(updateCountdowns,60000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)updateCountdowns();});
function renderKnowledge() {
  $('file-knowledge').replaceChildren();
  $('project-memory-file').textContent=state.doc?.name || '';
  document.querySelector('.knowledge-panel>.subtle').textContent=legacyBackend() ? '这里保留旧服务中的本人信息。自动归档功能在新版 8788。' : '记录你在本文件交流中提供的信息，各会话共用，可修改。自动归入用户档案。';
  document.querySelector('.composer-bottom small').textContent=legacyBackend() ? '旧服务保留临时文件；新版对话请在 8788 打开。' : '发送即同意将本次文件、已保存背景和对话发给同一模型。文件沉淀会自动加入用户档案，可在右侧直接修改。';
  const entries=(state.doc?.knowledge?.entries || []).filter(isPersonalKnowledge);
  if(!entries.length) $('file-knowledge').append(el('p','还没有关于你的沉淀。可以直接看解读；你补充个人情况后会自动整理，也可主动添加。','subtle'));
  for(const entry of entries) {
    const card=el('article',undefined,'knowledge-card');card.append(el('h3',knowledgeLabels[entry.field] || entry.label),el('p',entry.value),el('small',entry.source));
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


try { state.config = await api('/api/status'); renderConfig(); await refreshMemory(); await refreshWorkspaces();
  const saved = localStorage.getItem('wenqi-active-file'); if (saved && state.workspaces.some(w => w.id === saved && w.available)) await openWorkspace(saved);
}
catch (e) { notice('无法连接本机服务：' + e.message, true); }
