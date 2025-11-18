/**
 * Message Service - Zero Dependencies
 */

const { getDatabase } = require('../db/database');
const { generateId } = require('../lib/auth');

class MessageService {
  constructor() {
    this.db = getDatabase();
  }

  /**
   * Create message
   */
  createMessage({ roomId, userId, content, type = 'text', replyTo = null, threadId = null }) {
    if (!content || content.trim().length === 0) {
      throw new Error('Message content is required');
    }

    return this.db.transaction((db) => {
      const messageId = generateId();
      const now = new Date().toISOString();

      // Create message
      db.run(
        `INSERT INTO messages (id, room_id, user_id, content, type, reply_to, thread_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [messageId, roomId, userId, content.trim(), type, replyTo, threadId, now]
      );

      // Update room stats
      db.run(
        `UPDATE rooms SET last_message_at = ?, message_count = message_count + 1, updated_at = ?
         WHERE id = ?`,
        [now, now, roomId]
      );

      // Parse and store mentions
      const mentions = this.parseMentions(content);
      if (mentions.length > 0) {
        for (const mention of mentions) {
          if (mention.type === 'user') {
            // Find user by username
            const user = db.get(
              'SELECT id FROM users WHERE username = ? AND deleted_at IS NULL',
              [mention.username]
            );
            if (user) {
              db.run(
                `INSERT INTO mentions (message_id, user_id, type) VALUES (?, ?, 'user')`,
                [messageId, user.id]
              );
            }
          } else {
            // @all or @here
            db.run(
              `INSERT INTO mentions (message_id, type) VALUES (?, ?)`,
              [messageId, mention.type]
            );
          }
        }
      }

      // Increment unread count for all room members except sender
      db.run(
        `UPDATE room_members
         SET unread_count = unread_count + 1
         WHERE room_id = ? AND user_id != ? AND is_muted = 0`,
        [roomId, userId]
      );

      return this.getMessageById(messageId);
    });
  }

  /**
   * Get message by ID
   */
  getMessageById(messageId) {
    const message = this.db.get(
      `SELECT m.*, u.username, u.display_name, u.avatar_url
       FROM messages m
       JOIN users u ON m.user_id = u.id
       WHERE m.id = ? AND m.deleted_at IS NULL`,
      [messageId]
    );

    if (!message) return null;

    // Get reactions
    message.reactions = this.getMessageReactions(messageId);

    // Get mentions
    message.mentions = this.db.all(
      `SELECT m.type, u.username
       FROM mentions m
       LEFT JOIN users u ON m.user_id = u.id
       WHERE m.message_id = ?`,
      [messageId]
    );

    return message;
  }

  /**
   * Get messages for room
   */
  getMessages(roomId, limit = 50, before = null) {
    let sql = `
      SELECT m.*, u.username, u.display_name, u.avatar_url
      FROM messages m
      JOIN users u ON m.user_id = u.id
      WHERE m.room_id = ? AND m.deleted_at IS NULL
    `;

    const params = [roomId];

    if (before) {
      sql += ' AND m.created_at < ?';
      params.push(before);
    }

    sql += ' ORDER BY m.created_at DESC LIMIT ?';
    params.push(limit);

    const messages = this.db.all(sql, params);

    // Get reactions for each message
    for (const message of messages) {
      message.reactions = this.getMessageReactions(message.id);
      message.mentions = this.db.all(
        `SELECT m.type, u.username
         FROM mentions m
         LEFT JOIN users u ON m.user_id = u.id
         WHERE m.message_id = ?`,
        [message.id]
      );
    }

    return messages.reverse(); // Return in chronological order
  }

  /**
   * Update message
   */
  updateMessage(messageId, userId, content) {
    const message = this.db.get(
      'SELECT user_id FROM messages WHERE id = ? AND deleted_at IS NULL',
      [messageId]
    );

    if (!message) {
      throw new Error('Message not found');
    }

    if (message.user_id !== userId) {
      throw new Error('Permission denied');
    }

    this.db.run(
      `UPDATE messages SET content = ?, updated_at = datetime('now') WHERE id = ?`,
      [content.trim(), messageId]
    );

    return this.getMessageById(messageId);
  }

  /**
   * Delete message
   */
  deleteMessage(messageId, userId) {
    const message = this.db.get(
      'SELECT user_id FROM messages WHERE id = ? AND deleted_at IS NULL',
      [messageId]
    );

    if (!message) {
      throw new Error('Message not found');
    }

    if (message.user_id !== userId) {
      throw new Error('Permission denied');
    }

    this.db.run(
      `UPDATE messages SET deleted_at = datetime('now') WHERE id = ?`,
      [messageId]
    );

    return { success: true };
  }

  /**
   * Add reaction to message
   */
  addReaction(messageId, userId, emoji) {
    try {
      this.db.run(
        `INSERT INTO reactions (message_id, user_id, emoji)
         VALUES (?, ?, ?)`,
        [messageId, userId, emoji]
      );
    } catch (err) {
      // Ignore if already exists (UNIQUE constraint)
      if (!err.message.includes('UNIQUE')) {
        throw err;
      }
    }

    return this.getMessageReactions(messageId);
  }

  /**
   * Remove reaction from message
   */
  removeReaction(messageId, userId, emoji) {
    this.db.run(
      'DELETE FROM reactions WHERE message_id = ? AND user_id = ? AND emoji = ?',
      [messageId, userId, emoji]
    );

    return this.getMessageReactions(messageId);
  }

  /**
   * Get reactions for message
   */
  getMessageReactions(messageId) {
    const reactions = this.db.all(
      `SELECT emoji, COUNT(*) as count,
              GROUP_CONCAT(u.username) as usernames
       FROM reactions r
       JOIN users u ON r.user_id = u.id
       WHERE r.message_id = ?
       GROUP BY emoji`,
      [messageId]
    );

    return reactions.map(r => ({
      emoji: r.emoji,
      count: r.count,
      users: r.usernames ? r.usernames.split(',') : [],
    }));
  }

  /**
   * Search messages
   */
  searchMessages(roomId, query, limit = 50) {
    const pattern = `%${query}%`;
    const messages = this.db.all(
      `SELECT m.*, u.username, u.display_name, u.avatar_url
       FROM messages m
       JOIN users u ON m.user_id = u.id
       WHERE m.room_id = ? AND m.content LIKE ? AND m.deleted_at IS NULL
       ORDER BY m.created_at DESC
       LIMIT ?`,
      [roomId, pattern, limit]
    );

    for (const message of messages) {
      message.reactions = this.getMessageReactions(message.id);
    }

    return messages;
  }

  /**
   * Get thread messages
   */
  getThreadMessages(threadId, limit = 50) {
    const messages = this.db.all(
      `SELECT m.*, u.username, u.display_name, u.avatar_url
       FROM messages m
       JOIN users u ON m.user_id = u.id
       WHERE m.thread_id = ? AND m.deleted_at IS NULL
       ORDER BY m.created_at ASC
       LIMIT ?`,
      [threadId, limit]
    );

    for (const message of messages) {
      message.reactions = this.getMessageReactions(message.id);
    }

    return messages;
  }

  /**
   * Parse mentions from message content
   */
  parseMentions(content) {
    const mentions = [];
    const mentionRegex = /@(all|here|[\w-]+)/g;

    let match;
    while ((match = mentionRegex.exec(content)) !== null) {
      const mention = match[1];
      if (mention === 'all' || mention === 'here') {
        mentions.push({ type: mention });
      } else {
        mentions.push({ type: 'user', username: mention });
      }
    }

    return mentions;
  }
}

module.exports = new MessageService();
