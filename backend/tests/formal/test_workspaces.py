"""合成材料；真实隔离Redis，不调用模型。"""
import os
from dataclasses import replace
from uuid import uuid4
import pytest
import pytest_asyncio
from redis.asyncio import Redis
from fileaction.core.config import Settings
from fileaction.db.session import ActorContext
from fileaction.documents.service import DocumentService
from fileaction.storage_adapters.temporary import TemporaryStore

@pytest_asyncio.fixture
async def setup():
    from fileaction.workspaces.service import WorkspaceService
    url = os.getenv('FILEACTION_TEST_REDIS_URL')
    if not url:
        pytest.skip('需要显式合成Redis')
    redis = Redis.from_url(url, decode_responses=True)
    store = TemporaryStore(redis)
    actor = ActorContext(uuid4(), uuid4())
    docs = DocumentService(store)
    doc = await docs.upload(actor, '合成通知.txt', '允许片段。禁止外发尾段。'.encode(), retention='temporary', consent_to_store=False, storage_notice_version='')
    svc = WorkspaceService(store, docs, Settings(model_base_url='https://synthetic.invalid/v1', model_name='synthetic', model_api_key='synthetic'))
    yield svc, actor, doc
    await store.end_session(actor)
    await redis.delete(store.session_key(actor))
    await redis.aclose()

@pytest.mark.asyncio
async def test_create_is_private_and_revision_conflicts(setup):
    from fileaction.workspaces.service import WorkspaceError
    svc, actor, doc = setup
    ws = await svc.create(actor, primary_document_id=doc['id'])
    assert ws['title'] == doc['name'] and ws['revision'] == 1
    assert ws['documents'][0]['current_version_id'] == doc['current_version_id']
    for stranger in (ActorContext(uuid4(), uuid4()), ActorContext(actor.user_id, uuid4())):
        with pytest.raises(WorkspaceError, match='RESOURCE_NOT_FOUND'):
            await svc.get(stranger, ws['id'])
    changed = await svc.patch(actor, ws['id'], 1, goal='只理解')
    assert changed['revision'] == 2
    with pytest.raises(WorkspaceError, match='REVISION_CONFLICT'):
        await svc.patch(actor, ws['id'], 1, goal='过期修改')

@pytest.mark.asyncio
async def test_preview_binds_range_goal_model_and_hash(setup):
    from fileaction.workspaces.service import WorkspaceError
    from fileaction.workspaces.dto import PreviewRequest
    svc, actor, doc = setup
    ws = await svc.create(actor, primary_document_id=doc['id'])
    segment = (await svc.documents.segments(actor, doc['id']))[0]
    req = PreviewRequest(expected_revision=1, selections=[dict(document_version_id=doc['current_version_id'], segment_id=segment['id'], char_start=0, char_end=5)])
    preview = await svc.preview(actor, ws['id'], req)
    frozen = await svc.validate_preview(actor, ws['id'], preview['preview_id'], preview['manifest_hash'], 1)
    assert frozen['documents'][0]['segments'][0]['text'] == '允许片段。'
    assert '禁止外发' not in str(frozen)
    assert frozen['coverage'] == 'selected_excerpts'
    svc.settings = replace(svc.settings, model_name='changed')
    with pytest.raises(WorkspaceError, match='PREVIEW_STALE'):
        await svc.validate_preview(actor, ws['id'], preview['preview_id'], preview['manifest_hash'], 1)
    svc.settings = replace(svc.settings, model_name='synthetic')
    await svc.patch(actor, ws['id'], 1, goal='修改目标')
    with pytest.raises(WorkspaceError, match='REVISION_CONFLICT'):
        await svc.validate_preview(actor, ws['id'], preview['preview_id'], preview['manifest_hash'], 1)

@pytest.mark.asyncio
async def test_facts_are_session_only_and_end_revokes_preview(setup):
    from fileaction.workspaces.service import WorkspaceError
    from fileaction.workspaces.dto import PreviewRequest
    svc, actor, doc = setup
    ws = await svc.create(actor)
    ws = await svc.fact(actor, ws['id'], 1, text='合成本次背景', confirmed=True)
    assert ws['facts'][0]['retention'] == 'temporary'
    p = await svc.preview(actor, ws['id'], PreviewRequest(expected_revision=2, fact_ids=[ws['facts'][0]['id']]))
    await svc.end(actor, ws['id'], 2)
    with pytest.raises(WorkspaceError, match='RESOURCE_NOT_FOUND'):
        await svc.get(actor, ws['id'])
    with pytest.raises(WorkspaceError):
        await svc.validate_preview(actor, ws['id'], p['preview_id'], p['manifest_hash'], 2)

