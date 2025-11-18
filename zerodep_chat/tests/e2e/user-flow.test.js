/**
 * End-to-End User Flow Tests - Zero Dependencies
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { Database } = require('../../server/db/database');

const TEST_DB_PATH = path.join(__dirname, '../tmp/e2e-test.db');

function cleanDatabase() {
  const dir = path.dirname(TEST_DB_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  [TEST_DB_PATH, TEST_DB_PATH + '-shm', TEST_DB_PATH + '-wal'].forEach(file => {
    if (fs.existsSync(file)) fs.unlinkSync(file);
  });
}

test('E2E: Complete User Flow', async (t) => {
  let db, userService, roomService, messageService;

  t.beforeEach(() => {
    cleanDatabase();
    db = new Database(TEST_DB_PATH);

    // Mock getDatabase
    const mockGetDatabase = () => db;
    require.cache[require.resolve('../../server/db/database')] = {
      exports: { Database, getDatabase: mockGetDatabase }
    };

    // Clear and reload services
    ['users', 'rooms', 'messages'].forEach(service => {
      delete require.cache[require.resolve(`../../server/services/${service}`)];
    });

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

  await t.test('Complete chat workflow', () => {
    // 1. Register two users
    const alice = userService.register({
      username: 'alice',
      email: 'alice@example.com',
      password: 'password123',
      displayName: 'Alice',
    });

    const bob = userService.register({
      username: 'bob',
      email: 'bob@example.com',
      password: 'password123',
      displayName: 'Bob',
    });

    assert.ok(alice.id);
    assert.ok(bob.id);

    // 2. Alice logs in
    const aliceLogin = userService.login({
      username: 'alice',
      password: 'password123',
    });

    assert.ok(aliceLogin.token);
    assert.ok(aliceLogin.sessionId);

    // 3. Alice creates a channel
    const channel = roomService.createRoom({
      name: 'general',
      type: 'channel',
      description: 'General discussion',
      createdBy: alice.id,
    });

    assert.strictEqual(channel.name, 'general');
    assert.strictEqual(channel.type, 'channel');

    // 4. Bob joins the channel
    roomService.joinRoom(channel.id, bob.id);

    const members = roomService.getRoomMembers(channel.id);
    assert.strictEqual(members.length, 2);

    // 5. Alice sends a message
    const msg1 = messageService.createMessage({
      roomId: channel.id,
      userId: alice.id,
      content: 'Hello everyone!',
    });

    assert.strictEqual(msg1.content, 'Hello everyone!');

    // 6. Bob should have unread count = 1
    let bobMembership = db.get(
      'SELECT unread_count FROM room_members WHERE room_id = ? AND user_id = ?',
      [channel.id, bob.id]
    );
    assert.strictEqual(bobMembership.unread_count, 1);

    // 7. Bob sends a reply with mention
    const msg2 = messageService.createMessage({
      roomId: channel.id,
      userId: bob.id,
      content: 'Hi @alice! How are you?',
      replyTo: msg1.id,
    });

    assert.strictEqual(msg2.content, 'Hi @alice! How are you?');
    assert.strictEqual(msg2.reply_to, msg1.id);

    // 8. Verify mention was parsed
    assert.ok(msg2.mentions.length > 0);

    // 9. Bob marks channel as read
    roomService.markAsRead(channel.id, bob.id);

    bobMembership = db.get(
      'SELECT unread_count FROM room_members WHERE room_id = ? AND user_id = ?',
      [channel.id, bob.id]
    );
    assert.strictEqual(bobMembership.unread_count, 0);

    // 10. Alice reacts to Bob's message
    const reactions = messageService.addReaction(msg2.id, alice.id, '👍');
    assert.strictEqual(reactions.length, 1);
    assert.strictEqual(reactions[0].emoji, '👍');

    // 11. Get all messages
    const messages = messageService.getMessages(channel.id);
    assert.strictEqual(messages.length, 2);

    // 12. Search for messages
    const searchResults = messageService.searchMessages(channel.id, 'hello');
    assert.strictEqual(searchResults.length, 1);
    assert.strictEqual(searchResults[0].content, 'Hello everyone!');

    // 13. Alice creates a DM with Bob
    const dm = roomService.getOrCreateDM(alice.id, bob.id);
    assert.strictEqual(dm.type, 'dm');

    // 14. Alice sends DM
    const dmMessage = messageService.createMessage({
      roomId: dm.id,
      userId: alice.id,
      content: 'Private message for Bob',
    });

    assert.strictEqual(dmMessage.content, 'Private message for Bob');

    // 15. Get Alice's rooms (should have 2: channel + DM)
    const aliceRooms = roomService.getRoomsForUser(alice.id);
    assert.strictEqual(aliceRooms.length, 2);

    // 16. Update Alice's status
    const updatedAlice = userService.updateStatus(alice.id, 'away', 'In a meeting');
    assert.strictEqual(updatedAlice.status, 'away');

    // 17. Alice logs out
    const logoutResult = userService.logout(aliceLogin.sessionId);
    assert.ok(logoutResult.success);

    // 18. Verify session is deleted
    const session = db.get('SELECT * FROM sessions WHERE id = ?', [aliceLogin.sessionId]);
    assert.strictEqual(session, undefined);

    console.log('✅ Complete user flow test passed!');
  });

  await t.test('Multi-user conversation flow', () => {
    // Create 3 users
    const users = ['alice', 'bob', 'charlie'].map(name =>
      userService.register({
        username: name,
        password: 'password123',
        displayName: name.charAt(0).toUpperCase() + name.slice(1),
      })
    );

    // Alice creates a channel
    const channel = roomService.createRoom({
      name: 'team',
      type: 'channel',
      description: 'Team chat',
      createdBy: users[0].id,
    });

    // Bob and Charlie join
    roomService.joinRoom(channel.id, users[1].id);
    roomService.joinRoom(channel.id, users[2].id);

    // Everyone sends a message
    users.forEach((user, i) => {
      messageService.createMessage({
        roomId: channel.id,
        userId: user.id,
        content: `Message from ${user.username}`,
      });
    });

    // Verify all messages
    const messages = messageService.getMessages(channel.id);
    assert.strictEqual(messages.length, 3);

    // Verify everyone (except sender) has unread count
    users.forEach((user, i) => {
      const member = db.get(
        'SELECT unread_count FROM room_members WHERE room_id = ? AND user_id = ?',
        [channel.id, user.id]
      );
      // Each user sent 1 message, so they should have 2 unread (from the other 2 users)
      assert.strictEqual(member.unread_count, 2);
    });

    console.log('✅ Multi-user conversation flow test passed!');
  });
});
