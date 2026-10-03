"""合成Redis与PG；Embedding HTTP替身，不代表真实供应商验收。"""
import os
import asyncio
import json
from dataclasses import replace
from uuid import uuid4
import pytest
import pytest_asyncio
from redis.asyncio import Redis
from fileaction.db.session import ActorContext
from fileaction.documents.service import DocumentService
from fileaction.storage_adapters.temporary import TemporaryStore
from fileaction.indexing.embedding import EmbeddingProfile
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine,async_sessionmaker
import httpx

@pytest_asyncio.fixture
async def preview_setup():
    from fileaction.indexing.service import IndexingService
    url = os.getenv('FILEACTION_TEST_REDIS_URL')
    if not url: pytest.skip('需显式合成Redis')
    redis=Redis.from_url(url,decode_responses=True)
    store=TemporaryStore(redis)
    actor=ActorContext(uuid4(),uuid4())
    docs=DocumentService(store)
    doc=await docs.upload(actor,'合成索引.txt','允许索引。未授权尾段。'.encode(),retention='temporary',consent_to_store=False,storage_notice_version='')
    svc=IndexingService(store,docs,None,EmbeddingProfile('https://synthetic.invalid/v1','synthetic','synthetic',768,'1'))
    yield svc,actor,doc
    await store.end_session(actor)
    await redis.delete(store.session_key(actor))
    await redis.aclose()

@pytest.mark.asyncio
async def test_preview_exact_span_and_profile_expiry(preview_setup):
    from fileaction.indexing.dto import IndexPreviewRequest
    from fileaction.indexing.service import IndexingError
    svc,actor,doc=preview_setup
    segment=(await svc.documents.segments(actor,doc['id']))[0]
    req=IndexPreviewRequest(expected_revision=1,document_version_id=doc['current_version_id'],selections=[dict(segment_id=segment['id'],char_start=0,char_end=5)])
    preview=await svc.preview(actor,doc['id'],req)
    assert preview['chunks'][0]['text']=='允许索引。'
    assert preview['chunks'][0]['spans'][0]['end']==5
    frozen=await svc.validate_preview(actor,doc['id'],preview['preview_id'],preview['manifest_hash'],1)
    assert frozen['retention']=='temporary'
    with pytest.raises(IndexingError,match='PREVIEW_STALE'):
        await svc.validate_preview(actor,doc['id'],preview['preview_id'],'0'*64,1)
    svc.profile=replace(svc.profile,model='changed')
    with pytest.raises(IndexingError,match='PREVIEW_STALE'):
        await svc.validate_preview(actor,doc['id'],preview['preview_id'],preview['manifest_hash'],1)
    svc.profile=replace(svc.profile,model='synthetic')
    await svc.temporary.delete(actor,'preview',preview['preview_id'])
    with pytest.raises(IndexingError,match='PREVIEW_EXPIRED'):
        await svc.validate_preview(actor,doc['id'],preview['preview_id'],preview['manifest_hash'],1)

@pytest.mark.asyncio
async def test_no_consent_creates_no_snapshot(preview_setup):
    from fileaction.indexing.service import IndexingError
    svc,actor,doc=preview_setup
    with pytest.raises(IndexingError,match='CONSENT_REQUIRED'):
        await svc.create(actor,doc['id'],'key',dict(consent_to_embed=False))
    assert await svc.temporary.list(actor,'index')==[]

