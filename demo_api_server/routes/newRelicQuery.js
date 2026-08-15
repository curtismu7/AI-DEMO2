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

// A free-text search term is the first caller-controlled VALUE (as opposed to
// a fixed-map key) to reach query construction. It is bounded so a caller
// can't push an arbitrarily large string upstream. It never widens what data
// is reachable — the stream query it's added to already scopes the view
// (e.g. category='authorize'); a search can only narrow that result set
// further, never remove or loosen an existing WHERE condition.
const MAX_SEARCH_LEN = 200;

// NRQL string literals are single-quoted; a raw apostrophe in the term would
// close the literal early and turn the rest of the term into NRQL syntax.
// Escape backslashes first (so an escaping backslash inserted below can't
// itself be mistaken for an already-escaped one), then the quote.
function _escapeNrqlLiteral(raw) {
  return raw.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

// NRQL's LIKE takes '%' as a wildcard (confirmed against the live account),
// and offers no ESCAPE clause to neutralize a literal '%' in caller input —
// one was tried against the live account and NerdGraph rejected it outright
// ("NRQL Syntax Error: ... unexpected 'ESCAPE'"). NRQL's position()/
// substring() functions were also tried as a wildcard-free alternative, live
// — they parse but evaluate to null/never match against Log data in this
// account, so they're not a working substitute either. '_' was tested too:
// live evidence shows NRQL's LIKE does NOT treat it as a single-char
// wildcard (undocumented, and it didn't behave like one), but it's stripped
// anyway since the alternative — leaving it in on the strength of one
// account's observed behavior — is exactly the kind of unverified guess this
// function exists to avoid. The honest fix, given no working escape/literal-
// match construct exists: strip both metacharacters from the term before it
// reaches LIKE. A caller can no longer search for a literal '%' or '_', but
// one typed incidentally can no longer silently widen into a wildcard match.
function _stripLikeMetacharacters(raw) {
  return raw.replace(/[%_]/g, '');
}

// Applied to the stream query only — a search narrows the event list, it
// does not rewrite the facet/timeseries summary panels above it. `fields` is
// an array so a view can search every column its own stream table actually
// renders (OR'd together) rather than one column blind to what's on screen.
function _likeClause(fields, search) {
  if (!search) return '';
  const literal = _escapeNrqlLiteral(search);
  const comparisons = fields.map((f) => `${f} LIKE '%${literal}%'`).join(' OR ');
  return ` AND (${comparisons})`;
}

// Anonymous callers hit this route with no rate limiting of their own; a short
// cache keeps repeated page loads/polling from spending upstream NerdGraph
// quota on every request. Key space is view x window x search term — search
// is a bounded, escaped string, so it's safe to fold into the key as-is.
const CACHE_TTL_MS = 20000;
const _cache = new Map(); // `${view}:${window}:${search}` -> { at, payload }

function _resetCache() {
  _cache.clear();
}

function _pipelineQuery(accountId, since, bucket, search) {
  const funnel =
    `SELECT count(*) FROM Log WHERE logtype='app_event' FACET category SINCE ${since}`;
  const timeseries =
    `SELECT count(*) FROM Log WHERE logtype='app_event' TIMESERIES ${bucket} SINCE ${since}`;
  // Searches `message` — the only stream column this view's table renders
  // as free text (the rest are enums/ids/numbers already visible verbatim).
  const stream =
    'SELECT timestamp, message, category, severity, correlationId ' +
    `FROM Log WHERE logtype='app_event'${_likeClause(['message'], search)} SINCE ${since} LIMIT 50`;

  // JSON.stringify supplies the surrounding quotes and escapes the single
  // quotes inside each NRQL string. accountId is coerced to a number so it can
  // never carry syntax.
  return `{ actor { account(id: ${Number(accountId)}) {
    funnel: nrql(query: ${JSON.stringify(funnel)}) { results }
    timeseries: nrql(query: ${JSON.stringify(timeseries)}) { results }
    stream: nrql(query: ${JSON.stringify(stream)}) { results }
  } } }`;
}

function _authorizeQuery(accountId, since, bucket, search) {
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
  // Searches ruleName/decision/type — the free-text-ish columns this view's
  // table actually renders (not `message`, which the table never displays;
  // a match against a hidden field wouldn't be explainable from the row).
  const stream =
    'SELECT timestamp, tag, decision, ruleName, amount, stepUpRequired, type, engine, latencyMs, policyEvalMs ' +
    `FROM Log WHERE logtype='app_event' AND category='authorize' AND decision IS NOT NULL${_likeClause(['ruleName', 'decision', 'type'], search)} SINCE ${since} LIMIT 50`;

  return `{ actor { account(id: ${Number(accountId)}) {
    decisions: nrql(query: ${JSON.stringify(decisions)}) { results }
    posture: nrql(query: ${JSON.stringify(posture)}) { results }
    rules: nrql(query: ${JSON.stringify(rules)}) { results }
    timeseries: nrql(query: ${JSON.stringify(timeseries)}) { results }
    stream: nrql(query: ${JSON.stringify(stream)}) { results }
  } } }`;
}

// category='token_exchange' also holds token_chain/fetched and
// oauth/user/callback rows — unrelated events sharing the category (measured
// live: 77 of 93 category='token_exchange' rows are that noise). The tag
// namespace is exchange-specific, so every sub-query below filters on
// `tag LIKE 'token-exchange/%'` instead of category — never category alone.
function _tokenExchangeQuery(accountId, since, bucket, search) {
  const base = "logtype='app_event' AND tag LIKE 'token-exchange/%'";
  // ok vs fail only — 'token-exchange/request' is the attempt, not an
  // outcome; folding it in here would double-count against `attempts`.
  const outcomes =
    `SELECT count(*) FROM Log WHERE ${base} AND tag != 'token-exchange/request' FACET tag SINCE ${since}`;
  // Scalar count of exchanges that started. The client derives
  // unsettled = attempts − (ok + fail) rather than this query trying to
  // express "started and never resolved" itself.
  const attempts =
    `SELECT count(*) FROM Log WHERE ${base} AND tag='token-exchange/request' SINCE ${since}`;
  // hasActorToken is present on every outcome's metadata (request/ok/fail
  // alike), so this facets over all matching rows, not just settled ones —
  // that's the nested-`act` story, independent of whether the exchange
  // ultimately succeeded.
  const delegation =
    `SELECT count(*) FROM Log WHERE ${base} FACET hasActorToken SINCE ${since}`;
  const variants =
    `SELECT count(*) FROM Log WHERE ${base} FACET exchangeVariant SINCE ${since}`;
  // Dedicated facets, not derived from `stream` — `stream` is capped at
  // LIMIT 50 for the row-level table, and live volume already exceeds that
  // (56 exchange rows measured against a 50-row cap), so tallying these two
  // from stream would silently undercount. Same reasoning as `rules` in
  // _authorizeQuery: a summary panel gets its own uncapped-relative-to-50
  // facet query.
  const audience =
    `SELECT count(*) FROM Log WHERE ${base} FACET audience SINCE ${since} LIMIT 20`;
  const exchangeClientId =
    `SELECT count(*) FROM Log WHERE ${base} FACET exchangeClientId SINCE ${since} LIMIT 20`;
  // Same outcome-only scoping as `outcomes` — a volume chart that counted
  // every request too would show roughly double the real settle rate.
  const timeseries =
    `SELECT count(*) FROM Log WHERE ${base} AND tag != 'token-exchange/request' TIMESERIES ${bucket} SINCE ${since}`;
  // Searches exchangeVariant/audience/scope/exchangeClientId/pingoneError —
  // the columns this view's table actually renders (not `message`, which
  // this table never displays).
  const stream =
    'SELECT timestamp, tag, exchangeVariant, audience, scope, exchangeClientId, hasActorToken, subjectTokenType, latencyMs, httpStatus, pingoneError ' +
    `FROM Log WHERE ${base}${_likeClause(['exchangeVariant', 'audience', 'scope', 'exchangeClientId', 'pingoneError'], search)} SINCE ${since} LIMIT 50`;

  return `{ actor { account(id: ${Number(accountId)}) {
    outcomes: nrql(query: ${JSON.stringify(outcomes)}) { results }
    attempts: nrql(query: ${JSON.stringify(attempts)}) { results }
    delegation: nrql(query: ${JSON.stringify(delegation)}) { results }
    variants: nrql(query: ${JSON.stringify(variants)}) { results }
    audience: nrql(query: ${JSON.stringify(audience)}) { results }
    exchangeClientId: nrql(query: ${JSON.stringify(exchangeClientId)}) { results }
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
  tokenexchange: {
    build: _tokenExchangeQuery,
    map: (a) => ({
      outcomes: a.outcomes?.results || [],
      attempts: a.attempts?.results || [],
      delegation: a.delegation?.results || [],
      variants: a.variants?.results || [],
      audience: a.audience?.results || [],
      exchangeClientId: a.exchangeClientId?.results || [],
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

  // A blank/absent q must behave exactly as before — falsy short-circuits to
  // '', which _likeClause treats as "no filter". A present q is trimmed,
  // stripped of LIKE metacharacters, and capped at MAX_SEARCH_LEN — in that
  // order, so the cap is a guarantee on what actually reaches the query, not
  // on the raw input (stripping can only shorten a term, never lengthen it).
  // This is also the value reported back as `q`, so the client always sees
  // what was actually applied, metacharacter-stripping included — a term
  // that was ONLY metacharacters (e.g. "%%%") normalizes to '', which is
  // indistinguishable from "no search", same as an all-whitespace term.
  const rawQ = req.query.q;
  const search = rawQ
    ? _stripLikeMetacharacters(String(rawQ).trim()).slice(0, MAX_SEARCH_LEN)
    : '';

  // Cache key includes the view and search term — otherwise an authorize
  // request inside the TTL would be served the pipeline payload, or a
  // searched request would be served an unsearched (or differently
  // searched) payload and vice versa.
  const cacheKey = `${viewName}:${window}:${search}`;
  const cached = _cache.get(cacheKey);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return res.json(cached.payload);
  }

  try {
    const response = await axios.post(
      NERDGRAPH_ENDPOINT,
      { query: view.build(accountId, spec.since, spec.bucket, search) },
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
    const payload = { view: viewName, window, q: search, ...view.map(account) };
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
