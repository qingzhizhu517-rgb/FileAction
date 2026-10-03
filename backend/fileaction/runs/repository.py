"""每次操作独立本人事务；dispatcher仅读取已授权元数据列。"""
from datetime import datetime, timezone
from uuid import UUID, uuid4
from sqlalchemy import select, insert, update, func, text
from fileaction.db.session import tenant_transaction, ActorContext
from fileaction.db.models import runs, run_manifests, run_events, model_calls, consents, embedding_calls, run_retrievals
from .errors import RunError

ACTIVE=('queued','running')
def uid(value):
    try: return UUID(str(value))
    except (ValueError,TypeError): raise RunError('RESOURCE_NOT_FOUND') from None

class RunRepository:
    def __init__(self,factory,dispatcher=None): self.factory,self.dispatcher=factory,dispatcher
    def transaction(self,actor): return tenant_transaction(self.factory,actor)

    async def session_valid(self,db,actor):
        valid=await db.scalar(text("SELECT EXISTS(SELECT 1 FROM auth_sessions s JOIN users u ON u.id=s.user_id WHERE s.id=:session AND s.user_id=:owner AND s.revoked_at IS NULL AND s.expires_at>now() AND s.last_seen_at>now()-interval '24 hours' AND u.disabled_at IS NULL)"),dict(session=actor.session_id,owner=actor.user_id))
        if not valid: raise RunError('SESSION_REVOKED')

    async def lock_owner(self,db,actor):
        await db.execute(text("SELECT pg_advisory_xact_lock(hashtextextended(:key,0))"),dict(key='run-owner:'+str(actor.user_id)))

    async def row(self,db,identifier,*,lock=False):
        query=select(runs).where(runs.c.id==uid(identifier))
        row=(await db.execute(query.with_for_update() if lock else query)).mappings().first()
        if row is None: raise RunError('RESOURCE_NOT_FOUND')
        return dict(row)

    async def get(self,actor,identifier):
        async with self.transaction(actor) as db:
            await self.session_valid(db,actor)
            row=await self.row(db,identifier)
            if row['auth_session_id']!=actor.session_id: raise RunError('RESOURCE_NOT_FOUND')
            events=(await db.execute(select(run_events).where(run_events.c.run_id==row['id']).order_by(run_events.c.seq.desc()).limit(1))).mappings().first()
            return row,dict(events) if events else None

    async def manifest_header(self,db,identifier):
        return dict((await db.execute(select(run_manifests).where(run_manifests.c.run_id==uid(identifier)))).mappings().one())

    async def event(self,db,row,kind,phase=None,payload=None):
        seq=await db.scalar(select(func.coalesce(func.max(run_events.c.seq),0)+1).where(run_events.c.run_id==row['id']))
        await db.execute(insert(run_events).values(id=uuid4(),owner_id=row['owner_id'],run_id=row['id'],seq=seq,type=kind,phase=phase,safe_payload=payload or {}))

    async def owned_running(self,db,actor,identifier,worker):
        row=await self.row(db,identifier,lock=True)
        if row['auth_session_id']!=actor.session_id: raise RunError('RESOURCE_NOT_FOUND')
        if row['status']!='running' or row['lease_owner']!=worker or row['lease_until']<=datetime.now(timezone.utc): raise RunError('RUN_NOT_ACTIVE')
        await self.session_valid(db,actor)
        return row

    async def claim(self,worker):
        if self.dispatcher is None: raise RunError('DEPENDENCY_UNAVAILABLE')
        async with self.dispatcher() as db:
            async with db.begin():
                await db.execute(text("SELECT pg_advisory_xact_lock(728934001)"))
                # Explicitly use only column grants (never SELECT * or count(*)).
                count=await db.scalar(text("SELECT count(id) FROM runs WHERE status='running'"))
                if count>=4: return None
                row=(await db.execute(text('SELECT id,owner_id FROM fa_claim_runs(:worker)'),dict(worker=worker))).mappings().first()
                return dict(row) if row else None

    async def recoverable(self):
        async with self.dispatcher() as db:
            rows=(await db.execute(text("SELECT id,owner_id FROM runs WHERE status IN ('queued','running') ORDER BY created_at,id LIMIT 100"))).mappings().all()
            return [dict(row) for row in rows]

    async def renew(self,actor,identifier,worker):
        async with self.transaction(actor) as db:
            await self.owned_running(db,actor,identifier,worker)
            await db.execute(update(runs).where(runs.c.id==uid(identifier)).values(lease_until=func.now()+text("interval '30 seconds'")))

    async def phase(self,actor,identifier,worker,phase):
        async with self.transaction(actor) as db:
            row=await self.owned_running(db,actor,identifier,worker)
            await self.event(db,row,'phase_changed',phase)

    async def call_record(self,actor,identifier,number):
        async with self.transaction(actor) as db:
            row=(await db.execute(select(model_calls).where(model_calls.c.run_id==uid(identifier),model_calls.c.call_no==number))).mappings().first()
            return dict(row) if row else None

    async def begin_call(self,actor,identifier,worker,number,fingerprint):
        async with self.transaction(actor) as db:
            row=await self.owned_running(db,actor,identifier,worker)
            limit=2 if row['kind'] in {'chat','propose_actions'} else 1
            if not 1<=number<=limit: raise RunError('MODEL_BUDGET_EXCEEDED')
            previous=await db.scalar(select(model_calls.c.id).where(model_calls.c.run_id==row['id'],model_calls.c.call_no==number))
            if previous: raise RunError('MODEL_OUTCOME_UNKNOWN')
            call_id=uuid4()
            await db.execute(insert(model_calls).values(id=call_id,owner_id=actor.user_id,run_id=row['id'],call_no=number,state='prepared',request_fingerprint=fingerprint))
            await db.execute(update(model_calls).where(model_calls.c.id==call_id).values(state='sent',started_at=func.now()))

    async def received(self,actor,identifier,worker,number):
        async with self.transaction(actor) as db:
            await self.owned_running(db,actor,identifier,worker)
            await db.execute(update(model_calls).where(model_calls.c.run_id==uid(identifier),model_calls.c.call_no==number,model_calls.c.state=='sent').values(state='received',response_ref=str(identifier)+':'+str(number),finished_at=func.now(),usage_json={'cost_status':'unknown'}))

    async def begin_embedding(self,actor,identifier,worker,request_hash):
        async with self.transaction(actor) as db:
            row=await self.owned_running(db,actor,identifier,worker)
            previous=(await db.execute(select(embedding_calls).where(embedding_calls.c.run_id==row['id']))).mappings().first()
            if previous:
                if previous['request_hash']!=request_hash or previous['state'] not in {'received','committed'}:
                    raise RunError('EMBEDDING_OUTCOME_UNKNOWN')
                return dict(previous)
            call_id=uuid4()
            await db.execute(insert(embedding_calls).values(
                id=call_id, owner_id=actor.user_id, run_id=row['id'], batch_no=0,
                request_hash=request_hash, content_ref=str(identifier), state='prepared',
            ))
            await db.execute(update(embedding_calls).where(embedding_calls.c.id==call_id).values(state='sent'))
            return None

    async def embedding_received(self,actor,identifier,worker,usage=None):
        async with self.transaction(actor) as db:
            await self.owned_running(db,actor,identifier,worker)
            await db.execute(update(embedding_calls).where(
                embedding_calls.c.run_id==uid(identifier), embedding_calls.c.batch_no==0,
                embedding_calls.c.state=='sent',
            ).values(state='received', response_ref=str(identifier)+':query', usage_json=usage or {'cost_status':'unknown'}))

    async def embedding_committed(self,actor,identifier):
        async with self.transaction(actor) as db:
            await db.execute(update(embedding_calls).where(
                embedding_calls.c.run_id==uid(identifier), embedding_calls.c.batch_no==0,
                embedding_calls.c.state=='received',
            ).values(state='committed'))

    async def embedding_interrupted(self,actor,identifier,code):
        async with self.transaction(actor) as db:
            await db.execute(update(embedding_calls).where(
                embedding_calls.c.run_id==uid(identifier), embedding_calls.c.state=='sent',
            ).values(state='interrupted', usage_json={'outcome':'failed','error_code':code,'cost_status':'unknown'}))

    async def record_retrieval(self,actor,identifier,mode,index_refs,scope_hash,query_ref,result_ref,worker,step=0):
        async with self.transaction(actor) as db:
            await self.owned_running(db,actor,identifier,worker)
            existing=await db.scalar(select(run_retrievals.c.id).where(run_retrievals.c.run_id==uid(identifier),run_retrievals.c.step_no==step))
            if existing: return
            await db.execute(insert(run_retrievals).values(
                id=uuid4(), owner_id=actor.user_id, run_id=uid(identifier), step_no=step,
                mode=mode, index_refs=index_refs, scope_hash=scope_hash,
                query_ref=query_ref, result_ref=result_ref,
            ))

    async def finish(self,actor,identifier,status,error=None,worker=None):
        async with self.transaction(actor) as db:
            row=await self.row(db,identifier,lock=True)
            if row['status'] not in ACTIVE: return row
            if worker and row['lease_owner']!=worker: return row
            await db.execute(update(runs).where(runs.c.id==row['id']).values(status=status,error_code=error,lease_until=None,updated_at=func.now()))
            await self.event(db,row,status,payload={'error_code':error} if error else {})
            return {**row,'status':status,'error_code':error}

    async def events(self,actor,identifier,after=0):
        await self.get(actor,identifier)
        async with self.transaction(actor) as db:
            rows=(await db.execute(select(run_events).where(run_events.c.run_id==uid(identifier),run_events.c.seq>after).order_by(run_events.c.seq).limit(100))).mappings().all()
            return [dict(row) for row in rows]
