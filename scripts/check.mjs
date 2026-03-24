import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp } from 'node:fs/promises';

process.env.DATA_DIR = await mkdtemp(path.join(os.tmpdir(), 'calor-check-'));
process.env.APP_BASE_URL = 'http://127.0.0.1';
process.env.DEFAULT_EXPERIMENT = 'coach_tone_v1';
process.env.STATSIG_SERVER_KEY = '';
process.env.GEMINI_API_KEY = '';
process.env.N8N_WEBHOOK_URL = '';

const { createApp } = await import('../src/app.js');

const app = createApp();
const server = http.createServer((req, res) => app.route(req, res));

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

const address = server.address();
const baseUrl = `http://127.0.0.1:${address.port}`;

const reply = await fetch(`${baseUrl}/api/chat`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    userId: 'check-user',
    text: 'log test bowl | 300 | 20 | 25 | 10'
  })
}).then((response) => response.json());

if (!reply.variant?.key) {
  throw new Error('Chat reply did not include an experiment variant.');
}

const summary = await fetch(`${baseUrl}/api/users/check-user/summary`).then((response) => response.json());
if (summary.totals.calories !== 300) {
  throw new Error(`Expected 300 calories in summary, received ${summary.totals.calories}.`);
}

const metrics = await fetch(`${baseUrl}/api/metrics`).then((response) => response.json());
if (metrics.overview.mealsLogged < 1) {
  throw new Error('Metrics did not record the logged meal.');
}

server.close();
console.log('Smoke check passed.');
