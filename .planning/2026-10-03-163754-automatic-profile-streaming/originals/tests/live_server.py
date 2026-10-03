"""真实模型隔离验收入口：读取已有后台配置，只用临时合成记忆/工作区。"""
import tempfile
from pathlib import Path
from src.model import ModelClient
from src.storage import COSStore
from src.server import create_server, ROOT

def main():
    with tempfile.TemporaryDirectory(prefix='fileaction-live-workspaces-') as folder:
        root=Path(folder)
        server=create_server(8792,root,ModelClient(config_path=ROOT/'var/model-config.json'),COSStore(root/'files.json',use_env=False))
        print('真实模型隔离验收：http://127.0.0.1:8792/，临时合成数据，不修改产品用户档案。',flush=True)
        try:server.serve_forever()
        except KeyboardInterrupt:pass
        finally:server.server_close()

if __name__=='__main__':main()
