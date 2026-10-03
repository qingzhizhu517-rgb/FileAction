"""真实合成认证/数据库/Redis，端点确认、冲突与二进制响应合同。"""
from test_auth_integration import client,csrf
from test_workspaces_api import login

def test_actions_http_confirmation_validation_and_revision(client):
    assert client.get('/api/v1/actions').status_code==401
    login(client)
    ws=client.post('/api/v1/workspaces',headers=csrf(client),json={'retention':'temporary'}).json()['data']
    root='/api/v1/actions'
    assert client.post(root,headers={**csrf(client),'Idempotency-Key':'create'},json=dict(workspace_id=ws['id'],title='合成用户行动',confirmed=False)).status_code==422
    assert client.get(root).json()['data']['items']==[]
    created=client.post(root,headers={**csrf(client),'Idempotency-Key':'create'},json=dict(workspace_id=ws['id'],title='合成用户行动',confirmed=True))
    assert created.status_code==201,created.text
    item=created.json()['data']; path=root+'/'+item['id']
    assert item['status']=='confirmed'
    changed=client.patch(path,headers=csrf(client),json=dict(expected_revision=1,status='completed'))
    assert changed.status_code==200 and changed.json()['data']['revision']==2
    assert client.patch(path,headers=csrf(client),json=dict(expected_revision=1,status='paused')).status_code==409
    assert client.patch(path,headers=csrf(client),json=dict(expected_revision=2,due_at='2026-10-03T12:00:00')).status_code==422
    assert client.delete(path,headers=csrf(client),params={'confirmed':'true'}).status_code==422
    assert client.request('DELETE',path,headers=csrf(client),json=dict(expected_revision=2,confirmed=True)).status_code==200
    assert client.get(root).json()['data']['items']==[]
    assert client.post('/api/v1/auth/logout',headers=csrf(client)).status_code==204

def test_binary_export_headers_and_bytes_are_not_json():
    from fileaction.artifacts.routes import download
    response=download(dict(content='合成Markdown'.encode(),filename='../危险\r\n标题.md',media_type='text/markdown; charset=utf-8'))
    assert response.body=='合成Markdown'.encode()
    assert response.media_type.startswith('text/markdown')
    header=response.headers['content-disposition']
    assert '\r' not in header and '\n' not in header and '../' not in header
    assert response.headers['cache-control']=='private, no-store'
