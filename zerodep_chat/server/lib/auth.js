/**
 * Zero-Dependency Authentication using node:crypto
 * - Password hashing: scrypt (similar to bcrypt)
 * - JWT: HMAC-SHA256
 * - UUIDs: crypto.randomUUID()
 */

const crypto = require('node:crypto');

// Configuration
const SCRYPT_PARAMS = {
  N: 16384,    // CPU/memory cost (2^14)
  r: 8,        // Block size
  p: 1,        // Parallelization
  keyLen: 64,  // Output key length
  saltLen: 16, // Salt length
};

const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(64).toString('hex');
const JWT_EXPIRY = 7 * 24 * 60 * 60; // 7 days in seconds

/**
 * Hash password using scrypt
 */
function hashPassword(password) {
  const salt = crypto.randomBytes(SCRYPT_PARAMS.saltLen);
  const hash = crypto.scryptSync(
    password,
    salt,
    SCRYPT_PARAMS.keyLen,
    { N: SCRYPT_PARAMS.N, r: SCRYPT_PARAMS.r, p: SCRYPT_PARAMS.p }
  );

  // Format: algorithm$N$r$p$salt$hash (all in hex)
  return [
    'scrypt',
    SCRYPT_PARAMS.N,
    SCRYPT_PARAMS.r,
    SCRYPT_PARAMS.p,
    salt.toString('hex'),
    hash.toString('hex'),
  ].join('$');
}

/**
 * Verify password against hash
 */
function verifyPassword(password, hashedPassword) {
  try {
    const parts = hashedPassword.split('$');
    if (parts[0] !== 'scrypt' || parts.length !== 6) {
      return false;
    }

    const N = parseInt(parts[1], 10);
    const r = parseInt(parts[2], 10);
    const p = parseInt(parts[3], 10);
    const salt = Buffer.from(parts[4], 'hex');
    const originalHash = Buffer.from(parts[5], 'hex');

    const hash = crypto.scryptSync(
      password,
      salt,
      originalHash.length,
      { N, r, p }
    );

    return crypto.timingSafeEqual(hash, originalHash);
  } catch (err) {
    return false;
  }
}

/**
 * Generate UUID v4
 */
function generateId() {
  return crypto.randomUUID();
}

/**
 * Generate random token
 */
function generateToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('hex');
}

/**
 * Hash token for storage (SHA-256)
 */
function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Create JWT token
 * Format: base64url(header).base64url(payload).base64url(signature)
 */
function createJWT(payload, expiresIn = JWT_EXPIRY) {
  const header = { alg: 'HS256', typ: 'JWT' };

  const now = Math.floor(Date.now() / 1000);
  const claims = {
    ...payload,
    iat: now,
    exp: now + expiresIn,
  };

  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(claims));

  const signature = crypto
    .createHmac('sha256', JWT_SECRET)
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest('base64url');

  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

/**
 * Verify JWT token
 */
function verifyJWT(token) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) {
      throw new Error('Invalid token format');
    }

    const [encodedHeader, encodedPayload, signature] = parts;

    // Verify signature
    const expectedSignature = crypto
      .createHmac('sha256', JWT_SECRET)
      .update(`${encodedHeader}.${encodedPayload}`)
      .digest('base64url');

    if (!crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expectedSignature)
    )) {
      throw new Error('Invalid signature');
    }

    // Decode payload
    const payload = JSON.parse(base64UrlDecode(encodedPayload));

    // Check expiration
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp && payload.exp < now) {
      throw new Error('Token expired');
    }

    return payload;
  } catch (err) {
    throw new Error(`JWT verification failed: ${err.message}`);
  }
}

/**
 * Base64 URL encode
 */
function base64UrlEncode(str) {
  return Buffer.from(str)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

/**
 * Base64 URL decode
 */
function base64UrlDecode(str) {
  // Add padding if needed
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) {
    str += '=';
  }
  return Buffer.from(str, 'base64').toString('utf8');
}

/**
 * Generate slug from string
 */
function generateSlug(str) {
  return str
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

module.exports = {
  hashPassword,
  verifyPassword,
  generateId,
  generateToken,
  hashToken,
  createJWT,
  verifyJWT,
  generateSlug,
};
