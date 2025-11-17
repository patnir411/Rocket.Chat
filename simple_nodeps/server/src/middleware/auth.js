const { verifyJWT, hashToken } = require('../utils/crypto');
const { queryOne } = require('../db');

/**
 * Authentication middleware - verifies JWT token
 */
async function authenticate(req, res, next) {
  try {
    // Get token from Authorization header
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized - No token provided' });
    }

    const token = authHeader.substring(7);

    // Verify JWT
    const decoded = verifyJWT(token);

    if (!decoded) {
      return res.status(401).json({ error: 'Unauthorized - Invalid token' });
    }

    // Check if session exists and is valid
    const tokenHash = hashToken(token);
    const session = queryOne(
      `SELECT s.*, u.id as user_id, u.username, u.role, u.status
       FROM sessions s
       JOIN users u ON s.user_id = u.id
       WHERE s.token_hash = ? AND s.expires_at > datetime('now') AND u.deleted_at IS NULL`,
      [tokenHash]
    );

    if (!session) {
      return res.status(401).json({ error: 'Unauthorized - Session expired or invalid' });
    }

    // Attach user info to request
    req.user = {
      id: session.user_id,
      username: session.username,
      role: session.role,
      status: session.status,
    };

    req.session = {
      id: session.id,
      token,
    };

    next();
  } catch (error) {
    console.error('Authentication error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * Optional authentication - allows both authenticated and unauthenticated requests
 */
async function optionalAuth(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return next();
  }

  try {
    await authenticate(req, res, next);
  } catch (error) {
    // If auth fails, continue without user
    next();
  }
}

/**
 * Role-based authorization middleware
 */
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Forbidden - Insufficient permissions' });
    }

    next();
  };
}

/**
 * Admin-only middleware
 */
const requireAdmin = requireRole('admin');

/**
 * Moderator or admin middleware
 */
const requireModerator = requireRole('admin', 'moderator');

module.exports = {
  authenticate,
  optionalAuth,
  requireRole,
  requireAdmin,
  requireModerator,
};
