"""真实合成PG/Redis；生成仅由明确HTTP MockTransport提供。"""
import asyncio
import json
import os
from uuid import uuid4
import httpx
import pytest
import pytest_asyncio
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine,async_sessionmaker
from redis.asyncio import Redis
from fileaction.core.config import Settings
from fileaction.db.session import ActorContext,tenant_transaction
from fileaction.documents.service import DocumentService
from fileaction.storage_adapters.temporary import TemporaryStore
from fileaction.workspaces.service import WorkspaceService
from fileaction.workspaces.dto import PreviewRequest

@pytest_asyncio.fixture
async def setup():
    from fileaction.runs.service import RunService
    from fileaction.runs.repository import RunRepository
    names=['FILEACTION_TEST_DATABASE_URL','FILEACTION_TEST_ADMIN_DATABASE_URL','FILEACTION_TEST_DISPATCHER_DATABASE_URL','FILEACTION_TEST_REDIS_URL']
    if not all(os.getenv(n) for n in names): pytest.skip('需显式合成PG/Redis连接')
    def engine(url): return create_async_engine(url.replace('postgresql://','postgresql+psycopg://'))
    admin=engine(os.environ[names[1]]); runtime=engine(os.environ[names[0]]); dispatch=engine(os.environ[names[2]])
    actor=ActorContext(uuid4(),uuid4())
    async with admin.begin() as db:
        await db.execute(text("INSERT INTO users(id,username_normalized,display_name,password_hash) VALUES(:id,:name,'合成测试','synthetic')"),dict(id=actor.user_id,name='run_'+uuid4().hex))
        await db.execute(text("INSERT INTO auth_sessions(id,user_id,token_hash,csrf_hash,expires_at,last_seen_at) VALUES(:id,:owner,:token,:csrf,now()+interval '1 day',now())"),dict(id=actor.session_id,owner=actor.user_id,token=uuid4().hex,csrf=uuid4().hex))
    redis=Redis.from_url(os.environ[names[3]],decode_responses=True)
    store=TemporaryStore(redis); docs=DocumentService(store)
    settings=Settings(model_base_url='https://synthetic.invalid/v1',model_name='synthetic',model_api_key='synthetic')
    workspaces=WorkspaceService(store,docs,settings)
    repo=RunRepository(async_sessionmaker(runtime,expire_on_commit=False),async_sessionmaker(dispatch,expire_on_commit=False))
    service=RunService(workspaces,repo)
    doc=await docs.upload(actor,'合成通知.txt','允许申请，资格未知。'.encode(),retention='temporary',consent_to_store=False,storage_notice_version='')
    workspace=await workspaces.create(actor,primary_document_id=doc['id'])
    preview=await workspaces.preview(actor,workspace['id'],PreviewRequest(expected_revision=1))
    body=dict(preview_id=preview['preview_id'],manifest_hash=preview['manifest_hash'],expected_revision=1,consent_to_send=True)
    yield service,actor,workspace,body,admin
    await store.end_session(actor); await redis.delete(store.session_key(actor)); await redis.aclose()
    async with admin.begin() as db:
        for table in ('model_calls','run_events','run_manifests','run_documents','run_facts','run_retrievals','runs','consents'):
            await db.execute(text('DELETE FROM '+table+' WHERE owner_id=:owner'),dict(owner=actor.user_id))
        await db.execute(text('DELETE FROM auth_sessions WHERE user_id=:owner'),dict(owner=actor.user_id))
        await db.execute(text('DELETE FROM users WHERE id=:owner'),dict(owner=actor.user_id))
    for item in (admin,runtime,dispatch): await item.dispose()

