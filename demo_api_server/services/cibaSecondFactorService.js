'use strict';

/**
 * cibaSecondFactorService - out-of-band approval that completes a PARKED password flow.
 *
 * The password step has already been verified and parked in the session (piFlowDriver). This service sends a
 * CIBA request on the PingOne step-up CIBA app for the chosen channel (both PingOne and PingFederate sign-ins:
 * the parked expectedSub is always the PingOne user id) and, on a matching approval, completes the parked flow.
 *
 * Security properties (pinned by tests/cibaSecondFactor.test.js):
 *  - user and expected sub come ONLY from the server-side parked flow, never from the request.
 *  - never simulated: a CIBA failure is 'approval_unavailable', the parked flow stays for a retry.
 *  - the authReqId handed to the browser is our own random id; PingOne's auth_req_id never leaves the server.
 *  - entries are bound to the starting browser session; other sessions get 404.
 *  - the ID token must be valid for the CHANNEL's CIBA app and its sub must equal the parked user.
 *  - one-shot: the entry is tombstoned BEFORE the parked flow is completed (replays get 410).
 *
 * ponytail: pending map + rate limiter are in-process (single BFF instance); move to the shared session
 * store if the BFF is ever scaled out.
 */

const crypto = require('crypto');
const cibaService = require('./cibaService');
const { verticalManifest } = require('./verticalManifest');

const EXPIRES_IN = 120;          // seconds, PingOne's CIBA request lifetime
const INTERVAL = 2;              // seconds
const ENTRY_GRACE_MS = 30 * 1000;   // pending TTL = PingOne's expires_in (<= 120 s) + this
const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_MAX = 5;
let maxEntries = 5000;

let now = () => Date.now();
let handlersOverride = null;
const pending = new Map();   // our authReqId -> entry
const hits = new Map();      // rate key -> [timestamps]

class NoParkedFlowError extends Error {}
class RateLimitedError extends Error {}
class ChannelUnavailableError extends Error {}
class ApprovalUnavailableError extends Error {}

// Lazy: routes/oauthUser requires a lot; avoid a require cycle.
const handlers = () => handlersOverride || require('../routes/oauthUser').piFlowHandlers;
const mask = (s) => `${String(s || '').slice(0, 2)}***`;

function sweep() {
  const t = now();
  for (const [id, e] of pending) if (t - e.createdAt >= 2 * e.ttlMs) pending.delete(id); // kept past the TTL so a late poll gets 410, not 404
  for (const [k, arr] of hits) {
    const live = arr.filter((x) => t - x < RATE_WINDOW_MS);
    if (live.length) hits.set(k, live); else hits.delete(k);
  }
}

// Sliding window; throws when ANY key is over the cap, otherwise counts one hit on each.
function rateLimit(keys) {
  const t = now();
  const lists = keys.map((k) => (hits.get(k) || []).filter((x) => t - x < RATE_WINDOW_MS));
  if (lists.some((l) => l.length >= RATE_MAX)) throw new RateLimitedError('rate_limited');
  keys.forEach((k, i) => hits.set(k, [...lists[i], t]));
}

