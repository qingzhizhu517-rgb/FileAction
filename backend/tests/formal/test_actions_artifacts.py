"""真实合成PG/Redis合同测试；直接提交合成模型结构，无外部模型调用。"""
import asyncio
import io
import zipfile
from uuid import uuid4
import pytest
from sqlalchemy import text
from test_runs import setup
from fileaction.db.session import ActorContext
from fileaction.workspaces.dto import PreviewRequest

def test_history_markdown_contains_history_and_generation_metadata():
    from fileaction.artifacts.service import ArtifactService
    view=dict(body='合成历史正文',version=1,author_kind='model',validity='current',historical=True,verification_note='模型原稿',sources=[],unknowns=[],generated_at='2026-10-03T01:02:03+00:00')
    content=ArtifactService._markdown(view,confirm_historical=True).decode()
    assert '历史版本' in content and '原生成时间：2026-10-03T01:02:03+00:00' in content

def test_deleted_source_redaction_removes_title_body_and_unknowns():
    from fileaction.artifacts.repository import redact_deleted_fields
    value=redact_deleted_fields(dict(title='SYNTHETIC_DELETED_QUOTE',body='前文 SYNTHETIC_DELETED_QUOTE 后文',unknowns=['SYNTHETIC_DELETED_QUOTE 未知']),['SYNTHETIC_DELETED_QUOTE'])
    assert 'SYNTHETIC_DELETED_QUOTE' not in repr(value)

@pytest.mark.asyncio
@pytest.mark.parametrize('with_claim',[False,True])
async def test_retained_deleted_dependency_redacts_all_export_surfaces(setup,with_claim):
    import json
    from fileaction.artifacts.service import ArtifactService
    from fileaction.artifacts.repository import ArtifactRepository
    svc,actor,_,_,admin=setup
    workspace,document,version,segment,run,artifact=[uuid4() for _ in range(6)]
    secret='SYNTHETIC_DELETED_QUOTE'
    evidence=dict(type='document',document_id=str(document),version=str(version),segment_id=str(segment),quote=secret)
    envelope=dict(claims=[dict(evidence=[evidence])] if with_claim else [],unknowns=[secret])
    async with admin.begin() as db:
        await db.execute(text("INSERT INTO workspaces(id,owner_id,title,retained_at) VALUES(:id,:owner,'synthetic',now())"),dict(id=workspace,owner=actor.user_id))
        await db.execute(text("INSERT INTO documents(id,owner_id,name,parse_status,deletion_state) VALUES(:id,:owner,'synthetic','ready','deleted')"),dict(id=document,owner=actor.user_id))
        await db.execute(text("INSERT INTO document_versions(id,owner_id,document_id,version,sha256,size_bytes,blob_key) VALUES(:id,:owner,:document,1,:hash,23,'synthetic')"),dict(id=version,owner=actor.user_id,document=document,hash='a'*64))
        await db.execute(text("INSERT INTO document_segments(id,owner_id,document_version_id,ordinal,text) VALUES(:id,:owner,:version,1,:body)"),dict(id=segment,owner=actor.user_id,version=version,body=secret))
        await db.execute(text("INSERT INTO runs(id,owner_id,workspace_id,auth_session_id,kind,status,manifest_hash,expected_revision,idempotency_key) VALUES(:id,:owner,:workspace,:session,'generate_artifact','succeeded',:hash,1,:key)"),dict(id=run,owner=actor.user_id,workspace=workspace,session=actor.session_id,hash='a'*64,key=str(run)))
        await db.execute(text("INSERT INTO run_documents(id,owner_id,run_id,document_version_id) VALUES(:id,:owner,:run,:version)"),dict(id=uuid4(),owner=actor.user_id,run=run,version=version))
        await db.execute(text("INSERT INTO answers(id,owner_id,workspace_id,run_id,envelope_json,validity,generated_at) VALUES(:id,:owner,:workspace,:run,CAST(:envelope AS jsonb),'current','2026-10-03T01:02:03Z')"),dict(id=uuid4(),owner=actor.user_id,workspace=workspace,run=run,envelope=json.dumps(envelope)))
        await db.execute(text("INSERT INTO artifacts(id,owner_id,workspace_id,title,kind) VALUES(:id,:owner,:workspace,:title,'markdown')"),dict(id=artifact,owner=actor.user_id,workspace=workspace,title=secret))
        await db.execute(text("INSERT INTO artifact_versions(id,owner_id,artifact_id,version,body,author_kind,run_id,validity) VALUES(:id,:owner,:artifact,1,:body,'model',:run,'current')"),dict(id=uuid4(),owner=actor.user_id,artifact=artifact,body=secret,run=run))
    try:
        service=ArtifactService(svc,ArtifactRepository(svc.repository.factory))
        view=await service.get(actor,str(artifact))
        assert view['validity']=='source_deleted'
        assert secret not in view['title']+view['body']+str(view['unknowns'])+str(view['sources'])
        exported=await service.export(actor,str(artifact),1,1,confirm_stale=True)
        assert secret not in exported['filename']+exported['content'].decode()
        zipped=await service.export_workspace(actor,str(workspace),1,[dict(artifact_id=str(artifact),version=1)],confirm_stale=True)
        with zipfile.ZipFile(io.BytesIO(zipped['content'])) as archive:
            assert secret not in str(archive.namelist())+''.join(archive.read(n).decode() for n in archive.namelist())
        assert view['generated_at'].startswith('2026-10-03T01:02:03')
    finally:
        async with admin.begin() as db:
            for table in ('artifact_versions','artifacts','answers','run_documents','runs','document_segments','document_versions','documents','workspaces'):
                await db.execute(text('DELETE FROM '+table+' WHERE owner_id=:owner'),dict(owner=actor.user_id))

