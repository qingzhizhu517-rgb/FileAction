// 事务与成果均为合成示例；页面内编辑不会上传或持久化。
const innovationOutputs = {
  introduction: `<div class="eyebrow">INTRODUCTION / DRAFT</div><h2>让想法遇见同路人</h2><div class="mail-meta">用途：<strong>创新周开放交流 · 自我介绍</strong><br>来源：<strong>活动通知、项目构想、个人简历</strong></div><div class="mail-content"><p>大家好，我是 <span class="editable" contenteditable="true" role="textbox" aria-label="交流介绍姓名">[姓名]</span>，目前在学习计算机科学与技术。</p><p>我正在探索一个校园无障碍地图的想法，希望让校园通行信息更容易查找。目前还处在想法阶段，尚无可演示原型。</p><p>这次来，想先听听大家实际遇到过哪些不方便的场景、现在是怎么解决的，也希望认识关注这个问题的同学。</p><p>如果你愿意分享经历，或者想一起探索，可以在交流结束后和我聊聊。</p></div><div class="signature">交流介绍草稿 · V1<br>尚未公开发布</div>`,
  questions: `<div class="eyebrow">CONVERSATION GUIDE</div><h2>从真实经历开始问</h2><div class="mail-content"><p>目标：收集具体场景，帮助决定项目的下一步。以下是提问草稿，没有已完成的访谈记录。</p><h3>了解具体经历</h3><ol><li>最近一次在校园里遇到通行不便，是什么时候、什么地方？</li><li>当时你怎么处理？用了什么工具，或向谁求助？</li><li>哪些信息最难找到？这对你的安排有什么实际影响？</li></ol><h3>为下一次交流留出空间</h3><p>如果之后想了解更多细节，是否愿意由你主动联系我？</p><h3>记录时分别保存</h3><p>对方的原话、实际发生的行为、我的猜测。现场人员未必是目标用户，礼貌赞同不能记为已验证的需求。</p></div>`,
  preparation: `<div class="eyebrow">PREPARATION & SOURCES</div><h2>带着问题去，带着线索回来</h2><div class="mail-content"><h3>已有准备</h3><ul><li>活动通知：开放交流允许个人参加，不要求已有原型。</li><li>项目构想：校园无障碍地图，仍在想法阶段。</li><li>个人简历：用于自我介绍，个人字段由你检查。</li></ul><h3>出发前待确认</h3><ul><li>10 月 15 日 19:00–21:00 是否有空。</li><li>按活动通知确认预约方式与地点；尚未预约。</li><li>检查介绍草稿，挑选本次最想了解的问题。</li></ul><h3>来源依据</h3><p><button class="source-chip" data-reference="innovation">${icon('file')}查看活动参与条件</button> <button class="source-chip" data-reference="project">${icon('file')}查看项目当前阶段</button></p><p>合成演示。没有报名、发送邀请或收集真实个人信息。</p></div>`
};
const transactions = {
  scholarship: {
    title:'国家奖学金申请', shortTitle:'奖学金申请', icon:'award',
    goal:'先核实申请资格，再准备正式材料',
    description:'通知、成绩与经历共同支撑一次申请准备。',
    files:['notice','grades','certificate','resume'],
    state:'资格待核实', warning:'正式发送前，补齐称呼与个人字段，并核实综测排名、证书认定口径和全部申请条件。',
    outputs:[
      {id:'letter',title:'资格确认询问信',tab:'询问信草稿',icon:'mail',detail:'可编辑 · 待检查 · 尚未发送',content:outputVariants.letter},
      {id:'checklist',title:'申请材料准备清单',tab:'材料清单',icon:'list',detail:'已有材料与缺项分别整理',content:outputVariants.checklist},
      {id:'sources',title:'依据与待确认项',tab:'依据摘要',icon:'link',detail:'汇总多份来源，不推断未知资格',content:outputVariants.sources}
    ],
    audits:[['多份材料共同形成产物','通知要求与个人材料分别标注'],['仍需核实关键条件','综测排名、证书认定与其他资格'],['当前只形成草稿','询问信未发送，申请未提交']]
  },
  innovation: {
    title:'校园创新周交流',shortTitle:'创新周交流',icon:'spark',
    goal:'带着项目想法，先收集具体反馈',
    description:'活动通知连接项目构想，也复用同一份个人简历。',
    files:['innovation','project','resume'],
    state:'参与方式待确认',warning:'确认当天时间、预约方式与地点。介绍如实保留“想法阶段”，不把交流意向当成预约成功或需求验证。',
    outputs:[
      {id:'introduction',title:'开放交流介绍草稿',tab:'交流介绍',icon:'user',detail:'可编辑 · 想法阶段 · 未发布',content:innovationOutputs.introduction},
      {id:'questions',title:'反馈交流提纲',tab:'交流提纲',icon:'list',detail:'围绕实际经历提问，不预设结论',content:innovationOutputs.questions},
      {id:'preparation',title:'参与准备与来源',tab:'准备与依据',icon:'link',detail:'时间、预约与项目阶段分别核对',content:innovationOutputs.preparation}
    ],
    audits:[['复用背景，重新组织产物','根据活动通知、项目构想与简历起草'],['保留真实项目阶段','没有可演示原型，不包装成熟度'],['没有完成外部行动','活动未预约，介绍未发布']]
  }
};
let activeTransaction = 'scholarship';
let currentOutput = null;
const outputDrafts = new Map();
const outputSelections = {scholarship:'letter',innovation:'introduction'};
const citationSources = {
  rank:{document:'notice',target:'highlight-rank',label:'申报通知 · § 2',location:'学业与综合表现'},
  deadline:{document:'notice',target:'highlight-deadline',label:'申报通知 · § 4',location:'材料提交时间'},
  grades:{document:'grades',target:'highlight-grades',label:'成绩单 · 专业排名',location:'学业表现'},
  certificate:{document:'certificate',target:'highlight-certificate',label:'获奖证书 · 奖项',location:'获奖信息'},
  project:{document:'project',target:'highlight-project',label:'项目构想 · 当前阶段',location:'项目当前阶段'},
  innovation:{document:'innovation',target:'highlight-innovation',label:'活动通知 · 参与条件',location:'参与方式'},
  eventTime:{document:'innovation',target:'highlight-event-time',label:'活动通知 · 时间',location:'活动安排'},
  resume:{document:'resume',target:'highlight-resume',label:'个人简历 · 项目探索',location:'项目探索'}
};
relatedDocuments.innovation = `<div class="doc-school">明川大学 · 校园创新周</div><div class="doc-code">活动通知 · 合成示例</div><h2>校园创新周<br>开放交流参与通知</h2><h3>一、活动安排</h3><p><mark class="doc-highlight" id="highlight-event-time">2026 年 10 月 15 日 19:00–21:00</mark>。具体地点与预约方式须向组织方确认。</p><h3>二、参与方式</h3><p><mark class="doc-highlight" id="highlight-innovation">开放交流允许个人参加，无需已有可演示原型。</mark>可携带想法、问题与相关材料参加交流。</p><h3>三、参与准备</h3><p>提前确认个人时间与预约要求。准备简短的自我介绍，明确希望讨论的问题。</p><div class="doc-footnote">合成活动通知，非真实活动信息。尚未预约或报名。</div>`;
relatedDocuments.project = `<div class="doc-school">项目构想 · 示例材料</div><div class="doc-code">PROJECT NOTES / 001</div><h2>校园无障碍地图</h2><h3>项目当前阶段</h3><p><mark class="doc-highlight" id="highlight-project">目前处于想法阶段，尚无可演示原型。</mark></p><h3>希望探索的问题</h3><p>让校园通行信息更容易查找。需要先了解具体的通行场景、现有解决办法和信息缺口。</p><h3>尚未形成的结论</h3><p>没有真实访谈或行为证据，不能据此判断需求已验证。下一步可先了解具体经历。</p><div class="doc-footnote">合成示例，不是已完成的项目或调研。</div>`;

