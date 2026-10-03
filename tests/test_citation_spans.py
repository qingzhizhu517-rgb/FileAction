"""合成 PDF 行片段：只恢复排版差异，不用近似匹配放行改写内容。"""
import copy
import unittest

from src.core import AppError, validate_analysis
from tests.test_core import result


class CitationSpanTests(unittest.TestCase):
    def validate(self, segments, quote, sid='P1L1'):
        answer = result()
        answer['insights'][0]['evidence'] = [{'source_id': sid, 'quote': quote}]
        before = copy.deepcopy(segments)
        checked = validate_analysis(answer, segments, ['合成背景'])
        self.assertEqual(segments, before, '不得改写原文以适应模型')
        evidence = checked['insights'][0]['evidence']
        sources = {s['id']: s['text'] for s in segments}
        for item in evidence:
            self.assertIn(item['quote'], sources[item['source_id']])
        return evidence

    def test_pdf_spacing_restores_the_exact_source_slice(self):
        original = '认定须满 5 学分，截止为 2026 年 4 月 30 日。'
        evidence = self.validate([{'id': 'P1L1', 'text': original}],
                                 '认定须满5学分，截止为2026年4月30日。')
        self.assertEqual(evidence, [{'source_id': 'P1L1', 'quote': original}])

    def test_wrapped_pdf_quote_is_split_into_real_source_locations(self):
        segments = [{'id': 'P1L1', 'text': '合成办法：成果认定须提交'},
                    {'id': 'P1L2', 'text': '证明材料，并经公示。'}]
        evidence = self.validate(segments, '成果认定须提交证明材料，并经公示。')
        self.assertEqual(evidence, [{'source_id': 'P1L1', 'quote': '成果认定须提交'},
                                    {'source_id': 'P1L2', 'quote': '证明材料，并经公示。'}])

    def test_english_line_wrap_keeps_word_boundaries(self):
        segments = [{'id': 'P1L1', 'text': 'Complete 5 credits'},
                    {'id': 'P1L2', 'text': 'before April 30.'}]
        evidence = self.validate(segments, 'Complete 5 credits before April 30.')
        self.assertEqual(len(evidence), 2)

    def test_regular_paragraph_spacing_can_be_restored_without_merging_paragraphs(self):
        self.assertEqual(self.validate([{'id': 'P1', 'text': '申请须 5 学分。'}],
                                       '申请须5学分。', 'P1')[0]['quote'], '申请须 5 学分。')
        with self.assertRaises(AppError):
            self.validate([{'id': 'P1', 'text': '申请须'}, {'id': 'P2', 'text': '5学分。'}], '申请须5学分。', 'P1')

    def test_numbers_negation_punctuation_and_word_boundaries_stay_strict(self):
        for source, quote in [('须满5学分。', '须满6学分。'), ('不接受补交。', '接受补交。无需审核。'),
                              ('1 0 学分', '10学分'), ('not eligible', 'noteligible'),
                              ('资格：待核实。', '资格，待核实。'), ('须满5学分。', '需要五个学分。')]:
            with self.subTest(source=source, quote=quote), self.assertRaises(AppError):
                self.validate([{'id': 'P1L1', 'text': source}], quote)

    def test_does_not_stitch_over_skipped_lines_pages_or_unrelated_segments(self):
        for second in ['P1L3', 'P2L1', 'P1URI1']:
            with self.subTest(second=second), self.assertRaises(AppError):
                self.validate([{'id': 'P1L1', 'text': '申请须'}, {'id': second, 'text': '5学分。'}], '申请须5学分。')
        with self.assertRaises(AppError):
            self.validate([{'id': 'P1L1', 'text': '申请须'}, {'id': 'P1L2', 'text': '另有条件。'},
                           {'id': 'P1L3', 'text': '5学分。'}], '申请须5学分。')

    def test_unknown_or_wrong_source_id_is_not_silently_reassigned(self):
        segments = [{'id': 'P1L1', 'text': '合成标题'}, {'id': 'P1L2', 'text': '须满 5 学分。'}]
        for sid in ['P99L1', 'P1L1']:
            with self.subTest(sid=sid), self.assertRaises(AppError):
                self.validate(segments, '须满5学分。', sid)


if __name__ == '__main__':
    unittest.main()
