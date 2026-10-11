'use strict';
/**
 * Support-console customer delegation ceremony.
 *
 * Headless PingOne pi.flow sign-on for the CUSTOMER (BFF drives; the operator
 * witnesses), producing a real customer access token in the operator's
 * server-side session, then (Task 3) a real RFC 8693 exchange with the admin
 * client as actor.
 *
 * pi.flow step shapes mirror services/piFlowDriver.js — the reference
 * implementation. piFlowDriver's handlers are Express-coupled to the
 * operator's OWN sign-in session state (req.session.oauthPiFlow /
 * oauthState / oauthRedirectUri), so this service drives the flow directly
 * under req.session.support and never touches those keys.
 *
 * Session shape (spec §Session shape):
 *   support = { customerUsername, customerId, pingOneUserId, pendingFlow?,
 *               codeVerifier, state, nonce, redirectUri, subjectToken?,
 *               subjectClaims?, idToken?, expiresAt?, verifiedUntil }
 * The customer token never leaves the server.
 */
const crypto = require('crypto');
const configStore = require('./configStore');
const oauthUserConfig = require('../config/oauthUser');
const oauthUserService = require('./oauthUserService');
const oauthService = require('./oauthService');
const { getUserRedirectUri } = require('./oauthRedirectUris');
const { decodeJwt } = require('../utils/tokenUtils');

const FLOW_TIMEOUT_MS = 10000;
const VERIFY_TTL_MS = 15 * 60 * 1000;
const SUPPORT_VERIFY_TTL_MS = VERIFY_TTL_MS;
const FLOW_MAX_AGE_MS = 5 * 60 * 1000;
const PI_FLOW_ID = /^[A-Za-z0-9_-]{6,64}$/;

const base = () => String(oauthUserConfig.authorizationEndpoint).replace(/\/as\/authorize.*$/, '');
const stepUrl = (flowId) => `${base()}/flows/${flowId}`;
const cookieHeader = (jar) => Object.entries(jar || {}).map(([k, v]) => `${k}=${v}`).join('; ');

function mergeCookies(jar, res) {
  const out = { ...(jar || {}) };
  const raws = res.headers.getSetCookie
    ? res.headers.getSetCookie()
    : [res.headers.get('set-cookie')].filter(Boolean);
  for (const raw of raws) {
    const [pair] = String(raw).split(';');
    const eq = pair.indexOf('=');
    if (eq > 0) out[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim();
  }
  return out;
}

async function postStep(pending, contentType, payload) {
  const res = await fetch(stepUrl(pending.flowId), {
    method: 'POST',
    headers: { 'Content-Type': contentType, Accept: 'application/json', Cookie: cookieHeader(pending.cookies) },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(FLOW_TIMEOUT_MS),
  });
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, body, cookies: mergeCookies(pending.cookies, res) };
}

function err(status, code, message) {
  const e = new Error(message || code);
  e.status = status;
  e.code = code;
  throw e;
}

/** Masked contact from the flow's device list — never the full number. */
function maskedContactFrom(devices) {
  const device = devices.find((d) => d && (d.phone?.number || typeof d.phone === 'string' || d.email))
    || devices[0];
  if (!device) return 'registered device';
  const phone = device.phone?.number || (typeof device.phone === 'string' ? device.phone : '');
  if (phone) {
    const digits = String(phone).replace(/\D/g, '');
    return `••••${digits.slice(-2)}`;
  }
  if (device.email) {
    const [local, domain] = String(device.email).split('@');
    return `${local.slice(0, 2)}•••@${domain || ''}`;
  }
  return device.type || 'registered device';
}

