"""真实合成PG/Redis与登录流程；无真实材料、无模型请求。"""
from uuid import uuid4
import pytest
from test_auth_integration import client, csrf

def login(client):
    username = 'ws' + uuid4().hex[:18]
    client.created_usernames.append(username)
    body = dict(username=username, password='synthetic-workspace-password', display_name='合成工作区测试')
    assert client.post('/api/v1/auth/register', headers=csrf(client), json=body).status_code == 201
    assert client.post('/api/v1/auth/login', headers=csrf(client), json={k:v for k,v in body.items() if k != 'display_name'}).status_code == 200

def test_workspace_api_login_facts_preview_and_logout(client):
    assert client.get('/api/v1/workspaces/temporary').status_code == 401
    login(client)
    response = client.post('/api/v1/workspaces', headers=csrf(client), json={'retention':'temporary'})
    assert response.status_code == 201, response.text
    ws = response.json()['data']
    root = '/api/v1/workspaces/' + ws['id']
    assert client.get('/api/v1/workspaces').json()['data']['items'] == []
    assert client.get('/api/v1/workspaces?unexpected=true').status_code == 422
    fact = client.post(root+'/facts', headers=csrf(client), json={'expected_revision':1,'text':'本次合成事实','confirmed':True})
    assert fact.status_code == 200, fact.text
    ws = fact.json()['data']
    preview = client.post(root+'/context-preview', headers=csrf(client), json={'expected_revision':2,'fact_ids':[ws['facts'][0]['id']]})
    assert preview.status_code == 200, preview.text
    assert preview.json()['data']['manifest']['facts'][0]['text'] == '本次合成事实'
    assert client.get(root+'/messages').json()['data'] == {'items':[], 'next_cursor':None}
    bad = client.patch(root, headers=csrf(client), json={'expected_revision':1,'goal':'旧修改'})
    assert bad.status_code == 409
    import os, psycopg
    with psycopg.connect(os.environ['FILEACTION_TEST_ADMIN_DATABASE_URL']) as connection:
        assert connection.execute('SELECT count(*) FROM workspaces WHERE id=%s', (ws['id'],)).fetchone()[0] == 0
        assert connection.execute('SELECT count(*) FROM context_facts WHERE workspace_id=%s', (ws['id'],)).fetchone()[0] == 0
    assert client.post('/api/v1/auth/logout', headers=csrf(client)).status_code == 204
    assert client.get(root).status_code == 401
    username = client.created_usernames[-1]
    assert client.post('/api/v1/auth/login', headers=csrf(client), json={'username':username,'password':'synthetic-workspace-password'}).status_code == 200
    assert client.get(root).status_code == 404
    assert client.get('/api/v1/workspaces/temporary').json()['data']['items'] == []

