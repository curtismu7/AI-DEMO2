'use strict';
const express = require('express');
const router = express.Router();
const { currentFlags, selectChecks, runChecks, aggregateVerdict } = require('../services/checkService');

router.get('/catalog', (_req, res) => {
  require('../services/checks'); // populate the registry
  const flags = currentFlags();
  const checks = selectChecks(flags, { includeHeavy: true })
    .map((c) => ({
      id: c.id, name: c.name, category: c.category, heavy: !!c.heavy,
      severity: c.severity || 'blocking',
    }));
  res.json({ flags, checks });
});

router.post('/run', async (req, res) => {
  require('../services/checks'); // populate the registry
  const { only, includeHeavy = false } = req.body || {};
  const flags = currentFlags();
  let checks = selectChecks(flags, { includeHeavy });
  if (Array.isArray(only) && only.length) {
    const want = new Set(only);
    checks = checks.filter((c) => want.has(c.id) || want.has(c.category));
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  const results = await runChecks(checks, { flags, req }, (r) => send('result', r));
  send('done', { verdict: aggregateVerdict(results), total: results.length });
  res.end();
});

module.exports = { router };
