const express = require('express');
const router = express.Router();
const userService = require('../services/userService');
const { asyncHandler } = require('../middleware/errorHandler');
const { loginRateLimit } = require('../middleware/rateLimit');
const { authenticate } = require('../middleware/auth');
const { isValidUsername, isValidPassword, isValidEmail } = require('../utils/validation');
const config = require('../config');

/**
 * POST /api/auth/register
 * Register a new user
 */
router.post(
  '/register',
  asyncHandler(async (req, res) => {
    if (!config.features.enableRegistration) {
      return res.status(403).json({ error: 'Registration is disabled' });
    }

    const { username, email, password, displayName } = req.body;

    // Validation
    if (!username || !isValidUsername(username)) {
      return res.status(400).json({ error: 'Invalid username. Must be 3-20 characters, alphanumeric, dash, or underscore.' });
    }

    if (!password || !isValidPassword(password)) {
      return res.status(400).json({ error: 'Invalid password. Must be at least 6 characters.' });
    }

    if (email && !isValidEmail(email)) {
      return res.status(400).json({ error: 'Invalid email address.' });
    }

    if (config.features.requireEmailVerification && !email) {
      return res.status(400).json({ error: 'Email is required.' });
    }

    const user = await userService.register({
      username,
      email,
      password,
      displayName: displayName || username,
    });

    res.status(201).json({
      success: true,
      user,
      message: 'User registered successfully. Please log in.',
    });
  })
);

/**
 * POST /api/auth/login
 * Login and get JWT token
 */
router.post(
  '/login',
  loginRateLimit,
  asyncHandler(async (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    const result = await userService.login({
      username,
      password,
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
    });

    res.json({
      success: true,
      ...result,
    });
  })
);

/**
 * POST /api/auth/logout
 * Logout and invalidate current session
 */
router.post(
  '/logout',
  authenticate,
  asyncHandler(async (req, res) => {
    await userService.logout(req.session.id);

    res.json({
      success: true,
      message: 'Logged out successfully',
    });
  })
);

/**
 * GET /api/auth/me
 * Get current user info
 */
router.get(
  '/me',
  authenticate,
  asyncHandler(async (req, res) => {
    const user = await userService.getUserById(req.user.id);

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
 * POST /api/auth/change-password
 * Change user password
 */
router.post(
  '/change-password',
  authenticate,
  asyncHandler(async (req, res) => {
    const { oldPassword, newPassword } = req.body;

    if (!oldPassword || !newPassword) {
      return res.status(400).json({ error: 'Old and new passwords are required' });
    }

    if (!isValidPassword(newPassword)) {
      return res.status(400).json({ error: 'New password must be at least 6 characters' });
    }

    await userService.changePassword(req.user.id, oldPassword, newPassword);

    res.json({
      success: true,
      message: 'Password changed successfully',
    });
  })
);

module.exports = router;
