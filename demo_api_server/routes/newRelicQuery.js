'use strict';
/**
 * New Relic read proxy — named queries only.
 *
 * The page this serves is public, which governs what is DISPLAYED. It does not
 * mean the endpoint accepts arbitrary NRQL: an open passthrough would let any
 * caller run expensive queries against the account and read every event type in
 * it. The client sends a window key, never a query.
 */
const express = require('express');
const axios = require('axios');

const router = express.Router();

const NERDGRAPH_ENDPOINT =
  process.env.NR_NERDGRAPH_ENDPOINT || 'https://api.newrelic.com/graphql';

// The only values that ever reach NRQL. A key outside this map is a 400.
const WINDOWS = {
  '30m': { since: '30 minutes ago', bucket: '2 minutes' },
  '1h': { since: '1 hour ago', bucket: '5 minutes' },
  '24h': { since: '24 hours ago', bucket: '1 hour' },
};

const DEFAULT_WINDOW = '1h';

// Anonymous callers hit this route with no rate limiting of their own; a short
// cache keeps repeated page loads/polling from spending upstream NerdGraph
// quota on every request. Key space is the three fixed WINDOWS values, so no
// eviction policy is needed.
const CACHE_TTL_MS = 20000;
const _cache = new Map(); // window -> { at, payload }

function _resetCache() {
  _cache.clear();
}

function _buildQuery(accountId, since, bucket) {
  const funnel =
    `SELECT count(*) FROM Log WHERE logtype='app_event' FACET category SINCE ${since}`;
  const timeseries =
    `SELECT count(*) FROM Log WHERE logtype='app_event' TIMESERIES ${bucket} SINCE ${since}`;
  const stream =
    'SELECT timestamp, message, category, severity, correlationId ' +
    `FROM Log WHERE logtype='app_event' SINCE ${since} LIMIT 50`;

  // JSON.stringify supplies the surrounding quotes and escapes the single
  // quotes inside each NRQL string. accountId is coerced to a number so it can
  // never carry syntax.
  return `{ actor { account(id: ${Number(accountId)}) {
    funnel: nrql(query: ${JSON.stringify(funnel)}) { results }
    timeseries: nrql(query: ${JSON.stringify(timeseries)}) { results }
    stream: nrql(query: ${JSON.stringify(stream)}) { results }
  } } }`;
}

router.get('/pipeline', async (req, res) => {
  const key = process.env.NR_USER_API_KEY;
  const accountId = process.env.NR_ACCOUNT_ID;
  if (!key || !String(accountId || '').trim() || !Number.isFinite(Number(accountId))) {
    return res.status(503).json({ error: 'newrelic_not_configured' });
  }

  const window = String(req.query.window || DEFAULT_WINDOW);
  const spec = WINDOWS[window];
  if (!spec) {
    return res.status(400).json({ error: 'invalid_window' });
  }

  const cached = _cache.get(window);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return res.json(cached.payload);
  }

  try {
    const response = await axios.post(
      NERDGRAPH_ENDPOINT,
      { query: _buildQuery(accountId, spec.since, spec.bucket) },
      {
        headers: { 'Api-Key': key, 'Content-Type': 'application/json' },
        timeout: 10000,
      },
    );

    if (response.data && response.data.errors) {
      console.warn('[newRelicQuery] NerdGraph returned errors:', response.data.errors);
      return res.status(502).json({ error: 'newrelic_query_failed' });
    }

    const account = response.data?.data?.actor?.account || {};
    const payload = {
      window,
      funnel: account.funnel?.results || [],
      timeseries: account.timeseries?.results || [],
      stream: account.stream?.results || [],
    };
    _cache.set(window, { at: Date.now(), payload });
    return res.json(payload);
  } catch (err) {
    // Deliberately not echoed to the client — this endpoint is public and the
    // upstream message can carry hostnames and IPs.
    console.warn('[newRelicQuery] query failed:', err?.message);
    return res.status(502).json({ error: 'newrelic_query_failed' });
  }
});

// Exposed for tests only — resets the module-level response cache between
// specs (see tests/newRelicQuery.test.js).
router._resetCache = _resetCache;

module.exports = router;
