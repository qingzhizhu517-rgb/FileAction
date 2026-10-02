import { lineText } from './document.js';

const FINDING_KINDS = new Set(['document', 'background', 'inference', 'unknown']);
const INTERPRETATION_KEYS = new Set(['findings', 'proposedMemory', 'unknowns']);
const DRAFT_KEYS = new Set(['draft', 'usedConfirmedInfo', 'pendingItems', 'disclaimer']);

export class SchemaError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SchemaError';
    this.code = 'invalid_response';
    this.httpStatus = 502;
  }
}

function requireObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new SchemaError(`${label} must be an object`);
  }
}

function requireString(value, label, { allowEmpty = false } = {}) {
  if (typeof value !== 'string' || (!allowEmpty && !value.trim())) {
    throw new SchemaError(`${label} must be a ${allowEmpty ? '' : 'non-empty '}string`);
  }
}

function requireStringArray(value, label) {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) {
    throw new SchemaError(`${label} must be an array of strings`);
  }
}

function assertKeys(value, allowed, label) {
  const unknown = Object.keys(value).filter(key => !allowed.has(key));
  if (unknown.length) throw new SchemaError(`${label} contains unknown field ${unknown[0]}`);
}

function validateDocumentEvidence(value, document) {
  requireObject(value, 'documentEvidence');
  requireString(value.quote, 'documentEvidence.quote');
  if (!Number.isInteger(value.lineStart) || value.lineStart < 1) {
    throw new SchemaError('documentEvidence.lineStart must be an integer >= 1');
  }
  if (!Number.isInteger(value.lineEnd) || value.lineEnd < value.lineStart) {
    throw new SchemaError('documentEvidence.lineEnd must be an integer >= lineStart');
  }
  let actual;
  try {
    actual = lineText(document, value.lineStart, value.lineEnd);
  } catch {
    throw new SchemaError('documentEvidence line numbers exceed the source document');
  }
  if (actual !== value.quote) {
    throw new SchemaError('documentEvidence.quote does not exactly match the source lines');
  }
}

function validateBackgroundEvidence(value, background) {
  if (!Array.isArray(value)) throw new SchemaError('backgroundEvidence must be an array');
  for (const evidence of value) {
    requireObject(evidence, 'backgroundEvidence item');
    requireString(evidence.id, 'backgroundEvidence.id');
    requireString(evidence.quote, 'backgroundEvidence.quote');
    const source = background.find(item => item?.id === evidence.id);
    if (!source) throw new SchemaError(`backgroundEvidence references unknown background ${evidence.id}`);
    requireString(source.content, `background ${evidence.id}.content`);
    if (!source.content.includes(evidence.quote)) {
      throw new SchemaError(`backgroundEvidence.quote does not match background ${evidence.id}`);
    }
  }
}

export function validateInterpretation(raw, { document, background }) {
  requireObject(raw, 'interpretation');
  assertKeys(raw, INTERPRETATION_KEYS, 'interpretation');
  if (!Array.isArray(raw.findings)) throw new SchemaError('findings must be an array');
  requireStringArray(raw.unknowns, 'unknowns');
  if (raw.findings.length === 0 && raw.unknowns.length === 0) {
    throw new SchemaError('empty findings must retain at least one unknown');
  }
  requireObject(raw.proposedMemory, 'proposedMemory');
  requireString(raw.proposedMemory.content, 'proposedMemory.content');
  requireString(raw.proposedMemory.source, 'proposedMemory.source');
  if (!Array.isArray(background)) throw new SchemaError('background must be an array');

  for (const [index, item] of raw.findings.entries()) {
    const label = `findings[${index}]`;
    requireObject(item, label);
    requireString(item.claim, `${label}.claim`);
    requireString(item.relation, `${label}.relation`);
    if (!FINDING_KINDS.has(item.kind)) throw new SchemaError(`${label}.kind is invalid`);
    requireString(item.uncertainty, `${label}.uncertainty`, { allowEmpty: true });
    requireString(item.question, `${label}.question`, { allowEmpty: true });
    validateDocumentEvidence(item.documentEvidence, document);
    validateBackgroundEvidence(item.backgroundEvidence ?? [], background);
    if (item.kind === 'background' && (!item.backgroundEvidence || item.backgroundEvidence.length === 0)) {
      throw new SchemaError(`${label} marked background but has no background evidence`);
    }
  }
  return raw;
}

export function validateDraft(raw) {
  requireObject(raw, 'draft response');
  assertKeys(raw, DRAFT_KEYS, 'draft response');
  requireString(raw.draft, 'draft');
  requireStringArray(raw.usedConfirmedInfo, 'usedConfirmedInfo');
  requireStringArray(raw.pendingItems, 'pendingItems');
  requireString(raw.disclaimer, 'disclaimer');
  return raw;
}
