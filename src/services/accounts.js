import crypto from 'node:crypto';
import { generatePassword, hashPassword, randomToken, tokenHash, verifyPassword } from '../lib/auth.js';

function safeUsernameBase(input) {
  return String(input || 'user')
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 18) || 'user';
}

export class AccountService {
  constructor({ database, adminUsername, adminPassword }) {
    this.database = database;
    this.adminUsername = adminUsername;
    this.adminPassword = adminPassword;
  }

  async initialize() {
    const existing = this.database.getUserByUsername(this.adminUsername);
    if (!existing) {
      this.database.createUser({
        id: crypto.randomUUID(),
        username: this.adminUsername,
        passwordHash: hashPassword(this.adminPassword),
        role: 'admin',
        displayName: 'CalorAI Admin',
        createdAt: new Date().toISOString(),
        dailyCalorieTarget: 2200,
        dailyProteinTarget: 120
      });
    }
  }

  sanitizeUser(user) {
    if (!user) {
      return null;
    }

    return {
      id: user.id,
      username: user.username,
      role: user.role,
      telegramUserId: user.telegram_user_id || user.telegramUserId || null,
      telegramUsername: user.telegram_username || user.telegramUsername || null,
      displayName: user.display_name || user.displayName || user.username,
      createdAt: user.created_at || user.createdAt,
      lastLoginAt: user.last_login_at || user.lastLoginAt || null,
      dailyCalorieTarget: Number(user.daily_calorie_target || user.dailyCalorieTarget || 2200),
      dailyProteinTarget: Number(user.daily_protein_target || user.dailyProteinTarget || 120)
    };
  }

  createUniqueUsername(base) {
    let attempt = safeUsernameBase(base);
    let counter = 1;
    while (this.database.getUserByUsername(attempt)) {
      counter += 1;
      attempt = `${safeUsernameBase(base)}_${counter}`;
    }
    return attempt;
  }

  getUserById(userId) {
    return this.sanitizeUser(this.database.getUserById(userId));
  }

  ensureUserRecord({ userId, username, displayName, telegramUserId, telegramUsername }) {
    const existing =
      this.database.getUserById(userId) ||
      (telegramUserId ? this.database.getUserByTelegramId(telegramUserId) : null);

    if (existing) {
      return this.database.updateUserIdentity(existing.id, {
        telegramUserId: telegramUserId ? String(telegramUserId) : undefined,
        telegramUsername: telegramUsername || undefined,
        displayName: displayName || undefined
      });
    }

    return this.database.createUser({
      id: String(userId),
      username: this.createUniqueUsername(username || `user_${String(userId).slice(-6)}`),
      passwordHash: null,
      role: 'user',
      telegramUserId: telegramUserId ? String(telegramUserId) : null,
      telegramUsername: telegramUsername || null,
      displayName: displayName || `User ${String(userId).slice(-4)}`,
      createdAt: new Date().toISOString(),
      dailyCalorieTarget: 2200,
      dailyProteinTarget: 120
    });
  }

  ensureTelegramUser({ telegramUserId, telegramUsername, displayName }) {
    return this.ensureUserRecord({
      userId: telegramUserId,
      username: telegramUsername || `user_${String(telegramUserId).slice(-4)}`,
      displayName,
      telegramUserId,
      telegramUsername
    });
  }

  issuePortalCredentials({ telegramUserId, telegramUsername, displayName }) {
    const user = this.ensureTelegramUser({ telegramUserId, telegramUsername, displayName });
    const password = generatePassword(10);
    const updated = this.database.updateUserPassword(user.id, hashPassword(password));
    return {
      user: this.sanitizeUser(updated),
      username: updated.username,
      password
    };
  }

