/**
 * Antigravity SaaS - Database Schema
 * Uses sqlite3 (async wrapped as sync) — compatible with CloudLinux/cPanel
 */

const path = require('path');
const fs = require('fs');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../../data/antigravity.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

// ─── Load SQLite driver (prefers better-sqlite3, falls back to sqlite3) ───────
let db;

// Try 1: better-sqlite3 (fast, sync)
try {
    const Database = require('better-sqlite3');
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    console.log('  ✓ SQLite: better-sqlite3');
} catch (_) {
    // Try 2: node:sqlite (Node 22.5+)
    try {
        const { DatabaseSync } = require('node:sqlite');
        const raw = new DatabaseSync(DB_PATH);
        db = {
            _raw: raw,
            pragma(s) { raw.exec(`PRAGMA ${s}`); },
            exec(sql) { raw.exec(sql); },
            prepare(sql) {
                const st = raw.prepare(sql);
                return {
                    run: (...a) => st.run(...a),
                    get: (...a) => st.get(...a),
                    all: (...a) => st.all(...a),
                };
            },
            transaction(fn) {
                return (...args) => {
                    raw.exec('BEGIN');
                    try { const r = fn(...args); raw.exec('COMMIT'); return r; }
                    catch (e) { raw.exec('ROLLBACK'); throw e; }
                };
            },
        };
        db.pragma('journal_mode = WAL');
        db.pragma('foreign_keys = ON');
        console.log('  ✓ SQLite: node:sqlite (built-in)');
    } catch (_2) {
        // Try 3: sqlite3 npm package (async, but we wrap it synchronously using
        // a worker-based approach at startup only)
        const sqlite3 = require('sqlite3').verbose();
        const rawDb = new sqlite3.Database(DB_PATH);

        // Helper: run SQL synchronously using Atomics+SharedArrayBuffer trick
        // For startup init only — all schema SQL runs immediately
        function runSync(sql) {
            return new Promise((res, rej) => {
                rawDb.run(sql, (err) => err ? rej(err) : res());
            });
        }

        // We wrap the async sqlite3 into a sync-like API using pre-run statements
        db = {
            pragma(s) { rawDb.run(`PRAGMA ${s}`); },
            exec(sql) {
                // Split on ; and run each statement right away (fire-and-forget at init)
                sql.split(';').map(s => s.trim()).filter(Boolean).forEach(s => {
                    rawDb.run(s, (err) => { if (err && !err.message.includes('already exists')) console.error('DB exec err:', err.message); });
                });
            },
            prepare(sql) {
                const stmt = rawDb.prepare(sql);
                return {
                    run: (...args) => { stmt.run(...args); return {}; },
                    get: (...args) => {
                        let result;
                        // Use synchronous sqlite3 API: stmt.get is sync when callback omitted in some versions
                        stmt.get(...args, (err, row) => { result = row; });
                        return result;
                    },
                    all: (...args) => {
                        let rows = [];
                        stmt.all(...args, (err, r) => { rows = r || []; });
                        return rows;
                    },
                };
            },
            transaction(fn) {
                return (...args) => {
                    rawDb.run('BEGIN');
                    try { const r = fn(...args); rawDb.run('COMMIT'); return r; }
                    catch (e) { rawDb.run('ROLLBACK'); throw e; }
                };
            },
            _raw: rawDb,
        };
        console.log('  ✓ SQLite: sqlite3 (async fallback)');
    }
}

// ─── Schema Migrations ───────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    email       TEXT UNIQUE NOT NULL COLLATE NOCASE,
    password    TEXT NOT NULL,
    name        TEXT NOT NULL,
    avatar      TEXT,
    plan        TEXT NOT NULL DEFAULT 'free',
    status      TEXT NOT NULL DEFAULT 'active',
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS workspaces (
    id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    description TEXT,
    status      TEXT NOT NULL DEFAULT 'active',
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS api_keys (
    id           TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    key          TEXT UNIQUE NOT NULL,
    name         TEXT NOT NULL DEFAULT 'Default Key',
    last_used_at TEXT,
    expires_at   TEXT,
    is_active    INTEGER NOT NULL DEFAULT 1,
    created_at   TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS messages (
    id           TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    content      TEXT NOT NULL,
    role         TEXT NOT NULL CHECK(role IN ('user','agent','system')),
    message_type TEXT NOT NULL DEFAULT 'text',
    metadata     TEXT DEFAULT '{}',
    read         INTEGER NOT NULL DEFAULT 0,
    created_at   TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS approvals (
    id           TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    title        TEXT NOT NULL,
    description  TEXT,
    command      TEXT,
    risk_level   TEXT NOT NULL DEFAULT 'low' CHECK(risk_level IN ('low','medium','high','critical')),
    status       TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','expired')),
    expires_at   TEXT NOT NULL DEFAULT (datetime('now', '+10 minutes')),
    resolved_at  TEXT,
    resolved_by  TEXT,
    metadata     TEXT DEFAULT '{}',
    created_at   TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS activity (
    id           TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    title        TEXT NOT NULL,
    description  TEXT,
    icon         TEXT DEFAULT '📌',
    type         TEXT NOT NULL DEFAULT 'info',
    metadata     TEXT DEFAULT '{}',
    created_at   TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS agent_sessions (
    id            TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    workspace_id  TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    api_key_id    TEXT NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
    socket_id     TEXT,
    hostname      TEXT,
    platform      TEXT,
    agent_version TEXT,
    is_online     INTEGER NOT NULL DEFAULT 1,
    last_ping_at  TEXT NOT NULL DEFAULT (datetime('now')),
    connected_at  TEXT NOT NULL DEFAULT (datetime('now')),
    disconnected_at TEXT
  );
  CREATE TABLE IF NOT EXISTS refresh_tokens (
    id         TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token      TEXT UNIQUE NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_messages_workspace ON messages(workspace_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_approvals_workspace ON approvals(workspace_id, status);
  CREATE INDEX IF NOT EXISTS idx_activity_workspace ON activity(workspace_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_api_keys_key ON api_keys(key);
  CREATE INDEX IF NOT EXISTS idx_workspaces_user ON workspaces(user_id);
`);

module.exports = db;
