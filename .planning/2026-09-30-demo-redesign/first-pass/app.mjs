import { parseFile, evaluate, correctMaterial, exportMarkdown } from './engine.mjs';
import { DEMO_DATE, NOTICE_TEXT, MEMORY_TEXTS, UPDATED_ROSTER_TEXT, SAMPLE_FILES } from './fixtures.mjs';
import { createViews } from './view.mjs';

// 所有个人正文只存在于本页内存或本模式的独立 localStorage。无网络请求。
const mode = document.body.dataset.mode === 'with-memory' ? 'with-memory' : 'no-memory';
const hasMemoryMode = mode === 'with-memory';
const storageKey = `doagent.demo.${mode}.memory.v1`;
const defaultSample = SAMPLE_FILES.find(file=>file.kind==='material').filename;
const $ = (selector, root = document) => root.querySelector(selector);
const clone = (value) => JSON.parse(JSON.stringify(value));
const esc = (value = '') => String(value).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const ids = (set) => Array.from(set);
const stamp = () => new Date().toLocaleString('zh-CN', { hour12:false });
const cache = new Map();
let toastTimer;
let state = {
  tab:'notice', memory:[], materials:[], library:[], notice:null, pendingFiles:[],
  dialog:null, activeResult:null, activeMaterial:null, dialogReturnFocus:null, analysisStage:0, selectedSample:defaultSample,
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
  state.message = reason || ''; state.error = false;
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
function allMaterials() {
  const map=new Map(state.memory.map(m=>[m.id,m]));
  state.library.forEach(m=>map.set(m.id,m));
  state.materials.forEach(m=>map.set(m.id,m));
  return Array.from(map.values());
}
const {shell}=createViews({state,hasMemoryMode,esc,appButton,isBranchConfirmed,allMaterials,activeMaterials,elapsed});
function elapsed() { const seconds=Math.max(0,Math.floor((Date.now()-state.startedAt)/1000)); return `${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`; }
function render() {
  const focusedId=document.activeElement?.id;
  const dialogScroll=$('.dialog-body')?.scrollTop||0;
  const openDetails=Array.from(document.querySelectorAll('details[open]')).map(d=>d.dataset.openKey).filter(Boolean);
  $('#app').innerHTML=shell();
  if(openDetails.length) document.querySelectorAll('details').forEach(d=>{if(openDetails.includes(d.dataset.openKey))d.open=true;});
  const dialog=$('#app-dialog');
  if(dialog) {
    dialog.showModal();
    const dialogBody=$('.dialog-body');if(dialogBody)dialogBody.scrollTop=dialogScroll;
    dialog.addEventListener('cancel',event=>{event.preventDefault();closeDialog();});
    dialog.addEventListener('click',event=>{if(event.target===dialog){const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)closeDialog();}});
  } else if(state.dialog) {state.dialog=null;state.activeResult=null;state.activeMaterial=null;}
  const previous=focusedId&&document.getElementById(focusedId);
  if(previous&&(!dialog||dialog.contains(previous)))previous.focus({preventScroll:true});
}
function scrollWorkspace() { window.scrollTo({top:0,behavior:'instant'}); $('.main')?.scrollTo({top:0,behavior:'instant'}); }
function setTab(tab) {
  if(!['notice','materials','results'].includes(tab))return;
  if(tab!=='notice'&&!state.notice)return;
  state.tab=tab;state.dialog=null;render();scrollWorkspace();
}
function openDialog(kind,id) {
  state.dialogReturnFocus=document.activeElement?.id||null;
  state.dialog=kind;state.activeResult=kind==='result'?id:null;state.activeMaterial=kind==='material'?id:null;render();
}
function closeDialog() {
  const returnId=state.dialogReturnFocus;
  state.dialog=null;state.activeResult=null;state.activeMaterial=null;state.dialogReturnFocus=null;render();
  if(returnId)document.getElementById(returnId)?.focus({preventScroll:true});
}
function download(text, filename, mime='text/plain;charset=utf-8') {
  const url=URL.createObjectURL(new Blob([text],{type:mime}));
  const a=document.createElement('a'); a.href=url; a.download=filename; document.body.append(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(url),1500);
}
function insertMaterial(doc) {
  const existing=state.materials.findIndex(m=>m.id===doc.id);
  if (existing<0 && state.materials.length+state.pendingFiles.length>=5) throw new Error('每次最多选择 5 份资料，请先移除一份后再加入。');
  const minimumVersion=Math.max(
    state.memory.find(m=>m.id===doc.id)?.version||0,
    state.materials.find(m=>m.id===doc.id)?.version||0,
    state.library.find(m=>m.id===doc.id)?.version||0
  );
  if(doc.version<minimumVersion)throw new Error(`${doc.id} 已有 v${minimumVersion}，请使用较新来源或先明确删除现有资料。`);
  if (existing>=0) state.materials[existing]=doc; else state.materials.push(doc);
  const available=state.library.findIndex(m=>m.id===doc.id);
  if(available>=0)state.library[available]=clone(doc);else state.library.push(clone(doc));
}
function loadNotice() {
  try { const parsed=parseFile(NOTICE_TEXT,'N02-第二期通知.txt'); invalidate(''); state.notice=parsed.data; state.branch=''; state.deadlineConfirmed=false; state.channelConfirmed=false; state.prohibitionConfirmed=false; state.tab='notice'; render(); }
  catch(e) { state.message=e.message; state.error=true; render(); }
}
function seedMemory() {
  try {
    const saved=new Map(state.memory.map(m=>[m.id,clone(m)]));
    MEMORY_TEXTS.forEach(f=>{const initial=parseFile(f.text,f.filename).data;if(!saved.has(initial.id))saved.set(initial.id,initial);});
    const docs=Array.from(saved.values());
    invalidate('');
    if (persistMemory(docs)) { state.memory=readMemory(); state.materials=state.memory.filter(m=>m.active!==false).slice(0,5).map(clone); state.pendingFiles=[]; state.library=[]; state.message=`已载入 ${state.memory.length} 份本机资料。本次仍需按新通知审核。`; state.error=false; }
    render();
  } catch(e) { state.message=e.message; state.error=true; render(); }
}
function reloadMemory() {
  invalidate('已从本页独立存储重新读取记忆；请按当前通知重新检查。');
  state.memory=readMemory(); state.materials=state.memory.filter(m=>m.active!==false).slice(0,5).map(clone); state.pendingFiles=[]; state.library=[]; render();
}
function loadMaterialSamples() {
  try {
    const docs=MEMORY_TEXTS.map(f=>parseFile(f.text,f.filename).data);
    if (new Set([...state.materials.map(m=>m.id),...docs.map(m=>m.id)]).size+state.pendingFiles.length>5) throw new Error('加入后超过 5 份资料，请先移除一份。');
    invalidate('4 份合成资料已加入，仅本次使用。'); docs.forEach(insertMaterial); render();
  } catch(e) { state.message=e.message; state.error=true; render(); }
}
function loadSingleSample(file) {
  try { const doc=parseFile(file.text,file.filename).data; if (!state.materials.some(m=>m.id===doc.id)&&state.materials.length+state.pendingFiles.length>=5) throw new Error('每次最多选择 5 份资料，请先移除一份。'); invalidate('新资料已加入，按当前资料重新生成清单。'); insertMaterial(doc); render(); }
  catch(e) { state.message=e.message; state.error=true; render(); }
}
async function uploadFiles(files, kind) {
  if (!files.length) return;
  const maximum=kind==='notice'?1:5;
  if(files.length>maximum) {toast(`一次最多读取 ${maximum} 份${kind==='notice'?'通知':'资料'}，这批文件尚未加入。`);return;}
  invalidate('正在真实读取所选 TXT…'); const epoch=state.epoch;
  state.uploading=true; state.pasteKind=kind;
  if (kind==='notice') { state.notice=null; state.branch=''; state.deadlineConfirmed=false; state.channelConfirmed=false; state.prohibitionConfirmed=false; }
  // 批量内容先停留在局部快照。全部读取并校验选定范围后才一次提交，避免迟到文件部分写回。
  const stagedMaterials=new Map(state.materials.map(m=>[m.id,clone(m)]));
  const stagedLibrary=new Map(state.library.map(m=>[m.id,clone(m)]));
  const stagedPending=clone(state.pendingFiles);
  const savedVersions=new Map(state.memory.map(m=>[m.id,m.version]));
  const errors=[];let stagedNotice=null;
  render();
  for (const file of files) {
    try {
      if (!/\.txt$/i.test(file.name)) throw new Error('此原型只支持约定格式 TXT；不支持 PDF / OCR，请粘贴可读文本。');
      if (file.size>100*1024) throw new Error('文件超过 100 KB，请缩小本次输入。');
      const text=await file.text();
      if (epoch!==state.epoch) { state.stats.dropped+=1; return; }
      const parsed=parseFile(text,file.name);
      if (parsed.kind!==kind) throw new Error(`该文本不是${kind==='notice'?'通知':'材料'}，请在正确的上传区域加入。`);
      if(kind==='notice')stagedNotice=parsed.data;
      else {
        const doc=parsed.data;
        const minimumVersion=Math.max(savedVersions.get(doc.id)||0,stagedMaterials.get(doc.id)?.version||0,stagedLibrary.get(doc.id)?.version||0);
        if(doc.version<minimumVersion)throw new Error(`${doc.id} 已有 v${minimumVersion}，这份较旧来源未覆盖现有资料。`);
        stagedMaterials.set(doc.id,doc);stagedLibrary.set(doc.id,clone(doc));
      }
    } catch(e) {
      if (epoch!==state.epoch) {state.stats.dropped+=1;return;}
      errors.push(`${file.name}：${e.message}`);
      if (kind==='material') stagedPending.push({filename:file.name,status:'读取失败'});
    }
  }
  if (epoch!==state.epoch) {state.stats.dropped+=1;return;}
  state.uploading=false;
  if(kind==='material'&&stagedMaterials.size+stagedPending.length>5) {
    state.message=`合并后会有 ${stagedMaterials.size+stagedPending.length} 份资料（含读取失败项），超过 5 份上限。这批文件均未加入，仍保留原先的选定范围；请先取消部分资料再重试。${errors.length?'读取问题：'+errors.join('；'):''}`;
    state.error=true;state.pasteOpen=!!errors.length;render();return;
  }
  if(kind==='notice')state.notice=stagedNotice;
  else {state.materials=Array.from(stagedMaterials.values());state.library=Array.from(stagedLibrary.values());state.pendingFiles=stagedPending;}
  state.message=errors.length?errors.join('；'):`已读取 ${files.length} 份${kind==='notice'?'通知':'资料'}${kind==='material'?'，相同编号按本次版本更新':''}。`;
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
    state.library=state.library.filter(m=>m.id!==id);
    if (state.memory.some(m=>m.id===id) && !persistMemory(next)) { state.message='本次副本已删除，但本机保存副本删除失败；请重试，当前未宣称删除成功。'; state.error=true; }
  } else {
    let nextDoc;
    try { nextDoc=operation==='correct'?correctMaterial(doc,'项目成员'):{...clone(doc),active:doc.active===false,memoryRevision:(doc.memoryRevision||1)+1}; }
    catch(e){state.message=e.message;state.error=true;render();return;}
    const libraryIndex=state.library.findIndex(m=>m.id===id);
    if(libraryIndex>=0)state.library[libraryIndex]=clone(nextDoc);
    const index=state.materials.findIndex(m=>m.id===id);
    if(index>=0) state.materials[index]=nextDoc;
    else if(nextDoc.active!==false && state.materials.length+state.pendingFiles.length<5)state.materials.push(nextDoc);
    if(state.memory.some(m=>m.id===id)) {
      const next=state.memory.map(m=>m.id===id?clone(nextDoc):m);
      if(persistMemory(next)) state.message=operation==='correct'?`P02 已更正为项目成员，版本升至 v${nextDoc.version}；所选副本与保存副本已同步。`:`${id} 已${nextDoc.active===false?'停用':'启用'}并同步本机保存副本；需重新检查。`;
    } else state.message=operation==='correct'?`P02 已更正为项目成员，版本升至 v${nextDoc.version}；仅本次副本变化。`:`${id} 已${nextDoc.active===false?'停用':'启用'}；仅本次副本变化。`;
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
  state.busy=true; state.results=null; state.reviewed.clear(); state.selected.clear(); state.saveChecked.clear(); state.saveCandidates.clear(); state.saveMessage='';state.message='';state.error=false;state.tab='results';state.dialog=null;state.activeResult=null;state.activeMaterial=null;state.analysisStage=0;render();scrollWorkspace();
  const current=()=>epoch===state.epoch&&request===state.request&&version===state.version;
  if(failureMode==='off'&&cache.has(inputKey)) {
    state.analysisStage=2;render();
    await delay(320); if(!current()){state.stats.dropped+=1;render();return;}
    state.results=clone(cache.get(inputKey)); state.stats.cacheHits+=1;
  } else {
    let completed=false;
    for(let attempt=0;attempt<2;attempt+=1) {
      state.stats.analyses+=1;
      for(let stage=0;stage<3;stage+=1) {
        state.analysisStage=stage;render();await delay(stage===0?250:300);
        if(!current()){state.stats.dropped+=1;render();return;}
      }
      const failed=failureMode==='always'||(failureMode==='once'&&attempt===0);
      if(failed) {
        if(attempt===0){state.stats.retries+=1;state.message='模拟技术失败：仅自动重试 1 次。规则歧义不会进入重试。';render();continue;}
        state.busy=false;state.results=null;state.message='技术失败，重试 1 次后已停止。请在“演示工具”中关闭故障模拟，再重新生成清单。';state.error=true;render();return;
      }
      try { state.results=evaluate(notice,materials,{branchConfirmed:confirmed,now:DEMO_DATE,pendingFiles:pending});cache.set(inputKey,clone(state.results));completed=true;break; }
      catch(e) {state.busy=false;state.results=null;state.message=`检查停止：${e.message}。规则或输入问题不会自动重试。`;state.error=true;render();return;}
    }
    if(!completed)return;
  }
  if(!current()){state.stats.dropped+=1;render();return;}
  state.busy=false;state.stale=false;state.staleVersion=null;state.lastGeneratedAt=`${stamp()}（实际生成时间；规则日期 ${DEMO_DATE}）`;state.lastCheckDate=DEMO_DATE;
  state.message='';render();scrollWorkspace();
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
  state.memory=readMemory();state.materials=state.memory.filter(m=>m.active!==false).slice(0,5).map(clone);state.pendingFiles=[];state.notice=null;state.branch='';state.deadlineConfirmed=false;state.channelConfirmed=false;state.prohibitionConfirmed=false;state.pasteText={notice:'',material:''};state.stale=false;state.tab='notice';state.library=[];state.dialog=null;state.activeResult=null;state.activeMaterial=null;state.dialogReturnFocus=null;state.selectedSample=defaultSample;state.startedAt=Date.now();state.findMinutes=0;state.helpMinutes=0;state.failMode='off';state.pasteOpen=false;state.stats={analyses:0,cacheHits:0,retries:0,dropped:0};render();scrollWorkspace();
}
function reset() {
  invalidate('');
  if(!persistMemory([])){render();return;}
  state.materials=[];state.pendingFiles=[];state.notice=null;state.branch='';state.deadlineConfirmed=false;state.channelConfirmed=false;state.prohibitionConfirmed=false;state.pasteText={notice:'',material:''};state.stale=false;state.tab='notice';state.library=[];state.dialog=null;state.activeResult=null;state.activeMaterial=null;state.dialogReturnFocus=null;state.selectedSample=defaultSample;state.message=`已清空 Demo ${hasMemoryMode?'A':'B'} 的本机记忆、当前资料与缓存。另一份演示未受影响。`;state.error=false;state.startedAt=Date.now();state.findMinutes=0;state.helpMinutes=0;state.failMode='off';state.pasteOpen=false;state.stats={analyses:0,cacheHits:0,retries:0,dropped:0};render();scrollWorkspace();
}

