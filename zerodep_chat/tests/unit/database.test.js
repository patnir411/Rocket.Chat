/**
 * Database Tests - Zero Dependencies
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { Database } = require('../../server/db/database');

const TEST_DB_PATH = path.join(__dirname, '../tmp/test.db');

test('Database Module', async (t) => {
  let db;

  t.beforeEach(() => {
    // Clean up test database
    const dir = path.dirname(TEST_DB_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    if (fs.existsSync(TEST_DB_PATH)) {
      fs.unlinkSync(TEST_DB_PATH);
    }
    db = new Database(TEST_DB_PATH);
  });

  t.afterEach(() => {
    try {
      if (db) {
        db.close();
        db = null;
      }
    } catch (err) {
      // Ignore close errors - database may already be closed
    }
  });

  await t.test('Initialization', async (t) => {
    await t.test('should create database file', () => {
      assert.ok(fs.existsSync(TEST_DB_PATH));
    });

    await t.test('should initialize schema', () => {
      const tables = db.all(`
        SELECT name FROM sqlite_master
        WHERE type='table'
        ORDER BY name
      `);

      const tableNames = tables.map(t => t.name);
      assert.ok(tableNames.includes('users'));
      assert.ok(tableNames.includes('rooms'));
      assert.ok(tableNames.includes('messages'));
      assert.ok(tableNames.includes('sessions'));
    });

    await t.test('should enable foreign keys', () => {
      const result = db.get('PRAGMA foreign_keys');
      assert.strictEqual(result.foreign_keys, 1);
    });

    await t.test('should enable WAL mode', () => {
      const result = db.get('PRAGMA journal_mode');
      assert.strictEqual(result.journal_mode, 'wal');
    });
  });

  await t.test('CRUD Operations', async (t) => {
    await t.test('should insert data', () => {
      const result = db.run(
        'INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?)',
        ['test-id', 'testuser', 'hash123']
      );

      assert.ok(result);
    });

    await t.test('should retrieve data', () => {
      db.run(
        'INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?)',
        ['test-id', 'testuser', 'hash123']
      );

      const user = db.get('SELECT * FROM users WHERE id = ?', ['test-id']);
      assert.strictEqual(user.username, 'testuser');
      assert.strictEqual(user.password_hash, 'hash123');
    });

    await t.test('should update data', () => {
      db.run(
        'INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?)',
        ['test-id', 'testuser', 'hash123']
      );

      db.run('UPDATE users SET username = ? WHERE id = ?', ['newname', 'test-id']);

      const user = db.get('SELECT * FROM users WHERE id = ?', ['test-id']);
      assert.strictEqual(user.username, 'newname');
    });

    await t.test('should delete data', () => {
      db.run(
        'INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?)',
        ['test-id', 'testuser', 'hash123']
      );

      db.run('DELETE FROM users WHERE id = ?', ['test-id']);

      const user = db.get('SELECT * FROM users WHERE id = ?', ['test-id']);
      assert.strictEqual(user, undefined);
    });

    await t.test('should query multiple rows', () => {
      db.run('INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?)',
        ['id1', 'user1', 'hash1']);
      db.run('INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?)',
        ['id2', 'user2', 'hash2']);
      db.run('INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?)',
        ['id3', 'user3', 'hash3']);

      const users = db.all('SELECT * FROM users ORDER BY username');
      assert.strictEqual(users.length, 3);
      assert.strictEqual(users[0].username, 'user1');
      assert.strictEqual(users[2].username, 'user3');
    });
  });

  await t.test('Transactions', async (t) => {
    await t.test('should commit successful transaction', () => {
      const result = db.transaction((db) => {
        db.run('INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?)',
          ['id1', 'user1', 'hash1']);
        db.run('INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?)',
          ['id2', 'user2', 'hash2']);
        return 'success';
      });

      assert.strictEqual(result, 'success');

      const users = db.all('SELECT * FROM users');
      assert.strictEqual(users.length, 2);
    });

    await t.test('should rollback failed transaction', () => {
      assert.throws(() => {
        db.transaction((db) => {
          db.run('INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?)',
            ['id1', 'user1', 'hash1']);
          throw new Error('Transaction failed');
        });
      });

      const users = db.all('SELECT * FROM users');
      assert.strictEqual(users.length, 0);
    });
  });

  await t.test('Foreign Keys', async (t) => {
    await t.test('should enforce foreign key constraints', () => {
      // Insert user
      db.run('INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?)',
        ['user1', 'testuser', 'hash']);

      // Insert room
      db.run('INSERT INTO rooms (id, name, type, created_by) VALUES (?, ?, ?, ?)',
        ['room1', 'Test Room', 'channel', 'user1']);

      // Try to insert message with invalid room_id - should fail
      assert.throws(() => {
        db.run('INSERT INTO messages (id, room_id, user_id, content) VALUES (?, ?, ?, ?)',
          ['msg1', 'invalid-room', 'user1', 'test']);
      });
    });

    await t.test('should cascade deletes', () => {
      // Insert user
      db.run('INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?)',
        ['user1', 'testuser', 'hash']);

      // Insert room
      db.run('INSERT INTO rooms (id, name, type, created_by) VALUES (?, ?, ?, ?)',
        ['room1', 'Test Room', 'channel', 'user1']);

      // Insert room member
      db.run('INSERT INTO room_members (room_id, user_id) VALUES (?, ?)',
        ['room1', 'user1']);

      // Delete room
      db.run('DELETE FROM rooms WHERE id = ?', ['room1']);

      // Room member should be deleted (CASCADE)
      const members = db.all('SELECT * FROM room_members WHERE room_id = ?', ['room1']);
      assert.strictEqual(members.length, 0);
    });
  });

  await t.test('Indexes', async (t) => {
    await t.test('should have indexes on users table', () => {
      const indexes = db.all(`
        SELECT name FROM sqlite_master
        WHERE type='index' AND tbl_name='users'
      `);

      const indexNames = indexes.map(i => i.name);
      assert.ok(indexNames.some(n => n.includes('username')));
    });
  });
});
