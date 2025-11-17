const { query, queryOne, execute, transaction } = require('../db');
const { generateId } = require('../utils/crypto');
const { parseMentions } = require('../utils/validation');
const { AppError } = require('../middleware/errorHandler');

/**
 * Create a new message
 */
function createMessage({ roomId, userId, content, type = 'text', fileUrl, fileName, fileType, fileSize, replyTo, threadId }) {
  return transaction(() => {
    const messageId = generateId();
    const now = new Date().toISOString();

    // Insert message
    execute(
      `INSERT INTO messages (id, room_id, user_id, content, type, file_url, file_name, file_type, file_size, reply_to, thread_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [messageId, roomId, userId, content, type, fileUrl || null, fileName || null, fileType || null, fileSize || null, replyTo || null, threadId || null, now]
    );

    // Update room stats
    execute('UPDATE rooms SET last_message_at = ?, message_count = message_count + 1, updated_at = ? WHERE id = ?', [
      now,
      now,
      roomId,
    ]);

    // Update thread count if this is a reply
    if (threadId) {
      execute('UPDATE messages SET thread_count = thread_count + 1 WHERE id = ?', [threadId]);
    }

    // Parse and store mentions
    const mentions = parseMentions(content);
    if (mentions.length > 0) {
      storeMentions(messageId, roomId, mentions);
    }

    // Increment unread count for all room members except sender
    execute(
      `UPDATE room_members
       SET unread_count = unread_count + 1
       WHERE room_id = ? AND user_id != ? AND is_muted = 0`,
      [roomId, userId]
    );

    // Increment mentions count for mentioned users
    if (mentions.some((m) => m !== 'all' && m !== 'here')) {
      incrementMentionCounts(roomId, mentions);
    }

    return getMessageById(messageId);
  });
}

/**
 * Store mentions in database
 */
function storeMentions(messageId, roomId, mentions) {
  for (const mention of mentions) {
    if (mention === 'all' || mention === 'here') {
      // Get all room members
      const members = query('SELECT user_id FROM room_members WHERE room_id = ?', [roomId]);
      for (const member of members) {
        const mentionId = generateId();
        execute(`INSERT OR IGNORE INTO mentions (id, message_id, user_id, type) VALUES (?, ?, ?, ?)`, [
          mentionId,
          messageId,
          member.user_id,
          mention,
        ]);
      }
    } else {
      // Find user by username
      const user = queryOne('SELECT id FROM users WHERE username = ?', [mention]);
      if (user) {
        const mentionId = generateId();
        execute(`INSERT OR IGNORE INTO mentions (id, message_id, user_id, type) VALUES (?, ?, ?, 'user')`, [
          mentionId,
          messageId,
          user.id,
        ]);
      }
    }
  }
}

/**
 * Increment mention counts for mentioned users
 */
function incrementMentionCounts(roomId, mentions) {
  const usernames = mentions.filter((m) => m !== 'all' && m !== 'here');
  if (usernames.length === 0) return;

  const placeholders = usernames.map(() => '?').join(',');
  execute(
    `UPDATE room_members
     SET mentions_count = mentions_count + 1
     WHERE room_id = ? AND user_id IN (
       SELECT id FROM users WHERE username IN (${placeholders})
     )`,
    [roomId, ...usernames]
  );
}

/**
 * Get message by ID
 */
function getMessageById(messageId) {
  return queryOne(
    `SELECT m.*, u.username, u.display_name, u.avatar_url
     FROM messages m
     LEFT JOIN users u ON m.user_id = u.id
     WHERE m.id = ? AND m.deleted_at IS NULL`,
    [messageId]
  );
}

/**
 * Get room messages with pagination
 */
function getRoomMessages(roomId, { limit = 50, before = null, after = null }) {
  let sql = `
    SELECT m.*, u.username, u.display_name, u.avatar_url
    FROM messages m
    LEFT JOIN users u ON m.user_id = u.id
    WHERE m.room_id = ? AND m.deleted_at IS NULL
  `;

  const params = [roomId];

  if (before) {
    sql += ' AND m.created_at < ?';
    params.push(before);
  } else if (after) {
    sql += ' AND m.created_at > ?';
    params.push(after);
  }

  sql += ' ORDER BY m.created_at DESC LIMIT ?';
  params.push(limit);

  const messages = query(sql, params);

  // Reverse if querying after a timestamp
  if (after) {
    messages.reverse();
  }

  // Get reactions and mentions for each message
  return messages.map((msg) => enrichMessage(msg));
}

/**
 * Enrich message with reactions and thread info
 */
function enrichMessage(message) {
  // Get reactions
  const reactions = query(
    `SELECT r.emoji, u.username
     FROM reactions r
     JOIN users u ON r.user_id = u.id
     WHERE r.message_id = ?
     ORDER BY r.created_at`,
    [message.id]
  );

  // Group by emoji
  const reactionsByEmoji = {};
  for (const reaction of reactions) {
    if (!reactionsByEmoji[reaction.emoji]) {
      reactionsByEmoji[reaction.emoji] = [];
    }
    reactionsByEmoji[reaction.emoji].push(reaction.username);
  }

  message.reactions = reactionsByEmoji;

  // Get mentions
  const mentions = query('SELECT u.username FROM mentions m JOIN users u ON m.user_id = u.id WHERE m.message_id = ?', [
    message.id,
  ]);

  message.mentions = mentions.map((m) => m.username);

  return message;
}

/**
 * Update message
 */
function updateMessage(messageId, userId, content) {
  const message = getMessageById(messageId);

  if (!message) {
    throw new AppError('Message not found', 404);
  }

  if (message.user_id !== userId) {
    throw new AppError('Unauthorized - can only edit own messages', 403);
  }

  const now = new Date().toISOString();
  execute('UPDATE messages SET content = ?, edited_at = ?, updated_at = ? WHERE id = ?', [content, now, now, messageId]);

  // Update mentions
  execute('DELETE FROM mentions WHERE message_id = ?', [messageId]);
  const mentions = parseMentions(content);
  if (mentions.length > 0) {
    storeMentions(messageId, message.room_id, mentions);
  }

  return getMessageById(messageId);
}

/**
 * Delete message (soft delete)
 */
function deleteMessage(messageId, userId, isAdmin = false) {
  const message = getMessageById(messageId);

  if (!message) {
    throw new AppError('Message not found', 404);
  }

  if (message.user_id !== userId && !isAdmin) {
    throw new AppError('Unauthorized - can only delete own messages', 403);
  }

  const now = new Date().toISOString();
  execute('UPDATE messages SET deleted_at = ?, updated_at = ? WHERE id = ?', [now, now, messageId]);

  // Decrement room message count
  execute('UPDATE rooms SET message_count = message_count - 1 WHERE id = ?', [message.room_id]);
}

/**
 * Add reaction to message
 */
function addReaction(messageId, userId, emoji) {
  const message = getMessageById(messageId);

  if (!message) {
    throw new AppError('Message not found', 404);
  }

  const reactionId = generateId();

  try {
    execute(`INSERT INTO reactions (id, message_id, user_id, emoji) VALUES (?, ?, ?, ?)`, [
      reactionId,
      messageId,
      userId,
      emoji,
    ]);
  } catch (error) {
    // Ignore duplicate reactions
    if (error.code !== 'SQLITE_CONSTRAINT') {
      throw error;
    }
  }

  return getMessageById(messageId);
}

/**
 * Remove reaction from message
 */
function removeReaction(messageId, userId, emoji) {
  execute('DELETE FROM reactions WHERE message_id = ? AND user_id = ? AND emoji = ?', [messageId, userId, emoji]);

  return getMessageById(messageId);
}

/**
 * Search messages
 */
function searchMessages(userId, searchQuery, { roomId = null, limit = 50 }) {
  let sql = `
    SELECT m.*, u.username, u.display_name, u.avatar_url, r.name as room_name
    FROM messages_fts mf
    JOIN messages m ON m.rowid = mf.rowid
    LEFT JOIN users u ON m.user_id = u.id
    LEFT JOIN rooms r ON m.room_id = r.id
    WHERE mf.content MATCH ?
      AND m.deleted_at IS NULL
  `;

  const params = [searchQuery];

  // Filter by room if specified
  if (roomId) {
    sql += ' AND m.room_id = ?';
    params.push(roomId);
  } else {
    // Only search in rooms user is a member of
    sql += `
      AND m.room_id IN (
        SELECT room_id FROM room_members WHERE user_id = ?
      )
    `;
    params.push(userId);
  }

  sql += ' ORDER BY m.created_at DESC LIMIT ?';
  params.push(limit);

  return query(sql, params);
}

/**
 * Get thread messages
 */
function getThreadMessages(threadId, limit = 50) {
  return query(
    `SELECT m.*, u.username, u.display_name, u.avatar_url
     FROM messages m
     LEFT JOIN users u ON m.user_id = u.id
     WHERE m.thread_id = ? AND m.deleted_at IS NULL
     ORDER BY m.created_at ASC
     LIMIT ?`,
    [threadId, limit]
  );
}

/**
 * Get user's mentioned messages
 */
function getUserMentions(userId, { limit = 50, unreadOnly = false }) {
  let sql = `
    SELECT DISTINCT m.*, u.username, u.display_name, u.avatar_url, r.name as room_name
    FROM mentions mn
    JOIN messages m ON mn.message_id = m.id
    LEFT JOIN users u ON m.user_id = u.id
    LEFT JOIN rooms r ON m.room_id = r.id
    WHERE mn.user_id = ? AND m.deleted_at IS NULL
  `;

  const params = [userId];

  if (unreadOnly) {
    sql += ' AND m.created_at > (SELECT last_read_at FROM room_members WHERE room_id = m.room_id AND user_id = ?)';
    params.push(userId);
  }

  sql += ' ORDER BY m.created_at DESC LIMIT ?';
  params.push(limit);

  return query(sql, params);
}

module.exports = {
  createMessage,
  getMessageById,
  getRoomMessages,
  updateMessage,
  deleteMessage,
  addReaction,
  removeReaction,
  searchMessages,
  getThreadMessages,
  getUserMentions,
};
