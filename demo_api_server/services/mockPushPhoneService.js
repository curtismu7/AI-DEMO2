'use strict';

const crypto = require('crypto');

// /mfa-test step-up "Push · simulated phone": a session-scoped stand-in for a PingOne MFA push.
// Real push needs a phone app built on the PingOne MFA SDK (none is registered here), so the BFF
// plays the phone. It never calls PingOne and grants nothing: no step-up flag, no token.
const MAX_PENDING_MS = 2 * 60 * 1000;

const fail = (code, message, httpStatus) => Object.assign(new Error(message), { code, httpStatus });
const view = (p, state) => ({ state, username: p.username, numberToMatch: p.numberToMatch, expiresAt: new Date(p.expiresAt).toISOString() });

function start(req, { now = Date.now } = {}) {
  const username = String(req.session?.user?.username || '').trim();
  if (!username) throw fail('not_signed_in', 'Sign in first', 401);
  const pending = { username, numberToMatch: String(crypto.randomInt(10, 100)), expiresAt: now() + MAX_PENDING_MS };
  req.session.mockPushPhone = pending;
  return view(pending, 'pending');
}

function poll(req, { now = Date.now } = {}) {
  const p = req.session?.mockPushPhone;
  if (!p) throw fail('nothing_pending', 'No push is pending', 409);
  if (p.decision) {
    delete req.session.mockPushPhone;
    return view(p, p.decision);
  }
  if (p.expiresAt <= now()) {
    delete req.session.mockPushPhone;
    return view(p, 'expired');
  }
  return view(p, 'pending');
}

// The phone's tap. The next poll reports it, like a real push answered on the device.
function decide(req, decision) {
  const p = req.session?.mockPushPhone;
  if (!p) throw fail('nothing_pending', 'No push is pending', 409);
  if (decision !== 'approve' && decision !== 'deny') throw fail('invalid_decision', 'The decision must be approve or deny', 400);
  p.decision = decision === 'approve' ? 'approved' : 'denied';
  return view(p, p.decision);
}

module.exports = { start, poll, decide };