@pytest.mark.asyncio
async def test_rejects_hybrid_unknown_versions_and_expires_preview(setup):
    from fileaction.workspaces.service import WorkspaceError
    from fileaction.workspaces.dto import PreviewRequest
    svc, actor, doc = setup
    ws = await svc.create(actor, primary_document_id=doc['id'])
    with pytest.raises(WorkspaceError, match='EMBEDDING_NOT_CONFIGURED'):
        await svc.preview(actor, ws['id'], PreviewRequest(expected_revision=1, retrieval_mode='hybrid'))
    with pytest.raises(WorkspaceError, match='RESOURCE_NOT_FOUND'):
        await svc.select_documents(actor, ws['id'], 1, [str(uuid4())])
    p = await svc.preview(actor, ws['id'], PreviewRequest(expected_revision=1))
    await svc.temporary.redis.delete(svc.temporary._key(actor, 'preview', p['preview_id']))
    with pytest.raises(WorkspaceError, match='PREVIEW_EXPIRED'):
        await svc.validate_preview(actor, ws['id'], p['preview_id'], p['manifest_hash'], 1)

@pytest.mark.asyncio
async def test_preview_lifetime_does_not_shorten_session_registry(setup):
    from fileaction.workspaces.dto import PreviewRequest
    svc, actor, doc = setup
    ws = await svc.create(actor, primary_document_id=doc['id'])
    p = await svc.preview(actor, ws['id'], PreviewRequest(expected_revision=1))
    assert await svc.temporary.redis.ttl(svc.temporary._registry(actor)) > 3600
    key = svc.temporary._key(actor, 'preview', p['preview_id'])
    assert 0 < await svc.temporary.redis.ttl(key) <= 120
    await svc.validate_preview(actor, ws['id'], p['preview_id'], p['manifest_hash'], 1)
    assert 0 < await svc.temporary.redis.ttl(key) <= 120

@pytest.mark.asyncio
async def test_document_changes_revoke_and_keyword_never_reads_other_range(setup):
    from fileaction.workspaces.dto import PreviewRequest
    from fileaction.workspaces.service import WorkspaceError
    svc, actor, doc = setup
    ws = await svc.create(actor, primary_document_id=doc['id'])
    source = await svc.temporary.get(actor, 'document', doc['id'])
    segment = source.value['segments'][0]
    req = PreviewRequest(expected_revision=1, retrieval_mode='keyword', query='禁止', selections=[dict(document_version_id=doc['current_version_id'],segment_id=segment['id'],char_start=0,char_end=5)])
    p = await svc.preview(actor, ws['id'], req)
    assert p['manifest']['documents'][0]['segments'] == []
    full = await svc.preview(actor, ws['id'], PreviewRequest(expected_revision=1))
    await svc.temporary.replace(actor,'document',doc['id'],{**source.value,'current_version_id':str(uuid4())},expected_revision=source.revision)
    with pytest.raises(WorkspaceError, match='SOURCE_CHANGED'):
        await svc.validate_preview(actor,ws['id'],full['preview_id'],full['manifest_hash'],1)

@pytest.mark.asyncio
async def test_message_sequence_fact_edit_delete_and_budget(setup):
    from fileaction.workspaces.dto import PreviewRequest
    from fileaction.workspaces.service import WorkspaceError
    svc, actor, _ = setup
    ws = await svc.create(actor)
    msg = await svc.append_message(actor,ws['id'],role='user',text='合成历史问题',expected_sequence=0)
    assert (await svc.get(actor,ws['id']))['revision'] == 1
    with pytest.raises(WorkspaceError,match='MESSAGE_SEQUENCE_CONFLICT'):
        await svc.append_message(actor,ws['id'],role='user',text='重复',expected_sequence=0)
    p = await svc.preview(actor,ws['id'],PreviewRequest(expected_revision=1,history_message_ids=[msg['id']]))
    assert p['manifest']['history'][0]['sequence'] == 1
    ws = await svc.fact(actor,ws['id'],1,text='合成事实',confirmed=True)
    fact_id = ws['facts'][0]['id']
    ws = await svc.fact(actor,ws['id'],2,text='已修改事实',confirmed=True,fact_id=fact_id)
    assert ws['facts'][0]['version'] == 2
    ws = await svc.fact(actor,ws['id'],3,fact_id=fact_id,delete=True)
    assert ws['facts'] == []
    await svc.append_message(actor,ws['id'],role='assistant',text='a'*12001,expected_sequence=1)
    history = (await svc.messages(actor,ws['id']))['items']
    with pytest.raises(WorkspaceError,match='CONTEXT_BUDGET_EXCEEDED'):
        await svc.preview(actor,ws['id'],PreviewRequest(expected_revision=4,history_message_ids=[x['id'] for x in history]))

@pytest.mark.asyncio
async def test_actual_preview_deadline_and_foreign_document_rejected(setup):
    from fileaction.workspaces.dto import PreviewRequest
    from fileaction.workspaces.service import WorkspaceError
    svc, actor, doc = setup
    ws = await svc.create(actor, primary_document_id=doc['id'])
    preview = await svc.preview(actor, ws['id'], PreviewRequest(expected_revision=1))
    key = svc.temporary._key(actor, 'preview', preview['preview_id'])
    await svc.temporary.redis.hset(key, 'expires', await svc.now() - 1)
    with pytest.raises(WorkspaceError,match='PREVIEW_EXPIRED'):
        await svc.validate_preview(actor,ws['id'],preview['preview_id'],preview['manifest_hash'],1)
    stranger = ActorContext(uuid4(),uuid4())
    another = await svc.create(stranger)
    try:
        with pytest.raises(WorkspaceError,match='RESOURCE_NOT_FOUND'):
            await svc.select_documents(stranger,another['id'],1,[doc['current_version_id']])
    finally:
        await svc.temporary.end_session(stranger)
        await svc.temporary.redis.delete(svc.temporary.session_key(stranger))

