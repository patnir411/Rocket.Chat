#!/usr/bin/env node
/**
 * Zero-Dependency Chat Server
 * Built using ONLY Node.js core modules (node:http, node:crypto, node:sqlite, node:fs)
 */

const fs = require('node:fs');
const path = require('node:path');
const { HttpServer } = require('./lib/http-server');
const { WebSocketServer } = require('./lib/websocket');
const { getDatabase } = require('./db/database');
const { cors, authenticate, rateLimit, logger } = require('./lib/middleware');
const userService = require('./services/users');
const roomService = require('./services/rooms');
const messageService = require('./services/messages');
const { verifyJWT, hashToken } = require('./lib/auth');

const PORT = process.env.PORT || 3000;
const CLIENT_PATH = path.join(__dirname, '../client');

// Initialize HTTP server
const app = new HttpServer();

// Apply global middleware
app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
app.use(logger());

// Rate limiting
const apiRateLimit = rateLimit({ windowMs: 60000, max: 100 });
const authRateLimit = rateLimit({ windowMs: 900000, max: 5 }); // 5 per 15 min for auth

// ============================================================================
// AUTH ROUTES
// ============================================================================

app.post('/api/auth/register', (req, res) => {
  try {
    const user = userService.register(req.body);
    res.json({ user });
  } catch (err) {
    res.error(err.message, 400);
  }
});

app.post('/api/auth/login', (req, res) => {
  try {
    const result = userService.login(req.body);
    res.json(result);
  } catch (err) {
    res.error(err.message, 401);
  }
});

app.post('/api/auth/logout', (req, res, next) => {
  authenticate(req, res, () => {
    try {
      userService.logout(req.user.sessionId);
      res.json({ success: true });
    } catch (err) {
      res.error(err.message, 400);
    }
  });
});

// ============================================================================
// USER ROUTES
// ============================================================================

app.get('/api/users/me', (req, res, next) => {
  authenticate(req, res, () => {
    const user = userService.getUserById(req.user.id);
    res.json({ user });
  });
});

app.put('/api/users/me', (req, res, next) => {
  authenticate(req, res, () => {
    try {
      const user = userService.updateProfile(req.user.id, req.body);
      res.json({ user });
    } catch (err) {
      res.error(err.message, 400);
    }
  });
});

app.put('/api/users/me/status', (req, res, next) => {
  authenticate(req, res, () => {
    try {
      const { status, statusText } = req.body;
      const user = userService.updateStatus(req.user.id, status, statusText);

      // Broadcast status change via WebSocket
      wss.broadcast({
        type: 'user_status',
        userId: req.user.id,
        status,
        statusText,
      });

      res.json({ user });
    } catch (err) {
      res.error(err.message, 400);
    }
  });
});

app.put('/api/users/me/password', (req, res, next) => {
  authenticate(req, res, () => {
    try {
      const { oldPassword, newPassword } = req.body;
      userService.changePassword(req.user.id, oldPassword, newPassword);
      res.json({ success: true });
    } catch (err) {
      res.error(err.message, 400);
    }
  });
});

app.get('/api/users/search', (req, res, next) => {
  authenticate(req, res, () => {
    const { q, limit } = req.query;
    const users = userService.searchUsers(q || '', parseInt(limit) || 20);
    res.json({ users });
  });
});

app.get('/api/users/:username', (req, res, next) => {
  authenticate(req, res, () => {
    const user = userService.getUserByUsername(req.params.username);
    if (!user) {
      return res.error('User not found', 404);
    }
    res.json({ user });
  });
});

// ============================================================================
// ROOM ROUTES
// ============================================================================

app.get('/api/rooms', (req, res, next) => {
  authenticate(req, res, () => {
    const rooms = roomService.getRoomsForUser(req.user.id);
    res.json({ rooms });
  });
});

