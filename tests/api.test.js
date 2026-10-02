import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer } from '../src/server.js';
import { createModelClient, ModelError } from '../src/model.js';
import { parseDocument } from '../src/document.js';

const VALID_INTERPRETATION = {
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

const VALID_DRAFT = {
  draft: '合成草稿，待本人确认',
  usedConfirmedInfo: ['已确认关注截止日期'],
  pendingItems: ['提交渠道'],
  disclaimer: '不代表资格通过/已发送',
};

async function start(t, options = {}) {
  const dataDir = await mkdtemp(join(tmpdir(), 'fileaction-api-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const running = await startServer({
    port: 0,
    dataDir,
    env: options.env ?? {},
    modelClient: options.modelClient,
    logSink: options.logSink ?? (() => {}),
  });
  t.after(() => running.close());
  return { ...running, dataDir };
}

function successModel() {
  const calls = { interpret: 0, draft: 0 };
  return {
    calls,
    async interpret() {
      calls.interpret += 1;
      return VALID_INTERPRETATION;
    },
    async draft() {
      calls.draft += 1;
      return VALID_DRAFT;
    },
  };
}

async function request(running, path, options = {}) {
  const response = await fetch(`${running.baseUrl}${path}`, options);
  const contentType = response.headers.get('content-type') ?? '';
  const body = contentType.includes('application/json')
    ? await response.json()
    : await response.text();
  return { response, body };
}

async function postJson(running, path, value) {
  return request(running, path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(value),
  });
}

async function createDocument(running, text = '合成原文') {
  const { response, body } = await postJson(running, '/api/documents', {
    filename: 'synthetic-notice.txt',
    mediaType: 'text/plain',
    text,
  });
  assert.equal(response.status, 201);
  return body.documentId;
}

function assertStructuredError(result, status, code) {
  assert.equal(result.response.status, status);
  assert.equal(result.body.error.code, code);
  assert.equal(typeof result.body.error.message, 'string');
  assert.equal(typeof result.body.error.requestId, 'string');
}

test('documents endpoint accepts valid input and rejects empty, wrong-format, oversized, or unknown fields', async t => {
  const running = await start(t);
  const documentId = await createDocument(running);
  assert.equal(typeof documentId, 'string');

  assertStructuredError(
    await postJson(running, '/api/documents', {
      filename: 'empty.txt', mediaType: 'text/plain', text: '',
    }),
    400,
    'invalid_request',
  );
  assertStructuredError(
    await postJson(running, '/api/documents', {
      filename: 'notice.pdf', mediaType: 'text/plain', text: 'x',
    }),
    400,
    'invalid_format',
  );
  assertStructuredError(
    await postJson(running, '/api/documents', {
      filename: 'large.txt', mediaType: 'text/plain', text: 'a'.repeat(1048577),
    }),
    413,
    'too_large',
  );
  assertStructuredError(
    await postJson(running, '/api/documents', {
      filename: 'notice.txt', mediaType: 'text/plain', text: 'x', unexpected: true,
    }),
    400,
    'unknown_field',
  );

  const entries = await readdir(join(running.dataDir, 'documents')).catch(() => []);
  assert.equal(entries.length, 1);
});

test('interpretations endpoint maps model configuration, invalid references, and timeout explicitly', async t => {
  const unconfigured = await start(t);
  const documentId = await createDocument(unconfigured);
  assertStructuredError(
    await postJson(unconfigured, '/api/interpretations', { documentId }),
    503,
    'not_configured',
  );

  const document = parseDocument({
    filename: 'synthetic-notice.txt',
    mediaType: 'text/plain',
    text: '合成原文',
  });
  const badFetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      choices: [{
        message: {
          content: JSON.stringify({
            ...VALID_INTERPRETATION,
            findings: [{
              ...VALID_INTERPRETATION.findings[0],
              documentEvidence: { quote: '错误引用', lineStart: 1, lineEnd: 1 },
            }],
          }),
        },
      }],
    }),
  });
  const badModel = createModelClient({
    configured: true,
    baseUrl: 'https://llm.example/chat/completions',
    apiKey: 'api-key-secret',
    model: 'test-model',
    timeoutMs: 1000,
  }, badFetch);
  const bad = await start(t, { modelClient: badModel });
  const badDocumentId = await createDocument(bad);
  assertStructuredError(
    await postJson(bad, '/api/interpretations', { documentId: badDocumentId }),
    502,
    'invalid_response',
  );

  const timeoutModel = {
    async interpret() {
      throw new ModelError('timeout', 504, 'model timeout');
    },
  };
  const timeout = await start(t, { modelClient: timeoutModel });
  const timeoutDocumentId = await createDocument(timeout);
  assertStructuredError(
    await postJson(timeout, '/api/interpretations', { documentId: timeoutDocumentId }),
    504,
    'timeout',
  );
  assert.ok(document);
});