@pytest.mark.asyncio
async def test_end_releases_only_unshared_temporary_sources_and_dependents(setup):
    from fileaction.documents.service import DocumentError
    from fileaction.storage_adapters.temporary import TemporaryError
    svc, actor, doc = setup
    first = await svc.create(actor,primary_document_id=doc['id'])
    second = await svc.create(actor,primary_document_id=doc['id'])
    run = await svc.temporary.create(actor,'run',{'workspace_id':first['id'],'synthetic':True})
    index = await svc.temporary.create(actor,'index',{'document_version_id':doc['current_version_id'],'synthetic':True})
    await svc.end(actor,first['id'],1)
    assert (await svc.documents.get(actor,doc['id']))['id'] == doc['id']
    with pytest.raises(TemporaryError):
        await svc.temporary.get(actor,'run',run.id)
    assert (await svc.temporary.get(actor,'index',index.id)).id == index.id
    await svc.select_documents(actor,second['id'],1,[])
    await svc.end(actor,second['id'],2)
    with pytest.raises(DocumentError,match='RESOURCE_NOT_FOUND'):
        await svc.documents.get(actor,doc['id'])
    with pytest.raises(TemporaryError):
        await svc.temporary.get(actor,'index',index.id)

@pytest.mark.asyncio
@pytest.mark.parametrize('failure_point', ['before_listing', 'after_document_delete'])
async def test_interrupted_end_stays_visible_revoked_and_retryable(setup, monkeypatch, failure_point):
    from fileaction.workspaces.dto import PreviewRequest
    from fileaction.workspaces.service import WorkspaceError
    from fileaction.storage_adapters.temporary import TemporaryError
    svc, actor, doc = setup
    ws = await svc.create(actor, primary_document_id=doc['id'])
    preview = await svc.preview(actor, ws['id'], PreviewRequest(expected_revision=1))
    index = await svc.temporary.create(actor, 'index', {'document_version_id':doc['current_version_id']})
    real_list, real_delete = svc.temporary.list, svc.temporary.delete
    async def fail_list(who, kind):
        if kind == 'workspace':
            raise TemporaryError('DEPENDENCY_UNAVAILABLE')
        return await real_list(who, kind)
    async def fail_after_delete(who, kind, identifier):
        await real_delete(who, kind, identifier)
        if kind == 'document':
            raise TemporaryError('DEPENDENCY_UNAVAILABLE')
    with monkeypatch.context() as patch:
        if failure_point == 'before_listing':
            patch.setattr(svc.temporary, 'list', fail_list)
        else:
            patch.setattr(svc.temporary, 'delete', fail_after_delete)
        with pytest.raises(TemporaryError, match='DEPENDENCY_UNAVAILABLE'):
            await svc.end(actor, ws['id'], 1)
    ending = await svc.get(actor, ws['id'])
    assert ending['status'] == 'ending' and ending['revision'] == 2
    assert [item['id'] for item in (await svc.list_temporary(actor))['items']] == [ws['id']]
    assert 'cleanup_document_versions' not in ending
    with pytest.raises(WorkspaceError, match='REVISION_CONFLICT'):
        await svc.end(actor, ws['id'], 1)
    with pytest.raises(WorkspaceError, match='WORKSPACE_ENDING'):
        await svc.patch(actor, ws['id'], 2, status='active')
    with pytest.raises(WorkspaceError, match='WORKSPACE_ENDING'):
        await svc.select_documents(actor, ws['id'], 2, [])
    with pytest.raises(WorkspaceError, match='WORKSPACE_ENDING'):
        await svc.fact(actor, ws['id'], 2, text='must not save', confirmed=True)
    with pytest.raises(WorkspaceError, match='WORKSPACE_ENDING'):
        await svc.append_message(actor, ws['id'], role='assistant', text='late result', expected_sequence=0)
    with pytest.raises(WorkspaceError, match='WORKSPACE_ENDING'):
        await svc.preview(actor, ws['id'], PreviewRequest(expected_revision=2))
    with pytest.raises(WorkspaceError, match='WORKSPACE_ENDING'):
        await svc.validate_preview(actor, ws['id'], preview['preview_id'], preview['manifest_hash'], 1)
    assert (await svc.end(actor, ws['id'], 2))['status'] == 'ended'
    with pytest.raises(WorkspaceError, match='RESOURCE_NOT_FOUND'):
        await svc.get(actor, ws['id'])
    for kind, identifier in [('document',doc['id']),('index',index.id),('preview',preview['preview_id'])]:
        with pytest.raises(TemporaryError, match='TEMPORARY_CONTENT_EXPIRED'):
            await svc.temporary.get(actor, kind, identifier)