@pytest_asyncio.fixture
async def setup(preview_setup):
    from fileaction.indexing.repository import IndexRepository
    names=['FILEACTION_TEST_DATABASE_URL','FILEACTION_TEST_ADMIN_DATABASE_URL','FILEACTION_TEST_DISPATCHER_DATABASE_URL']
    if not all(os.getenv(n) for n in names): pytest.skip('需显式合成PG')
    svc,actor,doc=preview_setup
    engines=[create_async_engine(os.environ[n].replace('postgresql://','postgresql+psycopg://')) for n in names]
    runtime,admin,dispatch=engines
    async with admin.begin() as db:
        await db.execute(text("INSERT INTO users(id,username_normalized,display_name,password_hash) VALUES(:id,:name,'合成索引','synthetic')"),dict(id=actor.user_id,name='idx_'+uuid4().hex))
        await db.execute(text("INSERT INTO auth_sessions(id,user_id,token_hash,csrf_hash,expires_at,last_seen_at) VALUES(:id,:owner,:token,:csrf,now()+interval '1 day',now())"),dict(id=actor.session_id,owner=actor.user_id,token=uuid4().hex,csrf=uuid4().hex))
    svc.repository=IndexRepository(async_sessionmaker(runtime,expire_on_commit=False),async_sessionmaker(dispatch,expire_on_commit=False))
    yield svc,actor,doc,admin
    async with admin.begin() as db:
        await db.execute(text('UPDATE document_versions SET active_index_id=NULL WHERE owner_id=:owner'),dict(owner=actor.user_id))
        for table in ('embedding_calls','chunk_embeddings','chunk_segments','document_chunks','index_jobs','document_indexes','document_segments','document_versions','documents','consents'):
            await db.execute(text('DELETE FROM '+table+' WHERE owner_id=:owner'),dict(owner=actor.user_id))
        await db.execute(text('DELETE FROM auth_sessions WHERE user_id=:owner'),dict(owner=actor.user_id))
        await db.execute(text('DELETE FROM users WHERE id=:owner'),dict(owner=actor.user_id))
    for engine in engines: await engine.dispose()

async def create_job(svc,actor,doc,key='key'):
    from fileaction.indexing.dto import IndexPreviewRequest
    p=await svc.preview(actor,doc['id'],IndexPreviewRequest(expected_revision=doc['revision'],document_version_id=doc['current_version_id']))
    body=dict(preview_id=p['preview_id'],manifest_hash=p['manifest_hash'],expected_revision=doc['revision'],consent_to_embed=True)
    return await svc.create(actor,doc['id'],key,body),body

@pytest.mark.asyncio
async def test_job_independent_snapshot_and_idempotency(setup):
    from fileaction.indexing.service import IndexingError
    svc,actor,doc,admin=setup
    job,body=await create_job(svc,actor,doc)
    await svc.temporary.delete(actor,'preview',body['preview_id'])
    assert (await svc.create(actor,doc['id'],'key',body))['id']==job['id']
    with pytest.raises(IndexingError,match='IDEMPOTENCY_CONFLICT'):
        await svc.create(actor,doc['id'],'key',{**body,'expected_revision':2})
    with pytest.raises(IndexingError,match='RESOURCE_NOT_FOUND'):
        await svc.get(ActorContext(actor.user_id,uuid4()),job['id'])
    snapshot=await svc.snapshot(actor,job['id'])
    assert snapshot['manifest']['chunks'][0]['text']=='允许索引。未授权尾段。'
    async with admin.connect() as db:
        row=(await db.execute(text('SELECT row_to_json(index_jobs) FROM index_jobs WHERE id=:id'),dict(id=job['id']))).scalar_one()
        assert '允许索引' not in json.dumps(row,ensure_ascii=False)
        assert await db.scalar(text('SELECT count(*) FROM document_chunks WHERE owner_id=:owner'),dict(owner=actor.user_id))==0

def gateway(svc,handler=None):
    from fileaction.indexing.embedding import EmbeddingGateway
    async def default(request):
        payload=json.loads(request.content)
        return httpx.Response(200,json=dict(data=[dict(index=i,embedding=[1.0]+[0.0]*767) for i in range(len(payload['input']))]))
    return EmbeddingGateway(svc.profile,transport=httpx.MockTransport(handler or default))

@pytest.mark.asyncio
async def test_worker_ready_only_after_success_and_delete(setup):
    from fileaction.workers.indexing import IndexingWorker
    svc,actor,doc,_=setup
    job,_=await create_job(svc,actor,doc)
    await IndexingWorker(svc,gateway(svc)).tick()
    status=await svc.get(actor,job['id'])
    assert status['status']=='succeeded' and status['completed_chunks']==1
    chunks=await svc.active_chunks(actor,doc['id'])
    assert len(chunks)==1 and len(chunks[0].vector)==768
    await svc.delete_indexes(actor,doc['id'],1,True)
    assert await svc.active_chunks(actor,doc['id'])==[]
    assert (await svc.documents.segments(actor,doc['id']))[0]['text']=='允许索引。未授权尾段。'

@pytest.mark.asyncio
async def test_cancel_during_embedding_blocks_late_response(setup):
    from fileaction.workers.indexing import IndexingWorker
    svc,actor,doc,_=setup
    job,_=await create_job(svc,actor,doc)
    async def response(request):
        await svc.cancel(actor,job['id'],True)
        return httpx.Response(200,json=dict(data=[dict(index=0,embedding=[1.0]+[0.0]*767)]))
    await IndexingWorker(svc,gateway(svc,response)).tick()
    assert (await svc.get(actor,job['id']))['status']=='cancelled'
    assert await svc.active_chunks(actor,doc['id'])==[]

