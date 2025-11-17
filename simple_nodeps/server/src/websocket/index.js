const WebSocket = require('ws');
const { verifyJWT, hashToken } = require('../utils/crypto');
const { queryOne, execute } = require('../db');
const { wsRateLimit } = require('../middleware/rateLimit');
const config = require('../config');

// Connected clients: Map<userId, Set<WebSocket>>
const clients = new Map();

// Typing indicators: Map<roomId, Map<userId, timeout>>
const typingIndicators = new Map();

/**
 * Initialize WebSocket server
 */
function initializeWebSocket(server) {
  const wss = new WebSocket.Server({ noServer: true });

  // Handle HTTP upgrade to WebSocket
  server.on('upgrade', (request, socket, head) => {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  });

  // Handle new WebSocket connections
  wss.on('connection', (ws, req) => {
    let userId = null;
    let username = null;
    let authenticated = false;

    // Ping/pong for keep-alive
    ws.isAlive = true;
    ws.on('pong', () => {
      ws.isAlive = true;
    });

    // Handle incoming messages
    ws.on('message', async (data) => {
      try {
        // Rate limiting
        if (!wsRateLimit(ws, 60)) {
          return;
        }

        const message = JSON.parse(data.toString());

        // Authentication message
        if (message.type === 'auth') {
          const result = await handleAuth(ws, message.token);
          if (result) {
            userId = result.userId;
            username = result.username;
            authenticated = true;

            // Add to clients map
            if (!clients.has(userId)) {
              clients.set(userId, new Set());
            }
            clients.get(userId).add(ws);

            // Update user status to online
            await updateUserStatus(userId, 'online');

            // Broadcast presence update
            await broadcastPresenceUpdate(userId, 'online');

            ws.send(JSON.stringify({ type: 'auth', success: true, userId, username }));
          }
          return;
        }

        // Require authentication for other messages
        if (!authenticated) {
          ws.send(JSON.stringify({ type: 'error', error: 'Not authenticated' }));
          return;
        }

        // Handle different message types
        switch (message.type) {
          case 'ping':
            ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
            break;

          case 'typing':
            await handleTyping(message, userId, username);
            break;

          case 'presence':
            await handlePresenceChange(userId, message.status);
            break;

          case 'subscribe_room':
            // Client wants to subscribe to room updates
            ws.subscribedRooms = ws.subscribedRooms || new Set();
            ws.subscribedRooms.add(message.roomId);
            break;

          case 'unsubscribe_room':
            if (ws.subscribedRooms) {
              ws.subscribedRooms.delete(message.roomId);
            }
            break;

          default:
            ws.send(JSON.stringify({ type: 'error', error: 'Unknown message type' }));
        }
      } catch (error) {
        console.error('WebSocket message error:', error);
        ws.send(JSON.stringify({ type: 'error', error: error.message }));
      }
    });

    // Handle connection close
    ws.on('close', async () => {
      if (userId && clients.has(userId)) {
        const userConnections = clients.get(userId);
        userConnections.delete(ws);

        // If no more connections, mark offline
        if (userConnections.size === 0) {
          clients.delete(userId);
          await updateUserStatus(userId, 'offline');
          await broadcastPresenceUpdate(userId, 'offline');
        }
      }

      // Clear typing indicators
      if (userId) {
        clearUserTypingIndicators(userId);
      }
    });

    // Handle errors
    ws.on('error', (error) => {
      console.error('WebSocket error:', error);
    });
  });

  // Ping interval to detect dead connections
  const pingInterval = setInterval(() => {
    wss.clients.forEach((ws) => {
      if (ws.isAlive === false) {
        return ws.terminate();
      }

      ws.isAlive = false;
      ws.ping();
    });
  }, config.websocket.pingInterval);

  wss.on('close', () => {
    clearInterval(pingInterval);
  });

  // Cleanup typing indicators periodically
  setInterval(cleanupTypingIndicators, 5000);

  console.log('✓ WebSocket server initialized');

  return wss;
}

/**
 * Authenticate WebSocket connection
 */
async function handleAuth(ws, token) {
  if (!token) {
    ws.send(JSON.stringify({ type: 'error', error: 'No token provided' }));
    return null;
  }

  try {
    const decoded = verifyJWT(token);
    if (!decoded) {
      ws.send(JSON.stringify({ type: 'error', error: 'Invalid token' }));
      return null;
    }

    // Verify session
    const tokenHash = hashToken(token);
    const session = queryOne(
      `SELECT s.user_id, u.username, u.role
       FROM sessions s
       JOIN users u ON s.user_id = u.id
       WHERE s.token_hash = ? AND s.expires_at > datetime('now') AND u.deleted_at IS NULL`,
      [tokenHash]
    );

    if (!session) {
      ws.send(JSON.stringify({ type: 'error', error: 'Session expired' }));
      return null;
    }

    return {
      userId: session.user_id,
      username: session.username,
      role: session.role,
    };
  } catch (error) {
    console.error('Auth error:', error);
    ws.send(JSON.stringify({ type: 'error', error: 'Authentication failed' }));
    return null;
  }
}

/**
 * Update user status in database
 */
async function updateUserStatus(userId, status) {
  const now = new Date().toISOString();
  execute('UPDATE users SET status = ?, last_seen_at = ?, updated_at = ? WHERE id = ?', [status, now, now, userId]);
}

/**
 * Broadcast presence update to relevant users
 */
