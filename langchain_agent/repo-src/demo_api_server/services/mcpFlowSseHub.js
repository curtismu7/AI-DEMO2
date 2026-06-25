// banking_api_server/services/mcpFlowSseHub.js
'use strict';

/**
 * Per-request MCP tool flow events over Server-Sent Events (SSE).
 *
 * - Client opens GET /api/mcp/tool/events?trace=<uuid> first (claims trace for session).
 * - Client POST /api/mcp/tool with the same flowTraceId; server emits phases as it runs.
 *
 * Limitation: subscribers must hit the same Node process as POST (OK for local/long-lived;
 * multi-instance / stateless serverless may not deliver events unless backed by Redis pub/sub).
 */

/** @type {Map<string, Set<import('express').Response>>} */
const traceSubscribers = new Map();

/** @type {Map<string, { sessionId: string, claimedAt: number }>} */
const traceClaims = new Map();

/** @type {Map<string, object[]>} — replay for subscribers that connect after first publish */
const traceBuffers = new Map();
const BUFFER_MAX = 24;

const CLAIM_TTL_MS = 60_000;
const TRACE_CLEANUP_MS = 120_000;

// == Cross-instance event bridge (disabled — no KV/Redis) ==

const KV_URL   = null;
const KV_TOKEN = null;
let _kvClientOverride = null;

function _getKvClient() {
  return _kvClientOverride || null;
}

function _kvKey(traceId) {
  return 'sse:events:' + traceId;
}

async function kvPublish(traceId, payload) {
  // No-op — no KV configured
}

function startKvPoller(traceId, res) {
  const kv = _getKvClient();
  if (!kv) return;
  if (!res._receivedTs) res._receivedTs = new Set();
  let cursor = 0;
  const poll = async () => {
    try {
      const raw = await kv.lrange(_kvKey(traceId), cursor, -1);
      if (!Array.isArray(raw) || raw.length === 0) return;
      cursor += raw.length;
      for (const item of raw) {
        let ev;
        try { ev = typeof item === 'string' ? JSON.parse(item) : item; } catch (_) { continue; }
        if (typeof ev.t === 'number' && res._receivedTs.has(ev.t)) continue;
        try {
          res.write('data: ' + JSON.stringify(ev) + '\n\n');
          if (typeof ev.t === 'number') res._receivedTs.add(ev.t);
        } catch (_) { return; }
        if (ev.phase === 'stream_end') {
          clearInterval(poller);
          try { res.end(); } catch (_) {}
          return;
        }
      }
    } catch (e) {
      console.warn('[mcpFlowSseHub] kv poll error:', e.message);
    }
  };
  const poller = setInterval(poll, 500);
  res.on('close', () => clearInterval(poller));
}

function _testSetKvClient(client) {
  _kvClientOverride = client;
}


/**
 * Record that this session claimed a trace id (first GET /events connection).
 * @param {string} traceId
 * @param {string} sessionId
 */
function claimTrace(traceId, sessionId) {
  traceClaims.set(traceId, { sessionId, claimedAt: Date.now() });
  if (!traceBuffers.has(traceId)) {
    traceBuffers.set(traceId, []);
  }
  setTimeout(() => {
    const cur = traceClaims.get(traceId);
    if (cur && cur.sessionId === sessionId) {
      traceClaims.delete(traceId);
      traceBuffers.delete(traceId);
    }
  }, TRACE_CLEANUP_MS);
}

/**
 * @param {string} traceId
 * @param {string} sessionId
 * @returns {boolean}
 */
function isValidTraceForSession(traceId, sessionId) {
  const row = traceClaims.get(traceId);
  if (!row || row.sessionId !== sessionId) return false;
  if (Date.now() - row.claimedAt > CLAIM_TTL_MS) {
    traceClaims.delete(traceId);
    return false;
  }
  return true;
}

/**
 * @param {string} traceId
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @returns {boolean} false if forbidden
 */
function attachSubscriber(traceId, req, res) {
  const sid = req.sessionID;
  if (!sid || !isValidTraceForSession(traceId, sid)) {
    return false;
  }

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  if (typeof res.flushHeaders === 'function') {
    res.flushHeaders();
  }

  res.write(': sse connected\n\n');

  const buf = traceBuffers.get(traceId);
  if (buf && buf.length > 0) {
    for (const payload of buf) {
      try {
        res.write(`data: ${JSON.stringify(payload)}\n\n`);
        if (!res._receivedTs) res._receivedTs = new Set();
        if (typeof payload.t === 'number') res._receivedTs.add(payload.t);
      } catch (_) {}
    }
  }

  let set = traceSubscribers.get(traceId);
  if (!set) {
    set = new Set();
    traceSubscribers.set(traceId, set);
  }
  set.add(res);

  const cleanup = () => {
    set.delete(res);
    if (set.size === 0) {
      traceSubscribers.delete(traceId);
    }
  };
  req.on('close', cleanup);
  res.on('close', cleanup);
  return true;
}

