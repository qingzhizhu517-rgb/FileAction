import { parseFile, evaluate, correctMaterial, exportMarkdown } from './engine.mjs';
import { DEMO_DATE, NOTICE_TEXT, MEMORY_TEXTS, UPDATED_ROSTER_TEXT, SAMPLE_FILES } from './fixtures.mjs';

// 所有个人正文只存在于本页内存或本模式的独立 localStorage。无网络请求。
const mode = document.body.dataset.mode === 'with-memory' ? 'with-memory' : 'no-memory';
const hasMemoryMode = mode === 'with-memory';
const storageKey = `doagent.demo.${mode}.memory.v1`;
const $ = (selector, root = document) => root.querySelector(selector);
const clone = (value) => JSON.parse(JSON.stringify(value));
const esc = (value = '') => String(value).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const ids = (set) => Array.from(set);
const stamp = () => new Date().toLocaleString('zh-CN', { hour12:false });
const cache = new Map();
let toastTimer;
let state = {
  tab:'notice', memory:[], materials:[], notice:null, pendingFiles:[],
  branch:'', deadlineConfirmed:false, channelConfirmed:false, prohibitionConfirmed:false,
  results:null, reviewed:new Set(), selected:new Set(), saveChecked:new Set(), saveCandidates:new Set(),
  version:1, epoch:0, request:0, stale:false, staleVersion:null, busy:false, uploading:false,
  message:'', error:false, pasteOpen:false, pasteKind:'notice', pasteText:{notice:'',material:''}, failMode:'off',
  startedAt:Date.now(), stats:{analyses:0,cacheHits:0,retries:0,dropped:0}, findMinutes:0, helpMinutes:0,
  saveMessage:'', ended:false, lastGeneratedAt:'', lastCheckDate:null
};

function readMemory() {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return [];
    const data = JSON.parse(raw);
    if (data.schema !== 1 || !Array.isArray(data.materials)) throw new Error('存储格式不兼容');
    return data.materials.filter((m) => m && /^P[A-Za-z0-9_-]+$/.test(m.id) && typeof m.text === 'string' && typeof m.title === 'string' && typeof m.type === 'string' && Number.isInteger(m.version) && m.version > 0 && m.kind !== 'notice').map(clone);
  } catch (error) {
    state.message = `未能读取本机记忆：${error.message}。当前以空资料开始；没有使用另一演示的记忆。`;
    state.error = true;
    return [];
  }
}
function persistMemory(materials) {
  try {
    if (materials.length) localStorage.setItem(storageKey, JSON.stringify({schema:1,mode,materials}));
    else localStorage.removeItem(storageKey);
    state.memory = clone(materials);
    return true;
  } catch (error) {
    state.saveMessage = '';
    state.message = `本机保存失败：${error.message}。未显示保存成功，本次资料仍可用于检查和导出。`;
    state.error = true;
    return false;
  }
}
state.memory = readMemory();
state.materials = state.memory.filter((m) => m.active !== false).slice(0,5).map(clone);

