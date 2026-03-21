#!/usr/bin/env node

/**
 * Bootstrap the first local Admin key directly into SQLite.
 *
 * Usage:
 *   node bootstrap-admin-key.js [contestantName]
 *
 * Env:
 *   XTION_DB_PATH=/abs/path/to/xtion.db
 */

const crypto = require('crypto');
const path = require('path');
const Database = require('better-sqlite3');

const contestantName = (process.argv[2] || 'LocalAdmin').trim();
const dbPath = process.env.XTION_DB_PATH || path.join(__dirname, 'data/xtion.db');

if (!contestantName) {
  console.error('contestantName 不能为空');
  process.exit(1);
}

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Support first-run bootstrap against a brand-new DB file before the server
// has created the full schema.
db.exec(`
  CREATE TABLE IF NOT EXISTS keys (
    id TEXT PRIMARY KEY,
    key TEXT NOT NULL UNIQUE,
    contestant_name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'Agent_Player',
    status TEXT NOT NULL DEFAULT 'active',
    created_at INTEGER NOT NULL,
    revoked_at INTEGER
  );
`);

const activeAdmins = db
  .prepare("SELECT id, contestant_name, created_at FROM keys WHERE role = 'Admin' AND status = 'active' ORDER BY created_at DESC")
  .all();

if (activeAdmins.length > 0) {
  console.error('已存在 active Admin key，停止 bootstrap 以避免重复创建。');
  for (const admin of activeAdmins) {
    console.error(`- ${admin.contestant_name} (${admin.id}) created_at=${admin.created_at}`);
  }
  process.exit(1);
}

const id = crypto.randomUUID();
const key = crypto.randomBytes(32).toString('hex');
const createdAt = Date.now();

db.prepare(
  `
    INSERT INTO keys (id, key, contestant_name, role, status, created_at)
    VALUES (?, ?, ?, 'Admin', 'active', ?)
  `,
).run(id, key, contestantName, createdAt);

console.log('Bootstrap admin key created.');
console.log(`DB:   ${dbPath}`);
console.log(`ID:   ${id}`);
console.log(`Name: ${contestantName}`);
console.log('Role: Admin');
console.log(`Key:  ${key}`);
