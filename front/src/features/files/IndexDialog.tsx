import {useEffect,useState} from 'react';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import type {ApiClient} from '../../shared/api';
import type {DocumentItem} from '../../shared/types';
import {Modal,ErrorNotice} from '../../shared/ui';

type Preview={preview_id:string;manifest_hash:string;revision:number;provider_domain:string;model:string;dimensions:number;retention:string;chunks:{id:string;text:string}[];batches:string[][]};
type Job={id:string;status:string;completed_chunks:number;total_chunks:number;error_code?:string;cost_status?:string};
const active=(s?:string)=>s==='queued'||s==='running'||s==='embedding';
const labels:Record<string,string>={queued:'排队中',running:'建立索引中',embedding:'建立索引中',succeeded:'语义索引已就绪',failed:'索引失败',cancelled:'已取消',interrupted:'索引中断'};

export function IndexDialog({doc,api,userId,close}: {doc:DocumentItem;api:ApiClient;userId:string;close:()=>void}) {
  const cache=useQueryClient();
  const remembered=[userId,'document-index-job',doc.id];
  const [jobId,setJobId]=useState(()=>cache.getQueryData<string>(remembered));
  const [preview,setPreview]=useState<Preview>();
  const [consent,setConsent]=useState(false);
  const [duplicateCost,setDuplicateCost]=useState(false);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState<unknown>();
  const [deleting,setDeleting]=useState(false);
  const [deleted,setDeleted]=useState(false);
  const [cleanupPending,setCleanupPending]=useState(false);
  const base='/documents/'+encodeURIComponent(doc.id);
  const jobKey=[userId,'index-job',jobId];
  const job=useQuery({queryKey:jobKey,enabled:!!jobId,queryFn:({signal})=>api.request<Job>('/index-jobs/'+jobId,{signal}),refetchInterval:q=>active(q.state.data?.status)?800:false,retry:false});
  const isActive=active(job.data?.status);
  useEffect(()=>{if(job.data&&!active(job.data.status))void cache.invalidateQueries({queryKey:[userId,'documents']})},[cache,userId,job.data?.status]);
  async function perform(fn:()=>Promise<void>){if(busy)return;setBusy(true);setError(undefined);try{await fn()}catch(e){setError(e);setPreview(undefined);setConsent(false)}finally{setBusy(false)}}
  async function prepare(){await perform(async()=>{
    const current=await api.request<DocumentItem>(base);
    setConsent(false);setDuplicateCost(false);
    setPreview(await api.request<Preview>(base+'/index-preview',{method:'POST',body:{expected_revision:current.revision,document_version_id:current.current_version_id}}));
  })}
  async function create(){if(!preview||!consent)return;await perform(async()=>{
    const next=await api.request<Job>(base+'/indexes',{method:'POST',idempotencyKey:crypto.randomUUID(),body:{preview_id:preview.preview_id,manifest_hash:preview.manifest_hash,expected_revision:preview.revision,consent_to_embed:true,...(job.data&&['failed','interrupted'].includes(job.data.status)?{retry_job_id:job.data.id,accept_possible_duplicate_cost:duplicateCost}:{})}});
    cache.setQueryData(remembered,next.id);cache.setQueryData([userId,'index-job',next.id],next);setJobId(next.id);setPreview(undefined);setConsent(false);setDeleted(false);
  })}
  return <Modal title={'语义索引 · '+doc.name} close={()=>{if(!busy)close()}}>
    <p>原文解析不等于语义索引。这里的授权仅用于建立索引；查询与生成会分别再次确认。</p>
    {error!=null&&<ErrorNotice error={error}/>}
    {job.error&&<ErrorNotice error={job.error} retry={()=>void job.refetch()}/>}
    {cleanupPending&&<p role='status'>索引已停用，临时内容仍在清理中，请重试清理。</p>}
    {deleted&&<p role='status'>语义索引已撤销，原文保留。</p>}
    {job.data&&<section aria-label='索引任务状态'><h3>{labels[job.data.status]??job.data.status}</h3><p>{job.data.completed_chunks} / {job.data.total_chunks} 块</p>{job.data.error_code&&<p>错误：{job.data.error_code}</p>}{job.data.cost_status==='unknown'&&<p>供应商费用尚未核实；已外发的请求即使取消也可能计费。</p>}{isActive&&<button disabled={busy} onClick={()=>void perform(async()=>{await cache.cancelQueries({queryKey:jobKey});const cancelled=await api.request<Job>('/index-jobs/'+jobId+'/cancel',{method:'POST',body:{confirmed:true}});cache.setQueryData(jobKey,cancelled)})}>取消索引任务</button>}</section>}
    {!isActive&&!preview&&<button disabled={busy||job.isFetching} onClick={()=>void prepare()}>预览索引外发范围</button>}
    {preview&&<section aria-label='索引外发预览'><p>服务：{preview.provider_domain} · 模型：{preview.model} · {preview.dimensions} 维</p><p>{preview.retention==='temporary'?'仅本次保存索引':'随文件长期保存索引'} · {preview.chunks.length} 块 · {preview.batches.length} 批请求。预览120秒有效。</p><div style={{maxHeight:'35vh',overflow:'auto'}}>{preview.chunks.map(c=><pre key={c.id} style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{c.text}</pre>)}</div><label><input type='checkbox' checked={consent} onChange={e=>setConsent(e.target.checked)}/>同意将以上片段发送给所示 Embedding 服务</label>{job.data?.status==='interrupted'&&<label><input type='checkbox' checked={duplicateCost} onChange={e=>setDuplicateCost(e.target.checked)}/>上次请求结果或费用未知，同意可能重复计费后重试</label>}<button disabled={busy||!consent||(job.data?.status==='interrupted'&&!duplicateCost)} onClick={()=>void create()}>同意发送并建立语义索引</button><button disabled={busy} onClick={()=>{setPreview(undefined);setConsent(false)}}>取消本次索引预览</button></section>}
    {!preview&&!deleted&&<button disabled={busy} onClick={()=>setDeleting(true)}>撤销语义索引</button>}
    {deleting&&<section><p>确认撤销索引和停止索引任务？原文件仍可读取；已发送内容和供应商费用不能撤回。</p><button disabled={busy} onClick={()=>void perform(async()=>{const current=await api.request<DocumentItem>(base);await cache.cancelQueries({queryKey:jobKey});const removed=await api.request<{status:string}>(base+'/indexes',{method:'DELETE',body:{expected_revision:current.revision,confirmed:true}});cache.removeQueries({queryKey:jobKey});cache.removeQueries({queryKey:remembered});setJobId(undefined);setCleanupPending(removed.status==='cleanup_pending');setDeleted(removed.status==='deleted');setDeleting(false);await cache.invalidateQueries({queryKey:[userId,'documents']})})}>确认撤销语义索引</button><button disabled={busy} onClick={()=>setDeleting(false)}>暂不撤销</button></section>}
  </Modal>;
}