/**
 * @param {string|null|undefined} traceId
 * @param {object} payload — JSON-serializable (no secrets)
 */
function publish(traceId, payload) {
  if (!traceId || typeof traceId !== 'string') return;
  const full = { ...payload, t: Date.now() };
  let arr = traceBuffers.get(traceId);
  if (!arr) {
    arr = [];
    traceBuffers.set(traceId, arr);
  }
  arr.push(full);
  while (arr.length > BUFFER_MAX) {
    arr.shift();
  }

  const line = `data: ${JSON.stringify(full)}\n\n`;
  const set = traceSubscribers.get(traceId);
  if (set && set.size > 0) {
    for (const r of set) {
      try {
        r.write(line);
        if (!r._receivedTs) r._receivedTs = new Set();
        r._receivedTs.add(full.t);
      } catch (_) {
        /* client gone */
      }
    }
  }
  if (_kvClientOverride) {
    kvPublish(traceId, full).catch(() => {});
  }
}

// How long to keep the event buffer alive after the POST finishes.
// This prevents a race where the EventSource GET arrives after the POST
// response, finds the buffer deleted, and gets no compliance step events.
const BUFFER_LINGER_MS = 10000;

/**
 * Call when POST /api/mcp/tool finishes (success or error) for this trace.
 * @param {string|null|undefined} traceId
 */
function endTrace(traceId) {
  if (!traceId) return;
  publish(traceId, { phase: 'stream_end' });
  // Close any already-connected SSE subscribers immediately.
  const set = traceSubscribers.get(traceId);
  if (set) {
    for (const r of set) {
      try { r.end(); } catch (_) {}
    }
    traceSubscribers.delete(traceId);
  }
  // Keep the buffer alive for a short window so that an EventSource that
  // connects just after the POST finishes can still replay all events.
  // Without this, local-fallback tool calls (which return in <50ms) would
  // delete the buffer before the browser's SSE GET is processed.
  setTimeout(() => {
    traceClaims.delete(traceId);
    traceBuffers.delete(traceId);
  }, BUFFER_LINGER_MS);
  if (_kvClientOverride) {
    const _kv = _getKvClient();
    if (_kv) _kv.expire(_kvKey(traceId), 30).catch(() => {});
  }
}

/**
 * Ensure trace is owned by this session (POST may register before GET).
 * @param {string} traceId
 * @param {string} sessionId
 * @returns {'ok'|'forbidden'}
 */
function ensurePostTrace(traceId, sessionId) {
  if (!traceId || !sessionId) return 'forbidden';
  const row = traceClaims.get(traceId);
  if (!row) {
    claimTrace(traceId, sessionId);
    return 'ok';
  }
  if (row.sessionId !== sessionId) return 'forbidden';
  row.claimedAt = Date.now();
  return 'ok';
}

/**
 * GET /api/mcp/tool/events?trace= — start SSE for this session + trace.
 * @returns {boolean} true if SSE stream was attached (response left open)
 */
function handleSseGet(req, res) {
  const traceId = String(req.query.trace || '').trim();
  if (!traceId || traceId.length < 12) {
    res.status(400).json({ error: 'trace_required', message: 'Query ?trace= must be a UUID from the client.' });
    return false;
  }
  if (!req.sessionID) {
    res.status(401).json({ error: 'session_required', message: 'Sign in required for MCP flow SSE.' });
    return false;
  }
  if (!traceClaims.has(traceId)) {
    claimTrace(traceId, req.sessionID);
  } else if (!isValidTraceForSession(traceId, req.sessionID)) {
    res.status(403).json({ error: 'trace_forbidden', message: 'Trace id is not valid for this session.' });
    return false;
  }
  if (!attachSubscriber(traceId, req, res)) {
    res.status(403).json({ error: 'sse_attach_failed' });
    return false;
  }
  if (_kvClientOverride) {
    startKvPoller(traceId, res);
  }
  return true;
}

module.exports = {
  claimTrace,
  isValidTraceForSession,
  ensurePostTrace,
  attachSubscriber,
  publish,
  endTrace,
  handleSseGet,
  _testSetKvClient,
};