  createPortalUser({ username, password, displayName, telegramUserId, telegramUsername, dailyCalorieTarget, dailyProteinTarget }) {
    const issuedPassword = password || generatePassword(10);
    const normalizedTelegramUserId = telegramUserId ? String(telegramUserId) : null;
    const existingTelegramUser = normalizedTelegramUserId
      ? this.database.getUserByTelegramId(normalizedTelegramUserId)
      : null;

    if (existingTelegramUser) {
      const nextUsername =
        username && username !== existingTelegramUser.username
          ? this.createUniqueUsername(username)
          : existingTelegramUser.username;

      this.database.updateUserIdentity(existingTelegramUser.id, {
        username: nextUsername,
        telegramUserId: normalizedTelegramUserId,
        telegramUsername: telegramUsername || existingTelegramUser.telegram_username || undefined,
        displayName: displayName || existingTelegramUser.display_name || undefined,
        isActive: 1
      });

      this.database.updateUserProfile(existingTelegramUser.id, {
        displayName: displayName || existingTelegramUser.display_name || existingTelegramUser.username,
        dailyCalorieTarget: Number(
          dailyCalorieTarget || existingTelegramUser.daily_calorie_target || 2200
        ),
        dailyProteinTarget: Number(
          dailyProteinTarget || existingTelegramUser.daily_protein_target || 120
        )
      });

      const updated = this.database.updateUserPassword(
        existingTelegramUser.id,
        hashPassword(issuedPassword)
      );

      return {
        user: this.sanitizeUser(updated),
        username: updated.username,
        password: issuedPassword
      };
    }

    const created = this.database.createUser({
      id: normalizedTelegramUserId || crypto.randomUUID(),
      username: this.createUniqueUsername(username),
      passwordHash: hashPassword(issuedPassword),
      role: 'user',
      telegramUserId: normalizedTelegramUserId,
      telegramUsername: telegramUsername || null,
      displayName: displayName || username,
      createdAt: new Date().toISOString(),
      dailyCalorieTarget: Number(dailyCalorieTarget || 2200),
      dailyProteinTarget: Number(dailyProteinTarget || 120)
    });
    return {
      user: this.sanitizeUser(created),
      username: created.username,
      password: issuedPassword
    };
  }

  resetUserPassword(userId) {
    const password = generatePassword(10);
    const updated = this.database.updateUserPassword(userId, hashPassword(password));
    return {
      user: this.sanitizeUser(updated),
      password
    };
  }

  login({ username, password }) {
    const user = this.database.getUserByUsername(username);
    if (!user || !verifyPassword(password, user.password_hash || user.passwordHash)) {
      return null;
    }

    const token = randomToken(24);
    this.database.createSession({
      id: crypto.randomUUID(),
      userId: user.id,
      tokenHash: tokenHash(token),
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 7).toISOString()
    });
    this.database.touchUserLogin(user.id);

    return {
      user: this.sanitizeUser(this.database.getUserById(user.id)),
      token
    };
  }

  verifyUserPassword(userId, password) {
    const user = this.database.getUserById(userId);
    if (!user) {
      return false;
    }
    return verifyPassword(password, user.password_hash || user.passwordHash);
  }

  authenticate(sessionToken) {
    if (!sessionToken) {
      return null;
    }
    return this.sanitizeUser(this.database.getSessionUserByHash(tokenHash(sessionToken)));
  }

  logout(sessionToken) {
    if (!sessionToken) {
      return;
    }
    this.database.deleteSessionByHash(tokenHash(sessionToken));
  }

  updateUserProfile(userId, patch) {
    return this.sanitizeUser(
      this.database.updateUserProfile(userId, {
        displayName: patch.displayName,
        dailyCalorieTarget: Number(patch.dailyCalorieTarget),
        dailyProteinTarget: Number(patch.dailyProteinTarget)
      })
    );
  }

  changePassword({ userId, currentPassword, nextPassword }) {
    if (!nextPassword || String(nextPassword).length < 8) {
      return { ok: false, error: 'Password must be at least 8 characters.' };
    }

    if (!this.verifyUserPassword(userId, currentPassword)) {
      return { ok: false, error: 'Current password is incorrect.' };
    }

    this.database.updateUserPassword(userId, hashPassword(nextPassword));
    return { ok: true };
  }
}
