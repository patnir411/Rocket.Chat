/**
 * Room Service - Zero Dependencies
 */

const { getDatabase } = require('../db/database');
const { generateId, generateSlug } = require('../lib/auth');

class RoomService {
  constructor() {
    this.db = getDatabase();
  }

  /**
   * Create room
   */
  createRoom({ name, type, description, topic, createdBy, members = [] }) {
    if (!['channel', 'private', 'dm'].includes(type)) {
      throw new Error('Invalid room type');
    }

    if (type !== 'dm' && (!name || name.length < 1)) {
      throw new Error('Room name is required');
    }

    return this.db.transaction((db) => {
      const roomId = generateId();
      const roomName = type === 'dm' ? '' : name;

      // Create room
      db.run(
        `INSERT INTO rooms (id, name, type, description, topic, created_by)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [roomId, roomName, type, description || null, topic || null, createdBy]
      );

      // Add creator as owner
      db.run(
        `INSERT INTO room_members (room_id, user_id, role)
         VALUES (?, ?, 'owner')`,
        [roomId, createdBy]
      );

      // Add additional members
      for (const userId of members) {
        if (userId !== createdBy) {
          db.run(
            `INSERT INTO room_members (room_id, user_id, role)
             VALUES (?, ?, 'member')`,
            [roomId, userId]
          );
        }
      }

      // For DM rooms, create participant records
      if (type === 'dm') {
        db.run(
          `INSERT INTO dm_participants (room_id, user_id) VALUES (?, ?)`,
          [roomId, createdBy]
        );
        for (const userId of members) {
          if (userId !== createdBy) {
            db.run(
              `INSERT INTO dm_participants (room_id, user_id) VALUES (?, ?)`,
              [roomId, userId]
            );
          }
        }
      }

      return this.getRoomById(roomId, createdBy);
    });
  }

  /**
   * Get or create DM room between two users
   */
  getOrCreateDM(user1Id, user2Id) {
    // Check if DM already exists
    const existing = this.db.get(
      `SELECT r.id
       FROM rooms r
       JOIN dm_participants dp1 ON r.id = dp1.room_id AND dp1.user_id = ?
       JOIN dm_participants dp2 ON r.id = dp2.room_id AND dp2.user_id = ?
       WHERE r.type = 'dm'
       LIMIT 1`,
      [user1Id, user2Id]
    );

    if (existing) {
      return this.getRoomById(existing.id, user1Id);
    }

    // Create new DM
    return this.createRoom({
      name: '',
      type: 'dm',
      createdBy: user1Id,
      members: [user2Id],
    });
  }

  /**
   * Get room by ID
   */
  getRoomById(roomId, userId = null) {
    const room = this.db.get(
      'SELECT * FROM rooms WHERE id = ? AND is_archived = 0',
      [roomId]
    );

    if (!room) return null;

    // Get member info if userId provided
    if (userId) {
      const membership = this.db.get(
        'SELECT role, unread_count, is_muted FROM room_members WHERE room_id = ? AND user_id = ?',
        [roomId, userId]
      );
      if (membership) {
        room.user_role = membership.role;
        room.unread_count = membership.unread_count;
        room.is_muted = membership.is_muted;
      }
    }

    // For DM rooms, get other participant info
    if (room.type === 'dm' && userId) {
      const otherUser = this.db.get(
        `SELECT u.id, u.username, u.display_name, u.avatar_url, u.status
         FROM dm_participants dp
         JOIN users u ON dp.user_id = u.id
         WHERE dp.room_id = ? AND dp.user_id != ?
         LIMIT 1`,
        [roomId, userId]
      );
      if (otherUser) {
        room.dm_user = otherUser;
        room.name = otherUser.display_name || otherUser.username;
      }
    }

    return room;
  }

  /**
   * Get rooms for user
   */
  getRoomsForUser(userId) {
    const rooms = this.db.all(
      `SELECT r.*, rm.role as user_role, rm.unread_count, rm.is_muted
       FROM rooms r
       JOIN room_members rm ON r.id = rm.room_id
       WHERE rm.user_id = ? AND r.is_archived = 0
       ORDER BY r.last_message_at DESC NULLS LAST, r.created_at DESC`,
      [userId]
    );

    // Enhance DM rooms with other user info
    for (const room of rooms) {
      if (room.type === 'dm') {
        const otherUser = this.db.get(
          `SELECT u.id, u.username, u.display_name, u.avatar_url, u.status
           FROM dm_participants dp
           JOIN users u ON dp.user_id = u.id
           WHERE dp.room_id = ? AND dp.user_id != ?
           LIMIT 1`,
          [room.id, userId]
        );
        if (otherUser) {
          room.dm_user = otherUser;
          room.name = otherUser.display_name || otherUser.username;
        }
      }
    }

    return rooms;
  }

  /**
   * Join room
   */
  joinRoom(roomId, userId) {
    const room = this.db.get('SELECT type FROM rooms WHERE id = ?', [roomId]);
    if (!room) {
      throw new Error('Room not found');
    }

    if (room.type === 'private') {
      throw new Error('Cannot join private room without invitation');
    }

    // Check if already a member
    const existing = this.db.get(
      'SELECT id FROM room_members WHERE room_id = ? AND user_id = ?',
      [roomId, userId]
    );

    if (existing) {
      return this.getRoomById(roomId, userId);
    }

    // Add member
    this.db.run(
      `INSERT INTO room_members (room_id, user_id, role)
       VALUES (?, ?, 'member')`,
      [roomId, userId]
    );

    return this.getRoomById(roomId, userId);
  }

  /**
   * Leave room
   */
  leaveRoom(roomId, userId) {
    const membership = this.db.get(
      'SELECT role FROM room_members WHERE room_id = ? AND user_id = ?',
      [roomId, userId]
    );

    if (!membership) {
      throw new Error('Not a member of this room');
    }

    if (membership.role === 'owner') {
      // Transfer ownership or delete room
      const otherMembers = this.db.all(
        'SELECT user_id FROM room_members WHERE room_id = ? AND user_id != ?',
        [roomId, userId]
      );

      if (otherMembers.length > 0) {
        // Transfer to first member
        this.db.run(
          `UPDATE room_members SET role = 'owner' WHERE room_id = ? AND user_id = ?`,
          [roomId, otherMembers[0].user_id]
        );
      }
    }

    // Remove member
    this.db.run(
      'DELETE FROM room_members WHERE room_id = ? AND user_id = ?',
      [roomId, userId]
    );

    return { success: true };
  }

  /**
   * Update room
   */
  updateRoom(roomId, userId, updates) {
    // Check permission
    const membership = this.db.get(
      'SELECT role FROM room_members WHERE room_id = ? AND user_id = ?',
      [roomId, userId]
    );

    if (!membership || !['owner', 'moderator'].includes(membership.role)) {
      throw new Error('Permission denied');
    }

    const allowed = ['name', 'description', 'topic'];
    const fields = [];
    const values = [];

    for (const [key, value] of Object.entries(updates)) {
      if (allowed.includes(key)) {
        fields.push(`${key} = ?`);
        values.push(value);
      }
    }

    if (fields.length === 0) {
      return this.getRoomById(roomId, userId);
    }

    fields.push('updated_at = datetime(\'now\')');
    values.push(roomId);

    this.db.run(
      `UPDATE rooms SET ${fields.join(', ')} WHERE id = ?`,
      values
    );

    return this.getRoomById(roomId, userId);
  }

  /**
   * Get room members
   */
  getRoomMembers(roomId) {
    return this.db.all(
      `SELECT u.id, u.username, u.display_name, u.avatar_url, u.status,
              rm.role, rm.joined_at
       FROM room_members rm
       JOIN users u ON rm.user_id = u.id
       WHERE rm.room_id = ?
       ORDER BY rm.joined_at ASC`,
      [roomId]
    );
  }

  /**
   * Mark room as read
   */
  markAsRead(roomId, userId) {
    this.db.run(
      'UPDATE room_members SET unread_count = 0 WHERE room_id = ? AND user_id = ?',
      [roomId, userId]
    );
    return { success: true };
  }

  /**
   * Check if user is member
   */
  isMember(roomId, userId) {
    const member = this.db.get(
      'SELECT id FROM room_members WHERE room_id = ? AND user_id = ?',
      [roomId, userId]
    );
    return !!member;
  }
}

module.exports = new RoomService();
