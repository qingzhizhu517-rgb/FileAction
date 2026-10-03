"""合成样例与明确标注的模型替身，仅验证产品逻辑，不代表真实 LLM 验收。"""
import copy
import importlib.util
import io
import json
import tempfile
import threading
import unittest
import zipfile
from pathlib import Path

from src.core import AppError, Application, MemoryStore, parse_document, validate_analysis


NOTICE = '合成奖学金通知\n面向全日制在校本科生。\n申请人须提交项目成果说明和成绩单。\n截止时间为2026年10月20日。'


def result():
    return {'overview': '项目成果可能用于申请，资格仍需确认。', 'insights': [{
        'title': '准备项目成果说明', 'meaning': '你提供的项目经历可能用得上。',
        'document_fact': '须提交项目成果说明和成绩单。', 'background_refs': [0],
        'inference': '项目经历可能成为说明素材。', 'unknown': '成绩与在校身份尚未确认。',
        'evidence': [{'source_id': 'L3', 'quote': '申请人须提交项目成果说明和成绩单。'}]
    }], 'questions': ['你是否为全日制在校本科生？'],
        'memory_candidates': [{'target': 'user', 'content': '完成过一个软件项目', 'reason': '用户本次提供'}],
        'actions': ['材料清单', '申请陈述草稿']}


class MockModel:
    """测试替身：严禁生产端启用。"""
    def __init__(self):
        self.calls = []
        self.reply = result()

    def complete(self, system, payload):
        self.calls.append((system, copy.deepcopy(payload)))
        return copy.deepcopy(self.reply)


class CoreTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.memory = MemoryStore(Path(self.tmp.name) / 'memory.json')
        self.model = MockModel()
        self.app = Application(self.memory, self.model)
        self.doc = self.app.upload('合成通知.txt', NOTICE.encode())

    def tearDown(self):
        self.tmp.cleanup()

    def test_text_and_docx_have_real_source_locations(self):
        parsed = parse_document('notice.md', NOTICE.encode())
        self.assertEqual(parsed['segments'][2]['id'], 'L3')
        stream = io.BytesIO()
        with zipfile.ZipFile(stream, 'w') as z:
            z.writestr('word/document.xml', '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>合成正文</w:t></w:r></w:p></w:body></w:document>')
        self.assertEqual(parse_document('合成.docx', stream.getvalue())['segments'][0]['text'], '合成正文')

    @unittest.skipUnless(importlib.util.find_spec('pypdf'), '未安装 PDF 组件')
    def test_pdf_text_layer_empty_scan_and_encryption(self):
        """合成PDF验证：真实解析组件，不调用OCR或真实个人资料。"""
        from pypdf import PdfWriter
        from pypdf.generic import NameObject, DictionaryObject, DecodedStreamObject
        writer = PdfWriter()
        page = writer.add_blank_page(width=200, height=200)
        font = DictionaryObject({NameObject('/Type'): NameObject('/Font'), NameObject('/Subtype'): NameObject('/Type1'), NameObject('/BaseFont'): NameObject('/Helvetica')})
        page[NameObject('/Resources')] = DictionaryObject({NameObject('/Font'): DictionaryObject({NameObject('/F1'): writer._add_object(font)})})
        stream = DecodedStreamObject()
        stream.set_data(b'BT /F1 12 Tf 10 100 Td (Synthetic scholarship notice) Tj ET')
        page[NameObject('/Contents')] = writer._add_object(stream)
        buffer = io.BytesIO()
        writer.write(buffer)
        parsed = parse_document('synthetic.pdf', buffer.getvalue())
        self.assertIn('Synthetic scholarship', parsed['segments'][0]['text'])
        self.assertEqual(parsed['segments'][0]['id'], 'P1L1')
        writer.encrypt('synthetic-password')
        encrypted = io.BytesIO()
        writer.write(encrypted)
        with self.assertRaisesRegex(AppError, '未加密'):
            parse_document('encrypted.pdf', encrypted.getvalue())
        empty = PdfWriter()
        empty.add_blank_page(width=200, height=200)
        buffer = io.BytesIO()
        empty.write(buffer)
        with self.assertRaisesRegex(AppError, '未提取到文字'):
            parse_document('scan.pdf', buffer.getvalue())

    def test_reject_empty_unsupported_binary_and_long_documents(self):
        for name, data in [('x.txt', b' '), ('x.exe', b'abc'), ('x.txt', b'\xff\x00'), ('x.md', b'a' * 60001), ('x.docx', b'notzip')]:
            with self.subTest(name=name), self.assertRaises(AppError):
                parse_document(name, data)

    def test_citation_must_match_source_not_model_fabrication(self):
        bad = result()
        bad['insights'][0]['evidence'][0]['quote'] = '无需成绩单'
        with self.assertRaises(AppError):
            validate_analysis(bad, self.doc['segments'], ['完成过一个软件项目'])
        bad = result()
        bad['insights'][0]['evidence'][0]['source_id'] = 'L999'
        with self.assertRaises(AppError):
            validate_analysis(bad, self.doc['segments'], ['完成过一个软件项目'])

    def test_reject_nonexistent_background(self):
        bad = result()
        bad['insights'][0]['background_refs'] = [1]
        with self.assertRaises(AppError):
            validate_analysis(bad, self.doc['segments'], ['完成过一个软件项目'])

    def test_analyze_requires_send_consent(self):
        with self.assertRaises(AppError):
            self.app.analyze(self.doc['id'], ['完成过一个软件项目'], False)
        self.assertEqual(self.model.calls, [])

    def test_analyze_does_not_persist_user_answer_or_model_candidates(self):
        got = self.app.analyze(self.doc['id'], ['完成过一个软件项目'], True)
        self.assertEqual(got['analysis']['overview'], result()['overview'])
        self.assertEqual(self.memory.snapshot()['entries'], [])
        self.assertFalse(self.memory.path.exists())

    def test_no_background_is_allowed(self):
        self.model.reply['insights'][0]['background_refs'] = []
        self.app.analyze(self.doc['id'], [], True)
        self.assertEqual(self.model.calls[0][1]['background'], [])

    def test_action_requires_analysis_and_user_confirmation(self):
        with self.assertRaises(AppError):
            self.app.action(self.doc['id'], 0, '材料清单', False, True)
        analyzed = self.app.analyze(self.doc['id'], ['完成过一个软件项目'], True)
        with self.assertRaises(AppError):
            self.app.action(self.doc['id'], analyzed['revision'], '材料清单', False, True)
        self.model.reply = {'title': '申请材料清单', 'markdown': '# 申请材料清单\n\n- [ ] 项目成果说明\n- [ ] 成绩单\n\n资格待核实。'}
        got = self.app.action(self.doc['id'], analyzed['revision'], '材料清单', True, True)
        self.assertIn('成绩单', got['draft']['markdown'])
        self.assertIn('完成过一个软件项目', self.model.calls[-1][1]['background'])

    def test_reanalysis_invalidates_previous_action_revision(self):
        first = self.app.analyze(self.doc['id'], ['完成过一个软件项目'], True)
        self.app.analyze(self.doc['id'], ['完成过两个软件项目'], True)
        with self.assertRaises(AppError):
            self.app.action(self.doc['id'], first['revision'], '材料清单', True, True)

    def test_cancel_does_not_accept_late_model_response(self):
        started, release = threading.Event(), threading.Event()
        original = self.model.complete
        def delayed(system, payload):
            started.set()
            release.wait(3)
            return original(system, payload)
        self.model.complete = delayed
        errors = []
        def work():
            try:
                self.app.analyze(self.doc['id'], ['完成过一个软件项目'], True)
            except AppError as e:
                errors.append(e)
        t = threading.Thread(target=work)
        t.start()
        self.assertTrue(started.wait(2))
        self.app.cancel(self.doc['id'])
        release.set()
        t.join(3)
        self.assertEqual(errors[0].status, 409)

    def test_model_failure_propagates_without_fake_result(self):
        def fail(*args):
            raise AppError('模型连接失败', 502)
        self.model.complete = fail
        with self.assertRaisesRegex(AppError, '模型连接失败'):
            self.app.analyze(self.doc['id'], [], True)

    def test_memory_requires_explicit_save_consent(self):
        with self.assertRaises(AppError):
            self.memory.apply('add', 'user', '本科生', consent=False)
        self.assertFalse(self.memory.path.exists())

    def test_memory_persists_deduplicates_and_exactly_updates(self):
        a = self.memory.apply('add', 'user', '本科生', consent=True, source='用户确认')
        self.memory.apply('add', 'user', '本科生', consent=True)
        self.assertEqual(len(self.memory.snapshot()['entries']), 1)
        uid = a['entries'][0]['id']
        self.memory.apply('replace', 'user', '研究生', entry_id=uid, consent=True)
        loaded = MemoryStore(self.memory.path)
        self.assertEqual(loaded.snapshot()['entries'][0]['content'], '研究生')
        loaded.apply('remove', 'user', entry_id=uid, consent=True)
        self.assertEqual(loaded.snapshot()['entries'], [])

    def test_memory_overflow_rejects_without_overwriting(self):
        self.memory.apply('add', 'user', '本科生', consent=True)
        before = self.memory.path.read_bytes()
        with self.assertRaises(AppError):
            self.memory.apply('add', 'user', '文' * 1376, consent=True)
        self.assertEqual(self.memory.path.read_bytes(), before)

    def test_memory_frozen_until_explicit_refresh(self):
        self.memory.apply('add', 'user', '本科生', consent=True)
        self.model.reply['insights'][0]['background_refs'] = []
        self.app.analyze(self.doc['id'], [], True)
        self.assertEqual(self.model.calls[-1][1]['memory'], [])
        self.app.refresh_memory(self.doc['id'])
        self.app.analyze(self.doc['id'], [], True)
        self.assertEqual(self.model.calls[-1][1]['memory'][0]['content'], '本科生')

    def test_forget_removes_document(self):
        self.app.forget(self.doc['id'])
        with self.assertRaises(AppError):
            self.app.analyze(self.doc['id'], [], True)


if __name__ == '__main__':
    unittest.main()
