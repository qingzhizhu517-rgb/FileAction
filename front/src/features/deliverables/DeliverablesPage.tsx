import {useEffect,useState} from 'react';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {Link,useSearchParams} from 'react-router';
import {useSession} from '../../app/session';
import {items,type ApiClient} from '../../shared/api';
import {Empty,ErrorNotice,Modal} from '../../shared/ui';
import type {Workspace} from '../../shared/types';
import type {ArtifactItem} from './types';
import '../actions/actions-artifacts.css';

export function saveDownload(blob:Blob,name:string){
  const url=URL.createObjectURL(blob);const link=document.createElement('a');
  link.href=url;link.download=name.replace(/[\/\\:*?"<>|\u0000-\u001f]/g,'_').replace(/^\.+/,'')||'成果.md';
  document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
const validityLabel={current:'来源当前有效',stale:'来源或背景已变化',source_deleted:'来源已删除，引用不可用'};
export function DeliverablesPage(){
  const {user,api}=useSession();const [params]=useSearchParams();const [workspaceId,setWorkspaceId]=useState(params.get('workspace_id')??'');
  const [editing,setEditing]=useState<ArtifactItem>();const [selected,setSelected]=useState<Record<string,number>>({});
  const [zipConfirm,setZipConfirm]=useState(false);const [busy,setBusy]=useState(false);const [error,setError]=useState<unknown>();
  const artifacts=useQuery({queryKey:[user.id,'artifacts'],queryFn:({signal})=>api.request<{items:ArtifactItem[]}>('/artifacts',{signal})});
  const workspaces=useQuery({queryKey:[user.id,'artifact-workspaces'],queryFn:async({signal})=>{const [temporary,retained]=await Promise.all([api.request<{items:Workspace[]}>('/workspaces/temporary',{signal}),api.request<{items:Workspace[]}>('/workspaces?limit=100',{signal})]);return [...items(temporary),...items(retained)]}});
  const all=items(artifacts.data);const visible=all.filter(a=>!workspaceId||a.workspace_id===workspaceId);
  const chosen=all.filter(a=>a.id in selected);const zipWorkspace=chosen[0]?.workspace_id;const sameWorkspace=chosen.length>0&&chosen.every(a=>a.workspace_id===zipWorkspace);
  async function zip(){if(busy||!sameWorkspace)return;setBusy(true);setError(undefined);try{
    const retained=workspaces.data?.find(w=>w.id===zipWorkspace);
    const workspace=retained?.retention==='retained'?retained:await api.request<Workspace>('/workspaces/'+zipWorkspace);
    const blob=await api.request<Blob>('/workspaces/'+zipWorkspace+'/export',{method:'POST',binary:true,body:{expected_revision:workspace.revision,selections:chosen.map(a=>({artifact_id:a.id,version:selected[a.id]})),confirm_historical:chosen.some(a=>selected[a.id]!==a.current_version),confirm_stale:chosen.some(a=>a.validity!=='current')}});
    saveDownload(blob,'文启成果包.zip');setZipConfirm(false);
  }catch(e){setError(e)}finally{setBusy(false)}}
  return <main className='page domain-page'><header className='domain-heading'><div><p className='eyebrow'>YOUR WORK, YOUR WORDS</p><h1>成果包</h1><p>模型原稿与每次用户编辑分别保存，下载你明确选择的版本。</p></div><button className='primary' disabled={!sameWorkspace||busy} onClick={()=>{setError(undefined);setZipConfirm(true)}}>下载所选版本 ZIP（{chosen.length}）</button></header>
  {error!=null&&!zipConfirm&&<ErrorNotice error={error}/>}<div className='domain-filters'><label>工作区<select value={workspaceId} onChange={e=>{setWorkspaceId(e.target.value);setSelected({})}}><option value=''>全部工作区</option>{workspaces.data?.map(w=><option key={w.id} value={w.id}>{w.title} · {w.retention==='temporary'?'仅本次':'已保留'}</option>)}</select></label>{chosen.length>0&&!sameWorkspace&&<p role='status'>ZIP请选择同一工作区的成果。</p>}</div>
  {artifacts.error?<ErrorNotice error={artifacts.error} retry={()=>void artifacts.refetch()}/>:artifacts.isPending?<p role='status'>正在读取成果…</p>:!visible.length?<Empty title='还没有起草的成果'>回到工作区，明确选择起草并确认外发后才会生成；理解文件不要求起草。</Empty>:<div className='domain-cards'>{visible.map(a=><article className='domain-card' key={a.id}><div className='domain-badges'><span>{a.retention==='temporary'?'仅本次 · 临时':'已保留'}</span><span>v{a.version} · {a.author_kind==='model'?'模型原稿':'用户编辑'}</span></div><h2>{a.title}</h2><p>{validityLabel[a.validity]}</p><p>{a.body.slice(0,120)}{a.body.length>120?'…':''}</p><p className='artifact-meta'>{a.verification_note}</p><label className='artifact-selection'><input type='checkbox' checked={a.id in selected} onChange={e=>setSelected(old=>{const next={...old};if(e.target.checked)next[a.id]=a.current_version;else delete next[a.id];return next})}/>选择此成果加入 ZIP</label>{a.id in selected&&<label>ZIP导出版本<select value={selected[a.id]} onChange={e=>setSelected({...selected,[a.id]:Number(e.target.value)})}>{Array.from({length:a.current_version},(_,i)=>i+1).map(v=><option key={v} value={v}>v{v}{v!==a.current_version?' · 历史':' · 当前'}</option>)}</select></label>}<div className='domain-card-actions'><button aria-label={'查看与编辑 '+a.title} onClick={()=>setEditing(a)}>查看与编辑</button>{a.retention==='temporary'&&<Link to={'/workspaces/'+a.workspace_id}>回到工作区</Link>}</div></article>)}</div>}
  {editing&&<ArtifactEditor key={editing.id} item={editing} api={api} userId={user.id} close={()=>setEditing(undefined)} refreshed={()=>void artifacts.refetch()}/>}
  {zipConfirm&&<Modal title='确认下载所选成果' close={()=>{if(!busy)setZipConfirm(false)}}>{error!=null&&<ErrorNotice error={error}/>}<p>仅包含以下明确版本，不包含原始文件。</p><ul>{chosen.map(a=><li key={a.id}>{a.title} · v{selected[a.id]} {selected[a.id]!==a.current_version?'（历史版本）':''} · {validityLabel[a.validity]}</li>)}</ul><p>用户编辑未经自动核验；准备材料不代表已报名或已完成外部动作。</p><button className='primary' disabled={busy} onClick={()=>void zip()}>确认下载所选 ZIP</button></Modal>}
  </main>
}

function ArtifactEditor({item,api,userId,close,refreshed}:{item:ArtifactItem;api:ApiClient;userId:string;close:()=>void;refreshed:()=>void}){
  const cache=useQueryClient();const [version,setVersion]=useState(item.version);const [draft,setDraft]=useState<string>();
  const [busy,setBusy]=useState(false);const [error,setError]=useState<unknown>();const [discard,setDiscard]=useState<'close'|number>();
  const [exportConfirm,setExportConfirm]=useState(false);const [deleting,setDeleting]=useState(false);
  const key=[userId,'artifact',item.id];
  const result=useQuery({queryKey:[...key,version],queryFn:({signal})=>api.request<ArtifactItem>('/artifacts/'+item.id+'?version='+version,{signal})});
  const versions=useQuery({queryKey:[...key,'versions'],queryFn:({signal})=>api.request<{items:ArtifactItem[]}>('/artifacts/'+item.id+'/versions',{signal})});
  const view=result.data;const text=draft??view?.body??'';const dirty=Boolean(view&&draft!==undefined&&draft!==view.body);
  useEffect(()=>{if(!dirty)return;const guard=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue=''};window.addEventListener('beforeunload',guard);return()=>window.removeEventListener('beforeunload',guard)},[dirty]);
  function move(next:'close'|number){if(busy)return;if(dirty){setDiscard(next);return}setDraft(undefined);setError(undefined);if(next==='close')close();else setVersion(next)}
  async function perform(fn:()=>Promise<void>){if(busy)return;setBusy(true);setError(undefined);try{await fn()}catch(e){setError(e)}finally{setBusy(false)}}
  async function download(){if(!view)return;await perform(async()=>{const blob=await api.request<Blob>('/artifacts/'+item.id+'/export',{method:'POST',binary:true,body:{version:view.version,expected_revision:view.revision,confirm_historical:view.historical,confirm_stale:view.validity!=='current'}});saveDownload(blob,view.title+'-v'+view.version+'.md');setExportConfirm(false)})}
  return <Modal title={'成果 · '+item.title} close={()=>move('close')}>{error!=null&&<ErrorNotice error={error}/>}
  {discard!==undefined?<div className='artifact-confirm'><h3>尚有未保存的修改</h3><p>关闭或切换版本将放弃这些修改。</p><button onClick={()=>setDiscard(undefined)}>继续编辑</button><button onClick={()=>{const next=discard;setDiscard(undefined);setDraft(undefined);if(next==='close')close();else setVersion(next)}}>放弃修改并继续</button></div>:deleting?<div className='artifact-confirm'><p>删除此成果及全部版本？已下载的副本不会被撤回。</p><button disabled={busy} onClick={()=>setDeleting(false)}>取消</button><button disabled={busy} onClick={()=>void perform(async()=>{await api.request('/artifacts/'+item.id,{method:'DELETE',body:{expected_revision:view!.revision,confirmed:true}});refreshed();close()})}>确认删除全部版本</button></div>:exportConfirm?<div className='artifact-confirm'><h3>确认导出历史或过时版本</h3><p>所选 v{view?.version} {view?.historical?'为历史版本':''} · {view&&validityLabel[view.validity]}。导出不代表内容已重新核验。</p><button disabled={busy} onClick={()=>setExportConfirm(false)}>取消</button><button className='primary' disabled={busy} onClick={()=>void download()}>确认下载所选版本</button></div>:result.error?<ErrorNotice error={result.error} retry={()=>void result.refetch()}/>:!view?<p role='status'>正在读取版本…</p>:<div className='artifact-editor'>
    <label>查看版本<select disabled={busy} value={version} onChange={e=>move(Number(e.target.value))}>{items(versions.data).map(v=><option key={v.version} value={v.version}>v{v.version} · {v.author_kind==='model'?'模型原稿':'用户编辑'}{v.historical?' · 历史':''}</option>)}</select></label>
    <p className={view.historical||view.validity!=='current'?'artifact-warning':'artifact-meta'}>{view.historical?'历史版本 · ':''}{validityLabel[view.validity]} · {view.verification_note}</p>
    <label>成果正文<textarea value={text} maxLength={30000} onChange={e=>setDraft(e.target.value)}/></label>
    {dirty&&<p className='artifact-warning'>有未保存的修改；下载只包含已保存的所选版本。</p>}<div className='artifact-toolbar'><button className='primary' disabled={busy||!dirty||!text.trim()} onClick={()=>void perform(async()=>{const saved=await api.request<ArtifactItem>('/artifacts/'+item.id,{method:'PATCH',body:{body:text,expected_revision:view.revision}});await cache.invalidateQueries({queryKey:key});cache.setQueryData([...key,saved.version],saved);setVersion(saved.version);setDraft(undefined);await versions.refetch();refreshed()})}>保存为新版本</button><button disabled={busy||dirty} onClick={()=>{if(view.historical||view.validity!=='current')setExportConfirm(true);else void download()}}>下载此版本 Markdown</button><button disabled={busy||dirty} onClick={()=>setDeleting(true)}>删除成果</button></div>
    <details><summary>来源与未知范围</summary><p className='artifact-meta'>原文引用仅在服务端核验可用时附入下载。用户编辑未经自动核验。</p>{view.unknowns.map((u,i)=><p key={i}>{u}</p>)}</details>
  </div>}</Modal>
}
