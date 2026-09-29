'use strict';

const express = require('express');
const { requireSession } = require('../middleware/auth');

const router = express.Router();
const MAX_MESSAGE_LENGTH = 4000;
const MAX_SESSION_ID_LENGTH = 128;
const UNAVAILABLE = { error: 'A2A service unavailable' };

function mainChatUrl() {
  const base = (process.env.PRIVILEGE_A2A_MAIN_URL || 'http://127.0.0.1:3300').replace(/\/+$/, '');
  return `${base}/chat`;
}

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
    const upstreamBody = { message };
    if (sessionId) upstreamBody.sessionId = sessionId;
    const upstream = await fetch(mainChatUrl(), {
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
});

module.exports = router;
