"""文件工作区与结构化信息测试：使用合成模型和COS替身。"""
import copy, json, tempfile, threading, unittest, io, zipfile
from pathlib import Path
from datetime import datetime, timezone
from src.core import AppError, MemoryStore, parse_document
from src.storage import COSStore
from src.workspaces import WorkspaceApplication
from src.highlights import extract_highlights, countdown
from tests.test_core import MockModel, result
from tests.test_storage import MockCOS

NOTICE='合成通知\n报名截止：2026年10月20日17:00（北京时间）。\n报名链接：https://example.com/apply\n须提交成绩单。'

class WorkspacesTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.root=Path(self.tmp.name)
        self.storage=COSStore(self.root/'files.json',factory=MockCOS,use_env=False)
        self.storage.configure('synthetic-1234567890','ap-guangzhou','id','key')
        self.model=MockModel();self.model.reply=result()
        row=self.model.reply['insights'][0];row['background_refs']=[];row['evidence']=[{'source_id':'L4','quote':'须提交成绩单。'}]
        self.model.reply['file_knowledge']=[]
        self.memory=MemoryStore(self.root/'memory.json')
        self.app=WorkspaceApplication(self.memory,self.model,self.storage,self.root/'workspaces.json')
        self.doc=self.app.upload('合成报名.txt',NOTICE.encode())

    def test_same_content_opens_same_file_and_threads_are_independent(self):
        same=self.app.upload('同内容.txt',NOTICE.encode());self.assertEqual(same['file_id'],self.doc['file_id'])
        other=self.app.new_thread(self.doc['file_id'],'转发给同学')
        self.assertNotEqual(other['id'],self.doc['id'])
        self.app.chat(self.doc['id'],'合成用户：我想申请',True)
        self.app.chat(other['id'],'合成用户：我只想转发',True)
        self.assertFalse(any('我想申请' in t['content'] for t in self.model.calls[-1][1]['conversation']))
        self.assertEqual(len(self.app.open_workspace(self.doc['file_id'])['threads']),2)

    def test_cos_snapshot_restores_after_process_restart_without_local_body(self):
        self.app.store_document(self.doc['id'],True)
        self.app.chat(self.doc['id'],'合成用户想申请',True)
        original_client=self.storage.client
        restored_store=COSStore(self.root/'files.json',factory=lambda c:original_client,use_env=False)
        restored_store.configure('synthetic-1234567890','ap-guangzhou','id','key')
        restarted=WorkspaceApplication(self.memory,self.model,restored_store,self.root/'workspaces.json')
        restored=restarted.open_workspace(self.doc['file_id'])
        self.assertTrue(restored['persistent']);self.assertEqual(len(restored['messages']),2)
        self.assertIn('合成用户想申请',restored['messages'][0]['content'])
        local=(self.root/'workspaces.json').read_text()
        self.assertNotIn('合成用户想申请',local);self.assertNotIn('报名链接',local)
        self.assertTrue(any(r.get('kind')=='workspace' for r in restored_store.records))

    def test_close_keeps_history_and_unconfigured_storage_does_not_fake_durability(self):
        self.app.chat(self.doc['id'],'合成追问',True);self.app.close_thread(self.doc['id'])
        self.assertEqual(len(self.app.open_workspace(self.doc['file_id'])['messages']),2)
        self.assertFalse(self.app.open_workspace(self.doc['file_id'])['persistent'])
        self.assertFalse((self.root/'workspaces.json').exists())

    def test_file_card_edits_override_ai_and_reload_in_other_threads(self):
        card=self.app.edit_knowledge(self.doc['file_id'],'role','我是一名合成教师',0)
        other=self.app.new_thread(self.doc['file_id'])
        self.model.reply['file_knowledge']=[{'field':'role','value':'合成学生','kind':'inference','source_id':'L1','quote':'合成通知'}]
        self.app.chat(other['id'],'请结合已改过的身份理解',True)
        payload=self.model.calls[-1][1]
        self.assertEqual(payload['file_knowledge'][0]['value'],'我是一名合成教师')
        current=self.app.open_workspace(self.doc['file_id'])
        self.assertEqual(current['knowledge']['entries'][0]['value'],'我是一名合成教师')
        self.assertTrue(current['knowledge']['entries'][0]['locked'])
        self.assertEqual(self.memory.snapshot()['entries'],[])

    def test_automatic_file_card_requires_real_sources_and_no_repeat_confirmation(self):
        self.model.reply['file_knowledge']=[{'field':'role','value':'我是合成老师','kind':'user_fact','message_id':'latest','quote':'我是合成老师'}]
        got=self.app.chat(self.doc['id'],'我是合成老师',True)
        self.assertEqual(got['knowledge']['entries'][0]['value'],'我是合成老师')
        self.assertFalse(got['knowledge']['entries'][0]['locked'])
        self.assertEqual(self.memory.snapshot()['entries'],[])
        self.model.reply['file_knowledge'][0]['quote']='我不存在的经历'
        with self.assertRaises(AppError):self.app.chat(self.doc['id'],'另一个合成问题',True)

    def test_edit_in_flight_rejects_stale_model_reply_preserves_history(self):
        started,release=threading.Event(),threading.Event();original=self.model.complete
        def slow(*args):started.set();release.wait(3);return original(*args)
        self.model.complete=slow;errors=[]
        def work():
            try:self.app.chat(self.doc['id'],'合成慢请求',True)
            except AppError as e:errors.append(e)
        t=threading.Thread(target=work);t.start();self.assertTrue(started.wait(2))
        self.app.edit_knowledge(self.doc['file_id'],'role','我是合成老师',0);release.set();t.join(3)
        self.assertEqual(errors[0].status,409);self.assertEqual(self.app.open_workspace(self.doc['file_id'])['messages'],[])

    def test_deleted_card_does_not_reappear_and_global_edit_keeps_chat(self):
        self.app.edit_knowledge(self.doc['file_id'],'role','合成教师',0)
        self.app.edit_knowledge(self.doc['file_id'],'role','',1)
        self.model.reply['file_knowledge']=[{'field':'role','value':'合成教师','kind':'inference','source_id':'L1','quote':'合成通知'}]
        self.app.chat(self.doc['id'],'合成追问',True)
        self.assertEqual(self.app.open_workspace(self.doc['file_id'])['knowledge']['entries'],[])
        self.memory.apply('add','user','合成全局背景',consent=True);self.app.refresh_memory(self.doc['id'])
        self.assertEqual(len(self.app.open_workspace(self.doc['file_id'])['messages']),2)
        self.app.chat(self.doc['id'],'继续',True)
        self.assertEqual(self.model.calls[-1][1]['memory'][0]['content'],'合成全局背景')

    def test_sync_failure_keeps_changes_and_truthful_pending_status(self):
        self.app.store_document(self.doc['id'],True);self.storage.client.fail=True
        got=self.app.chat(self.doc['id'],'合成新消息',True)
        self.assertTrue(got['sync']['pending']);self.assertIn('失败',got['sync']['error'])
        self.assertEqual(len(self.app.open_workspace(self.doc['file_id'])['messages']),2)
        self.storage.client.fail=False;self.app.sync_workspace(self.doc['file_id'],True)
        self.assertFalse(self.app.open_workspace(self.doc['file_id'])['sync']['pending'])

    def test_more_than_16_turns_retained_with_bounded_model_context(self):
        for i in range(20):self.app.chat(self.doc['id'],f'合成第{i}轮',True)
        self.assertEqual(len(self.app.open_workspace(self.doc['file_id'])['messages']),40)
        self.assertLessEqual(len(self.model.calls[-1][1]['conversation']),13)

    def test_draft_and_edit_restore_and_expired_analysis_cannot_generate(self):
        got=self.app.chat(self.doc['id'],'合成追问',True)
        self.model.reply={'title':'合成草稿','markdown':'模型初稿\n合成正文'}
        self.app.action(self.doc['id'],got['revision'],'草稿',True,True)
        self.app.save_draft(self.doc['id'],'合成编辑正文')
        self.assertEqual(self.app.open_workspace(self.doc['file_id'])['draft']['markdown'],'合成编辑正文')
        self.app.edit_knowledge(self.doc['file_id'],'role','合成教师',0)
        with self.assertRaises(AppError):self.app.action(self.doc['id'],got['revision'],'旧稿',True,True)

    def test_draft_is_retained_when_conversation_continues(self):
        got=self.app.chat(self.doc['id'],'合成追问',True)
        self.model.reply={'title':'合成草稿','markdown':'合成初稿'}
        self.app.action(self.doc['id'],got['revision'],'草稿',True,True)
        self.app.save_draft(self.doc['id'],'合成已编辑正文')
        self.model.reply=result();self.model.reply['insights'][0]['background_refs']=[]
        self.model.reply['insights'][0]['evidence']=[{'source_id':'L4','quote':'须提交成绩单。'}]
        self.app.chat(self.doc['id'],'合成继续追问',True)
        self.assertEqual(self.app.open_workspace(self.doc['file_id'])['draft']['markdown'],'合成已编辑正文')

    def test_initial_cos_failure_retains_pending_status_for_reopen(self):
        self.storage.client.fail=True
        with self.assertRaises(AppError):self.app.store_document(self.doc['id'],True)
        reopened=self.app.open_workspace(self.doc['file_id'])
        self.assertTrue(reopened['sync']['pending']);self.assertFalse(reopened['persistent'])

    def test_delete_does_not_send_requests_to_another_bucket(self):
        self.app.store_document(self.doc['id'],True)
        self.storage.configure('another-1234567890','ap-beijing','id','key')
        with self.assertRaises(AppError):self.app.delete_workspace(self.doc['file_id'],True)
        self.assertIn(self.doc['file_id'],self.app.index)

    def test_different_file_cannot_open_another_files_thread(self):
        other=self.app.upload('合成其他.txt','合成独立文件'.encode())
        with self.assertRaises(AppError) as got:self.app.open_workspace(other['file_id'],self.doc['id'])
        self.assertEqual(got.exception.status,404)

    def test_stale_card_edit_and_invalid_source_do_not_overwrite_valid_card(self):
        self.app.edit_knowledge(self.doc['file_id'],'role','合成教师',0)
        with self.assertRaises(AppError) as got:self.app.edit_knowledge(self.doc['file_id'],'role','合成学生',0)
        self.assertEqual(got.exception.status,409)
        self.assertEqual(self.app.open_workspace(self.doc['file_id'])['knowledge']['entries'][0]['value'],'合成教师')

    def test_corrupt_cloud_snapshot_fails_without_fake_history(self):
        self.app.store_document(self.doc['id'],True)
        record=next(r for r in self.storage.records if r['kind']=='workspace')
        self.storage.client.objects[record['key']]=b'corrupt synthetic archive'
        other=WorkspaceApplication(self.memory,self.model,self.storage,self.root/'workspaces.json')
        with self.assertRaises(AppError):other.open_workspace(self.doc['file_id'])
        self.assertFalse(other.projects)

    def test_provider_change_during_request_does_not_authorize_new_provider(self):
        config={'base_url':'https://synthetic-first.example/v1','model':'synthetic-model'}
        self.model.status=lambda:dict(config)
        original=self.model.complete
        def switch(*args):
            reply=original(*args);config['base_url']='https://synthetic-second.example/v1';return reply
        self.model.complete=switch
        with self.assertRaises(AppError) as got:self.app.chat(self.doc['id'],'合成问题',True)
        self.assertEqual(got.exception.status,409)
        self.assertFalse(self.app.open_workspace(self.doc['file_id'])['send_authorized'])
        self.assertEqual(self.app.open_workspace(self.doc['file_id'])['messages'],[])

    def test_history_preserves_knowledge_sources_at_reply_time(self):
        self.app.edit_knowledge(self.doc['file_id'],'role','合成教师',0)
        self.app.chat(self.doc['id'],'合成追问',True)
        self.app.edit_knowledge(self.doc['file_id'],'role','合成行政人员',1)
        doc=self.app.open_workspace(self.doc['file_id'])
        self.assertEqual(doc['messages'][-1]['knowledge']['entries'][0]['value'],'合成教师')
        self.assertEqual(doc['knowledge']['entries'][0]['value'],'合成行政人员')

