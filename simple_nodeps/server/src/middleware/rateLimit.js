const config = require('../config');

// In-memory store for rate limiting (use Redis in production for multiple servers)
const requestCounts = new Map();

/**
 * Clean up old entries periodically
 */
setInterval(() => {
  const now = Date.now();
  for (const [key, data] of requestCounts.entries()) {
    if (now > data.resetTime) {
      requestCounts.delete(key);
    }
  }
}, 60000); // Clean every minute

/**
 * Rate limiting middleware
 */
function rateLimit(options = {}) {
  const windowMs = options.windowMs || config.rateLimit.windowMs;
  const maxRequests = options.max || config.rateLimit.maxRequests;
  const keyGenerator = options.keyGenerator || ((req) => req.ip);

  return (req, res, next) => {
    const key = keyGenerator(req);
    const now = Date.now();

    let record = requestCounts.get(key);

    if (!record || now > record.resetTime) {
      record = {
        count: 0,
        resetTime: now + windowMs,
      };
      requestCounts.set(key, record);
    }

    record.count++;

    // Set rate limit headers
    res.setHeader('X-RateLimit-Limit', maxRequests);
    res.setHeader('X-RateLimit-Remaining', Math.max(0, maxRequests - record.count));
    res.setHeader('X-RateLimit-Reset', Math.ceil(record.resetTime / 1000));

    if (record.count > maxRequests) {
      const retryAfter = Math.ceil((record.resetTime - now) / 1000);
      res.setHeader('Retry-After', retryAfter);

      return res.status(429).json({
        error: 'Too many requests',
        retryAfter,
        message: `Rate limit exceeded. Try again in ${retryAfter} seconds.`,
      });
    }

    next();
  };
}

/**
 * Login-specific rate limiting (stricter)
 */
const loginRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: config.rateLimit.loginMaxRequests,
  keyGenerator: (req) => {
    // Rate limit by IP and username combination
    return `login:${req.ip}:${req.body.username || 'unknown'}`;
  },
});

/**
 * API rate limiting (general)
 */
const apiRateLimit = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.maxRequests,
});

/**
 * WebSocket rate limiting
 */
function wsRateLimit(ws, maxPerMinute = 60) {
  if (!ws.rateLimitData) {
    ws.rateLimitData = {
      count: 0,
      resetTime: Date.now() + 60000,
    };
  }

  const now = Date.now();

  if (now > ws.rateLimitData.resetTime) {
    ws.rateLimitData.count = 0;
    ws.rateLimitData.resetTime = now + 60000;
  }

  ws.rateLimitData.count++;

  if (ws.rateLimitData.count > maxPerMinute) {
    ws.send(
      JSON.stringify({
        type: 'error',
        error: 'Rate limit exceeded',
        message: 'Too many messages. Please slow down.',
      })
    );
    return false;
  }

  return true;
}

module.exports = {
  rateLimit,
  loginRateLimit,
  apiRateLimit,
  wsRateLimit,
};
