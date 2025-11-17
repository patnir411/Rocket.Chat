require('dotenv').config();

const express = require('express');
const http = require('http');
const path = require('path');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');

const config = require('./config');
const { getDb, closeDb } = require('./db');
const { runMigrations } = require('./db/migrate');
const { initializeWebSocket } = require('./websocket');
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');
const { apiRateLimit } = require('./middleware/rateLimit');

// Import routes
const authRoutes = require('./routes/auth');
const usersRoutes = require('./routes/users');
const roomsRoutes = require('./routes/rooms');
const messagesRoutes = require('./routes/messages');

const app = express();
const server = http.createServer(app);

/**
 * Initialize application
 */
async function initialize() {
  console.log('🚀 Starting SimplChat Server...');
  console.log(`📍 Environment: ${config.nodeEnv}`);

  // Run database migrations
  try {
    runMigrations();
  } catch (error) {
    console.error('Failed to run migrations:', error);
    process.exit(1);
  }

  // Initialize database connection
  getDb();

  // Middleware
  app.use(helmet({
    contentSecurityPolicy: config.nodeEnv === 'production',
  }));

  app.use(cors({
    origin: config.cors.origin,
    credentials: true,
  }));

  app.use(compression());
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  // Request logging in development
  if (config.nodeEnv === 'development') {
    app.use((req, res, next) => {
      const start = Date.now();
      res.on('finish', () => {
        const duration = Date.now() - start;
        console.log(`${req.method} ${req.path} - ${res.statusCode} (${duration}ms)`);
      });
      next();
    });
  }

  // Static files (client)
  app.use(express.static(path.join(__dirname, '../../client')));

  // Upload directory
  const uploadDir = path.resolve(config.upload.uploadDir);
  const fs = require('fs');
  if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
  }
  app.use('/uploads', express.static(uploadDir));

  // API routes
  app.use('/api/auth', apiRateLimit, authRoutes);
  app.use('/api/users', apiRateLimit, usersRoutes);
  app.use('/api/rooms', apiRateLimit, roomsRoutes);
  app.use('/api/messages', apiRateLimit, messagesRoutes);

  // Health check endpoint
  app.get('/health', (req, res) => {
    res.json({
      status: 'ok',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      version: '1.0.0',
    });
  });

  // Metrics endpoint (basic)
  app.get('/metrics', (req, res) => {
    const { getConnectedUsersCount } = require('./websocket');

    res.setHeader('Content-Type', 'text/plain');
    res.send(`
# HELP simplchat_connected_users Number of connected WebSocket users
# TYPE simplchat_connected_users gauge
simplchat_connected_users ${getConnectedUsersCount()}

# HELP simplchat_uptime_seconds Server uptime in seconds
# TYPE simplchat_uptime_seconds counter
simplchat_uptime_seconds ${Math.floor(process.uptime())}

# HELP simplchat_memory_usage_bytes Memory usage in bytes
# TYPE simplchat_memory_usage_bytes gauge
simplchat_memory_usage_bytes ${process.memoryUsage().heapUsed}
    `.trim());
  });

  // Serve client app for all other routes (SPA)
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../../client/index.html'));
  });

  // Error handlers
  app.use(notFoundHandler);
  app.use(errorHandler);

  // Initialize WebSocket server
  initializeWebSocket(server);

  // Start server
  server.listen(config.port, () => {
    console.log(`✓ Server running on ${config.rootUrl}`);
    console.log(`✓ WebSocket server ready`);
    console.log(`✓ Database: ${config.database.type}`);
    console.log(`\n📝 API Documentation: ${config.rootUrl}/api`);
    console.log(`💚 Health Check: ${config.rootUrl}/health`);
    console.log(`📊 Metrics: ${config.rootUrl}/metrics`);
  });

  // Graceful shutdown
  process.on('SIGTERM', gracefulShutdown);
  process.on('SIGINT', gracefulShutdown);
}

/**
 * Graceful shutdown
 */
function gracefulShutdown() {
  console.log('\n🛑 Shutting down gracefully...');

  server.close(() => {
    console.log('✓ HTTP server closed');

    closeDb();
    console.log('✓ Database connection closed');

    console.log('👋 Goodbye!');
    process.exit(0);
  });

  // Force shutdown after 10 seconds
  setTimeout(() => {
    console.error('⚠️ Forced shutdown after timeout');
    process.exit(1);
  }, 10000);
}

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  gracefulShutdown();
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  gracefulShutdown();
});

// Initialize app
initialize().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});
