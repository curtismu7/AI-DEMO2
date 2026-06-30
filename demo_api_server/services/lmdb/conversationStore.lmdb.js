'use strict';
/**
 * conversationStore.lmdb.js — LMDB-backed conversation history persistence.
 *
 * Stores multi-turn conversation messages per user+vertical thread:
 *   - Key: `${userId}:${vertical}:${timestamp_15digit_padded}:${seq}`
 *   - Value: { role, content, timestamp, runId, intent, agentPath }
 *
 * Thread model: one thread per userId:vertical combination. Conversations are
 * independent per vertical (banking, wealth, admin, etc.).
 *
 * Write: messages are appended with auto-pruning when thread exceeds 500 messages.
 * Read: reverse-range prefix scan retrieves the last N messages in chronological order.
 */

const { getDb } = require('./openEnv');

const DB_NAME = 'conversations';
const MAX_MESSAGES_PER_THREAD = 500;
const DEFAULT_HISTORY_LIMIT = 30;

function _db() {
  return getDb(DB_NAME);
}

/**
 * Generate a zero-padded 15-digit timestamp for lexicographic ordering.
 * Ensures: lexicographic order = chronological order.
 * @param {number} timestamp - milliseconds since epoch (Date.now())
 * @returns {string} - zero-padded timestamp, e.g., "000001751234567890"
 */
function _padTimestamp(timestamp) {
  return String(timestamp).padStart(15, '0');
}

/**
 * Save a message to the conversation thread.
 * @param {string} userId - user identifier
 * @param {string} vertical - vertical/context (e.g., 'banking', 'wealth', 'admin')
 * @param {string} role - 'user' or 'assistant'
 * @param {string} content - message text
 * @param {object} metadata - optional { runId, intent, agentPath, ... }
 */
function saveMessage(userId, vertical, role, content, metadata = {}) {
  if (!userId || !vertical) {
    throw new Error('userId and vertical are required');
  }

  const db = _db();
  const now = Date.now();
  const timestampPadded = _padTimestamp(now);
  const prefix = `${userId}:${vertical}:`;

  // Find the next sequence number for this timestamp
  // (allow multiple messages in the same millisecond)
  let seq = 0;
  const keyPrefix = `${prefix}${timestampPadded}:`;
  for (const { key } of db.getRange({
    start: keyPrefix,
    end: `${keyPrefix}￿`,
  })) {
    const parts = key.split(':');
    const keySeq = parseInt(parts[4] || '0', 10);
    if (keySeq >= seq) seq = keySeq + 1;
  }

  const key = `${prefix}${timestampPadded}:${seq}`;
  const value = {
    role,
    content,
    timestamp: now,
    ...metadata,
  };

  db.putSync(key, value);

  // Prune if thread exceeds MAX_MESSAGES_PER_THREAD
  _pruneThreadIfNeeded(userId, vertical, prefix);
}

/**
 * Prune the oldest messages from a thread if it exceeds MAX_MESSAGES_PER_THREAD.
 * @private
 */
function _pruneThreadIfNeeded(userId, vertical, prefix) {
  const db = _db();
  const messages = [];

  for (const { key, value } of db.getRange({
    start: prefix,
    end: `${prefix}￿`,
  })) {
    messages.push({ key, timestamp: value.timestamp || 0 });
  }

  if (messages.length > MAX_MESSAGES_PER_THREAD) {
    // Sort by timestamp and delete the oldest
    const toDelete = messages
      .sort((a, b) => a.timestamp - b.timestamp)
      .slice(0, messages.length - MAX_MESSAGES_PER_THREAD);

    for (const { key } of toDelete) {
      db.deleteSync(key);
    }
  }
}

/**
 * Retrieve the last N messages from a conversation thread in chronological order.
 * @param {string} userId - user identifier
 * @param {string} vertical - vertical/context
 * @param {number} limit - max messages to return (default: 30)
 * @returns {array} - array of { role, content, timestamp, ... }, oldest first
 */
function getHistory(userId, vertical, limit = DEFAULT_HISTORY_LIMIT) {
  if (!userId || !vertical) {
    return [];
  }

  const db = _db();
  const prefix = `${userId}:${vertical}:`;
  const messages = [];

  // Reverse-range scan to get the newest messages first
  for (const { key, value } of db.getRange({
    start: `${prefix}￿`,
    end: prefix,
    reverse: true,
    limit,
  })) {
    if (value) messages.push(value);
  }

  // Reverse back to chronological order (oldest first)
  return messages.reverse();
}

/**
 * Clear all messages for a thread (for testing/reset).
 * @param {string} userId - user identifier
 * @param {string} vertical - vertical/context
 */
function clearHistory(userId, vertical) {
  if (!userId || !vertical) return;

  const db = _db();
  const prefix = `${userId}:${vertical}:`;

  for (const { key } of db.getRange({
    start: prefix,
    end: `${prefix}￿`,
  })) {
    db.deleteSync(key);
  }
}

/**
 * Get the full thread size (for diagnostics).
 * @param {string} userId - user identifier
 * @param {string} vertical - vertical/context
 * @returns {number} - count of messages in thread
 */
function getThreadSize(userId, vertical) {
  if (!userId || !vertical) return 0;

  const db = _db();
  const prefix = `${userId}:${vertical}:`;
  let count = 0;

  for (const _ of db.getRange({
    start: prefix,
    end: `${prefix}￿`,
  })) {
    count++;
  }

  return count;
}

module.exports = {
  saveMessage,
  getHistory,
  clearHistory,
  getThreadSize,
  DEFAULT_HISTORY_LIMIT,
  MAX_MESSAGES_PER_THREAD,
};