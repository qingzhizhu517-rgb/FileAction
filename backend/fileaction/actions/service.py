"""行动确认与更新；临时正文仅保存在当前会话工作区。"""
from datetime import datetime, timezone
from uuid import uuid4
from fileaction.workspaces.service import session_mutation, content_hash, WorkspaceError
from fileaction.runs.errors import RunError

class ActionError(ValueError):
    pass

STATUSES = {'confirmed', 'in_progress', 'draft_ready', 'paused', 'completed'}
PRIORITIES = {'low', 'normal', 'high'}

def validate_fields(fields):
    if set(fields) - {'title','description','status','priority','due_at'}:
        raise ActionError('INVALID_REQUEST')
    for name, maximum in [('title',300),('description',4000)]:
        if name in fields and (not isinstance(fields[name],str) or len(fields[name])>maximum or (name=='title' and not fields[name].strip())):
            raise ActionError('INVALID_REQUEST')
    if ('status' in fields and fields['status'] not in STATUSES) or ('priority' in fields and fields['priority'] not in PRIORITIES):
        raise ActionError('INVALID_REQUEST')
    if fields.get('due_at') is not None:
        try:
            date=datetime.fromisoformat(fields['due_at'])
            if date.tzinfo is None or date.utcoffset() is None: raise ValueError()
            fields['due_at']=date.astimezone(timezone.utc).isoformat()
        except (ValueError,TypeError): raise ActionError('INVALID_REQUEST') from None
    return fields