app.post('/api/rooms', (req, res, next) => {
  authenticate(req, res, () => {
    try {
      const room = roomService.createRoom({
        ...req.body,
        createdBy: req.user.id,
      });
      res.json({ room });
    } catch (err) {
      res.error(err.message, 400);
    }
  });
});

app.get('/api/rooms/:id', (req, res, next) => {
  authenticate(req, res, () => {
    const room = roomService.getRoomById(req.params.id, req.user.id);
    if (!room) {
      return res.error('Room not found', 404);
    }
    res.json({ room });
  });
});

app.put('/api/rooms/:id', (req, res, next) => {
  authenticate(req, res, () => {
    try {
      const room = roomService.updateRoom(req.params.id, req.user.id, req.body);
      res.json({ room });
    } catch (err) {
      res.error(err.message, 400);
    }
  });
});

app.post('/api/rooms/:id/join', (req, res, next) => {
  authenticate(req, res, () => {
    try {
      const room = roomService.joinRoom(req.params.id, req.user.id);
      res.json({ room });
    } catch (err) {
      res.error(err.message, 400);
    }
  });
});

app.post('/api/rooms/:id/leave', (req, res, next) => {
  authenticate(req, res, () => {
    try {
      roomService.leaveRoom(req.params.id, req.user.id);
      res.json({ success: true });
    } catch (err) {
      res.error(err.message, 400);
    }
  });
});

app.get('/api/rooms/:id/members', (req, res, next) => {
  authenticate(req, res, () => {
    const members = roomService.getRoomMembers(req.params.id);
    res.json({ members });
  });
});

app.post('/api/rooms/:id/read', (req, res, next) => {
  authenticate(req, res, () => {
    roomService.markAsRead(req.params.id, req.user.id);
    res.json({ success: true });
  });
});

app.post('/api/rooms/dm', (req, res, next) => {
  authenticate(req, res, () => {
    try {
      const { userId } = req.body;
      const room = roomService.getOrCreateDM(req.user.id, userId);
      res.json({ room });
    } catch (err) {
      res.error(err.message, 400);
    }
  });
});

// ============================================================================
// MESSAGE ROUTES
// ============================================================================

app.get('/api/rooms/:id/messages', (req, res, next) => {
  authenticate(req, res, () => {
    const { limit, before } = req.query;
    const messages = messageService.getMessages(
      req.params.id,
      parseInt(limit) || 50,
      before
    );
    res.json({ messages });
  });
});

app.post('/api/rooms/:id/messages', (req, res, next) => {
  authenticate(req, res, () => {
    try {
      const message = messageService.createMessage({
        roomId: req.params.id,
        userId: req.user.id,
        ...req.body,
      });

      // Broadcast message via WebSocket
      wss.broadcast({
        type: 'message',
        message,
      });

      res.json({ message });
    } catch (err) {
      res.error(err.message, 400);
    }
  });
});

app.put('/api/messages/:id', (req, res, next) => {
  authenticate(req, res, () => {
    try {
      const message = messageService.updateMessage(
        req.params.id,
        req.user.id,
        req.body.content
      );

      // Broadcast update via WebSocket
      wss.broadcast({
        type: 'message_updated',
        message,
      });

      res.json({ message });
    } catch (err) {
      res.error(err.message, 400);
    }
  });
});

app.delete('/api/messages/:id', (req, res, next) => {
  authenticate(req, res, () => {
    try {
      messageService.deleteMessage(req.params.id, req.user.id);

      // Broadcast deletion via WebSocket
      wss.broadcast({
        type: 'message_deleted',
        messageId: req.params.id,
      });

      res.json({ success: true });
    } catch (err) {
      res.error(err.message, 400);
    }
  });
});