@pytest.mark.asyncio
async def test_consent_idempotency_private_snapshot_and_conflict(setup):
    from fileaction.runs.service import RunError
    svc,actor,ws,body,admin=setup
    with pytest.raises(RunError,match='CONSENT_REQUIRED'): await svc.create(actor,ws['id'],'key',{**body,'consent_to_send':False})
    first=await svc.create(actor,ws['id'],'key',body)
    await svc.workspaces.temporary.delete(actor,'preview',body['preview_id'])
    assert (await svc.create(actor,ws['id'],'key',body))['id']==first['id']
    with pytest.raises(RunError,match='IDEMPOTENCY_CONFLICT'): await svc.create(actor,ws['id'],'key',{**body,'expected_revision':2})
    second_session=uuid4()
    async with admin.begin() as db:
        await db.execute(text("INSERT INTO auth_sessions(id,user_id,token_hash,csrf_hash,expires_at,last_seen_at) VALUES(:id,:owner,:token,:csrf,now()+interval '1 day',now())"),dict(id=second_session,owner=actor.user_id,token=uuid4().hex,csrf=uuid4().hex))
    with pytest.raises(RunError,match='RESOURCE_NOT_FOUND'): await svc.get(ActorContext(actor.user_id,second_session),first['id'])
    snapshot=await svc.content.get(actor,first['id'])
    assert snapshot.value['manifest']['documents'][0]['segments'][0]['text']=='允许申请，资格未知。'

@pytest.mark.asyncio
async def test_real_claim_worker_result_and_cancelled_no_commit(setup):
    from fileaction.workers.generation import GenerationWorker
    from fileaction.agent.gateway import JsonGateway
    svc,actor,ws,body,_=setup
    run=await svc.create(actor,ws['id'],'key',body); calls=[]
    async def handler(request):
        calls.append(request)
        answer=dict(summary='合成模型回答',claims=[],questions=[],memory_candidates=[],action_candidates=[],unknowns=['资格待核实'],coverage='full_selected_text',artifact=None)
        return httpx.Response(200,json=dict(choices=[dict(finish_reason='stop',message=dict(content=json.dumps(answer)))]))
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        worker=GenerationWorker(svc,JsonGateway('https://synthetic.invalid/v1','synthetic','synthetic',client=client),worker_id='synthetic-'+uuid4().hex)
        await worker.tick()
    assert (await svc.get(actor,run['id']))['status']=='succeeded'
    assert (await svc.result(actor,run['id']))['envelope']['summary']=='合成模型回答'
    assert len(calls)==1
    assert (await svc.workspaces.get(actor,ws['id']))['revision']==1
    assert (await svc.workspaces.messages(actor,ws['id']))['items'][-1]['role']=='assistant'

@pytest.mark.asyncio
async def test_result_returns_only_frozen_authorized_context_without_changing_commit(setup):
    """合成答案直接走真实提交；恢复引用仅使用当时授权的片段、事实和历史。"""
    svc,actor,ws,_,_=setup
    ws=await svc.workspaces.fact(actor,ws['id'],1,text='合成已授权背景',confirmed=True)
    fact_id=ws['facts'][0]['id']
    ws=await svc.workspaces.fact(actor,ws['id'],2,text='合成未授权背景',confirmed=True)
    history=await svc.workspaces.append_message(actor,ws['id'],role='user',text='合成已授权历史',expected_sequence=0)
    segment=(await svc.workspaces.documents.segments(actor,ws['documents'][0]['id']))[0]
    preview=await svc.workspaces.preview(actor,ws['id'],PreviewRequest(
        expected_revision=3,fact_ids=[fact_id],history_message_ids=[history['id']],
        selections=[dict(document_version_id=ws['documents'][0]['current_version_id'],segment_id=segment['id'],char_start=0,char_end=5)],
    ))
    run=await svc.create(actor,ws['id'],'frozen-context',dict(preview_id=preview['preview_id'],manifest_hash=preview['manifest_hash'],expected_revision=3,consent_to_send=True))
    await svc.repository.claim('synthetic-context')
    answer=dict(summary='合成带原文引用答案',claims=[],questions=[],memory_candidates=[],action_candidates=[],unknowns=[],coverage='selected_excerpts',artifact=None)
    await svc.commit(actor,run['id'],'synthetic-context',answer)
    stored=(await svc.content.get(actor,run['id'])).value
    await svc.workspaces.append_message(actor,ws['id'],role='user',text='合成生成后新增历史',expected_sequence=2)

    result=await svc.result(actor,run['id'])

    assert result['context']==preview['manifest']
    assert result['context']['documents'][0]['segments'][0]['text']=='允许申请，'
    assert [fact['id'] for fact in result['context']['facts']]==[fact_id]
    assert [message['id'] for message in result['context']['history']]==[history['id']]
    assert '资格未知' not in json.dumps(result['context'],ensure_ascii=False)
    assert {key:value for key,value in result.items() if key!='context'}==stored['result']
    assert (await svc.content.get(actor,run['id'])).value==stored
    assert await svc.content.committed(actor,run['id'])==stored['result']

