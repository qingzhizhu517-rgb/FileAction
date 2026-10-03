"""仅限自动化测试的本机 HTTP 模型替身；不是 LLM 能力验证。"""
import json
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


def objects(value):
    if isinstance(value, dict):
        yield value
        for item in value.values():
            yield from objects(item)
    elif isinstance(value, list):
        for item in value:
            yield from objects(item)


class TestModelHandler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass  # 不记录文件、背景或密钥。

    def do_GET(self):
        self.send_response(200)
        self.end_headers()
        self.wfile.write(b'HTTP model test double only')

    def do_POST(self):
        request = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        payloads = []
        for message in request['messages']:
            try:
                payloads.append(json.loads(message['content']))
            except (ValueError, TypeError):
                pass
        fields = list(objects(payloads))
        segments = [f for f in fields if all(k in f for k in ('id', 'locator', 'text'))]
        facts = [f for f in fields if all(k in f for k in ('id', 'version', 'text')) and 'locator' not in f]
        if not segments:
            self.send_error(400, 'Test requires real parsed segments')
            return
        document_text = '\n'.join(f['text'] for f in segments)
        if '[SLOW]' in document_text:
            time.sleep(3)
        cite = {'segment_id': segments[0]['id'], 'quote': segments[0]['text'][:32]}
        if '[INVALID_CITATION]' in document_text:
            cite['quote'] = '这是源文件不存在的引用'
        fact_ids = [f['id'] for f in facts]
        goal = next((f.get('goal') for f in fields if f.get('goal')), None)
        if goal:
            output = {'text': '# HTTP测试替身生成的合成草稿\n\n请向主办方核实申请要求。', 'citations': [cite], 'fact_ids': fact_ids}
        else:
            output = {
                'items': [{'title': '合成通知的申请要求', 'meaning': 'HTTP测试替身输出，仅验证流程，不代表真实模型理解。', 'kind': 'fact', 'citations': [cite], 'fact_ids': fact_ids}],
                'questions': [{'question': '你本次关注什么？', 'reason': '仅用于验证可跳过提问的合成问题。'}],
                'unknowns': ['实际资格尚未核实。'],
                'candidates': [{'text': '合成候选背景：正在了解申请要求', 'source_segment_ids': [segments[0]['id']]}],
            }
        content = json.dumps(output, ensure_ascii=False)
        data = json.dumps({'id': 'e2e-test-double', 'object': 'chat.completion', 'choices': [{'index': 0, 'message': {'role': 'assistant', 'content': content, 'refusal': None}, 'finish_reason': 'stop'}]}, ensure_ascii=False).encode()
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        try:
            self.wfile.write(data)
        except (BrokenPipeError, ConnectionResetError):
            pass


if __name__ == '__main__':
    ThreadingHTTPServer(('127.0.0.1', 8777), TestModelHandler).serve_forever()
