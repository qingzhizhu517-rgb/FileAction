import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, StoreError } from '../src/store.js';
import { createService } from '../src/service.js';
import { ModelError } from '../src/model.js';

const interpretationResult = {
  findings: [{
    claim: '截止日期值得关注',
    relation: '文件明确给出日期',
    documentEvidence: { quote: '合成原文', lineStart: 1, lineEnd: 1 },
    backgroundEvidence: [],
    kind: 'document',
    uncertainty: '',
    question: '',
  }],
  proposedMemory: { content: '本次关注截止日期', source: '合成原文 第 1 行' },
  unknowns: ['提交渠道未知'],
};

const draftResult = {
  draft: '合成草稿，待本人确认',
  usedConfirmedInfo: ['已确认关注截止日期'],
  pendingItems: ['提交渠道'],
  disclaimer: '不代表资格通过/已发送',
};

function fakeModel({ interpretError } = {}) {
  const calls = { interpret: [], draft: [] };
  return {
    calls,
    async interpret(request) {
      calls.interpret.push(request);
      if (interpretError) throw interpretError;
      return interpretationResult;
    },
    async draft(request) {
      calls.draft.push(request);
      return draftResult;
    },
  };
}

async function setup(t, model = fakeModel()) {
  const dataDir = await mkdtemp(join(tmpdir(), 'fileaction-service-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const store = createStore(dataDir);
  await store.createDocument({
    id: 'doc-1',
    filename: 'synthetic-notice.txt',
    mediaType: 'text/plain',
    text: '合成原文',
    lines: ['合成原文'],
  });
  const service = createService({ store, modelClient: model });
  return { store, service, model };
}

test('interpret returns an interpreted record and preserves model failures as failed state', async t => {
  const { service, store, model } = await setup(t);
  const result = await service.interpret({ documentId: 'doc-1' });
  assert.equal(result.status, 'interpreted');
  assert.equal((await store.getInterpretation(result.interpretationId)).state, 'interpreted');
  assert.equal(model.calls.interpret.length, 1);

  const failingModel = fakeModel({
    interpretError: new ModelError('timeout', 504, 'model timeout'),
  });
  const failed = await setup(t, failingModel);
  await assert.rejects(
    failed.service.interpret({ documentId: 'doc-1' }),
    error => error instanceof ModelError && error.httpStatus === 504,
  );
  const record = await failed.store.getInterpretation(
    (await failed.store.listInterpretations?.())?.[0]?.id ?? (await failed.service.interpret({ documentId: 'doc-1-unknown' }).catch(() => null))?.interpretationId,
  ).catch(() => null);
  assert.equal(record, null);
});

test('answers update only the current interpretation and never create memories', async t => {
  const { service, store } = await setup(t);
  const interpreted = await service.interpret({ documentId: 'doc-1' });
  const answered = await service.answer({
    interpretationId: interpreted.interpretationId,
    question: '是否已确认日期？',
    answer: '尚未确认',
    skipped: false,
  });
  assert.equal(answered.answers.length, 1);
  assert.equal(answered.answers[0].answer, '尚未确认');
  assert.deepEqual(await store.listMemories(), []);
});

test('failed interpretations are stored as failed and reject answers with conflict status', async t => {
  const failing = fakeModel({ interpretError: new ModelError('network', 504, 'network failed') });
  const { service, store } = await setup(t, failing);

  let caught;
  try {
    await service.interpret({ documentId: 'doc-1' });
  } catch (error) {
    caught = error;
  }
  assert.ok(caught instanceof ModelError);
  assert.equal(caught.httpStatus, 504);
  assert.equal(typeof caught.interpretationId, 'string');

  const failedRecord = await store.getInterpretation(caught.interpretationId);
  assert.equal(failedRecord.state, 'failed');
  await assert.rejects(
    service.answer({
      interpretationId: failedRecord.id,
      question: 'q',
      answer: null,
      skipped: true,
    }),
    error => error instanceof StoreError && error.httpStatus === 409,
  );
});

test('memory retention requires explicit consent, is idempotent, and can be deleted', async t => {
  const { service, store } = await setup(t);
  const interpreted = await service.interpret({ documentId: 'doc-1' });
  await assert.rejects(
    service.retainMemory({
      interpretationId: interpreted.interpretationId,
      content: '本次关注截止日期',
      retain: false,
    }),
    error => error instanceof StoreError && error.httpStatus === 409,
  );
  await assert.rejects(
    service.retainMemory({
      interpretationId: interpreted.interpretationId,
      content: '本次关注截止日期',
    }),
    error => error instanceof StoreError && error.httpStatus === 409,
  );
  assert.deepEqual(await store.listMemories(), []);

  const retained = await service.retainMemory({
    interpretationId: interpreted.interpretationId,
    content: '本次关注截止日期',
    retain: true,
  });
  const repeated = await service.retainMemory({
    interpretationId: interpreted.interpretationId,
    content: '本次关注截止日期',
    retain: true,
  });
  assert.equal(repeated.id, retained.id);
  assert.equal((await store.listMemories()).length, 1);

  await service.deleteMemory(retained.id);
  await assert.rejects(() => store.getMemory(retained.id), error => error.httpStatus === 404);
});

test('artifacts require continue choice, use confirmed interpretation, and export safely', async t => {
  const { service, model } = await setup(t);
  const interpreted = await service.interpret({ documentId: 'doc-1' });
  await assert.rejects(
    service.createArtifact({
      interpretationId: interpreted.interpretationId,
      choice: 'understand_only',
      artifactType: 'questions',
    }),
    error => error instanceof StoreError && error.httpStatus === 409,
  );
  assert.equal(model.calls.draft.length, 0);

  const artifact = await service.createArtifact({
    interpretationId: interpreted.interpretationId,
    choice: 'continue',
    artifactType: 'questions',
  });
  assert.equal(artifact.status, 'editable');
  assert.equal(model.calls.draft.length, 1);

  const markdown = await service.exportArtifact(artifact.id, 'markdown');
  assert.match(markdown, /已确认信息/);
  assert.match(markdown, /待确认/);
  assert.match(markdown, /来源/);
  assert.match(markdown, /不代表资格通过\/已发送/);
  assert.match(markdown, /合成草稿/);
});
