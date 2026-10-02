import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, StoreError } from '../src/store.js';

async function withStore(t) {
  const dataDir = await mkdtemp(join(tmpdir(), 'fileaction-store-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  return { store: createStore(dataDir), dataDir };
}

test('store creates and reads typed JSON records', async t => {
  const { store } = await withStore(t);
  const document = { id: 'doc-1', filename: 'notice.txt', text: '合成原文', lines: ['合成原文'] };
  await store.createDocument(document);
  assert.deepEqual(await store.getDocument('doc-1'), document);

  const interpretation = { id: 'int-1', documentId: 'doc-1', state: 'interpreted', findings: [] };
  await store.createInterpretation(interpretation);
  assert.deepEqual(await store.getInterpretation('int-1'), interpretation);
});

test('store raises 404-style errors for unknown records and deleted memories', async t => {
  const { store } = await withStore(t);
  for (const read of [
    () => store.getDocument('missing'),
    () => store.getInterpretation('missing'),
    () => store.getMemory('missing'),
    () => store.getArtifact('missing'),
    () => store.deleteMemory('missing'),
  ]) {
    await assert.rejects(read, error => error instanceof StoreError && error.httpStatus === 404);
  }

  await store.createMemory({ id: 'mem-1', interpretationId: 'int-1', content: '保留内容' });
  await store.deleteMemory('mem-1');
  await assert.rejects(() => store.getMemory('mem-1'), error => error instanceof StoreError);
});

test('store serializes concurrent updates without losing increments', async t => {
  const { store } = await withStore(t);
  await store.createInterpretation({ id: 'int-1', count: 0 });
  await Promise.all(Array.from({ length: 12 }, () => store.updateInterpretation(
    'int-1',
    value => ({ ...value, count: value.count + 1 }),
  )));
  const result = await store.getInterpretation('int-1');
  assert.equal(result.count, 12);
});

test('store data contains no model configuration secrets', async t => {
  const { store, dataDir } = await withStore(t);
  await store.createDocument({ id: 'doc-1', text: '合成正文' });
  const raw = await readFile(join(dataDir, 'documents', 'doc-1.json'), 'utf8');
  assert.equal(raw.includes('LLM_API_KEY'), false);
  assert.equal(raw.includes('test-secret-key'), false);
});
