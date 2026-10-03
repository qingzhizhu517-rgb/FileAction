"""只展开示例配置，不启动容器、不读取真实.env。"""
import json
from pathlib import Path
import subprocess
from urllib.parse import urlsplit

def test_indexing_compose_has_separate_restricted_worker():
    root=Path(__file__).resolve().parents[3]
    result=subprocess.run(['docker','compose','--env-file','.env.example','--profile','indexing','config','--format','json'],cwd=root,capture_output=True,text=True)
    assert result.returncode==0,result.stderr
    services=json.loads(result.stdout)['services']
    worker=services['indexing']
    assert worker['command']==['python','-m','fileaction.workers.indexing_main']
    assert urlsplit(worker['environment']['FILEACTION_DISPATCHER_DATABASE_URL']).username=='fileaction_dispatch_login'
    assert 'FILEACTION_DISPATCHER_DATABASE_URL' not in services['api']['environment']
    assert worker['environment']['FILEACTION_EMBEDDING_MAX_BATCH_ITEMS']=='10'
