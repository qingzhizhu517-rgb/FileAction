import { randomUUID } from 'node:crypto';
import { StoreError } from './store.js';

const ARTIFACT_TYPES = new Set(['statement', 'questions', 'checklist', 'discussion']);

function invalidRequest(message) {
  return new StoreError('invalid_request', 400, message);
}

function conflict(message) {
  return new StoreError('conflict', 409, message);
}

function markdownArtifact(artifact) {
  const lines = [
    `# ${artifact.artifactType}`,
    '',
    '> 模型初稿，待本人编辑和确认；不代表资格通过/已发送。',
    '',
    '## 来源',
    `- 解读记录：${artifact.interpretationId}`,
    `- 产物记录：${artifact.id}`,
    '',
    '## 已确认信息',
    ...(artifact.usedConfirmedInfo.length
      ? artifact.usedConfirmedInfo.map(item => `- ${item}`)
      : ['- 无']),
    '',
    '## 待确认事项',
    ...(artifact.pendingItems.length
      ? artifact.pendingItems.map(item => `- ${item}`)
      : ['- 无']),
    '',
    '## 草稿',
    artifact.draft,
    '',
    `> ${artifact.disclaimer}`,
    '',
  ];
  return lines.join('\n');
}

export function createService({ store, modelClient, now = () => new Date() }) {
  async function requireInterpretation(id) {
    const interpretation = await store.getInterpretation(id);
    if (interpretation.state !== 'interpreted') {
      throw conflict('interpretation is not editable or retained');
    }
    return interpretation;
  }

  return {
    async interpret({ documentId, background = [], previousAnswers = [] }) {
      const document = await store.getDocument(documentId);
      const interpretationId = randomUUID();
      const createdAt = now().toISOString();
      await store.createInterpretation({
        id: interpretationId,
        documentId,
        state: 'interpreting',
        background,
        previousAnswers,
        answers: [],
        createdAt,
      });

      try {
        const result = await modelClient.interpret({
          document,
          background,
          previousAnswers,
        });
        const completed = await store.updateInterpretation(interpretationId, record => ({
          ...record,
          ...result,
          state: 'interpreted',
          interpretedAt: now().toISOString(),
        }));
        return {
          interpretationId,
          status: 'interpreted',
          findings: completed.findings,
          proposedMemory: completed.proposedMemory,
          unknowns: completed.unknowns,
        };
      } catch (error) {
        await store.updateInterpretation(interpretationId, record => ({
          ...record,
          state: 'failed',
          errorCode: error.code ?? 'model_error',
          errorHttpStatus: error.httpStatus ?? 502,
          failedAt: now().toISOString(),
        }));
        if (error && typeof error === 'object') error.interpretationId = interpretationId;
        throw error;
      }
    },

    async answer({ interpretationId, question, answer = null, skipped = false }) {
      const record = await requireInterpretation(interpretationId);
      if (typeof question !== 'string' || !question.trim()) {
        throw invalidRequest('question must be a non-empty string');
      }
      if (answer !== null && typeof answer !== 'string') {
        throw invalidRequest('answer must be a string or null');
      }
      return store.updateInterpretation(interpretationId, current => ({
        ...current,
        answers: [...current.answers, {
          question,
          answer,
          skipped: Boolean(skipped),
          answeredAt: now().toISOString(),
        }],
      }));
    },

    async retainMemory({ interpretationId, content, retain }) {
      const interpretation = await requireInterpretation(interpretationId);
      if (retain !== true) throw conflict('explicit retention consent is required');
      if (typeof content !== 'string' || !content.trim()) {
        throw invalidRequest('memory content must be a non-empty string');
      }

      const memories = await store.listMemories();
      const existing = memories.find(memory => memory.interpretationId === interpretationId);
      if (existing) return existing;

      const memory = {
        id: randomUUID(),
        interpretationId,
        content: content.trim(),
        source: interpretation.proposedMemory?.source ?? `interpretation:${interpretationId}`,
        createdAt: now().toISOString(),
      };
      await store.createMemory(memory);
      return memory;
    },

    deleteMemory(id) {
      return store.deleteMemory(id);
    },

    async createArtifact({ interpretationId, choice, artifactType }) {
      const interpretation = await requireInterpretation(interpretationId);
      if (choice !== 'continue') throw conflict('user must choose continue before draft generation');
      if (!ARTIFACT_TYPES.has(artifactType)) {
        throw invalidRequest(`artifactType must be one of ${[...ARTIFACT_TYPES].join(', ')}`);
      }
      const document = await store.getDocument(interpretation.documentId);
      const result = await modelClient.draft({
        document,
        interpretation,
        artifactType,
      });
      const artifact = {
        id: randomUUID(),
        interpretationId,
        artifactType,
        status: 'editable',
        createdAt: now().toISOString(),
        ...result,
      };
      await store.createArtifact(artifact);
      return artifact;
    },

    async exportArtifact(id, format) {
      const artifact = await store.getArtifact(id);
      if (format === 'json') return JSON.stringify(artifact, null, 2);
      if (format !== 'markdown') throw invalidRequest('format must be markdown or json');
      return markdownArtifact(artifact);
    },
  };
}
