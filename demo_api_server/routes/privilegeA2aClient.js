'use strict';

const express = require('express');
const { requireSession } = require('../middleware/auth');
const { verticalManifest } = require('../services/verticalManifest');
const { a2aDemoProfile } = require('../config/a2aSpecialists');

const router = express.Router();
const MAX_MESSAGE_LENGTH = 4000;
const MAX_SESSION_ID_LENGTH = 128;
const UNAVAILABLE = { error: 'A2A service unavailable' };

// The active vertical comes from the server-side session, never from the request body,
// so a browser cannot name a specialist it is not on. Null when the vertical has none.
function activeProfile(req) {
  return a2aDemoProfile(verticalManifest.resolver.activeIdFor(req) || 'banking');
}

// The fields of the profile the main agent needs to act as that vertical's concierge.
function profileForMainAgent(profile) {
  if (!profile) return {};
  const { vertical, agentName, specialistName, tool, tools, subtaskHint } = profile;
  return { vertical, agentName, specialistName, tool, tools, subtaskHint };
}

function mainAgentUrl(path) {
  const base = (process.env.PRIVILEGE_A2A_MAIN_URL || 'http://127.0.0.1:3300').replace(/\/+$/, '');
  return `${base}${path}`;
}

/**
 * POST `upstreamBody` to the main agent at `path` and relay its SSE stream to
 * the browser byte for byte. Only the server-held shared secret is added; no
 * browser identity or token is forwarded.
 */
async function relayMainAgentSse(res, path, upstreamBody) {
  const sharedSecret = process.env.PRIVILEGE_A2A_BFF_SECRET;
  if (!sharedSecret) {
    res.status(503).json(UNAVAILABLE);
    return;
  }

  const controller = new AbortController();
  const abortIfClientDisconnects = () => {
    if (!res.writableEnded) controller.abort();
  };
  const cleanup = () => res.off('close', abortIfClientDisconnects);
  res.on('close', abortIfClientDisconnects);
  res.on('finish', cleanup);

  try {
    const upstream = await fetch(mainAgentUrl(path), {
      method: 'POST',
      headers: {
        Accept: 'text/event-stream',
        'Content-Type': 'application/json',
        'X-A2A-BFF-Secret': sharedSecret,
      },
      body: JSON.stringify(upstreamBody),
      signal: controller.signal,
    });

    if (!upstream.ok || !upstream.body || !/^text\/event-stream\b/i.test(upstream.headers.get('content-type') || '')) {
      await upstream.body?.cancel().catch(() => undefined);
      if (!res.destroyed) res.status(502).json(UNAVAILABLE);
      return;
    }

    res.status(200);
    res.set({
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
      Connection: 'keep-alive',
    });
    res.flushHeaders();
    const reader = upstream.body.getReader();
    while (!controller.signal.aborted) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!res.write(Buffer.from(value))) {
        await new Promise(resolve => {
          const resume = () => {
            res.off('drain', resume);
            res.off('close', resume);
            resolve();
          };
          res.once('drain', resume);
          res.once('close', resume);
        });
      }
    }
    if (!res.destroyed) res.end();
  } catch {
    if (controller.signal.aborted || res.destroyed) return;
    if (!res.headersSent) {
      res.status(502).json(UNAVAILABLE);
      return;
    }
    res.write('event: error\ndata: {"error":"A2A stream interrupted"}\n\n');
    res.end();
  } finally {
    cleanup();
  }
}

/**
 * What the A2A demo steps show for the signed-in user's active vertical: the generalist
 * agent's name, its specialist, and the canned questions. `profile` is null when the
 * vertical has no specialist, and the UI then falls back to the generic access review.
 */
router.get('/profile', requireSession, (req, res) => {
  res.json({ profile: activeProfile(req) });
});

