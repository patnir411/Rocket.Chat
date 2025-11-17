const { query, queryOne, execute, transaction } = require('../db');
const { generateId, generateSlug } = require('../utils/crypto');
const { AppError } = require('../middleware/errorHandler');

/**
 * Create a new room
 */
function createRoom({ name, type, topic, description, createdBy }) {
  const validTypes = ['channel', 'private', 'dm'];

  if (!validTypes.includes(type)) {
    throw new AppError('Invalid room type', 400);
  }

  return transaction(() => {
    const roomId = generateId();
    const slug = type === 'dm' ? null : generateSlug(name);
    const now = new Date().toISOString();

    // Create room
    execute(
      `INSERT INTO rooms (id, name, slug, type, topic, description, created_by, created_at, updated_at, member_count)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
      [roomId, name || null, slug, type, topic || null, description || null, createdBy, now, now]
    );

    // Add creator as owner
    const memberId = generateId();
    execute(
      `INSERT INTO room_members (id, room_id, user_id, role, joined_at)
       VALUES (?, ?, ?, 'owner', ?)`,
      [memberId, roomId, createdBy, now]
    );

    // Increment member count
    execute('UPDATE rooms SET member_count = member_count + 1 WHERE id = ?', [roomId]);

    return getRoomById(roomId);
  });
}

/**
 * Create or get DM room between two users
 */
function createOrGetDM(user1Id, user2Id) {
  return transaction(() => {
    // Check if DM already exists
    const existing = queryOne(
      `SELECT DISTINCT r.id
       FROM rooms r
       JOIN dm_participants dp1 ON r.id = dp1.room_id
       JOIN dm_participants dp2 ON r.id = dp2.room_id
       WHERE r.type = 'dm'
         AND dp1.user_id = ?
         AND dp2.user_id = ?
         AND r.deleted_at IS NULL`,
      [user1Id, user2Id]
    );

    if (existing) {
      return getRoomById(existing.id);
    }

    // Create new DM
    const roomId = generateId();
    const now = new Date().toISOString();

    execute(
      `INSERT INTO rooms (id, type, created_by, created_at, updated_at, member_count)
       VALUES (?, 'dm', ?, ?, ?, 2)`,
      [roomId, user1Id, now, now]
    );

    // Add both users as members
    const member1Id = generateId();
    const member2Id = generateId();

    execute(
      `INSERT INTO room_members (id, room_id, user_id, role, joined_at)
       VALUES (?, ?, ?, 'member', ?), (?, ?, ?, 'member', ?)`,
      [member1Id, roomId, user1Id, now, member2Id, roomId, user2Id, now]
    );

    // Track DM participants
    execute(`INSERT INTO dm_participants (room_id, user_id) VALUES (?, ?), (?, ?)`, [roomId, user1Id, roomId, user2Id]);

    return getRoomById(roomId);
  });
}

/**
 * Get room by ID
 */
function getRoomById(roomId) {
  return queryOne(
    `SELECT id, name, slug, type, topic, description, avatar_url, created_by, created_at, updated_at,
            last_message_at, message_count, member_count, is_archived, is_read_only
     FROM rooms
     WHERE id = ? AND deleted_at IS NULL`,
    [roomId]
  );
}

/**
 * Get room by slug
 */
function getRoomBySlug(slug) {
  return queryOne(
    `SELECT id, name, slug, type, topic, description, avatar_url, created_by, created_at, updated_at,
            last_message_at, message_count, member_count, is_archived, is_read_only
     FROM rooms
     WHERE slug = ? AND deleted_at IS NULL`,
    [slug]
  );
}

/**
 * Get user's rooms
 */
function getUserRooms(userId) {
  return query(
    `SELECT r.id, r.name, r.slug, r.type, r.topic, r.avatar_url, r.last_message_at, r.message_count,
            rm.unread_count, rm.mentions_count, rm.last_read_at, rm.is_favorite, rm.is_muted, rm.role
     FROM rooms r
     JOIN room_members rm ON r.id = rm.room_id
     WHERE rm.user_id = ? AND r.deleted_at IS NULL
     ORDER BY r.last_message_at DESC NULLS LAST`,
    [userId]
  );
}

/**
 * Get public channels
 */
function getPublicChannels(limit = 50) {
  return query(
    `SELECT id, name, slug, topic, description, avatar_url, member_count, message_count, created_at
     FROM rooms
     WHERE type = 'channel' AND deleted_at IS NULL AND is_archived = 0
     ORDER BY member_count DESC
     LIMIT ?`,
    [limit]
  );
}

/**
 * Join room
 */
function joinRoom(roomId, userId) {
  return transaction(() => {
    const room = getRoomById(roomId);

    if (!room) {
      throw new AppError('Room not found', 404);
    }

    if (room.type === 'private') {
      throw new AppError('Cannot join private room without invitation', 403);
    }

    // Check if already a member
    const existing = queryOne('SELECT id FROM room_members WHERE room_id = ? AND user_id = ?', [roomId, userId]);

    if (existing) {
      throw new AppError('Already a member', 400);
    }

    // Add member
    const memberId = generateId();
    execute(`INSERT INTO room_members (id, room_id, user_id, role, joined_at) VALUES (?, ?, ?, 'member', ?)`, [
      memberId,
      roomId,
      userId,
      new Date().toISOString(),
    ]);

    // Increment member count
    execute('UPDATE rooms SET member_count = member_count + 1 WHERE id = ?', [roomId]);

    return getRoomById(roomId);
  });
}

/**
 * Leave room
 */
function leaveRoom(roomId, userId) {
  return transaction(() => {
    const membership = queryOne('SELECT role FROM room_members WHERE room_id = ? AND user_id = ?', [roomId, userId]);

    if (!membership) {
      throw new AppError('Not a member of this room', 400);
    }

    if (membership.role === 'owner') {
      // Check if there are other owners
      const otherOwners = queryOne(
        'SELECT COUNT(*) as count FROM room_members WHERE room_id = ? AND role = ? AND user_id != ?',
        [roomId, 'owner', userId]
      );

      if (otherOwners.count === 0) {
        throw new AppError('Cannot leave room as the last owner. Transfer ownership first.', 400);
      }
    }

    // Remove member
    execute('DELETE FROM room_members WHERE room_id = ? AND user_id = ?', [roomId, userId]);

    // Decrement member count
    execute('UPDATE rooms SET member_count = member_count - 1 WHERE id = ?', [roomId]);
  });
}

/**
 * Update room
 */
function updateRoom(roomId, updates) {
  const allowedFields = ['name', 'topic', 'description', 'avatar_url', 'is_read_only'];
  const fields = [];
  const values = [];

  for (const [key, value] of Object.entries(updates)) {
    if (allowedFields.includes(key)) {
      fields.push(`${key} = ?`);
      values.push(value);

      // Update slug if name changed
      if (key === 'name') {
        fields.push('slug = ?');
        values.push(generateSlug(value));
      }
    }
  }

  if (fields.length === 0) {
    throw new AppError('No valid fields to update', 400);
  }

  fields.push('updated_at = ?');
  values.push(new Date().toISOString());
  values.push(roomId);

  execute(`UPDATE rooms SET ${fields.join(', ')} WHERE id = ?`, values);

  return getRoomById(roomId);
}

/**
 * Check if user is member of room
 */
function isMember(roomId, userId) {
  const result = queryOne('SELECT id FROM room_members WHERE room_id = ? AND user_id = ?', [roomId, userId]);
  return !!result;
}

/**
 * Get room members
 */
function getRoomMembers(roomId, limit = 100) {
  return query(
    `SELECT u.id, u.username, u.display_name, u.avatar_url, u.status, rm.role, rm.joined_at
     FROM room_members rm
     JOIN users u ON rm.user_id = u.id
     WHERE rm.room_id = ? AND u.deleted_at IS NULL
     ORDER BY rm.joined_at DESC
     LIMIT ?`,
    [roomId, limit]
  );
}

/**
 * Update member role
 */
function updateMemberRole(roomId, userId, newRole) {
  const validRoles = ['owner', 'moderator', 'member'];

  if (!validRoles.includes(newRole)) {
    throw new AppError('Invalid role', 400);
  }

  execute('UPDATE room_members SET role = ? WHERE room_id = ? AND user_id = ?', [newRole, roomId, userId]);
}

/**
 * Mark room as read
 */
function markAsRead(roomId, userId) {
  const now = new Date().toISOString();
  execute('UPDATE room_members SET unread_count = 0, mentions_count = 0, last_read_at = ? WHERE room_id = ? AND user_id = ?', [
    now,
    roomId,
    userId,
  ]);
}

/**
 * Toggle favorite
 */
function toggleFavorite(roomId, userId) {
  const current = queryOne('SELECT is_favorite FROM room_members WHERE room_id = ? AND user_id = ?', [roomId, userId]);

  if (!current) {
    throw new AppError('Not a member', 400);
  }

  const newValue = current.is_favorite ? 0 : 1;
  execute('UPDATE room_members SET is_favorite = ? WHERE room_id = ? AND user_id = ?', [newValue, roomId, userId]);

  return { is_favorite: !!newValue };
}

/**
 * Delete room (soft delete)
 */
function deleteRoom(roomId) {
  const now = new Date().toISOString();
  execute('UPDATE rooms SET deleted_at = ?, updated_at = ? WHERE id = ?', [now, now, roomId]);
}

module.exports = {
  createRoom,
  createOrGetDM,
  getRoomById,
  getRoomBySlug,
  getUserRooms,
  getPublicChannels,
  joinRoom,
  leaveRoom,
  updateRoom,
  isMember,
  getRoomMembers,
  updateMemberRole,
  markAsRead,
  toggleFavorite,
  deleteRoom,
};