def test_workspace_public_hides_action_proposal_tombstones():
    from fileaction.workspaces.service import WorkspaceService
    value={'id':'x','revision':1,'actions':[],'action_requests':{},'shown_proposals':{},'deleted_action_proposals':['private'],'messages':[]}
    visible=WorkspaceService.public(type('Resource',(),{'value':value})())
    assert 'deleted_action_proposals' not in visible and 'actions' not in visible

async def generated(setup, *, title='../合成标题', body='合成模型原稿', artifact=True):
    svc, actor, ws, _, admin = setup
    preview = await svc.workspaces.preview(actor, ws['id'], PreviewRequest(expected_revision=1, kind='generate_artifact' if artifact else 'propose_actions'))
    run = await svc.create(actor, ws['id'], uuid4().hex, dict(preview_id=preview['preview_id'], manifest_hash=preview['manifest_hash'], expected_revision=1, consent_to_send=True))
    async with admin.begin() as db:
        await db.execute(text("UPDATE runs SET status='running',lease_owner='synthetic-contract',lease_until=now()+interval '1 minute' WHERE id=:id"),dict(id=run['id']))
    manifest = (await svc.content.get(actor,run['id'])).value['manifest']
    doc = manifest['documents'][0]; segment = doc['segments'][0]
    evidence = dict(type='document',document_id=doc['document_id'],version=doc['document_version_id'],segment_id=segment['segment_id'],quote='允许申请')
    answer = dict(summary='合成解读',claims=[dict(id='c1',text='允许申请',kind='document_fact',evidence=[evidence])],questions=[],memory_candidates=[],action_candidates=[dict(id='p1',text='准备合成申请材料',evidence=[evidence])],unknowns=['资格尚未核实'],coverage='full_selected_text',artifact=dict(title=title,kind='markdown',body=body) if artifact else None)
    result = await svc.commit(actor,run['id'],'synthetic-contract',answer)
    return run, result

