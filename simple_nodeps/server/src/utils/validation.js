/**
 * Validation utilities
 */

/**
 * Validate email format
 */
function isValidEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

/**
 * Validate username (alphanumeric, dash, underscore)
 */
function isValidUsername(username) {
  const usernameRegex = /^[a-zA-Z0-9_-]{3,20}$/;
  return usernameRegex.test(username);
}

/**
 * Validate password strength
 */
function isValidPassword(password) {
  return password && password.length >= 6;
}

/**
 * Sanitize string input
 */
function sanitizeString(str) {
  if (typeof str !== 'string') return '';
  return str.trim().slice(0, 5000); // Max 5000 chars
}

/**
 * Validate room name
 */
function isValidRoomName(name) {
  return name && name.length >= 1 && name.length <= 80;
}

/**
 * Validate UUID format
 */
function isValidUUID(uuid) {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(uuid);
}

/**
 * Validate pagination parameters
 */
function validatePagination(limit, offset) {
  const validLimit = Math.min(Math.max(parseInt(limit) || 50, 1), 100);
  const validOffset = Math.max(parseInt(offset) || 0, 0);
  return { limit: validLimit, offset: validOffset };
}

/**
 * Escape HTML to prevent XSS
 */
function escapeHtml(text) {
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  };
  return text.replace(/[&<>"']/g, (m) => map[m]);
}

/**
 * Parse mentions from message content
 */
function parseMentions(content) {
  const mentions = [];
  const mentionRegex = /@([\w-]+)/g;
  let match;

  while ((match = mentionRegex.exec(content)) !== null) {
    mentions.push(match[1]);
  }

  // Check for @all and @here
  if (/@all\b/.test(content)) mentions.push('all');
  if (/@here\b/.test(content)) mentions.push('here');

  return [...new Set(mentions)]; // Remove duplicates
}

module.exports = {
  isValidEmail,
  isValidUsername,
  isValidPassword,
  sanitizeString,
  isValidRoomName,
  isValidUUID,
  validatePagination,
  escapeHtml,
  parseMentions,
};