@pytest.mark.asyncio
async def test_sent_crash_interrupted_never_requeued(setup):
    svc,actor,doc,admin=setup
    job,_=await create_job(svc,actor,doc)
    claimed=await svc.repository.claim('synthetic-crash')
    await svc.repository.begin_call(actor,job['id'],'synthetic-crash',claimed['lease_epoch'],0,'synthetic-hash')
    async with admin.begin() as db:
        await db.execute(text("UPDATE index_jobs SET lease_until=now()-interval '1 second' WHERE id=:id"),dict(id=job['id']))
    await svc.repository.recover()
    assert (await svc.get(actor,job['id']))['status']=='interrupted'
    assert await svc.repository.claim('another') is None

@pytest.mark.asyncio
async def test_competing_workers_claim_once_and_account_limit(setup):
    from fileaction.indexing.service import IndexingError
    svc,actor,doc,_=setup
    job,_=await create_job(svc,actor,doc)
    with pytest.raises(IndexingError,match='INDEX_LIMIT_EXCEEDED'):
        await create_job(svc,actor,doc,'other')
    results=await asyncio.gather(svc.repository.claim('one'),svc.repository.claim('two'))
    assert sum(result is not None for result in results)==1

@pytest.mark.asyncio
async def test_temporary_capacity_reserved_before_queue(setup):
    from fileaction.storage_adapters.temporary import TemporaryError
    svc,actor,doc,admin=setup
    svc.temporary.max_derived_bytes=4000
    with pytest.raises(TemporaryError,match='QUOTA_EXCEEDED'):
        await create_job(svc,actor,doc)
    async with admin.connect() as db:
        assert await db.scalar(text('SELECT count(*) FROM index_jobs WHERE owner_id=:owner'),dict(owner=actor.user_id))==0

async def retained_doc(svc,actor,admin):
    from fileaction.documents.repository import DocumentRepository
    identifier,version,segment1,segment2=[uuid4() for _ in range(4)]
    async with admin.begin() as db:
        await db.execute(text("INSERT INTO embedding_profiles(id,provider_alias,model,dimensions,distance_metric,config_revision,active) SELECT :id,'synthetic.invalid','synthetic',768,'cosine',1,true WHERE NOT EXISTS(SELECT 1 FROM embedding_profiles WHERE active)"),dict(id=uuid4()))
        await db.execute(text("INSERT INTO documents(id,owner_id,name,parse_status) VALUES(:id,:owner,'合成长期通知','ready')"),dict(id=identifier,owner=actor.user_id))
        await db.execute(text("INSERT INTO document_versions(id,owner_id,document_id,version,sha256,size_bytes,blob_key) VALUES(:id,:owner,:doc,1,:hash,10,'synthetic/no-external-upload')"),dict(id=version,owner=actor.user_id,doc=identifier,hash='0'*64))
        for ordinal,sid in enumerate((segment1,segment2)):
            await db.execute(text("INSERT INTO document_segments(id,owner_id,document_version_id,ordinal,locator_json,text,text_hash,char_count) VALUES(:id,:owner,:version,:ordinal,CAST(:locator AS jsonb),:body,:hash,:chars)"),dict(id=sid,owner=actor.user_id,version=version,ordinal=ordinal,locator=json.dumps({'label':'合成段'+str(ordinal)}),body='允许申请。' if ordinal==0 else '禁止披露。',hash='1'*64,chars=5))
    svc.documents.repository=DocumentRepository(svc.repository.factory)
    return await svc.documents.get(actor,str(identifier)),(str(segment1),str(segment2))

