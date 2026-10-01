// 共享事务选择器：折叠时只显示当前项，展开后搜索与滚动选择。
const transactionPickerState={originId:null,results:[],highlighted:-1};
function escapePickerText(value){return String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]))}
function transactionSelector(context){
  const item=transactions[activeTransaction];
  const count=Object.keys(transactions).length;
  const detail=context==='查看成果'?item.outputs.length+' 项产物':'行动与准备';
  return `<button class="current-transaction" data-transaction-picker aria-haspopup="dialog" aria-expanded="false" aria-controls="transaction-picker" aria-label="切换事务，当前：${escapePickerText(item.title)}"><span class="current-transaction-icon ${activeTransaction==='innovation'?'lavender':''}">${icon(item.icon)}</span><span class="current-transaction-copy"><small>当前事务 · ${item.files.length} 份文件 · ${detail}</small><strong title="${escapePickerText(item.title)}">${escapePickerText(item.shortTitle)}</strong></span><span class="transaction-change">切换事务${icon('chevron-down')}</span></button><span class="transaction-total">共 ${count} 个事务</span>`;
}
function pickerOriginTrigger(){return document.getElementById(transactionPickerState.originId)?.querySelector('[data-transaction-picker]')}
function normalizeTransactionQuery(value){return String(value).normalize('NFKC').toLocaleLowerCase().replace(/\s+/g,'')}
function positionTransactionPicker(){
  const picker=document.querySelector('#transaction-picker');
  const trigger=pickerOriginTrigger();if(picker.hidden||!trigger)return;
  const rect=trigger.getBoundingClientRect();
  const width=Math.max(0,Math.min(470,window.innerWidth-24));
  const height=Math.max(0,Math.min(480,window.innerHeight-24));
  picker.style.width=width+'px';picker.style.maxHeight=height+'px';
  const actualHeight=picker.offsetHeight||height;
  let top=rect.bottom+8;
  if(top+actualHeight>window.innerHeight-12&&rect.top>window.innerHeight-rect.bottom){top=rect.top-actualHeight-8}
  top=Math.max(12,Math.min(top,window.innerHeight-actualHeight-12));
  picker.style.top=top+'px';picker.style.left=Math.max(12,Math.min(rect.left,window.innerWidth-width-12))+'px';
}
function highlightTransactionOption(index,scroll=false){
  const {results}=transactionPickerState;
  transactionPickerState.highlighted=results.length?Math.max(0,Math.min(index,results.length-1)):-1;
  const input=document.querySelector('#transaction-search');
  document.querySelectorAll('[data-picker-index]').forEach(option=>option.classList.toggle('keyboard-active',Number(option.dataset.pickerIndex)===transactionPickerState.highlighted));
  const option=document.getElementById('transaction-choice-'+transactionPickerState.highlighted);
  if(option){input.setAttribute('aria-activedescendant',option.id);if(scroll)option.scrollIntoView({block:'nearest'})}
  else input.removeAttribute('aria-activedescendant');
}
function renderTransactionOptions(){
  const input=document.querySelector('#transaction-search');
  const query=normalizeTransactionQuery(input.value);
  const entries=Object.entries(transactions);
  const results=entries.filter(([id,item])=>{
    const sourceNames=item.files.map(fileId=>files.find(file=>file.id===fileId)?.title||'');
    return normalizeTransactionQuery([item.title,item.shortTitle,item.goal,item.state,...sourceNames].join(' ')).includes(query);
  }).sort(([a],[b])=>Number(b===activeTransaction)-Number(a===activeTransaction));
  transactionPickerState.results=results.map(([id])=>id);
  const forOutputs=transactionPickerState.originId==='package-transactions';
  const actionCounts={};document.querySelectorAll('[data-task]').forEach(card=>{actionCounts[card.dataset.task]=(actionCounts[card.dataset.task]||0)+1});
  document.querySelector('#transaction-options').innerHTML=results.map(([id,item],index)=>{
    const selected=id===activeTransaction;
    const metadata=`${item.files.length} 份文件 · ${forOutputs?item.outputs.length+' 项产物':(actionCounts[id]||0)+' 项行动'} · ${item.state}`;
    return `<button class="transaction-option" role="option" aria-selected="${selected}" id="transaction-choice-${index}" data-picker-choice="${escapePickerText(id)}" data-picker-index="${index}" tabindex="-1" aria-label="${escapePickerText(item.title+'，'+metadata+(selected?'，当前事务':''))}"><span class="transaction-option-icon">${icon(item.icon)}</span><span class="transaction-option-copy"><strong title="${escapePickerText(item.title)}">${escapePickerText(item.title)}</strong><small title="${escapePickerText(metadata)}">${escapePickerText(metadata)}</small></span><span class="transaction-selected">${selected?'当前'+icon('check'):''}</span></button>`;
  }).join('');
  document.querySelector('#transaction-picker-empty').hidden=results.length>0;
  document.querySelector('#transaction-search-clear').hidden=!input.value;
  document.querySelector('#transaction-result-count').textContent=query?`找到 ${results.length} 个事务 / 共 ${entries.length} 个`:`${entries.length} 个事务`;
  const selectedIndex=transactionPickerState.results.indexOf(activeTransaction);
  highlightTransactionOption(selectedIndex<0?0:selectedIndex);
  document.querySelector('#transaction-options').scrollTop=0;
  positionTransactionPicker();
}
function openTransactionPicker(trigger){
  const origin=trigger.closest('.transaction-switcher');if(!origin)return;
  const picker=document.querySelector('#transaction-picker');
  if(!picker.hidden&&transactionPickerState.originId===origin.id){closeTransactionPicker(true);return}
  closeTransactionPicker();transactionPickerState.originId=origin.id;
  document.querySelector('#transaction-picker-title').textContent=origin.id==='package-transactions'?'切换成果所属事务':'切换要推进的事务';
  document.querySelector('#transaction-search').value='';
  picker.hidden=false;trigger.setAttribute('aria-expanded','true');
  document.querySelector('#transaction-search').setAttribute('aria-expanded','true');
  renderTransactionOptions();document.querySelector('#transaction-search').focus();
}
function closeTransactionPicker(restoreFocus=false){
  const picker=document.querySelector('#transaction-picker');if(!picker)return;
  const wasOpen=!picker.hidden;picker.hidden=true;
  document.querySelectorAll('[data-transaction-picker]').forEach(trigger=>trigger.setAttribute('aria-expanded','false'));
  document.querySelector('#transaction-search').setAttribute('aria-expanded','false');
  if(wasOpen&&restoreFocus)pickerOriginTrigger()?.focus();
}
function chooseTransaction(id){
  if(!Object.hasOwn(transactions,id))return;
  closeTransactionPicker();if(id!==activeTransaction)selectTransaction(id);
  pickerOriginTrigger()?.focus();
}
document.querySelector('#transaction-search').addEventListener('input',renderTransactionOptions);
document.querySelector('#transaction-picker').addEventListener('keydown',event=>{
  if(event.isComposing)return;
  if(event.key==='Escape'){event.preventDefault();event.stopPropagation();closeTransactionPicker(true);return}
  if(event.key==='Tab'){closeTransactionPicker(true);return}
  if(event.target.id!=='transaction-search')return;
  if(event.key==='ArrowDown'||event.key==='ArrowUp'){
    event.preventDefault();
    const delta=event.key==='ArrowDown'?1:-1;
    highlightTransactionOption(transactionPickerState.highlighted+delta,true);
  }
  if(event.key==='Enter'){
    event.preventDefault();
    const id=transactionPickerState.results[transactionPickerState.highlighted];
    if(id)chooseTransaction(id);
  }
});
document.addEventListener('keydown',event=>{
  const trigger=event.target.closest('[data-transaction-picker]');
  if(trigger&&event.key==='ArrowDown'){event.preventDefault();openTransactionPicker(trigger)}
});
document.addEventListener('click',event=>{
  const button=event.target.closest('button');if(!button)return;
  if(button.hasAttribute('data-transaction-picker'))openTransactionPicker(button);
  if(button.dataset.pickerChoice)chooseTransaction(button.dataset.pickerChoice);
  if(button.id==='transaction-picker-close')closeTransactionPicker(true);
  if(button.id==='transaction-search-clear'){document.querySelector('#transaction-search').value='';renderTransactionOptions();document.querySelector('#transaction-search').focus()}
});
document.addEventListener('pointerdown',event=>{if(!event.target.closest('#transaction-picker,[data-transaction-picker]'))closeTransactionPicker()});
document.addEventListener('focusin',event=>{if(!event.target.closest('#transaction-picker,[data-transaction-picker]'))closeTransactionPicker()});
document.addEventListener('scroll',event=>{if(!document.querySelector('#transaction-picker').contains(event.target))closeTransactionPicker()},true);
window.addEventListener('resize',positionTransactionPicker);