class HighlightsTests(unittest.TestCase):
    def test_links_dates_and_countdown_come_from_original(self):
        segments=parse_document('合成.txt',NOTICE.encode())['segments'];cards=extract_highlights(segments)
        deadline=next(c for c in cards if c['kind']=='deadline');link=next(c for c in cards if c['kind']=='link')
        self.assertEqual(link['value'],'https://example.com/apply')
        now=datetime(2026,10,19,9,tzinfo=timezone.utc)
        self.assertEqual(countdown(deadline,now)['seconds'],86400)
        self.assertEqual(countdown(deadline,datetime(2026,10,21,tzinfo=timezone.utc))['state'],'expired')

    def test_ambiguous_deadline_and_unprovided_link_do_not_get_invented(self):
        cards=extract_highlights(parse_document('合成.txt','报名截止：10月20日，指定平台提交。'.encode())['segments'])
        self.assertFalse(any(c['kind']=='link' for c in cards))
        self.assertIsNone(countdown(next(c for c in cards if c['kind']=='deadline')))

    def test_unsupported_timezone_does_not_silently_become_utc(self):
        cards=extract_highlights(parse_document('合成.txt','报名截止：2026年10月20日17:00 UTC+05:00'.encode())['segments'])
        self.assertIsNone(cards[0]['date_info']['timestamp'])
        self.assertEqual(countdown(cards[0])['precision'],'date')

    def test_docx_relationship_link_is_preserved(self):
        raw=io.BytesIO()
        with zipfile.ZipFile(raw,'w') as z:
            z.writestr('word/document.xml','<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body><w:p><w:hyperlink r:id="rId1"><w:r><w:t>报名入口</w:t></w:r></w:hyperlink></w:p></w:body></w:document>')
            z.writestr('word/_rels/document.xml.rels','<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Target="https://example.com/apply" TargetMode="External" Type="hyperlink"/></Relationships>')
        doc=parse_document('合成.docx',raw.getvalue());self.assertIn('https://example.com/apply',doc['segments'][0]['links'])
        self.assertEqual(extract_highlights(doc['segments'])[0]['value'],'https://example.com/apply')

if __name__=='__main__':unittest.main()