@pytest.mark.asyncio
async def test_long_term_sql_filters_all_spans_before_recall(setup):
    from fileaction.workers.indexing import IndexingWorker
    from fileaction.retrieval.provider import RetrievalProvider
    from fileaction.retrieval.core import Scope
    from fileaction.indexing.embedding import profile_hash
    svc,actor,_,admin=setup
    doc,segments=await retained_doc(svc,actor,admin)
    job,_=await create_job(svc,actor,doc)
    await IndexingWorker(svc,gateway(svc)).tick()
    assert (await svc.get(actor,job['id']))['status']=='succeeded'
    provider=RetrievalProvider(svc)
    metadata=await provider.active_indexes(actor,[doc['id']])
    assert len(metadata)==1 and len(metadata[0]['chunks'][0]['spans'])==2
    scope=Scope(str(actor.user_id),str(actor.session_id),frozenset([doc['current_version_id']]),frozenset(segments),frozenset([job['index_id']]),profile_hash(svc.profile))
    result=await provider.search(actor,'申请',scope,query_vector=(1.,)+(0.,)*767)
    assert len(result.chunk_ids)==1 and len(result.evidence)==2
    narrowed=replace(scope,segment_ids=frozenset([segments[0]]))
    assert (await provider.search(actor,'申请',narrowed,query_vector=(1.,)+(0.,)*767)).chunk_ids==()
    ranged=replace(scope,authorized_ranges=((segments[0],0,5),(segments[1],0,2)))
    assert (await provider.search(actor,'申请',ranged,query_vector=(1.,)+(0.,)*767)).chunk_ids==()
    with pytest.raises(ValueError,match='SCOPE_INVALID'):
        await provider.search(ActorContext(uuid4(),uuid4()),'申请',scope,query_vector=(1.,)+(0.,)*767)
    async with admin.begin() as db:
        await db.execute(text("UPDATE document_indexes SET status='stale' WHERE id=:id"),dict(id=job['index_id']))
    assert await provider.active_indexes(actor,[doc['id']])==[]
    assert (await provider.search(actor,'申请',scope,query_vector=(1.,)+(0.,)*767)).chunk_ids==()

@pytest.mark.asyncio
async def test_readiness_accepts_indexing_migration(setup):
    from fileaction.api.readiness import ReadinessProbes
    from fileaction.core.config import Settings
    assert await ReadinessProbes().database(Settings(database_url=os.environ['FILEACTION_TEST_DATABASE_URL']))

@pytest.mark.asyncio
async def test_mixed_retention_returns_only_twelve_selected_chunks(setup):
    from fileaction.workers.indexing import IndexingWorker
    from fileaction.retrieval.provider import RetrievalProvider
    from fileaction.retrieval.core import Scope
    from fileaction.indexing.embedding import profile_hash
    svc,actor,temp,admin=setup
    resource=await svc.temporary.get(actor,'document',temp['id'])
    value=dict(resource.value)
    value['segments']=[dict(id=str(uuid4()),text='申请'+str(i)+'。'+'synthetic '*76,location='合成段'+str(i)) for i in range(16)]
    await svc.temporary.replace(actor,'document',temp['id'],value,expected_revision=resource.revision)
    await create_job(svc,actor,temp)
    await IndexingWorker(svc,gateway(svc)).tick()
    retained,_=await retained_doc(svc,actor,admin)
    await create_job(svc,actor,retained,'retained')
    await IndexingWorker(svc,gateway(svc)).tick()
    provider=RetrievalProvider(svc)
    metadata=await provider.active_indexes(actor,[temp['id'],retained['id']])
    versions=frozenset(m['document_version_id'] for m in metadata)
    chunks={c['id']:c for m in metadata for c in m['chunks']}
    scope=Scope(str(actor.user_id),str(actor.session_id),versions,frozenset(s['segment_id'] for c in chunks.values() for s in c['spans']),frozenset(m['index_id'] for m in metadata),profile_hash(svc.profile))
    result=await provider.search(actor,'申请',scope,query_vector=(1.,)+(0.,)*767,max_input_units=16000)
    assert len(result.chunk_ids)<=12
    selected_segments={s['segment_id'] for cid in result.chunk_ids for s in chunks[cid]['spans']}
    assert {s.segment_id for s in result.evidence}<=selected_segments