/** Customer-identity proof ceremony, phase 1: open flow + password, stop at OTP. */
async function openCustomerSignon(req, { username, pingOneUserId, customerId } = {}) {
  if ((configStore.getOAuthProvider?.() || 'pingone') !== 'pingone') {
    err(502, 'pi_flow_provider_unsupported', 'pi.flow sign-on is PingOne-only');
  }
  const state = oauthService.generateState();
  const codeVerifier = oauthUserService.generateCodeVerifier();
  const nonce = crypto.randomBytes(16).toString('hex');
  const redirectUri = getUserRedirectUri(req);

  const url = oauthUserService.generateAuthorizationUrl({
    state, codeVerifier, redirectUri, nonce, prompt: 'login', forcePiFlow: true, login_hint: username,
    // The user app's default sign-on policy satisfies on password alone — the
    // ceremony completed with NO MFA (seen live 2026-10-11). Request the MFA
    // policy the same way the modal's ?mfa=1 hook does, so the flow stops at
    // the customer's OTP device: the human moment this ceremony exists for.
    acr_values: require('../config/runtimeSettings').get('stepUpAcrValue') || 'Multi_Factor',
  });
  const res = await fetch(url, { redirect: 'manual', headers: { Accept: '*/*' }, signal: AbortSignal.timeout(FLOW_TIMEOUT_MS) });
  const flow = await res.json().catch(() => null);
  if (!res.ok || !PI_FLOW_ID.test(String(flow?.id || ''))) {
    err(502, 'pi_flow_unavailable', 'PingOne did not open a sign-on flow');
  }
  let pending = { flowId: flow.id, cookies: mergeCookies({}, res), status: flow.status, startedAt: Date.now() };
  let devices = [...(flow?._embedded?.devices || [])];

  if (pending.status === 'SIGN_ON_REQUIRED') {
    const lookup = await postStep(pending, 'application/vnd.pingidentity.user.lookup+json', { username });
    if (!lookup.ok) err(502, 'pi_flow_failed', `user.lookup failed (${lookup.status})`);
    pending.cookies = lookup.cookies;
    pending.status = lookup.body.status;
    devices.push(...(lookup.body._embedded?.devices || []));
  }
  if (pending.status === 'PASSWORD_REQUIRED') {
    const password = configStore.getEffective('demo_password') || process.env.DEMO_PASSWORD || 'Baseball123!';
    const pw = await postStep(pending, 'application/vnd.pingidentity.usernamePassword.check+json', { password });
    if (!pw.ok) err(502, 'pi_flow_failed', `password step failed (${pw.status})`);
    pending.cookies = pw.cookies;
    pending.status = pw.body.status;
    devices.push(...(pw.body._embedded?.devices || []));
  }
  if (pending.status !== 'OTP_REQUIRED' && pending.status !== 'DEVICE_SELECTION_REQUIRED') {
    err(502, 'pi_flow_unexpected_status', `flow stopped at ${pending.status}`);
  }

  req.session.support = {
    customerUsername: username,
    customerId: customerId ?? pingOneUserId ?? null,
    pingOneUserId: pingOneUserId ?? null,
    pendingFlow: pending,
    codeVerifier, state, nonce, redirectUri,
    verifiedUntil: 0,
  };
  await new Promise((r) => req.session.save(r));
  return {
    step: pending.status === 'OTP_REQUIRED' ? 'otp' : 'device',
    maskedContact: maskedContactFrom(devices),
  };
}

/** Phase 2: OTP check → COMPLETED → as/resume → code → token. */
async function submitCustomerOtp(req, { otp } = {}) {
  const s = req.session.support;
  if (!s || !s.pendingFlow) err(410, 'flow_expired', 'No customer sign-on in progress');
  if (Date.now() - s.pendingFlow.startedAt > FLOW_MAX_AGE_MS) {
    delete s.pendingFlow;
    err(410, 'flow_expired', 'Sign-on flow expired — initiate again');
  }
  const pending = s.pendingFlow;
  const check = await postStep(pending, 'application/vnd.pingidentity.otp.check+json', { otp: String(otp ?? '').trim() });
  if (check.status === 400 && check.body?.details?.some((d) => d.code === 'OTP_VALIDATION_FAILED')) {
    // The track stamp rides the same late-require pattern as mcpToolAuditStore.js
    // — best-effort, never part of the error path.
    try { require('./demoTrackService').observeSupportEvent?.({ kind: 'otp-invalid' }, req.sessionID); } catch { /* track observation is optional */ }
    err(401, 'invalid_otp', 'That code is not valid. Check it and try again.'); // pendingFlow kept for retry
  }
  if (!check.ok) err(502, 'pi_flow_failed', `otp.check failed (${check.status})`);

  const resume = await fetch(`${base()}/as/resume?flowId=${pending.flowId}`, {
    headers: { Accept: '*/*', Cookie: cookieHeader(check.cookies) },
    redirect: 'manual',
    signal: AbortSignal.timeout(FLOW_TIMEOUT_MS),
  });
  let code = '';
  const location = resume.headers.get('location');
  if (location) {
    try { code = new URL(location).searchParams.get('code') || ''; } catch (_) { /* not a URL */ }
  }
  if (!code && (resume.headers.get('content-type') || '').includes('json')) {
    code = (await resume.json().catch(() => ({})))?.authorizeResponse?.code || '';
  }
  if (!code) err(502, 'pi_flow_no_code', 'Flow completed but no authorization code came back');
  delete s.pendingFlow;

  const tokenData = await oauthUserService.exchangeCodeForToken(code, s.codeVerifier, s.redirectUri);
  const access = tokenData?.access_token;
  if (!access) err(502, 'token_mint_failed', 'Code redeemed without an access token');
  const claims = decodeJwt(access)?.claims || {};
  s.subjectToken = access;
  s.subjectClaims = claims;
  s.idToken = tokenData.id_token || null;
  s.expiresAt = Date.now() + (Number(tokenData.expires_in) || 3600) * 1000;
  s.verifiedUntil = Date.now() + VERIFY_TTL_MS;
  await new Promise((r) => req.session.save(r));
  try { require('./demoTrackService').observeSupportEvent?.({ kind: 'token-issued' }, req.sessionID); } catch { /* track observation is optional */ }
  return { verified: true, expiresAt: s.verifiedUntil, tokenEvent: buildCustomerTokenEvent(s) };
}