function transactionForFile(id){return ['innovation','project'].includes(id)?'innovation':'scholarship'}
function sourceChip(id){
  const file = files.find(item=>item.id===id);
  return `<button class="source-chip" data-preview-document="${id}" aria-label="预览来源：${file.title}">${icon('file')}${file.title}${id==='resume'?'<small>跨事务复用</small>':''}</button>`;
}
function transactionCards(context){
  return Object.entries(transactions).map(([id,item])=>`<button class="transaction-card ${id===activeTransaction?'active':''}" data-transaction="${id}" aria-pressed="${id===activeTransaction}" aria-label="${context}：${item.shortTitle}"><span class="transaction-icon">${icon(item.icon)}</span><span class="transaction-copy"><strong>${item.shortTitle}</strong><small>${item.files.length} 份关联文件 · ${context==='查看成果'?item.outputs.length+' 项产物':document.querySelectorAll('[data-task="'+id+'"]').length+' 项行动'}</small></span><span class="transaction-state">${icon(id===activeTransaction?'check-circle':'chevron-right')}${id===activeTransaction?'当前事务':'切换事务'}</span></button>`).join('');
}
function saveOutput(){if(currentOutput)outputDrafts.set(currentOutput,document.querySelector('#output-content').innerHTML)}
function renderOutput(key){
  const item=transactions[activeTransaction].outputs.find(output=>output.id===key);
  if(!item)return;
  saveOutput();
  currentOutput=activeTransaction+':'+key;
  outputSelections[activeTransaction]=key;
  document.querySelector('#output-content').innerHTML=outputDrafts.get(currentOutput)||item.content;
  document.querySelectorAll('[data-output]').forEach(button=>{
    button.classList.toggle('active',button.dataset.output===key);
    button.setAttribute('aria-pressed',String(button.dataset.output===key));
  });
  document.querySelector('#output-edit-note').textContent=['letter','introduction'].includes(key)?'点击虚线字段即可编辑；页面内切换会保留修改。':'草稿仅作准备参考，仍需你检查确认。';
}
function renderPackage(){
  saveOutput();currentOutput=null;
  const item=transactions[activeTransaction];
  document.querySelector('#package-transactions').innerHTML=transactionCards('查看成果');
  document.querySelector('#package-context').innerHTML=`<div class="package-context-heading"><div><h2>${item.title}</h2><p>${item.goal} · ${item.description}</p></div><span class="tag ${activeTransaction==='innovation'?'blue':'green'}">${item.state}</span></div><div class="package-source-list" aria-label="本事务关联文件">${item.files.map(sourceChip).join('')}</div>`;
  document.querySelector('#package-summary').textContent=`当前事务：${item.files.length} 份关联文件 → ${item.outputs.length} 项产物`;
  document.querySelector('#output-tabs').innerHTML=item.outputs.map(output=>`<button class="output-tab" data-output="${output.id}" aria-pressed="false">${output.tab}</button>`).join('')+'<span class="tag">V1 · 待你检查</span>';
  document.querySelector('#package-items').innerHTML=item.outputs.map(output=>`<button class="package-item" data-output="${output.id}"><span class="item-icon">${icon(output.icon)}</span><span><strong>${output.title}</strong><small>${output.detail}</small></span>${icon('chevron-right')}</button>`).join('');
  document.querySelector('#package-audit').innerHTML=item.audits.map(([title,detail])=>`<div class="audit-row">${icon('check-circle')}<div>${title}<small>${detail}</small></div></div>`).join('');
  document.querySelector('#package-warning').textContent=item.warning;
  document.querySelector('#export-package').setAttribute('aria-label','导出'+item.shortTitle+'成果包');
  renderOutput(outputSelections[activeTransaction]);
}
function renderActions(){
  document.querySelector('#action-transactions').innerHTML=transactionCards('选择事务');
  document.querySelectorAll('[data-task]').forEach(card=>card.hidden=card.dataset.task!==activeTransaction);
  document.querySelectorAll('.kanban-column').forEach((column,index)=>{
    const count=column.querySelectorAll('[data-task]:not([hidden])').length;
    column.querySelector('.count').textContent=count;
    document.querySelectorAll('.action-intro .stat strong')[index].textContent=String(count).padStart(2,'0');
    let empty=column.querySelector('.kanban-empty');
    if(!empty){empty=document.createElement('p');empty.className='kanban-empty';column.append(empty)}
    empty.textContent='这个事务暂时没有此类行动';empty.hidden=count>0;
  });
  document.querySelector('#action-current-title').textContent=transactions[activeTransaction].shortTitle+' · 从眼前的一步开始';
}
function refreshConversation(){
  document.querySelectorAll('[data-thread]').forEach(element=>element.hidden=element.dataset.thread!==activeTransaction);
  document.querySelector('.agent-header [data-session-open]').hidden=activeTransaction!=='scholarship';
  document.querySelector('#chat-input').placeholder=activeTransaction==='innovation'?'聊聊你想从这次交流中得到什么…':'告诉我你的想法，下一步由你决定…';
  document.querySelector('#reference-count').textContent=transactions[activeTransaction].files.length+' 份参考文件';
}
function selectTransaction(id){
  if(!transactions[id])return;
  saveOutput();currentOutput=null;activeTransaction=id;
  renderPackage();renderActions();refreshConversation();
  if(location.hash==='#conversation'||location.hash==='#workspace')route();
}
function enterConversation(fileId){
  if(!files.some(file=>file.id===fileId))return;
  selectTransaction(transactionForFile(fileId));
  closeReference();closeReferenceMenu();
  if(document.querySelector('#modal-backdrop').classList.contains('open'))closeModal();
  document.querySelector('#workspace-shell').classList.remove('show-tree');
  document.querySelectorAll('[data-pane]').forEach(button=>button.classList.toggle('active',button.dataset.pane==='agent'));
  setDocument(fileId);
  location.hash='conversation';route();
}

