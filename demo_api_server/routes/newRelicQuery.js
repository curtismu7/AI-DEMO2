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
// Buckets are per-window: a fixed 5-minute bucket over 7 days would return
// 2016 points and swamp the sparkline.
const WINDOWS = {
  '30m': { since: '30 minutes ago', bucket: '2 minutes' },
  '1h': { since: '1 hour ago', bucket: '5 minutes' },
  '24h': { since: '24 hours ago', bucket: '1 hour' },
  '7d': { since: '7 days ago', bucket: '6 hours' },
  '14d': { since: '14 days ago', bucket: '12 hours' },
};

const DEFAULT_WINDOW = '1h';

// Anonymous callers hit this route with no rate limiting of their own; a short
// cache keeps repeated page loads/polling from spending upstream NerdGraph
// quota on every request. Key space is view x window, both fixed maps, so no
// eviction policy is needed.
const CACHE_TTL_MS = 20000;
const _cache = new Map(); // `${view}:${window}` -> { at, payload }

function _resetCache() {
  _cache.clear();
}

function _pipelineQuery(accountId, since, bucket) {
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

function _authorizeQuery(accountId, since, bucket) {
  const decisions =
    `SELECT count(*) FROM Log WHERE logtype='app_event' AND category='authorize' AND decision IS NOT NULL FACET decision SINCE ${since}`;
  const posture =
    `SELECT count(*) FROM Log WHERE logtype='app_event' AND category='authorize' FACET tag SINCE ${since}`;
  // Which policy fired. NRQL omits rows for records missing an attribute
  // entirely rather than emitting a null facet bucket, so records without
  // ruleName (pre-Task-2, or any non-decision branch) simply don't appear
  // here — this returns attributed decisions only. The client derives the
  // "unattributed" remainder from the decisions total minus this sum.
  const rules =
    `SELECT count(*) FROM Log WHERE logtype='app_event' AND category='authorize' AND decision IS NOT NULL FACET ruleName SINCE ${since} LIMIT 10`;
  const timeseries =
    `SELECT count(*) FROM Log WHERE logtype='app_event' AND category='authorize' AND decision IS NOT NULL TIMESERIES ${bucket} SINCE ${since}`;
  const stream =
    'SELECT timestamp, tag, decision, ruleName, amount, stepUpRequired, type, engine, latencyMs, policyEvalMs ' +
    `FROM Log WHERE logtype='app_event' AND category='authorize' AND decision IS NOT NULL SINCE ${since} LIMIT 50`;

  return `{ actor { account(id: ${Number(accountId)}) {
    decisions: nrql(query: ${JSON.stringify(decisions)}) { results }
    posture: nrql(query: ${JSON.stringify(posture)}) { results }
    rules: nrql(query: ${JSON.stringify(rules)}) { results }
    timeseries: nrql(query: ${JSON.stringify(timeseries)}) { results }
    stream: nrql(query: ${JSON.stringify(stream)}) { results }
  } } }`;
}

// Named query sets. The client sends a VIEW KEY, never a query — an open
// passthrough would let any caller run arbitrary NRQL against the account.
const VIEWS = {
  pipeline: {
    build: _pipelineQuery,
    map: (a) => ({
      funnel: a.funnel?.results || [],
      timeseries: a.timeseries?.results || [],
      stream: a.stream?.results || [],
    }),
  },
  authorize: {
    build: _authorizeQuery,
    map: (a) => ({
      decisions: a.decisions?.results || [],
      posture: a.posture?.results || [],
      rules: a.rules?.results || [],
      timeseries: a.timeseries?.results || [],
      stream: a.stream?.results || [],
    }),
  },
};

async function _handleView(viewName, req, res) {
  const key = process.env.NR_USER_API_KEY;
  const accountId = process.env.NR_ACCOUNT_ID;
  if (!key || !String(accountId || '').trim() || !Number.isFinite(Number(accountId))) {
    return res.status(503).json({ error: 'newrelic_not_configured' });
  }

  // VIEWS is a plain object literal, so a bare VIEWS[viewName] lookup resolves
  // inherited names ('__proto__', 'constructor', 'toString', ...) through the
  // prototype chain as truthy. Object.hasOwn restricts the lookup to VIEWS'
  // own keys so those names correctly 400 as invalid_view.
  const view = Object.hasOwn(VIEWS, viewName) ? VIEWS[viewName] : undefined;
  if (!view) {
    return res.status(400).json({ error: 'invalid_view' });
  }

  const window = String(req.query.window || DEFAULT_WINDOW);
  const spec = WINDOWS[window];
  if (!spec) {
    return res.status(400).json({ error: 'invalid_window' });
  }

  // Cache key includes the view — otherwise an authorize request inside the TTL
  // would be served the pipeline payload.
  const cacheKey = `${viewName}:${window}`;
  const cached = _cache.get(cacheKey);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return res.json(cached.payload);
  }

  try {
    const response = await axios.post(
      NERDGRAPH_ENDPOINT,
      { query: view.build(accountId, spec.since, spec.bucket) },
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
    const payload = { view: viewName, window, ...view.map(account) };
    _cache.set(cacheKey, { at: Date.now(), payload });
    return res.json(payload);
  } catch (err) {
    // Deliberately not echoed to the client — this endpoint is public and the
    // upstream message can carry hostnames and IPs.
    console.warn('[newRelicQuery] query failed:', err?.message);
    return res.status(502).json({ error: 'newrelic_query_failed' });
  }
}

router.get('/view/:view', (req, res) => _handleView(String(req.params.view), req, res));

// Alias kept so anything already calling /pipeline keeps working.
router.get('/pipeline', (req, res) => _handleView('pipeline', req, res));

// Exposed for tests only — resets the module-level response cache between
// specs (see tests/newRelicQuery.test.js).
router._resetCache = _resetCache;

module.exports = router;
