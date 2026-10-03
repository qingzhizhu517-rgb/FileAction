"""浏览器验收专用合成 HTTP 模型替身，独立端口与临时数据，不是产品入口。"""
import json
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from src.model import ModelClient
from src.server import create_server
from src.storage import COSStore
from tests.test_storage import MockCOS


class Provider(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_POST(self):
        request = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        value = json.loads(request['messages'][-1]['content'])
        background = value.get('background', [])
        if any('延迟合成测试' in v for v in background):
            time.sleep(3)
        if value.get('purpose'):
            reply = {'ok': True}
        elif value.get('goal'):
            reply = {'title': '合成申请材料清单', 'markdown': '# 合成申请材料清单\n\n模型初稿，需本人核对。\n\n- [ ] 项目成果说明\n- [ ] 成绩单\n- [ ] 【待补充：确认在校身份】\n\n依据 L4：材料要求。准备材料不等于资格通过。'}
        else:
            segment = next((s for s in value['document']['segments'] if '成果' in s['text']), value['document']['segments'][0])
            bad = any('无效引用合成测试' in v for v in background)
            reply = {'overview': '合成测试输出：项目经历可能用于准备申请，身份和成绩仍待核实。',
                     'insights': [{'title': '准备项目成果说明', 'meaning': '已确认的项目经历可能成为申请素材。',
                     'document_fact': segment['text'], 'background_refs': [0] if background else [],
                     'memory_refs': [e['id'] for e in value.get('memory', [])],
                     'inference': '经历可能有用，但不能直接判断资格通过。', 'unknown': '在校身份和成绩尚未确认。',
                     'evidence': [{'source_id': segment['id'], 'quote': '伪造引用' if bad else segment['text']}]}],
                     'questions': ['你是否为全日制在校本科生？'],
                     'memory_candidates': [{'target': 'user', 'content': '合成用户完成过一个软件项目', 'reason': '合成测试候选，待用户确认'}],
                     'actions': ['材料清单', '申请陈述草稿']}
        body = json.dumps({'choices': [{'message': {'content': json.dumps(reply, ensure_ascii=False)}}]}, ensure_ascii=False).encode()
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def main():
    provider = ThreadingHTTPServer(('127.0.0.1', 0), Provider)
    threading.Thread(target=provider.serve_forever, daemon=True).start()
    model = ModelClient(use_env=False)
    model.configure(f'http://127.0.0.1:{provider.server_port}/v1', 'synthetic-test-key', '合成HTTP测试替身（非真实LLM）')
    with tempfile.TemporaryDirectory(prefix='wenqi-browser-test-') as tmp:
        storage = COSStore(Path(tmp) / 'files.json', factory=MockCOS, use_env=False)
        storage.configure('synthetic-1234567890', 'ap-guangzhou', 'synthetic-id', 'synthetic-key')
        app = create_server(port=8790, data_dir=Path(tmp), model=model, storage=storage)
        print('浏览器验收服务：http://127.0.0.1:8790/ · 合成模型替身，非真实 LLM', flush=True)
        try:
            app.serve_forever()
        except KeyboardInterrupt:
            pass
        finally:
            app.server_close()
            provider.shutdown()
            provider.server_close()


if __name__ == '__main__':
    main()
