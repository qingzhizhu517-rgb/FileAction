import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadConfig } from './config.js';
import { createLogger } from './logger.js';
import { DocumentError, parseDocument } from './document.js';
import { createStore, StoreError } from './store.js';
import { createService } from './service.js';
import { createModelClient, ModelError } from './model.js';
import { SchemaError } from './model-schema.js';

const MAX_BYTES = 1048576;
const SUPPORTED_FORMATS = Object.freeze(['text/plain', 'text/markdown']);
const MODEL_DATA_SCOPE = Object.freeze(['documentText', 'providedBackground', 'previousAnswers']);

function safeModelEndpoint(value) {
  if (!value) return null;
  try {
    const url = new URL(value);
    url.username = '';
    url.password = '';
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
}

class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
  }
}

function sendJson(response, status, body) {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
  });
  response.end(payload);
}

function sendText(response, status, contentType, text) {
  response.writeHead(status, {
    'content-type': contentType,
    'content-length': Buffer.byteLength(text),
    'cache-control': 'no-store',
  });
  response.end(text);
}

function errorBody(requestId, code, message) {
  return { error: { code, message, requestId } };
}

function assertFields(body, allowed) {
  const unknown = Object.keys(body).find(key => !allowed.includes(key));
  if (unknown) throw new HttpError(400, 'unknown_field', `Unknown request field: ${unknown}`);
}

function requireString(value, field) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new HttpError(400, 'invalid_request', `${field} must be a non-empty string`);
  }
  return value;
}

function readJsonBody(request, maxBytes = MAX_BYTES) {
  const contentType = request.headers['content-type'] ?? '';
  if (!contentType.toLowerCase().startsWith('application/json')) {
    throw new HttpError(415, 'unsupported_media_type', 'Content-Type must be application/json');
  }

  return new Promise((resolve, reject) => {
    const chunks = [];
    let bytes = 0;
    let settled = false;

    function fail(error) {
      if (settled) return;
      settled = true;
      request.removeListener('data', onData);
      request.removeListener('end', onEnd);
      request.removeListener('error', onError);
      request.resume();
      reject(error);
    }

    function onData(chunk) {
      bytes += chunk.length;
      if (bytes > maxBytes) {
        fail(new HttpError(413, 'too_large', `Request body exceeds ${maxBytes} bytes`));
        return;
      }
      chunks.push(chunk);
    }

    function onEnd() {
      if (settled) return;
      settled = true;
      const text = Buffer.concat(chunks).toString('utf8');
      if (!text) {
        reject(new HttpError(400, 'invalid_request', 'JSON request body is required'));
        return;
      }
      try {
        const value = JSON.parse(text);
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
          reject(new HttpError(400, 'invalid_request', 'JSON request body must be an object'));
          return;
        }
        resolve(value);
      } catch {
        reject(new HttpError(400, 'invalid_json', 'Request body is not valid JSON'));
      }
    }

    function onError(error) {
      fail(new HttpError(400, 'invalid_request', `Request stream failed: ${error.name}`));
    }

    request.on('data', onData);
    request.once('end', onEnd);
    request.once('error', onError);
  });
}

function validateBackground(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new HttpError(400, 'invalid_request', 'background must be an array');
  return value.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new HttpError(400, 'invalid_request', `background[${index}] must be an object`);
    }
    requireString(item.id, `background[${index}].id`);
    requireString(item.content, `background[${index}].content`);
    return { id: item.id, content: item.content };
  });
}

function validatePreviousAnswers(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new HttpError(400, 'invalid_request', 'previousAnswers must be an array');
  }
  return value.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new HttpError(400, 'invalid_request', `previousAnswers[${index}] must be an object`);
    }
    requireString(item.question, `previousAnswers[${index}].question`);
    if (item.answer !== null && item.answer !== undefined && typeof item.answer !== 'string') {
      throw new HttpError(400, 'invalid_request', `previousAnswers[${index}].answer must be a string or null`);
    }
    return {
      question: item.question,
      answer: item.answer ?? null,
      skipped: Boolean(item.skipped),
    };
  });
}

