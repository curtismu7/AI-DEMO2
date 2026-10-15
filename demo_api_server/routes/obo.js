'use strict';

// OBO demo: runs the RFC 8693 delegation for the signed-in user and returns evidence only.
// The subject token is read from the BFF session and never returned to the browser.
const express = require('express');
const { runObo } = require('../services/oboExchangeService');

const router = express.Router();

router.post('/run', async (req, res) => {
  const subjectToken = req.session?.oauthTokens?.accessToken;
  if (!subjectToken || subjectToken === '_cookie_session') {
    return res.status(401).json({ error: 'Sign in first. The demo runs on your own session token.' });
  }
  try {
    const evidence = await runObo({ req, subjectToken, source: 'page' });
    return res.json(evidence);
  } catch (err) {
    if (err.code === 'obo_not_configured') {
      return res.status(503).json({ error: 'OBO demo is not configured on this environment.' });
    }
    // Reason only (PingOne's error code/description, HTTP status): never tokens or request bodies.
    console.error('[obo] exchange failed', { error: err.error || err.code || 'unknown', description: err.error_description, status: err.httpStatus });
    return res.status(502).json({ error: 'OBO exchange failed. Check the BFF logs.' });
  }
});

module.exports = router;
