import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

export class JsonStore {
  constructor(dataDir, filename, fallbackValue) {
    this.dataDir = dataDir;
    this.filePath = path.join(dataDir, filename);
    this.fallbackValue = fallbackValue;
  }

  async ensure() {
    await mkdir(this.dataDir, { recursive: true });
    try {
      await readFile(this.filePath, 'utf8');
    } catch {
      await this.write(this.fallbackValue);
    }
  }

  async read() {
    await this.ensure();
    const raw = await readFile(this.filePath, 'utf8');
    return JSON.parse(raw);
  }

  async write(value) {
    await mkdir(this.dataDir, { recursive: true });
    const tmpPath = `${this.filePath}.${crypto.randomUUID()}.tmp`;
    await writeFile(tmpPath, JSON.stringify(value, null, 2), 'utf8');
    await rename(tmpPath, this.filePath);
  }

  async update(updater) {
    const current = await this.read();
    const next = await updater(current);
    await this.write(next);
    return next;
  }
}