function invalidate(reason, clearCache = true) {
  if (state.results || state.busy || state.stale) { state.stale = true; state.staleVersion = state.version; }
  state.version += 1; state.epoch += 1; state.request += 1;
  state.results = null; state.reviewed.clear(); state.selected.clear(); state.saveChecked.clear(); state.saveCandidates.clear();
  state.busy = false; state.uploading = false; state.saveMessage = ''; state.ended = false; state.lastCheckDate = null;
  if (clearCache) cache.clear();
  if (reason) { state.message = reason; state.error = false; }
}
function toast(message) {
  clearTimeout(toastTimer);
  let node = $('#toast');
  if (!node) { node = document.createElement('div'); node.id='toast'; node.className='toast'; node.setAttribute('role','status'); document.body.append(node); }
  node.textContent=message; toastTimer=setTimeout(()=>node.remove(),4500);
}
function isBranchConfirmed() { return state.branch === 'applicable' && state.deadlineConfirmed && state.channelConfirmed && state.prohibitionConfirmed; }
function confirmedLabel() { return isBranchConfirmed() ? '本次关键条件已复核' : '本次关键条件待复核'; }
function activeMaterials() { return state.materials.filter((m)=>m.active !== false); }
function appButton(label, action, options={}) {
  return `<button type="button" class="button ${options.className||''}" data-action="${action}" ${options.id?`id="${options.id}" data-testid="${options.id}"`:''} ${options.disabled?'disabled':''} ${options.extra||''}>${label}</button>`;
}
function navButton(tab, number, title, mobile=false) {
  return `<button type="button" ${mobile?'':`class="nav-button ${state.tab===tab?'active':''}"`} ${mobile?`class="${state.tab===tab?'active':''}"`:''} data-action="tab" data-tab="${tab}" ${state.tab===tab?'aria-current="step"':''}>${mobile?'':`<span class="nav-number">${number}</span>`}${title}</button>`;
}
function memorySidebar() {
  return `<section class="memory-side" aria-label="本机记忆摘要"><div class="memory-side-head"><strong style="font-size:12px">本机记忆</strong><span class="count-pill" id="memory-count">${state.memory.length} 份</span></div>${state.memory.length?state.memory.map(m=>`<div class="memory-side-card ${m.active===false?'disabled':''}"><strong>${esc(m.id)} · ${esc(m.type)}</strong><small>v${m.version} · ${esc(m.memoryConfirmedAt||m.confirmedAt||'尚无确认时间')} ${m.active===false?'· 已停用':''}</small></div>`).join(''):`<p class="side-empty">${hasMemoryMode?'还没有载入演示记忆。<br>点击下方按钮，明确写入 4 份合成资料。':'这里现在是空的。<br>先处理这份通知，之后再决定留下什么。'}</p>`}<div class="button-row" style="margin-top:13px">${hasMemoryMode?appButton('载入演示记忆','seed-memory',{id:'load-memory',className:'soft full'}):''}${appButton('重新读取本机记忆','reload-memory',{id:'reload-memory',className:'small full'})}</div><p class="plain-note">历史确认 ≠ 本次已审核<br>仅此浏览器 · 与 Demo ${hasMemoryMode?'B':'A'} 隔离</p></section>`;
}
function shell() {
  return `<div class="app-shell"><aside class="sidebar"><a href="index.html" class="brand"><span class="brand-symbol" aria-hidden="true">↗</span><span><span class="brand-name">事务记忆</span><span class="brand-en" style="display:block">DOAGENT</span></span></a><section><div class="sidebar-section-title">本次事务</div><nav class="nav" aria-label="三个工作面">${navButton('notice','01','通知要求')}${navButton('materials','02','资料与依据')}${navButton('results','03','准备清单')}</nav></section>${memorySidebar()}<div class="side-note">记忆帮助重新开始，<br>每一份依据仍按本次要求核对。</div><div class="sidebar-bottom"><a href="${hasMemoryMode?'demo-no-memory.html':'demo-with-memory.html'}">切换至${hasMemoryMode?'零记忆':'已有记忆'}演示 ↗</a><a href="../03-参赛与路演/可行动事务Agent-Demo${hasMemoryMode?'一-已有记忆上传演示':'二-零记忆首次使用演示'}.md">查看本页演示脚本 ↗</a>${appButton('清空本演示数据','reset',{id:'reset-demo',className:'ghost small'})}<span>本机单用户交互原型</span></div></aside><main class="main"><header class="topbar"><div class="topbar-left"><span class="prototype-label"><span class="dot"></span>交互原型 · 合成资料 · 规则模拟</span><span class="date">演示日期 ${DEMO_DATE}</span></div><div class="topbar-right"><a class="home-link" href="index.html">演示入口</a>${appButton('新建事务','new-transaction',{id:'new-transaction',className:'small'})}</div></header><div class="main-inner"><section class="hero"><div><div class="eyebrow">DEMO ${hasMemoryMode?'A / WITH MEMORY':'B / START FROM ZERO'}</div><h1>${hasMemoryMode?'已有记忆，读懂新通知':'零记忆，也能开始准备'}</h1><p>${hasMemoryMode?'收到新的项目通知，用已经保存的资料继续准备。先看来源，再按本次规则重审：有些可以引用，有些需要更新，有些这次不能用。':'不必先整理个人档案。加入一份通知，就能看清需要准备什么；资料可以稍后补充，记忆也可以等你愿意时再保存。'}</p></div><div class="hero-stamp"><strong>${hasMemoryMode?'04':'00'}</strong>${hasMemoryMode?'份可显式载入的合成记忆':'份预置个人记忆'}<br>从当前事务开始</div></section><div class="progress-path" aria-label="准备步骤"><span class="active"><i>1</i>通知先到</span><b>→</b><span class="${state.notice?'active':''}"><i>2</i>集中核对</span><b>→</b><span class="${state.materials.length?'active':''}"><i>3</i>按需选资料</span><b>→</b><span class="${state.results?'active':''}"><i>4</i>复核与导出</span><b>→</b><span><i>5</i>自愿保存</span></div><nav class="tabs-mobile" aria-label="切换工作面">${navButton('notice','1','通知要求',true)}${navButton('materials','2','资料与依据',true)}${navButton('results','3','准备清单',true)}</nav>${state.message?`<div class="alert ${state.error?'error':''}" role="status" id="status-message"><span>${esc(state.message)}</span><button type="button" data-action="dismiss" aria-label="关闭提示">×</button></div>`:''}${state.stale?`<div class="alert stale" role="alert" id="stale-banner"><span><strong>旧清单已过时</strong> · 输入或记忆已改变，旧审核与选用已清除。重新检查后才可导出。</span><span class="tag orange">当前事务 v${state.version}</span></div>`:''}<div id="workspace">${state.tab==='notice'?noticeView():state.tab==='materials'?materialsView():resultsView()}</div>${runPanel()}<footer class="boundary"><strong>单人准备 · 未共享 · 未提交 · 不判断整体资格</strong><span>未连接 AI · TXT 仅支持演示格式 · 无外部请求</span></footer><div class="mobile-reset" style="margin-top:12px">${appButton('清空本演示数据','reset',{className:'ghost small'})}</div></div></main></div>`;
}
function fileZone(kind) {
  const notice = kind==='notice';
  return `<div class="dropzone" data-drop-kind="${kind}"><div class="upload-symbol" aria-hidden="true">↥</div><h3>${notice?'把新通知放在这里':'加入本次相关的资料'}</h3><p>${notice?'选择 TXT 文件，或使用下面的合成样例':'只选本次需要的资料，合计最多 5 份'}</p><label class="button primary" for="${kind}-file">${notice?'上传通知 TXT':'上传资料 TXT'} <span aria-hidden="true">＋</span></label><input class="sr-only" type="file" id="${kind}-file" data-testid="${kind}-file" data-file-kind="${kind}" accept=".txt,text/plain" ${notice?'':'multiple'}><p style="margin:11px 0 0;font-size:10px">真实读取所选文件 · 每份 ≤ 100 KB · 不支持 PDF / OCR</p></div>`;
}
function sampleNoticeRow() {
  return `<div class="sample-row"><div><strong>试试：星桥学生项目实践计划 · 第二期</strong><p>合成通知 · N02 v1 · 6 项材料要求</p></div><div class="button-row">${appButton('载入通知样例','load-notice',{id:'load-notice',className:'soft small'})}${appButton('下载通知 TXT','download-sample',{id:'download-notice',className:'ghost small',extra:'data-filename="N02-第二期通知.txt"'})}</div></div>`;
}
function sourceText(doc) { return esc(doc.text.split('\n').map((line,i)=>`${String(i+1).padStart(2,'0')}  ${line}`).join('\n')); }
function noticeView() {
  const n = state.notice;
  return `<div class="workspace-head"><div><h2><span class="section-index">01</span>通知要求</h2><p>先看清本次要求，再决定需要哪些资料。</p></div><span class="tag ${n?'teal':''}">${n?'已读取通知':'等待加入通知'}</span></div><div class="columns"><div><section class="panel">${n?`<div class="notice-doc"><h3>${esc(n.title)}</h3><p>${esc(n.filename)} · ${esc(n.id)} v${n.version} · 来自实际读取的 TXT 文本</p></div><div class="requirement-list">${n.requirements.map((r)=>`<div class="requirement-row"><span class="req-id mono">${esc(r.id)}</span><div><strong>${esc(r.title)}</strong><p>${esc(r.quote)}</p></div><span class="tag">待本次检查</span></div>`).join('')}</div><div class="button-row"><label class="button small" for="notice-file">更换通知 TXT</label><input class="sr-only" type="file" id="notice-file" data-testid="notice-file" data-file-kind="notice" accept=".txt,text/plain">${appButton('下载通知 TXT','download-sample',{className:'ghost small',extra:'data-filename="N02-第二期通知.txt"'})}</div><details class="detail-block" data-open-key="notice-source"><summary>展开通知原文与行号</summary><pre class="source-text">${sourceText(n)}</pre></details>`:`<div class="panel-heading"><div><h3>从一份新通知开始</h3><p>无需先建档，也无需填写全部个人信息。</p></div><span class="tag teal">第一步</span></div>${fileZone('notice')}${sampleNoticeRow()}`}<p class="plain-note">只识别本演示的约定 TXT 字段，展示规则模拟过程。任意文件不会被伪装成已理解；读取失败可改用下方粘贴入口。</p>${pasteControl('notice')}</section>${n?confirmationPanel():''}</div><aside><section class="panel">${hasMemoryMode?`<div class="panel-heading"><h3>让旧准备继续有用</h3><span class="tag teal">记忆可检查</span></div><div class="context-note"><strong>${state.memory.length?`本机已读取 ${state.memory.length} 份保存资料`:'先明确载入，再体验复用'}</strong>${state.memory.length?'来源、版本和历史确认时间都保留。本次通知改变了用途与限制，所以每一项仍从待审核开始。':'点击“载入演示记忆”，将 4 份明确标注的合成资料写入此页的本机空间。不会读取另一份演示的数据。'}</div><div class="button-row" style="margin-top:15px">${appButton('载入演示记忆','seed-memory',{id:'seed-memory-main',className:'soft full'})}</div>`:`<div class="panel-heading"><h3>从零开始，也有进展</h3><span class="tag blue">无需先建档</span></div><div class="context-note"><strong>先得到眼前这件事的准备清单</strong>没有个人资料时，材料项会保留“未检查”。你可以直接导出草稿，之后再补充，不会被要求先保存记忆。</div>`}<ol class="next-steps"><li><span class="step-no">1</span><div><strong>通知先到</strong><p>读取要求、期限、渠道与禁用条件。</p></div></li><li><span class="step-no">2</span><div><strong>资料按需加入</strong><p>${hasMemoryMode?'从已保存资料中选本次相关项，最多 5 份。':'可跳过资料；也可明确载入合成样例。'}</p></div></li><li><span class="step-no">3</span><div><strong>核对后自行决定</strong><p>审核、选用与保存是三个独立动作。</p></div></li></ol></section><section class="panel"><div class="panel-heading"><h3>这份通知的已知边界</h3></div><div class="context-note orange"><strong>附件 A 尚未提供</strong>有关特殊身份的要求需要取得附件后核实。不能将它推断成“不需要材料”，也不能称作完整检查。</div><p class="plain-note">演示固定日期 ${DEMO_DATE}。日期计算依据该演示日期；不提供现实期限提醒。</p></section></aside></div><div class="actionbar"><p>${n?'已读取通知；资料可跳过。':'先载入或上传通知，随后会显示集中复核项。'}</p><div class="button-row">${appButton('资料与依据 →','tab',{id:'go-materials',disabled:!n,extra:'data-tab="materials"'})}${appButton(state.busy?'正在检查…':'生成准备清单','run',{id:'run-check',className:'primary',disabled:!n||state.busy||state.uploading})}</div></div>`;
}
function confirmationPanel() {
  const n=state.notice;
  return `<section class="panel" id="confirmation-panel"><div class="panel-heading"><div><h3>把关键条件，一次核对清楚</h3><p>这是你的本次确认，不会沿用历史事务的审核。</p></div><span class="tag ${isBranchConfirmed()?'teal':'orange'}">${confirmedLabel()}</span></div><div class="form-grid"><label class="field" for="identity-branch">本次适用身份分支<select id="identity-branch" data-testid="identity-branch"><option value="" ${state.branch===''?'selected':''}>请先核对身份分支</option><option value="applicable" ${state.branch==='applicable'?'selected':''}>我适用：${esc(n.branch)}</option><option value="uncertain" ${state.branch==='uncertain'?'selected':''}>不确定，保留待核实</option></select></label><div class="field"><span>截止日期与渠道（通知原文）</span><div style="font-size:12px;color:var(--ink);padding-top:8px">${esc(n.deadline)}<br><span class="muted" style="font-size:11px">${esc(n.channel)}</span></div></div></div><label class="check-row"><input type="checkbox" id="confirm-deadline" data-confirm="deadlineConfirmed" ${state.deadlineConfirmed?'checked':''}>我已核对通知的截止日期 ${esc(n.deadline)}</label><label class="check-row"><input type="checkbox" id="confirm-channel" data-confirm="channelConfirmed" ${state.channelConfirmed?'checked':''}>我已核对提交渠道；此演示不会对外提交</label><label class="check-row"><input type="checkbox" id="confirm-prohibition" data-confirm="prohibitionConfirmed" ${state.prohibitionConfirmed?'checked':''}>我已核对本次禁用条件：${esc(n.requirements.find(r=>r.id==='R4')?.quote||'以通知原文为准')}</label><p class="plain-note">有疑问可以保留未确认并生成工作草稿，系统会展示“无法判断 / 待核实”，不会靠重复分析消除规则歧义。</p></section>`;
}
function pasteControl(kind) {
  return `<details data-open-key="paste-${kind}" class="detail-block ${state.pasteOpen?'paste-open':''}" ${state.pasteOpen?'open':''}><summary>改为粘贴可读的演示 TXT 文本</summary><div class="paste-panel">${kind==='material'&&state.pendingFiles.length?`<label class="field" for="paste-replacement" style="margin-bottom:12px">这段文本替代哪份未读取资料<select id="paste-replacement"><option value="">只追加，不替代未读取项</option>${state.pendingFiles.map(p=>`<option value="${esc(p.filename)}">替代：${esc(p.filename)}</option>`).join('')}</select></label>`:''}<label class="field" for="paste-text-${kind}">粘贴后仍执行同一格式校验<textarea id="paste-text-${kind}" placeholder="资料格式：行动事务演示TXT-v1&#10;类型：${kind==='notice'?'通知':'材料'}&#10;……">${esc(state.pasteText[kind])}</textarea></label><div class="button-row" style="margin-top:10px">${appButton('读取粘贴文本','parse-paste',{id:`parse-paste-${kind}`,className:'small',extra:`data-kind="${kind}"`})}</div></div></details>`;
}
function materialCard(m) {
  const inUse=state.materials.some(d=>d.id===m.id), saved=state.memory.some(d=>d.id===m.id&&d.version===m.version&&d.text===m.text);
  const savedVersion=state.memory.find(d=>d.id===m.id)?.version;
  const scope=m.fields?.['适用范围']||'仅供本次材料检查';
  return `<article class="material-item ${m.active===false?'disabled':''}" data-material-id="${esc(m.id)}"><div class="material-title"><div><h3>${esc(m.title)}</h3><p>${esc(m.filename)} · ${esc(m.id)} <strong>v${m.version}</strong></p></div><span class="tag ${m.active===false?'':saved?'teal':'blue'}">${m.active===false?'已停用':saved?'已保存 · 待本次审核':savedVersion?`本次新版本 · 保存仍 v${savedVersion}`:'仅本次使用'}</span></div><div class="material-meta"><span>所属人 ${esc(m.owner||'来源未注明')}</span><span>历史确认 ${esc(m.confirmedAt||'未提供')}</span>${m.role?`<span>角色 ${esc(m.role)}</span>`:''}</div><p class="plain-note" style="margin-top:7px">适用范围：${esc(scope)} · 可见范围：本机本人</p><div class="material-actions"><label class="check-row"><input type="checkbox" id="use-${esc(m.id)}" data-use-material="${esc(m.id)}" ${inUse?'checked':''} ${m.active===false&&!inUse?'disabled':''}>本次使用</label><div class="button-row">${m.id==='P02'?appButton('更正为协作成员','correct-role',{id:`correct-${m.id}`,className:'small',disabled:m.role==='项目成员',extra:`data-id="${esc(m.id)}"` }):''}${appButton(m.active===false?'启用':'停用','toggle-material',{id:`toggle-${m.id}`,className:'ghost small',extra:`data-id="${esc(m.id)}"`})}${appButton('删除','delete-material',{id:`delete-${m.id}`,className:'ghost small',extra:`data-id="${esc(m.id)}"`})}</div></div><details class="detail-block" data-open-key="material-${esc(m.id)}"><summary>查看来源原文、行号与版本${m.corrections?.length?'（含纠正补充）':''}</summary><pre class="source-text">${sourceText(m)}</pre></details></article>`;
}
function allMaterials() {
  const map=new Map(state.memory.map(m=>[m.id,m]));
  state.materials.forEach(m=>map.set(m.id,m));
  return Array.from(map.values());
}
function materialsView() {
  return `<div class="workspace-head"><div><h2><span class="section-index">02</span>资料与依据</h2><p>只处理你选择的范围，原文件不会被改写。</p></div><span class="tag teal" id="selected-material-count">本次 ${state.materials.length+state.pendingFiles.length} / 5 份</span></div><div class="columns"><div><section class="panel"><div class="panel-heading"><div><h3>${hasMemoryMode?'从已保存资料继续，或加入新文件':'先加需要的资料，也可以跳过'}</h3><p>“本次使用”不等于已审核，也不会自动保存。</p></div></div>${fileZone('material')}<div class="memory-tools">${appButton('载入 4 份合成资料','load-material-samples',{id:'load-material-samples',className:'soft small'})}${appButton('载入第二期新名单','load-new-roster',{id:'load-new-roster',className:'small'})}${appButton('跳过资料，保留未检查','skip-materials',{id:'skip-materials',className:'ghost small'})}</div><label class="field" for="sample-choice">也可单独选一份合成样例<select id="sample-choice">${SAMPLE_FILES.filter(f=>f.kind==='material').map(f=>`<option value="${esc(f.filename)}">${esc(f.label)}</option>`).join('')}</select></label><div class="button-row" style="margin-top:10px">${appButton('载入所选样例','load-selected-sample',{id:'load-selected-sample',className:'small'})}${appButton('下载所选 TXT','download-selected-sample',{id:'download-material',className:'ghost small'})}</div><p class="plain-note">只有点击“保存所选记忆”才会跨事务保留；载入样例也属于一次明确的资料选择。通知不会计入 5 份材料上限。</p>${pasteControl('material')}</section><div class="materials-bar" style="margin-top:24px"><strong>当前可查看的资料</strong><span>${activeMaterials().length} 份启用资料参与本次检查</span></div>${allMaterials().length?allMaterials().map(materialCard).join(''):`<div class="empty-surface"><h3>还没有个人资料</h3><p>你仍可根据通知准备要求清单。系统不会推断你没有这些材料。</p></div>`}${state.pendingFiles.length?`<section class="panel" style="margin-top:15px"><h3>未完成读取的资料</h3>${state.pendingFiles.map(p=>`<div class="sample-row"><p>${esc(p.filename)} · ${esc(p.status)}</p>${appButton('移除该读取项','remove-pending',{className:'small',extra:`data-filename="${esc(p.filename)}"`})}</div>`).join('')}<p class="plain-note">这些文件保持未检查；有读取缺口时，不会产生“全部资料未找到”的结论。</p></section>`:''}</div><aside><section class="panel"><div class="panel-heading"><h3>选择的范围，就是检查范围</h3></div><div class="context-note"><strong>${state.materials.length?'资料存在，不代表本次适用':'没有资料，也不影响开始'}</strong>${state.materials.length?'旧名单只能证明第一期，已申报成果可能被第二期禁止。结果会把依据、版本与本次限制配在一起。':'先生成“未检查”的要求清单；找到资料后再加入并检查。不会编造个人事实，也不会读取另一份演示的存储。'}</div><ol class="next-steps"><li><span class="step-no">1</span><div><strong>来源能展开</strong><p>查看文件原文、行号、版本和历史确认时间。</p></div></li><li><span class="step-no">2</span><div><strong>纠正后立即过时</strong><p>更正 P02 角色、停用、删除或更换资料，都会清除旧审核与选用。</p></div></li><li><span class="step-no">3</span><div><strong>保存副本同步更新</strong><p>修改已保存资料时，向本页独立存储写入新版本；失败会明确提示。</p></div></li></ol></section>${state.notice?`<section class="panel"><h3>本次通知</h3><p class="input-intro">${esc(state.notice.title)}</p><span class="tag ${isBranchConfirmed()?'teal':'orange'}">${confirmedLabel()}</span><div class="button-row" style="margin-top:15px">${appButton('回到通知，核对关键条件','tab',{className:'small full',extra:'data-tab="notice"'})}</div></section>`:''}</aside></div><div class="actionbar"><p>${state.notice?'本次只核对已选资料。资料、通知或分支变化后须重新检查。':'请先在“通知要求”中加入通知。'}</p><div class="button-row">${appButton('← 通知要求','tab',{className:'small',extra:'data-tab="notice"'})}${appButton(state.busy?'正在检查…':'检查所选资料','run',{id:'run-check',className:'primary',disabled:!state.notice||state.busy||state.uploading})}</div></div>`;
}
function statusColor(status) {
  return status==='可引用候选'?'teal':status==='不可用于本次'?'red':status==='需更新/确认'?'orange':status==='无法判断'?'blue':'';
}
function evidenceMarkup(e, label) {
  return `<div class="rule-source"><strong>${label} · ${esc(e.sourceId)} v${e.version}</strong><div>${esc(e.filename)} · 第 ${e.lineStart}–${e.lineEnd} 行</div><pre>${esc(e.text)}</pre></div>`;
}
function resultCard(r) {
  const candidate=r.status==='可引用候选', reviewed=state.reviewed.has(r.id), selected=state.selected.has(r.id);
  return `<article class="result-item" id="result-${esc(r.id)}" data-testid="result-${esc(r.id)}"><div class="result-item-head"><div><h3><span class="section-index mono">${esc(r.id)}</span>${esc(r.title)}</h3><p>${r.materialIds.length?`资料依据 ${r.materialIds.map(id=>`${esc(id)} v${r.materialVersions[id]}`).join('、')}`:'当前没有可定位的个人材料依据'}</p></div><span class="tag ${statusColor(r.status)}" data-testid="status-${esc(r.id)}">${esc(r.status)}</span></div><p class="result-reason">${esc(r.reason)}</p><div class="result-next">下一步 · ${esc(r.nextStep)}</div><div class="review-controls"><label class="check-row"><input type="checkbox" id="review-${esc(r.id)}" data-testid="review-${esc(r.id)}" data-review="${esc(r.id)}" ${reviewed?'checked':''} ${!r.evidence.length?'disabled':''}>${reviewed?'已核对本次依据':'我已核对本次依据'}</label><label class="check-row"><input type="checkbox" id="select-${esc(r.id)}" data-testid="select-${esc(r.id)}" data-select-result="${esc(r.id)}" ${selected?'checked':''} ${!candidate||!reviewed?'disabled':''}>${r.status==='不可用于本次'?'本次禁止选用':'选用于工作草稿'}</label></div><details class="detail-block" data-open-key="result-${esc(r.id)}"><summary>展开来源链、原文行号与本次限制</summary><div class="source-chain">${evidenceMarkup(r.ruleEvidence,'本次要求')}${r.evidence.map(e=>evidenceMarkup(e,'个人依据')).join('')}${r.pairs.filter(p=>!r.materialIds.includes(p.materialId)||p.status!==r.status).map(p=>`<div class="rule-source"><strong>其他已检查配对 · ${esc(p.materialId)} v${p.materialVersion}</strong><div>${esc(p.status)} · ${esc(p.reason)}</div>${p.evidence.map(e=>`<pre>${esc(e.filename)} 第 ${e.lineStart}–${e.lineEnd} 行\n${esc(e.text)}</pre>`).join('')}</div>`).join('')}<div><strong>实际覆盖</strong><br>${esc(r.coverage.description)}<br>快照：事务 v${state.version} · 通知 v${r.noticeVersion} · ${esc(state.lastGeneratedAt)}</div></div></details></article>`;
}
function resultsView() {
  const results=state.results;
  return `<div class="workspace-head"><div><h2><span class="section-index">03</span>准备清单</h2><p>把可复用、待补充和不可用分清楚，再决定下一步。</p></div><span class="tag ${state.stale?'orange':results?'teal':''}">${state.busy?'规则模拟进行中':state.stale?'旧快照已过时':results?`当前快照 v${state.version}`:'还未生成清单'}</span></div>${results?`<div class="columns"><section class="panel"><div class="result-intro"><div><h3>${esc(state.notice.title)}</h3><p>${activeMaterials().length} 份启用资料 · ${state.pendingFiles.length} 份读取缺口 · ${isBranchConfirmed()?'关键条件已复核':'关键条件待复核'}</p></div><div class="result-count">${results.length}<small>项要求</small></div></div><div class="summary-strip"><div><strong>${results.filter(r=>r.status==='可引用候选').length}</strong><small>可引用候选 · 仍需你审核</small></div><div><strong>${results.filter(r=>r.status!=='可引用候选'&&r.status!=='不可用于本次').length}</strong><small>待补充 / 待核实</small></div><div><strong>${results.filter(r=>r.status==='不可用于本次').length}</strong><small>本次排除</small></div></div><div id="result-list">${results.map(resultCard).join('')}</div></section><aside><section class="panel"><div class="panel-heading"><h3>先得到一份可用草稿</h3><span class="tag teal">Markdown</span></div><p class="input-intro">清单保留未检查、待核实与排除说明。只有已审核并选用的候选，才进入“已选用”部分。</p><div class="context-note"><strong>${state.selected.size} 项已核对并选用</strong>选用不等于提交。资料齐全，也不代表整体资格通过。</div><div style="margin-top:17px">${appButton('导出 Markdown 工作草稿','export',{id:'export-draft',className:'primary full',disabled:state.stale||state.busy})}</div><p class="plain-note">保存记忆不是导出的条件。下载的副本不会随之后的纠正自动更新。</p></section>${savePanel()}<section class="panel"><h3>还需要做什么</h3><ol class="next-steps">${results.filter(r=>r.status!=='可引用候选').slice(0,4).map((r,i)=>`<li><span class="step-no">${i+1}</span><div><strong>${esc(r.title)}</strong><p>${esc(r.nextStep)}</p></div></li>`).join('')}</ol></section></aside></div>`:`<section class="panel"><div class="empty-surface"><div class="upload-symbol ${state.busy?'pulse':''}" aria-hidden="true">${state.busy?'…':'✓'}</div><h3>${state.busy?'正在检查当前版本的输入':state.stale?'资料变了，让清单重新对齐':'这里会整理出你的下一步'}</h3><p>${state.busy?'短延迟模拟规则分析，不调用真实模型。你仍可更正或删除资料；迟到的旧结果会被丢弃。':state.stale?'之前的审核、选用和导出已关闭。重新检查后，会得到需要本次重新审核的新快照。':'加入通知后即可生成。即使一份资料都没有，也能得到标注“未检查”的准备草稿。'}</p>${appButton(state.busy?'正在检查…':'重新检查当前输入','run',{id:'run-check',className:'primary',disabled:!state.notice||state.busy||state.uploading})}${appButton('回到通知要求','tab',{className:'ghost',extra:'data-tab="notice"'})}${state.stale?`<div style="margin-top:14px">${appButton('导出已关闭：请先重新检查','export',{id:'export-draft',className:'small',disabled:true})}</div>`:''}</div></section>`}<div class="actionbar"><p>事务 v${state.version} · 分析日期 ${DEMO_DATE} · 审核与选用只对当前快照有效</p><div class="button-row">${appButton('← 资料与依据','tab',{className:'small',extra:'data-tab="materials"'})}${results?appButton('重新检查当前输入','run',{id:'run-check',className:'small',disabled:state.busy}):''}</div></div>`;
}
function savePanel() {
  const docs=activeMaterials();
  return `<section class="panel"><div class="panel-heading"><h3>这次之后，要留下什么</h3><span class="tag">完全自愿</span></div><p class="input-intro">先核对资料，再单独勾选是否保存。只保存你选择的来源文本、版本与已确认事实，不保存原文件。</p>${docs.length?`<div class="save-options">${docs.map(m=>`<div style="padding:10px 0;border-bottom:1px solid var(--line)"><strong style="font-size:11px">${esc(m.id)} · ${esc(m.type)} v${m.version}</strong><label class="check-row"><input type="checkbox" data-save-reviewed="${esc(m.id)}" id="save-reviewed-${esc(m.id)}" ${state.saveChecked.has(m.id)?'checked':''}>我已核对这份资料</label><label class="check-row"><input type="checkbox" data-save-candidate="${esc(m.id)}" id="save-${esc(m.id)}" ${state.saveCandidates.has(m.id)?'checked':''} ${!state.saveChecked.has(m.id)?'disabled':''}>保存为本机记忆</label></div>`).join('')}</div>${appButton('保存所选记忆','save-memory',{id:'save-memory',className:'soft full',disabled:!state.saveCandidates.size||state.stale})}`:'<p class="plain-note">本次没有资料需要保存。</p>'}<div style="margin-top:10px">${appButton('不保存，结束本次','finish-without-save',{id:'finish-without-save',className:'full'})}</div>${state.saveMessage?`<p class="save-status" role="status">${esc(state.saveMessage)}</p>`:''}<p class="plain-note">新事务只从实际保存的资料读取，历史审核不会自动沿用。</p></section>`;
}
function runPanel() {
  return `<section class="run-panel" aria-label="运行与成本记录"><div class="run-heading"><h3>运行记录 <span class="muted" style="font-weight:400;margin-left:7px">把找文件与人工帮助也算进去</span></h3><span class="tag">${state.busy?'检查中':'本地规则模拟'}</span></div><div class="metrics"><div class="metric"><span>本次开始至今</span><strong id="elapsed-time">${elapsed()}<small>实际耗时</small></strong></div><div class="metric"><span>模拟分析次数</span><strong id="analysis-count">${state.stats.analyses}</strong></div><div class="metric"><span>当前版本缓存命中</span><strong id="cache-hit-count">${state.stats.cacheHits}</strong></div><div class="metric"><span>技术重试</span><strong id="retry-count">${state.stats.retries}<small>每次最多 1 次</small></strong></div><div class="metric"><span>真实模型调用</span><strong>0<small>未连接 AI</small></strong></div></div><div class="cost-inputs"><label for="find-minutes">手动登记找文件时间 <input type="number" min="0" step="0.5" id="find-minutes" value="${state.findMinutes}"> 分钟</label><label for="help-minutes">研究者 / 他人辅助时间 <input type="number" min="0" step="0.5" id="help-minutes" value="${state.helpMinutes}"> 分钟</label><span class="muted" style="font-size:10px">不把计时重叠项直接相加；不是已验证的节时结论。</span></div><details class="failure-tools" data-open-key="failure-tools"><summary>展开故障演练与边界说明</summary><label class="field" for="failure-mode" style="margin-top:13px;max-width:370px">模拟技术失败（会绕过缓存）<select id="failure-mode" data-testid="failure-mode"><option value="off" ${state.failMode==='off'?'selected':''}>关闭：正常本地检查</option><option value="once" ${state.failMode==='once'?'selected':''}>第一次失败，自动重试 1 次后成功</option><option value="always" ${state.failMode==='always'?'selected':''}>持续失败：自动重试 1 次后停止</option></select></label><p class="plain-note">规则歧义直接进入“无法判断”，不会自动重试。技术失败停止后，请先将故障演练切回“关闭”，再手动检查；文件读取有问题时可先改为粘贴 TXT。输入变更会递增事务版本与 epoch，清除缓存并丢弃迟到返回；目前已丢弃 ${state.stats.dropped} 次。<br>本届只记录负责人个人准备，不含团队收件、企业权限、自动提交或真实模型成本评估。</p></details></section>`;
}
function elapsed() { const seconds=Math.max(0,Math.floor((Date.now()-state.startedAt)/1000)); return `${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`; }
function render() {
  const focusedId=document.activeElement?.id;
  const openDetails=Array.from(document.querySelectorAll?.('details[open]')||[]).map(d=>d.dataset.openKey).filter(Boolean);
  $('#app').innerHTML=shell();
  if(openDetails.length) document.querySelectorAll('details').forEach(d=>{if(openDetails.includes(d.dataset.openKey))d.open=true;});
  if(focusedId) document.getElementById(focusedId)?.focus({preventScroll:true});
}
function setTab(tab) { state.tab=tab; render(); }
function download(text, filename, mime='text/plain;charset=utf-8') {
  const url=URL.createObjectURL(new Blob([text],{type:mime}));
  const a=document.createElement('a'); a.href=url; a.download=filename; document.body.append(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(url),1500);
}
function insertMaterial(doc) {
  const existing=state.materials.findIndex(m=>m.id===doc.id);
  if (existing<0 && state.materials.length+state.pendingFiles.length>=5) throw new Error('每次最多选择 5 份资料，请先移除一份后再加入。');
  const saved=state.memory.find(m=>m.id===doc.id);
  if (saved && doc.version<saved.version) throw new Error(`${doc.id} 的保存副本已是 v${saved.version}，请使用较新来源或先明确删除保存副本。`);
  if (existing>=0) state.materials[existing]=doc; else state.materials.push(doc);
}
function loadNotice() {
  try { const parsed=parseFile(NOTICE_TEXT,'N02-第二期通知.txt'); invalidate('已读取合成通知 N02；请核对本次分支、期限、渠道和禁用条件。'); state.notice=parsed.data; state.branch=''; state.deadlineConfirmed=false; state.channelConfirmed=false; state.prohibitionConfirmed=false; state.tab='notice'; render(); }
  catch(e) { state.message=e.message; state.error=true; render(); }
}
function seedMemory() {
  try {
    const saved=new Map(state.memory.map(m=>[m.id,clone(m)]));
    MEMORY_TEXTS.forEach(f=>{const initial=parseFile(f.text,f.filename).data;if(!saved.has(initial.id))saved.set(initial.id,initial);});
    const docs=Array.from(saved.values());
    invalidate('');
    if (persistMemory(docs)) { state.memory=readMemory(); state.materials=state.memory.filter(m=>m.active!==false).slice(0,5).map(clone); state.pendingFiles=[]; state.message=`4 份合成演示记忆已就绪；已实际保存并重新读取本机 ${state.memory.length} 份资料，已有更正与其他保存资料保留。历史确认不等于本次已审核。`; state.error=false; }
    render();
  } catch(e) { state.message=e.message; state.error=true; render(); }
}
function reloadMemory() {
  invalidate('已从本页独立存储重新读取记忆；请按当前通知重新检查。');
  state.memory=readMemory(); state.materials=state.memory.filter(m=>m.active!==false).slice(0,5).map(clone); state.pendingFiles=[]; render();
}
function loadMaterialSamples() {
  try {
    const docs=MEMORY_TEXTS.map(f=>parseFile(f.text,f.filename).data);
    if (new Set([...state.materials.map(m=>m.id),...docs.map(m=>m.id)]).size+state.pendingFiles.length>5) throw new Error('加入后超过 5 份资料，请先移除一份。');
    invalidate('已明确载入 4 份合成资料，仅本次使用；尚未写入新记忆。'); docs.forEach(insertMaterial); render();
  } catch(e) { state.message=e.message; state.error=true; render(); }
}
function loadSingleSample(file) {
  try { const doc=parseFile(file.text,file.filename).data; if (!state.materials.some(m=>m.id===doc.id)&&state.materials.length+state.pendingFiles.length>=5) throw new Error('每次最多选择 5 份资料，请先移除一份。'); invalidate('资料已加入，旧结果已清除；请重新检查当前版本。'); insertMaterial(doc); render(); }
  catch(e) { state.message=e.message; state.error=true; render(); }
}
async function uploadFiles(files, kind) {
  if (!files.length) return;
  if (kind==='material' && state.materials.length+state.pendingFiles.length+files.length>5) { toast('每次最多 5 份资料，请先移除部分已选文件。'); return; }
  invalidate('正在真实读取所选 TXT…'); const epoch=state.epoch;
  state.uploading=true; state.pasteKind=kind;
  if (kind==='notice') { state.notice=null; state.branch=''; state.deadlineConfirmed=false; state.channelConfirmed=false; state.prohibitionConfirmed=false; }
  render();
  const errors=[];
  for (const file of files) {
    try {
      if (!/\.txt$/i.test(file.name)) throw new Error('此原型只支持约定格式 TXT；不支持 PDF / OCR，请粘贴可读文本。');
      if (file.size>100*1024) throw new Error('文件超过 100 KB，请缩小本次输入。');
      const text=await file.text();
      if (epoch!==state.epoch) { state.stats.dropped+=1; return; }
      const parsed=parseFile(text,file.name);
      if (parsed.kind!==kind) throw new Error(`该文本不是${kind==='notice'?'通知':'材料'}，请在正确的上传区域加入。`);
      if (kind==='notice') state.notice=parsed.data; else insertMaterial(parsed.data);
    } catch(e) {
      if (epoch!==state.epoch) return;
      errors.push(`${file.name}：${e.message}`);
      if (kind==='material') state.pendingFiles.push({filename:file.name,status:'读取失败'});
    }
  }
  if (epoch!==state.epoch) return;
  state.uploading=false;
  state.message=errors.length?errors.join('；'):`已从文件实际读取 ${files.length} 份${kind==='notice'?'通知':'资料'}，请检查原文与字段。`;
  state.error=!!errors.length; state.pasteOpen=!!errors.length; render();
}
function parsePaste(kind) {
  const text=$(`#paste-text-${kind}`).value;
  const replacing=kind==='material'?$('#paste-replacement')?.value:'';
  state.pasteText[kind]=text;
  try {
    const parsed=parseFile(text,kind==='notice'?'粘贴通知.txt':'粘贴资料.txt');
    if (parsed.kind!==kind) throw new Error('粘贴文本的类型与入口不一致。');
    invalidate('已按同一格式规则读取粘贴文本；没有套用预填答案。');
    if (kind==='notice') { state.notice=parsed.data; state.branch=''; state.deadlineConfirmed=false; state.channelConfirmed=false; state.prohibitionConfirmed=false; }
    else {
      const previousPending=state.pendingFiles;
      if(replacing)state.pendingFiles=state.pendingFiles.filter(p=>p.filename!==replacing);
      try {insertMaterial(parsed.data);} catch(error) {state.pendingFiles=previousPending;throw error;}
    }
    state.pasteText[kind]='';state.error=false; render();
  } catch(e) { state.message=`粘贴内容未通过读取：${e.message}`; state.error=true; render(); }
}
function updateMaterial(id, operation) {
  const doc=allMaterials().find(m=>m.id===id); if(!doc)return;
  invalidate(operation==='delete'?'已删除对应资料、派生结果与缓存；迟到响应不能恢复正文。':'资料状态已变化，旧结果、审核和选用已清除。');
  if (operation==='delete') {
    state.pasteText.material='';
    const next=state.memory.filter(m=>m.id!==id);
    state.materials=state.materials.filter(m=>m.id!==id);
    if (state.memory.some(m=>m.id===id) && !persistMemory(next)) { state.message='本次副本已删除，但本机保存副本删除失败；请重试，当前未宣称删除成功。'; state.error=true; }
  } else {
    let nextDoc;
    try { nextDoc=operation==='correct'?correctMaterial(doc,'项目成员'):{...clone(doc),active:doc.active===false,memoryRevision:(doc.memoryRevision||1)+1}; }
    catch(e){state.message=e.message;state.error=true;render();return;}
    const index=state.materials.findIndex(m=>m.id===id);
    if(index>=0) state.materials[index]=nextDoc;
    else if(nextDoc.active!==false && state.materials.length+state.pendingFiles.length<5)state.materials.push(nextDoc);
    if(state.memory.some(m=>m.id===id)) {
      const next=state.memory.map(m=>m.id===id?clone(nextDoc):m);
      if(persistMemory(next)) state.message=operation==='correct'?`P02 已更正为协作成员（来源值：项目成员），版本升至 v${nextDoc.version}；所选副本与保存副本已同步。`:`${id} 已${nextDoc.active===false?'停用':'启用'}并同步本机保存副本；需重新检查。`;
    } else state.message=operation==='correct'?`P02 已更正为协作成员（来源值：项目成员），版本升至 v${nextDoc.version}；仅本次副本变化。`:`${id} 已${nextDoc.active===false?'停用':'启用'}；仅本次副本变化。`;
  }
  render();
}
const delay=(ms)=>new Promise(resolve=>setTimeout(resolve,ms));
async function runCheck() {
  if(!state.notice||state.busy||state.uploading)return;
  const epoch=state.epoch,request=++state.request,version=state.version;
  const notice=clone(state.notice),materials=clone(state.materials),pending=clone(state.pendingFiles);
  const confirmed=isBranchConfirmed();
  const inputKey=JSON.stringify({version,notice,materials,pending,confirmed,now:DEMO_DATE});
  const failureMode=state.failMode;
  state.busy=true; state.results=null; state.reviewed.clear(); state.selected.clear(); state.saveChecked.clear(); state.saveCandidates.clear(); state.saveMessage='';state.message='';state.error=false;state.tab='results';render();
  const current=()=>epoch===state.epoch&&request===state.request&&version===state.version;
  if(failureMode==='off'&&cache.has(inputKey)) {
    await delay(320); if(!current()){state.stats.dropped+=1;render();return;}
    state.results=clone(cache.get(inputKey)); state.stats.cacheHits+=1;
  } else {
    let completed=false;
    for(let attempt=0;attempt<2;attempt+=1) {
      state.stats.analyses+=1;
      await delay(850);
      if(!current()){state.stats.dropped+=1;render();return;}
      const failed=failureMode==='always'||(failureMode==='once'&&attempt===0);
      if(failed) {
        if(attempt===0){state.stats.retries+=1;state.message='模拟技术失败：仅自动重试 1 次。规则歧义不会进入重试。';render();continue;}
        state.busy=false;state.results=null;state.pasteOpen=true;state.tab='notice';state.message='模拟技术失败仍未恢复，已在 1 次自动重试后停止。请先把“模拟技术失败”切回“关闭”，再手动检查。若文件读取有问题，可先展开“改为粘贴可读的演示 TXT 文本”。';state.error=true;render();return;
      }
      try { state.results=evaluate(notice,materials,{branchConfirmed:confirmed,now:DEMO_DATE,pendingFiles:pending});cache.set(inputKey,clone(state.results));completed=true;break; }
      catch(e) {state.busy=false;state.results=null;state.message=`检查停止：${e.message}。规则或输入问题不会自动重试。`;state.error=true;render();return;}
    }
    if(!completed)return;
  }
  if(!current()){state.stats.dropped+=1;render();return;}
  state.busy=false;state.stale=false;state.staleVersion=null;state.lastGeneratedAt=`${stamp()}（实际生成时间；规则日期 ${DEMO_DATE}）`;state.lastCheckDate=DEMO_DATE;
  state.message=`已完成当前版本检查。${materials.length?'候选尚未自动审核，请展开依据后分别审核与选用。':'未加入个人资料，6 项要求保留未检查；现在即可导出工作草稿。'}`;render();
}
function exportDraft() {
  if(!state.results||state.stale||state.busy)return;
  try {
    const markdown=exportMarkdown({notice:state.notice,materials:state.materials,results:state.results,branchConfirmed:isBranchConfirmed(),now:DEMO_DATE,pendingFiles:state.pendingFiles,reviewedIds:ids(state.reviewed),selectedIds:ids(state.selected),stale:state.stale,generatedAt:state.lastGeneratedAt,mode:hasMemoryMode?'有记忆':'无记忆'});
    download(markdown,`事务记忆-${hasMemoryMode?'已有记忆':'零记忆'}-准备清单-v${state.version}.md`,'text/markdown;charset=utf-8');toast('已生成 Markdown 下载，保留未检查、待核实、来源与排除说明。');
  } catch(e) {invalidate('导出前校验发现输入与快照不一致，已关闭旧导出。');state.message=e.message;state.error=true;render();}
}
function saveMemory() {
  if(!state.results||state.stale)return;
  const wanted=state.materials.filter(m=>state.saveCandidates.has(m.id)&&state.saveChecked.has(m.id)&&m.active!==false);
  if(!wanted.length)return;
  const next=new Map(state.memory.map(m=>[m.id,m]));
  wanted.forEach(m=>next.set(m.id,{...clone(m),memoryConfirmedAt:DEMO_DATE}));
  if(persistMemory(Array.from(next.values()))) {state.saveMessage=`已实际保存 ${wanted.length} 份所选资料到本演示的独立本机记忆；原文件未保存。`;state.message='保存成功。新事务会从本机读取，但仍需按新通知重新审核。';state.error=false;}
  render();
}
function newTransaction() {
  invalidate('已新建事务，并从本机重新读取实际保存的资料；未保存的本次资料不会还原。');
  state.memory=readMemory();state.materials=state.memory.filter(m=>m.active!==false).slice(0,5).map(clone);state.pendingFiles=[];state.notice=null;state.branch='';state.deadlineConfirmed=false;state.channelConfirmed=false;state.prohibitionConfirmed=false;state.pasteText={notice:'',material:''};state.stale=false;state.tab='notice';state.startedAt=Date.now();state.findMinutes=0;state.helpMinutes=0;state.failMode='off';state.pasteOpen=false;state.stats={analyses:0,cacheHits:0,retries:0,dropped:0};render();
}
function reset() {
  invalidate('');
  if(!persistMemory([])){render();return;}
  state.materials=[];state.pendingFiles=[];state.notice=null;state.branch='';state.deadlineConfirmed=false;state.channelConfirmed=false;state.prohibitionConfirmed=false;state.pasteText={notice:'',material:''};state.stale=false;state.tab='notice';state.message=`已清空 Demo ${hasMemoryMode?'A':'B'} 的本机记忆、当前资料与缓存。另一份演示未受影响。`;state.error=false;state.startedAt=Date.now();state.findMinutes=0;state.helpMinutes=0;state.failMode='off';state.pasteOpen=false;state.stats={analyses:0,cacheHits:0,retries:0,dropped:0};render();
}

