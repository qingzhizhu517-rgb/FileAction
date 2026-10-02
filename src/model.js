import { SchemaError, validateDraft, validateInterpretation } from './model-schema.js';

const SYSTEM_PROMPT = [
  '你是文启 FileAction 的个人端文件理解模型。',
  '只依据提供的文件原文与用户明确提供的背景解释与用户有关的内容。',
  '严格区分文件原文、用户背景、系统推断和未知事项。',
  '只返回一个 JSON 对象，不使用 Markdown 代码围栏，不添加 JSON 之外的文字。',
].join('\n');

const DRAFT_SYSTEM_PROMPT = [
  '你是文启 FileAction 的可编辑产物草稿生成器。',
  '只使用已确认信息，不编造经历、资格、提交状态或业务结果。',
  '只返回一个 JSON 对象，不使用 Markdown 代码围栏，不添加 JSON 之外的文字。',
].join('\n');

export class ModelError extends Error {
  constructor(code, httpStatus, message, options = {}) {
    super(message, options);
    this.name = 'ModelError';
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

function parseModelJson(content, validate) {
  if (typeof content !== 'string' || !content.trim()) {
    throw new ModelError('invalid_response', 502, 'model response content is not JSON text');
  }
  let raw;
  try {
    raw = JSON.parse(content);
  } catch {
    throw new ModelError('invalid_response', 502, 'model response is not valid JSON');
  }
  try {
    return validate(raw);
  } catch (error) {
    if (error instanceof SchemaError) {
      throw new ModelError('invalid_response', 502, error.message, { cause: error });
    }
    throw error;
  }
}

export function createModelClient(config, fetchImpl = globalThis.fetch) {
  async function call(promptPayload, validate) {
    if (!config?.configured || !config.baseUrl || !config.apiKey || !config.model) {
      throw new ModelError('not_configured', 503, 'model is not configured');
    }

    const timeoutController = new AbortController();
    const timer = setTimeout(() => timeoutController.abort(), config.timeoutMs ?? 30000);
    const signal = promptPayload.timeoutSignal
      ? AbortSignal.any([timeoutController.signal, promptPayload.timeoutSignal])
      : timeoutController.signal;

    try {
      let response;
      try {
        response = await fetchImpl(config.baseUrl, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${config.apiKey}`,
          },
          body: JSON.stringify({
            model: config.model,
            messages: [
              { role: 'system', content: promptPayload.system },
              { role: 'user', content: JSON.stringify(promptPayload.user) },
            ],
          }),
          signal,
        });
      } catch (error) {
        if (error?.name === 'AbortError' || timeoutController.signal.aborted) {
          throw new ModelError('timeout', 504, 'model request timed out', { cause: error });
        }
        throw new ModelError('network', 504, 'model network request failed', { cause: error });
      }

      if (!response?.ok) {
        throw new ModelError('network', 504, `model request failed with HTTP ${response?.status ?? 'unknown'}`);
      }

      let payload;
      try {
        payload = await response.json();
      } catch (error) {
        if (error?.name === 'AbortError' || timeoutController.signal.aborted) {
          throw new ModelError('timeout', 504, 'model response timed out', { cause: error });
        }
        throw new ModelError('invalid_response', 502, 'model transport response is not JSON', { cause: error });
      }

      const content = payload?.choices?.[0]?.message?.content;
      return parseModelJson(content, validate);
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    async interpret({ document, background = [], previousAnswers = [], timeoutSignal }) {
      return call({
        system: SYSTEM_PROMPT,
        user: {
          task: 'interpret_document',
          instruction: 'Return strict JSON matching findings, proposedMemory, and unknowns.',
          document: {
            filename: document.filename,
            mediaType: document.mediaType,
            text: document.text,
            lines: document.lines,
          },
          background,
          previousAnswers,
        },
        timeoutSignal,
      }, raw => validateInterpretation(raw, { document, background }));
    },

    async draft({ document, interpretation, artifactType, timeoutSignal }) {
      return call({
        system: DRAFT_SYSTEM_PROMPT,
        user: {
          task: 'create_editable_artifact',
          instruction: 'Return strict JSON matching draft, usedConfirmedInfo, pendingItems, and disclaimer.',
          artifactType,
          document: {
            filename: document.filename,
            mediaType: document.mediaType,
            text: document.text,
          },
          interpretation,
        },
        timeoutSignal,
      }, validateDraft);
    },
  };
}
