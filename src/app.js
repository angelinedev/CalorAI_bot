import path from 'node:path';
import { EventBus } from './services/event-bus.js';
import { JsonStore } from './lib/storage.js';
import { EventLogger } from './services/event-log.js';
import { ExperimentService } from './services/experiments.js';
import { MealService } from './services/meals.js';
import { HealthBotService } from './services/health-bot.js';
import { TelegramService } from './services/telegram.js';
import { MetricsService } from './services/metrics.js';
import { StatsigAdapter } from './services/statsig-adapter.js';
import { config } from './config.js';
import { notFound, readJsonBody, sendJson, sendText, serveStaticFile } from './lib/http.js';

export function createApp() {
  const eventBus = new EventBus();
  const mealsStore = new JsonStore(config.dataDir, 'meals.json', []);
  const profilesStore = new JsonStore(config.dataDir, 'profiles.json', {});
  const eventLogger = new EventLogger({ dataDir: config.dataDir, eventBus });
  const statsigAdapter = new StatsigAdapter({
    serverKey: config.statsigServerKey
  });
  const experimentService = new ExperimentService({
    eventLogger,
    experimentName: config.defaultExperiment,
    statsigAdapter
  });
  const mealService = new MealService({
    mealsStore,
    profilesStore,
    eventLogger
  });
  const healthBotService = new HealthBotService({
    mealService,
    experimentService
  });
  const telegramService = new TelegramService({
    config,
    eventLogger
  });
  const metricsService = new MetricsService({
    dataDir: config.dataDir,
    experimentService
  });

  const sseClients = new Set();
  eventBus.subscribe((event) => {
    const payload = `data: ${JSON.stringify(event)}\n\n`;
    for (const client of sseClients) {
      client.write(payload);
    }
  });

  async function route(req, res) {
    const url = new URL(req.url, config.appBaseUrl);
    const pathname = url.pathname;
    const method = req.method;

    if (method === 'GET' && pathname === '/api/health') {
      return sendJson(res, 200, {
        ok: true,
        app: 'CalorAI',
        now: new Date().toISOString()
      });
    }

    if (method === 'GET' && pathname === '/api/metrics') {
      return sendJson(res, 200, await metricsService.getDashboardMetrics());
    }

    if (method === 'GET' && pathname === '/api/evaluation-framework') {
      return sendJson(res, 200, await metricsService.getEvaluationFramework());
    }

    if (method === 'GET' && pathname === '/api/stream') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive'
      });
      res.write('\n');
      sseClients.add(res);
      req.on('close', () => sseClients.delete(res));
      return;
    }

    if (method === 'POST' && pathname === '/api/chat') {
      const body = await readJsonBody(req);
      const userId = String(body.userId || 'demo-user');
      const startedAt = Date.now();
      await eventLogger.log({
        type: 'telegram_message_received',
        userId,
        channel: body.channel || 'dashboard',
        text: body.text || ''
      });
      const reply = await healthBotService.respond({
        userId,
        text: String(body.text || '')
      });
      await eventLogger.log({
        type: 'chatbot_reply_generated',
        userId,
        variant: reply.variant.key,
        latencyMs: Date.now() - startedAt
      });
      return sendJson(res, 200, reply);
    }

    const mealsMatch = pathname.match(/^\/api\/users\/([^/]+)\/meals(?:\/([^/]+))?$/);
    if (mealsMatch) {
      const userId = decodeURIComponent(mealsMatch[1]);
      const mealId = mealsMatch[2] ? decodeURIComponent(mealsMatch[2]) : null;

      if (method === 'GET' && !mealId) {
        const date = url.searchParams.get('date') || new Date().toISOString().slice(0, 10);
        return sendJson(res, 200, await mealService.listMeals(userId, date));
      }

      if (method === 'POST' && !mealId) {
        return sendJson(res, 201, await mealService.createMeal(userId, await readJsonBody(req)));
      }

      if (method === 'PATCH' && mealId) {
        const updated = await mealService.updateMeal(userId, mealId, await readJsonBody(req));
        if (!updated) {
          return sendJson(res, 404, { error: 'Meal not found' });
        }
        return sendJson(res, 200, updated);
      }

      if (method === 'DELETE' && mealId) {
        const deleted = await mealService.deleteMeal(userId, mealId);
        if (!deleted) {
          return sendJson(res, 404, { error: 'Meal not found' });
        }
        return sendJson(res, 200, deleted);
      }
    }

    const summaryMatch = pathname.match(/^\/api\/users\/([^/]+)\/summary$/);
    if (summaryMatch && method === 'GET') {
      const userId = decodeURIComponent(summaryMatch[1]);
      const date = url.searchParams.get('date') || new Date().toISOString().slice(0, 10);
      return sendJson(res, 200, await mealService.getDailySummary(userId, date));
    }

    if (method === 'POST' && pathname === '/api/telegram/webhook') {
      if (
        config.telegramWebhookSecret &&
        req.headers['x-telegram-bot-api-secret-token'] !== config.telegramWebhookSecret
      ) {
        return sendJson(res, 401, { error: 'Invalid webhook secret' });
      }

      const update = await readJsonBody(req);
      const message = update.message;

      if (!message?.text) {
        return sendJson(res, 200, { ok: true, skipped: true });
      }

      const userId = String(message.from?.id || message.chat?.id);
      await eventLogger.log({
        type: 'telegram_message_received',
        userId,
        channel: 'telegram',
        text: message.text
      });

      const reply = await healthBotService.respond({
        userId,
        text: message.text
      });

      await telegramService.sendMessage(message.chat.id, reply.text, reply.suggestions);
      return sendJson(res, 200, { ok: true, reply });
    }

    if (method === 'GET' && pathname === '/api/setup/telegram') {
      return sendJson(res, 200, {
        webhookUrl: `${config.appBaseUrl}/api/telegram/webhook`,
        hasBotToken: telegramService.hasBotToken(),
        secretHeader: config.telegramWebhookSecret ? 'configured' : 'not-configured'
      });
    }

    if (method === 'GET' && (pathname === '/' || pathname.startsWith('/assets/') || pathname === '/app.js' || pathname === '/styles.css' || pathname === '/manifest.webmanifest' || pathname === '/sw.js')) {
      const safePath = pathname === '/'
        ? path.join(config.publicDir, 'index.html')
        : path.join(config.publicDir, pathname.replace(/^\//, ''));
      const served = await serveStaticFile(res, safePath);
      if (served) {
        return;
      }
    }

    if (method === 'GET' && pathname === '/robots.txt') {
      return sendText(res, 200, 'User-agent: *\nAllow: /\n');
    }

    notFound(res);
  }

  return { route };
}