app.post('/api/messages/:id/reactions', (req, res, next) => {
  authenticate(req, res, () => {
    try {
      const { emoji } = req.body;
      const reactions = messageService.addReaction(req.params.id, req.user.id, emoji);

      // Broadcast reaction via WebSocket
      wss.broadcast({
        type: 'reaction_added',
        messageId: req.params.id,
        userId: req.user.id,
        emoji,
        reactions,
      });

      res.json({ reactions });
    } catch (err) {
      res.error(err.message, 400);
    }
  });
});

app.delete('/api/messages/:id/reactions/:emoji', (req, res, next) => {
  authenticate(req, res, () => {
    try {
      const reactions = messageService.removeReaction(
        req.params.id,
        req.user.id,
        req.params.emoji
      );

      // Broadcast reaction removal via WebSocket
      wss.broadcast({
        type: 'reaction_removed',
        messageId: req.params.id,
        userId: req.user.id,
        emoji: req.params.emoji,
        reactions,
      });

      res.json({ reactions });
    } catch (err) {
      res.error(err.message, 400);
    }
  });
});

app.get('/api/rooms/:id/messages/search', (req, res, next) => {
  authenticate(req, res, () => {
    const { q, limit } = req.query;
    const messages = messageService.searchMessages(
      req.params.id,
      q || '',
      parseInt(limit) || 50
    );
    res.json({ messages });
  });
});

// ============================================================================
// STATIC FILE SERVING
// ============================================================================

app.get('/', (req, res) => {
  const indexPath = path.join(CLIENT_PATH, 'index.html');
  if (fs.existsSync(indexPath)) {
    const content = fs.readFileSync(indexPath, 'utf8');
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(content);
  } else {
    res.error('Not found', 404);
  }
});

// Serve static files
app.get('/*', (req, res) => {
  const filePath = path.join(CLIENT_PATH, req.path);

  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    return res.error('Not found', 404);
  }

  const ext = path.extname(filePath);
  const contentTypes = {
    '.html': 'text/html',
    '.js': 'application/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
  };

  const contentType = contentTypes[ext] || 'application/octet-stream';
  const content = fs.readFileSync(filePath);

  res.writeHead(200, { 'Content-Type': contentType });
  res.end(content);
});

// ============================================================================
// WEBSOCKET SERVER
// ============================================================================

const wss = new WebSocketServer();
const userConnections = new Map(); // userId -> Set of WebSocket connections
const typingIndicators = new Map(); // roomId -> Map of userId -> timeout

wss.on('connection', (ws, req) => {
  console.log('WebSocket connection established');

  ws.userId = null;
  ws.authenticated = false;
  ws.subscribedRooms = new Set();

  ws.on('message', async (data) => {
    try {
      const message = JSON.parse(data);

      // Handle authentication
      if (message.type === 'auth') {
        try {
          const decoded = verifyJWT(message.token);
          const db = getDatabase();
          const tokenHash = hashToken(message.token);

          const session = db.get(
            `SELECT user_id FROM sessions
             WHERE token_hash = ? AND expires_at > datetime('now')`,
            [tokenHash]
          );

          if (session) {
            ws.userId = session.user_id;
            ws.authenticated = true;

            // Track connection
            if (!userConnections.has(ws.userId)) {
              userConnections.set(ws.userId, new Set());
            }
            userConnections.get(ws.userId).add(ws);

            ws.send(JSON.stringify({ type: 'authenticated', userId: ws.userId }));

            // Update user status to online
            userService.updateStatus(ws.userId, 'online');
            wss.broadcast({ type: 'user_status', userId: ws.userId, status: 'online' });
          } else {
            ws.send(JSON.stringify({ type: 'auth_error', error: 'Invalid token' }));
            ws.close();
          }
        } catch (err) {
          ws.send(JSON.stringify({ type: 'auth_error', error: err.message }));
          ws.close();
        }
        return;
      }

      if (!ws.authenticated) {
        ws.send(JSON.stringify({ type: 'error', error: 'Not authenticated' }));
        return;
      }

      // Handle different message types
      switch (message.type) {
        case 'subscribe':
          ws.subscribedRooms.add(message.roomId);
          ws.send(JSON.stringify({ type: 'subscribed', roomId: message.roomId }));
          break;

        case 'unsubscribe':
          ws.subscribedRooms.delete(message.roomId);
          ws.send(JSON.stringify({ type: 'unsubscribed', roomId: message.roomId }));
          break;

        case 'typing':
          handleTyping(ws.userId, message.roomId, message.isTyping);
          break;

        case 'ping':
          ws.send(JSON.stringify({ type: 'pong' }));
          break;
      }
    } catch (err) {
      console.error('WebSocket message error:', err);
      ws.send(JSON.stringify({ type: 'error', error: err.message }));
    }
  });

  ws.on('close', () => {
    if (ws.userId) {
      const connections = userConnections.get(ws.userId);
      if (connections) {
        connections.delete(ws);
        if (connections.size === 0) {
          userConnections.delete(ws.userId);
          // Update user status to offline
          userService.updateStatus(ws.userId, 'offline');
          wss.broadcast({ type: 'user_status', userId: ws.userId, status: 'offline' });
        }
      }
    }
  });
});

