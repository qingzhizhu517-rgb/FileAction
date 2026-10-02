import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDocument, lineText, DocumentError } from '../src/document.js';

test('parseDocument accepts matching TXT and Markdown inputs and preserves line positions', () => {
  const txt = parseDocument({
    filename: 'notice.txt',
    mediaType: 'text/plain',
    text: '\uFEFF第一行\n\n第三行',
  });
  assert.equal(txt.mediaType, 'text/plain');
  assert.deepEqual(txt.lines, ['第一行', '', '第三行']);
  assert.equal(txt.bytes, new TextEncoder().encode(txt.text).length);
  assert.match(txt.sha256, /^[a-f0-9]{64}$/);

  const markdown = parseDocument({
    filename: 'guide.md',
    mediaType: 'text/markdown',
    text: '# 标题\n正文',
  });
  assert.equal(markdown.mediaType, 'text/markdown');
  assert.deepEqual(markdown.lines, ['# 标题', '正文']);
});

test('lineText returns exact one-line and cross-line slices with 1-based lines', () => {
  const document = parseDocument({
    filename: 'notice.txt',
    mediaType: 'text/plain',
    text: 'alpha\nbeta\ngamma',
  });
  assert.equal(lineText(document, 2, 2), 'beta');
  assert.equal(lineText(document, 1, 3), 'alpha\nbeta\ngamma');
  assert.throws(() => lineText(document, 0, 1), /lineStart/);
  assert.throws(() => lineText(document, 2, 4), /lineEnd/);
});

test('parseDocument rejects mismatched extension and media type before storing data', () => {
  assert.throws(
    () => parseDocument({ filename: 'notice.pdf', mediaType: 'text/plain', text: 'x' }),
    error => error instanceof DocumentError && error.code === 'invalid_format',
  );
  assert.throws(
    () => parseDocument({ filename: 'notice.txt', mediaType: 'application/pdf', text: 'x' }),
    error => error instanceof DocumentError && error.code === 'invalid_format',
  );
});

test('parseDocument enforces the 1 MiB UTF-8 limit', () => {
  assert.throws(
    () => parseDocument({
      filename: 'large.txt',
      mediaType: 'text/plain',
      text: 'a'.repeat(1048577),
    }),
    error => error instanceof DocumentError && error.code === 'too_large',
  );
  assert.throws(
    () => parseDocument({
      filename: 'binary.txt',
      mediaType: 'text/plain',
      text: 'before\u0000after',
    }),
    error => error instanceof DocumentError && error.code === 'invalid_encoding',
  );
});

test('parseDocument hashes content deterministically while ids stay unique', () => {
  const input = { filename: 'same.txt', mediaType: 'text/plain', text: 'same content' };
  const first = parseDocument(input);
  const second = parseDocument(input);
  assert.equal(first.sha256, second.sha256);
  assert.notEqual(first.id, second.id);
});
