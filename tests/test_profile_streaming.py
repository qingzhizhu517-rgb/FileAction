"""自动用户档案与真实流式传输的合成测试，不替代真实模型验收。"""
import copy, json, tempfile, threading, time, unittest, os
from pathlib import Path
from unittest.mock import patch
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from src.core import AppError, MemoryStore
from src.model import ModelClient
from src.workspaces import WorkspaceApplication
from tests.test_core import MockModel, result
from tests.test_storage import MockCOS
from src.storage import COSStore

class ProfileTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.root=Path(self.tmp.name)
        self.memory=MemoryStore(self.root/'memory.json');self.model=MockModel();self.model.reply=result()
        self.model.reply['insights'][0]['background_refs']=[];self.model.reply['insights'][0]['evidence']=[{'source_id':'L1','quote':'合成通知'}]
        self.model.reply['file_knowledge_updates']=[{'field':'role','value':'合成教师','kind':'user_fact','message_id':'latest','quote':'我是合成教师'}]
        self.storage=COSStore(self.root/'files.json',factory=MockCOS,use_env=False)
        self.app=WorkspaceApplication(self.memory,self.model,self.storage,self.root/'workspaces.json')
        self.doc=self.app.upload('合成通知.txt','合成通知\n须提交成绩单。'.encode())
    def answer(self):return self.app.chat(self.doc['id'],'我是合成教师',True)
    def test_file_memory_automatically_archives_with_source_and_stable_id(self):
        got=self.answer();entry=self.memory.snapshot()['entries'][0]
        self.assertEqual(entry['content'],'合成教师');self.assertEqual(entry['file_id'],self.doc['file_id']);self.assertEqual(entry['kind'],'user_fact')
        self.assertEqual(entry['quote'],'我是合成教师');self.assertEqual(got['knowledge']['entries'][0]['profile_id'],entry['id'])
        self.answer();self.assertEqual(len(self.memory.snapshot()['entries']),1)
        restored=MemoryStore(self.root/'memory.json');self.assertEqual(restored.snapshot()['entries'][0]['id'],entry['id'])
    def test_new_file_gets_archived_profile_and_basis_can_be_edited(self):
        self.answer();entry=self.memory.snapshot()['entries'][0]
        other=self.app.upload('合成新通知.txt','合成通知二\n老师可提醒学生'.encode())
        self.assertIn(entry['id'],[b['id'] for b in other['profile_basis']])
        self.memory.apply('replace',entry['target'],'合成行政人员',entry['id'],True)
        self.model.reply['file_knowledge_updates']=[]
        self.app.chat(self.doc['id'],'请按最新身份解释',True)
        self.assertEqual(self.model.calls[-1][1]['file_knowledge'][0]['value'],'合成行政人员')
        self.assertEqual(self.model.calls[-1][1]['memory'][0]['content'],'合成行政人员')
    def test_file_edit_updates_the_same_global_entry(self):
        self.answer();entry=self.memory.snapshot()['entries'][0]
        card=self.app.open_workspace(self.doc['file_id'])['knowledge']
        self.app.edit_knowledge(self.doc['file_id'],'role','合成行政人员',card['revision'])
        entries=self.memory.snapshot()['entries'];self.assertEqual(len(entries),1);self.assertEqual(entries[0]['id'],entry['id']);self.assertEqual(entries[0]['content'],'合成行政人员')
    def test_deleted_profile_is_not_resurrected_by_old_file(self):
        self.answer();entry=self.memory.snapshot()['entries'][0]
        self.memory.apply('remove',entry['target'],entry_id=entry['id'],consent=True)
        self.answer();self.assertFalse(self.memory.snapshot()['entries'])
        self.assertFalse(self.app.open_workspace(self.doc['file_id'])['knowledge']['entries'])
    def test_inference_and_document_notes_stay_typed_in_archive(self):
        self.model.reply['file_knowledge_updates']=[{'field':'notes','value':'文件须提交成绩单','kind':'document_fact','source_id':'L2','quote':'须提交成绩单。'},{'field':'role','value':'可能是申请人','kind':'inference','source_id':'L1','quote':'合成通知'}]
        self.answer();rows=self.memory.snapshot()['entries'];self.assertEqual({r['kind'] for r in rows},{'inference','document_fact'})
    def test_failed_or_cancelled_output_cannot_archive_memory(self):
        self.model.reply['insights'][0]['evidence'][0]['quote']='合成伪造依据'
        with self.assertRaises(AppError):self.answer()
        self.assertFalse(self.memory.snapshot()['entries'])
    def test_reply_reports_actual_profile_ids_used(self):
        self.answer();entry=self.memory.snapshot()['entries'][0]
        self.model.reply['insights'][0]['memory_refs']=[entry['id']];self.model.reply['file_knowledge_updates']=[]
        got=self.app.chat(self.doc['id'],'合成追问',True)
        self.assertTrue(next(b for b in got['document']['profile_basis'] if b['id']==entry['id'])['used'])

    def test_export_includes_typed_automatic_archive(self):
        self.answer();value=self.memory.markdown('memory')
        self.assertIn('合成教师',value);self.assertIn('user_fact',value);self.assertIn('合成通知.txt',value)

    def test_partial_stream_failure_does_not_save_history_or_profile(self):
        seen=[]
        def stream(system,payload,emit):
            emit('response','合成未完成内容')
            raise AppError('合成连接提前结束',502)
        self.model.complete_stream=stream
        with self.assertRaises(AppError):self.app.chat(self.doc['id'],'我是合成教师',True,lambda k,v:seen.append(v))
        self.assertTrue(seen);self.assertFalse(self.memory.snapshot()['entries'])
        self.assertFalse(self.app.open_workspace(self.doc['file_id'])['messages'])

    def test_cancellation_stops_stream_before_archive(self):
        seen=[]
        def stream(system,payload,emit):
            emit('response','合成第一段');emit('response','合成迟到片段')
            return copy.deepcopy(self.model.reply)
        self.model.complete_stream=stream
        def delta(k,v):seen.append(v);self.app.cancel(self.doc['id'])
        with self.assertRaises(AppError) as caught:self.app.chat(self.doc['id'],'我是合成教师',True,delta)
        self.assertEqual(caught.exception.status,409);self.assertEqual(seen,['合成第一段'])
        self.assertFalse(self.memory.snapshot()['entries']);self.assertFalse(self.app.open_workspace(self.doc['file_id'])['messages'])

    def test_profile_edit_during_stream_rejects_old_result(self):
        seen=[]
        def stream(system,payload,emit):
            emit('response','合成第一段');emit('response','合成旧档案片段')
            return copy.deepcopy(self.model.reply)
        self.model.complete_stream=stream
        def delta(k,v):
            seen.append(v);self.memory.apply('add','user','合成主动修改档案',consent=True)
        with self.assertRaises(AppError) as caught:self.app.chat(self.doc['id'],'我是合成教师',True,delta)
        self.assertEqual(caught.exception.status,409);self.assertEqual(len(seen),1)
        self.assertEqual([e['content'] for e in self.memory.snapshot()['entries']],['合成主动修改档案'])
        self.assertFalse(self.app.open_workspace(self.doc['file_id'])['messages'])

