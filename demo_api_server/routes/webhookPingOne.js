'use strict';
const crypto = require('crypto');
const express = require('express');
const pingoneEventStore = require('../services/lmdb/pingoneEventStore.lmdb');
const { forward } = require('../services/newRelicForwarder');
const appEventService = require('../services/appEventService');

const router = express.Router();

function _hmacOk(req) {
  const secret = process.env.PINGONE_WEBHOOK_SECRET;
  if (!secret) return false;
  const presented = req.headers['x-p1-signature'];
  if (!presented) return false;
  const raw = req.rawBody;
  if (!raw) return false;
  const expected = crypto.createHmac('sha256', secret).update(raw).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(presented), Buffer.from(expected));
  } catch {
    return false; // length mismatch = wrong signature
  }
}

function _mapEvent(p1Event) {
  return {
    eventType: p1Event.type,
    actorId: p1Event.actors?.user?.id || p1Event.actors?.client?.id || null,
    actorType: p1Event.actors?.user?.type || p1Event.actors?.client?.type || null,
    status: p1Event.result?.status || null,
    resource: p1Event.resources?.[0]?.name || p1Event.resources?.[0]?.id || null,
    environmentId: p1Event._embedded?.environment?.id || null,
    timestamp: p1Event.recordedAt || p1Event.createdAt || null,
    raw: p1Event,
  };
}

router.post('/pingone', (req, res) => {
  if (!_hmacOk(req)) {
    return res.status(401).json({ error: 'invalid_signature' });
  }
  const p1Event = req.body;
  if (!p1Event || typeof p1Event.type !== 'string') {
    return res.status(400).json({ error: 'invalid_event' });
  }
  const mapped = _mapEvent(p1Event);
  const stored = pingoneEventStore.append(mapped);
  forward(stored).catch(() => {});
  appEventService.logEvent('pingone', 'info',
    `PingOne ${stored.eventType || 'event'}: ${stored.status || 'unknown'}`,
    {
      tag: 'pingone/event',
      metadata: {
        eventId: stored.eventId,
        eventType: stored.eventType,
        actorId: stored.actorId,
        status: stored.status,
        timestamp: stored.timestamp,
      },
    }
  );
  return res.status(200).json({ received: true, eventId: stored.eventId });
});

module.exports = router;
