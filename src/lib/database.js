import { DatabaseSync } from 'node:sqlite';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';

function toDay(input) {
  return new Date(input).toISOString().slice(0, 10);
}

export class AppDatabase {
  constructor({ filePath, dataDir }) {
    this.filePath = filePath;
    this.dataDir = dataDir;
    this.db = null;
  }

  async initialize() {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    this.db = new DatabaseSync(this.filePath);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL UNIQUE,
        password_hash TEXT,
        role TEXT NOT NULL,
        telegram_user_id TEXT UNIQUE,
        telegram_username TEXT,
        display_name TEXT,
        created_at TEXT NOT NULL,
        last_login_at TEXT,
        daily_calorie_target INTEGER DEFAULT 2200,
        daily_protein_target INTEGER DEFAULT 120,
        is_active INTEGER DEFAULT 1
      );
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        token_hash TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS meals (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        calories REAL NOT NULL,
        protein REAL NOT NULL,
        carbs REAL NOT NULL,
        fats REAL NOT NULL,
        notes TEXT,
        logged_at TEXT NOT NULL,
        source TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_meals_user_day ON meals(user_id, logged_at);
      CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at);
    `);

    await this.importLegacyData();
  }

  async importLegacyData() {
    const userCount = this.db.prepare('SELECT COUNT(*) AS count FROM users').get().count;
    const mealCount = this.db.prepare('SELECT COUNT(*) AS count FROM meals').get().count;

    if (userCount || mealCount) {
      return;
    }

    const mealsPath = path.join(this.dataDir, 'meals.json');
    const profilesPath = path.join(this.dataDir, 'profiles.json');

    let meals = [];
    let profiles = {};

    try {
      meals = JSON.parse(await readFile(mealsPath, 'utf8'));
    } catch {}

    try {
      profiles = JSON.parse(await readFile(profilesPath, 'utf8'));
    } catch {}

    const knownUserIds = new Set();
    const insertUser = this.db.prepare(`
      INSERT OR IGNORE INTO users (
        id, username, password_hash, role, telegram_user_id, telegram_username, display_name, created_at
      ) VALUES (?, ?, NULL, 'user', ?, NULL, ?, ?)
    `);
    const insertMeal = this.db.prepare(`
      INSERT OR IGNORE INTO meals (
        id, user_id, name, calories, protein, carbs, fats, notes, logged_at, source
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const [userId, profile] of Object.entries(profiles)) {
      knownUserIds.add(userId);
      insertUser.run(
        userId,
        `user_${String(userId).slice(-6)}`,
        userId,
        profile.displayName || `User ${String(userId).slice(-4)}`,
        profile.createdAt || new Date().toISOString()
      );
    }