@pytest.mark.asyncio
async def test_result_context_is_private_to_original_user_and_session(setup):
    from fileaction.runs.service import RunError
    svc,actor,ws,body,admin=setup
    run=await svc.create(actor,ws['id'],'private-context',body)
    await svc.repository.claim('synthetic-private-context')
    answer=dict(summary='合成私有答案',claims=[],questions=[],memory_candidates=[],action_candidates=[],unknowns=[],coverage='full_selected_text',artifact=None)
    await svc.commit(actor,run['id'],'synthetic-private-context',answer)
    stranger=ActorContext(uuid4(),uuid4()); second_session=uuid4()
    try:
        async with admin.begin() as db:
            await db.execute(text("INSERT INTO users(id,username_normalized,display_name,password_hash) VALUES(:id,:name,'合成其他用户','synthetic')"),dict(id=stranger.user_id,name='private_'+uuid4().hex))
            for other in (stranger,ActorContext(actor.user_id,second_session)):
                await db.execute(text("INSERT INTO auth_sessions(id,user_id,token_hash,csrf_hash,expires_at,last_seen_at) VALUES(:id,:owner,:token,:csrf,now()+interval '1 day',now())"),dict(id=other.session_id,owner=other.user_id,token=uuid4().hex,csrf=uuid4().hex))
        for other in (stranger,ActorContext(actor.user_id,second_session)):
            with pytest.raises(RunError,match='RESOURCE_NOT_FOUND'):
                await svc.result(other,run['id'])
    finally:
        async with admin.begin() as db:
            await db.execute(text('DELETE FROM auth_sessions WHERE user_id=:owner'),dict(owner=stranger.user_id))
            await db.execute(text('DELETE FROM users WHERE id=:owner'),dict(owner=stranger.user_id))

@pytest.mark.asyncio
@pytest.mark.parametrize('invalidated',['expired_run','workspace_changed','fact_changed','source_deleted','revoked_session'])
async def test_invalidated_result_does_not_return_context(setup,invalidated):
    from fileaction.runs.service import RunError
    svc,actor,ws,_,admin=setup
    ws=await svc.workspaces.fact(actor,ws['id'],1,text='合成待变更背景',confirmed=True)
    fact_id=ws['facts'][0]['id']
    preview=await svc.workspaces.preview(actor,ws['id'],PreviewRequest(expected_revision=2,fact_ids=[fact_id]))
    run=await svc.create(actor,ws['id'],'invalidated-context',dict(preview_id=preview['preview_id'],manifest_hash=preview['manifest_hash'],expected_revision=2,consent_to_send=True))
    await svc.repository.claim('synthetic-invalidated-context')
    answer=dict(summary='合成即将失效答案',claims=[],questions=[],memory_candidates=[],action_candidates=[],unknowns=[],coverage='full_selected_text',artifact=None)
    await svc.commit(actor,run['id'],'synthetic-invalidated-context',answer)
    if invalidated=='expired_run':
        store=svc.workspaces.temporary
        await store.redis.hset(store._key(actor,'run',run['id']),'expires',0)
    elif invalidated=='workspace_changed':
        await svc.workspaces.patch(actor,ws['id'],2,goal='合成修改目标')
    elif invalidated=='fact_changed':
        await svc.workspaces.fact(actor,ws['id'],2,text='合成已变更背景',confirmed=True,fact_id=fact_id)
    elif invalidated=='source_deleted':
        await svc.workspaces.temporary.delete(actor,'document',ws['documents'][0]['id'])
    else:
        async with admin.begin() as db:
            await db.execute(text('UPDATE auth_sessions SET revoked_at=now() WHERE id=:id'),dict(id=actor.session_id))
    with pytest.raises(RunError,match='SESSION_REVOKED' if invalidated=='revoked_session' else 'RESULT_NOT_AVAILABLE'):
        await svc.result(actor,run['id'])

