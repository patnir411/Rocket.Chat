const express = require('express');
const router = express.Router();
const messageService = require('../services/messageService');
const roomService = require('../services/roomService');
const { authenticate } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');
const { sanitizeString, validatePagination } = require('../utils/validation');
const { broadcastMessageUpdate, broadcastMessageDeletion } = require('../websocket');

/**
 * GET /api/messages/:id
 * Get message by ID
 */
router.get(
  '/:id',
  authenticate,
  asyncHandler(async (req, res) => {
    const message = await messageService.getMessageById(req.params.id);

    if (!message) {
      return res.status(404).json({ error: 'Message not found' });
    }

    // Verify user has access to the room
    const isMember = await roomService.isMember(message.room_id, req.user.id);
    if (!isMember) {
      return res.status(403).json({ error: 'Access denied' });
    }

    res.json({
      success: true,
      message,
    });
  })
);

/**
 * PUT /api/messages/:id
 * Update message
 */
router.put(
  '/:id',
  authenticate,
  asyncHandler(async (req, res) => {
    const { content } = req.body;

    if (!content || content.trim().length === 0) {
      return res.status(400).json({ error: 'Message content is required' });
    }

    const message = await messageService.updateMessage(req.params.id, req.user.id, sanitizeString(content));

    // Broadcast update to WebSocket clients
    await broadcastMessageUpdate(message);

    res.json({
      success: true,
      message,
    });
  })
);

/**
 * DELETE /api/messages/:id
 * Delete message
 */
router.delete(
  '/:id',
  authenticate,
  asyncHandler(async (req, res) => {
    const message = await messageService.getMessageById(req.params.id);

    if (!message) {
      return res.status(404).json({ error: 'Message not found' });
    }

    const isAdmin = req.user.role === 'admin';
    await messageService.deleteMessage(req.params.id, req.user.id, isAdmin);

    // Broadcast deletion to WebSocket clients
    await broadcastMessageDeletion(message.room_id, req.params.id);

    res.json({
      success: true,
      message: 'Message deleted successfully',
    });
  })
);

/**
 * POST /api/messages/:id/react
 * Add reaction to message
 */
router.post(
  '/:id/react',
  authenticate,
  asyncHandler(async (req, res) => {
    const { emoji } = req.body;

    if (!emoji) {
      return res.status(400).json({ error: 'Emoji is required' });
    }

    const message = await messageService.addReaction(req.params.id, req.user.id, emoji);

    // Broadcast update to WebSocket clients
    await broadcastMessageUpdate(message);

    res.json({
      success: true,
      message,
    });
  })
);

/**
 * DELETE /api/messages/:id/react/:emoji
 * Remove reaction from message
 */
router.delete(
  '/:id/react/:emoji',
  authenticate,
  asyncHandler(async (req, res) => {
    const message = await messageService.removeReaction(req.params.id, req.user.id, req.params.emoji);

    // Broadcast update to WebSocket clients
    await broadcastMessageUpdate(message);

    res.json({
      success: true,
      message,
    });
  })
);

/**
 * GET /api/messages/search
 * Search messages
 */
router.get(
  '/search',
  authenticate,
  asyncHandler(async (req, res) => {
    const { q, roomId, limit } = req.query;

    if (!q) {
      return res.status(400).json({ error: 'Search query (q) is required' });
    }

    const messages = await messageService.searchMessages(req.user.id, q, {
      roomId: roomId || null,
      limit: parseInt(limit) || 50,
    });

    res.json({
      success: true,
      messages,
      count: messages.length,
    });
  })
);

/**
 * GET /api/messages/:id/thread
 * Get thread messages
 */
router.get(
  '/:id/thread',
  authenticate,
  asyncHandler(async (req, res) => {
    const threadId = req.params.id;

    // Verify message exists and user has access
    const rootMessage = await messageService.getMessageById(threadId);
    if (!rootMessage) {
      return res.status(404).json({ error: 'Thread not found' });
    }

    const isMember = await roomService.isMember(rootMessage.room_id, req.user.id);
    if (!isMember) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const messages = await messageService.getThreadMessages(threadId, 100);

    res.json({
      success: true,
      rootMessage,
      messages,
      count: messages.length,
    });
  })
);

/**
 * GET /api/messages/mentions
 * Get user's mentioned messages
 */
router.get(
  '/mentions',
  authenticate,
  asyncHandler(async (req, res) => {
    const { limit, unreadOnly } = req.query;

    const messages = await messageService.getUserMentions(req.user.id, {
      limit: parseInt(limit) || 50,
      unreadOnly: unreadOnly === 'true',
    });

    res.json({
      success: true,
      messages,
      count: messages.length,
    });
  })
);

module.exports = router;