@pytest.mark.asyncio
async def test_retry_reuses_only_confirmed_same_profile_blocks(setup):
    from fileaction.workers.indexing import IndexingWorker
    from fileaction.indexing.dto import IndexPreviewRequest
    svc,actor,doc,_=setup
    resource=await svc.temporary.get(actor,'document',doc['id'])
    value=dict(resource.value)
    value['segments'][0]['text']='合成材料。'*300
    await svc.temporary.replace(actor,'document',doc['id'],value,expected_revision=resource.revision)
    svc.profile=replace(svc.profile,max_batch_items=1)
    first,_=await create_job(svc,actor,doc)
    calls=[]
    async def partial(request):
        calls.append(request)
        if len(calls)==2: return httpx.Response(503)
        return httpx.Response(200,json=dict(data=[dict(index=0,embedding=[1.0]+[0.0]*767)]))
    await IndexingWorker(svc,gateway(svc,partial)).tick()
    assert (await svc.get(actor,first['id']))['status']=='interrupted'
    p=await svc.preview(actor,doc['id'],IndexPreviewRequest(expected_revision=1,document_version_id=doc['current_version_id']))
    retry=await svc.create(actor,doc['id'],'retry',dict(preview_id=p['preview_id'],manifest_hash=p['manifest_hash'],expected_revision=1,consent_to_embed=True,retry_job_id=first['id'],accept_possible_duplicate_cost=True))
    resumed=[]
    async def complete(request):
        resumed.append(request)
        return httpx.Response(200,json=dict(data=[dict(index=0,embedding=[1.0]+[0.0]*767)]))
    await IndexingWorker(svc,gateway(svc,complete)).tick()
    assert (await svc.get(actor,retry['id']))['status']=='succeeded'
    assert len(resumed)==len(p['batches'])-1

@pytest.mark.asyncio
async def test_rls_aggregates_exclude_other_owner_reservations(setup):
    from fileaction.db.session import tenant_transaction
    svc,actor,doc,admin=setup
    retained,_=await retained_doc(svc,actor,admin)
    job,_=await create_job(svc,actor,retained)
    stranger=ActorContext(uuid4(),uuid4())
    async with tenant_transaction(svc.repository.factory,actor) as db:
        assert await db.scalar(text("SELECT count(*) FROM index_jobs WHERE status IN ('queued','running')"))==1
        assert await db.scalar(text('SELECT sum(reserved_chunks) FROM index_jobs WHERE document_version_id IS NOT NULL'))==1
        assert await db.scalar(text('SELECT current_user'))=='fileaction_app'
    async with tenant_transaction(svc.repository.factory,stranger) as db:
        assert await db.scalar(text("SELECT count(*) FROM index_jobs WHERE status IN ('queued','running')"))==0
        assert await db.scalar(text('SELECT coalesce(sum(reserved_chunks),0) FROM index_jobs WHERE document_version_id IS NOT NULL'))==0

@pytest.mark.asyncio
async def test_delete_failure_is_pending_and_retry_cleans_exact_index(setup,monkeypatch):
    from fileaction.storage_adapters.temporary import TemporaryError
    svc,actor,doc,admin=setup
    job,_=await create_job(svc,actor,doc)
    original=svc.temporary.delete
    async def unavailable(actor,kind,identifier):
        if kind=='index': raise TemporaryError('DEPENDENCY_UNAVAILABLE')
        return await original(actor,kind,identifier)
    monkeypatch.setattr(svc.temporary,'delete',unavailable)
    result=await svc.delete_indexes(actor,doc['id'],1,True)
    assert result['status']=='cleanup_pending'
    assert (await svc.get(actor,job['id']))['error_code']=='INDEX_CLEANUP_PENDING'
    assert (await svc.temporary.get(actor,'index',job['index_id'])).value
    monkeypatch.setattr(svc.temporary,'delete',original)
    assert (await svc.delete_indexes(actor,doc['id'],1,True))['status']=='deleted'
    with pytest.raises(TemporaryError,match='TEMPORARY_CONTENT_EXPIRED'):
        await svc.temporary.get(actor,'index',job['index_id'])

@pytest.mark.asyncio
async def test_expired_success_get_and_idempotency_report_expiration(setup):
    from fileaction.workers.indexing import IndexingWorker
    svc,actor,doc,_=setup
    job,body=await create_job(svc,actor,doc)
    await IndexingWorker(svc,gateway(svc)).tick()
    await svc.temporary.delete(actor,'index',job['index_id'])
    result=await svc.create(actor,doc['id'],'key',body)
    assert result['status']=='failed' and result['error_code']=='TEMPORARY_CONTENT_EXPIRED'
    assert (await svc.get(actor,job['id']))['status']=='failed'