@pytest.mark.asyncio
async def test_sent_crash_recovery_never_resends(setup):
    svc,actor,ws,body,admin=setup
    run=await svc.create(actor,ws['id'],'key',body)
    claimed=await svc.repository.claim('synthetic-crash')
    assert str(claimed['id'])==run['id']
    await svc.repository.begin_call(actor,run['id'],'synthetic-crash',1,'fingerprint')
    async with admin.begin() as db:
        await db.execute(text("UPDATE runs SET lease_until=now()-interval '1 second' WHERE id=:id"),dict(id=run['id']))
    await svc.recover()
    status=await svc.get(actor,run['id'])
    assert status['status']=='interrupted' and status['error_code']=='MODEL_OUTCOME_UNKNOWN'

@pytest.mark.asyncio
async def test_cancel_and_old_revision_block_commit(setup):
    from fileaction.runs.service import RunError
    svc,actor,ws,body,_=setup
    run=await svc.create(actor,ws['id'],'key',body)
    await svc.repository.claim('synthetic-cancel')
    await svc.cancel(actor,run['id'])
    with pytest.raises(RunError): await svc.commit(actor,run['id'],'synthetic-cancel',{})
    assert (await svc.workspaces.messages(actor,ws['id']))['items']==[]

@pytest.mark.asyncio
async def test_single_workspace_and_account_limits(setup):
    from fileaction.runs.service import RunError
    svc,actor,ws,body,_=setup
    await svc.create(actor,ws['id'],'key',body)
    with pytest.raises(RunError,match='WORKSPACE_BUSY'): await svc.create(actor,ws['id'],'other',body)
    other=await svc.workspaces.create(actor)
    p=await svc.workspaces.preview(actor,other['id'],PreviewRequest(expected_revision=1))
    otherbody=dict(preview_id=p['preview_id'],manifest_hash=p['manifest_hash'],expected_revision=1,consent_to_send=True)
    await svc.create(actor,other['id'],'second',otherbody)
    third=await svc.workspaces.create(actor)
    p=await svc.workspaces.preview(actor,third['id'],PreviewRequest(expected_revision=1))
    with pytest.raises(RunError,match='ACCOUNT_RUN_LIMIT'): await svc.create(actor,third['id'],'third',{**otherbody,'preview_id':p['preview_id'],'manifest_hash':p['manifest_hash']})

@pytest.mark.asyncio
async def test_changed_revision_or_revoked_session_never_calls_model(setup):
    from fileaction.workers.generation import GenerationWorker
    svc,actor,ws,body,_=setup
    run=await svc.create(actor,ws['id'],'key',body)
    await svc.workspaces.patch(actor,ws['id'],1,goal='合成已修改目标')
    class ForbiddenGateway:
        async def generate(self,*args): raise AssertionError('不得调用模型')
    await GenerationWorker(svc,ForbiddenGateway()).tick()
    assert (await svc.get(actor,run['id']))['status']=='stale'