let referenceChoices=[];
let referenceReturnFocus=null;
let referenceMenuReturnFocus=null;
let pendingReferences=[];
function displayReference(key){
  const item=citationSources[key];if(!item)return;
  setDocument(item.document);
  const mark=document.getElementById(item.target);
  if(mark){mark.classList.add('active');requestAnimationFrame(()=>mark.scrollIntoView({block:'center',behavior:'auto'}))}
  document.querySelector('#reference-location').textContent='已定位：'+item.location;
  document.querySelectorAll('[data-reference-choice]').forEach(button=>{button.classList.toggle('active',button.dataset.referenceChoice===key);button.setAttribute('aria-pressed',String(button.dataset.referenceChoice===key))});
}
function showReferenceDialog(){
  const dialog=document.querySelector('#reference-dialog');
  if(!dialog.open){referenceReturnFocus=referenceMenuReturnFocus||document.activeElement;dialog.showModal()}
  document.querySelector('#reference-close').focus();referenceMenuReturnFocus=null;
}
function openReference(keys){
  referenceChoices=[...new Set(Array.isArray(keys)?keys:[keys])].filter(key=>citationSources[key]);
  if(!referenceChoices.length)return;
  closeReferenceMenu(false);
  document.querySelector('#reference-description').textContent=referenceChoices.length>1?'这段话关联多处依据，可切换查看；引用已高亮。':'已定位并高亮引用部分。关闭后继续原来的内容。';
  document.querySelector('#reference-choices').innerHTML=referenceChoices.map(key=>`<button class="reference-choice" data-reference-choice="${key}" aria-pressed="false">${citationSources[key].label}</button>`).join('');
  showReferenceDialog();displayReference(referenceChoices[0]);
}
function previewDocument(id){
  if(!files.some(file=>file.id===id))return;
  referenceChoices=[];closeReferenceMenu(false);
  document.querySelector('#reference-description').textContent='关联文件预览 · 合成示例';
  document.querySelector('#reference-choices').innerHTML='';
  document.querySelector('#reference-location').textContent='查看文件全文';
  setDocument(id);showReferenceDialog();
}
function closeReference(){const dialog=document.querySelector('#reference-dialog');if(dialog.open)dialog.close()}
function closeReferenceMenu(restoreFocus=false){
  document.querySelector('#reference-menu').hidden=true;
  if(restoreFocus)referenceMenuReturnFocus?.focus();
}
function citationsAtEvent(event){
  const target=event.target.nodeType===1?event.target:event.target.parentElement;
  const conversation=target.closest('.conversation');if(!conversation)return [];
  const selected=window.getSelection();
  if(selected?.rangeCount&&!selected.isCollapsed){
    const range=selected.getRangeAt(0);
    if(conversation.contains(range.commonAncestorContainer)&&range.intersectsNode(target)){
      const keys=[...conversation.querySelectorAll('[data-citations]')].filter(element=>range.intersectsNode(element)).flatMap(element=>element.dataset.citations.split(' '));
      if(keys.length)return [...new Set(keys)];
    }
  }
  return target.closest('[data-citations]')?.dataset.citations.split(' ')||[];
}
function showReferenceMenu(event){
  const keys=citationsAtEvent(event).filter(key=>citationSources[key]);if(!keys.length){closeReferenceMenu();return}
  event.preventDefault();pendingReferences=keys;
  referenceMenuReturnFocus=event.target.closest('[data-citations]')||document.activeElement;
  const menu=document.querySelector('#reference-menu');
  document.querySelector('#reference-menu-count').textContent=keys.length+' 处依据';
  menu.hidden=false;
  const rect=event.target.getBoundingClientRect();
  const x=event.clientX||rect.left;const y=event.clientY||rect.bottom;
  menu.style.left=Math.max(8,Math.min(x,window.innerWidth-menu.offsetWidth-8))+'px';
  menu.style.top=Math.max(8,Math.min(y,window.innerHeight-menu.offsetHeight-8))+'px';
  document.querySelector('#view-reference').focus();
}
document.addEventListener('contextmenu',showReferenceMenu);
document.addEventListener('pointerdown',event=>{if(!event.target.closest('#reference-menu'))closeReferenceMenu()});
document.addEventListener('scroll',()=>closeReferenceMenu(),true);
window.addEventListener('resize',()=>closeReferenceMenu());
document.addEventListener('keydown',event=>{
  if(event.key==='Escape'&&!document.querySelector('#reference-menu').hidden){event.preventDefault();event.stopImmediatePropagation();closeReferenceMenu(true)}
  if((event.key==='F10'&&event.shiftKey)||event.key==='ContextMenu')showReferenceMenu(event);
});
document.querySelector('#reference-close').addEventListener('click',closeReference);
document.querySelector('#reference-dialog').addEventListener('click',event=>{if(event.target.id==='reference-dialog')closeReference()});
document.querySelector('#reference-dialog').addEventListener('close',()=>{const target=referenceReturnFocus;referenceReturnFocus=null;if(target?.isConnected&&target.closest('.page.active'))target.focus()});
document.querySelector('#output-content').addEventListener('input',saveOutput);
document.addEventListener('click',event=>{
  const button=event.target.closest('button');if(!button)return;
  if(button.dataset.transaction)selectTransaction(button.dataset.transaction);
  if(button.dataset.previewDocument)previewDocument(button.dataset.previewDocument);
  if(button.dataset.reference)openReference(button.dataset.reference.split(' '));
  if(button.dataset.referenceChoice)displayReference(button.dataset.referenceChoice);
  if(button.id==='view-reference')openReference(pendingReferences);
  if(button.id==='export-package')toast('演示：当前选择“'+transactions[activeTransaction].shortTitle+'”的 '+transactions[activeTransaction].outputs.length+' 项产物；尚未生成下载文件。');
});
