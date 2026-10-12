'use strict';
/**
 * dotMemory.js — HTTP routes for the personal agent's ("dot") own working memory.
 *
 * Mounted at /api/agent/dot (server.js). Ownership mirrors routes/conversations.js:
 * the signed-in subject touches only its own memories. Unauthenticated callers
 * scope to their guest session id, so the studio page works pre-login without
 * one visitor seeing another's memories.
 *
 * Routes:
 *   GET    /memory          list the dot's memories (newest first)
 *   POST   /memory          save one memory { text }
 *   DELETE /memory          reset the dot — clear everything
 */

const express = require('express');
const { createDotMemoryStore, MAX_MEMORY_LENGTH } = require('../services/lmdb/dotMemoryStore.lmdb');

const router = express.Router();

const store = createDotMemoryStore();

// Same resolution rule as agentInvokeRoute's userId, extended to guests:
// signed-in users scope by sub, guests by session id (stable per browser session).
function memoryOwner(req) {
  return req.user?.sub || (req.session?.id ? `guest:${req.session.id}` : null);
}

router.get('/memory', (req, res) => {
  const owner = memoryOwner(req);
  const memories = owner ? store.getMemories(owner) : [];
  return res.json({ memories, count: memories.length });
});

router.post('/memory', (req, res) => {
  const owner = memoryOwner(req);
  if (!owner) {
    return res.status(401).json({ error: 'authentication or session required' });
  }
  const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
  if (!text || text.length > MAX_MEMORY_LENGTH) {
    return res.status(400).json({ error: `text is required and must be at most ${MAX_MEMORY_LENGTH} characters` });
  }
  const saved = store.saveMemory(owner, text);
  if (!saved) {
    return res.status(400).json({ error: `text is required and must be at most ${MAX_MEMORY_LENGTH} characters` });
  }
  return res.json({ saved: true, count: store.getMemories(owner).length });
});

router.delete('/memory', (req, res) => {
  const owner = memoryOwner(req);
  if (owner) store.clearMemories(owner);
  return res.json({ reset: true });
});

module.exports = router;
