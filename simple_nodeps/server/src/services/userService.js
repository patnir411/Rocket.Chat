const { query, queryOne, execute, transaction } = require('../db');
const { generateId, hashPassword, comparePassword, generateJWT, hashToken } = require('../utils/crypto');
const { AppError } = require('../middleware/errorHandler');

/**
 * Register a new user
 */
async function register({ username, email, password, displayName }) {
  // Check if username already exists
  const existing = queryOne('SELECT id FROM users WHERE username = ? OR email = ?', [username, email || username]);

  if (existing) {
    throw new AppError('Username or email already exists', 400);
  }

  // Hash password
  const passwordHash = await hashPassword(password);

  // Create user
  const userId = generateId();
  const now = new Date().toISOString();

  execute(
    `INSERT INTO users (id, username, email, password_hash, display_name, status, role, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'offline', 'user', ?, ?)`,
    [userId, username, email || null, passwordHash, displayName || username, now, now]
  );

  return {
    id: userId,
    username,
    email: email || null,
    displayName: displayName || username,
  };
}

/**
 * Login user and create session
 */
async function login({ username, password, ipAddress, userAgent }) {
  // Find user
  const user = queryOne(
    'SELECT id, username, email, password_hash, display_name, role, status FROM users WHERE username = ? AND deleted_at IS NULL',
    [username]
  );

  if (!user) {
    throw new AppError('Invalid credentials', 401);
  }

  // Verify password
  const isValid = await comparePassword(password, user.password_hash);

  if (!isValid) {
    throw new AppError('Invalid credentials', 401);
  }

  // Generate JWT token
  const token = generateJWT({
    userId: user.id,
    username: user.username,
    role: user.role,
  });

  // Create session
  const sessionId = generateId();
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(); // 7 days

  execute(
    `INSERT INTO sessions (id, user_id, token_hash, ip_address, user_agent, expires_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [sessionId, user.id, tokenHash, ipAddress, userAgent, expiresAt]
  );

  // Update user status to online
  execute('UPDATE users SET status = ?, last_seen_at = ? WHERE id = ?', ['online', new Date().toISOString(), user.id]);

  return {
    token,
    user: {
      id: user.id,
      username: user.username,
      email: user.email,
      displayName: user.display_name,
      role: user.role,
      status: 'online',
    },
  };
}

/**
 * Logout user and invalidate session
 */
async function logout(sessionId) {
  execute('DELETE FROM sessions WHERE id = ?', [sessionId]);
}

/**
 * Get user by ID
 */
function getUserById(userId) {
  return queryOne(
    `SELECT id, username, email, display_name, avatar_url, status, status_text, role, created_at, last_seen_at
     FROM users
     WHERE id = ? AND deleted_at IS NULL`,
    [userId]
  );
}

/**
 * Get user by username
 */
function getUserByUsername(username) {
  return queryOne(
    `SELECT id, username, email, display_name, avatar_url, status, status_text, role, created_at, last_seen_at
     FROM users
     WHERE username = ? AND deleted_at IS NULL`,
    [username]
  );
}

/**
 * Update user profile
 */
async function updateProfile(userId, updates) {
  const allowedFields = ['display_name', 'email', 'status_text', 'avatar_url'];
  const fields = [];
  const values = [];

  for (const [key, value] of Object.entries(updates)) {
    if (allowedFields.includes(key)) {
      fields.push(`${key} = ?`);
      values.push(value);
    }
  }

  if (fields.length === 0) {
    throw new AppError('No valid fields to update', 400);
  }

  fields.push('updated_at = ?');
  values.push(new Date().toISOString());
  values.push(userId);

  execute(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`, values);

  return getUserById(userId);
}

/**
 * Update user status (online, away, busy, offline)
 */
function updateStatus(userId, status) {
  const validStatuses = ['online', 'away', 'busy', 'offline'];

  if (!validStatuses.includes(status)) {
    throw new AppError('Invalid status', 400);
  }

  const now = new Date().toISOString();
  execute('UPDATE users SET status = ?, last_seen_at = ?, updated_at = ? WHERE id = ?', [status, now, now, userId]);

  return { status };
}

/**
 * Search users
 */
function searchUsers(query, limit = 20) {
  return query(
    `SELECT id, username, display_name, avatar_url, status
     FROM users
     WHERE (username LIKE ? OR display_name LIKE ?) AND deleted_at IS NULL
     LIMIT ?`,
    [`%${query}%`, `%${query}%`, limit]
  );
}

/**
 * Change password
 */
async function changePassword(userId, oldPassword, newPassword) {
  const user = queryOne('SELECT password_hash FROM users WHERE id = ?', [userId]);

  if (!user) {
    throw new AppError('User not found', 404);
  }

  const isValid = await comparePassword(oldPassword, user.password_hash);

  if (!isValid) {
    throw new AppError('Invalid current password', 401);
  }

  const newHash = await hashPassword(newPassword);
  execute('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?', [newHash, new Date().toISOString(), userId]);

  // Invalidate all sessions except current
  // (Implement this if needed)
}

/**
 * Delete user (soft delete)
 */
function deleteUser(userId) {
  execute('UPDATE users SET deleted_at = ?, updated_at = ? WHERE id = ?', [
    new Date().toISOString(),
    new Date().toISOString(),
    userId,
  ]);
}

module.exports = {
  register,
  login,
  logout,
  getUserById,
  getUserByUsername,
  updateProfile,
  updateStatus,
  searchUsers,
  changePassword,
  deleteUser,
};
