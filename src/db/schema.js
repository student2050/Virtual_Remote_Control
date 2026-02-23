/**
 * Antigravity SaaS - Database Schema
 * SQLite via better-sqlite3
 */

const Database = require('better-sqlite3');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../../data/antigravity.db');

// Ensure data directory exists
const fs = require('fs');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ─── Schema Migrations ───────────────────────────────────────────────────────

db.exec(`
  -- Users table
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

  -- Workspaces (one per user on free, multiple on pro)
  CREATE TABLE IF NOT EXISTS workspaces (
    id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    description TEXT,
    status      TEXT NOT NULL DEFAULT 'active',
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- API Keys (for local agent connection)
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

  -- Messages (chat between user & agent)
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

  -- Approval Requests (agent asks user for permission)
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

  -- Activity Log
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

  -- Agent Sessions (track connected agents)
  CREATE TABLE IF NOT EXISTS agent_sessions (
    id           TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    api_key_id   TEXT NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
    socket_id    TEXT,
    hostname     TEXT,
    platform     TEXT,
    agent_version TEXT,
    is_online    INTEGER NOT NULL DEFAULT 1,
    last_ping_at TEXT NOT NULL DEFAULT (datetime('now')),
    connected_at TEXT NOT NULL DEFAULT (datetime('now')),
    disconnected_at TEXT
  );

  -- Refresh Tokens
  CREATE TABLE IF NOT EXISTS refresh_tokens (
    id         TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token      TEXT UNIQUE NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Indexes
  CREATE INDEX IF NOT EXISTS idx_messages_workspace ON messages(workspace_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_approvals_workspace ON approvals(workspace_id, status);
  CREATE INDEX IF NOT EXISTS idx_activity_workspace ON activity(workspace_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_api_keys_key ON api_keys(key);
  CREATE INDEX IF NOT EXISTS idx_workspaces_user ON workspaces(user_id);
`);

module.exports = db;
