"""预览确认、幂等、跨存储提交和只读状态协调。"""
from datetime import datetime, timezone
from uuid import UUID, uuid4
from sqlalchemy import select,insert,update,func
from fileaction.db.models import runs,run_manifests,model_calls,embedding_calls,consents,documents,document_versions,index_jobs,document_indexes,embedding_profiles
from fileaction.db.session import ActorContext
from fileaction.storage_adapters.temporary import TemporaryError
from fileaction.documents.service import DocumentError
from fileaction.workspaces.service import content_hash, WorkspaceError
from .errors import RunError
from .repository import ACTIVE,uid
from .content import RunContentStore

class RunService:
    def __init__(self,workspaces,repository):
        self.workspaces,self.repository=workspaces,repository
        self.content=RunContentStore(workspaces.temporary)

    async def create(self,actor,workspace_id,key,body):
        if body.get('consent_to_send') is not True: raise RunError('CONSENT_REQUIRED')
        if not isinstance(key,str) or not 1<=len(key)<=160 or not key.strip(): raise RunError('IDEMPOTENCY_KEY_REQUIRED')
        request_hash=content_hash(dict(workspace_id=workspace_id,**body))
        async with self.repository.transaction(actor) as db:
            await self.repository.lock_owner(db,actor)
            await self.repository.session_valid(db,actor)
            previous=(await db.execute(select(runs).where(runs.c.idempotency_key==key))).mappings().first()
            if previous:
                if previous['auth_session_id']!=actor.session_id: raise RunError('RESOURCE_NOT_FOUND')
                header=await self.repository.manifest_header(db,previous['id'])
                if header['header_json']['request_hash']!=request_hash: raise RunError('IDEMPOTENCY_CONFLICT')
                identifier=str(previous['id'])
            else:
                manifest=await self.workspaces.validate_preview(actor,workspace_id,body['preview_id'],body['manifest_hash'],body['expected_revision'])
                if manifest.get('retrieval_mode') == 'hybrid' and body.get('consent_to_embed_query') is not True:
                    raise RunError('EMBEDDING_CONSENT_REQUIRED')
                workspace=await self.workspaces._resource(actor,workspace_id)
                if workspace.value['status']!='active': raise RunError('WORKSPACE_INACTIVE')
                active=(await db.execute(select(runs.c.temporary_ref).where(runs.c.status.in_(ACTIVE)))).scalars().all()
                if workspace_id in active: raise RunError('WORKSPACE_BUSY')
                if len(active)>=2: raise RunError('ACCOUNT_RUN_LIMIT')
                identifier=str(uuid4())
                await self.content.bind(actor,workspace,identifier,manifest,self.workspaces.model_fingerprint())
                row=dict(id=uid(identifier),owner_id=actor.user_id,temporary_ref=workspace_id,auth_session_id=actor.session_id,kind=manifest['kind'],status='queued',manifest_hash=body['manifest_hash'],expected_revision=body['expected_revision'],idempotency_key=key)
                await db.execute(insert(runs).values(**row))
                header=dict(request_hash=request_hash,preview_id=body['preview_id'],workspace_id=workspace_id,workspace_revision=manifest['workspace_revision'],manifest_hash=body['manifest_hash'],model=manifest['model'],character_counts=manifest['character_counts'],retrieval_mode=manifest['retrieval_mode'],document_ids=[d['document_id'] for d in manifest['documents']])
                await db.execute(insert(run_manifests).values(id=uuid4(),owner_id=actor.user_id,run_id=uid(identifier),header_json=header,content_ref=identifier,prompt_version=manifest['prompt_version'],retention_mode='temporary'))
                await db.execute(insert(consents).values(id=uuid4(),owner_id=actor.user_id,operation='generate_answer',manifest_hash=body['manifest_hash'],resource_revision=body['expected_revision'],retention_mode='temporary',confirmed_at=func.now()))
                if manifest.get('retrieval_mode') == 'hybrid':
                    await db.execute(insert(consents).values(id=uuid4(),owner_id=actor.user_id,operation='embed_query',manifest_hash=body['manifest_hash'],resource_revision=body['expected_revision'],retention_mode='temporary',confirmed_at=func.now()))
                await self.repository.event(db,row,'phase_changed','queued')
        return await self.get(actor,identifier)

    async def get(self,actor,identifier):
        row,event=await self.repository.get(actor,identifier)
        result_id=None; status=row['status']; error=row['error_code']
        if status=='succeeded':
            try:
                committed=await self.content.committed(actor,str(row['id']))
                if committed: await self.validate_snapshot(actor,str(row['id']))
            except (TemporaryError,RunError,WorkspaceError): committed=None
            if committed: result_id=committed['answer_id']
            else: status='stale'; error='RESULT_NO_LONGER_CURRENT'
        return dict(id=str(row['id']),workspace_id=row['temporary_ref'],status=status,phase=(event or {}).get('phase'),error_code=error,result_id=result_id,created_at=row['created_at'].isoformat(),updated_at=row['updated_at'].isoformat())

    async def result(self,actor,identifier):
        status=await self.get(actor,identifier)
        if status['status']!='succeeded': raise RunError('RESULT_NOT_AVAILABLE')
        result=await self.content.committed(actor,identifier)
        if not result: raise RunError('RESULT_NOT_AVAILABLE')
        return result

    async def cancel(self,actor,identifier):
        row,_=await self.repository.get(actor,identifier)
        if row['status'] in ACTIVE:
            await self.repository.finish(actor,identifier,'cancelled','USER_CANCELLED')
            await self.content.release(actor,row['temporary_ref'],identifier,cancel=True)
        return await self.get(actor,identifier)

    async def validate_snapshot(self,actor,identifier,db=None):
        resource=await self.content.get(actor,identifier)
        manifest=resource.value['manifest']
        if content_hash(manifest)!= (await self.repository.get(actor,identifier))[0]['manifest_hash']: raise RunError('MANIFEST_INVALID')
        if resource.value['model_fingerprint']!=self.workspaces.model_fingerprint(): raise RunError('MODEL_CONFIG_CHANGED')
        workspace=await self.workspaces._resource(actor,manifest['workspace_id'])
        if workspace.value['status']!='active' or workspace.value['revision']!=manifest['workspace_revision']: raise RunError('RUN_STALE')
        facts={f['id']:f for f in workspace.value['facts']}
        if any(facts.get(f['id'])!=f for f in manifest['facts']): raise RunError('SOURCE_CHANGED')
        guards=[]
        for frozen in manifest['documents']:
            try:
                current_resource=await self.workspaces.temporary.get(actor,'document',frozen['document_id'])
                current=current_resource.value
                guards.append((self.workspaces.temporary._key(actor,'document',frozen['document_id']),current_resource.revision))
            except TemporaryError as exc:
                if str(exc) not in {'TEMPORARY_CONTENT_EXPIRED','RESOURCE_NOT_FOUND'}: raise
                # Lock retained document identity while the final Redis commit is made.
                if db is not None:
                    await db.execute(select(documents.c.id).where(documents.c.id==uid(frozen['document_id'])).with_for_update(read=True))
                try: current=await self.workspaces.documents._value(actor,frozen['document_id'])
                except DocumentError: raise RunError('SOURCE_CHANGED') from None
            if current['current_version_id']!=frozen['document_version_id'] or current['sha256']!=frozen['sha256'] or current['name']!=frozen['name'] or current['parse_status']!='ready': raise RunError('SOURCE_CHANGED')
            segments={s['id']:s for s in current['segments']}
            for part in frozen['segments']:
                source=segments.get(part['segment_id'])
                if source is None or source['text'][part['char_start']:part['char_end']]!=part['text']: raise RunError('SOURCE_CHANGED')
        from fileaction.workspaces.hybrid import validate
        if manifest.get('retrieval_mode')=='hybrid':
            for index in manifest['index_versions']:
                if db is not None:
                    # Index cancellation/publication also locks these PG rows.
                    rows=(await db.execute(select(index_jobs.c.status).where(index_jobs.c.index_ref==index['index_id']).with_for_update(read=True))).scalars().all()
                    if not rows or any(status!='succeeded' for status in rows): raise RunError('INDEX_CHANGED')
                    if index['retention']=='retained':
                        await db.execute(select(document_indexes.c.id).where(document_indexes.c.id==uid(index['index_id'])).with_for_update(read=True))
                        await db.execute(select(embedding_profiles.c.id).where(embedding_profiles.c.id==uid(index['profile_id'])).with_for_update(read=True))
                if index['retention']=='temporary':
                    temporary_index=await self.workspaces.temporary.get(actor,'index',index['index_id'])
                    guards.append((self.workspaces.temporary._key(actor,'index',index['index_id']),temporary_index.revision))
        await validate(self.workspaces.retrieval, actor, manifest)
        return manifest,guards

    async def commit(self,actor,identifier,worker,answer):
        from fileaction.agent.contracts import validate_answer
        async with self.repository.transaction(actor) as db:
            row=await self.repository.owned_running(db,actor,identifier,worker)
            manifest,guards=await self.validate_snapshot(actor,identifier,db)
            # Validation has already occurred in the graph. Strip server-only positions for a second trust-boundary check.
            import copy
            raw=copy.deepcopy(answer)
            for item in [*raw.get('claims',[]),*raw.get('memory_candidates',[]),*raw.get('action_candidates',[])]:
                for evidence in item.get('evidence',[]):
                    for name in ('char_start','char_end','location'): evidence.pop(name,None)
            answer=validate_answer(raw,manifest)
            result=await self.content.commit(actor,identifier,answer,guards)
            await db.execute(update(runs).where(runs.c.id==row['id']).values(status='succeeded',lease_until=None,updated_at=func.now()))
            await db.execute(update(model_calls).where(model_calls.c.run_id==row['id'],model_calls.c.state=='received').values(state='committed'))
            await db.execute(update(embedding_calls).where(embedding_calls.c.run_id==row['id'],embedding_calls.c.state=='received').values(state='committed'))
            await self.repository.event(db,row,'completed','saving',{'result_id':result['answer_id'],'workspace_revision':manifest['workspace_revision']})
            return result

    async def recover(self):
        for candidate in await self.repository.recoverable():
            probe=ActorContext(candidate['owner_id'],UUID(int=0))
            async with self.repository.transaction(probe) as db:
                row=await self.repository.row(db,candidate['id'],lock=True)
                # Candidate scanning is not a lock: cancellation/completion may have won.
                if row['status'] not in ACTIVE: continue
                actor=ActorContext(row['owner_id'],row['auth_session_id'])
                now=datetime.now(timezone.utc)
                if row['status']=='running' and row['lease_until'] and row['lease_until']>now: continue
                if row['status']=='queued' and (now-row['created_at']).total_seconds()<120: continue
                status='failed'; code='QUEUE_TIMEOUT'
                try:
                    await self.repository.session_valid(db,actor)
                    calls=(await db.execute(select(model_calls.c.state).where(model_calls.c.run_id==row['id']))).scalars().all()
                    embedding_states=(await db.execute(select(embedding_calls.c.state).where(embedding_calls.c.run_id==row['id']))).scalars().all()
                    try: committed=await self.content.committed(actor,str(row['id']))
                    except TemporaryError: committed=None
                    if committed:
                        status='succeeded'; code=None
                        await db.execute(update(model_calls).where(model_calls.c.run_id==row['id'],model_calls.c.state=='received').values(state='committed'))
                        await db.execute(update(embedding_calls).where(embedding_calls.c.run_id==row['id'],embedding_calls.c.state=='received').values(state='committed'))
                    elif 'sent' in calls or any(s in {'sent','interrupted'} for s in embedding_states):
                        status='interrupted'; code='EMBEDDING_OUTCOME_UNKNOWN' if any(s in {'sent','interrupted'} for s in embedding_states) else 'MODEL_OUTCOME_UNKNOWN'
                        await db.execute(update(model_calls).where(model_calls.c.run_id==row['id'],model_calls.c.state=='sent').values(state='interrupted',usage_json={'cost_status':'unknown'}))
                        await db.execute(update(embedding_calls).where(embedding_calls.c.run_id==row['id'],embedding_calls.c.state=='sent').values(state='interrupted',usage_json={'cost_status':'unknown'}))
                    elif row['status']=='running':
                        await self.content.get(actor,str(row['id']))
                        status='queued'; code=None
                except (RunError,TemporaryError) as exc:
                    code=str(exc)
                await db.execute(update(runs).where(runs.c.id==row['id']).values(status=status,error_code=code,lease_owner=None,lease_until=None,updated_at=func.now()))
                await self.repository.event(db,row,'recovered',payload={'status':status,'error_code':code})
            if status not in ACTIVE:
                await self.content.release(actor,row['temporary_ref'],str(row['id']))
