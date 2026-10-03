"""首页和账号浏览器测试专用：合成模型与 COS 替身，独立临时账号目录。"""
import os
import tempfile
import threading
from pathlib import Path
from http.server import ThreadingHTTPServer
from src.core import MemoryStore
from src.model import ModelClient
from src.server import create_server
from src.storage import COSStore
from src.workspaces import WorkspaceApplication
from tests.e2e_server import Provider
from tests.test_storage import MockCOS

def main():
    os.environ['NO_PROXY']=os.environ['no_proxy']='localhost,127.0.0.1,::1'
    provider=ThreadingHTTPServer(('127.0.0.1',0),Provider)
    threading.Thread(target=provider.serve_forever,daemon=True).start()
    def factory(folder):
        model=ModelClient(use_env=False)
        model.configure(f'http://127.0.0.1:{provider.server_port}/v1','synthetic-key','合成HTTP测试替身（非真实LLM）')
        storage=COSStore(folder/'files.json',factory=MockCOS,use_env=False)
        storage.configure('synthetic-1234567890','ap-guangzhou','synthetic-id','synthetic-key')
        return WorkspaceApplication(MemoryStore(folder/'memory.json'),model,storage,folder/'workspaces.json')
    with tempfile.TemporaryDirectory(prefix='wenqi-accounts-browser-') as tmp:
        app=create_server(port=8792,data_dir=Path(tmp),with_auth=True,app_factory=factory)
        print('合成账号浏览器验收：http://127.0.0.1:8792/ · 非真实模型/COS',flush=True)
        try:
            app.serve_forever()
        except KeyboardInterrupt:
            pass
        finally:
            app.server_close();provider.shutdown();provider.server_close()

if __name__=='__main__':
    main()
