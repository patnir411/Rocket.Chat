/**
 * User Service - Zero Dependencies
 */

const { getDatabase } = require('../db/database');
const {
  hashPassword,
  verifyPassword,
  generateId,
  generateToken,
  hashToken,
  createJWT
} = require('../lib/auth');

class UserService {
  constructor() {
    this.db = getDatabase();
  }

  /**
   * Register new user
   */
  register({ username, email, password, displayName }) {
    // Validate input
    if (!username || username.length < 3) {
      throw new Error('Username must be at least 3 characters');
    }
    if (!password || password.length < 6) {
      throw new Error('Password must be at least 6 characters');
    }

    // Check if username exists
    const existing = this.db.get(
      'SELECT id FROM users WHERE username = ? AND deleted_at IS NULL',
      [username]
    );
    if (existing) {
      throw new Error('Username already exists');
    }

    // Hash password
    const passwordHash = hashPassword(password);

    // Create user
    const userId = generateId();
    this.db.run(
      `INSERT INTO users (id, username, email, password_hash, display_name, status)
       VALUES (?, ?, ?, ?, ?, 'offline')`,
      [userId, username, email || null, passwordHash, displayName || username]
    );

    // Return user (without password)
    return this.getUserById(userId);
  }

  /**
   * Login user
   */
  login({ username, password }) {
    // Find user
    const user = this.db.get(
      'SELECT * FROM users WHERE username = ? AND deleted_at IS NULL',
      [username]
    );

    if (!user || !verifyPassword(password, user.password_hash)) {
      throw new Error('Invalid username or password');
    }

    // Create session
    const token = generateToken();
    const tokenHash = hashToken(token);
    const sessionId = generateId();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    this.db.run(
      `INSERT INTO sessions (id, user_id, token_hash, expires_at)
       VALUES (?, ?, ?, ?)`,
      [sessionId, user.id, tokenHash, expiresAt.toISOString()]
    );

    // Create JWT
    const jwt = createJWT({ userId: user.id, username: user.username });

    // Update user status and last seen
    this.db.run(
      `UPDATE users SET status = 'online', last_seen_at = datetime('now') WHERE id = ?`,
      [user.id]
    );

    // Return user and token
    return {
      user: this.sanitizeUser(user),
      token: jwt,
      sessionId,
    };
  }

  /**
   * Logout user
   */
  logout(sessionId) {
    this.db.run('DELETE FROM sessions WHERE id = ?', [sessionId]);
    return { success: true };
  }

  /**
   * Update user status
   */
  updateStatus(userId, status, statusText = null) {
    this.db.run(
      `UPDATE users SET status = ?, status_text = ?, updated_at = datetime('now')
       WHERE id = ?`,
      [status, statusText, userId]
    );
    return this.getUserById(userId);
  }

  /**
   * Update user profile
   */
  updateProfile(userId, updates) {
    const allowed = ['display_name', 'avatar_url', 'email'];
    const fields = [];
    const values = [];

    for (const [key, value] of Object.entries(updates)) {
      if (allowed.includes(key)) {
        fields.push(`${key} = ?`);
        values.push(value);
      }
    }

    if (fields.length === 0) {
      return this.getUserById(userId);
    }

    fields.push('updated_at = datetime(\'now\')');
    values.push(userId);

    this.db.run(
      `UPDATE users SET ${fields.join(', ')} WHERE id = ?`,
      values
    );

    return this.getUserById(userId);
  }

  /**
   * Change password
   */
  changePassword(userId, oldPassword, newPassword) {
    const user = this.db.get('SELECT password_hash FROM users WHERE id = ?', [userId]);

    if (!verifyPassword(oldPassword, user.password_hash)) {
      throw new Error('Invalid current password');
    }

    if (newPassword.length < 6) {
      throw new Error('New password must be at least 6 characters');
    }

    const passwordHash = hashPassword(newPassword);
    this.db.run(
      'UPDATE users SET password_hash = ?, updated_at = datetime(\'now\') WHERE id = ?',
      [passwordHash, userId]
    );

    // Invalidate all sessions except current
    this.db.run('DELETE FROM sessions WHERE user_id = ?', [userId]);

    return { success: true };
  }

  /**
   * Search users
   */
  searchUsers(query, limit = 20) {
    const pattern = `%${query}%`;
    return this.db.all(
      `SELECT id, username, display_name, avatar_url, status
       FROM users
       WHERE (username LIKE ? OR display_name LIKE ?)
         AND deleted_at IS NULL
       LIMIT ?`,
      [pattern, pattern, limit]
    ).map(u => this.sanitizeUser(u));
  }

  /**
   * Get user by ID
   */
  getUserById(userId) {
    const user = this.db.get(
      'SELECT * FROM users WHERE id = ? AND deleted_at IS NULL',
      [userId]
    );
    return user ? this.sanitizeUser(user) : null;
  }

  /**
   * Get user by username
   */
  getUserByUsername(username) {
    const user = this.db.get(
      'SELECT * FROM users WHERE username = ? AND deleted_at IS NULL',
      [username]
    );
    return user ? this.sanitizeUser(user) : null;
  }

  /**
   * Get multiple users by IDs
   */
  getUsersByIds(userIds) {
    if (userIds.length === 0) return [];

    const placeholders = userIds.map(() => '?').join(',');
    return this.db.all(
      `SELECT * FROM users WHERE id IN (${placeholders}) AND deleted_at IS NULL`,
      userIds
    ).map(u => this.sanitizeUser(u));
  }

  /**
   * Remove sensitive fields from user object
   */
  sanitizeUser(user) {
    if (!user) return null;
    const { password_hash, deleted_at, ...sanitized } = user;
    return sanitized;
  }
}

module.exports = new UserService();
