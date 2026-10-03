"""仅本任务隔离合成库的分页元数据；不伪造COS上传成功。"""
import json
import os
from pathlib import Path
from uuid import uuid4

import psycopg

ROOT = Path(__file__).resolve().parents[2]
config = json.loads((ROOT / '.superpowers/sdd/可行动事务Agent-正式个人版实施计划/synthetic-services.json').read_text(encoding='utf-8-sig'))['postgres']
username = os.environ.get('FILEACTION_E2E_USERNAME', '')
if not config.get('synthetic_only') or config['database'] != 'fileaction_test' or not username.startswith('e2e') or len(username) != 23:
    raise RuntimeError('仅允许本任务随机合成账号与隔离测试库')
with psycopg.connect(config['test_admin_url']) as connection:
    row = connection.execute('SELECT id FROM users WHERE username_normalized=%s', (username,)).fetchone()
    if row is None:
        raise RuntimeError('合成浏览器账号不存在')
    owner = row[0]
    for number in range(23):
        document_id = uuid4()
        category = 'notice' if number < 20 else 'material'
        connection.execute(
            'INSERT INTO documents (id,owner_id,name,category,parse_status) VALUES (%s,%s,%s,%s,%s)',
            (document_id, owner, f'合成分页资料-{number:02d}.txt', category, 'ready'),
        )
        connection.execute(
            'INSERT INTO document_versions (id,owner_id,document_id,version,sha256,size_bytes,blob_key) VALUES (%s,%s,%s,1,%s,3,%s)',
            (uuid4(), owner, document_id, 'a' * 64, 'synthetic-pagination-no-cloud/' + str(document_id)),
        )
print('已建立23条明确合成的分页元数据；未调用COS或模型。')
