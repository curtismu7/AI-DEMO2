'use strict';

const dataStore = require('../data/store');

// A key long enough to be unguessable but bounded, so a hostile client can't
// push 500 junk reservations with one giant header and evict everyone else's.
const MAX_KEY_LENGTH = 200;

/**
 * Idempotency for money-moving requests — the Idempotent Consumer pattern.
 *
 * A client that retries after a timeout has no way to know whether the original
 * request moved funds. Replaying the first response is the only answer that is
 * both safe and truthful.
 *
 * Two properties this middleware depends on, both worth stating because they are
 * what make it real rather than decorative:
 *
 *  1. The key record lives in `dataStore`, alongside the balances. Both reach
 *     disk in one `_atomicWrite` (tmp file + rename), so a crash cannot keep the
 *     key while losing the transfer. Storing keys in a separate system — Redis
 *     beside this JSON — is precisely the split-brain that blocks a client's
 *     retry against a transfer that never happened.
 *  2. Reserve-then-fill, not check-then-write. The reservation is recorded
 *     BEFORE the route runs, so a genuine double-submit (two requests in flight,
 *     neither finished) collides instead of both sailing through.
 *
 * Opt-in by header: with no `Idempotency-Key` this is a straight `next()` and
 * behaviour is byte-identical to before. Mount AFTER authentication — the key is
 * scoped per user and `req.user` must already be resolved.
 */
function idempotency(req, res, next) {
  const raw = req.headers['idempotency-key'];
  if (!raw) return next();

  const provided = String(raw).trim();
  if (!provided || provided.length > MAX_KEY_LENGTH) {
    return res.status(400).json({ error: 'invalid_idempotency_key' });
  }

  // Scoped to the caller. A bare key would let one user replay another's request
  // and read back a response about someone else's account.
  const userId = req.user && req.user.id;
  if (!userId) return next();
  const key = `${userId}:${provided}`;

  const existing = dataStore.reserveIdempotencyKey(key);

  if (existing && existing.state === 'completed') {
    res.setHeader('Idempotency-Replayed', 'true');
    return res.status(existing.status).json(existing.body);
  }

  if (existing) {
    // Still in flight. 409 rather than replaying, because there is no response
    // to replay yet and guessing one would be a lie about whether funds moved.
    return res.status(409).json({
      error: 'idempotent_request_in_progress',
      error_description: 'A request with this Idempotency-Key is still being processed. Retry shortly.',
    });
  }

  // We own the key. Capture the outcome by wrapping res.json once, rather than
  // editing the ~20 response sites in the transfer route — fewer places to
  // forget, and it cannot drift as the route grows.
  const sendJson = res.json.bind(res);
  let settled = false;

  res.json = (body) => {
    if (!settled) {
      settled = true;
      // 5xx is an incomplete outcome, not a decision: release so a real retry
      // can proceed. Every other status — including a 4xx refusal — is a settled
      // answer the client should get back verbatim on replay.
      if (res.statusCode >= 500) dataStore.releaseIdempotencyKey(key);
      else dataStore.completeIdempotencyKey(key, res.statusCode, body);
    }
    return sendJson(body);
  };

  // A throw or a dropped socket never reaches res.json, so the reservation would
  // otherwise stay wedged and lock the client out of retrying forever.
  res.on('close', () => {
    if (!settled) {
      settled = true;
      dataStore.releaseIdempotencyKey(key);
    }
  });

  return next();
}

module.exports = { idempotency };
