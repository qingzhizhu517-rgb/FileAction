"""浏览器验收专用合成 HTTP 模型替身，独立端口与临时数据，不是产品入口。"""
import json
import os
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
        conversation = value.get('conversation', [])
        background = value.get('background', []) + [t['content'] for t in conversation if t['role'] == 'user']
        knowledge = value.get('file_knowledge', [])
        locked_role = next((k['value'] for k in knowledge if k['field'] == 'role' and k.get('locked')), '')
        admin = '行政人员' in locked_role or any('行政人员' in e['content'] and e.get('locked') for e in value.get('memory',[]))
        if any('延迟合成测试' in v for v in background):
            time.sleep(3)
        if value.get('purpose'):
            reply = {'ok': True}
        elif value.get('goal'):
            reply = {'title': '合成申请材料清单', 'markdown': '# 合成申请材料清单\n\n模型初稿，需本人核对。\n\n' + ('教师转发视角。\n\n' if any('老师' in v for v in background) else '') + '- [ ] 项目成果说明\n- [ ] 成绩单\n- [ ] 【待补充：确认在校身份】\n\n准备材料不等于资格通过。'}
        else:
            segment = next((s for s in value['document']['segments'] if '成果' in s['text']), value['document']['segments'][0])
            bad = any('无效引用合成测试' in v for v in background)
            teacher = any('老师' in v for v in background) or any('老师' in e['content'] for e in value.get('memory',[]))
            skip = any('不补充' in v for v in background)
            finish = any('不需要继续' in v for v in background)
            business = '采购' in value['document']['name']
            latest = next((m for m in reversed(conversation) if m['role'] == 'user' and '老师' in m['content']), None)
            updates = [{'field':'role','value':'合成用户是一名老师','kind':'user_fact','message_id':latest['id'],'quote':'我是老师'}] if latest and not locked_role else []
            reply = {'file_knowledge_updates':updates, 'thread_context':'合成会话：理解通知和准备提醒', 'overview': '合成测试输出：项目经历可能用于准备申请，身份和成绩仍待核实。',
                     'summary': '合成文件总结：' + ('这是一份采购事项说明，需要核对采购要求。' if business else '奖学金通知规定申请材料和截止时间，准备材料不等于资格通过。'),
                     'response': '合成对话回复：' + ('好的，到这里结束即可。' if finish else '可以只看文件，不再追问个人情况。' if skip else '按修改后的卡片，你是行政人员，应从资助事务角度理解。' if admin else '明白，你是老师，应该从转发给学生的角度理解。' if teacher else '我先给你总结文件，再按你的需要聊。'),
                     'positioning': '' if teacher or skip or finish else '你可能在考虑采购事项，尚待确认。' if business else '你可能是考虑申请的学生，但只是猜测，尚待确认。',
                     'next_step': 'finish' if finish else 'discuss',
                     'insights': [{'title': '准备项目成果说明', 'meaning': '已确认的项目经历可能成为申请素材。',
                     'document_fact': segment['text'], 'background_refs': [0] if value.get('background') else [],
                     'memory_refs': [e['id'] for e in value.get('memory', [])],
                     'inference': '经历可能有用，但不能直接判断资格通过。', 'unknown': '在校身份和成绩尚未确认。',
                     'evidence': [{'source_id': segment['id'], 'quote': '伪造引用' if bad else segment['text']}]}],
                     'questions': [] if skip or finish else ['你希望核对采购要求还是整理清单？' if business else '你是准备申请，还是帮别人了解这份通知？'],
                     'memory_candidates': [{'target': 'user', 'content': '合成用户是一名老师', 'reason': '合成对话用户自述，待审阅保存'}] if teacher else [],
                     'actions': ['采购事项核对清单'] if business else ['材料清单', '通知转发稿']}
            if value['document']['name'].startswith('synthetic-linebreak-'):
                # 合成 PDF 刻意分行，模型替身返回连贯的一句引用。
                reply['insights'][0]['document_fact'] = 'Complete 5 credits before April 30.'
                reply['insights'][0]['evidence'] = [{'source_id': 'P1L1', 'quote': 'Complete 5 credits before April 30.'}]
        if request.get('stream'):
            self.send_response(200);self.send_header('Content-Type','text/event-stream');self.end_headers()
            content=json.dumps(reply,ensure_ascii=False)
            try:
                for i in range(0,len(content),32):
                    event={'choices':[{'delta':{'content':content[i:i+32]}}]}
                    self.wfile.write(('data: '+json.dumps(event,ensure_ascii=False)+'\n\n').encode());self.wfile.flush();time.sleep(.025)
                self.wfile.write(b'data: [DONE]\n\n');self.wfile.flush()
            except (BrokenPipeError,ConnectionResetError):pass
            return
        body = json.dumps({'choices': [{'message': {'content': json.dumps(reply, ensure_ascii=False)}}]}, ensure_ascii=False).encode()
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def main():
    # 隔离验收只连接本机合成服务，不能经系统代理转发测试认证信息。
    os.environ['NO_PROXY'] = os.environ['no_proxy'] = 'localhost,127.0.0.1,::1'
    provider = ThreadingHTTPServer(('127.0.0.1', 0), Provider)
    threading.Thread(target=provider.serve_forever, daemon=True).start()
    model = ModelClient(use_env=False)
    model.configure(f'http://127.0.0.1:{provider.server_port}/v1', 'synthetic-test-key', '合成HTTP测试替身（非真实LLM）')
    with tempfile.TemporaryDirectory(prefix='wenqi-browser-test-') as tmp:
        storage = COSStore(Path(tmp) / 'files.json', factory=MockCOS, use_env=False)
        storage.configure('synthetic-1234567890', 'ap-guangzhou', 'synthetic-id', 'synthetic-key')
        app = create_server(port=8790, data_dir=Path(tmp), model=model, storage=storage)
        unconfigured = create_server(port=8791, data_dir=Path(tmp) / 'unconfigured', model=ModelClient(use_env=False))
        threading.Thread(target=unconfigured.serve_forever, daemon=True).start()
        print('浏览器验收服务：http://127.0.0.1:8790/ · 合成模型替身，非真实 LLM', flush=True)
        try:
            app.serve_forever()
        except KeyboardInterrupt:
            pass
        finally:
            app.server_close()
            unconfigured.shutdown()
            unconfigured.server_close()
            provider.shutdown()
            provider.server_close()


if __name__ == '__main__':
    main()