@pytest.mark.asyncio
async def test_actions_require_confirmation_and_deduplicate_verified_proposal(setup):
    from fileaction.actions.service import ActionService, ActionError
    svc,actor,ws,_,admin=setup; actions=ActionService(svc)
    with pytest.raises(ActionError,match='CONFIRMATION_REQUIRED'):
        await actions.create(actor,'k',dict(workspace_id=ws['id'],title='手工合成行动',confirmed=False))
    assert (await actions.list(actor))['items']==[]
    run,_=await generated(setup,artifact=False)
    proposals=await actions.proposals(actor,ws['id'],run['id'])
    request=dict(workspace_id=ws['id'],proposal_id=proposals['items'][0]['proposal_id'],confirmed=True)
    first=await actions.create(actor,'k',request)
    assert first['title']=='准备合成申请材料' and first['origin_kind']=='user_confirmed_proposal'
    assert (await actions.create(actor,'k',request))['id']==first['id']
    assert (await actions.create(actor,'k2',request))['id']==first['id']
    with pytest.raises(ActionError,match='IDEMPOTENCY_CONFLICT'):
        await actions.create(actor,'k2',dict(workspace_id=ws['id'],title='同键另一个合成行动',confirmed=True))
    with pytest.raises(ActionError,match='IDEMPOTENCY_CONFLICT'):
        await actions.create(actor,'k',dict(workspace_id=ws['id'],title='别的正文',confirmed=True))
    with pytest.raises(ActionError,match='INVALID_REQUEST'):
        await actions.create(actor,'injection',{**request,'title':'篡改模型建议'})
    async with admin.begin() as db:
        assert await db.scalar(text('SELECT count(*) FROM actions WHERE owner_id=:owner'),dict(owner=actor.user_id))==0

@pytest.mark.asyncio
async def test_action_owner_session_revision_status_and_timezone(setup):
    from fileaction.actions.service import ActionService, ActionError
    svc,actor,ws,_,_=setup; actions=ActionService(svc)
    item=await actions.create(actor,'manual',dict(workspace_id=ws['id'],title='用户合成任务',confirmed=True))
    for stranger in (ActorContext(uuid4(),uuid4()),ActorContext(actor.user_id,uuid4())):
        with pytest.raises(ActionError,match='RESOURCE_NOT_FOUND'): await actions.patch(stranger,item['id'],1,status='completed')
    with pytest.raises(ActionError,match='INVALID_REQUEST'): await actions.patch(actor,item['id'],1,due_at='2026-10-03T12:00:00')
    updated=await actions.patch(actor,item['id'],1,status='completed',priority='high',due_at='2026-10-03T12:00:00+08:00')
    assert updated['revision']==2 and updated['status']=='completed'
    with pytest.raises(ActionError,match='REVISION_CONFLICT'): await actions.patch(actor,item['id'],1,status='paused')
    with pytest.raises(ActionError,match='CONFIRMATION_REQUIRED'): await actions.delete(actor,item['id'],2,False)
    await actions.delete(actor,item['id'],2,True)
    with pytest.raises(ActionError,match='RESOURCE_NOT_FOUND'): await actions.get(actor,item['id'])

@pytest.mark.asyncio
async def test_artifact_immutable_versions_cas_and_selected_binary_exports(setup):
    from fileaction.artifacts.service import ArtifactService, ArtifactError
    svc,actor,ws,_,admin=setup; service=ArtifactService(svc)
    await generated(setup)
    first=(await service.list(actor,ws['id']))['items'][0]
    assert first['body']=='合成模型原稿' and first['author_kind']=='model'
    results=await asyncio.gather(service.patch(actor,first['id'],1,'用户新版本'),service.patch(actor,first['id'],1,'竞争版本'),return_exceptions=True)
    assert sum(isinstance(r,ArtifactError) for r in results)==1
    latest=await service.get(actor,first['id'])
    assert latest['version']==2 and latest['author_kind']=='user' and latest['revision']==2
    assert (await service.get(actor,first['id'],1))['body']=='合成模型原稿'
    assert len((await service.versions(actor,first['id']))['items'])==2
    with pytest.raises(ArtifactError,match='HISTORICAL_CONFIRMATION_REQUIRED'): await service.export(actor,first['id'],1,2)
    markdown=await service.export(actor,first['id'],1,2,confirm_historical=True)
    assert '合成模型原稿' in markdown['content'].decode() and '资格尚未核实' in markdown['content'].decode()
    assert '/' not in markdown['filename'] and chr(92) not in markdown['filename']
    await generated(setup,title='../合成标题',body='第二份原稿')
    second=(await service.list(actor,ws['id']))['items'][1]
    archive=await service.export_workspace(actor,ws['id'],1,[dict(artifact_id=first['id'],version=1),dict(artifact_id=second['id'],version=1)],confirm_historical=True)
    with zipfile.ZipFile(io.BytesIO(archive['content'])) as z:
        assert len(z.namelist())==2 and len(set(z.namelist()))==2
        assert all('/' not in name and chr(92) not in name for name in z.namelist())
        contents=[z.read(name).decode() for name in z.namelist()]
        assert any('合成模型原稿' in body for body in contents) and all('用户新版本' not in body for body in contents)
    async with admin.begin() as db:
        assert await db.scalar(text('SELECT count(*) FROM artifacts WHERE owner_id=:owner'),dict(owner=actor.user_id))==0
        assert await db.scalar(text('SELECT count(*) FROM artifact_versions WHERE owner_id=:owner'),dict(owner=actor.user_id))==0

