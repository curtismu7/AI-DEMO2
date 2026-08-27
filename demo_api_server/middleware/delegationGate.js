'use strict';
const delegationStore = require('../services/lmdb/delegationStore.lmdb');

/**
 * Distinguishes "no act claim" (a genuinely non-delegated request — pass
 * through) from "act claim present but unparseable" (fail closed). A bare
 * `catch { return null; }` here previously collapsed both into pass-through,
 * so a Bearer token that was JWT-shaped (2+ dot segments) but failed to
 * base64/JSON-decode — including a previously-revoked delegate agent's token
 * that happened to trip this path — bypassed the delegation check entirely.
 */
function _extractActClientId(req) {
  const auth = req.headers?.authorization;
  if (!auth || !auth.startsWith('Bearer ')) return { clientId: null, parseFailed: false };
  const parts = auth.slice(7).split('.');
  if (parts.length < 2) return { clientId: null, parseFailed: false };
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8'));
    return { clientId: payload.act?.client_id || null, parseFailed: false };
  } catch {
    return { clientId: null, parseFailed: true };
  }
}

function delegationGate(req, res, next) {
  const { clientId: actorSub, parseFailed } = _extractActClientId(req);
  if (parseFailed) {
    return res.status(401).json({ error: 'invalid_token', message: 'Bearer token could not be decoded.' });
  }
  if (!actorSub) return next(); // non-delegated request — pass through
  const record = delegationStore.findActiveByActorAndGrantor(actorSub, req.user?.id);
  if (!record) {
    return res.status(403).json({ error: 'delegation_revoked', message: 'Agent access has been revoked.' });
  }
  req.activeDelegation = record;
  next();
}

module.exports = { delegationGate };
