import {useState} from 'react';
import {useQuery} from '@tanstack/react-query';
import {Link} from 'react-router';
import {useSession} from '../../app/session';
import {items} from '../../shared/api';
import {ErrorNotice,Modal} from '../../shared/ui';
import type {ActionProposal} from './types';

export function ConfirmActionSuggestions({workspaceId,runId}:{workspaceId:string;runId:string}){
  const {user,api}=useSession();const [selected,setSelected]=useState<ActionProposal>();const [created,setCreated]=useState<string[]>([]);
  const [busy,setBusy]=useState(false);const [error,setError]=useState<unknown>();
  const proposals=useQuery({queryKey:[user.id,'action-proposals',workspaceId,runId],queryFn:({signal})=>api.request<{items:ActionProposal[]}>('/workspaces/'+workspaceId+'/action-proposals?run_id='+encodeURIComponent(runId),{signal})});
  return <section aria-label='确认行动建议'><h3>由你决定是否行动</h3><p>建议尚未创建为行动，也不代表已报名或完成外部操作。</p>{proposals.error?<ErrorNotice error={proposals.error} retry={()=>void proposals.refetch()}/>:proposals.isPending?<p role='status'>正在核对建议来源…</p>:items(proposals.data).map((proposal,index)=><article key={proposal.proposal_id}><p>{proposal.text}</p>{created.includes(proposal.proposal_id)?<span>已确认创建</span>:<button aria-label={'确认此建议为行动 '+(index+1)} onClick={()=>{setError(undefined);setSelected(proposal)}}>确认此建议为行动</button>}</article>)}{created.length>0&&<Link to={'/actions?workspace_id='+workspaceId}>查看我的行动</Link>}
  {selected&&<Modal title='确认创建行动' close={()=>{if(!busy)setSelected(undefined)}}><blockquote>{selected.text}</blockquote><p>你正在确认采用这条建议，仅本次临时记录；这不代表任何外部操作已完成。</p>{error!=null&&<ErrorNotice error={error}/>}<button className='primary' disabled={busy} onClick={()=>{if(busy)return;setBusy(true);setError(undefined);void api.request('/actions',{method:'POST',idempotencyKey:crypto.randomUUID(),body:{workspace_id:workspaceId,proposal_id:selected.proposal_id,confirmed:true}}).then(()=>{setCreated(previous=>[...previous,selected.proposal_id]);setSelected(undefined)}).catch(setError).finally(()=>setBusy(false))}}>确认创建此行动</button></Modal>}</section>
}