test('successful interpretation, answers, explicit retention, list, and deletion stay separated', async t => {
  const model = successModel();
  const logs = [];
  const running = await start(t, { modelClient: model, logSink: line => logs.push(line) });
  const documentId = await createDocument(running, '合成背景正文');

  const interpreted = await postJson(running, '/api/interpretations', {
    documentId,
    background: [{ id: 'bg-1', content: '已确认关注日期' }],
    previousAnswers: [],
  });
  assert.equal(interpreted.response.status, 200);
  const interpretationId = interpreted.body.interpretationId;
  assert.equal(interpreted.body.status, 'interpreted');

  const answered = await postJson(
    running,
    `/api/interpretations/${interpretationId}/answers`,
    { question: '是否已确认日期？', answer: '尚未确认', skipped: false },
  );
  assert.equal(answered.response.status, 200);
  assert.equal(answered.body.answers.length, 1);

  let memories = await request(running, '/api/memories');
  assert.equal(memories.response.status, 200);
  assert.deepEqual(memories.body, { memories: [] });

  assertStructuredError(
    await postJson(running, '/api/memories', {
      interpretationId, content: '本次关注截止日期', retain: false,
    }),
    409,
    'conflict',
  );

  const retained = await postJson(running, '/api/memories', {
    interpretationId, content: '本次关注截止日期', retain: true,
  });
  assert.equal(retained.response.status, 201);
  memories = await request(running, '/api/memories');
  assert.equal(memories.body.memories.length, 1);

  const deleted = await request(running, `/api/memories/${retained.body.memoryId}`, {
    method: 'DELETE',
  });
  assert.equal(deleted.response.status, 204);
  memories = await request(running, '/api/memories');
  assert.deepEqual(memories.body, { memories: [] });

  const logText = logs.join('\n');
  assert.equal(logText.includes('合成背景正文'), false);
  assert.equal(logText.includes('已确认关注日期'), false);
  assert.equal(logText.includes('api-key-secret'), false);
});

test('artifacts require continue choice and expose editable markdown export', async t => {
  const model = successModel();
  const running = await start(t, { modelClient: model });
  const documentId = await createDocument(running);
  const interpreted = await postJson(running, '/api/interpretations', { documentId });
  const interpretationId = interpreted.body.interpretationId;

  assertStructuredError(
    await postJson(running, '/api/artifacts', {
      interpretationId, choice: 'understand_only', artifactType: 'questions',
    }),
    409,
    'conflict',
  );
  assert.equal(model.calls.draft, 0);

  const created = await postJson(running, '/api/artifacts', {
    interpretationId, choice: 'continue', artifactType: 'questions',
  });
  assert.equal(created.response.status, 201);
  assert.equal(created.body.status, 'editable');
  assert.equal(model.calls.draft, 1);

  const exported = await request(
    running,
    `/api/artifacts/${created.body.artifactId}/export?format=markdown`,
  );
  assert.equal(exported.response.status, 200);
  assert.match(exported.body, /模型初稿/);
  assert.match(exported.body, /已确认信息/);
  assert.match(exported.body, /待确认事项/);
  assert.match(exported.body, /不代表资格通过\/已发送/);
});

test('CLI entry starts local status server and exits cleanly on SIGTERM', async t => {
  const dataDir = await mkdtemp(join(tmpdir(), 'fileaction-cli-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));

  const probe = createServer();
  const port = await new Promise((resolve, reject) => {
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      probe.close(() => resolve(address.port));
    });
  });

  const env = { ...process.env, PORT: String(port), DATA_DIR: dataDir };
  delete env.LLM_BASE_URL;
  delete env.LLM_API_KEY;
  delete env.LLM_MODEL;

  const repoVar = join(process.cwd(), 'var');
  const varExisted = existsSync(repoVar);
  const child = spawn(process.execPath, ['src/server.js'], {
    cwd: process.cwd(),
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk.toString(); });
  const exited = new Promise(resolve => {
    child.once('exit', (code, signal) => resolve({ code, signal }));
  });
  t.after(() => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  });

  const deadline = Date.now() + 5000;
  let status;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`server exited before status: code=${child.exitCode} signal=${child.signalCode} stderr=${stderr}`);
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/status`);
      if (response.ok) {
        status = await response.json();
        break;
      }
    } catch {
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  }
  assert.ok(status, `status endpoint did not become ready: ${stderr}`);
  assert.equal(status.status, 'ok');
  assert.equal(status.bindHost, '127.0.0.1');

  child.kill('SIGTERM');
  const exit = await exited;
  assert.equal(exit.code, 0, `expected clean exit, got code=${exit.code} signal=${exit.signal} stderr=${stderr}`);
  assert.equal(existsSync(repoVar), varExisted);
});
