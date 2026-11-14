'use strict';

/**
 * Poppy protocol inspector, PUBLIC projection: what Personal Agents sent to the
 * Company's Poppy API and what the Company made of each request, with identity
 * removed (user IDs, session IDs — spec 5.1: User IDs are pseudonymous and are
 * not the Company's to publish). Signed-in admins get the full feed at
 * /api/admin/poppy/inspect instead; this route exists so anyone can watch the
 * protocol work, the way the Company's own demo pages are public.
 *
 * Read-only, bounded, no credentials (tokens are fingerprints even here).
 *
 *   GET /api/poppy/inspector        newest-first redacted feed
 *   GET /api/poppy/inspector/:id    one redacted entry
 */

const express = require('express');
const { shared: defaultShared, redactEntry } = require('../services/poppyInspectionService');

function createPoppyPublicInspectorRouter({ shared = defaultShared } = {}) {
  const router = express.Router();

  router.get('/inspector', (req, res) => {
    const agent = typeof req.query.agent === 'string' ? req.query.agent : undefined;
    const entries = shared.feed({ agent }).map(redactEntry);
    return res.json({ count: entries.length, entries });
  });

  router.get('/inspector/:id', (req, res) => {
    const entry = shared.get(req.params.id);
    if (!entry) return res.status(404).json({ error: 'not_found' });
    return res.json(redactEntry(entry));
  });

  return router;
}

module.exports = createPoppyPublicInspectorRouter;
