"""合成对话行为测试；模型替身不代表真实 LLM。"""
import copy
import tempfile
import threading
import unittest
from pathlib import Path
from src.core import Application, AppError, MemoryStore
from tests.test_core import MockModel, NOTICE, result


class ConversationTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.memory = MemoryStore(Path(self.tmp.name) / 'memory.json')
        self.model = MockModel()
        self.model.reply['insights'][0]['background_refs'] = []
        self.model.reply.update(summary='合成通知要求成果说明、成绩单，并规定截止时间。',
                                response='先给你概括这份通知。', positioning='可能是考虑申请的学生，但尚未确认。', next_step='discuss')
        self.app = Application(self.memory, self.model)
        self.doc = self.app.upload('合成对话通知.txt', NOTICE.encode())

    def test_first_summary_without_profile_and_guess_does_not_become_memory(self):
        got = self.app.chat(self.doc['id'], '', True)
        self.assertIn('成绩单', got['analysis']['summary'])
        self.assertIn('尚未确认', got['analysis']['positioning'])
        payload = self.model.calls[-1][1]
        self.assertEqual(payload['background'], [])
        self.assertEqual(payload['conversation'], [])
        self.assertEqual(self.memory.snapshot()['entries'], [])
        self.assertFalse(self.memory.path.exists())

    def test_saved_memory_is_available_on_first_turn(self):
        self.memory.apply('add', 'user', '合成用户是本科生', consent=True)
        doc = self.app.upload('新合成通知.txt', NOTICE.encode())
        self.app.chat(doc['id'], '', True)
        self.assertEqual(self.model.calls[-1][1]['memory'][0]['content'], '合成用户是本科生')

    def test_followup_retains_conversation_and_action_uses_it(self):
        first = self.app.chat(self.doc['id'], '', True)
        self.model.reply['response'] = '明白，你是老师，这次关注转发给学生。'
        second = self.app.chat(self.doc['id'], '合成背景：我是老师，想转发给学生', True)
        history = self.model.calls[-1][1]['conversation']
        self.assertEqual(history[-1], {'role': 'user', 'content': '合成背景：我是老师，想转发给学生'})
        self.assertEqual(history[0]['role'], 'assistant')
        self.model.reply = {'title': '转发稿', 'markdown': '模型初稿：合成通知转发稿。'}
        self.app.action(self.doc['id'], second['revision'], '转发稿', True, True)
        self.assertTrue(any('我是老师' in turn['content'] for turn in self.model.calls[-1][1]['conversation']))
        with self.assertRaises(AppError):
            self.app.action(self.doc['id'], first['revision'], '旧稿', True, True)
        self.assertEqual(self.memory.snapshot()['entries'], [])

    def test_user_can_finish_without_answering_or_generating(self):
        self.app.chat(self.doc['id'], '', True)
        self.app.forget(self.doc['id'])
        self.assertEqual(len(self.model.calls), 1)
        self.assertNotIn(self.doc['id'], self.app.documents)

    def test_finish_intent_does_not_force_questions_or_actions(self):
        self.app.chat(self.doc['id'], '', True)
        self.model.reply.update(next_step='finish', response='好的，读到这里就可以。')
        got = self.app.chat(self.doc['id'], '暂时不需要继续', True)
        self.assertEqual(got['analysis']['questions'], [])
        self.assertEqual(got['analysis']['actions'], [])

    def test_failed_or_cancelled_turn_is_not_committed(self):
        self.app.chat(self.doc['id'], '', True)
        before = copy.deepcopy(self.app.documents[self.doc['id']]['conversation'])
        start, release = threading.Event(), threading.Event()
        original = self.model.complete
        def slow(*args):
            start.set(); release.wait(3); return original(*args)
        self.model.complete = slow
        errors = []
        def work():
            try: self.app.chat(self.doc['id'], '合成迟到消息', True)
            except AppError as e: errors.append(e)
        t = threading.Thread(target=work); t.start()
        self.assertTrue(start.wait(2)); self.app.cancel(self.doc['id']); release.set(); t.join(3)
        self.assertEqual(errors[0].status, 409)
        self.assertEqual(self.app.documents[self.doc['id']]['conversation'], before)

    def test_consent_and_message_bounds_checked_before_call(self):
        for message, consent in [('', False), ('字' * 4001, True)]:
            with self.assertRaises(AppError): self.app.chat(self.doc['id'], message, consent)
        self.assertEqual(self.model.calls, [])

    def test_memory_refresh_resets_outdated_conversation(self):
        self.app.chat(self.doc['id'], '', True)
        self.app.refresh_memory(self.doc['id'])
        self.assertEqual(self.app.documents[self.doc['id']]['conversation'], [])

    def test_turn_limit_rejects_before_another_model_call(self):
        self.app.chat(self.doc['id'], '', True)
        for i in range(15):
            self.app.chat(self.doc['id'], f'合成追问{i}', True)
        before = len(self.model.calls)
        with self.assertRaisesRegex(AppError, '容量限制'):
            self.app.chat(self.doc['id'], '超过16轮的合成追问', True)
        self.assertEqual(len(self.model.calls), before)

    def test_invalid_citation_does_not_commit_user_turn_or_assistant_reply(self):
        self.app.chat(self.doc['id'], '', True)
        before = copy.deepcopy(self.app.documents[self.doc['id']]['conversation'])
        self.model.reply['insights'][0]['evidence'][0]['quote'] = '原文中不存在的合成引用'
        with self.assertRaisesRegex(AppError, '引用校验失败'):
            self.app.chat(self.doc['id'], '合成失败消息', True)
        self.assertEqual(self.app.documents[self.doc['id']]['conversation'], before)

if __name__ == '__main__': unittest.main()