@pytest.mark.asyncio
async def test_racing_claims_only_one_winner_and_lease_renews(setup):
    svc,actor,ws,body,_=setup
    run=await svc.create(actor,ws['id'],'key',body)
    results=await asyncio.gather(*(svc.repository.claim('contender-'+str(i)) for i in range(5)))
    winners=[r for r in results if r and str(r['id'])==run['id']]
    assert len(winners)==1
    row,_=await svc.repository.get(actor,run['id'])
    before=row['lease_until']
    await svc.repository.renew(actor,run['id'],row['lease_owner'])
    assert (await svc.repository.get(actor,run['id']))[0]['lease_until']>=before

@pytest.mark.asyncio
async def test_commit_marker_recovers_without_duplicate_message(setup):
    svc,actor,ws,body,admin=setup
    run=await svc.create(actor,ws['id'],'key',body)
    await svc.repository.claim('synthetic-commit-crash')
    answer=dict(summary='合成已验证答案',claims=[],questions=[],memory_candidates=[],action_candidates=[],unknowns=[],coverage='full_selected_text',artifact=None)
    result=await svc.content.commit(actor,run['id'],answer)
    async with admin.begin() as db:
        await db.execute(text("UPDATE runs SET lease_until=now()-interval '1 second' WHERE id=:id"),dict(id=run['id']))
    await svc.recover()
    assert (await svc.result(actor,run['id']))['answer_id']==result['answer_id']
    assert len((await svc.workspaces.messages(actor,ws['id']))['items'])==1

@pytest.mark.asyncio
async def test_revoked_session_prevents_worker_and_commit(setup):
    from fileaction.workers.generation import GenerationWorker
    from fileaction.runs.service import RunError
    svc,actor,ws,body,admin=setup
    run=await svc.create(actor,ws['id'],'key',body)
    async with admin.begin() as db:
        await db.execute(text('UPDATE auth_sessions SET revoked_at=now() WHERE id=:id'),dict(id=actor.session_id))
    class ForbiddenGateway:
        async def generate(self,*args): raise AssertionError('撤销会话不得调用模型')
    await GenerationWorker(svc,ForbiddenGateway()).tick()
    with pytest.raises(RunError,match='SESSION_REVOKED'): await svc.get(actor,run['id'])
    async with admin.connect() as db:
        status=await db.scalar(text('SELECT status FROM runs WHERE id=:id'),dict(id=run['id']))
    assert status=='failed'

@pytest.mark.asyncio
async def test_global_four_running_limit_is_shared_by_dispatchers(setup):
    svc,actor,ws,body,admin=setup
    actors=[]; identifiers=[]
    try:
        async with admin.begin() as db:
            for i in range(5):
                owner=uuid4(); session=uuid4(); identifier=uuid4()
                actors.append(owner); identifiers.append(identifier)
                await db.execute(text("INSERT INTO users(id,username_normalized,display_name,password_hash) VALUES(:id,:name,'合成并发账号','synthetic')"),dict(id=owner,name='g_'+uuid4().hex))
                await db.execute(text("INSERT INTO auth_sessions(id,user_id,token_hash,csrf_hash,expires_at,last_seen_at) VALUES(:id,:owner,:token,:csrf,now()+interval '1 day',now())"),dict(id=session,owner=owner,token=uuid4().hex,csrf=uuid4().hex))
                await db.execute(text("INSERT INTO runs(id,owner_id,temporary_ref,auth_session_id,kind,status,manifest_hash,expected_revision,idempotency_key) VALUES(:id,:owner,:ref,:session,'interpret','queued',:hash,1,:key)"),dict(id=identifier,owner=owner,ref=str(uuid4()),session=session,hash='f'*64,key=uuid4().hex))
        claimed=await asyncio.gather(*(svc.repository.claim('global-'+str(i)) for i in range(8)))
        assert len([c for c in claimed if c])==4
        assert len({c['id'] for c in claimed if c})==4
        async with admin.connect() as db:
            assert await db.scalar(text("SELECT count(*) FROM runs WHERE id=ANY(:ids) AND status='running'"),dict(ids=identifiers))==4
    finally:
        async with admin.begin() as db:
            await db.execute(text('DELETE FROM runs WHERE id=ANY(:ids)'),dict(ids=identifiers))
            await db.execute(text('DELETE FROM auth_sessions WHERE user_id=ANY(:owners)'),dict(owners=actors))
            await db.execute(text('DELETE FROM users WHERE id=ANY(:owners)'),dict(owners=actors))

