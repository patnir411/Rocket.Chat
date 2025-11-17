require('dotenv').config();

const config = {
  // Server
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  rootUrl: process.env.ROOT_URL || `http://localhost:${process.env.PORT || 3000}`,

  // Database
  database: {
    type: process.env.DATABASE_TYPE || 'sqlite',
    path: process.env.DATABASE_PATH || './chat.db',
    url: process.env.DATABASE_URL,
  },

  // Security
  jwt: {
    secret: process.env.JWT_SECRET || 'default-secret-change-in-production',
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  },
  bcrypt: {
    rounds: parseInt(process.env.BCRYPT_ROUNDS || '10', 10),
  },

  // File Upload
  upload: {
    maxFileSize: parseInt(process.env.MAX_FILE_SIZE || '10485760', 10), // 10MB default
    uploadDir: process.env.UPLOAD_DIR || './uploads',
    allowedFileTypes: (process.env.ALLOWED_FILE_TYPES || 'image/jpeg,image/png,image/gif,image/webp,application/pdf,text/plain').split(','),
  },

  // Features
  features: {
    enableRegistration: process.env.ENABLE_REGISTRATION === 'true',
    requireEmailVerification: process.env.REQUIRE_EMAIL_VERIFICATION === 'true',
    maxRoomsPerUser: parseInt(process.env.MAX_ROOMS_PER_USER || '100', 10),
    maxMessagesPerRequest: parseInt(process.env.MAX_MESSAGES_PER_REQUEST || '50', 10),
  },

  // Rate Limiting
  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10), // 1 minute
    maxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100', 10),
    loginMaxRequests: parseInt(process.env.LOGIN_RATE_LIMIT_MAX || '5', 10),
  },

  // WebSocket
  websocket: {
    pingInterval: parseInt(process.env.WS_PING_INTERVAL || '30000', 10),
    pingTimeout: parseInt(process.env.WS_PING_TIMEOUT || '5000', 10),
  },

  // Logging
  logLevel: process.env.LOG_LEVEL || 'info',

  // CORS
  cors: {
    origin: process.env.CORS_ORIGIN || '*',
  },
};

// Validation
if (config.nodeEnv === 'production' && config.jwt.secret === 'default-secret-change-in-production') {
  console.error('ERROR: JWT_SECRET must be set in production!');
  process.exit(1);
}

module.exports = config;
