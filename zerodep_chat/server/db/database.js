/**
 * Zero-Dependency Database using node:sqlite (built-in Node.js 22.5+)
 */

const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');

class Database {
  constructor(dbPath = './data/chat.db') {
    // Ensure data directory exists
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.db = new DatabaseSync(dbPath);

    // Enable foreign keys and WAL mode for better performance
    this.db.exec('PRAGMA foreign_keys = ON');
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec('PRAGMA synchronous = NORMAL');

    this.initSchema();
  }

  initSchema() {
    this.db.exec(`
      -- Users table
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        email TEXT UNIQUE,
        password_hash TEXT NOT NULL,
        display_name TEXT,
        avatar_url TEXT,
        status TEXT DEFAULT 'offline' CHECK(status IN ('online', 'away', 'busy', 'offline')),
        status_text TEXT,
        role TEXT DEFAULT 'user' CHECK(role IN ('admin', 'moderator', 'user', 'guest')),
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now')),
        last_seen_at TEXT,
        deleted_at TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_users_username ON users(username) WHERE deleted_at IS NULL;
      CREATE INDEX IF NOT EXISTS idx_users_email ON users(email) WHERE deleted_at IS NULL;
      CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);

      -- Rooms table
      CREATE TABLE IF NOT EXISTS rooms (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL CHECK(type IN ('channel', 'private', 'dm')),
        description TEXT,
        topic TEXT,
        created_by TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now')),
        last_message_at TEXT,
        message_count INTEGER DEFAULT 0,
        is_archived INTEGER DEFAULT 0,
        FOREIGN KEY (created_by) REFERENCES users(id)
      );

      CREATE INDEX IF NOT EXISTS idx_rooms_type ON rooms(type);
      CREATE INDEX IF NOT EXISTS idx_rooms_created_by ON rooms(created_by);

      -- Room members
      CREATE TABLE IF NOT EXISTS room_members (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        room_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        role TEXT DEFAULT 'member' CHECK(role IN ('owner', 'moderator', 'member')),
        joined_at TEXT DEFAULT (datetime('now')),
        unread_count INTEGER DEFAULT 0,
        is_muted INTEGER DEFAULT 0,
        FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        UNIQUE(room_id, user_id)
      );

      CREATE INDEX IF NOT EXISTS idx_room_members_room ON room_members(room_id);
      CREATE INDEX IF NOT EXISTS idx_room_members_user ON room_members(user_id);

      -- Messages table
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        room_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        content TEXT NOT NULL,
        type TEXT DEFAULT 'text' CHECK(type IN ('text', 'system', 'file')),
        reply_to TEXT,
        thread_id TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now')),
        deleted_at TEXT,
        FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id),
        FOREIGN KEY (reply_to) REFERENCES messages(id),
        FOREIGN KEY (thread_id) REFERENCES messages(id)
      );

      CREATE INDEX IF NOT EXISTS idx_messages_room ON messages(room_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_messages_user ON messages(user_id);
      CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages(thread_id);

      -- Reactions
      CREATE TABLE IF NOT EXISTS reactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        message_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        emoji TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        UNIQUE(message_id, user_id, emoji)
      );

      CREATE INDEX IF NOT EXISTS idx_reactions_message ON reactions(message_id);

      -- Mentions
      CREATE TABLE IF NOT EXISTS mentions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        message_id TEXT NOT NULL,
        user_id TEXT,
        type TEXT NOT NULL CHECK(type IN ('user', 'all', 'here')),
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_mentions_user ON mentions(user_id);
      CREATE INDEX IF NOT EXISTS idx_mentions_message ON mentions(message_id);

      -- Sessions
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        token_hash TEXT UNIQUE NOT NULL,
        created_at TEXT DEFAULT (datetime('now')),
        expires_at TEXT NOT NULL,
        last_used_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token_hash);
      CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
      CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

      -- DM participants (for direct message rooms)
      CREATE TABLE IF NOT EXISTS dm_participants (
        room_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        PRIMARY KEY (room_id, user_id),
        FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_dm_participants_user ON dm_participants(user_id);

      -- Settings (key-value store for app config)
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT,
        updated_at TEXT DEFAULT (datetime('now'))
      );
    `);
  }

  // Query helpers
  prepare(sql) {
    return this.db.prepare(sql);
  }

  exec(sql) {
    return this.db.exec(sql);
  }

  run(sql, params = []) {
    const stmt = this.db.prepare(sql);
    return stmt.run(...params);
  }

  get(sql, params = []) {
    const stmt = this.db.prepare(sql);
    return stmt.get(...params);
  }

  all(sql, params = []) {
    const stmt = this.db.prepare(sql);
    return stmt.all(...params);
  }

  transaction(fn) {
    this.db.exec('BEGIN TRANSACTION');
    try {
      const result = fn(this);
      this.db.exec('COMMIT');
      return result;
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  close() {
    this.db.close();
  }
}

// Singleton instance
let instance = null;

function getDatabase(dbPath) {
  if (!instance) {
    instance = new Database(dbPath);
  }
  return instance;
}

module.exports = { Database, getDatabase };
