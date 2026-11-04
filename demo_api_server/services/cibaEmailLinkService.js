'use strict';

// CIBA email-link store for the PingOne simulated failover path: a one-time
// token binds an emailed link to a simulated auth_req_id. The emailed click
// carries no BFF session, so this process-global map is the authority; the
// session's poll consumes the decision exactly once.

const crypto = require('crypto');

const TTL_MS = 10 * 60 * 1000;
const tokens = new Map(); // token -> { authReqId, decision, resolved, expiresAt }

setInterval(() => {
  for (const [token, entry] of tokens) {
    if (entry.expiresAt <= Date.now()) tokens.delete(token);
  }
}, 60 * 1000).unref();

// Returns the token; the caller composes and sends the email.
function issueToken(authReqId, ) {
  const token = crypto.randomBytes(32).toString('hex');
  tokens.set(token, { authReqId, decision: null, resolved: false, expiresAt: Date.now() + TTL_MS });
  return token;
}

function status(token, ) {
  const entry = typeof token === 'string' ? tokens.get(token) : null;
  if (!entry) return { state: 'invalid' };
  if (entry.expiresAt <= Date.now()) { tokens.delete(token); return { state: 'expired' }; }
  return {
    state: entry.resolved ? 'received' : 'waiting',
    decision: entry.decision,
    authReqId: entry.authReqId,
  };
}

function decide(token, decision, ) {
  if (decision !== 'approve' && decision !== 'deny') {
    const error = new Error('The decision must be approve or deny');
    error.code = 'CIBA_EMAIL_DECISION_INVALID';
    error.httpStatus = 400;
    throw error;
  }
  const entry = typeof token === 'string' ? tokens.get(token) : null;
  if (!entry || entry.expiresAt <= Date.now()) {
    tokens.delete(token);
    const error = new Error('This approval link is no longer valid');
    error.code = 'CIBA_EMAIL_TOKEN_INVALID';
    error.httpStatus = 410;
    throw error;
  }
  if (entry.resolved) {
    const error = new Error('This approval link was already used');
    error.code = 'CIBA_EMAIL_TOKEN_USED';
    error.httpStatus = 409;
    throw error;
  }
  entry.decision = decision;
  entry.resolved = true;
  return { state: 'received', decision: entry.decision, authReqId: entry.authReqId };
}

// Consume the decision for an auth_req_id (one-time): 'approved' | 'denied' | null.
function consumeForAuthReqId(authReqId) {
  for (const [token, entry] of tokens) {
    if (entry.authReqId === authReqId && entry.resolved) {
      tokens.delete(token);
      return entry.decision === 'approve' ? 'approved' : 'denied';
    }
  }
  return null;
}

module.exports = { issueToken, status, decide, consumeForAuthReqId };