document.addEventListener('click',(event)=>{
  const target=event.target.closest('[data-action]');if(!target||target.disabled)return;
  const action=target.dataset.action;
  if(action==='tab')setTab(target.dataset.tab);
  else if(action==='dismiss'){state.message='';render();}
  else if(action==='load-notice')loadNotice();
  else if(action==='seed-memory')seedMemory();
  else if(action==='reload-memory')reloadMemory();
  else if(action==='load-material-samples')loadMaterialSamples();
  else if(action==='load-new-roster')loadSingleSample(UPDATED_ROSTER_TEXT);
  else if(action==='load-selected-sample')loadSingleSample(SAMPLE_FILES.find(f=>f.filename===$('#sample-choice').value));
  else if(action==='download-selected-sample'){const f=SAMPLE_FILES.find(f=>f.filename===$('#sample-choice').value);download(f.text,f.filename);}
  else if(action==='download-sample'){const f=SAMPLE_FILES.find(f=>f.filename===target.dataset.filename);if(f)download(f.text,f.filename);}
  else if(action==='parse-paste')parsePaste(target.dataset.kind);
  else if(action==='skip-materials'){invalidate('本次已跳过资料，个人材料项保留未检查；可以生成并导出工作草稿。');state.materials=[];state.pendingFiles=[];if(state.notice)runCheck();else render();}
  else if(action==='remove-pending'){invalidate('已移除未完成读取项，请重新检查实际选定范围。');state.pendingFiles=state.pendingFiles.filter(p=>p.filename!==target.dataset.filename);render();}
  else if(action==='correct-role')updateMaterial(target.dataset.id,'correct');
  else if(action==='toggle-material')updateMaterial(target.dataset.id,'toggle');
  else if(action==='delete-material')updateMaterial(target.dataset.id,'delete');
  else if(action==='run')runCheck();
  else if(action==='export')exportDraft();
  else if(action==='save-memory')saveMemory();
  else if(action==='finish-without-save'){state.ended=true;state.saveCandidates.clear();state.saveMessage='已选择不保存本次资料，仍可导出当前工作草稿。新事务不会恢复未保存资料。';render();}
  else if(action==='new-transaction')newTransaction();
  else if(action==='reset')reset();
});
document.addEventListener('change',(event)=>{
  const target=event.target;
  if(target.dataset.fileKind){uploadFiles(Array.from(target.files||[]),target.dataset.fileKind);return;}
  if(target.id==='identity-branch'){invalidate('适用分支已变化，旧结果需重新检查。');state.branch=target.value;render();return;}
  if(target.dataset.confirm){const value=target.checked;invalidate('本次关键条件确认已变化，需按当前确认重新检查。');state[target.dataset.confirm]=value;render();return;}
  if(target.dataset.useMaterial){const id=target.dataset.useMaterial,checked=target.checked; if(checked&&state.materials.length+state.pendingFiles.length>=5){toast('每次最多 5 份，请先取消一份。');target.checked=false;return;}const doc=allMaterials().find(m=>m.id===id);invalidate('选定资料范围已变化，旧结果与审核已清除。');if(checked)state.materials.push(clone(doc));else state.materials=state.materials.filter(m=>m.id!==id);render();return;}
  if(target.dataset.review){const id=target.dataset.review;if(target.checked)state.reviewed.add(id);else{state.reviewed.delete(id);state.selected.delete(id);}render();return;}
  if(target.dataset.selectResult){const id=target.dataset.selectResult;const r=state.results?.find(r=>r.id===id);if(target.checked&&r?.status==='可引用候选'&&state.reviewed.has(id))state.selected.add(id);else state.selected.delete(id);render();return;}
  if(target.dataset.saveReviewed){const id=target.dataset.saveReviewed;if(target.checked)state.saveChecked.add(id);else{state.saveChecked.delete(id);state.saveCandidates.delete(id);}render();return;}
  if(target.dataset.saveCandidate){const id=target.dataset.saveCandidate;if(target.checked&&state.saveChecked.has(id))state.saveCandidates.add(id);else state.saveCandidates.delete(id);render();return;}
  if(target.id==='failure-mode'){state.failMode=target.value;toast('故障选项已设置；点击检查开始演练。');return;}
});
document.addEventListener('input',(event)=>{if(event.target.id==='find-minutes')state.findMinutes=Math.max(0,Number(event.target.value)||0);if(event.target.id==='help-minutes')state.helpMinutes=Math.max(0,Number(event.target.value)||0);});
document.addEventListener('dragover',(event)=>{const zone=event.target.closest('[data-drop-kind]');if(zone){event.preventDefault();zone.classList.add('dragging');}});
document.addEventListener('dragleave',(event)=>{event.target.closest('[data-drop-kind]')?.classList.remove('dragging');});
document.addEventListener('drop',(event)=>{const zone=event.target.closest('[data-drop-kind]');if(!zone)return;event.preventDefault();zone.classList.remove('dragging');const kind=zone.dataset.dropKind;uploadFiles(Array.from(event.dataTransfer.files).slice(0,kind==='notice'?1:6),kind);});
window.addEventListener('storage',(event)=>{if(event.key!==storageKey)return;invalidate('另一页面修改了本演示的记忆；当前快照已过时并重新读取保存副本。');state.memory=readMemory();state.materials=state.memory.filter(m=>m.active!==false).slice(0,5).map(clone);state.pendingFiles=[];render();});
setInterval(()=>{const node=$('#elapsed-time');if(node)node.innerHTML=`${elapsed()}<small>实际耗时</small>`;},1000);
render();
