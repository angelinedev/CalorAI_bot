import crypto from 'node:crypto';
import { appendFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

export class EventLogger {
  constructor({ dataDir, eventBus }) {
    this.filePath = path.join(dataDir, 'events.jsonl');
    this.eventBus = eventBus;
  }

  async log(event) {
    const enriched = {
      id: crypto.randomUUID(),
      ts: new Date().toISOString(),
      ...event
    };
    await mkdir(path.dirname(this.filePath), { recursive: true });
    await appendFile(this.filePath, `${JSON.stringify(enriched)}\n`, 'utf8');
    this.eventBus.publish(enriched);
    return enriched;
  }
}