class StreamProvider(BaseHTTPRequestHandler):
    started=threading.Event();release=threading.Event();requests=[];send_done=True
    def log_message(self,*args):pass
    def do_POST(self):
        body=json.loads(self.rfile.read(int(self.headers['Content-Length'])));self.__class__.requests.append(body)
        self.send_response(200);self.send_header('Content-Type','text/event-stream');self.end_headers()
        pieces=['{"response":"合成', '\\n中文\\u4eba', '","summary":"有依据的总结"}']
        try:
            for i,piece in enumerate(pieces):
                event='data: '+json.dumps({'choices':[{'delta':{'content':piece}}]},ensure_ascii=False)+'\n\n'
                self.wfile.write(event.encode());self.wfile.flush()
                if i==0:self.started.set();self.release.wait(2)
            if self.send_done:self.wfile.write(b'data: [DONE]\n\n');self.wfile.flush()
        except (BrokenPipeError,ConnectionResetError):pass

class StreamTests(unittest.TestCase):
    def setUp(self):
        self.proxy=patch.dict(os.environ,{'NO_PROXY':'localhost,127.0.0.1','no_proxy':'localhost,127.0.0.1'});self.proxy.start();self.addCleanup(self.proxy.stop)
        StreamProvider.started=threading.Event();StreamProvider.release=threading.Event();StreamProvider.requests=[];StreamProvider.send_done=True
        self.server=ThreadingHTTPServer(('127.0.0.1',0),StreamProvider);threading.Thread(target=self.server.serve_forever,daemon=True).start()
        self.addCleanup(self.server.server_close);self.addCleanup(self.server.shutdown)
        self.client=ModelClient(use_env=False);self.client.configure(f'http://127.0.0.1:{self.server.server_port}/v1','synthetic-key','synthetic-model')
    def test_upstream_tokens_arrive_before_completion_with_correct_escapes(self):
        seen=[];answers=[];errors=[]
        def run():
            try:answers.append(self.client.complete_stream('合成测试',{},lambda field,text:seen.append((field,text))))
            except Exception as e:errors.append(e)
        worker=threading.Thread(target=run);worker.start()
        self.assertTrue(StreamProvider.started.wait(1))
        deadline=time.monotonic()+1
        while not seen and time.monotonic()<deadline:time.sleep(.01)
        try:self.assertTrue(seen);self.assertFalse(answers)
        finally:StreamProvider.release.set();worker.join(3)
        self.assertFalse(errors);self.assertTrue(StreamProvider.requests[0]['stream'])
        self.assertEqual(''.join(t for f,t in seen if f=='response'),'合成\n中文人');self.assertEqual(answers[0]['summary'],'有依据的总结')
    def test_incomplete_stream_is_failure_not_saved_result(self):
        StreamProvider.send_done=False;StreamProvider.release.set()
        with self.assertRaises(AppError):self.client.complete_stream('合成测试',{},lambda *args:None)
    def test_nested_json_fields_are_not_presented_as_root_output(self):
        from src.streaming import JSONTextStream
        seen=[];parser=JSONTextStream(lambda k,v:seen.append((k,v)))
        for chunk in ['{"meta":{"response":"嵌套不显示"},"res','ponse":"真实字段\\uD83D','\\uDE00"}']:parser.feed(chunk)
        self.assertEqual(seen,[('response','真实字段'),('response','😀')])

if __name__=='__main__':unittest.main()