def test_retained_history_pagination_and_current_source_authorization(client):
    import os, psycopg
    login(client)
    actor_id = client.get('/api/v1/auth/me').json()['data']['id']
    workspace_ids = [uuid4(),uuid4(),uuid4()]
    document_id, current_version, old_version = uuid4(),uuid4(),uuid4()
    stranger = uuid4()
    with psycopg.connect(os.environ['FILEACTION_TEST_ADMIN_DATABASE_URL']) as connection:
        connection.execute("INSERT INTO users(id,username_normalized,display_name,password_hash) VALUES(%s,%s,'合成其他账号','unusable')",(stranger,'ws'+stranger.hex[:18]))
        for i, identifier in enumerate(workspace_ids):
            connection.execute("INSERT INTO workspaces(id,owner_id,title,retained_at) VALUES(%s,%s,%s,now())",(identifier, actor_id if i<2 else stranger,'合成保留历史'))
        connection.execute("INSERT INTO documents(id,owner_id,name,current_version,parse_status) VALUES(%s,%s,'合成保留文件',2,'ready')",(document_id,actor_id))
        for version, identifier in enumerate((old_version,current_version),1):
            connection.execute("INSERT INTO document_versions(id,owner_id,document_id,version,sha256,size_bytes,blob_key) VALUES(%s,%s,%s,%s,%s,5,'synthetic-only')",(identifier,actor_id,document_id,version,'a'*64))
    try:
        first = client.get('/api/v1/workspaces?limit=1')
        assert first.status_code == 200, first.text
        data = first.json()['data']
        assert len(data['items']) == 1 and data['next_cursor']
        second = client.get('/api/v1/workspaces', params={'limit':1,'cursor':data['next_cursor']}).json()['data']
        assert len(second['items']) == 1 and second['next_cursor'] is None
        assert {data['items'][0]['id'],second['items'][0]['id']} == {str(i) for i in workspace_ids[:2]}
        assert client.get('/api/v1/workspaces',params={'cursor':data['next_cursor']+'x'}).status_code == 422
        created = client.post('/api/v1/workspaces', headers=csrf(client),json={'retention':'temporary'}).json()['data']
        path = '/api/v1/workspaces/'+created['id']+'/documents'
        selected = client.put(path,headers=csrf(client),json={'expected_revision':1,'document_version_ids':[str(current_version)]})
        assert selected.status_code == 200, selected.text
        assert selected.json()['data']['documents'][0]['name'] == '合成保留文件'
        old = client.put(path,headers=csrf(client),json={'expected_revision':2,'document_version_ids':[str(old_version)]})
        assert old.status_code == 404, old.text
        ended = client.post('/api/v1/workspaces/'+created['id']+'/end',headers=csrf(client),json={'expected_revision':2})
        assert ended.status_code == 200, ended.text
        assert client.get('/api/v1/documents/'+str(document_id)).status_code == 200
        assert client.post('/api/v1/auth/logout',headers=csrf(client)).status_code == 204
    finally:
        with psycopg.connect(os.environ['FILEACTION_TEST_ADMIN_DATABASE_URL']) as connection:
            connection.execute('DELETE FROM document_versions WHERE document_id=%s',(document_id,))
            connection.execute('DELETE FROM documents WHERE id=%s',(document_id,))
            connection.execute('DELETE FROM workspaces WHERE id=ANY(%s)',(workspace_ids,))
            connection.execute('DELETE FROM users WHERE id=%s',(stranger,))

def test_failed_end_is_discoverable_and_retryable_over_http(client, monkeypatch):
    from fileaction.storage_adapters.temporary import TemporaryStore, TemporaryError
    login(client)
    document = client.post('/api/v1/documents', headers=csrf(client), files={'file':('synthetic-end.txt',b'synthetic cleanup material','text/plain')}, data={'retention':'temporary'}).json()['data']
    ws = client.post('/api/v1/workspaces', headers=csrf(client), json={'primary_document_id':document['id']}).json()['data']
    root = '/api/v1/workspaces/' + ws['id']
    real_list = TemporaryStore.list
    async def fail_workspace_list(store, actor, kind):
        if kind == 'workspace':
            raise TemporaryError('DEPENDENCY_UNAVAILABLE')
        return await real_list(store, actor, kind)
    with monkeypatch.context() as patch:
        patch.setattr(TemporaryStore, 'list', fail_workspace_list)
        failed = client.post(root+'/end', headers=csrf(client), json={'expected_revision':1})
        assert failed.status_code == 503, failed.text
    ending = client.get(root).json()['data']
    assert ending['status'] == 'ending' and ending['revision'] == 2
    assert client.get('/api/v1/workspaces/temporary').json()['data']['items'][0]['status'] == 'ending'
    assert client.get(root+'/messages').status_code == 200
    stale = client.post(root+'/end', headers=csrf(client), json={'expected_revision':1})
    assert stale.status_code == 409 and stale.json()['error']['code'] == 'REVISION_CONFLICT'
    forbidden = client.post(root+'/context-preview', headers=csrf(client), json={'expected_revision':2})
    assert forbidden.status_code == 409 and forbidden.json()['error']['code'] == 'WORKSPACE_ENDING'
    completed = client.post(root+'/end', headers=csrf(client), json={'expected_revision':2})
    assert completed.status_code == 200, completed.text
    assert client.get(root).status_code == 404
    assert client.get('/api/v1/documents/'+document['id']).status_code == 404
    assert client.get('/api/v1/workspaces/temporary').json()['data']['items'] == []
    assert client.post('/api/v1/auth/logout', headers=csrf(client)).status_code == 204
