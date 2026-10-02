import { createHash, randomUUID } from 'node:crypto';

const DEFAULT_MAX_BYTES = 1048576;
const MEDIA_BY_EXTENSION = Object.freeze({
  '.txt': 'text/plain',
  '.md': 'text/markdown',
});
const LONE_SURROGATE = /(?:[\uD800-\uDBFF](?![\uDC00-\uDFFF]))|(?:(?<![\uD800-\uDBFF])[\uDC00-\uDFFF])/;

export class DocumentError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'DocumentError';
    this.code = code;
  }
}

function extensionOf(filename) {
  const position = filename.lastIndexOf('.');
  return position < 0 ? '' : filename.slice(position).toLowerCase();
}

export function parseDocument({
  filename,
  mediaType,
  text,
  maxBytes = DEFAULT_MAX_BYTES,
}) {
  if (typeof filename !== 'string' || !filename.trim()) {
    throw new DocumentError('invalid_format', 'filename must be a non-empty string');
  }
  if (typeof text !== 'string') {
    throw new DocumentError('invalid_encoding', 'text must be a valid UTF-8 string');
  }
  if (text.includes('\u0000') || LONE_SURROGATE.test(text)) {
    throw new DocumentError('invalid_encoding', 'text contains invalid UTF-8 content');
  }

  const normalizedText = text.replace(/^\uFEFF/, '');
  const bytes = new TextEncoder().encode(normalizedText).byteLength;
  if (bytes > maxBytes) {
    throw new DocumentError('too_large', `text exceeds the ${maxBytes} byte limit`);
  }

  const expectedMediaType = MEDIA_BY_EXTENSION[extensionOf(filename)];
  if (!expectedMediaType || expectedMediaType !== mediaType) {
    throw new DocumentError(
      'invalid_format',
      `filename extension and mediaType must match ${Object.keys(MEDIA_BY_EXTENSION).join(' or ')}`,
    );
  }

  return {
    id: randomUUID(),
    filename,
    mediaType,
    text: normalizedText,
    bytes,
    lines: normalizedText.split('\n'),
    sha256: createHash('sha256').update(normalizedText, 'utf8').digest('hex'),
  };
}

export function lineText(document, lineStart, lineEnd = lineStart) {
  if (!Number.isInteger(lineStart) || lineStart < 1) {
    throw new RangeError('lineStart must be an integer >= 1');
  }
  if (!Number.isInteger(lineEnd) || lineEnd < lineStart) {
    throw new RangeError('lineEnd must be an integer >= lineStart');
  }
  if (lineEnd > document.lines.length) {
    throw new RangeError('lineEnd exceeds document lines');
  }
  return document.lines.slice(lineStart - 1, lineEnd).join('\n');
}