function handleTyping(userId, roomId, isTyping) {
  if (!typingIndicators.has(roomId)) {
    typingIndicators.set(roomId, new Map());
  }

  const roomTyping = typingIndicators.get(roomId);

  if (isTyping) {
    // Clear existing timeout
    if (roomTyping.has(userId)) {
      clearTimeout(roomTyping.get(userId));
    }

    // Set new timeout (15 seconds)
    const timeout = setTimeout(() => {
      roomTyping.delete(userId);
      broadcastToRoom(roomId, {
        type: 'typing',
        roomId,
        userId,
        isTyping: false,
      });
    }, 15000);

    roomTyping.set(userId, timeout);

    broadcastToRoom(roomId, {
      type: 'typing',
      roomId,
      userId,
      isTyping: true,
    });
  } else {
    // Stop typing
    if (roomTyping.has(userId)) {
      clearTimeout(roomTyping.get(userId));
      roomTyping.delete(userId);
    }

    broadcastToRoom(roomId, {
      type: 'typing',
      roomId,
      userId,
      isTyping: false,
    });
  }
}

function broadcastToRoom(roomId, message) {
  const db = getDatabase();
  const members = db.all('SELECT user_id FROM room_members WHERE room_id = ?', [roomId]);

  for (const member of members) {
    const connections = userConnections.get(member.user_id);
    if (connections) {
      for (const ws of connections) {
        if (ws.readyState === 1 && ws.subscribedRooms.has(roomId)) {
          ws.send(JSON.stringify(message));
        }
      }
    }
  }
}

// ============================================================================
// START SERVER
// ============================================================================

const server = app.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════════════════════════╗
║  🚀 Zero-Dependency Chat Server                           ║
║                                                            ║
║  Server running on http://localhost:${PORT}                  ║
║  WebSocket available on ws://localhost:${PORT}               ║
║                                                            ║
║  Built with ONLY Node.js core modules:                    ║
║  - node:http (HTTP server)                                ║
║  - node:crypto (auth, JWT, WebSocket)                     ║
║  - node:sqlite (database - built-in!)                     ║
║  - node:fs (static files)                                 ║
║                                                            ║
║  ZERO external dependencies! 🎉                            ║
╚════════════════════════════════════════════════════════════╝
  `);
});

// Handle WebSocket upgrade
server.on('upgrade', (req, socket, head) => {
  if (req.url === '/ws' || req.url === '/') {
    wss.handleUpgrade(req, socket, head);
  } else {
    socket.destroy();
  }
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully...');
  wss.close();
  server.close(() => {
    const db = getDatabase();
    db.close();
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('\nSIGINT received, shutting down gracefully...');
  wss.close();
  server.close(() => {
    const db = getDatabase();
    db.close();
    process.exit(0);
  });
});
