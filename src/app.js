import path from 'node:path';
import { EventBus } from './services/event-bus.js';
import { EventLogger } from './services/event-log.js';
import { ExperimentService } from './services/experiments.js';
import { MealService } from './services/meals.js';
import { HealthBotService } from './services/health-bot.js';
import { TelegramService } from './services/telegram.js';
import { MetricsService } from './services/metrics.js';
import { StatsigAdapter } from './services/statsig-adapter.js';
import { GeminiService } from './services/gemini.js';
import { N8nRelayService } from './services/n8n-relay.js';
import { DailyAnalysisService } from './services/daily-analysis.js';
import { AccountService } from './services/accounts.js';
import { AppDatabase } from './lib/database.js';
import { clearSessionCookie, createSessionCookie, parseCookies } from './lib/cookies.js';
import { config } from './config.js';
import { notFound, readJsonBody, sendJson, sendText, serveStaticFile } from './lib/http.js';

function today() {
  return new Date().toISOString().slice(0, 10);
}

function buildPortalUrl() {
  return `${config.appBaseUrl}/portal`;
}

function hasExtension(pathname) {
  return /\.[a-z0-9]+$/i.test(pathname);
}

function isPortalCommand(input) {
  const normalized = String(input || '').trim().toLowerCase();
  return normalized === '/portal' || normalized === 'portal' || normalized === '/createportal';
}

