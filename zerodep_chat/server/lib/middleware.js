/**
 * Zero-Dependency Middleware
 */

const { verifyJWT, hashToken } = require('./auth');
const { getDatabase } = require('../db/database');

/**
 * CORS middleware
 */
function cors(options = {}) {
  const origin = options.origin || '*';
  const methods = options.methods || 'GET,POST,PUT,DELETE,OPTIONS';
  const headers = options.headers || 'Content-Type,Authorization';

  return (req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', methods);
    res.setHeader('Access-Control-Allow-Headers', headers);
    res.setHeader('Access-Control-Allow-Credentials', 'true');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    next();
  };
}

/**
 * Authentication middleware
 */
function authenticate(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.error('Unauthorized', 401);
    }

    const token = authHeader.substring(7);

    // Verify JWT
    const decoded = verifyJWT(token);

    // Check session in database
    const db = getDatabase();
    const tokenHash = hashToken(token);

    const session = db.get(
      `SELECT s.*, u.id as user_id, u.username, u.role, u.status
       FROM sessions s
       JOIN users u ON s.user_id = u.id
       WHERE s.token_hash = ? AND s.expires_at > datetime('now')`,
      [tokenHash]
    );

    if (!session) {
      return res.error('Invalid or expired session', 401);
    }

    // Update last used timestamp
    db.run(
      `UPDATE sessions SET last_used_at = datetime('now') WHERE id = ?`,
      [session.id]
    );

    // Attach user info to request
    req.user = {
      id: session.user_id,
      username: session.username,
      role: session.role,
      status: session.status,
      sessionId: session.id,
    };

    next();
  } catch (err) {
    res.error(err.message, 401);
  }
}

/**
 * Rate limiting middleware
 */
function rateLimit(options = {}) {
  const windowMs = options.windowMs || 60000; // 1 minute
  const max = options.max || 100; // 100 requests per minute

  const requests = new Map();

  // Cleanup old entries every minute
  setInterval(() => {
    const now = Date.now();
    for (const [key, data] of requests.entries()) {
      if (now > data.resetTime) {
        requests.delete(key);
      }
    }
  }, 60000);

  return (req, res, next) => {
    const key = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    const now = Date.now();

    let record = requests.get(key);
    if (!record || now > record.resetTime) {
      record = { count: 0, resetTime: now + windowMs };
      requests.set(key, record);
    }

    record.count++;

    res.setHeader('X-RateLimit-Limit', max);
    res.setHeader('X-RateLimit-Remaining', Math.max(0, max - record.count));
    res.setHeader('X-RateLimit-Reset', new Date(record.resetTime).toISOString());

    if (record.count > max) {
      return res.error('Too many requests', 429);
    }

    next();
  };
}

/**
 * Logger middleware
 */
function logger() {
  return (req, res, next) => {
    const start = Date.now();
    const originalEnd = res.end;

    res.end = function(...args) {
      const duration = Date.now() - start;
      console.log(
        `${new Date().toISOString()} ${req.method} ${req.path} ${res.statusCode} ${duration}ms`
      );
      originalEnd.apply(res, args);
    };

    next();
  };
}

/**
 * Error handler middleware
 */
function errorHandler() {
  return (err, req, res, next) => {
    console.error('Error:', err);
    if (!res.writableEnded) {
      res.error(err.message || 'Internal server error', err.status || 500);
    }
  };
}

/**
 * Authorization middleware (check roles)
 */
function authorize(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.error('Unauthorized', 401);
    }

    if (roles.length > 0 && !roles.includes(req.user.role)) {
      return res.error('Forbidden', 403);
    }

    next();
  };
}

module.exports = {
  cors,
  authenticate,
  rateLimit,
  logger,
  errorHandler,
  authorize,
};