    for (const meal of meals) {
      if (!knownUserIds.has(meal.userId)) {
        insertUser.run(
          meal.userId,
          `user_${String(meal.userId).slice(-6)}`,
          meal.userId,
          `User ${String(meal.userId).slice(-4)}`,
          meal.loggedAt || new Date().toISOString()
        );
        knownUserIds.add(meal.userId);
      }

      insertMeal.run(
        meal.id,
        meal.userId,
        meal.name,
        Number(meal.calories || 0),
        Number(meal.protein || 0),
        Number(meal.carbs || 0),
        Number(meal.fats || 0),
        meal.notes || '',
        meal.loggedAt || new Date().toISOString(),
        meal.source || 'manual'
      );
    }
  }

  getUserById(userId) {
    return this.db.prepare('SELECT * FROM users WHERE id = ?').get(String(userId)) || null;
  }

  getUserByUsername(username) {
    return this.db.prepare('SELECT * FROM users WHERE lower(username) = lower(?)').get(username) || null;
  }

  getUserByTelegramId(telegramUserId) {
    return this.db.prepare('SELECT * FROM users WHERE telegram_user_id = ?').get(String(telegramUserId)) || null;
  }

  listUsersWithStats() {
    return this.db.prepare(`
      SELECT
        users.id,
        users.username,
        users.role,
        users.telegram_user_id AS telegramUserId,
        users.telegram_username AS telegramUsername,
        users.display_name AS displayName,
        users.created_at AS createdAt,
        users.last_login_at AS lastLoginAt,
        users.daily_calorie_target AS dailyCalorieTarget,
        users.daily_protein_target AS dailyProteinTarget,
        COUNT(meals.id) AS mealCount,
        COALESCE(SUM(CASE WHEN substr(meals.logged_at, 1, 10) = date('now') THEN meals.calories ELSE 0 END), 0) AS caloriesToday,
        MAX(meals.logged_at) AS lastMealAt
      FROM users
      LEFT JOIN meals ON meals.user_id = users.id
      WHERE users.is_active = 1
      GROUP BY users.id
      ORDER BY users.created_at DESC
    `).all();
  }

  createUser(user) {
    this.db.prepare(`
      INSERT INTO users (
        id, username, password_hash, role, telegram_user_id, telegram_username, display_name, created_at,
        daily_calorie_target, daily_protein_target
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      user.id,
      user.username,
      user.passwordHash || null,
      user.role,
      user.telegramUserId || null,
      user.telegramUsername || null,
      user.displayName || null,
      user.createdAt,
      user.dailyCalorieTarget ?? 2200,
      user.dailyProteinTarget ?? 120
    );
    return this.getUserById(user.id);
  }

  updateUserPassword(userId, passwordHash) {
    this.db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(passwordHash, String(userId));
    return this.getUserById(userId);
  }

  updateUserIdentity(userId, patch) {
    this.db.prepare(`
      UPDATE users
      SET
        username = COALESCE(?, username),
        telegram_user_id = COALESCE(?, telegram_user_id),
        telegram_username = COALESCE(?, telegram_username),
        display_name = COALESCE(?, display_name),
        is_active = COALESCE(?, is_active)
      WHERE id = ?
    `).run(
      patch.username ?? null,
      patch.telegramUserId ?? null,
      patch.telegramUsername ?? null,
      patch.displayName ?? null,
      patch.isActive ?? null,
      String(userId)
    );
    return this.getUserById(userId);
  }

  updateUserProfile(userId, patch) {
    this.db.prepare(`
      UPDATE users
      SET display_name = ?, daily_calorie_target = ?, daily_protein_target = ?
      WHERE id = ?
    `).run(
      patch.displayName,
      patch.dailyCalorieTarget,
      patch.dailyProteinTarget,
      String(userId)
    );
    return this.getUserById(userId);
  }

  touchUserLogin(userId) {
    this.db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(new Date().toISOString(), String(userId));
  }

  createSession(session) {
    this.db.prepare(`
      INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(session.id, session.userId, session.tokenHash, session.createdAt, session.expiresAt);
  }

  getSessionUserByHash(tokenHash) {
    this.deleteExpiredSessions();
    return this.db.prepare(`
      SELECT users.*
      FROM sessions
      JOIN users ON users.id = sessions.user_id
      WHERE sessions.token_hash = ?
      LIMIT 1
    `).get(tokenHash) || null;
  }

  deleteSessionByHash(tokenHash) {
    this.db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
  }

  deleteExpiredSessions() {
    this.db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(new Date().toISOString());
  }

  createMeal(meal) {
    this.db.prepare(`
      INSERT INTO meals (id, user_id, name, calories, protein, carbs, fats, notes, logged_at, source)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      meal.id,
      meal.userId,
      meal.name,
      meal.calories,
      meal.protein,
      meal.carbs,
      meal.fats,
      meal.notes,
      meal.loggedAt,
      meal.source
    );
    return this.getMealById(meal.userId, meal.id);
  }

  getMealById(userId, mealId) {
    return this.db.prepare('SELECT * FROM meals WHERE user_id = ? AND id = ?').get(String(userId), mealId) || null;
  }

  listMeals(userId, date = toDay(new Date())) {
    return this.db.prepare(`
      SELECT
        id,
        user_id AS userId,
        name,
        calories,
        protein,
        carbs,
        fats,
        notes,
        logged_at AS loggedAt,
        source
      FROM meals
      WHERE user_id = ? AND substr(logged_at, 1, 10) = ?
      ORDER BY logged_at ASC
    `).all(String(userId), date);
  }

  listRecentMeals(userId, limit = 8) {
    return this.db.prepare(`
      SELECT
        id,
        user_id AS userId,
        name,
        calories,
        protein,
        carbs,
        fats,
        notes,
        logged_at AS loggedAt,
        source
      FROM meals
      WHERE user_id = ?
      ORDER BY logged_at DESC
      LIMIT ?
    `).all(String(userId), Number(limit));
  }

  updateMeal(userId, mealId, patch) {
    const current = this.getMealById(userId, mealId);
    if (!current) {
      return null;
    }

    const next = {
      ...current,
      ...patch,
      calories: patch.calories !== undefined ? Number(patch.calories) : current.calories,
      protein: patch.protein !== undefined ? Number(patch.protein) : current.protein,
      carbs: patch.carbs !== undefined ? Number(patch.carbs) : current.carbs,
      fats: patch.fats !== undefined ? Number(patch.fats) : current.fats
    };

    this.db.prepare(`
      UPDATE meals
      SET name = ?, calories = ?, protein = ?, carbs = ?, fats = ?, notes = ?, source = ?
      WHERE user_id = ? AND id = ?
    `).run(
      next.name,
      next.calories,
      next.protein,
      next.carbs,
      next.fats,
      next.notes || '',
      next.source || current.source,
      String(userId),
      mealId
    );

    return this.getMealById(userId, mealId);
  }

  deleteMeal(userId, mealId) {
    const current = this.getMealById(userId, mealId);
    if (!current) {
      return null;
    }

    this.db.prepare('DELETE FROM meals WHERE user_id = ? AND id = ?').run(String(userId), mealId);
    return {
      ...current,
      userId: current.user_id || String(userId),
      loggedAt: current.logged_at || current.loggedAt
    };
  }

  getDailySummary(userId, date = toDay(new Date())) {
    const meals = this.listMeals(userId, date);
    const totals = meals.reduce(
      (acc, meal) => {
        acc.calories += Number(meal.calories || 0);
        acc.protein += Number(meal.protein || 0);
        acc.carbs += Number(meal.carbs || 0);
        acc.fats += Number(meal.fats || 0);
        return acc;
      },
      { calories: 0, protein: 0, carbs: 0, fats: 0 }
    );

    return { date, totals, meals };
  }

  getMealTrend(userId, days = 7) {
    const rows = this.db.prepare(`
      SELECT
        substr(logged_at, 1, 10) AS day,
        COUNT(*) AS mealCount,
        SUM(calories) AS calories,
        SUM(protein) AS protein
      FROM meals
      WHERE user_id = ? AND date(substr(logged_at, 1, 10)) >= date('now', ?)
      GROUP BY substr(logged_at, 1, 10)
      ORDER BY day ASC
    `).all(String(userId), `-${days - 1} days`);

    return rows.map((row) => ({
      day: row.day,
      mealCount: row.mealCount,
      calories: Number(row.calories || 0),
      protein: Number(row.protein || 0)
    }));
  }

  getAdminOverview() {
    const users = this.db.prepare('SELECT COUNT(*) AS count FROM users').get().count;
    const meals = this.db.prepare('SELECT COUNT(*) AS count FROM meals').get().count;
    const today = toDay(new Date());
    const activeToday = this.db.prepare(`
      SELECT COUNT(DISTINCT user_id) AS count
      FROM meals
      WHERE substr(logged_at, 1, 10) = ?
    `).get(today).count;
    const mealsToday = this.db.prepare(`
      SELECT COUNT(*) AS count
      FROM meals
      WHERE substr(logged_at, 1, 10) = ?
    `).get(today).count;

    return {
      totalUsers: users,
      totalMeals: meals,
      activeUsersToday: activeToday,
      mealsToday
    };
  }
}