class ActionService:
    def __init__(self,runs,repository=None):
        self.runs=runs; self.workspaces=runs.workspaces; self.temporary=self.workspaces.temporary; self.repository=repository

    async def _workspace(self,actor,identifier):
        try: return await self.workspaces._resource(actor,identifier)
        except WorkspaceError as exc: raise ActionError(str(exc)) from None

    async def _locate(self,actor,identifier):
        for ws in await self.temporary.list(actor,'workspace'):
            if ws.value['status'] not in {'active','paused'}: continue
            for action in ws.value.get('actions',[]):
                if action['id']==identifier: return ws,action
        raise ActionError('RESOURCE_NOT_FOUND')

    async def list(self,actor,workspace_id=None,status=None):
        if status is not None and status not in STATUSES: raise ActionError('INVALID_REQUEST')
        output=[]
        for ws in await self.temporary.list(actor,'workspace'):
            if ws.value['status'] not in {'active','paused'} or (workspace_id and ws.id!=workspace_id): continue
            output.extend(a for a in ws.value.get('actions',[]) if status is None or a['status']==status)
        if self.repository: output.extend(await self.repository.list(actor,workspace_id,status))
        return dict(items=output,next_cursor=None)

    async def get(self,actor,identifier):
        try: return (await self._locate(actor,identifier))[1]
        except ActionError:
            if self.repository: return await self.repository.get(actor,identifier)
            raise

    @session_mutation
    async def proposals(self,actor,workspace_id,run_id):
        ws=await self._workspace(actor,workspace_id)
        try: result=await self.runs.result(actor,run_id)
        except RunError as exc: raise ActionError(str(exc)) from None
        if result['workspace_id']!=workspace_id: raise ActionError('RESOURCE_NOT_FOUND')
        seen=dict(ws.value.get('shown_proposals',{})); output=[]
        for candidate in result['envelope']['action_candidates']:
            token=content_hash([run_id,candidate['id']])
            seen[token]=dict(run_id=run_id,candidate_id=candidate['id'])
            output.append(dict(proposal_id=token,text=candidate['text'],evidence=candidate['evidence']))
        await self.workspaces._save(actor,ws,{**ws.value,'shown_proposals':seen},change=False)
        return dict(items=output,next_cursor=None)

    @session_mutation
    async def create(self,actor,key,body):
        if body.get('confirmed') is not True: raise ActionError('CONFIRMATION_REQUIRED')
        if not isinstance(key,str) or not 1<=len(key)<=160: raise ActionError('IDEMPOTENCY_KEY_REQUIRED')
        if set(body)-{'workspace_id','title','description','priority','due_at','proposal_id','confirmed'}: raise ActionError('INVALID_REQUEST')
        proposal=body.get('proposal_id')
        if bool(proposal)==bool(body.get('title')) or (proposal and any(k in body for k in ('description','priority','due_at'))): raise ActionError('INVALID_REQUEST')
        fingerprint=content_hash(body)
        for resource in await self.temporary.list(actor,'workspace'):
            old=resource.value.get('action_requests',{}).get(key)
            if old:
                if old['hash']!=fingerprint: raise ActionError('IDEMPOTENCY_CONFLICT')
                return await self.get(actor,old['id'])
        try: ws=await self._workspace(actor,body['workspace_id'])
        except ActionError as exc:
            if str(exc)=='RESOURCE_NOT_FOUND' and self.repository: return await self.repository.create(actor,key,body)
            raise
        values=validate_fields({k:v for k,v in body.items() if k in {'title','description','priority','due_at'}})
        source=None
        if proposal:
            if proposal in ws.value.get('deleted_action_proposals',[]): raise ActionError('PROPOSAL_ALREADY_DELETED')
            shown=ws.value.get('shown_proposals',{}).get(proposal)
            if not shown: raise ActionError('PROPOSAL_NOT_SHOWN')
            try: result=await self.runs.result(actor,shown['run_id'])
            except RunError as exc: raise ActionError(str(exc)) from None
            if result['workspace_id']!=ws.id: raise ActionError('RESOURCE_NOT_FOUND')
            candidate=next((p for p in result['envelope']['action_candidates'] if p['id']==shown['candidate_id']),None)
            if candidate is None: raise ActionError('RESOURCE_NOT_FOUND')
            previous=next((a for a in ws.value.get('actions',[]) if a.get('proposal_key')==proposal),None)
            if previous:
                requests={**ws.value.get('action_requests',{}),key:dict(id=previous['id'],hash=fingerprint)}
                await self.workspaces._save(actor,ws,{**ws.value,'action_requests':requests},change=False)
                return previous
            values=dict(title=candidate['text'][:300],description=candidate['text'])
            source=dict(run_id=shown['run_id'],answer_id=result['answer_id'],candidate_id=shown['candidate_id'])
        now=datetime.now(timezone.utc).isoformat()
        action=dict(id=str(uuid4()),workspace_id=ws.id,retention='temporary',revision=1,status='confirmed',priority='normal',due_at=None,description='',**{k:v for k,v in values.items() if k not in {'priority','due_at','description'}})
        action.update(values,proposal_key=proposal,origin_kind='user_confirmed_proposal' if proposal else 'user_created',source=source,confirmed_at=now,created_at=now)
        requests={**ws.value.get('action_requests',{}),key:dict(id=action['id'],hash=fingerprint)}
        await self.workspaces._save(actor,ws,{**ws.value,'actions':[*ws.value.get('actions',[]),action],'action_requests':requests},change=False)
        return action

    @session_mutation
    async def patch(self,actor,identifier,expected_revision,**fields):
        fields=validate_fields(fields)
        try: ws,old=await self._locate(actor,identifier)
        except ActionError:
            if self.repository: return await self.repository.patch(actor,identifier,expected_revision,fields)
            raise
        if old['revision']!=expected_revision: raise ActionError('REVISION_CONFLICT')
        updated={**old,**fields,'revision':old['revision']+1}
        await self.workspaces._save(actor,ws,{**ws.value,'actions':[updated if a['id']==identifier else a for a in ws.value['actions']]},change=False)
        return updated

    @session_mutation
    async def delete(self,actor,identifier,expected_revision,confirmed):
        if confirmed is not True: raise ActionError('CONFIRMATION_REQUIRED')
        try: ws,old=await self._locate(actor,identifier)
        except ActionError:
            if self.repository: return await self.repository.delete(actor,identifier,expected_revision)
            raise
        if old['revision']!=expected_revision: raise ActionError('REVISION_CONFLICT')
        tombstones=list(ws.value.get('deleted_action_proposals',[]))
        if old.get('proposal_key'): tombstones.append(old['proposal_key'])
        await self.workspaces._save(actor,ws,{**ws.value,'actions':[a for a in ws.value['actions'] if a['id']!=identifier],'deleted_action_proposals':tombstones},change=False)
        return dict(id=identifier,deleted=True)