router.post('/chat', requireSession, express.json({ limit: '64kb' }), async (req, res) => {
  const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body)
    ? req.body
    : {};
  const message = typeof body.message === 'string' ? body.message.trim() : '';
  const hasSessionId = Object.prototype.hasOwnProperty.call(body, 'sessionId');
  const sessionId = typeof body.sessionId === 'string' ? body.sessionId.trim() : '';

  if (!message || message.length > MAX_MESSAGE_LENGTH) {
    res.status(400).json({ error: `message must contain 1 to ${MAX_MESSAGE_LENGTH} characters` });
    return;
  }
  if (hasSessionId && (!sessionId || sessionId.length > MAX_SESSION_ID_LENGTH)) {
    res.status(400).json({ error: `sessionId must contain 1 to ${MAX_SESSION_ID_LENGTH} characters` });
    return;
  }

  const upstreamBody = { message, ...profileForMainAgent(activeProfile(req)) };
  if (sessionId) upstreamBody.sessionId = sessionId;
  await relayMainAgentSse(res, '/chat', upstreamBody);
});

/**
 * Start the three-deep chain: the main agent hands `message` to the middle
 * agent through the Privilege gateway and names the `specialist` it should
 * hand it on to. Streams one `trace` event per hop, each with from and to.
 */
router.post('/chain', requireSession, express.json({ limit: '64kb' }), async (req, res) => {
  const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body)
    ? req.body
    : {};
  const message = typeof body.message === 'string' ? body.message.trim() : '';
  const specialist = typeof body.specialist === 'string' ? body.specialist.trim() : '';
  if (!message || message.length > MAX_MESSAGE_LENGTH) {
    res.status(400).json({ error: `message must contain 1 to ${MAX_MESSAGE_LENGTH} characters` });
    return;
  }
  if (!/^[a-z0-9-]{1,64}$/.test(specialist)) {
    res.status(400).json({ error: 'specialist must be a lowercase name of 1 to 64 characters' });
    return;
  }
  await relayMainAgentSse(res, '/chain', { message, specialist, ...profileForMainAgent(activeProfile(req)) });
});

// Fetch a live A2A Agent Card over the wire so the /llm-gateway "Malicious A2A"
// tab can scan the real card a hostile specialist serves (not a bundled copy).
// Read-only: it GETs the card and returns it verbatim; the UI does the scanning.
// SSRF guard: http(s) only, path must be the A2A well-known card, and the cloud
// metadata address is blocked. Internal svc / localhost targets ARE allowed on
// purpose — reaching an in-cluster or local agent card is the whole point.
router.post('/scan-card', requireSession, express.json({ limit: '8kb' }), async (req, res) => {
  const raw = req.body && typeof req.body.url === 'string' ? req.body.url.trim() : '';
  let url;
  try {
    url = new URL(raw);
  } catch {
    res.status(400).json({ error: 'A valid card URL is required' });
    return;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    res.status(400).json({ error: 'Only http(s) URLs are allowed' });
    return;
  }
  if (!/\/\.well-known\/agent-card\.json$/.test(url.pathname)) {
    res.status(400).json({ error: 'URL must end with /.well-known/agent-card.json' });
    return;
  }
  if (url.hostname === '169.254.169.254') {
    res.status(400).json({ error: 'Blocked host' });
    return;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const upstream = await fetch(url.toString(), { signal: controller.signal, redirect: 'error' });
    const text = await upstream.text();
    if (!upstream.ok) {
      res.status(502).json({ error: `Agent Card fetch failed: HTTP ${upstream.status}` });
      return;
    }
    let card;
    try {
      card = JSON.parse(text);
    } catch {
      res.status(502).json({ error: 'Agent Card was not valid JSON' });
      return;
    }
    res.json({ url: url.toString(), card });
  } catch (err) {
    res.status(502).json({ error: `Could not reach the agent: ${err.name === 'AbortError' ? 'timed out' : err.message}` });
  } finally {
    clearTimeout(timer);
  }
});

module.exports = router;
