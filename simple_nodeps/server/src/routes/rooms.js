const express = require('express');
const router = express.Router();
const roomService = require('../services/roomService');
const messageService = require('../services/messageService');
const { authenticate } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');
const { isValidRoomName, sanitizeString, validatePagination } = require('../utils/validation');
const { broadcastRoomUpdate, broadcastNewMessage } = require('../websocket');

/**
 * GET /api/rooms
 * Get user's rooms
 */
router.get(
  '/',
  authenticate,
  asyncHandler(async (req, res) => {
    const rooms = await roomService.getUserRooms(req.user.id);

    res.json({
      success: true,
      rooms,
      count: rooms.length,
    });
  })
);

/**
 * GET /api/rooms/public
 * Get public channels
 */
router.get(
  '/public',
  authenticate,
  asyncHandler(async (req, res) => {
    const limit = parseInt(req.query.limit) || 50;
    const rooms = await roomService.getPublicChannels(limit);

    res.json({
      success: true,
      rooms,
      count: rooms.length,
    });
  })
);

/**
 * POST /api/rooms
 * Create a new room
 */
router.post(
  '/',
  authenticate,
  asyncHandler(async (req, res) => {
    const { name, type, topic, description } = req.body;

    if (!type || !['channel', 'private'].includes(type)) {
      return res.status(400).json({ error: 'Invalid room type. Must be "channel" or "private".' });
    }

    if (!name || !isValidRoomName(name)) {
      return res.status(400).json({ error: 'Invalid room name. Must be 1-80 characters.' });
    }

    const room = await roomService.createRoom({
      name: sanitizeString(name),
      type,
      topic: topic ? sanitizeString(topic) : null,
      description: description ? sanitizeString(description) : null,
      createdBy: req.user.id,
    });

    res.status(201).json({
      success: true,
      room,
    });
  })
);

/**
 * POST /api/rooms/dm
 * Create or get DM with another user
 */
router.post(
  '/dm',
  authenticate,
  asyncHandler(async (req, res) => {
    const { userId } = req.body;

    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
    }

    if (userId === req.user.id) {
      return res.status(400).json({ error: 'Cannot create DM with yourself' });
    }

    const room = await roomService.createOrGetDM(req.user.id, userId);

    res.json({
      success: true,
      room,
    });
  })
);

/**
 * GET /api/rooms/:id
 * Get room by ID
 */
router.get(
  '/:id',
  authenticate,
  asyncHandler(async (req, res) => {
    const room = await roomService.getRoomById(req.params.id);

    if (!room) {
      return res.status(404).json({ error: 'Room not found' });
    }

    // Check if user is a member (unless it's a public channel)
    if (room.type !== 'channel') {
      const isMember = await roomService.isMember(room.id, req.user.id);
      if (!isMember) {
        return res.status(403).json({ error: 'You are not a member of this room' });
      }
    }

    res.json({
      success: true,
      room,
    });
  })
);

/**
 * PUT /api/rooms/:id
 * Update room
 */
