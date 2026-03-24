import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from './lib/env.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
loadEnv(rootDir);

function normalizeAppBaseUrl(input) {
  const fallback = 'http://localhost:3000';
  if (!input) {
    return fallback;
  }

  const trimmed = input.trim().replace(/\/+$/, '');
  const suffix = '/api/telegram/webhook';
  const normalized = trimmed.endsWith(suffix) ? trimmed.slice(0, -suffix.length) : trimmed;
  return normalized || fallback;
}

const dataDir = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(rootDir, 'data');

export const config = {
  port: Number(process.env.PORT || 3000),
  rootDir,
  publicDir: path.join(rootDir, 'public'),
  dataDir,
  databasePath: process.env.DATABASE_PATH ? path.resolve(process.env.DATABASE_PATH) : path.join(dataDir, 'calor.db'),
  appBaseUrl: normalizeAppBaseUrl(process.env.APP_BASE_URL),
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN || '',
  telegramWebhookSecret: process.env.TELEGRAM_WEBHOOK_SECRET || '',
  telegramApiBase: process.env.TELEGRAM_API_BASE || 'https://api.telegram.org',
  statsigServerKey: process.env.STATSIG_SERVER_KEY || '',
  defaultExperiment: process.env.DEFAULT_EXPERIMENT || 'coach_tone_v1',
  geminiApiKey: process.env.GEMINI_API_KEY || '',
  geminiModel: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
  n8nWebhookUrl: process.env.N8N_WEBHOOK_URL || '',
  adminUsername: process.env.ADMIN_USERNAME || 'admin',
  adminPassword: process.env.ADMIN_PASSWORD || 'caloradmin123'
};