function mapError(error) {
  if (error instanceof HttpError) return { status: error.status, code: error.code, message: error.message };
  if (error instanceof DocumentError) {
    return {
      status: error.code === 'too_large' ? 413 : 400,
      code: error.code,
      message: error.message,
    };
  }
  if (error instanceof StoreError) {
    return { status: error.httpStatus, code: error.code, message: error.message };
  }
  if (error instanceof ModelError) {
    return { status: error.httpStatus, code: error.code, message: error.message };
  }
  if (error instanceof SchemaError) {
    return { status: error.httpStatus, code: error.code, message: error.message };
  }
  return { status: 500, code: 'internal_error', message: 'Internal server error' };
}

async function handleRequest({ request, response, requestId, store, service, config, logger }) {
  const url = new URL(request.url, `http://${config.host}`);
  const pathname = url.pathname;
  logger.info({ event: 'request', requestId, method: request.method, pathname });

  try {
    if (request.method === 'GET' && pathname === '/api/status') {
      sendJson(response, 200, {
        status: 'ok',
        supportedFormats: [...SUPPORTED_FORMATS],
        maxBytes: MAX_BYTES,
        modelConfigured: config.llm.configured,
        modelEndpoint: safeModelEndpoint(config.llm.baseUrl),
        modelName: config.llm.model,
        modelDataScope: [...MODEL_DATA_SCOPE],
        bindHost: config.host,
      });
      return;
    }

    if (request.method === 'POST' && pathname === '/api/documents') {
      const body = await readJsonBody(request);
      assertFields(body, ['filename', 'mediaType', 'text']);
      if (typeof body.text !== 'string' || !body.text.trim()) {
        throw new HttpError(400, 'invalid_request', 'text must be a non-empty string');
      }
      const document = parseDocument(body);
      await store.createDocument(document);
      sendJson(response, 201, {
        documentId: document.id,
        filename: document.filename,
        mediaType: document.mediaType,
        bytes: document.bytes,
        lineCount: document.lines.length,
      });
      return;
    }

    if (request.method === 'POST' && pathname === '/api/interpretations') {
      const body = await readJsonBody(request);
      assertFields(body, ['documentId', 'background', 'previousAnswers']);
      const documentId = requireString(body.documentId, 'documentId');
      const background = validateBackground(body.background);
      const previousAnswers = validatePreviousAnswers(body.previousAnswers);
      const result = await service.interpret({ documentId, background, previousAnswers });
      sendJson(response, 200, result);
      return;
    }

    const answerMatch = pathname.match(/^\/api\/interpretations\/([^/]+)\/answers$/);
    if (request.method === 'POST' && answerMatch) {
      const body = await readJsonBody(request);
      assertFields(body, ['question', 'answer', 'skipped']);
      const interpretationId = decodeURIComponent(answerMatch[1]);
      const result = await service.answer({
        interpretationId,
        question: requireString(body.question, 'question'),
        answer: body.answer ?? null,
        skipped: Boolean(body.skipped),
      });
      sendJson(response, 200, { interpretationId, answers: result.answers });
      return;
    }

    if (request.method === 'GET' && pathname === '/api/memories') {
      sendJson(response, 200, { memories: await store.listMemories() });
      return;
    }

    if (request.method === 'POST' && pathname === '/api/memories') {
      const body = await readJsonBody(request);
      assertFields(body, ['interpretationId', 'content', 'retain']);
      const interpretationId = requireString(body.interpretationId, 'interpretationId');
      const memory = await service.retainMemory({
        interpretationId,
        content: requireString(body.content, 'content'),
        retain: body.retain,
      });
      sendJson(response, 201, { memoryId: memory.id, ...memory });
      return;
    }

    const memoryMatch = pathname.match(/^\/api\/memories\/([^/]+)$/);
    if (request.method === 'DELETE' && memoryMatch) {
      await service.deleteMemory(decodeURIComponent(memoryMatch[1]));
      response.writeHead(204, { 'cache-control': 'no-store' });
      response.end();
      return;
    }

    if (request.method === 'POST' && pathname === '/api/artifacts') {
      const body = await readJsonBody(request);
      assertFields(body, ['interpretationId', 'choice', 'artifactType']);
      const interpretationId = requireString(body.interpretationId, 'interpretationId');
      requireString(body.choice, 'choice');
      const artifactType = requireString(body.artifactType, 'artifactType');
      const artifact = await service.createArtifact({
        interpretationId,
        choice: body.choice,
        artifactType,
      });
      sendJson(response, 201, { artifactId: artifact.id, ...artifact });
      return;
    }

    const exportMatch = pathname.match(/^\/api\/artifacts\/([^/]+)\/export$/);
    if (request.method === 'GET' && exportMatch) {
      const format = url.searchParams.get('format');
      if (!['markdown', 'json'].includes(format)) {
        throw new HttpError(400, 'invalid_request', 'format must be markdown or json');
      }
      const text = await service.exportArtifact(decodeURIComponent(exportMatch[1]), format);
      sendText(
        response,
        200,
        format === 'json'
          ? 'application/json; charset=utf-8'
          : 'text/markdown; charset=utf-8',
        text,
      );
      return;
    }

    const knownPrefixes = [
      '/api/status',
      '/api/documents',
      '/api/interpretations',
      '/api/memories',
      '/api/artifacts',
    ];
    const known = knownPrefixes.some(prefix => pathname === prefix || pathname.startsWith(`${prefix}/`));
    if (!known) {
      sendJson(response, 404, errorBody(requestId, 'not_found', 'Route not found'));
      return;
    }
    sendJson(response, 405, errorBody(requestId, 'method_not_allowed', 'Method not allowed'));
  } catch (error) {
    const mapped = mapError(error);
    logger.error({
      event: 'request_failed',
      requestId,
      method: request.method,
      pathname,
      status: mapped.status,
      error_code: mapped.code,
      error_name: error?.name,
    });
    if (!response.headersSent) {
      sendJson(response, mapped.status, errorBody(requestId, mapped.code, mapped.message));
    } else {
      response.end();
    }
  }
}