async function startSecondFactor({ channel, req }) {
  sweep();
  const parked = handlers().getParkedFlow(req);
  if (!parked) throw new NoParkedFlowError('no_parked_flow');
  const { user } = parked;
  if (!user || !(channel === 'sms' ? user.mobilePhone : user.email)) throw new ChannelUnavailableError('channel_unavailable');
  if (pending.size >= maxEntries) throw new RateLimitedError('capacity');   // before the limiters: a capacity 429 consumes no slot
  rateLimit([`ip:${req.ip}`]);
  // Counts every attempt, so retries after a CIBA failure are capped too. Accepted trade-off (M2): someone
  // holding a stolen PASSWORD can keep the owner's CIBA option at 429 by re-sending every 10 minutes; the
  // owner's other sign-in options are unaffected.
  rateLimit([`send:${user.id}`]);
  let data;
  try {
    data = await cibaService.initiateBackchannelAuth(
      user.id, 'Approve sign-in', 'openid', '', channel, verticalManifest.resolver.activeIdFor(req),
    );
  } catch (err) {
    console.warn('[cibaSecondFactor] start failed for %s: %s', mask(user.username), err.response?.data?.error || err.message);
    throw new ApprovalUnavailableError('approval_unavailable');
  }
  if (!data?.auth_req_id || !data.binding_message) throw new ApprovalUnavailableError('approval_unavailable');

  // A binding message longer than 8 chars makes cibaService generate vertical code + random hex, so the match
  // code is never a literal word (verticals without a code would otherwise echo a short message verbatim).
  // Verticals WITHOUT a vertical code get 6 random hex chars; coded verticals get 8 (2-char code + 6 hex).
  const n = Number(data.expires_in);   // integer >= 1, capped at 120; NaN/negative/absent -> 120
  const expiresIn = Number.isFinite(n) && n > 0 ? Math.min(Math.ceil(n), EXPIRES_IN) : EXPIRES_IN;
  const authReqId = crypto.randomBytes(24).toString('hex');
  const t = now();
  pending.set(authReqId, { sessionIds: new Set([req.sessionID]), channel, sub: user.id, ttlMs: (expiresIn * 1000) + ENTRY_GRACE_MS, pingAuthReqId: data.auth_req_id, createdAt: t, consumed: false, inFlight: false });
  return { authReqId, matchCode: data.binding_message, expiresIn, interval: INTERVAL };
}

/** -> { status: 'pending' | 'approved' | 'expired' | 'denied' | 'notfound', redirectTo? } */
async function pollSecondFactor({ authReqId, req }) {
  sweep();
  const entry = pending.get(authReqId);
  if (!entry || !entry.sessionIds.has(req.sessionID)) return { status: 'notfound' };
  if (entry.consumed) return { status: 'expired' };
  const h = handlers();
  // The parked flow was restarted as someone else: this entry is dead, but the newer flow must survive.
  const current = h.getParkedFlow(req);
  if (current && current.expectedSub !== entry.sub) { entry.consumed = true; return { status: 'expired' }; }
  if (now() - entry.createdAt >= entry.ttlMs) { entry.consumed = true; h.discardParkedFlow(req); return { status: 'expired' }; }
  if (entry.inFlight) return { status: 'pending' };

  entry.inFlight = true;
  try {
    const fail = (status) => { entry.consumed = true; h.discardParkedFlow(req); return { status }; };
    let tokens;
    try {
      tokens = await cibaService.pollForTokens(entry.pingAuthReqId, entry.channel);
    } catch (err) {
      const code = err.response?.data?.error;
      if (code === 'authorization_pending' || code === 'slow_down') return { status: 'pending' };
      console.warn('[cibaSecondFactor] poll ended: %s', code === 'access_denied' || code === 'expired_token' ? code : 'error');
      return fail(code === 'access_denied' ? 'denied' : 'expired');
    }
    // PingOne tokens are one-time: whatever happens next, this id is finished.
    const parked = h.getParkedFlow(req);
    if (!parked || parked.expectedSub !== entry.sub) { entry.consumed = true; return { status: 'expired' }; }
    try {
      await cibaService.validateCibaIdToken(tokens?.id_token, entry.sub, '', entry.channel);
    } catch (err) {
      console.warn('[cibaSecondFactor] approval refused for %s: %s', mask(parked.username), err.message);
      return fail('denied');
    }
    entry.consumed = true;   // tombstone BEFORE completing: a replay can never finish a second time
    const done = await h.completeParkedFlow(req);
    if (done.error || !done.redirectTo) return { status: 'expired' };
    entry.sessionIds.add(req.sessionID);   // completion may regenerate the session id
    return { status: 'approved', redirectTo: done.redirectTo };
  } catch (err) {
    entry.consumed = true;
    console.error('[cibaSecondFactor] completion failed: %s', err.message);
    return { status: 'expired' };
  } finally {
    entry.inFlight = false;
  }
}

module.exports = {
  startSecondFactor, pollSecondFactor,
  NoParkedFlowError, RateLimitedError, ChannelUnavailableError, ApprovalUnavailableError,
  _test: {
    reset() { pending.clear(); hits.clear(); now = () => Date.now(); handlersOverride = null; },
    setNow(fn) { now = fn; },
    setMaxEntries(n) { maxEntries = n; },
    setHandlers(h) { handlersOverride = h; },
  },
};
