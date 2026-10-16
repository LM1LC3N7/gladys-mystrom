// -----------------------------------------------------------------------------
// What the integration keeps across restarts, in /data (the one writable
// volume): the known devices (a sleeping button cannot be asked again), the
// energy counters of the switches, and the receiver tokens.
// -----------------------------------------------------------------------------

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export const emptyData = () => ({ devices: {}, energy: {}, tokens: {} });

function sanitize(data) {
  const base = emptyData();
  if (!data || typeof data !== 'object') {
    return base;
  }
  for (const key of Object.keys(base)) {
    if (data[key] && typeof data[key] === 'object' && !Array.isArray(data[key])) {
      base[key] = data[key];
    }
  }
  if (typeof data.receiverEnvHash === 'string') {
    base.receiverEnvHash = data.receiverEnvHash;
  }
  return base;
}

export class FileStore {
  constructor({ dir = process.env.DATA_DIR || '/data', name = 'mystrom.json' } = {}) {
    this.dir = dir;
    this.path = join(dir, name);
  }

  async load() {
    try {
      return sanitize(JSON.parse(await readFile(this.path, 'utf8')));
    } catch {
      return emptyData();
    }
  }

  async save(data) {
    await mkdir(this.dir, { recursive: true });
    const temporary = `${this.path}.tmp`;
    await writeFile(temporary, JSON.stringify(data), { mode: 0o600 });
    await rename(temporary, this.path);
  }
}

/** For the tests. */
export class MemoryStore {
  constructor(data = emptyData()) {
    this.data = structuredClone(data);
    this.saves = 0;
  }

  async load() {
    return sanitize(structuredClone(this.data));
  }

  async save(data) {
    this.data = structuredClone(data);
    this.saves += 1;
  }
}
