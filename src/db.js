'use strict';

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'steadypage.db');

function ensureDir(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function openDb(dbPath = DB_PATH) {
  ensureDir(dbPath);
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      plan TEXT NOT NULL DEFAULT 'free' CHECK(plan IN ('free', 'pro')),
      stripe_customer_id TEXT,
      status_slug TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS monitors (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      url TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS checks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      monitor_id TEXT NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
      ok INTEGER NOT NULL,
      status_code INTEGER,
      latency_ms INTEGER,
      error TEXT,
      checked_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_monitors_user ON monitors(user_id);
    CREATE INDEX IF NOT EXISTS idx_checks_monitor_time ON checks(monitor_id, checked_at DESC);
  `);

  return db;
}

module.exports = { openDb, DB_PATH };
