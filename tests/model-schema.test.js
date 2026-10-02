import test from 'node:test';
import assert from 'node:assert/strict';
import { validateInterpretation, validateDraft, SchemaError } from '../src/model-schema.js';
import { parseDocument } from '../src/document.js';

const document = parseDocument({
  filename: 'synthetic-notice.txt',
  mediaType: 'text/plain',
  text: '第一条：截止日期为 10 月 12 日。\n第二条：需分别核对成绩与综测。',
});

const background = [{ id: 'bg-1', content: '已确认关注提交日期' }];

function finding(overrides = {}) {
  return {
    claim: '截止日期值得关注',
    relation: '文件明确给出了日期',
    documentEvidence: { quote: '第一条：截止日期为 10 月 12 日。', lineStart: 1, lineEnd: 1 },
    backgroundEvidence: [],
    kind: 'document',
    uncertainty: '',
    question: '',
    ...overrides,
  };
}

function interpretation(overrides = {}) {
  return {
    findings: [finding()],
    proposedMemory: { content: '本次关注截止日期', source: 'synthetic-notice.txt 第 1 行' },
    unknowns: ['具体提交渠道尚未说明'],
    ...overrides,
  };
}

function expectInvalid(value, matcher) {
  assert.throws(
    () => validateInterpretation(value, { document, background }),
    error => error instanceof SchemaError
      && error.code === 'invalid_response'
      && error.httpStatus === 502
      && matcher.test(error.message),
  );
}

test('validateInterpretation accepts a fully evidenced interpretation', () => {
  const result = validateInterpretation(interpretation(), { document, background });
  assert.equal(result.findings[0].documentEvidence.lineStart, 1);
  assert.deepEqual(result.unknowns, ['具体提交渠道尚未说明']);
});

test('validateInterpretation permits no findings only when unknowns remain', () => {
  const result = validateInterpretation(
    interpretation({ findings: [], unknowns: ['无法从文件判断个人资格'] }),
    { document, background },
  );
  assert.deepEqual(result.findings, []);
  assert.deepEqual(result.unknowns, ['无法从文件判断个人资格']);
});

test('validateInterpretation rejects quotes or line numbers that do not match the source', () => {
  expectInvalid(
    interpretation({ findings: [finding({ documentEvidence: {
      quote: '不存在的原文', lineStart: 1, lineEnd: 1,
    } })] }),
    /quote/,
  );
  expectInvalid(
    interpretation({ findings: [finding({ documentEvidence: {
      quote: '第一条：截止日期为 10 月 12 日。', lineStart: 9, lineEnd: 9,
    } })] }),
    /line/,
  );
  expectInvalid(
    interpretation({ findings: [finding({ documentEvidence: {
      quote: '第一条：截止日期为 10 月 12 日。', lineStart: 1, lineEnd: 2,
    } })] }),
    /quote/,
  );
});

test('validateInterpretation requires kind and uncertainty on every finding', () => {
  expectInvalid(
    interpretation({ findings: [finding({ kind: undefined })] }),
    /kind/,
  );
  expectInvalid(
    interpretation({ findings: [finding({ uncertainty: undefined })] }),
    /uncertainty/,
  );
});

test('validateInterpretation rejects unknown background references', () => {
  expectInvalid(
    interpretation({ findings: [finding({
      kind: 'background',
      backgroundEvidence: [{ id: 'missing-background', quote: 'anything' }],
    })] }),
    /background/i,
  );
  expectInvalid(
    interpretation({ findings: [finding({
      kind: 'background',
      backgroundEvidence: [{ id: 'bg-1', quote: '不匹配的背景' }],
    })] }),
    /background/i,
  );
});

test('validateDraft requires editable content, confirmed inputs, pending items, and disclaimer', () => {
  const valid = {
    draft: '合成草稿，待本人确认',
    usedConfirmedInfo: ['已确认关注提交日期'],
    pendingItems: ['提交渠道'],
    disclaimer: '本稿不代表资格通过或已发送',
  };
  assert.deepEqual(validateDraft(valid), valid);

  for (const key of ['draft', 'usedConfirmedInfo', 'pendingItems', 'disclaimer']) {
    const invalid = { ...valid, [key]: undefined };
    assert.throws(
      () => validateDraft(invalid),
      error => error instanceof SchemaError
        && error.code === 'invalid_response'
        && error.httpStatus === 502
        && error.message.includes(key),
    );
  }
});
