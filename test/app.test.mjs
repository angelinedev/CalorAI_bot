import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp } from 'node:fs/promises';
import assert from 'node:assert/strict';

async function createTestServer() {
  process.env.DATA_DIR = await mkdtemp(path.join(os.tmpdir(), 'calor-test-'));
  process.env.APP_BASE_URL = 'http://127.0.0.1';
  process.env.DEFAULT_EXPERIMENT = 'coach_tone_v1';

  const { createApp } = await import(`../src/app.js?${Date.now()}`);
  const app = createApp();
  const server = http.createServer((req, res) => app.route(req, res));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

  const address = server.address();
  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}`
  };
}

async function runChatTest() {
  const { server, baseUrl } = await createTestServer();

  const reply = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userId: 'demo-user',
      text: 'log oats | 320 | 14 | 48 | 8'
    })
  }).then((response) => response.json());

  assert.equal(reply.variant.key === 'A' || reply.variant.key === 'B', true);
  assert.match(reply.text, /Logged oats/i);

  const summary = await fetch(`${baseUrl}/api/users/demo-user/summary`).then((response) => response.json());
  assert.equal(summary.totals.calories, 320);

  server.close();
}

async function runCrudTest() {
  const { server, baseUrl } = await createTestServer();
  const userId = 'crud-user';

  const created = await fetch(`${baseUrl}/api/users/${userId}/meals`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Paneer bowl',
      calories: 510,
      protein: 32,
      carbs: 28,
      fats: 22
    })
  }).then((response) => response.json());

  const updated = await fetch(`${baseUrl}/api/users/${userId}/meals/${created.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ calories: 560 })
  }).then((response) => response.json());

  assert.equal(updated.calories, 560);

  const deleted = await fetch(`${baseUrl}/api/users/${userId}/meals/${created.id}`, {
    method: 'DELETE'
  }).then((response) => response.json());

  assert.equal(deleted.id, created.id);

  const list = await fetch(`${baseUrl}/api/users/${userId}/meals`).then((response) => response.json());
  assert.equal(list.length, 0);

  server.close();
}

await runChatTest();
await runCrudTest();
console.log('All tests passed.');
