import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer } from '../src/server.js';

test('status reports supported formats and model configuration without secrets', async t => {
  const dataDir = await mkdtemp(join(tmpdir(), 'fileaction-status-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));

  const running = await startServer({
    port: 0,
    dataDir,
    env: { LLM_API_KEY: 'must-not-leak' },
  });
  t.after(() => running.close());

  const response = await fetch(`${running.baseUrl}/api/status`);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body, {
    status: 'ok',
    supportedFormats: ['text/plain', 'text/markdown'],
    maxBytes: 1048576,
    modelConfigured: false,
    modelEndpoint: null,
    modelName: null,
    modelDataScope: ['documentText', 'providedBackground', 'previousAnswers'],
    bindHost: '127.0.0.1',
  });
  assert.equal(JSON.stringify(body).includes('must-not-leak'), false);
});

test('status discloses safe model endpoint and external data scope without credentials', async t => {
  const dataDir = await mkdtemp(join(tmpdir(), 'fileaction-status-scope-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));

  const running = await startServer({
    port: 0,
    dataDir,
    env: {
      LLM_BASE_URL: 'https://llm.example/v1/chat/completions?token=endpoint-secret',
      LLM_API_KEY: 'must-not-leak',
      LLM_MODEL: 'test-model',
    },
  });
  t.after(() => running.close());

  const response = await fetch(`${running.baseUrl}/api/status`);
  const body = await response.json();
  assert.equal(body.modelConfigured, true);
  assert.equal(body.modelEndpoint, 'https://llm.example/v1/chat/completions');
  assert.equal(body.modelName, 'test-model');
  assert.deepEqual(body.modelDataScope, ['documentText', 'providedBackground', 'previousAnswers']);
  const serialized = JSON.stringify(body);
  assert.equal(serialized.includes('endpoint-secret'), false);
  assert.equal(serialized.includes('must-not-leak'), false);
});

test('unknown route returns a structured 404', async t => {
  const dataDir = await mkdtemp(join(tmpdir(), 'fileaction-404-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const running = await startServer({ port: 0, dataDir, env: {} });
  t.after(() => running.close());

  const response = await fetch(`${running.baseUrl}/missing`);
  assert.equal(response.status, 404);
  const body = await response.json();
  assert.equal(body.error.code, 'not_found');
  assert.equal(typeof body.error.requestId, 'string');
});
