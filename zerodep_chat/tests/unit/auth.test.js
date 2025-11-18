/**
 * Authentication Tests - Zero Dependencies
 */

const test = require('node:test');
const assert = require('node:assert');
const {
  hashPassword,
  verifyPassword,
  generateId,
  generateToken,
  hashToken,
  createJWT,
  verifyJWT,
  generateSlug,
} = require('../../server/lib/auth');

test('Auth Module', async (t) => {
  await t.test('Password hashing', async (t) => {
    await t.test('should hash password with scrypt', () => {
      const password = 'testPassword123';
      const hash = hashPassword(password);

      assert.ok(hash, 'Hash should be generated');
      assert.ok(hash.startsWith('scrypt$'), 'Hash should start with scrypt$');
      assert.ok(hash.split('$').length === 6, 'Hash should have 6 parts');
    });

    await t.test('should verify correct password', () => {
      const password = 'testPassword123';
      const hash = hashPassword(password);

      assert.strictEqual(verifyPassword(password, hash), true);
    });

    await t.test('should reject incorrect password', () => {
      const password = 'testPassword123';
      const hash = hashPassword(password);

      assert.strictEqual(verifyPassword('wrongPassword', hash), false);
    });

    await t.test('should generate different hashes for same password', () => {
      const password = 'testPassword123';
      const hash1 = hashPassword(password);
      const hash2 = hashPassword(password);

      assert.notStrictEqual(hash1, hash2, 'Hashes should differ due to different salts');
      assert.strictEqual(verifyPassword(password, hash1), true);
      assert.strictEqual(verifyPassword(password, hash2), true);
    });
  });

  await t.test('ID generation', async (t) => {
    await t.test('should generate valid UUIDs', () => {
      const id = generateId();
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

      assert.ok(uuidRegex.test(id), 'Should be valid UUIDv4');
    });

    await t.test('should generate unique IDs', () => {
      const id1 = generateId();
      const id2 = generateId();

      assert.notStrictEqual(id1, id2);
    });
  });

  await t.test('Token generation', async (t) => {
    await t.test('should generate random tokens', () => {
      const token = generateToken();

      assert.ok(token, 'Token should be generated');
      assert.strictEqual(token.length, 64, 'Token should be 64 chars (32 bytes hex)');
    });

    await t.test('should generate unique tokens', () => {
      const token1 = generateToken();
      const token2 = generateToken();

      assert.notStrictEqual(token1, token2);
    });
  });

  await t.test('Token hashing', async (t) => {
    await t.test('should hash tokens with SHA-256', () => {
      const token = 'test-token';
      const hash = hashToken(token);

      assert.ok(hash, 'Hash should be generated');
      assert.strictEqual(hash.length, 64, 'SHA-256 hash should be 64 chars');
    });

    await t.test('should produce consistent hashes', () => {
      const token = 'test-token';
      const hash1 = hashToken(token);
      const hash2 = hashToken(token);

      assert.strictEqual(hash1, hash2);
    });
  });

  await t.test('JWT', async (t) => {
    await t.test('should create valid JWT', () => {
      const payload = { userId: '123', username: 'test' };
      const token = createJWT(payload);

      assert.ok(token, 'Token should be created');
      assert.strictEqual(token.split('.').length, 3, 'JWT should have 3 parts');
    });

    await t.test('should verify valid JWT', () => {
      const payload = { userId: '123', username: 'test' };
      const token = createJWT(payload);
      const decoded = verifyJWT(token);

      assert.strictEqual(decoded.userId, '123');
      assert.strictEqual(decoded.username, 'test');
      assert.ok(decoded.iat, 'Should have issued at time');
      assert.ok(decoded.exp, 'Should have expiration time');
    });

    await t.test('should reject invalid JWT', () => {
      assert.throws(() => {
        verifyJWT('invalid.jwt.token');
      }, /JWT verification failed/);
    });

    await t.test('should reject tampered JWT', () => {
      const payload = { userId: '123', username: 'test' };
      const token = createJWT(payload);
      const tampered = token.substring(0, token.length - 5) + 'XXXXX';

      assert.throws(() => {
        verifyJWT(tampered);
      }, /Invalid signature/);
    });

    await t.test('should reject expired JWT', () => {
      const payload = { userId: '123', username: 'test' };
      const token = createJWT(payload, -1); // Expired 1 second ago

      assert.throws(() => {
        verifyJWT(token);
      }, /Token expired/);
    });
  });

  await t.test('Slug generation', async (t) => {
    await t.test('should generate valid slug', () => {
      const slug = generateSlug('Hello World!');
      assert.strictEqual(slug, 'hello-world');
    });

    await t.test('should handle special characters', () => {
      const slug = generateSlug('Test @#$ Channel!!!');
      assert.strictEqual(slug, 'test-channel');
    });

    await t.test('should handle multiple spaces', () => {
      const slug = generateSlug('Multiple   Spaces   Here');
      assert.strictEqual(slug, 'multiple-spaces-here');
    });
  });
});
