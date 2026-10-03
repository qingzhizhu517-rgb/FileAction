"""本人索引事务；dispatcher只调用受限领取函数。"""
from datetime import datetime,timezone
from uuid import UUID,uuid4
from sqlalchemy import select,insert,update,delete,func,text
from fileaction.db.models import index_jobs,embedding_calls,consents,document_indexes,document_versions,documents,document_chunks,chunk_segments,chunk_embeddings,embedding_profiles
from fileaction.db.session import tenant_transaction,ActorContext
from .service import IndexingError

ACTIVE=('queued','running')
def uid(value):
    try: return UUID(str(value))
    except (ValueError,TypeError): raise IndexingError('RESOURCE_NOT_FOUND') from None

class IndexRepository:
    def __init__(self,factory,dispatcher=None): self.factory,self.dispatcher=factory,dispatcher
    def transaction(self,actor): return tenant_transaction(self.factory,actor)

    async def session_valid(self,db,actor):
        valid=await db.scalar(text("SELECT EXISTS(SELECT 1 FROM auth_sessions s JOIN users u ON u.id=s.user_id WHERE s.id=:session AND s.user_id=:owner AND s.revoked_at IS NULL AND s.expires_at>now() AND s.last_seen_at>now()-interval '24 hours' AND u.disabled_at IS NULL)"),dict(session=actor.session_id,owner=actor.user_id))
        if not valid: raise IndexingError('SESSION_REVOKED')

    async def lock(self,db,actor):
        await db.execute(text('SELECT pg_advisory_xact_lock(hashtextextended(:key,0))'),dict(key='index-owner:'+str(actor.user_id)))

    async def row(self,db,identifier,lock=False):
        query=select(index_jobs).where(index_jobs.c.id==uid(identifier))
        row=(await db.execute(query.with_for_update() if lock else query)).mappings().first()
        if not row: raise IndexingError('RESOURCE_NOT_FOUND')
        return dict(row)

    async def get(self,actor,identifier):
        async with self.transaction(actor) as db:
            row=await self.row(db,identifier)
            if row['auth_session_id']!=actor.session_id: raise IndexingError('RESOURCE_NOT_FOUND')
            await self.session_valid(db,actor)
            return row

    async def owned(self,db,actor,identifier,worker,epoch):
        row=await self.row(db,identifier,True)
        if row['auth_session_id']!=actor.session_id: raise IndexingError('RESOURCE_NOT_FOUND')
        if row['status']!='running' or row['lease_owner']!=worker or row['lease_epoch']!=epoch or row['lease_until']<=datetime.now(timezone.utc): raise IndexingError('INDEX_NOT_ACTIVE')
        await self.session_valid(db,actor)
        consent=await db.scalar(select(consents.c.id).where(consents.c.id==row['consent_id'],consents.c.operation=='embed_document',consents.c.manifest_hash==row['manifest_json']['manifest_hash']))
        if not consent: raise IndexingError('CONSENT_REVOKED')
        if row['started_at'] and (datetime.now(timezone.utc)-row['started_at']).total_seconds()>=300: raise IndexingError('INDEX_TIMEOUT')
        return row

    async def prior(self,db,actor,key,request_hash):
        row=(await db.execute(select(index_jobs).where(index_jobs.c.idempotency_key==key))).mappings().first()
        if row:
            if row['auth_session_id']!=actor.session_id: raise IndexingError('RESOURCE_NOT_FOUND')
            if row['request_hash']!=request_hash: raise IndexingError('IDEMPOTENCY_CONFLICT')
            return dict(row)

    async def configured_profile(self,db,manifest):
        rows=(await db.execute(select(embedding_profiles).where(embedding_profiles.c.active.is_(True)).limit(2))).mappings().all()
        if len(rows)!=1: raise IndexingError('EMBEDDING_PROFILE_MISMATCH')
        row=rows[0]
        if row['model']!=manifest['model'] or row['dimensions']!=manifest['dimensions'] or str(row['config_revision'])!=manifest['profile_version'] or row['distance_metric']!='cosine': raise IndexingError('EMBEDDING_PROFILE_MISMATCH')
        return row['id']

    async def add(self,db,actor,identifier,index_id,key,request_hash,manifest,manifest_hash):
        active=await db.scalar(select(func.count()).select_from(index_jobs).where(index_jobs.c.status.in_(ACTIVE)))
        if active: raise IndexingError('INDEX_LIMIT_EXCEEDED')
        retained=manifest['retention']=='retained'
        count=len(manifest['chunks'])
        size=count*manifest['dimensions']*4
        consent=uuid4()
        header=dict(manifest_hash=manifest_hash,document_id=manifest['document_id'],document_version_id=manifest['document_version_id'],profile_hash=manifest['profile_hash'],retention=manifest['retention'],total_chunks=count)
        if retained:
            profile=await self.configured_profile(db,manifest)
            # Reservations remain charged while their physical vectors exist.
            reserved=await db.scalar(select(func.coalesce(func.sum(index_jobs.c.reserved_chunks),0)).where(index_jobs.c.reserved_chunks>0,index_jobs.c.document_version_id.is_not(None)))
            if reserved+count>50000: raise IndexingError('QUOTA_EXCEEDED')
            version=await db.scalar(select(func.coalesce(func.max(document_indexes.c.index_version),0)+1).where(document_indexes.c.document_version_id==uid(manifest['document_version_id'])))
            await db.execute(insert(document_indexes).values(id=uid(index_id),owner_id=actor.user_id,document_version_id=uid(manifest['document_version_id']),index_version=version,parser_version=manifest['parser_version'],chunker_version=manifest['chunker_version'],embedding_profile_id=profile,status='queued',consent_id=consent,content_hash=manifest_hash))
            header['manifest']=manifest
        await db.execute(insert(consents).values(id=consent,owner_id=actor.user_id,operation='embed_document',manifest_hash=manifest_hash,resource_revision=manifest['revision'],retention_mode=manifest['retention'],confirmed_at=func.now()))
        await db.execute(insert(index_jobs).values(id=uid(identifier),owner_id=actor.user_id,auth_session_id=actor.session_id,document_version_id=uid(manifest['document_version_id']) if retained else None,temporary_ref=None if retained else manifest['document_id'],index_ref=index_id,consent_id=consent,status='queued',idempotency_key=key,request_hash=request_hash,manifest_json=header,reserved_chunks=count,reserved_bytes=size))
        return await self.row(db,identifier)

    async def claim(self,worker):
        if self.dispatcher is None: raise IndexingError('DEPENDENCY_UNAVAILABLE')
        async with self.dispatcher() as db:
            async with db.begin():
                row=(await db.execute(text('SELECT * FROM fa_claim_index_jobs(:worker)'),dict(worker=worker))).mappings().first()
                return dict(row) if row else None

    async def renew(self,actor,identifier,worker,epoch):
        async with self.transaction(actor) as db:
            await self.owned(db,actor,identifier,worker,epoch)
            await db.execute(update(index_jobs).where(index_jobs.c.id==uid(identifier)).values(lease_until=func.now()+text("interval '30 seconds'")))

    async def begin_call(self,actor,identifier,worker,epoch,number,fingerprint):
        if not 0<=number<16: raise IndexingError('EMBEDDING_BUDGET_EXCEEDED')
        async with self.transaction(actor) as db:
            row=await self.owned(db,actor,identifier,worker,epoch)
            previous=(await db.execute(select(embedding_calls).where(embedding_calls.c.index_job_id==uid(identifier),embedding_calls.c.batch_no==number))).mappings().first()
            if previous:
                if previous['state']!='prepared' or previous['request_hash']!=fingerprint: raise IndexingError('EMBEDDING_OUTCOME_UNKNOWN')
                call_id=previous['id']
            else:
                call_id=uuid4()
                await db.execute(insert(embedding_calls).values(id=call_id,owner_id=actor.user_id,index_job_id=uid(identifier),batch_no=number,request_hash=fingerprint,content_ref=row['index_ref']+':'+str(number),state='prepared'))
        async with self.transaction(actor) as db:
            await self.owned(db,actor,identifier,worker,epoch)
            await db.execute(update(embedding_calls).where(embedding_calls.c.id==call_id).values(state='sent',updated_at=func.now()))

    async def call_rows(self,actor,identifier):
        async with self.transaction(actor) as db:
            return [dict(r) for r in (await db.execute(select(embedding_calls).where(embedding_calls.c.index_job_id==uid(identifier)).order_by(embedding_calls.c.batch_no))).mappings()]

    async def finish(self,actor,identifier,status,error=None,worker=None,epoch=None):
        async with self.transaction(actor) as db:
            row=await self.row(db,identifier,True)
            if row['auth_session_id']!=actor.session_id: raise IndexingError('RESOURCE_NOT_FOUND')
            if row['status'] not in ACTIVE: return
            if worker and (row['lease_owner']!=worker or row['lease_epoch']!=epoch): return
            await db.execute(update(index_jobs).where(index_jobs.c.id==row['id']).values(status=status,error_code=error,lease_until=None,updated_at=func.now()))
            if row['document_version_id']:
                await db.execute(update(document_indexes).where(document_indexes.c.id==uid(row['index_ref']),document_indexes.c.status!='deleted').values(status='cancelled' if status=='cancelled' else 'failed'))

    async def recover(self):
        if self.dispatcher is None: return []
        settled=[]
        async with self.dispatcher() as dispatch:
            rows=(await dispatch.execute(text("SELECT id,owner_id FROM index_jobs WHERE status IN ('queued','running') ORDER BY created_at,id LIMIT 100"))).mappings().all()
        for item in rows:
            actor=ActorContext(item['owner_id'],UUID(int=0))
            async with self.transaction(actor) as db:
                row=await self.row(db,item['id'],True)
                now=datetime.now(timezone.utc)
                expired=row['status']=='running' and row['lease_until'] and row['lease_until']<=now
                queue=row['status']=='queued' and (now-row['created_at']).total_seconds()>=300
                if not expired and not queue: continue
                unknown=await db.scalar(select(embedding_calls.c.id).where(embedding_calls.c.index_job_id==row['id'],embedding_calls.c.state=='sent').limit(1))
                if expired and not unknown and (now-row['created_at']).total_seconds()<300 and row['started_at'] and (now-row['started_at']).total_seconds()<300:
                    await db.execute(update(index_jobs).where(index_jobs.c.id==row['id']).values(status='queued',lease_until=None,lease_owner=None,updated_at=func.now()))
                    continue
                status='interrupted' if unknown else 'failed'
                error='EMBEDDING_OUTCOME_UNKNOWN' if unknown else 'QUEUE_TIMEOUT' if queue else 'LEASE_EXPIRED'
                await db.execute(update(index_jobs).where(index_jobs.c.id==row['id']).values(status=status,error_code=error,lease_until=None))
                await db.execute(update(embedding_calls).where(embedding_calls.c.index_job_id==row['id'],embedding_calls.c.state=='sent').values(state='interrupted'))
                if row['document_version_id']:
                    await db.execute(update(document_indexes).where(document_indexes.c.id==uid(row['index_ref']),document_indexes.c.status!='deleted').values(status='failed'))
                settled.append((ActorContext(row['owner_id'],row['auth_session_id']),str(row['id'])))
        return settled
