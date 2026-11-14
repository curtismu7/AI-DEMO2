'use strict';

/**
 * Poppy protocol inspector feed (Company side) — admin-only read access to what
 * the Poppy API received from Personal Agents and what the Company made of each
 * request. Read-only: no mutations, no credentials (tokens are fingerprints).
 *
 *   GET /api/admin/poppy/inspect              newest-first feed
 *   GET /api/admin/poppy/inspect/:id          one entry with full detail
 *   GET /api/admin/poppy/inspect/agents       distinct agents seen
 *   DELETE /api/admin/poppy/inspect           clear the feed (operator reset)
 */

const express = require('express');
const { shared: defaultShared } = require('../services/poppyInspectionService');

function createPoppyInspectorRouter({ shared = defaultShared } = {}) {
  const router = express.Router();

  router.get('/inspect', (req, res) => {
    const agent = typeof req.query.agent === 'string' ? req.query.agent : undefined;
    return res.json({
      count: shared.feed({ agent }).length,
      entries: shared.feed({ agent }),
    });
  });

  router.get('/inspect/agents', (_req, res) => res.json({ agents: shared.agents() }));

  router.get('/inspect/:id', (req, res) => {
    const entry = shared.get(req.params.id);
    if (!entry) return res.status(404).json({ error: 'not_found' });
    return res.json(entry);
  });

  router.delete('/inspect', (_req, res) => {
    shared.clear();
    return res.json({ ok: true });
  });

  return router;
}

module.exports = createPoppyInspectorRouter;