@pytest.mark.asyncio
async def test_artifact_visibility_stale_confirmation_deleted_sources_and_delete(setup):
    from fileaction.artifacts.service import ArtifactService, ArtifactError
    svc,actor,ws,_,admin=setup; service=ArtifactService(svc)
    run,_=await generated(setup)
    artifact=(await service.list(actor,ws['id']))['items'][0]
    for stranger in (ActorContext(uuid4(),uuid4()),ActorContext(actor.user_id,uuid4())):
        with pytest.raises(ArtifactError,match='RESOURCE_NOT_FOUND'): await service.get(stranger,artifact['id'])
    async with admin.begin() as db:
        await db.execute(text("UPDATE runs SET status='cancelled' WHERE id=:id"),dict(id=run['id']))
    assert (await service.list(actor,ws['id']))['items']==[]
    async with admin.begin() as db:
        await db.execute(text("UPDATE runs SET status='succeeded' WHERE id=:id"),dict(id=run['id']))
    await svc.workspaces.patch(actor,ws['id'],1,goal='已改变的合成目标')
    stale=await service.get(actor,artifact['id'])
    assert stale['validity']=='stale'
    with pytest.raises(ArtifactError,match='STALE_CONFIRMATION_REQUIRED'): await service.export(actor,artifact['id'],1,1)
    await service.export(actor,artifact['id'],1,1,confirm_stale=True)
    await svc.workspaces.temporary.delete(actor,'document',ws['documents'][0]['id'])
    deleted=await service.get(actor,artifact['id'])
    assert deleted['validity']=='source_deleted' and '允许申请' not in str(deleted['sources'])
    await service.delete(actor,artifact['id'],1,True)
    with pytest.raises(ArtifactError,match='RESOURCE_NOT_FOUND'): await service.get(actor,artifact['id'])