@pytest.mark.asyncio
async def test_run_api_real_auth_csrf_idempotency_cancel_and_sse(setup):
    from fileaction.api.application import create_app
    from fileaction.auth.security import sha256,csrf_for_session
    svc,actor,ws,body,admin=setup
    if not os.getenv('FILEACTION_TEST_AUTH_DATABASE_URL'): pytest.skip('需显式合成认证数据库')
    secret='synthetic-run-api-secret'; token=uuid4().hex
    async with admin.begin() as db:
        await db.execute(text('UPDATE auth_sessions SET token_hash=:hash WHERE id=:id'),dict(hash=sha256(token),id=actor.session_id))
    settings=Settings(environment='test',database_url=os.environ['FILEACTION_TEST_DATABASE_URL'],auth_database_url=os.environ['FILEACTION_TEST_AUTH_DATABASE_URL'],redis_url=os.environ['FILEACTION_TEST_REDIS_URL'],app_secret=secret,model_base_url='https://synthetic.invalid/v1',model_api_key='synthetic',model_name='synthetic')
    app=create_app(settings)
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),base_url='http://127.0.0.1',cookies={'fileaction_session':token}) as client:
            path='/api/v1/workspaces/'+ws['id']+'/runs'
            assert (await client.post(path,json=body)).status_code==403
            headers={'X-CSRF-Token':csrf_for_session(secret,token),'Idempotency-Key':'api-key'}
            response=await client.post(path,json={**body,'consent_to_send':False},headers=headers)
            assert response.status_code==422
            response=await client.post(path,json=body,headers=headers)
            assert response.status_code==202,response.text
            run=response.json()['data']
            assert run['status']=='queued'
            assert (await client.post(path,json=body,headers=headers)).json()['data']['id']==run['id']
            assert (await client.get('/api/v1/runs/'+run['id']+'/result')).status_code==409
            response=await client.post('/api/v1/runs/'+run['id']+'/cancel',headers=headers)
            assert response.json()['data']['status']=='cancelled'
            events=await client.get('/api/v1/runs/'+run['id']+'/events',headers={'Last-Event-ID':'1'})
            assert events.status_code==200 and 'event: cancelled' in events.text and 'id: 1\n' not in events.text
            assert '允许申请' not in events.text
    await app.state.redis.aclose()

@pytest.mark.asyncio
async def test_received_response_recovers_validation_without_second_http(setup):
    from fileaction.workers.generation import GenerationWorker
    from fileaction.agent.prompts import policy
    from fileaction.workspaces.service import content_hash
    svc,actor,ws,body,admin=setup
    run=await svc.create(actor,ws['id'],'received',body)
    await svc.repository.claim('before-crash')
    manifest=(await svc.content.get(actor,run['id'])).value['manifest']
    raw=dict(summary='合成可恢复答案',claims=[],questions=[],memory_candidates=[],action_candidates=[],unknowns=[],coverage='full_selected_text',artifact=None)
    fingerprint=content_hash([policy('generating'),{'context':manifest,'tool_results':[]}])
    await svc.repository.begin_call(actor,run['id'],'before-crash',1,fingerprint)
    await svc.content.response(actor,run['id'],1,raw)
    await svc.repository.received(actor,run['id'],'before-crash',1)
    async with admin.begin() as db:
        await db.execute(text("UPDATE runs SET lease_until=now()-interval '1 second' WHERE id=:id"),dict(id=run['id']))
    class ForbiddenGateway:
        async def generate(self,*args): raise AssertionError('received恢复不得重发HTTP')
    await GenerationWorker(svc,ForbiddenGateway()).tick()
    assert (await svc.result(actor,run['id']))['envelope']['summary']=='合成可恢复答案'

