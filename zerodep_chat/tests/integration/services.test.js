/**
 * Services Integration Tests - Zero Dependencies
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { Database } = require('../../server/db/database');

const TEST_DB_PATH = path.join(__dirname, '../tmp/services-test.db');

// Clean database before tests
function cleanDatabase() {
  const dir = path.dirname(TEST_DB_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  if (fs.existsSync(TEST_DB_PATH)) {
    fs.unlinkSync(TEST_DB_PATH);
  }
  ['-shm', '-wal'].forEach(ext => {
    if (fs.existsSync(TEST_DB_PATH + ext)) {
      fs.unlinkSync(TEST_DB_PATH + ext);
    }
  });
}

test('Services Integration', async (t) => {
  let db;
  let userService;
  let roomService;
  let messageService;

  t.beforeEach(() => {
    cleanDatabase();
    db = new Database(TEST_DB_PATH);

    // Mock getDatabase for services
    const mockGetDatabase = () => db;

    // Clear require cache
    delete require.cache[require.resolve('../../server/services/users')];
    delete require.cache[require.resolve('../../server/services/rooms')];
    delete require.cache[require.resolve('../../server/services/messages')];

    // Mock the database module
    require.cache[require.resolve('../../server/db/database')] = {
      exports: { Database, getDatabase: mockGetDatabase }
    };

    userService = require('../../server/services/users');
    roomService = require('../../server/services/rooms');
    messageService = require('../../server/services/messages');
  });

  t.afterEach(() => {
    try {
      if (db) {
        db.close();
        db = null;
      }
    } catch (err) {
      // Ignore close errors
    }
  });

  await t.test('User Service', async (t) => {
    await t.test('should register new user', () => {
      const user = userService.register({
        username: 'testuser',
        email: 'test@example.com',
        password: 'password123',
        displayName: 'Test User',
      });

      assert.ok(user.id);
      assert.strictEqual(user.username, 'testuser');
      assert.strictEqual(user.email, 'test@example.com');
      assert.strictEqual(user.display_name, 'Test User');
      assert.strictEqual(user.password_hash, undefined, 'Password hash should not be returned');
    });

    await t.test('should reject duplicate username', () => {
      userService.register({
        username: 'testuser',
        password: 'password123',
      });

      assert.throws(() => {
        userService.register({
          username: 'testuser',
          password: 'password456',
        });
      }, /Username already exists/);
    });

    await t.test('should validate username length', () => {
      assert.throws(() => {
        userService.register({
          username: 'ab',
          password: 'password123',
        });
      }, /at least 3 characters/);
    });

    await t.test('should validate password length', () => {
      assert.throws(() => {
        userService.register({
          username: 'testuser',
          password: '12345',
        });
      }, /at least 6 characters/);
    });

    await t.test('should login with correct credentials', () => {
      userService.register({
        username: 'testuser',
        password: 'password123',
      });

      const result = userService.login({
        username: 'testuser',
        password: 'password123',
      });

      assert.ok(result.user);
      assert.ok(result.token);
      assert.ok(result.sessionId);
      assert.strictEqual(result.user.username, 'testuser');
    });

    await t.test('should reject invalid credentials', () => {
      userService.register({
        username: 'testuser',
        password: 'password123',
      });

      assert.throws(() => {
        userService.login({
          username: 'testuser',
          password: 'wrongpassword',
        });
      }, /Invalid username or password/);
    });

    await t.test('should logout user', () => {
      userService.register({
        username: 'testuser',
        password: 'password123',
      });

      const { sessionId } = userService.login({
        username: 'testuser',
        password: 'password123',
      });

      const result = userService.logout(sessionId);
      assert.ok(result.success);

      // Verify session is deleted
      const session = db.get('SELECT * FROM sessions WHERE id = ?', [sessionId]);
      assert.strictEqual(session, undefined);
    });

    await t.test('should update user status', () => {
      const user = userService.register({
        username: 'testuser',
        password: 'password123',
      });

      const updated = userService.updateStatus(user.id, 'away', 'In a meeting');

      assert.strictEqual(updated.status, 'away');
      assert.strictEqual(updated.status_text, 'In a meeting');
    });

    await t.test('should search users', () => {
      userService.register({ username: 'alice', password: 'pass123', displayName: 'Alice Smith' });
      userService.register({ username: 'bob', password: 'pass123', displayName: 'Bob Jones' });
      userService.register({ username: 'charlie', password: 'pass123', displayName: 'Charlie Brown' });

      const results = userService.searchUsers('bob');
      assert.strictEqual(results.length, 1);
      assert.strictEqual(results[0].username, 'bob');
    });

    await t.test('should get user by ID', () => {
      const user = userService.register({
        username: 'testuser',
        password: 'password123',
      });

      const found = userService.getUserById(user.id);
      assert.strictEqual(found.username, 'testuser');
    });
  });

  await t.test('Room Service', async (t) => {
    let userId;

    t.beforeEach(() => {
      const user = userService.register({
        username: 'testuser',
        password: 'password123',
      });
      userId = user.id;
    });

    await t.test('should create channel', () => {
      const room = roomService.createRoom({
        name: 'general',
        type: 'channel',
        description: 'General discussion',
        createdBy: userId,
      });

      assert.ok(room.id);
      assert.strictEqual(room.name, 'general');
      assert.strictEqual(room.type, 'channel');
      assert.strictEqual(room.description, 'General discussion');
    });

    await t.test('should create private room', () => {
      const room = roomService.createRoom({
        name: 'private-room',
        type: 'private',
        createdBy: userId,
      });

      assert.strictEqual(room.type, 'private');
    });

    await t.test('should create DM room', () => {
      const user2 = userService.register({
        username: 'user2',
        password: 'password123',
      });

      const room = roomService.createRoom({
        name: '',
        type: 'dm',
        createdBy: userId,
        members: [user2.id],
      });

      assert.strictEqual(room.type, 'dm');

      // Verify DM participants
      const participants = db.all(
        'SELECT * FROM dm_participants WHERE room_id = ?',
        [room.id]
      );
      assert.strictEqual(participants.length, 2);
    });

    await t.test('should get or create DM', () => {
      const user2 = userService.register({
        username: 'user2',
        password: 'password123',
      });

      const room1 = roomService.getOrCreateDM(userId, user2.id);
      const room2 = roomService.getOrCreateDM(userId, user2.id);

      // Should return same room
      assert.strictEqual(room1.id, room2.id);
    });

    await t.test('should join room', () => {
      const room = roomService.createRoom({
        name: 'general',
        type: 'channel',
        createdBy: userId,
      });

      const user2 = userService.register({
        username: 'user2',
        password: 'password123',
      });

      roomService.joinRoom(room.id, user2.id);

      const members = roomService.getRoomMembers(room.id);
      assert.strictEqual(members.length, 2);
    });

    await t.test('should not allow joining private room', () => {
      const room = roomService.createRoom({
        name: 'private',
        type: 'private',
        createdBy: userId,
      });

      const user2 = userService.register({
        username: 'user2',
        password: 'password123',
      });

      assert.throws(() => {
        roomService.joinRoom(room.id, user2.id);
      }, /Cannot join private room/);
    });

    await t.test('should leave room', () => {
      const room = roomService.createRoom({
        name: 'general',
        type: 'channel',
        createdBy: userId,
      });

      const user2 = userService.register({
        username: 'user2',
        password: 'password123',
      });

      roomService.joinRoom(room.id, user2.id);
      roomService.leaveRoom(room.id, user2.id);

      const members = roomService.getRoomMembers(room.id);
      assert.strictEqual(members.length, 1);
    });

    await t.test('should get rooms for user', () => {
      roomService.createRoom({
        name: 'room1',
        type: 'channel',
        createdBy: userId,
      });

      roomService.createRoom({
        name: 'room2',
        type: 'channel',
        createdBy: userId,
      });

      const rooms = roomService.getRoomsForUser(userId);
      assert.strictEqual(rooms.length, 2);
    });

    await t.test('should mark room as read', () => {
      const room = roomService.createRoom({
        name: 'general',
        type: 'channel',
        createdBy: userId,
      });

      // Set unread count
      db.run(
        'UPDATE room_members SET unread_count = 5 WHERE room_id = ? AND user_id = ?',
        [room.id, userId]
      );

      roomService.markAsRead(room.id, userId);

      const member = db.get(
        'SELECT unread_count FROM room_members WHERE room_id = ? AND user_id = ?',
        [room.id, userId]
      );
      assert.strictEqual(member.unread_count, 0);
    });
  });

  await t.test('Message Service', async (t) => {
    let userId;
    let roomId;

    t.beforeEach(() => {
      const user = userService.register({
        username: 'testuser',
        password: 'password123',
      });
      userId = user.id;

      const room = roomService.createRoom({
        name: 'general',
        type: 'channel',
        createdBy: userId,
      });
      roomId = room.id;
    });

    await t.test('should create message', () => {
      const message = messageService.createMessage({
        roomId,
        userId,
        content: 'Hello world!',
      });

      assert.ok(message.id);
      assert.strictEqual(message.content, 'Hello world!');
      assert.strictEqual(message.user_id, userId);
      assert.strictEqual(message.room_id, roomId);
    });

    await t.test('should reject empty message', () => {
      assert.throws(() => {
        messageService.createMessage({
          roomId,
          userId,
          content: '   ',
        });
      }, /Message content is required/);
    });

    await t.test('should parse mentions', () => {
      const message = messageService.createMessage({
        roomId,
        userId,
        content: 'Hey @testuser, check this out! @all',
      });

      assert.ok(message.mentions);
      assert.ok(message.mentions.length > 0);
    });

    await t.test('should increment unread count', () => {
      const user2 = userService.register({
        username: 'user2',
        password: 'password123',
      });

      roomService.joinRoom(roomId, user2.id);

      messageService.createMessage({
        roomId,
        userId,
        content: 'Hello!',
      });

      const member = db.get(
        'SELECT unread_count FROM room_members WHERE room_id = ? AND user_id = ?',
        [roomId, user2.id]
      );
      assert.strictEqual(member.unread_count, 1);
    });

    await t.test('should get messages', () => {
      messageService.createMessage({ roomId, userId, content: 'Message 1' });
      messageService.createMessage({ roomId, userId, content: 'Message 2' });
      messageService.createMessage({ roomId, userId, content: 'Message 3' });

      const messages = messageService.getMessages(roomId, 50);
      assert.strictEqual(messages.length, 3);
      assert.strictEqual(messages[0].content, 'Message 1');
    });

    await t.test('should update message', () => {
      const message = messageService.createMessage({
        roomId,
        userId,
        content: 'Original message',
      });

      const updated = messageService.updateMessage(message.id, userId, 'Updated message');
      assert.strictEqual(updated.content, 'Updated message');
    });

    await t.test('should not allow updating other user message', () => {
      const user2 = userService.register({
        username: 'user2',
        password: 'password123',
      });

      const message = messageService.createMessage({
        roomId,
        userId,
        content: 'Original message',
      });

      assert.throws(() => {
        messageService.updateMessage(message.id, user2.id, 'Hacked message');
      }, /Permission denied/);
    });

    await t.test('should delete message', () => {
      const message = messageService.createMessage({
        roomId,
        userId,
        content: 'Delete me',
      });

      messageService.deleteMessage(message.id, userId);

      const found = messageService.getMessageById(message.id);
      assert.strictEqual(found, null);
    });

    await t.test('should add reaction', () => {
      const message = messageService.createMessage({
        roomId,
        userId,
        content: 'React to this',
      });

      const reactions = messageService.addReaction(message.id, userId, '👍');
      assert.strictEqual(reactions.length, 1);
      assert.strictEqual(reactions[0].emoji, '👍');
      assert.strictEqual(reactions[0].count, 1);
    });

    await t.test('should remove reaction', () => {
      const message = messageService.createMessage({
        roomId,
        userId,
        content: 'React to this',
      });

      messageService.addReaction(message.id, userId, '👍');
      const reactions = messageService.removeReaction(message.id, userId, '👍');

      assert.strictEqual(reactions.length, 0);
    });

    await t.test('should search messages', () => {
      messageService.createMessage({ roomId, userId, content: 'Hello world' });
      messageService.createMessage({ roomId, userId, content: 'Goodbye world' });
      messageService.createMessage({ roomId, userId, content: 'Random message' });

      const results = messageService.searchMessages(roomId, 'world');
      assert.strictEqual(results.length, 2);
    });
  });
});
