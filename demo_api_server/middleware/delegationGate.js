'use strict';
const delegationStore = require('../services/lmdb/delegationStore.lmdb');

function _extractActClientId(req) {
  const auth = req.headers?.authorization;
  if (!auth || !auth.startsWith('Bearer ')) return null;
  const parts = auth.slice(7).split('.');
  if (parts.length < 2) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8'));
    return payload.act?.client_id || null;
  } catch {
    return null;
  }
}

function delegationGate(req, res, next) {
  const actorSub = _extractActClientId(req);
  if (!actorSub) return next(); // non-delegated request — pass through
  const record = delegationStore.findActiveByActorAndGrantor(actorSub, req.user?.id);
  if (!record) {
    return res.status(403).json({ error: 'delegation_revoked', message: 'Agent access has been revoked.' });
  }
  req.activeDelegation = record;
  next();
}

module.exports = { delegationGate };
