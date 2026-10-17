'use strict';

/**
 * cibaLoginService - passwordless sign-in over CIBA (spike decision R1).
 *
 * The CIBA request is made AS THE LOGIN APP (client_secret_post, full login scope) and the DaVinci flow
 * policy for the chosen channel is selected with acr_values. On approval the tokens go through the same
 * establish*Session + cookie tail as the OAuth callbacks.
 *
 * Security properties (each is pinned by tests/cibaLogin.test.js):
 *  - start answers 200 with the same shape for real users and decoys (unknown identifier, no email/phone
 *    for the channel, disabled account, lookup/PingOne failure). Decoys never contact PingOne.
 *  - the authReqId handed to the browser is our own random id; PingOne's auth_req_id never leaves the server.
 *  - a pending entry is bound to the session that started it; other sessions get 404.
 *  - the ID token must be valid for the login app AND its sub must be the user identified at start.
 *  - one-shot: after success/failure the id is tombstoned (410).
 *
 * ponytail: pending map + rate limiter are in-process (single BFF instance / sticky enough for a demo);
 * move both to the shared session store if the BFF is ever scaled out.
 */

const crypto = require('crypto');
const axios = require('axios');
const oauthUserConfig = require('../config/oauthUser');
const oauthAdminConfig = require('../config/oauth');
const { resolvePingOneIdentifier } = require('./pingOneUserLookupService');
const { validateToken } = require('./tokenValidationService');
const { assertUserInfoSubjectMatches } = require('./oidcIdTokenValidationService');
const { establishUserSession } = require('./userSessionService');
const { establishAdminSession } = require('./adminSessionService');
const { setAuthCookie, clearAuthCookie } = require('./authStateCookie');
const configStore = require('./configStore');
const { loadHostedAccessPolicy, evaluateHostedIdentity, coherentHostedIdentityClaims, stampHostedAccessApproval, clearHostedAccessApproval } = require('./hostedAccessPolicy');
const { resolveEndUserAdminSignals } = require('./adminSignalResolver');
const { newMatchCode } = require('./cibaService');
const { verticalManifest } = require('./verticalManifest');
const { determineClientType } = require('../middleware/auth');
const { getFrontendOrigin } = require('./oauthRedirectUris');
const dataStore = require('../data/store');

const EXPIRES_IN = 120;          // seconds, PingOne's CIBA request lifetime
const INTERVAL = 2;              // seconds
const ENTRY_TTL_MS = 150 * 1000; // how long a pending entry/tombstone is kept
const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_MAX = 5;
const MAX_ENTRIES = 5000;
const POLICY = {
  email: () => process.env.CIBA_LOGIN_POLICY_EMAIL || '99972880d9170ab70d72e269cc944186', // 'CIBA - EMAIL'
  sms: () => process.env.CIBA_LOGIN_POLICY_SMS || '87929b3e4c6857e5ff854502dbde1742',     // 'CIBA-SMS'
};
const ALGORITHMS = ['RS256', 'RS384', 'RS512', 'ES256', 'ES384', 'ES512'];
const SPA_FAILURE = ['access_denied', 'expired_token', 'invalid_grant'];

let now = () => Date.now();
const pending = new Map();   // our authReqId -> entry
const hits = new Map();      // rate key -> [timestamps]

const _isProd = () => !!(process.env.REPL_ID || process.env.REPLIT_DEPLOYMENT || process.env.NODE_ENV === 'production');
const mask = (s) => `${String(s || '').slice(0, 2)}***`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const floorMs = () => {
  const n = parseInt(process.env.CIBA_LOGIN_START_FLOOR_MS || '', 10);
  return Number.isFinite(n) && n >= 0 ? n : 1200;
};

class RateLimitedError extends Error {}
class ProviderUnsupportedError extends Error {}

// ponytail: PingOne only until Task 10; refuse visibly rather than silently producing decoys.
function assertProvider() {
  if ((configStore.getOAuthProvider?.() || 'pingone') !== 'pingone') throw new ProviderUnsupportedError('provider_unsupported');
}