/** Chain event for the customer token — claims only, never the token value. */
function buildCustomerTokenEvent(s) {
  const claims = s?.subjectClaims || {};
  return {
    id: 'customer-token-issued',
    label: 'Customer token issued',
    status: 'done',
    timestamp: new Date().toISOString(),
    claims: {
      sub: claims.sub || null,
      iss: claims.iss || 'PingOne',
      scope: claims.scope || null,
    },
    explanation: 'A real PingOne access token for the customer, minted by their own sign-on (pi.flow + OTP). Held server-side in the operator session; never sent to the browser.',
  };
}

/** The ceremony's own evidence, no secrets. */
function buildSignonEvents(s) {
  return [{
    id: 'customer-signon',
    label: 'Customer sign-on — pi.flow + OTP',
    status: 'done',
    timestamp: new Date().toISOString(),
    claims: { username: s?.customerUsername || null, method: 'password+otp' },
    explanation: 'The operator drove the customer\'s PingOne sign-on server-side (pi.flow: password, then the code from the customer\'s own OTP device). No credentials passed through the browser.',
  }];
}

/** Live verified support session for customerId, or null. */
function liveSupportSession(req, customerId) {
  const s = req.session?.support;
  if (!s || !(s.verifiedUntil > Date.now())) return null;
  if (customerId != null && String(s.customerId) !== String(customerId)) return null;
  return s;
}

/** Delegated-token lifetime: 5 minutes, per spec. */
const EXCHANGE_TOKEN_LIFETIME_S = 300;

/**
 * RFC 8693 exchange for a support write. Subject = the customer's token from
 * the ceremony; actor = a fresh admin-client CC token. PingOne constructs
 * act.sub from the actor token's client_id (actAttributeValue default) —
 * this code never fabricates claims. Minted per call, never persisted.
 */
async function exchangeForWrite(req, { scope, actorClientId } = {}) {
  const s = req.session?.support;
  if (!s?.subjectToken) err(403, 'customer_not_verified', 'Complete the customer sign-on first');
  try {
    const actorToken = await oauthService.getAdminClientCredentialsToken(scope);
    const audience = process.env.ENDUSER_AUDIENCE;
    const delegatedToken = await oauthService.performTokenExchangeWithActor(
      s.subjectToken, actorToken, audience, [scope], { tokenLifetime: EXCHANGE_TOKEN_LIFETIME_S },
    );
    const delegatedClaims = decodeJwt(delegatedToken)?.claims || {};
    return {
      delegatedToken,
      delegatedClaims,
      request: { audience, scope, hasActor: true, actorClientId: actorClientId || null },
    };
  } catch (e) {
    if (e.code === 'customer_not_verified') throw e;
    err(502, 'exchange_failed', `RFC 8693 exchange failed: ${e.message}`);
  }
}

/** Chain event for the exchange — real response claims, never the token value. */
function buildExchangeEvents({ delegatedClaims, request }) {
  return [{
    id: 'exchange',
    label: 'RFC 8693 exchange — act on behalf of',
    status: 'done',
    timestamp: new Date().toISOString(),
    claims: {
      sub: delegatedClaims.sub || null,
      'act.sub': delegatedClaims.act?.sub || null,
      scope: delegatedClaims.scope || null,
      aud: delegatedClaims.aud || null,
      jti: delegatedClaims.jti || null,
    },
    request,
    explanation:
      'Real RFC 8693 exchange at the PingOne token endpoint: subject_token = the customer\'s '
      + 'sign-on token, actor_token = the admin client\'s own credential. PingOne minted the '
      + 'act claim from the actor — this token says "the admin BFF, operated by the signed-in '
      + 'admin, acts for this customer", and carries only the write scope for 5 minutes.',
  }];
}

module.exports = {
  openCustomerSignon,
  submitCustomerOtp,
  buildCustomerTokenEvent,
  buildSignonEvents,
  liveSupportSession,
  exchangeForWrite,
  buildExchangeEvents,
  SUPPORT_VERIFY_TTL_MS,
};