@pytest.mark.asyncio
async def test_deleted_source_invalidates_success_and_expired_sent_stays_unknown(setup):
    from fileaction.workers.generation import GenerationWorker
    svc,actor,ws,body,admin=setup
    run=await svc.create(actor,ws['id'],'source-delete',body)
    class SyntheticGateway:
        async def generate(self,*args): return dict(summary='合成答案',claims=[],questions=[],memory_candidates=[],action_candidates=[],unknowns=[],coverage='full_selected_text',artifact=None)
    await GenerationWorker(svc,SyntheticGateway()).tick()
    doc=ws['documents'][0]['id']
    await svc.workspaces.temporary.delete(actor,'document',doc)
    assert (await svc.get(actor,run['id']))['status']=='stale'

@pytest.mark.asyncio
async def test_expired_run_content_does_not_erase_uncertain_sent_cost(setup):
    svc,actor,ws,body,admin=setup
    run=await svc.create(actor,ws['id'],'expired-sent',body)
    await svc.repository.claim('sent-expired')
    await svc.repository.begin_call(actor,run['id'],'sent-expired',1,'fingerprint')
    await svc.workspaces.temporary.delete(actor,'run',run['id'])
    async with admin.begin() as db:
        await db.execute(text("UPDATE runs SET lease_until=now()-interval '1 second' WHERE id=:id"),dict(id=run['id']))
    await svc.recover()
    assert (await svc.get(actor,run['id']))['status']=='interrupted'

@pytest.mark.asyncio
@pytest.mark.parametrize('terminal',['cancelled','failed','succeeded'])
async def test_recovery_scan_cannot_overwrite_new_terminal_state(setup,monkeypatch,terminal):
    """真实PG/Redis：旧候选扫描后终态先提交，恢复不得复活或改写。"""
    from fileaction.runs.service import RunError
    svc,actor,ws,body,admin=setup
    run=await svc.create(actor,ws['id'],'terminal-race',body)
    await svc.repository.claim('terminal-race-worker')
    answer=dict(summary='合成Redis已提交但PG未完成答案',claims=[],questions=[],memory_candidates=[],action_candidates=[],unknowns=[],coverage='full_selected_text',artifact=None)
    await svc.content.commit(actor,run['id'],answer)
    async with admin.begin() as db:
        await db.execute(text("UPDATE runs SET lease_until=now()-interval '1 second' WHERE id=:id"),dict(id=run['id']))
    scan=svc.repository.recoverable
    final_row=None; final_events=None
    async def scan_then_finish():
        nonlocal final_row,final_events
        candidates=await scan()
        assert any(str(candidate['id'])==run['id'] for candidate in candidates)
        if terminal=='cancelled': await svc.cancel(actor,run['id'])
        else: await svc.repository.finish(actor,run['id'],terminal,'SYNTHETIC_FAILURE' if terminal=='failed' else None)
        final_row=(await svc.repository.get(actor,run['id']))[0]
        final_events=await svc.repository.events(actor,run['id'])
        return candidates
    monkeypatch.setattr(svc.repository,'recoverable',scan_then_finish)
    await svc.recover()
    actual=(await svc.repository.get(actor,run['id']))[0]
    assert actual==final_row
    assert await svc.repository.events(actor,run['id'])==final_events
    if terminal!='succeeded':
        with pytest.raises(RunError,match='RESULT_NOT_AVAILABLE'): await svc.result(actor,run['id'])