// Every poll answer takes at least this long (plus jitter), so a decoy (no PingOne call) cannot be told
// apart from a real entry (one /token round trip) by latency. Decoys last the full TTL while real entries can
// end early (access_denied etc.); that is deliberate: an attacker cannot induce those for a victim.
const pollFloorMs = () => {
  const n = parseInt(process.env.CIBA_LOGIN_POLL_FLOOR_MS || '', 10);
  return Number.isFinite(n) && n >= 0 ? n : 400;
};

// R1 login-app bundle per role. provider seam: only 'pingone' today (Task 10 adds 'pingfederate').
function roleBundle(role) {
  return role === 'admin'
    ? { config: oauthAdminConfig, userSvc: () => require('./oauthService'), oauthType: 'admin' }
    : { config: oauthUserConfig, userSvc: () => require('./oauthUserService'), oauthType: 'user' };
}
const scopeString = (config) => (Array.isArray(config.scopes) ? config.scopes : String(config.scopes || '').split(/\s+/)).join(' ');

function sweep() {
  const t = now();
  for (const [id, e] of pending) if (t - e.createdAt >= ENTRY_TTL_MS) pending.delete(id);
  for (const [k, arr] of hits) {
    const live = arr.filter((x) => t - x < RATE_WINDOW_MS);
    if (live.length) hits.set(k, live); else hits.delete(k);
  }
}

function rateLimit(keys) {
  const t = now();
  const lists = keys.map((k) => (hits.get(k) || []).filter((x) => t - x < RATE_WINDOW_MS));
  if (lists.some((l) => l.length >= RATE_MAX)) throw new RateLimitedError('rate_limited');
  keys.forEach((k, i) => hits.set(k, [...lists[i], t]));
}

async function postForm(url, params) {
  const { data } = await axios.post(url, new URLSearchParams(params).toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    timeout: 10000,
  });
  return data;
}

function eligible(user, channel) {
  if (!user || user.enabled === false) return false;
  return channel === 'sms' ? Boolean(user.mobilePhone) : Boolean(user.email);
}

async function startLogin({ identifier, channel, role, req, provider = 'pingone' }) {
  assertProvider();
  const started = now();
  const clock0 = Date.now();
  sweep();
  const idKey = `id:${String(identifier).trim().toLowerCase()}`;
  rateLimit([idKey, `ip:${req.ip}`]);   // throws RateLimitedError before anything else happens
  if (pending.size >= MAX_ENTRIES) throw new RateLimitedError('capacity');

  const matchCode = newMatchCode(verticalManifest.resolver.activeIdFor(req));
  const entry = { sessionId: req.sessionID, role, channel, provider, matchCode, decoy: true, createdAt: started, expiresAt: started + EXPIRES_IN * 1000 };

  try {
    const { user } = await resolvePingOneIdentifier(String(identifier).trim());
    if (eligible(user, channel)) {
      const { config } = roleBundle(role);
      const data = await postForm(`${config._base}/cibaAuthorization`, {
        client_id: config.clientId,
        client_secret: config.clientSecret,
        login_hint: user.username,
        scope: scopeString(config),
        binding_message: matchCode,
        acr_values: POLICY[channel](),
      });
      if (data?.auth_req_id) Object.assign(entry, { decoy: false, pingAuthReqId: data.auth_req_id, expectedSub: user.id, user });
    }
  } catch (err) {
    // A real user whose request failed must look exactly like a decoy: log, never surface.
    console.warn('[cibaLogin] start failed for %s: %s', mask(identifier), err.response?.data?.error || err.message);
  }

  // Decoys skip the PingOne round trip, so pad every start to the same floor.
  const wait = floorMs() - (Date.now() - clock0);
  if (wait > 0) await sleep(wait);

  const authReqId = crypto.randomBytes(24).toString('hex');
  pending.set(authReqId, entry);
  req.session.cibaLoginStarted = true; // modify the session so its cookie is issued (saveUninitialized:false)
  return { authReqId, matchCode, expiresIn: EXPIRES_IN, interval: INTERVAL };
}

