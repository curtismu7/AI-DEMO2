'use strict';
const express = require('express');
const pingoneEventStore = require('../services/lmdb/pingoneEventStore.lmdb');
const { forward } = require('../services/newRelicForwarder');
const appEventService = require('../services/appEventService');

const router = express.Router();

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

/**
 * Open ingest — no authentication.
 *
 * PingOne offers only Basic auth, static custom headers, or mTLS on a webhook;
 * it does NOT sign the body, so the HMAC check this route used to perform could
 * never pass against a real subscription. Rather than swap in a shared secret,
 * this endpoint is deliberately unauthenticated for the demo: anyone who can
 * reach it can inject events into the store and on to New Relic. That is an
 * accepted tradeoff here, not an oversight.
 */
router.post('/pingone', (req, res) => {
  // PingOne posts a batch: a JSON array of up to 500 events. Accept a bare
  // object too, so hand-crafted single-event curls keep working.
  const batch = Array.isArray(req.body) ? req.body : [req.body];
  const valid = batch.filter((e) => e && typeof e.type === 'string');
  if (valid.length === 0) {
    return res.status(400).json({ error: 'invalid_event' });
  }

  const eventIds = [];
  for (const p1Event of valid) {
    const stored = pingoneEventStore.append(_mapEvent(p1Event));
    eventIds.push(stored.eventId);
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
  }

  // eventId (singular) retained for existing callers; eventIds carries the batch.
  return res.status(200).json({
    received: true,
    eventId: eventIds[0],
    eventIds,
    count: eventIds.length,
  });
});

module.exports = router;