@pytest.mark.asyncio
async def test_second_idempotency_hit_after_concurrent_success_expired(setup,monkeypatch):
    from fileaction.workers.indexing import IndexingWorker
    from fileaction.indexing.dto import IndexPreviewRequest
    svc,actor,doc,_=setup
    preview=await svc.preview(actor,doc['id'],IndexPreviewRequest(expected_revision=1,document_version_id=doc['current_version_id']))
    body=dict(preview_id=preview['preview_id'],manifest_hash=preview['manifest_hash'],expected_revision=1,consent_to_embed=True)
    checked=asyncio.Event(); resume=asyncio.Event()
    original=svc.repository.prior
    async def interleaved(db,actor,key,fingerprint):
        row=await original(db,actor,key,fingerprint)
        if asyncio.current_task().get_name()=='delayed-index-create' and not checked.is_set():
            checked.set()
            await resume.wait()
        return row
    monkeypatch.setattr(svc.repository,'prior',interleaved)
    delayed=asyncio.create_task(svc.create(actor,doc['id'],'concurrent',body),name='delayed-index-create')
    try:
        await asyncio.wait_for(checked.wait(),5)
        job=await svc.create(actor,doc['id'],'concurrent',body)
        await IndexingWorker(svc,gateway(svc)).tick()
        await svc.temporary.delete(actor,'index',job['index_id'])
        resume.set()
        result=await asyncio.wait_for(delayed,5)
        assert result['id']==job['id']
        assert result['status']=='failed'
        assert result['error_code']=='TEMPORARY_CONTENT_EXPIRED'
    finally:
        resume.set()
        if not delayed.done(): delayed.cancel()
        await asyncio.gather(delayed,return_exceptions=True)

@pytest.mark.asyncio
async def test_multiple_active_profiles_rejected_in_one_transaction(setup):
    from fileaction.indexing.service import IndexingError
    from sqlalchemy.ext.asyncio import AsyncSession
    svc,actor,doc,admin=setup
    await retained_doc(svc,actor,admin)
    # Roll back the extra synthetic global profile, even on failed assertion.
    async with admin.connect() as connection:
        transaction=await connection.begin()
        try:
            await connection.execute(text("INSERT INTO embedding_profiles(id,provider_alias,model,dimensions,distance_metric,config_revision,active) VALUES(:id,:alias,'synthetic',768,'cosine',1,true)"),dict(id=uuid4(),alias='synthetic-'+uuid4().hex))
            async with AsyncSession(bind=connection) as db:
                with pytest.raises(IndexingError,match='EMBEDDING_PROFILE_MISMATCH'):
                    await svc.repository.configured_profile(db,dict(model='synthetic',dimensions=768,profile_version='1'))
        finally:
            await transaction.rollback()
@pytest.mark.asyncio
async def test_profile_changed_gateway_never_sends(setup):
    from fileaction.workers.indexing import IndexingWorker
    from fileaction.indexing.embedding import EmbeddingGateway
    svc,actor,doc,_=setup
    job,_=await create_job(svc,actor,doc)
    sent=[]
    async def wrong(request):
        sent.append(request)
        return httpx.Response(200,json=dict(data=[dict(index=0,embedding=[1.0]+[0.0]*767)]))
    changed=EmbeddingGateway(replace(svc.profile,model='wrong-model'),transport=httpx.MockTransport(wrong))
    await IndexingWorker(svc,changed).tick()
    assert sent==[]
    assert (await svc.get(actor,job['id']))['status']=='failed'

@pytest.mark.asyncio
async def test_failed_temporary_job_releases_unused_reservation(setup):
    from fileaction.workers.indexing import IndexingWorker
    svc,actor,doc,_=setup
    job,_=await create_job(svc,actor,doc)
    async def fail(request): return httpx.Response(503)
    await IndexingWorker(svc,gateway(svc,fail)).tick()
    resource=await svc.temporary.get(actor,'index',job['index_id'])
    assert resource.value['reservation']==''
    assert not resource.value.get('ready')

@pytest.mark.asyncio
async def test_revoked_session_during_call_no_publish(setup):
    from fileaction.workers.indexing import IndexingWorker
    svc,actor,doc,admin=setup
    job,_=await create_job(svc,actor,doc)
    async def revoke(request):
        async with admin.begin() as db:
            await db.execute(text('UPDATE auth_sessions SET revoked_at=now() WHERE id=:id'),dict(id=actor.session_id))
        return httpx.Response(200,json=dict(data=[dict(index=0,embedding=[1.0]+[0.0]*767)]))
    await IndexingWorker(svc,gateway(svc,revoke)).tick()
    async with admin.connect() as db:
        assert await db.scalar(text('SELECT status FROM index_jobs WHERE id=:id'),dict(id=job['id']))!='succeeded'
    assert not (await svc.temporary.get(actor,'index',job['index_id'])).value['ready']

