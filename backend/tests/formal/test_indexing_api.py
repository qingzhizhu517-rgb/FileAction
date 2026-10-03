"""真实合成身份/Redis/PG；API不外发、不运行后台索引。"""
from dataclasses import replace
import os
from uuid import uuid4
import pytest
from test_auth_integration import client,csrf

@pytest.fixture
def index_client(client):
    from fileaction.indexing.routes import router
    if not any(getattr(r,'path','')=='/api/v1/documents/{document_id}/index-preview' for r in client.app.routes): client.app.include_router(router)
    client.app.state.settings=replace(client.app.state.settings,embedding_base_url='https://synthetic.invalid/v1',embedding_api_key='synthetic',embedding_model='synthetic',embedding_dimensions=768,embedding_profile_version=1)
    yield client
    import psycopg
    with psycopg.connect(os.environ['FILEACTION_TEST_ADMIN_DATABASE_URL'].replace('postgresql+psycopg://','postgresql://')) as db:
        for table in ('embedding_calls','index_jobs','consents'):
            db.execute('DELETE FROM '+table+' WHERE owner_id IN (SELECT id FROM users WHERE username_normalized=ANY(%s))',(client.created_usernames,))

def test_index_api_requires_csrf_explicit_consent_and_strict_dto(index_client):
    c=index_client
    name='ix'+uuid4().hex[:20]
    c.created_usernames.append(name)
    credentials=dict(username=name,password='synthetic-index-password')
    assert c.post('/api/v1/auth/register',headers=csrf(c),json=dict(**credentials,display_name='合成索引用户')).status_code==201
    assert c.post('/api/v1/auth/login',headers=csrf(c),json=credentials).status_code==200
    doc=c.post('/api/v1/documents',headers=csrf(c),data=dict(retention='temporary',consent_to_store='false'),files={'file':('synthetic.txt','合成申请通知。'.encode(),'text/plain')}).json()['data']
    root='/api/v1/documents/'+doc['id']
    req=dict(expected_revision=1,document_version_id=doc['current_version_id'])
    assert c.post(root+'/index-preview',json=req).status_code==403
    assert c.post(root+'/index-preview',headers=csrf(c),json=dict(**req,owner_id=str(uuid4()))).status_code==422
    preview=c.post(root+'/index-preview',headers=csrf(c),json=req)
    assert preview.status_code==200,preview.text
    p=preview.json()['data']
    body=dict(preview_id=p['preview_id'],manifest_hash=p['manifest_hash'],expected_revision=1,consent_to_embed=False)
    headers=dict(**csrf(c),**{'Idempotency-Key':'synthetic'})
    assert c.post(root+'/indexes',headers=headers,json=body).status_code==403
    body['consent_to_embed']=True
    created=c.post(root+'/indexes',headers=headers,json=body)
    assert created.status_code==202,created.text
    job=created.json()['data']
    assert c.get('/api/v1/index-jobs/'+job['id']).json()['data']['status']=='queued'
    assert c.post('/api/v1/index-jobs/'+job['id']+'/cancel',headers=csrf(c),json=dict(confirmed=True)).json()['data']['status']=='cancelled'
    assert c.request('DELETE',root+'/indexes',headers=csrf(c),json=dict(expected_revision=1,confirmed=True)).status_code==200
    assert c.get(root+'/segments').status_code==200
    assert c.post('/api/v1/auth/logout',headers=csrf(c)).status_code==204
    assert c.get('/api/v1/index-jobs/'+job['id']).status_code==401
