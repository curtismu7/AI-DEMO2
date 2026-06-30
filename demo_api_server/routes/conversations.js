'use strict';
/**
 * conversations.js — HTTP routes for conversation history (for multi-process agents).
 *
 * The Python agent and other separate processes call these endpoints to load/save
 * conversation history since they can't access the LMDB file directly.
 *
 * Routes:
 *   GET  /:userId/:vertical/history?limit=30
 *   POST /:userId/:vertical/messages
 */

const express = require('express');
const conversationStore = require('../services/lmdb/conversationStore.lmdb');

const router = express.Router();

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

  try {
    for (const msg of messages) {
      if (!msg.role || !msg.content) {
        return res.status(400).json({ error: 'each message must have role and content' });
      }
      conversationStore.saveMessage(userId, vertical, msg.role, msg.content, msg.metadata || {});
    }
    const threadSize = conversationStore.getThreadSize(userId, vertical);
    return res.json({ saved: messages.length, threadSize });
  } catch (err) {
    console.error('[conversations.POST] Error saving messages:', err.message);
    return res.status(500).json({ error: err.message });
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