@pytest.mark.asyncio
async def test_received_crash_resumes_without_another_external_call(setup):
    from fileaction.workers.indexing import IndexingWorker
    svc,actor,doc,admin=setup
    job,_=await create_job(svc,actor,doc)
    claimed=await svc.repository.claim('received-crash')
    await svc.repository.begin_call(actor,job['id'],'received-crash',claimed['lease_epoch'],0,'synthetic')
    await svc.received(actor,job['id'],'received-crash',claimed['lease_epoch'],0,[(1.,)+(0.,)*767],None)
    async with admin.begin() as db:
        await db.execute(text("UPDATE index_jobs SET lease_until=now()-interval '1 second' WHERE id=:id"),dict(id=job['id']))
    await svc.repository.recover()
    assert (await svc.get(actor,job['id']))['status']=='queued'
    calls=[]
    async def forbidden(request): calls.append(request); return httpx.Response(503)
    await IndexingWorker(svc,gateway(svc,forbidden)).tick()
    assert calls==[]
    assert (await svc.get(actor,job['id']))['status']=='succeeded'

@pytest.mark.asyncio
async def test_queue_expired_before_first_send(setup):
    from fileaction.workers.indexing import IndexingWorker
    svc,actor,doc,admin=setup
    job,_=await create_job(svc,actor,doc)
    async with admin.begin() as db:
        await db.execute(text("UPDATE index_jobs SET created_at=now()-interval '301 seconds' WHERE id=:id"),dict(id=job['id']))
    calls=[]
    async def forbidden(request): calls.append(request); return httpx.Response(503)
    await IndexingWorker(svc,gateway(svc,forbidden)).tick()
    assert not calls
    assert (await svc.get(actor,job['id']))['error_code']=='QUEUE_TIMEOUT'

@pytest.mark.asyncio
async def test_global_two_worker_limit_across_three_accounts(setup):
    svc,actor,doc,admin=setup
    await create_job(svc,actor,doc)
    other=[]
    try:
        for number in range(2):
            new=ActorContext(uuid4(),uuid4()); other.append(new)
            async with admin.begin() as db:
                await db.execute(text("INSERT INTO users(id,username_normalized,display_name,password_hash) VALUES(:id,:name,'合成并发','synthetic')"),dict(id=new.user_id,name='index_parallel_'+uuid4().hex))
                await db.execute(text("INSERT INTO auth_sessions(id,user_id,token_hash,csrf_hash,expires_at,last_seen_at) VALUES(:id,:owner,:token,:csrf,now()+interval '1 day',now())"),dict(id=new.session_id,owner=new.user_id,token=uuid4().hex,csrf=uuid4().hex))
            uploaded=await svc.documents.upload(new,'合成.txt','合成并发通知'.encode(),retention='temporary',consent_to_store=False,storage_notice_version='')
            await create_job(svc,new,uploaded)
        results=await asyncio.gather(*(svc.repository.claim('global-'+str(i)) for i in range(3)))
        assert sum(r is not None for r in results)==2
        assert len({r['owner_id'] for r in results if r})==2
    finally:
        for new in other:
            await svc.temporary.end_session(new)
            await svc.temporary.redis.delete(svc.temporary.session_key(new))
            async with admin.begin() as db:
                for table in ('embedding_calls','index_jobs','consents'):
                    await db.execute(text('DELETE FROM '+table+' WHERE owner_id=:owner'),dict(owner=new.user_id))
                await db.execute(text('DELETE FROM auth_sessions WHERE user_id=:owner'),dict(owner=new.user_id))
                await db.execute(text('DELETE FROM users WHERE id=:owner'),dict(owner=new.user_id))