export function createApp() {
  const eventBus = new EventBus();
  const eventLogger = new EventLogger({ dataDir: config.dataDir, eventBus });
  const statsigAdapter = new StatsigAdapter({
    serverKey: config.statsigServerKey,
    eventLogger
  });
  const experimentService = new ExperimentService({
    eventLogger,
    experimentName: config.defaultExperiment,
    statsigAdapter
  });
  const geminiService = new GeminiService({
    apiKey: config.geminiApiKey,
    model: config.geminiModel,
    eventLogger
  });
  const n8nRelay = new N8nRelayService({
    webhookUrl: config.n8nWebhookUrl,
    eventLogger
  });
  const database = new AppDatabase({
    filePath: config.databasePath,
    dataDir: config.dataDir
  });
  const accountService = new AccountService({
    database,
    adminUsername: config.adminUsername,
    adminPassword: config.adminPassword
  });
  const mealService = new MealService({
    database,
    eventLogger,
    statsigAdapter,
    n8nRelay
  });
  const dailyAnalysisService = new DailyAnalysisService({
    geminiService
  });
  const healthBotService = new HealthBotService({
    mealService,
    experimentService,
    geminiService,
    dailyAnalysisService,
    accountService
  });
  const telegramService = new TelegramService({
    config,
    eventLogger
  });
  const metricsService = new MetricsService({
    dataDir: config.dataDir,
    experimentService,
    database
  });

  const ready = (async () => {
    await database.initialize();
    await accountService.initialize();
  })();

  const sseClients = new Set();
  eventBus.subscribe((event) => {
    const payload = `data: ${JSON.stringify(event)}\n\n`;
    for (const client of sseClients) {
      client.write(payload);
    }
  });

  async function ensureReady() {
    await ready;
  }

  function getAuthorizationToken(req) {
    const header = req.headers.authorization || '';
    const match = header.match(/^Bearer\s+(.+)$/i);
    return match ? match[1].trim() : null;
  }

  function getSessionToken(req) {
    const cookies = parseCookies(req.headers.cookie || '');
    return getAuthorizationToken(req) || cookies.calor_session || null;
  }

  function getSessionUser(req) {
    return accountService.authenticate(getSessionToken(req));
  }

  async function requireAuth(req, res) {
    const user = getSessionUser(req);
    if (!user) {
      sendJson(res, 401, { error: 'Authentication required' });
      return null;
    }
    return user;
  }

  async function requireAdmin(req, res) {
    const user = await requireAuth(req, res);
    if (!user) {
      return null;
    }
    if (user.role !== 'admin') {
      sendJson(res, 403, { error: 'Admin access required' });
      return null;
    }
    return user;
  }

  function canAccessUser(authUser, requestedUserId) {
    if (!authUser) {
      return true;
    }
    return authUser.role === 'admin' || authUser.id === String(requestedUserId);
  }

  async function buildUserDashboard(userId) {
    const user = accountService.getUserById(userId);
    if (!user) {
      return null;
    }

    const summary = database.getDailySummary(user.id, today());
    const trend = database.getMealTrend(user.id, 7);
    const insights = await metricsService.getUserInsights(user.id);

    return {
      user,
      summary,
      trend,
      insights,
      recentMeals: database.listRecentMeals(user.id, 8),
      portalUrl: buildPortalUrl()
    };
  }

  async function buildTelegramReply({ message, channel = 'telegram', shouldSendTelegram = false }) {
    if (!message?.text) {
      return { ok: true, skipped: true };
    }

    const userId = String(message.from?.id || message.chat?.id);
    const displayName = [message.from?.first_name, message.from?.last_name].filter(Boolean).join(' ') || null;
    const telegramUsername = message.from?.username || null;

    accountService.ensureTelegramUser({
      telegramUserId: userId,
      telegramUsername,
      displayName
    });

    await eventLogger.log({
      type: 'telegram_message_received',
      userId,
      channel,
      text: message.text
    });

    const reply = await healthBotService.respond({
      userId,
      text: message.text,
      profile: {
        displayName,
        telegramUsername,
        portalUrl: buildPortalUrl()
      }
    });

    if (isPortalCommand(message.text)) {
      await n8nRelay.portalCredentialsIssued(accountService.getUserById(userId), channel);
    }

    if (shouldSendTelegram) {
      await telegramService.sendMessage(message.chat.id, reply.text, reply.suggestions);
    }

    return {
      ok: true,
      chatId: message.chat?.id || null,
      userId,
      reply,
      text: reply.text,
      suggestions: reply.suggestions || []
    };
  }

  async function route(req, res) {
    await ensureReady();

    const url = new URL(req.url, config.appBaseUrl);
    const pathname = url.pathname;
    const method = req.method;

    if (method === 'GET' && pathname === '/api/health') {
      return sendJson(res, 200, {
        ok: true,
        app: 'CalorAI',
        now: new Date().toISOString(),
        portalUrl: buildPortalUrl()
      });
    }

    if (method === 'POST' && pathname === '/api/auth/login') {
      const body = await readJsonBody(req);
      const session = accountService.login({
        username: String(body.username || ''),
        password: String(body.password || '')
      });

      if (!session) {
        return sendJson(res, 401, { error: 'Invalid username or password' });
      }

      await eventLogger.log({
        type: 'portal_login_succeeded',
        userId: session.user.id,
        role: session.user.role
      });

      return sendJson(
        res,
        200,
        {
          ok: true,
          user: session.user,
          portalUrl: buildPortalUrl(),
          sessionToken: session.token
        },
        {
          'Set-Cookie': createSessionCookie(session.token)
        }
      );
    }

    if (method === 'POST' && pathname === '/api/auth/logout') {
      accountService.logout(getSessionToken(req));
      return sendJson(
        res,
        200,
        { ok: true },
        {
          'Set-Cookie': clearSessionCookie()
        }
      );
    }

    if (method === 'GET' && pathname === '/api/auth/session') {
      const user = getSessionUser(req);
      return sendJson(res, 200, {
        authenticated: Boolean(user),
        user,
        portalUrl: buildPortalUrl()
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

    if (method === 'GET' && pathname === '/api/me/dashboard') {
      const authUser = await requireAuth(req, res);
      if (!authUser) {
        return;
      }

      return sendJson(res, 200, await buildUserDashboard(authUser.id));
    }

    if (method === 'GET' && pathname === '/api/me/analysis') {
      const authUser = await requireAuth(req, res);
      if (!authUser) {
        return;
      }

      const assignment = await experimentService.assignUser(authUser.id);
      const summary = await mealService.getDailySummary(authUser.id, today());
      const analysis = await dailyAnalysisService.generate({
        summary,
        variant: assignment.variant
      });

      return sendJson(res, 200, {
        variant: assignment.variant,
        summary,
        analysis
      });
    }

    if (method === 'PATCH' && pathname === '/api/me/profile') {
      const authUser = await requireAuth(req, res);
      if (!authUser) {
        return;
      }

      const body = await readJsonBody(req);
      const updated = accountService.updateUserProfile(authUser.id, body);
      await eventLogger.log({
        type: 'profile_updated',
        userId: authUser.id
      });
      return sendJson(res, 200, updated);
    }

    if (method === 'POST' && pathname === '/api/me/password') {
      const authUser = await requireAuth(req, res);
      if (!authUser) {
        return;
      }

      const body = await readJsonBody(req);
      const result = accountService.changePassword({
        userId: authUser.id,
        currentPassword: String(body.currentPassword || ''),
        nextPassword: String(body.nextPassword || '')
      });

      if (!result.ok) {
        return sendJson(res, 400, result);
      }

      await eventLogger.log({
        type: 'password_changed',
        userId: authUser.id
      });
      return sendJson(res, 200, result);
    }

    if (method === 'GET' && pathname === '/api/me/summary') {
      const authUser = await requireAuth(req, res);
      if (!authUser) {
        return;
      }

      const date = url.searchParams.get('date') || today();
      return sendJson(res, 200, await mealService.getDailySummary(authUser.id, date));
    }

    const myMealsMatch = pathname.match(/^\/api\/me\/meals(?:\/([^/]+))?$/);
    if (myMealsMatch) {
      const authUser = await requireAuth(req, res);
      if (!authUser) {
        return;
      }

      const mealId = myMealsMatch[1] ? decodeURIComponent(myMealsMatch[1]) : null;

      if (method === 'GET' && !mealId) {
        const date = url.searchParams.get('date') || today();
        return sendJson(res, 200, await mealService.listMeals(authUser.id, date));
      }

      if (method === 'POST' && !mealId) {
        return sendJson(res, 201, await mealService.createMeal(authUser.id, await readJsonBody(req)));
      }

      if (method === 'PATCH' && mealId) {
        const updated = await mealService.updateMeal(authUser.id, mealId, await readJsonBody(req));
        if (!updated) {
          return sendJson(res, 404, { error: 'Meal not found' });
        }
        return sendJson(res, 200, updated);
      }

      if (method === 'DELETE' && mealId) {
        const deleted = await mealService.deleteMeal(authUser.id, mealId);
        if (!deleted) {
          return sendJson(res, 404, { error: 'Meal not found' });
        }
        return sendJson(res, 200, deleted);
      }
    }

    if (method === 'GET' && pathname === '/api/admin/dashboard') {
      const adminUser = await requireAdmin(req, res);
      if (!adminUser) {
        return;
      }

      return sendJson(res, 200, {
        ...(await metricsService.getAdminDashboard()),
        setup: {
          telegram: {
            webhookUrl: `${config.appBaseUrl}/api/telegram/webhook`,
            hasBotToken: telegramService.hasBotToken(),
            secretHeader: config.telegramWebhookSecret ? 'configured' : 'not-configured'
          },
          statsig: {
            experiment: config.defaultExperiment,
            variants: experimentService.getVariants().map((variant) => variant.key),
            ...(await statsigAdapter.getStatus())
          },
          n8n: {
            configured: n8nRelay.isEnabled(),
            webhookUrl: config.n8nWebhookUrl || null
          }
        },
        currentAdmin: adminUser
      });
    }

    if (method === 'GET' && pathname === '/api/admin/users') {
      const adminUser = await requireAdmin(req, res);
      if (!adminUser) {
        return;
      }

      return sendJson(res, 200, database.listUsersWithStats());
    }

    if (method === 'POST' && pathname === '/api/admin/users') {
      const adminUser = await requireAdmin(req, res);
      if (!adminUser) {
        return;
      }

      const body = await readJsonBody(req);
      const created = accountService.createPortalUser(body);
      await eventLogger.log({
        type: 'portal_user_created',
        userId: created.user.id,
        createdBy: adminUser.id
      });
      await n8nRelay.portalCredentialsIssued(created.user, 'admin');
      return sendJson(res, 201, created);
    }

    const adminUserMatch = pathname.match(/^\/api\/admin\/users\/([^/]+)\/(dashboard|reset-password)$/);
    if (adminUserMatch) {
      const adminUser = await requireAdmin(req, res);
      if (!adminUser) {
        return;
      }

      const userId = decodeURIComponent(adminUserMatch[1]);
      const action = adminUserMatch[2];

      if (method === 'GET' && action === 'dashboard') {
        const payload = await buildUserDashboard(userId);
        if (!payload) {
          return sendJson(res, 404, { error: 'User not found' });
        }
        return sendJson(res, 200, payload);
      }

      if (method === 'POST' && action === 'reset-password') {
        const reset = accountService.resetUserPassword(userId);
        if (!reset.user) {
          return sendJson(res, 404, { error: 'User not found' });
        }
        await eventLogger.log({
          type: 'portal_password_reset',
          userId,
          createdBy: adminUser.id
        });
        await n8nRelay.portalCredentialsIssued(reset.user, 'admin_reset');
        return sendJson(res, 200, reset);
      }
    }

    if (method === 'POST' && pathname === '/api/chat') {
      const body = await readJsonBody(req);
      const sessionUser = getSessionUser(req);
      const userId = String(body.userId || sessionUser?.id || 'demo-user');
      const channel = body.channel || (sessionUser ? 'portal' : 'dashboard');
      const userRecord = accountService.ensureUserRecord({
        userId,
        username: body.username || `user_${userId.slice(-6)}`,
        displayName: body.displayName || sessionUser?.displayName || `User ${userId.slice(-4)}`
      });
      const startedAt = Date.now();

      await eventLogger.log({
        type: 'telegram_message_received',
        userId,
        channel,
        text: body.text || ''
      });

      const reply = await healthBotService.respond({
        userId,
        text: String(body.text || ''),
        profile: {
          displayName: userRecord.display_name || userRecord.displayName,
          telegramUsername: userRecord.telegram_username || userRecord.telegramUsername,
          portalUrl: buildPortalUrl()
        }
      });

      if (isPortalCommand(body.text)) {
        await n8nRelay.portalCredentialsIssued(accountService.getUserById(userId), 'bot');
      }

      await eventLogger.log({
        type: 'chatbot_reply_generated',
        userId,
        variant: reply.variant.key,
        latencyMs: Date.now() - startedAt
      });

      return sendJson(res, 200, reply);
    }

    if (method === 'POST' && pathname === '/api/n8n/telegram/reply') {
      const body = await readJsonBody(req);
      const payload = await buildTelegramReply({
        message: body.message || body.update?.message || null,
        channel: 'telegram_n8n',
        shouldSendTelegram: false
      });
      return sendJson(res, 200, payload);
    }

    const mealsMatch = pathname.match(/^\/api\/users\/([^/]+)\/meals(?:\/([^/]+))?$/);
    if (mealsMatch) {
      const userId = decodeURIComponent(mealsMatch[1]);
      const mealId = mealsMatch[2] ? decodeURIComponent(mealsMatch[2]) : null;
      const authUser = getSessionUser(req);

      if (!canAccessUser(authUser, userId)) {
        return sendJson(res, 403, { error: 'Forbidden' });
      }

      if (method === 'GET' && !mealId) {
        const date = url.searchParams.get('date') || today();
        return sendJson(res, 200, await mealService.listMeals(userId, date));
      }

      if (method === 'POST' && !mealId) {
        accountService.ensureUserRecord({
          userId,
          username: `user_${userId.slice(-6)}`,
          displayName: `User ${userId.slice(-4)}`
        });
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
      const authUser = getSessionUser(req);
      if (!canAccessUser(authUser, userId)) {
        return sendJson(res, 403, { error: 'Forbidden' });
      }
      const date = url.searchParams.get('date') || today();
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
      const payload = await buildTelegramReply({
        message: update.message,
        channel: 'telegram',
        shouldSendTelegram: true
      });
      return sendJson(res, 200, payload);
    }

    if (method === 'GET' && pathname === '/api/setup/telegram') {
      return sendJson(res, 200, {
        webhookUrl: `${config.appBaseUrl}/api/telegram/webhook`,
        hasBotToken: telegramService.hasBotToken(),
        secretHeader: config.telegramWebhookSecret ? 'configured' : 'not-configured'
      });
    }

    if (method === 'GET' && pathname === '/api/setup/statsig') {
      return sendJson(res, 200, {
        experiment: config.defaultExperiment,
        variants: experimentService.getVariants().map((variant) => variant.key),
        ...(await statsigAdapter.getStatus())
      });
    }

    if (method === 'GET' && pathname === '/api/setup/n8n') {
      return sendJson(res, 200, {
        configured: n8nRelay.isEnabled(),
        webhookUrl: config.n8nWebhookUrl || null
      });
    }

    if (
      method === 'GET' &&
      (pathname === '/robots.txt' || pathname === '/manifest.webmanifest' || pathname === '/sw.js' || pathname === '/app.js' || pathname === '/styles.css' || pathname.startsWith('/assets/'))
    ) {
      const served = await serveStaticFile(res, path.join(config.publicDir, pathname.replace(/^\//, '')));
      if (served) {
        return;
      }
    }

    if (method === 'GET' && pathname === '/robots.txt') {
      return sendText(res, 200, 'User-agent: *\nAllow: /\n');
    }

    if (method === 'GET' && (pathname === '/' || pathname === '/portal' || pathname === '/admin' || pathname === '/login' || !pathname.startsWith('/api/') && !hasExtension(pathname))) {
      const served = await serveStaticFile(res, path.join(config.publicDir, 'index.html'));
      if (served) {
        return;
      }
    }

    notFound(res);
  }

  return { route };
}
