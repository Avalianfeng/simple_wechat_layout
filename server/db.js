import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const dataDir = path.join(__dirname, '..', 'data')
const dbPath = process.env.SQLITE_PATH || path.join(dataDir, 'app.db')

/** @type {DatabaseSync | null} */
let db = null

export function getDb() {
  if (!db) throw new Error('数据库未初始化')
  return db
}

export function initDb() {
  fs.mkdirSync(dataDir, { recursive: true })
  db = new DatabaseSync(dbPath)
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      ai_enabled INTEGER NOT NULL DEFAULT 1,
      daily_ai_limit INTEGER NOT NULL DEFAULT 5,
      status TEXT NOT NULL DEFAULT 'active',
      register_ip TEXT NOT NULL DEFAULT '',
      quota_reset_day TEXT NOT NULL DEFAULT '',
      quota_reset_used INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS usage_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      day_key TEXT NOT NULL,
      prompt_tokens INTEGER NOT NULL DEFAULT 0,
      completion_tokens INTEGER NOT NULL DEFAULT 0,
      total_tokens INTEGER NOT NULL DEFAULT 0,
      prompt_cache_hit_tokens INTEGER NOT NULL DEFAULT 0,
      prompt_cache_miss_tokens INTEGER NOT NULL DEFAULT 0,
      est_cost_cents INTEGER NOT NULL DEFAULT 0, -- 微元（1e-6 元），字段名历史兼容
      text_chars INTEGER NOT NULL DEFAULT 0,
      chunks INTEGER NOT NULL DEFAULT 1,
      retries INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL,
      error_code TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_usage_user_day
      ON usage_logs(user_id, day_key, status);
    CREATE INDEX IF NOT EXISTS idx_sessions_user
      ON sessions(user_id);

    CREATE TABLE IF NOT EXISTS register_ips (
      ip TEXT NOT NULL,
      day_key TEXT NOT NULL,
      count INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (ip, day_key)
    );

    CREATE TABLE IF NOT EXISTS ip_bans (
      ip TEXT PRIMARY KEY,
      reason TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS articles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      markdown TEXT NOT NULL,
      style_json TEXT NOT NULL DEFAULT '{}',
      images_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_articles_user
      ON articles(user_id, id DESC);

    CREATE TABLE IF NOT EXISTS uploads (
      filename TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_uploads_user
      ON uploads(user_id);
  `)
  return db
}

export function defaultDailyAiLimit() {
  const n = Number(process.env.DEFAULT_DAILY_AI_LIMIT)
  return Number.isFinite(n) ? Math.trunc(n) : 5
}

/** 非空则注册必须携带正确邀请码 */
export function getRegisterInviteCode() {
  return (process.env.REGISTER_INVITE_CODE || '').trim()
}

export function registerPerIpPerDay() {
  const n = Number(process.env.REGISTER_PER_IP_PER_DAY)
  return Number.isFinite(n) && n >= 0 ? Math.trunc(n) : 2
}
