import test from 'node:test';
import assert from 'node:assert/strict';
import { createModelClient, ModelError } from '../src/model.js';
import { parseDocument } from '../src/document.js';

const document = parseDocument({
  filename: 'synthetic-notice.txt',
  mediaType: 'text/plain',
  text: '第一条：截止日期为 10 月 12 日。\n第二条：需分别核对成绩与综测。',
});

const validInterpretation = {
  findings: [{
    claim: '截止日期值得关注',
    relation: '文件明确给出了日期',
    documentEvidence: { quote: '第一条：截止日期为 10 月 12 日。', lineStart: 1, lineEnd: 1 },
    backgroundEvidence: [],
    kind: 'document',
    uncertainty: '',
    question: '',
  }],
  proposedMemory: { content: '本次关注截止日期', source: 'synthetic-notice.txt 第 1 行' },
  unknowns: ['具体提交渠道尚未说明'],
};

function responseFor(value, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => ({ choices: [{ message: { content: JSON.stringify(value) } }] }),
  };
}

function baseConfig(overrides = {}) {
  return {
    configured: true,
    baseUrl: 'https://llm.example/v1/chat/completions',
    apiKey: 'test-secret-key',
    model: 'test-model',
    timeoutMs: 30000,
    ...overrides,
  };
}

test('createModelClient fails explicitly when model configuration is incomplete', async () => {
  const client = createModelClient(baseConfig({ configured: false, apiKey: null }));
  await assert.rejects(
    client.interpret({ document, background: [], previousAnswers: [] }),
    error => error instanceof ModelError
      && error.code === 'not_configured'
      && error.httpStatus === 503,
  );
});

test('createModelClient sends document, background, answers, and strict JSON instructions without the API key', async () => {
  let captured;
  const fetchImpl = async (url, init) => {
    captured = { url, init };
    return responseFor(validInterpretation);
  };
  const client = createModelClient(baseConfig(), fetchImpl);
  await client.interpret({
    document,
    background: [{ id: 'bg-1', content: '已确认关注提交日期' }],
    previousAnswers: [{ question: '是否已确认日期？', answer: '尚未确认', skipped: false }],
  });

  assert.equal(captured.url, 'https://llm.example/v1/chat/completions');
  const bodyText = captured.init.body;
  const body = JSON.parse(bodyText);
  assert.equal(body.model, 'test-model');
  assert.match(bodyText, /synthetic-notice\.txt/);
  assert.match(bodyText, /已确认关注提交日期/);
  assert.match(bodyText, /尚未确认/);
  assert.match(bodyText, /JSON/);
  assert.equal(bodyText.includes('test-secret-key'), false);
  assert.equal(captured.init.headers.authorization, 'Bearer test-secret-key');
  assert.equal(typeof captured.init.signal, 'object');
});

test('non-2xx model responses become network failures without echoing secrets', async () => {
  const client = createModelClient(
    baseConfig(),
    async () => ({ ok: false, status: 500, text: async () => 'test-secret-key leaked upstream' }),
  );
  await assert.rejects(
    client.interpret({ document, background: [], previousAnswers: [] }),
    error => error instanceof ModelError
      && error.code === 'network'
      && error.httpStatus === 504
      && !error.message.includes('test-secret-key'),
  );
});

test('model timeout aborts the request and reports timeout', async () => {
  const client = createModelClient(
    baseConfig({ timeoutMs: 5 }),
    (url, init) => new Promise((resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
    }),
  );
  await assert.rejects(
    client.interpret({ document, background: [], previousAnswers: [] }),
    error => error instanceof ModelError
      && error.code === 'timeout'
      && error.httpStatus === 504,
  );
});

test('model timeout also covers response body parsing', async () => {
  let capturedInit;
  const client = createModelClient(
    baseConfig({ timeoutMs: 5 }),
    async (url, init) => {
      capturedInit = init;
      return {
        ok: true,
        status: 200,
        json: () => new Promise((resolve, reject) => {
          init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
        }),
      };
    },
  );

  const outcome = await Promise.race([
    client.interpret({ document, background: [], previousAnswers: [] })
      .then(() => ({ settled: true, error: null }))
      .catch(error => ({ settled: true, error })),
    new Promise(resolve => setTimeout(() => resolve({ settled: false, error: null }), 100)),
  ]);
  assert.ok(capturedInit);
  assert.equal(outcome.settled, true);
  assert.ok(outcome.error instanceof ModelError);
  assert.equal(outcome.error.code, 'timeout');
});

test('createModelClient validates interpretation and draft JSON content', async () => {
  let call = 0;
  const client = createModelClient(baseConfig(), async () => {
    call += 1;
    return call === 1
      ? responseFor(validInterpretation)
      : responseFor({
        draft: '合成草稿，待本人确认',
        usedConfirmedInfo: ['已确认关注提交日期'],
        pendingItems: ['提交渠道'],
        disclaimer: '本稿不代表资格通过或已发送',
      });
  });

  const interpretation = await client.interpret({
    document,
    background: [],
    previousAnswers: [],
  });
  assert.equal(interpretation.findings.length, 1);

  const draft = await client.draft({
    document,
    interpretation,
    artifactType: 'questions',
  });
  assert.equal(draft.usedConfirmedInfo.length, 1);
});
