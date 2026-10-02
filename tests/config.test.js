import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.js';
import { createLogger } from '../src/logger.js';

test('loadConfig provides local defaults without model configuration', () => {
  const config = loadConfig({});
  assert.equal(config.host, '127.0.0.1');
  assert.equal(config.port, 8788);
  assert.equal(config.dataDir, 'var');
  assert.deepEqual(config.llm, {
    configured: false,
    baseUrl: null,
    apiKey: null,
    model: null,
    timeoutMs: 30000,
  });
  assert.equal(typeof config.port, 'number');
});

test('loadConfig marks the model configured only when all required values exist', () => {
  const config = loadConfig({
    LLM_BASE_URL: 'https://llm.example/v1/chat/completions',
    LLM_API_KEY: 'test-secret',
    LLM_MODEL: 'test-model',
    LLM_TIMEOUT_MS: '1250',
  });
  assert.equal(config.llm.configured, true);
  assert.equal(config.llm.baseUrl, 'https://llm.example/v1/chat/completions');
  assert.equal(config.llm.apiKey, 'test-secret');
  assert.equal(config.llm.model, 'test-model');
  assert.equal(config.llm.timeoutMs, 1250);
});

test('loadConfig rejects missing model variables as unconfigured and invalid numbers as errors', () => {
  assert.equal(loadConfig({
    LLM_BASE_URL: 'https://llm.example/v1/chat/completions',
    LLM_API_KEY: 'test-secret',
  }).llm.configured, false);
  assert.throws(() => loadConfig({ PORT: 'not-a-port' }), /PORT/);
  assert.throws(() => loadConfig({ LLM_TIMEOUT_MS: '0' }), /LLM_TIMEOUT_MS/);
});

test('loadConfig and createLogger never expose API keys', () => {
  const config = loadConfig({ LLM_API_KEY: 'do-not-log-this' });
  assert.equal('logger' in config, false);
  assert.equal(typeof config.logger, 'undefined');

  const lines = [];
  const logger = createLogger(line => lines.push(line));
  logger.error({ event: 'startup', message: 'failed', apiKey: 'do-not-log-this' });
  assert.equal(lines.length, 1);
  assert.equal(lines[0].includes('do-not-log-this'), false);
});