async function broadcastPresenceUpdate(userId, status) {
  // Get all rooms the user is in
  const { query } = require('../db');
  const rooms = query('SELECT room_id FROM room_members WHERE user_id = ?', [userId]);

  // Get all users in those rooms
  const userIds = new Set();
  for (const room of rooms) {
    const members = query('SELECT user_id FROM room_members WHERE room_id = ?', [room.room_id]);
    members.forEach((m) => userIds.add(m.user_id));
  }

  // Broadcast to connected clients
  const presenceMessage = JSON.stringify({
    type: 'presence',
    userId,
    status,
    timestamp: Date.now(),
  });

  for (const targetUserId of userIds) {
    if (clients.has(targetUserId)) {
      for (const ws of clients.get(targetUserId)) {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(presenceMessage);
        }
      }
    }
  }
}

/**
 * Handle typing indicator
 */
async function handleTyping(message, userId, username) {
  const { roomId, isTyping } = message;

  if (!roomId) return;

  if (isTyping) {
    // Store typing indicator with timeout
    if (!typingIndicators.has(roomId)) {
      typingIndicators.set(roomId, new Map());
    }

    const roomTyping = typingIndicators.get(roomId);

    // Clear existing timeout
    if (roomTyping.has(userId)) {
      clearTimeout(roomTyping.get(userId).timeout);
    }

    // Set new timeout (15 seconds)
    const timeout = setTimeout(() => {
      roomTyping.delete(userId);
      broadcastToRoom(roomId, {
        type: 'typing',
        roomId,
        userId,
        username,
        isTyping: false,
      }, userId);
    }, 15000);

    roomTyping.set(userId, { username, timeout });

    // Broadcast typing start
    await broadcastToRoom(roomId, {
      type: 'typing',
      roomId,
      userId,
      username,
      isTyping: true,
    }, userId);
  } else {
    // Stop typing
    if (typingIndicators.has(roomId)) {
      const roomTyping = typingIndicators.get(roomId);
      if (roomTyping.has(userId)) {
        clearTimeout(roomTyping.get(userId).timeout);
        roomTyping.delete(userId);
      }
    }

    // Broadcast typing stop
    await broadcastToRoom(roomId, {
      type: 'typing',
      roomId,
      userId,
      username,
      isTyping: false,
    }, userId);
  }
}

/**
 * Handle presence status change
 */
async function handlePresenceChange(userId, status) {
  const validStatuses = ['online', 'away', 'busy', 'offline'];
  if (!validStatuses.includes(status)) return;

  await updateUserStatus(userId, status);
  await broadcastPresenceUpdate(userId, status);
}

/**
 * Clear all typing indicators for a user
 */
function clearUserTypingIndicators(userId) {
  for (const [roomId, roomTyping] of typingIndicators.entries()) {
    if (roomTyping.has(userId)) {
      clearTimeout(roomTyping.get(userId).timeout);
      roomTyping.delete(userId);

      // Broadcast typing stop
      broadcastToRoom(roomId, {
        type: 'typing',
        roomId,
        userId,
        isTyping: false,
      }, userId);
    }
  }
}

/**
 * Cleanup expired typing indicators
 */
function cleanupTypingIndicators() {
  // Typing indicators automatically cleared by timeout
  // This is just to clean empty maps
  for (const [roomId, roomTyping] of typingIndicators.entries()) {
    if (roomTyping.size === 0) {
      typingIndicators.delete(roomId);
    }
  }
}

/**
 * Broadcast message to all members of a room
 */
async function broadcastToRoom(roomId, message, excludeUserId = null) {
  const { query } = require('../db');
  const members = query('SELECT user_id FROM room_members WHERE room_id = ?', [roomId]);

  const messageStr = typeof message === 'string' ? message : JSON.stringify(message);

  for (const member of members) {
    if (member.user_id === excludeUserId) continue;

    if (clients.has(member.user_id)) {
      for (const ws of clients.get(member.user_id)) {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(messageStr);
        }
      }
    }
  }
}

/**
 * Broadcast message to specific user
 */
function broadcastToUser(userId, message) {
  if (clients.has(userId)) {
    const messageStr = typeof message === 'string' ? message : JSON.stringify(message);

    for (const ws of clients.get(userId)) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(messageStr);
      }
    }
  }
}

/**
 * Broadcast new message to room
 */
async function broadcastNewMessage(message) {
  await broadcastToRoom(message.room_id, {
    type: 'message',
    message,
  });
}

/**
 * Broadcast message update
 */
async function broadcastMessageUpdate(message) {
  await broadcastToRoom(message.room_id, {
    type: 'message_update',
    message,
  });
}

/**
 * Broadcast message deletion
 */
async function broadcastMessageDeletion(roomId, messageId) {
  await broadcastToRoom(roomId, {
    type: 'message_delete',
    messageId,
    roomId,
  });
}

/**
 * Broadcast room update
 */
async function broadcastRoomUpdate(room) {
  await broadcastToRoom(room.id, {
    type: 'room_update',
    room,
  });
}

/**
 * Get connected users count
 */
function getConnectedUsersCount() {
  return clients.size;
}

/**
 * Get user connection status
 */
function isUserConnected(userId) {
  return clients.has(userId) && clients.get(userId).size > 0;
}

module.exports = {
  initializeWebSocket,
  broadcastToRoom,
  broadcastToUser,
  broadcastNewMessage,
  broadcastMessageUpdate,
  broadcastMessageDeletion,
  broadcastRoomUpdate,
  getConnectedUsersCount,
  isUserConnected,
};
