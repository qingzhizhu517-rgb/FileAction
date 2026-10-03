import {useState} from 'react';
import {useQuery} from '@tanstack/react-query';
import {Link,useSearchParams} from 'react-router';
import {useSession} from '../../app/session';
import {items} from '../../shared/api';
import {Empty,ErrorNotice,Modal} from '../../shared/ui';
import type {Workspace} from '../../shared/types';
import {actionStatusLabels,type ActionItem,type ActionStatus} from './types';
import './actions-artifacts.css';

export function ActionsPage(){
  const {user,api}=useSession(); const [params]=useSearchParams();
  const [workspaceId,setWorkspaceId]=useState(params.get('workspace_id')??'');
  const [status,setStatus]=useState('');const [creating,setCreating]=useState(false);const [title,setTitle]=useState('');
  const [description,setDescription]=useState('');const [priority,setPriority]=useState('normal');const [due,setDue]=useState('');
  const [busy,setBusy]=useState(false);const [error,setError]=useState<unknown>();const [removing,setRemoving]=useState<ActionItem>();
  const actions=useQuery({queryKey:[user.id,'actions'],queryFn:({signal})=>api.request<{items:ActionItem[]}>('/actions',{signal})});
  const workspaces=useQuery({queryKey:[user.id,'action-workspaces'],queryFn:async({signal})=>{
    const [temporary,retained]=await Promise.all([api.request<{items:Workspace[]}>('/workspaces/temporary',{signal}),api.request<{items:Workspace[]}>('/workspaces?limit=100',{signal})]);return [...items(temporary),...items(retained)];
  }});
  async function perform(fn:()=>Promise<void>){if(busy)return;setBusy(true);setError(undefined);try{await fn();await actions.refetch()}catch(e){setError(e)}finally{setBusy(false)}}
  const available=workspaces.data??[];const selected=workspaceId||available[0]?.id||'';
  const visible=items(actions.data).filter(a=>(!workspaceId||a.workspace_id===workspaceId)&&(!status||a.status===status));
  return <main className='page domain-page'><header className='domain-heading'><div><p className='eyebrow'>YOUR NEXT STEP</p><h1>我的行动</h1><p>是否行动、何时继续，都由你决定。状态记录不代表外部操作已执行。</p></div><button className='primary' onClick={()=>{setError(undefined);setCreating(true)}}>新建行动</button></header>
    {error!=null&&!creating&&!removing&&<ErrorNotice error={error}/>}
    <div className='domain-filters'><label>工作区<select value={workspaceId} onChange={e=>setWorkspaceId(e.target.value)}><option value=''>全部工作区</option>{available.map(w=><option key={w.id} value={w.id}>{w.title} · {w.retention==='temporary'?'仅本次':'已保留'}</option>)}</select></label><label>行动状态<select value={status} onChange={e=>setStatus(e.target.value)}><option value=''>全部状态</option>{Object.entries(actionStatusLabels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label></div>
    {actions.error?<ErrorNotice error={actions.error} retry={()=>void actions.refetch()}/>:actions.isPending?<p role='status'>正在读取行动…</p>:!visible.length?<Empty title='还没有确认的行动'>理解文件后可以直接结束；只有你明确确认的行动才会出现在这里。</Empty>:<div className='domain-cards'>{visible.map(action=><article className='domain-card' key={action.id}><div className='domain-badges'><span>{action.retention==='temporary'?'仅本次 · 临时':'已保留'}</span><span>{action.origin_kind==='user_created'?'用户创建':'用户确认的模型建议'}</span></div><h2>{action.title}</h2>{action.description&&<p>{action.description}</p>}<p>优先级：{{low:'低',normal:'普通',high:'高'}[action.priority]}</p>{action.due_at&&<p>截止：{new Date(action.due_at).toLocaleString()}</p>}<label>状态<select aria-label={action.title+'的状态'} disabled={busy} value={action.status} onChange={e=>void perform(async()=>{await api.request('/actions/'+action.id,{method:'PATCH',body:{expected_revision:action.revision,status:e.target.value as ActionStatus}})})}>{Object.entries(actionStatusLabels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label><div className='domain-card-actions'>{action.retention==='temporary'&&<Link to={'/workspaces/'+action.workspace_id}>回到工作区</Link>}<button disabled={busy} onClick={()=>{setError(undefined);setRemoving(action)}}>删除行动</button></div></article>)}</div>}
    {creating&&<Modal title='确认创建行动' close={()=>{if(!busy)setCreating(false)}}><p>记录你选择的下一步，不会自动报名、发送或代办。当前保存模式取决于所选工作区。</p>{error!=null&&<ErrorNotice error={error}/>} {workspaces.error&&<ErrorNotice error={workspaces.error} retry={()=>void workspaces.refetch()}/>}<form className='domain-form' onSubmit={e=>{e.preventDefault();void perform(async()=>{await api.request('/actions',{method:'POST',idempotencyKey:crypto.randomUUID(),body:{workspace_id:selected,title:title.trim(),description:description.trim(),priority,...(due?{due_at:due}:{}),confirmed:true}});setCreating(false);setTitle('');setDescription('');setDue('')})}}><label>所属工作区<select value={selected} onChange={e=>setWorkspaceId(e.target.value)}>{available.map(w=><option value={w.id} key={w.id}>{w.title} · {w.retention==='temporary'?'仅本次':'已保留'}</option>)}</select></label><label>行动标题<input value={title} maxLength={300} onChange={e=>setTitle(e.target.value)}/></label><label>补充说明<textarea value={description} maxLength={4000} onChange={e=>setDescription(e.target.value)}/></label><label>优先级<select value={priority} onChange={e=>setPriority(e.target.value)}><option value='low'>低</option><option value='normal'>普通</option><option value='high'>高</option></select></label><label>截止时间（可空，须明确时区）<input value={due} onChange={e=>setDue(e.target.value)} placeholder='2026-10-03T18:00:00+08:00'/></label><button className='primary' disabled={busy||!selected||!title.trim()}>确认创建行动</button>{!available.length&&<p>请先从文件创建工作区，也可以只理解而不创建行动。</p>}</form></Modal>}
    {removing&&<Modal title='删除行动' close={()=>{if(!busy)setRemoving(undefined)}}><p>确认删除“{removing.title}”？此操作不会撤销任何你已在外部完成的事情。</p>{error!=null&&<ErrorNotice error={error}/>}<button disabled={busy} onClick={()=>void perform(async()=>{await api.request('/actions/'+removing.id,{method:'DELETE',body:{expected_revision:removing.revision,confirmed:true}});setRemoving(undefined)})}>确认删除行动</button></Modal>}
  </main>
}
