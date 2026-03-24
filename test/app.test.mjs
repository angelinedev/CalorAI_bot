import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp } from 'node:fs/promises';
import assert from 'node:assert/strict';

async function createTestServer() {
  process.env.DATA_DIR = await mkdtemp(path.join(os.tmpdir(), 'calor-test-'));
  process.env.APP_BASE_URL = 'http://127.0.0.1';
  process.env.DEFAULT_EXPERIMENT = 'coach_tone_v1';
  process.env.STATSIG_SERVER_KEY = '';
  process.env.GEMINI_API_KEY = '';
  process.env.N8N_WEBHOOK_URL = '';

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

async function runPortalAuthTest() {
  const { server, baseUrl } = await createTestServer();

  const adminLogin = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: 'admin',
      password: 'caloradmin123'
    })
  });

  const adminSession = await adminLogin.json();
  const adminCookie = adminLogin.headers.get('set-cookie');

  assert.equal(adminSession.user.role, 'admin');
  assert.equal(Boolean(adminCookie), true);
  assert.equal(Boolean(adminSession.sessionToken), true);

  const created = await fetch(`${baseUrl}/api/admin/users`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: adminCookie
    },
    body: JSON.stringify({
      username: 'portal_user',
      displayName: 'Portal User',
      dailyCalorieTarget: 2100,
      dailyProteinTarget: 130
    })
  }).then((response) => response.json());

  assert.equal(created.user.username, 'portal_user');
  assert.equal(Boolean(created.password), true);

  const userLogin = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: created.username,
      password: created.password
    })
  });

  const userSession = await userLogin.json();
  const userCookie = userLogin.headers.get('set-cookie');
  const dashboard = await fetch(`${baseUrl}/api/me/dashboard`, {
    headers: {
      Cookie: userCookie
    }
  }).then((response) => response.json());

  assert.equal(dashboard.user.username, created.username);
  assert.equal(dashboard.user.dailyProteinTarget, 130);

  const mobileDashboard = await fetch(`${baseUrl}/api/me/dashboard`, {
    headers: {
      Authorization: `Bearer ${userSession.sessionToken || ''}`
    }
  }).then((response) => response.json()).catch(() => null);

  assert.equal(mobileDashboard?.user?.username, created.username);

  server.close();
}

async function runCreatePortalAliasTest() {
  const { server, baseUrl } = await createTestServer();

  const portalReply = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userId: '9001',
      text: '/createportal'
    })
  }).then((response) => response.json());

  assert.match(portalReply.text, /portal credentials are ready/i);
  assert.match(portalReply.text, /Portal:/i);

  const adminLogin = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: 'admin',
      password: 'caloradmin123'
    })
  });

  const adminCookie = adminLogin.headers.get('set-cookie');
  const reprovisioned = await fetch(`${baseUrl}/api/admin/users`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: adminCookie
    },
    body: JSON.stringify({
      username: 'portal_9001',
      displayName: 'Telegram User',
      telegramUserId: '9001',
      dailyCalorieTarget: 2400,
      dailyProteinTarget: 150
    })
  }).then((response) => response.json());

  assert.equal(reprovisioned.user.telegramUserId, '9001');
  assert.equal(reprovisioned.user.dailyProteinTarget, 150);
  assert.equal(Boolean(reprovisioned.password), true);

  server.close();
}

async function runN8nTelegramReplyTest() {
  const { server, baseUrl } = await createTestServer();

  const payload = await fetch(`${baseUrl}/api/n8n/telegram/reply`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: {
        text: 'log pani poori | 250 | 3 | 35 | 10',
        chat: { id: 8155707653 },
        from: {
          id: 8155707653,
          username: 'angeline',
          first_name: 'Angeline'
        }
      }
    })
  }).then((response) => response.json());

  assert.equal(payload.ok, true);
  assert.equal(payload.chatId, 8155707653);
  assert.match(payload.text, /pani poori|logged/i);

  const dashboard = await fetch(`${baseUrl}/api/users/8155707653/summary`).then((response) => response.json());
  assert.equal(dashboard.meals.length >= 1, true);

  server.close();
}

async function runGeminiFallbackUnitTest() {
  const { HealthBotService } = await import(`../src/services/health-bot.js?${Date.now()}`);

  let capturedMeal = null;
  const service = new HealthBotService({
    mealService: {
      async createMeal(userId, meal) {
        capturedMeal = { ...meal, id: 'meal123', userId };
        return capturedMeal;
      },
      async getDailySummary() {
        return {
          date: '2026-03-21',
          totals: { calories: 0, protein: 0, carbs: 0, fats: 0 },
          meals: []
        };
      },
      async listMeals() {
        return [];
      },
      async updateMeal() {
        return null;
      },
      async deleteMeal() {
        return null;
      }
    },
    experimentService: {
      async assignUser() {
        return {
          experiment: 'coach_tone_v1',
          variant: {
            key: 'B',
            name: 'Supportive Coach',
            systemTone: 'empathetic',
            followUp: 'You are building a streak. Want me to log, edit, or summarize a meal?'
          }
        };
      }
    },
    geminiService: {
      async interpretMessage() {
        return {
          intent: 'log_meal',
          reply: 'I logged an estimated chicken biryani meal for you.',
          suggestions: ['Today summary'],
          meal: {
            name: 'Chicken biryani',
            calories: 540,
            protein: 24,
            carbs: 58,
            fats: 20
          }
        };
      }
    }
  });

  const reply = await service.respond({
    userId: 'gemini-user',
    text: 'I just ate chicken biryani'
  });

  assert.equal(capturedMeal?.name, 'Chicken biryani');
  assert.match(reply.text, /estimated chicken biryani/i);
}

async function runDailyAnalysisFallbackTest() {
  const { HealthBotService } = await import(`../src/services/health-bot.js?${Date.now()}`);

  const service = new HealthBotService({
    mealService: {
      async getDailySummary() {
        return {
          date: '2026-03-22',
          totals: { calories: 980, protein: 38, carbs: 140, fats: 32 },
          meals: [
            { id: 'm1', name: 'Idli', calories: 280, protein: 8, carbs: 48, fats: 4 },
            { id: 'm2', name: 'Rice bowl', calories: 700, protein: 30, carbs: 92, fats: 28 }
          ]
        };
      },
      async listMeals() {
        return [];
      },
      async createMeal() {
        return null;
      },
      async updateMeal() {
        return null;
      },
      async deleteMeal() {
        return null;
      }
    },
    experimentService: {
      async assignUser() {
        return {
          experiment: 'coach_tone_v1',
          variant: {
            key: 'A',
            name: 'Precision Coach',
            systemTone: 'concise',
            followUp: 'Want a quick meal summary or another log?'
          }
        };
      }
    },
    geminiService: null
  });

  const reply = await service.respond({
    userId: 'analysis-user',
    text: '/analysis'
  });

  assert.match(reply.text, /Daily analysis/i);
  assert.match(reply.text, /eat a bit more|low on total intake/i);
}

await runChatTest();
await runCrudTest();
await runPortalAuthTest();
await runCreatePortalAliasTest();
await runN8nTelegramReplyTest();
await runGeminiFallbackUnitTest();
await runDailyAnalysisFallbackTest();
console.log('All tests passed.');
