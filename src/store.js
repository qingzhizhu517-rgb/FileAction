import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const COLLECTIONS = Object.freeze({
  document: 'documents',
  interpretation: 'interpretations',
  memory: 'memories',
  artifact: 'artifacts',
});
const ID_PATTERN = /^[A-Za-z0-9_-]+$/;

export class StoreError extends Error {
  constructor(code, httpStatus, message) {
    super(message);
    this.name = 'StoreError';
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

function assertId(id, label) {
  if (typeof id !== 'string' || !ID_PATTERN.test(id)) {
    throw new StoreError('invalid_id', 400, `${label} has an invalid id`);
  }
}

export function createStore(dataDir) {
  let queue = Promise.resolve();

  function pathFor(kind, id) {
    assertId(id, kind);
    return join(dataDir, COLLECTIONS[kind], `${id}.json`);
  }

  async function read(kind, id) {
    try {
      return JSON.parse(await readFile(pathFor(kind, id), 'utf8'));
    } catch (error) {
      if (error?.code === 'ENOENT') {
        throw new StoreError('not_found', 404, `${kind} not found`);
      }
      if (error instanceof SyntaxError) {
        throw new StoreError('corrupt_record', 500, `${kind} record is invalid`);
      }
      throw error;
    }
  }

  async function write(kind, value) {
    assertId(value?.id, kind);
    const target = pathFor(kind, value.id);
    await mkdir(dirname(target), { recursive: true });
    const temporary = `${target}.${randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    await rename(temporary, target);
    return value;
  }

  async function create(kind, value) {
    try {
      await read(kind, value.id);
    } catch (error) {
      if (error?.httpStatus !== 404) throw error;
      return write(kind, value);
    }
    throw new StoreError('conflict', 409, `${kind} already exists`);
  }

  function enqueue(operation) {
    const result = queue.then(operation, operation);
    queue = result.then(() => undefined, () => undefined);
    return result;
  }

  return {
    createDocument: value => enqueue(() => create('document', value)),
    getDocument: id => read('document', id),
    createInterpretation: value => enqueue(() => create('interpretation', value)),
    getInterpretation: id => read('interpretation', id),
    updateInterpretation: (id, updater) => enqueue(async () => {
      const current = await read('interpretation', id);
      const next = await updater(current);
      return write('interpretation', next);
    }),
    createMemory: value => enqueue(() => create('memory', value)),
    async listMemories() {
      const directory = join(dataDir, COLLECTIONS.memory);
      try {
        const names = await readdir(directory);
        return Promise.all(names
          .filter(name => name.endsWith('.json'))
          .sort()
          .map(name => read('memory', name.slice(0, -5))));
      } catch (error) {
        if (error?.code === 'ENOENT') return [];
        throw error;
      }
    },
    getMemory: id => read('memory', id),
    deleteMemory: id => enqueue(async () => {
      await read('memory', id);
      await rm(pathFor('memory', id), { force: true });
      return { id, deleted: true };
    }),
    createArtifact: value => enqueue(() => create('artifact', value)),
    getArtifact: id => read('artifact', id),
  };
}