document.addEventListener('click',(event)=>{
  const target=event.target.closest('[data-action]');if(!target||target.disabled)return;
  const action=target.dataset.action;
  if(action==='tab')setTab(target.dataset.tab);
  else if(action==='open-tools')openDialog('tools');
  else if(action==='open-save')openDialog('save');
  else if(action==='open-notice')openDialog('notice');
  else if(action==='open-result')openDialog('result',target.dataset.id);
  else if(action==='open-material')openDialog('material',target.dataset.id);
  else if(action==='close-dialog')closeDialog();
  else if(action==='confirm-all'){invalidate('本次期限、渠道与禁用条件已确认。');state.deadlineConfirmed=true;state.channelConfirmed=true;state.prohibitionConfirmed=true;render();}
  else if(action==='dismiss'){state.message='';render();}
  else if(action==='load-notice')loadNotice();
  else if(action==='seed-memory')seedMemory();
  else if(action==='reload-memory')reloadMemory();
  else if(action==='load-material-samples')loadMaterialSamples();
  else if(action==='load-new-roster')loadSingleSample(UPDATED_ROSTER_TEXT);
  else if(action==='load-selected-sample')loadSingleSample(SAMPLE_FILES.find(f=>f.filename===state.selectedSample));
  else if(action==='download-selected-sample'){const f=SAMPLE_FILES.find(f=>f.filename===state.selectedSample);download(f.text,f.filename);}
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
  if(target.id==='sample-choice'){if(SAMPLE_FILES.some(f=>f.kind==='material'&&f.filename===target.value))state.selectedSample=target.value;return;}
  if(target.dataset.fileKind){uploadFiles(Array.from(target.files||[]),target.dataset.fileKind);return;}
  if(target.id==='identity-branch'){invalidate('适用分支已变化，旧结果需重新检查。');state.branch=target.value;render();return;}
  if(target.dataset.confirm){const value=target.checked;invalidate('本次关键条件确认已变化，需按当前确认重新检查。');state[target.dataset.confirm]=value;render();return;}
  if(target.dataset.useMaterial){const id=target.dataset.useMaterial,checked=target.checked; if(checked&&state.materials.length+state.pendingFiles.length>=5){toast('每次最多 5 份，请先取消一份。');target.checked=false;return;}const doc=allMaterials().find(m=>m.id===id);invalidate('选定资料范围已变化，旧结果与审核已清除。');if(checked)state.materials.push(clone(doc));else state.materials=state.materials.filter(m=>m.id!==id);render();return;}
  if(target.dataset.review){const id=target.dataset.review;if(target.checked)state.reviewed.add(id);else{state.reviewed.delete(id);state.selected.delete(id);}render();return;}
  if(target.dataset.selectResult){const id=target.dataset.selectResult;const r=state.results?.find(r=>r.id===id);if(target.checked&&r?.status==='可引用候选'&&state.reviewed.has(id))state.selected.add(id);else state.selected.delete(id);render();return;}
  if(target.dataset.saveReviewed){state.saveMessage='';state.ended=false;const id=target.dataset.saveReviewed;if(target.checked)state.saveChecked.add(id);else{state.saveChecked.delete(id);state.saveCandidates.delete(id);}render();return;}
  if(target.dataset.saveCandidate){state.saveMessage='';state.ended=false;const id=target.dataset.saveCandidate;if(target.checked&&state.saveChecked.has(id))state.saveCandidates.add(id);else state.saveCandidates.delete(id);render();return;}
  if(target.id==='failure-mode'){state.failMode=target.value;toast('故障选项已设置；点击检查开始演练。');return;}
});
document.addEventListener('input',(event)=>{if(event.target.id==='paste-text-notice')state.pasteText.notice=event.target.value;if(event.target.id==='paste-text-material')state.pasteText.material=event.target.value;if(event.target.id==='find-minutes')state.findMinutes=Math.max(0,Number(event.target.value)||0);if(event.target.id==='help-minutes')state.helpMinutes=Math.max(0,Number(event.target.value)||0);});
document.addEventListener('dragover',(event)=>{const zone=event.target.closest('[data-drop-kind]');if(zone){event.preventDefault();zone.classList.add('dragging');}});
document.addEventListener('dragleave',(event)=>{event.target.closest('[data-drop-kind]')?.classList.remove('dragging');});
document.addEventListener('drop',(event)=>{const zone=event.target.closest('[data-drop-kind]');if(!zone)return;event.preventDefault();zone.classList.remove('dragging');const kind=zone.dataset.dropKind;uploadFiles(Array.from(event.dataTransfer.files).slice(0,kind==='notice'?1:6),kind);});
window.addEventListener('storage',(event)=>{if(event.key!==storageKey)return;invalidate('另一页面修改了本演示的记忆；当前快照已过时并重新读取保存副本。');state.memory=readMemory();state.materials=state.memory.filter(m=>m.active!==false).slice(0,5).map(clone);state.pendingFiles=[];state.library=[];render();});
setInterval(()=>{const node=$('#elapsed-time');if(node)node.textContent=elapsed();},1000);
render();