export async function startServer(options = {}) {
  const env = options.env ?? process.env;
  const config = loadConfig(env);
  const logger = options.logger ?? createLogger(options.logSink);
  const host = config.host;
  const port = options.port ?? config.port;
  const dataDir = options.dataDir ?? config.dataDir;
  const store = createStore(dataDir);
  const modelClient = options.modelClient ?? createModelClient(config.llm);
  const service = options.service ?? createService({ store, modelClient });

  const server = http.createServer((request, response) => {
    const requestId = randomUUID();
    response.setHeader('x-request-id', requestId);
    handleRequest({ request, response, requestId, store, service, config, logger }).catch(() => {
      if (!response.headersSent) {
        sendJson(response, 500, errorBody(requestId, 'internal_error', 'Internal server error'));
      } else {
        response.end();
      }
    });
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.removeListener('error', reject);
      resolve();
    });
  });

  const address = server.address();
  return {
    server,
    store,
    service,
    config: { ...config, dataDir },
    baseUrl: `http://${host}:${address.port}`,
    close: () => new Promise((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
    }),
  };
}


async function main() {
  const running = await startServer();
  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    running.server.closeAllConnections?.();
    try {
      await running.close();
      process.exitCode = 0;
    } catch {
      process.exitCode = 1;
    }
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  main().catch(error => {
    const code = error?.code ?? 'startup_error';
    const message = error?.name === 'Error' ? error.message : String(error?.message ?? error);
    console.error(`${code}: ${message}`);
    process.exitCode = 1;
  });
}