router.put(
  '/:id',
  authenticate,
  asyncHandler(async (req, res) => {
    const roomId = req.params.id;

    // Check if user has permission (owner or moderator)
    const membership = await roomService.getRoomMembers(roomId, 1000);
    const userMembership = membership.find((m) => m.id === req.user.id);

    if (!userMembership || !['owner', 'moderator'].includes(userMembership.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    const updates = {};

    if (req.body.name) {
      updates.name = sanitizeString(req.body.name);
    }

    if (req.body.topic !== undefined) {
      updates.topic = sanitizeString(req.body.topic);
    }

    if (req.body.description !== undefined) {
      updates.description = sanitizeString(req.body.description);
    }

    if (req.body.avatarUrl !== undefined) {
      updates.avatar_url = sanitizeString(req.body.avatarUrl);
    }

    if (req.body.isReadOnly !== undefined) {
      updates.is_read_only = req.body.isReadOnly ? 1 : 0;
    }

    const room = await roomService.updateRoom(roomId, updates);

    // Broadcast room update to all members
    await broadcastRoomUpdate(room);

    res.json({
      success: true,
      room,
    });
  })
);

/**
 * POST /api/rooms/:id/join
 * Join a room
 */
router.post(
  '/:id/join',
  authenticate,
  asyncHandler(async (req, res) => {
    const room = await roomService.joinRoom(req.params.id, req.user.id);

    res.json({
      success: true,
      room,
      message: 'Joined room successfully',
    });
  })
);

/**
 * POST /api/rooms/:id/leave
 * Leave a room
 */
router.post(
  '/:id/leave',
  authenticate,
  asyncHandler(async (req, res) => {
    await roomService.leaveRoom(req.params.id, req.user.id);

    res.json({
      success: true,
      message: 'Left room successfully',
    });
  })
);

/**
 * GET /api/rooms/:id/members
 * Get room members
 */
router.get(
  '/:id/members',
  authenticate,
  asyncHandler(async (req, res) => {
    const roomId = req.params.id;

    // Verify user is a member
    const isMember = await roomService.isMember(roomId, req.user.id);
    if (!isMember) {
      return res.status(403).json({ error: 'You are not a member of this room' });
    }

    const members = await roomService.getRoomMembers(roomId, 1000);

    res.json({
      success: true,
      members,
      count: members.length,
    });
  })
);

/**
 * POST /api/rooms/:id/read
 * Mark room as read
 */
router.post(
  '/:id/read',
  authenticate,
  asyncHandler(async (req, res) => {
    await roomService.markAsRead(req.params.id, req.user.id);

    res.json({
      success: true,
      message: 'Marked as read',
    });
  })
);

/**
 * POST /api/rooms/:id/favorite
 * Toggle room favorite
 */
router.post(
  '/:id/favorite',
  authenticate,
  asyncHandler(async (req, res) => {
    const result = await roomService.toggleFavorite(req.params.id, req.user.id);

    res.json({
      success: true,
      ...result,
    });
  })
);

/**
 * GET /api/rooms/:id/messages
 * Get room messages with pagination
 */
router.get(
  '/:id/messages',
  authenticate,
  asyncHandler(async (req, res) => {
    const roomId = req.params.id;

    // Verify user is a member
    const isMember = await roomService.isMember(roomId, req.user.id);
    if (!isMember) {
      return res.status(403).json({ error: 'You are not a member of this room' });
    }

    const { limit, offset } = validatePagination(req.query.limit, req.query.offset);
    const { before, after } = req.query;

    const messages = await messageService.getRoomMessages(roomId, {
      limit,
      before,
      after,
    });

    res.json({
      success: true,
      messages,
      count: messages.length,
    });
  })
);

/**
 * POST /api/rooms/:id/messages
 * Send a message to a room
 */
router.post(
  '/:id/messages',
  authenticate,
  asyncHandler(async (req, res) => {
    const roomId = req.params.id;
    const { content, replyTo, threadId } = req.body;

    // Verify user is a member
    const isMember = await roomService.isMember(roomId, req.user.id);
    if (!isMember) {
      return res.status(403).json({ error: 'You are not a member of this room' });
    }

    if (!content || content.trim().length === 0) {
      return res.status(400).json({ error: 'Message content is required' });
    }

    // Check if room is read-only
    const room = await roomService.getRoomById(roomId);
    if (room.is_read_only) {
      // Check if user is owner or moderator
      const membership = await roomService.getRoomMembers(roomId, 1000);
      const userMembership = membership.find((m) => m.id === req.user.id);

      if (!userMembership || !['owner', 'moderator'].includes(userMembership.role)) {
        return res.status(403).json({ error: 'Room is read-only' });
      }
    }

    const message = await messageService.createMessage({
      roomId,
      userId: req.user.id,
      content: sanitizeString(content),
      replyTo: replyTo || null,
      threadId: threadId || null,
    });

    // Broadcast to WebSocket clients
    await broadcastNewMessage(message);

    res.status(201).json({
      success: true,
      message,
    });
  })
);

/**
 * DELETE /api/rooms/:id
 * Delete room (owner only)
 */
router.delete(
  '/:id',
  authenticate,
  asyncHandler(async (req, res) => {
    const roomId = req.params.id;

    // Check if user is owner
    const membership = await roomService.getRoomMembers(roomId, 1000);
    const userMembership = membership.find((m) => m.id === req.user.id);

    if (!userMembership || userMembership.role !== 'owner') {
      return res.status(403).json({ error: 'Only room owner can delete the room' });
    }

    await roomService.deleteRoom(roomId);

    res.json({
      success: true,
      message: 'Room deleted successfully',
    });
  })
);

module.exports = router;