@pytest.mark.asyncio
async def test_retained_adapters_owner_contract_and_immutable_user_version(setup):
    from fileaction.actions.repository import ActionRepository
    from fileaction.artifacts.repository import ArtifactRepository
    from fileaction.actions.service import ActionService, ActionError
    from fileaction.artifacts.service import ArtifactService, ArtifactError
    svc,actor,_,_,admin=setup
    ws,action,artifact=uuid4(),uuid4(),uuid4()
    async with admin.begin() as db:
        await db.execute(text("INSERT INTO workspaces(id,owner_id,title,retained_at) VALUES(:id,:owner,'合成保留工作区',now())"),dict(id=ws,owner=actor.user_id))
        await db.execute(text("INSERT INTO actions(id,owner_id,workspace_id,title,status,priority,confirmed_at) VALUES(:id,:owner,:ws,'合成保留行动','confirmed','normal',now())"),dict(id=action,owner=actor.user_id,ws=ws))
        await db.execute(text("INSERT INTO artifacts(id,owner_id,workspace_id,title,kind) VALUES(:id,:owner,:ws,'合成保留稿','markdown')"),dict(id=artifact,owner=actor.user_id,ws=ws))
        await db.execute(text("INSERT INTO artifact_versions(id,owner_id,artifact_id,version,body,author_kind,validity) VALUES(:id,:owner,:artifact,1,'合成保留原文','user','current')"),dict(id=uuid4(),owner=actor.user_id,artifact=artifact))
    try:
        actions=ActionService(svc,ActionRepository(svc.repository.factory))
        artifacts=ArtifactService(svc,ArtifactRepository(svc.repository.factory))
        assert (await actions.list(actor))['items'][0]['retention']=='retained'
        body=dict(workspace_id=str(ws),title='合成新增保留行动',confirmed=True)
        created=await actions.create(actor,'retained-manual',body)
        assert created['retention']=='retained'
        assert (await actions.create(actor,'retained-manual',body))['id']==created['id']
        with pytest.raises(ActionError,match='IDEMPOTENCY_CONFLICT'):
            await actions.create(actor,'retained-manual',{**body,'title':'变更文本'})
        assert (await actions.patch(actor,str(action),1,status='completed'))['status']=='completed'
        assert (await artifacts.patch(actor,str(artifact),1,'保留的新用户版本'))['version']==2
        assert (await artifacts.get(actor,str(artifact),1))['body']=='合成保留原文'
        stranger=ActorContext(uuid4(),uuid4())
        with pytest.raises(ActionError,match='RESOURCE_NOT_FOUND'): await actions.get(stranger,str(action))
        with pytest.raises(ArtifactError,match='RESOURCE_NOT_FOUND'): await artifacts.get(stranger,str(artifact))
        assert (await artifacts.list(ActorContext(actor.user_id,uuid4()),str(ws)))['items'][0]['retention']=='retained'
        await artifacts.delete(actor,str(artifact),2,True)
        with pytest.raises(ArtifactError,match='RESOURCE_NOT_FOUND'): await artifacts.get(actor,str(artifact))
        await actions.delete(actor,str(action),2,True)
    finally:
        async with admin.begin() as db:
            for table in ('artifact_versions','artifacts','actions','workspaces'):
                await db.execute(text('DELETE FROM '+table+' WHERE owner_id=:owner'),dict(owner=actor.user_id))

@pytest.mark.asyncio
async def test_unshown_proposals_and_deleted_proposal_do_not_recreate(setup):
    from fileaction.actions.service import ActionService,ActionError
    svc,actor,ws,_,_=setup; actions=ActionService(svc)
    run,_=await generated(setup,artifact=False)
    body=dict(workspace_id=ws['id'],proposal_id=run['id']+':p1',confirmed=True)
    with pytest.raises(ActionError,match='PROPOSAL_NOT_SHOWN'): await actions.create(actor,'k',body)
    proposals=await actions.proposals(actor,ws['id'],run['id'])
    body['proposal_id']=proposals['items'][0]['proposal_id']
    item=await actions.create(actor,'k',body)
    assert len(item['proposal_key'])<=160
    await actions.delete(actor,item['id'],1,True)
    with pytest.raises(ActionError,match='PROPOSAL_ALREADY_DELETED'): await actions.create(actor,'new-key',body)

@pytest.mark.asyncio
async def test_artifact_deleted_dependency_without_claim_is_marked_and_redacted(setup):
    from fileaction.artifacts.service import ArtifactService
    svc,actor,ws,_,admin=setup
    run,result=await generated(setup,body='允许申请，资格未知。')
    # 保留真实commit结构，仅构造无逐条claim的合成回答合同。
    from fileaction.workspaces.service import content_hash
    resource=await svc.content.get(actor,run['id']); original=await svc.workspaces._resource(actor,ws['id'])
    result['envelope']['claims']=[]; result['envelope']['action_candidates']=[]
    result['envelope']['unknowns']=['允许申请，资格未知。']
    await svc.workspaces.temporary.replace(actor,'run',run['id'],{**resource.value,'result':result,'commit':{**resource.value['commit'],'hash':content_hash(result)}},expected_revision=resource.revision)
    await svc.workspaces._save(actor,original,{**original.value,'answers':{run['id']:result}},change=False)
    service=ArtifactService(svc); artifact=(await service.list(actor,ws['id']))['items'][0]
    await svc.workspaces.temporary.delete(actor,'document',ws['documents'][0]['id'])
    view=await service.get(actor,artifact['id'])
    assert view['validity']=='source_deleted'
    exported=await service.export(actor,artifact['id'],1,1,confirm_stale=True)
    assert '允许申请' not in exported['content'].decode()

