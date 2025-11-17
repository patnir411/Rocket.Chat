-- Initial database schema for SimplChat
-- Based on Rocket.Chat patterns, simplified for minimal dependencies

-- Users table
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  email TEXT UNIQUE,
  password_hash TEXT NOT NULL,
  display_name TEXT,
  avatar_url TEXT,
  status TEXT DEFAULT 'offline' CHECK(status IN ('online', 'away', 'busy', 'offline')),
  status_text TEXT,
  role TEXT DEFAULT 'user' CHECK(role IN ('admin', 'moderator', 'user', 'guest')),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_seen_at DATETIME,
  deleted_at DATETIME
);

CREATE INDEX idx_users_username ON users(username);
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_status ON users(status);
CREATE INDEX idx_users_deleted ON users(deleted_at);

-- Rooms table (channels, private groups, and DMs)
CREATE TABLE rooms (
  id TEXT PRIMARY KEY,
  name TEXT,
  slug TEXT UNIQUE,
  type TEXT NOT NULL CHECK(type IN ('channel', 'private', 'dm')),
  topic TEXT,
  description TEXT,
  avatar_url TEXT,
  created_by TEXT REFERENCES users(id),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_message_at DATETIME,
  message_count INTEGER DEFAULT 0,
  member_count INTEGER DEFAULT 0,
  is_archived BOOLEAN DEFAULT 0,
  is_read_only BOOLEAN DEFAULT 0,
  deleted_at DATETIME
);

CREATE INDEX idx_rooms_type ON rooms(type);
CREATE INDEX idx_rooms_slug ON rooms(slug);
CREATE INDEX idx_rooms_created_by ON rooms(created_by);
CREATE INDEX idx_rooms_last_message_at ON rooms(last_message_at);
CREATE INDEX idx_rooms_deleted ON rooms(deleted_at);

-- Room members table (subscriptions in Rocket.Chat)
CREATE TABLE room_members (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT DEFAULT 'member' CHECK(role IN ('owner', 'moderator', 'member')),
  joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_read_at DATETIME,
  unread_count INTEGER DEFAULT 0,
  mentions_count INTEGER DEFAULT 0,
  is_muted BOOLEAN DEFAULT 0,
  is_favorite BOOLEAN DEFAULT 0,
  notification_preference TEXT DEFAULT 'all' CHECK(notification_preference IN ('all', 'mentions', 'nothing')),
  UNIQUE(room_id, user_id)
);

CREATE INDEX idx_room_members_room_id ON room_members(room_id);
CREATE INDEX idx_room_members_user_id ON room_members(user_id);
CREATE INDEX idx_room_members_unread ON room_members(user_id, unread_count);

-- Messages table
CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  content TEXT NOT NULL,
  type TEXT DEFAULT 'text' CHECK(type IN ('text', 'file', 'system', 'thread_reply')),
  file_url TEXT,
  file_name TEXT,
  file_type TEXT,
  file_size INTEGER,
  reply_to TEXT REFERENCES messages(id) ON DELETE SET NULL,
  thread_id TEXT REFERENCES messages(id) ON DELETE SET NULL,
  thread_count INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME,
  edited_at DATETIME,
  deleted_at DATETIME
);

CREATE INDEX idx_messages_room_id ON messages(room_id, created_at DESC);
CREATE INDEX idx_messages_user_id ON messages(user_id);
CREATE INDEX idx_messages_thread_id ON messages(thread_id);
CREATE INDEX idx_messages_reply_to ON messages(reply_to);
CREATE INDEX idx_messages_deleted ON messages(deleted_at);

-- Full-text search index for messages
CREATE VIRTUAL TABLE messages_fts USING fts5(
  content,
  content=messages,
  content_rowid=rowid
);

-- Triggers to keep FTS index in sync
CREATE TRIGGER messages_fts_insert AFTER INSERT ON messages BEGIN
  INSERT INTO messages_fts(rowid, content) VALUES (new.rowid, new.content);
END;

CREATE TRIGGER messages_fts_delete AFTER DELETE ON messages BEGIN
  DELETE FROM messages_fts WHERE rowid = old.rowid;
END;

CREATE TRIGGER messages_fts_update AFTER UPDATE ON messages BEGIN
  DELETE FROM messages_fts WHERE rowid = old.rowid;
  INSERT INTO messages_fts(rowid, content) VALUES (new.rowid, new.content);
END;

-- Message reactions
CREATE TABLE reactions (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  emoji TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(message_id, user_id, emoji)
);

CREATE INDEX idx_reactions_message_id ON reactions(message_id);
CREATE INDEX idx_reactions_user_id ON reactions(user_id);

-- Message mentions
CREATE TABLE mentions (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT DEFAULT 'user' CHECK(type IN ('user', 'all', 'here')),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(message_id, user_id)
);

CREATE INDEX idx_mentions_message_id ON mentions(message_id);
CREATE INDEX idx_mentions_user_id ON mentions(user_id);

-- Sessions table (for JWT token tracking and logout)
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT UNIQUE NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  expires_at DATETIME NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_sessions_user_id ON sessions(user_id);
CREATE INDEX idx_sessions_token_hash ON sessions(token_hash);
CREATE INDEX idx_sessions_expires_at ON sessions(expires_at);

-- DM room participants (for efficient DM lookup)
CREATE TABLE dm_participants (
  room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (room_id, user_id)
);

CREATE INDEX idx_dm_participants_user_id ON dm_participants(user_id);

-- Typing indicators (ephemeral, cleared periodically)
CREATE TABLE typing_indicators (
  room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME NOT NULL,
  PRIMARY KEY (room_id, user_id)
);

CREATE INDEX idx_typing_indicators_expires_at ON typing_indicators(expires_at);

-- Uploads table (file tracking)
CREATE TABLE uploads (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  room_id TEXT REFERENCES rooms(id) ON DELETE SET NULL,
  original_name TEXT NOT NULL,
  stored_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size INTEGER NOT NULL,
  url TEXT NOT NULL,
  thumbnail_url TEXT,
  width INTEGER,
  height INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_uploads_user_id ON uploads(user_id);
CREATE INDEX idx_uploads_room_id ON uploads(room_id);

-- Settings table (system configuration)
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT,
  type TEXT CHECK(type IN ('string', 'number', 'boolean', 'json')),
  description TEXT,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Insert default settings
INSERT INTO settings (key, value, type, description) VALUES
  ('site_name', 'SimplChat', 'string', 'Name of the chat application'),
  ('allow_registration', 'true', 'boolean', 'Allow new user registration'),
  ('require_email', 'false', 'boolean', 'Require email for registration'),
  ('max_file_size', '10485760', 'number', 'Maximum file upload size in bytes'),
  ('message_retention_days', '0', 'number', 'Days to keep messages (0 = forever)');
