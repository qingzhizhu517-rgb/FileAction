"""临时运行正文只在Redis；提交同时CAS工作区与运行资源。"""
import json
from datetime import datetime, timezone
from uuid import uuid4
from fileaction.storage_adapters.temporary import TemporaryError
from fileaction.workspaces.service import content_hash
from .errors import RunError

_COMMIT = """
if redis.call('GET',KEYS[3])=='revoked' then return 'SESSION_REVOKED' end
local now=tonumber(redis.call('TIME')[1])
for _,k in ipairs({KEYS[1],KEYS[2]}) do
  if redis.call('EXISTS',k)==0 or tonumber(redis.call('HGET',k,'expires') or '0')<=now then return 'TEMPORARY_CONTENT_EXPIRED' end
end
if redis.call('HGET',KEYS[1],'revision')~=ARGV[1] or redis.call('HGET',KEYS[2],'revision')~=ARGV[2] then return 'REVISION_CONFLICT' end
local ws=cjson.decode(redis.call('HGET',KEYS[1],'value'))
local run=cjson.decode(redis.call('HGET',KEYS[2],'value'))
if ws.status~='active' or tostring(ws.revision)~=ARGV[3] or ws.active_run~=ARGV[4] or (ws.cancel_epoch or 0)~=(run.cancel_epoch or 0) then return 'RUN_STALE' end
for i=5,#KEYS do
  if redis.call('HGET',KEYS[i],'revision')~=ARGV[i+4] then return 'SOURCE_CHANGED' end
end
local size=string.len(ARGV[5])+string.len(ARGV[6])
for _,k in ipairs(redis.call('SMEMBERS',KEYS[4])) do
  if k~=KEYS[1] and k~=KEYS[2] then size=size+tonumber(redis.call('HGET',k,'derived_bytes') or '0') end
end
if size>tonumber(ARGV[7]) then return 'QUOTA_EXCEEDED' end
redis.call('HSET',KEYS[1],'value',ARGV[5],'revision',tonumber(ARGV[1])+1,'derived_bytes',string.len(ARGV[5]))
redis.call('HSET',KEYS[2],'value',ARGV[6],'revision',tonumber(ARGV[2])+1,'derived_bytes',string.len(ARGV[6]))
return 'ok'
"""

class RunContentStore:
    def __init__(self,temporary): self.temporary=temporary
    async def get(self,actor,identifier): return await self.temporary.get(actor,'run',identifier)
    async def create(self,actor,identifier,value): return await self.temporary.create(actor,'run',value,resource_id=identifier)
    async def response(self,actor,identifier,number,raw):
        resource=await self.get(actor,identifier)
        value={**resource.value,'responses':{**resource.value.get('responses',{}),str(number):raw}}
        return await self.temporary.replace(actor,'run',identifier,value,expected_revision=resource.revision)

    async def save_section(self,actor,identifier,name,value):
        resource=await self.get(actor,identifier)
        return await self.temporary.replace(actor,'run',identifier,{**resource.value,name:value},expected_revision=resource.revision)

    async def bind(self,actor,workspace,identifier,manifest,fingerprint):
        value=workspace.value
        run=await self.create(actor,identifier,dict(workspace_id=workspace.id,manifest=manifest,model_fingerprint=fingerprint,cancel_epoch=value.get('cancel_epoch',0),responses={}))
        messages=list(value['messages'])
        if manifest['message']:
            messages.append(dict(id=str(uuid4()),role='user',sequence=len(messages)+1,text=manifest['message'],run_id=identifier))
        try:
            await self.temporary.replace(actor,'workspace',workspace.id,{**value,'active_run':identifier,'messages':messages},expected_revision=workspace.revision)
        except Exception:
            await self.temporary.delete(actor,'run',identifier)
            raise
        return run

    async def release(self,actor,workspace_id,identifier,*,cancel=False):
        for _ in range(3):
            try:
                resource=await self.temporary.get(actor,'workspace',workspace_id)
                if resource.value.get('active_run')!=identifier: return
                value={**resource.value,'active_run':None,'cancel_epoch':resource.value.get('cancel_epoch',0)+int(cancel)}
                await self.temporary.replace(actor,'workspace',workspace_id,value,expected_revision=resource.revision)
                return
            except TemporaryError as exc:
                if str(exc)=='REVISION_CONFLICT': continue
                if str(exc)=='TEMPORARY_CONTENT_EXPIRED': return
                raise

    async def commit(self,actor,identifier,answer,source_guards=()):
        run=await self.get(actor,identifier)
        workspace=await self.temporary.get(actor,'workspace',run.value['workspace_id'])
        manifest=run.value['manifest']
        if workspace.value['revision']!=manifest['workspace_revision']: raise RunError('RUN_STALE')
        answer_id=str(uuid4()); now=datetime.now(timezone.utc).isoformat()
        result=dict(run_id=identifier,workspace_id=workspace.id,answer_id=answer_id,envelope=answer,generated_at=now)
        commit=dict(answer_id=answer_id,hash=content_hash(result),revision=manifest['workspace_revision'])
        messages=list(workspace.value['messages'])
        messages.append(dict(id=str(uuid4()),sequence=len(messages)+1,role='assistant',text=answer['summary'],answer_id=answer_id,run_id=identifier))
        answers={**workspace.value.get('answers',{}),identifier:result}
        workspace_value={**workspace.value,'messages':messages,'answers':answers,'active_run':None}
        if answer['artifact']:
            artifact=dict(id=str(uuid4()),version=1,author_kind='model',run_id=identifier,validity='current',generated_at=now,**answer['artifact'])
            workspace_value['artifacts']=[*workspace.value.get('artifacts',[]),artifact]
        run_value={**run.value,'commit':commit,'result':result}
        keys=[self.temporary._key(actor,'workspace',workspace.id),self.temporary._key(actor,'run',identifier),self.temporary.session_key(actor),self.temporary._account_registry(actor)]
        keys.extend(key for key,_ in source_guards)
        values=[workspace.revision,run.revision,manifest['workspace_revision'],identifier,json.dumps(workspace_value,ensure_ascii=False,separators=(',',':')),json.dumps(run_value,ensure_ascii=False,separators=(',',':')),self.temporary.max_derived_bytes,'reserved']
        values.extend(revision for _,revision in source_guards)
        response=await self.temporary.redis.eval(_COMMIT,len(keys),*keys,*values)
        if isinstance(response,bytes): response=response.decode()
        if response!='ok': raise RunError(response)
        return result

    async def committed(self,actor,identifier):
        run=await self.get(actor,identifier)
        marker=run.value.get('commit'); result=run.value.get('result')
        if not marker or not result: return None
        workspace=await self.temporary.get(actor,'workspace',run.value['workspace_id'])
        if workspace.value.get('status')!='active' or workspace.value['revision']!=marker['revision'] or workspace.value.get('answers',{}).get(identifier)!=result or content_hash(result)!=marker['hash']: return None
        return result
