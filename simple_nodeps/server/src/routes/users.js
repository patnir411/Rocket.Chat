const express = require('express');
const router = express.Router();
const userService = require('../services/userService');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');
const { sanitizeString } = require('../utils/validation');

/**
 * GET /api/users/:id
 * Get user by ID
 */
router.get(
  '/:id',
  authenticate,
  asyncHandler(async (req, res) => {
    const user = await userService.getUserById(req.params.id);

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({
      success: true,
      user,
    });
  })
);

/**
 * PUT /api/users/me
 * Update current user profile
 */
router.put(
  '/me',
  authenticate,
  asyncHandler(async (req, res) => {
    const updates = {};

    if (req.body.displayName) {
      updates.display_name = sanitizeString(req.body.displayName);
    }

    if (req.body.email) {
      updates.email = sanitizeString(req.body.email);
    }

    if (req.body.statusText !== undefined) {
      updates.status_text = sanitizeString(req.body.statusText);
    }

    if (req.body.avatarUrl) {
      updates.avatar_url = sanitizeString(req.body.avatarUrl);
    }

    const user = await userService.updateProfile(req.user.id, updates);

    res.json({
      success: true,
      user,
    });
  })
);

/**
 * PUT /api/users/me/status
 * Update user status (online, away, busy, offline)
 */
router.put(
  '/me/status',
  authenticate,
  asyncHandler(async (req, res) => {
    const { status } = req.body;

    if (!status) {
      return res.status(400).json({ error: 'Status is required' });
    }

    const result = await userService.updateStatus(req.user.id, status);

    res.json({
      success: true,
      ...result,
    });
  })
);

/**
 * GET /api/users/search
 * Search users by username or display name
 */
router.get(
  '/search',
  authenticate,
  asyncHandler(async (req, res) => {
    const { q, limit } = req.query;

    if (!q) {
      return res.status(400).json({ error: 'Search query (q) is required' });
    }

    const users = await userService.searchUsers(q, parseInt(limit) || 20);

    res.json({
      success: true,
      users,
      count: users.length,
    });
  })
);

/**
 * DELETE /api/users/:id
 * Delete user (admin only)
 */
router.delete(
  '/:id',
  authenticate,
  requireAdmin,
  asyncHandler(async (req, res) => {
    await userService.deleteUser(req.params.id);

    res.json({
      success: true,
      message: 'User deleted successfully',
    });
  })
);

module.exports = router;