async function buildUser(entry, tokenData, idClaims, userInfo) {
  const { userSvc } = roleBundle(entry.role);
  const svc = userSvc();
  const merged = { ...idClaims, ...userInfo, iss: idClaims.iss, sub: idClaims.sub };
  const oauthUser = svc.createUserFromOAuth(merged);
  let user = dataStore.getUserByUsername(oauthUser.username);

  if (entry.role === 'admin') {
    oauthUser.role = 'admin'; // admin login app always grants admin (mirrors routes/oauth.js)
    user = user
      ? await dataStore.updateUser(user.id, {
        ...(oauthUser.email ? { email: oauthUser.email } : {}),
        ...(oauthUser.firstName ? { firstName: oauthUser.firstName } : {}),
        ...(oauthUser.lastName ? { lastName: oauthUser.lastName } : {}),
        role: oauthUser.role, oauthProvider: oauthUser.oauthProvider, oauthId: oauthUser.oauthId,
      })
      : await dataStore.createUser({ ...oauthUser, password: null });
    return user;
  }

  // Customer: same role rules as the end-user callback (population is absent from CIBA userinfo).
  oauthUser.role = resolveEndUserAdminSignals(merged, oauthUser.username).isAdmin ? 'admin' : 'customer';
  if (!user) {
    user = await dataStore.createUser({ ...oauthUser, password: null });
  } else {
    user = await dataStore.updateUser(user.id, {
      ...(oauthUser.email ? { email: oauthUser.email } : {}),
      ...(oauthUser.firstName ? { firstName: oauthUser.firstName } : {}),
      ...(oauthUser.lastName ? { lastName: oauthUser.lastName } : {}),
      role: oauthUser.role, oauthProvider: oauthUser.oauthProvider, oauthIssuer: oauthUser.oauthIssuer, oauthId: oauthUser.oauthId,
    });
  }
  if (user.role === 'customer') {
    try {
      await require('../routes/oauthUser').reseedIfVerticalMismatch(user.id, user.firstName, user.lastName);
    } catch (e) { console.error('[cibaLogin] reseed failed:', e.message); }
  }
  return user;
}

async function complete(entry, tokenData, req, res) {
  const { config, userSvc, oauthType } = roleBundle(entry.role);
  const idClaims = await validateToken(tokenData.id_token, {
    jwksUri: config.jwksEndpoint, issuer: config.issuer, audience: config.clientId, algorithms: ALGORITHMS,
  });
  // The person who approved must be the person identified at start (PingOne user id; PF users are out of scope here).
  if (!idClaims || typeof idClaims.sub !== 'string' || idClaims.sub !== entry.expectedSub) {
    console.warn('[cibaLogin] sub mismatch for %s - refusing', mask(entry.user?.username));
    return { status: 'expired' };
  }
  const userInfo = await userSvc().getUserInfo(tokenData.access_token);
  assertUserInfoSubjectMatches(userInfo, idClaims);

  // Admin escalation guard: CIBA replaces the admin app's MFA sign-on policy, so admin needs a POSITIVE admin
  // signal (allowlist / claim / resolver / population), not just "came through the admin app".
  const mergedForRole = { ...idClaims, ...userInfo, iss: idClaims.iss, sub: idClaims.sub };
  if (entry.role === 'admin'
    && !resolveEndUserAdminSignals(mergedForRole, mergedForRole.preferred_username || mergedForRole.username || mergedForRole.email || mergedForRole.sub).isAdmin) {
    console.warn('[cibaLogin] admin login refused (no admin signal) for %s', mask(entry.user?.username));
    return { status: 'denied' };
  }

  const hostedPolicy = loadHostedAccessPolicy();
  const hostedDecision = hostedPolicy.enabled
    ? evaluateHostedIdentity(coherentHostedIdentityClaims(idClaims, userInfo), hostedPolicy) : null;
  if (hostedDecision && !hostedDecision.allowed) {
    clearHostedAccessApproval(req.session);
    delete req.session.oauthTokens; delete req.session.user; delete req.session.clientType; delete req.session.oauthType;
    clearAuthCookie(res, _isProd());
    return { status: 'denied' };
  }

  const user = await buildUser(entry, tokenData, idClaims, userInfo);
  if (oauthType === 'user' && entry.user?.mobilePhone && !user.phone) user.phone = entry.user.mobilePhone;
  const sessionOpts = {
    tokenData, provider: entry.provider, clientType: determineClientType(tokenData.access_token), user,
    onRegenerated: (session) => { if (hostedDecision) stampHostedAccessApproval(session, hostedDecision, hostedPolicy); },
  };
  const established = oauthType === 'admin'
    ? await establishAdminSession(req, res, sessionOpts)
    : await establishUserSession(req, res, { ...sessionOpts, idTokenClaims: idClaims, loginTraceId: null });
  if (!established.ok) {
    // Same cleanup as the callbacks: no authenticated session or cookie may survive a failed setup.
    clearAuthCookie(res, _isProd());
    if (established.reason !== 'session_regenerate_failed') {
      await new Promise((r) => req.session.destroy((e) => { if (e) console.error('[cibaLogin] session.destroy failed:', e.message); r(); }));
    }
    return { status: 'expired' };
  }

  setAuthCookie(res, {
    ...user, oauthType, expiresAt: established.oauthTokens.expiresAt, idToken: established.oauthTokens.idToken || null,
  }, _isProd());
  res.clearCookie('_switch_target', { path: '/', sameSite: _isProd() ? 'none' : 'lax', secure: _isProd() });
  const path = oauthType === 'admin' ? '/admin?oauth=success' : '/dashboard?oauth=success';
  return { status: 'approved', redirectTo: `${getFrontendOrigin()}${path}` };
}

