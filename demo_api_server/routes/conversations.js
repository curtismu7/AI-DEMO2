'use strict';
/**
 * conversations.js — HTTP routes for conversation history (for multi-process agents).
 *
 * Separate agent processes can load/save conversation history here since they
 * can't access the LMDB file directly. The mount applies `authenticateToken`
 * (see server.js), and every route is scoped to the authenticated subject: a
 * caller may only touch its own :userId thread (admin tokens may touch any).
 * Stored messages are replayed verbatim into the LLM, so the write path also
 * restricts role to a fixed allowlist and bounds content size to keep a poisoned
 * history entry from injecting instructions into the agent.
 *
 * Routes:
 *   GET    /:userId/:vertical/history?limit=30
 *   POST   /:userId/:vertical/messages
 *   DELETE /:userId/:vertical/history
 */

const express = require('express');
const conversationStore = require('../services/lmdb/conversationStore.lmdb');

const router = express.Router();

// Roles a stored message may carry. `system` is deliberately excluded — accepting
// it would let a writer plant a system directive that the agent replays as its own.
const ALLOWED_ROLES = new Set(['user', 'assistant']);
const MAX_CONTENT_CHARS = 8000;

// Ownership guard: fires for every route that carries :userId. The authenticated
// subject may only access its own threads; admin tokens may access any.
router.param('userId', (req, res, next, userId) => {
  const sub = req.user && req.user.sub;
  const isAdmin = req.user && req.user.role === 'admin';
  if (!sub) {
    return res.status(401).json({ error: 'authentication required' });
  }
  if (!isAdmin && userId !== sub) {
    return res.status(403).json({ error: "forbidden: cannot access another user's conversation history" });
  }
  next();
});

/**
 * GET /:userId/:vertical/history?limit=30
 * Retrieve conversation history for a user+vertical thread.
 */
router.get('/:userId/:vertical/history', (req, res) => {
  const { userId, vertical } = req.params;
  const limit = parseInt(req.query.limit || conversationStore.DEFAULT_HISTORY_LIMIT, 10);

  if (!userId || !vertical) {
    return res.status(400).json({ error: 'userId and vertical are required' });
  }

  const history = conversationStore.getHistory(userId, vertical, Math.min(limit, 100));
  return res.json({ messages: history, count: history.length });
});

/**
 * POST /:userId/:vertical/messages
 * Save one or more messages to the conversation thread.
 * Body: { messages: [ { role: 'user' | 'assistant', content: '...', metadata?: {...} } ] }
 */
router.post('/:userId/:vertical/messages', express.json(), (req, res) => {
  const { userId, vertical } = req.params;
  const { messages } = req.body;

  if (!userId || !vertical) {
    return res.status(400).json({ error: 'userId and vertical are required' });
  }

  if (!Array.isArray(messages)) {
    return res.status(400).json({ error: 'messages must be an array' });
  }

  for (const msg of messages) {
    if (!msg || typeof msg.role !== 'string' || typeof msg.content !== 'string' || !msg.content.trim()) {
      return res.status(400).json({ error: 'each message must have a string role and non-empty string content' });
    }
    if (!ALLOWED_ROLES.has(msg.role)) {
      return res.status(400).json({ error: `role must be one of: ${[...ALLOWED_ROLES].join(', ')}` });
    }
    if (msg.content.length > MAX_CONTENT_CHARS) {
      return res.status(413).json({ error: `content exceeds ${MAX_CONTENT_CHARS} characters` });
    }
  }

  try {
    for (const msg of messages) {
      conversationStore.saveMessage(userId, vertical, msg.role, msg.content, msg.metadata || {});
    }
    const threadSize = conversationStore.getThreadSize(userId, vertical);
    return res.json({ saved: messages.length, threadSize });
  } catch (err) {
    console.error('[conversations.POST] Error saving messages:', err.message);
    return res.status(500).json({ error: 'failed to save messages' });
  }
});

/**
 * DELETE /:userId/:vertical/history
 * Clear all messages in a thread (for testing/reset).
 */
router.delete('/:userId/:vertical/history', (req, res) => {
  const { userId, vertical } = req.params;

  if (!userId || !vertical) {
    return res.status(400).json({ error: 'userId and vertical are required' });
  }

  conversationStore.clearHistory(userId, vertical);
  return res.json({ cleared: true });
});

module.exports = router;