@pytest.mark.asyncio
async def test_temporary_retrieval_does_not_read_unselected_documents(setup,monkeypatch):
    from fileaction.workers.indexing import IndexingWorker
    from fileaction.retrieval.provider import RetrievalProvider
    from fileaction.retrieval.core import Scope
    from fileaction.indexing.embedding import profile_hash
    svc,actor,doc,_=setup
    job,_=await create_job(svc,actor,doc)
    await IndexingWorker(svc,gateway(svc)).tick()
    unrelated=await svc.documents.upload(actor,'未选合成.txt','没有授权读取的合成资料'.encode(),retention='temporary',consent_to_store=False,storage_notice_version='')
    reads=[]
    original=svc.temporary.get
    async def observed(actor,kind,identifier):
        if kind=='document': reads.append(identifier)
        return await original(actor,kind,identifier)
    monkeypatch.setattr(svc.temporary,'get',observed)
    segment=(await svc.documents.segments(actor,doc['id']))[0]
    scope=Scope(str(actor.user_id),str(actor.session_id),frozenset([doc['current_version_id']]),frozenset([segment['id']]),frozenset([job['index_id']]),profile_hash(svc.profile))
    assert (await RetrievalProvider(svc).search(actor,'申请',scope,query_vector=(1.,)+(0.,)*767)).chunk_ids
    assert unrelated['id'] not in reads

@pytest.mark.asyncio
async def test_new_temporary_index_expiry_never_reactivates_old_index(setup):
    from fileaction.workers.indexing import IndexingWorker
    svc,actor,doc,_=setup
    old,_=await create_job(svc,actor,doc)
    await IndexingWorker(svc,gateway(svc)).tick()
    new,_=await create_job(svc,actor,doc,'new-index')
    await IndexingWorker(svc,gateway(svc)).tick()
    assert (await svc.active_chunks(actor,doc['id']))[0].index_id==new['index_id']
    await svc.temporary.delete(actor,'index',new['index_id'])
    assert await svc.active_chunks(actor,doc['id'])==[]
    assert (await svc.get(actor,old['id']))['status']=='stale'

@pytest.mark.asyncio
async def test_retained_index_delete_clears_vectors_and_snapshot_but_not_original(setup):
    from fileaction.workers.indexing import IndexingWorker
    svc,actor,_,admin=setup
    doc,_=await retained_doc(svc,actor,admin)
    job,_=await create_job(svc,actor,doc)
    await IndexingWorker(svc,gateway(svc)).tick()
    await svc.delete_indexes(actor,doc['id'],1,True)
    async with admin.connect() as db:
        for table in ('document_chunks','chunk_segments','chunk_embeddings'):
            assert await db.scalar(text('SELECT count(*) FROM '+table+' WHERE owner_id=:owner'),dict(owner=actor.user_id))==0
        header=await db.scalar(text('SELECT manifest_json FROM index_jobs WHERE id=:id'),dict(id=job['id']))
        assert '允许申请' not in json.dumps(header,ensure_ascii=False)
        assert 'responses' not in header
    assert (await svc.documents.segments(actor,doc['id']))[0]['text']=='允许申请。'

@pytest.mark.asyncio
async def test_retry_never_reuses_response_without_received_ledger(setup):
    from fileaction.workers.indexing import IndexingWorker
    from fileaction.indexing.dto import IndexPreviewRequest
    svc,actor,doc,admin=setup
    job,_=await create_job(svc,actor,doc)
    claim=await svc.repository.claim('redis-before-pg-crash')
    await svc.repository.begin_call(actor,job['id'],'redis-before-pg-crash',claim['lease_epoch'],0,'uncertain')
    resource=await svc.temporary.get(actor,'index',job['index_id'])
    batch=resource.value['manifest']['batches'][0]
    responses={'0':{batch[0]:[1.]+[0.]*767}}
    await svc.temporary.replace(actor,'index',job['index_id'],dict(resource.value,responses=responses),expected_revision=resource.revision)
    async with admin.begin() as db:
        await db.execute(text("UPDATE index_jobs SET lease_until=now()-interval '1 second' WHERE id=:id"),dict(id=job['id']))
    await svc.recover()
    p=await svc.preview(actor,doc['id'],IndexPreviewRequest(expected_revision=1,document_version_id=doc['current_version_id']))
    retry=await svc.create(actor,doc['id'],'retry-uncertain',dict(preview_id=p['preview_id'],manifest_hash=p['manifest_hash'],expected_revision=1,consent_to_embed=True,retry_job_id=job['id'],accept_possible_duplicate_cost=True))
    calls=[]
    async def response(request):
        calls.append(request)
        return httpx.Response(200,json=dict(data=[dict(index=0,embedding=[1.]+[0.]*767)]))
    await IndexingWorker(svc,gateway(svc,response)).tick()
    assert len(calls)==1
    assert (await svc.get(actor,retry['id']))['status']=='succeeded'