/** -> { status: 'pending' | 'approved' | 'expired' | 'denied' | 'notfound', redirectTo? } */
async function pollLogin(args) {
  assertProvider();
  const t0 = Date.now();
  const result = await pollOnce(args);
  const floor = pollFloorMs();
  const wait = floor + Math.random() * floor * 0.25 - (Date.now() - t0);
  if (wait > 0) await sleep(wait);
  return result;
}

async function pollOnce({ authReqId, req, res }) {
  sweep();
  const entry = pending.get(authReqId);
  if (!entry) return { status: 'notfound' };
  if (entry.consumed) return { status: 'expired' };          // one-shot: finished ids stay 410
  if (entry.sessionId !== req.sessionID) return { status: 'notfound' }; // not this browser's request
  if (now() >= entry.expiresAt) { entry.consumed = true; return { status: 'expired' }; }
  if (entry.decoy || entry.inFlight) return { status: 'pending' };

  entry.inFlight = true;
  try {
    const { config } = roleBundle(entry.role);
    let tokenData;
    try {
      tokenData = await postForm(config.tokenEndpoint, {
        grant_type: 'urn:openid:params:grant-type:ciba',
        auth_req_id: entry.pingAuthReqId,
        client_id: config.clientId,
        client_secret: config.clientSecret,
      });
    } catch (err) {
      const code = err.response?.data?.error;
      if (code === 'authorization_pending' || code === 'slow_down' || !err.response) return { status: 'pending' };
      entry.consumed = true;
      console.warn('[cibaLogin] poll ended for %s: %s', mask(entry.user?.username), SPA_FAILURE.includes(code) ? code : 'error');
      return { status: 'expired' };
    }
    entry.consumed = true; // PingOne tokens are one-time: whatever happens next, this id is finished
    try {
      return await complete(entry, tokenData, req, res);
    } catch (err) {
      console.error('[cibaLogin] completion failed for %s: %s', mask(entry.user?.username), err.message);
      return { status: 'expired' };
    }
  } finally {
    entry.inFlight = false;
  }
}

module.exports = {
  startLogin, pollLogin, RateLimitedError, ProviderUnsupportedError,
  _test: {
    reset() { pending.clear(); hits.clear(); now = () => Date.now(); },
    setNow(fn) { now = fn; },
    sweep, size: () => pending.size,
  },
};
