import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from './lib/env.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
loadEnv(rootDir);

export const config = {
  port: Number(process.env.PORT || 3000),
  rootDir,
  publicDir: path.join(rootDir, 'public'),
  dataDir: process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(rootDir, 'data'),
  appBaseUrl: process.env.APP_BASE_URL || 'http://localhost:3000',
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN || '',
  telegramWebhookSecret: process.env.TELEGRAM_WEBHOOK_SECRET || '',
  telegramApiBase: process.env.TELEGRAM_API_BASE || 'https://api.telegram.org',
  statsigServerKey: process.env.STATSIG_SERVER_KEY || '',
  defaultExperiment: process.env.DEFAULT_EXPERIMENT || 'coach_tone_v1'
};
