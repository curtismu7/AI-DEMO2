'use strict';

const express = require('express');
const crypto = require('crypto');
const hostedOAuth = require('../services/hostedAccessOAuthService');
const { getFrontendOrigin, validateRedirectUriOrigin } = require('../services/oauthRedirectUris');
const {
  loadHostedAccessPolicy,
  evaluateHostedIdentity,
  coherentHostedIdentityClaims,
  stampHostedAccessApproval,
} = require('../services/hostedAccessPolicy');
const { startLoginAudit, resumeLoginAudit, finishLoginAudit } = require('../services/authAccessAuditService');
const { resolvePingOneIdentifier } = require('../services/pingOneUserLookupService');
const { hostedAccessCheck, sendAccessRestricted } = require('../middleware/hostedAccessGate');
const { makePiFlowHandlers } = require('../services/piFlowDriver');
const configStore = require('../services/configStore');

// pi.flow needs the PingOne front-door app; under another provider the redirect stays the only way in.
const piFlowAvailable = () => configStore.getOAuthProvider?.() !== 'pingfederate';

const router = express.Router();

// Redirect-free front-door sign-in (PingOne pi.flow), driven by the SAME shared driver the app login uses.
// The driver reads/writes req.session; the front door keeps its state in the separate hosted session, so each
// call runs against a view of the request whose `session` IS the hosted session. The authorization code still
// lands on the UNCHANGED /callback below, so state, PKCE, nonce and the allowlist decision stay in one place.
const piFlow = makePiFlowHandlers({ providerConfig: require('../config/hostedAccess'), knownRedirectOrigins: [] });
const onHostedSession = (req) => Object.create(req, { session: { value: req.hostedSession } });
// Steps the front door does not drive (MFA device/OTP). Send the SPA to the hosted page instead.
const UNDRIVEN_STEPS = new Set(['otp', 'device', 'approval', 'passkey']);

function sanitizeReturnPath(raw) {
  if (typeof raw !== 'string') return '/';
  const value = raw.trim();
  // Optional query string: the wall redirects /api/auth/oauth/user/login?return_to=/page here and the
  // page must survive the trip. Origin is prepended on redirect, so a query cannot make this off-site.
  return value.startsWith('/') && !value.startsWith('//') && value.length <= 160
    && /^\/[/a-zA-Z0-9._~-]*(\?[a-zA-Z0-9._~%=&-]*)?$/.test(value) ? value : '/';
}

function clearHostedOAuthState(session) {
  delete session.hostedOAuthState;
  delete session.hostedOAuthCodeVerifier;
  delete session.hostedOAuthNonce;
  delete session.hostedOAuthRedirectUri;
  delete session.hostedReturnToPath;
  delete session.oauthState;
  delete session.oauthRedirectUri;
  delete session.oauthPiFlow;
}

function finishFailure(req, reasonCode) {
  finishLoginAudit(req, { outcome: 'failure', reasonCode });
}

router.get('/login', async (req, res) => {
  const policy = loadHostedAccessPolicy();
  if (!policy.enabled) return res.redirect(`${getFrontendOrigin()}${sanitizeReturnPath(req.query.return_to)}`);

  const redirectUri = require('../config/hostedAccess').redirectUri;
  const uriCheck = validateRedirectUriOrigin(redirectUri);
  if (!uriCheck.ok || !require('../config/hostedAccess').clientId) {
    return res.status(503).json({ error: 'hosted_access_not_configured' });
  }

  req.hostedAudit = true;
  const state = hostedOAuth.generateState();
  const codeVerifier = hostedOAuth.generateCodeVerifier();
  const nonce = crypto.randomBytes(16).toString('hex');
  req.hostedSession.hostedOAuthState = state;
  req.hostedSession.hostedOAuthCodeVerifier = codeVerifier;
  req.hostedSession.hostedOAuthNonce = nonce;
  req.hostedSession.hostedOAuthRedirectUri = redirectUri;
  req.hostedSession.hostedReturnToPath = sanitizeReturnPath(req.query.return_to);
  startLoginAudit(req, 'frontdoor', Date.now(), state);

  // Optional identifier pre-resolve: accept PingOne user ID, username, or
  // email, and hand PingOne the canonical username via login_hint so the
  // hosted sign-on screen skips identifier entry (PingOne matches the
  // username field only).
  let loginHint;
  const identifier = typeof req.query.identifier === 'string' ? req.query.identifier.trim() : '';
  if (identifier) {
    try {
      const { user } = await resolvePingOneIdentifier(identifier);
      if (user?.username) loginHint = user.username;
    } catch (err) {
      console.warn('[hostedAccess] identifier resolution failed:', err.message);
    }
  }

  const wantsPiFlow = req.query.pi_flow === '1' && piFlowAvailable();
  const authUrl = hostedOAuth.generateAuthorizationUrl({ state, codeVerifier, redirectUri, nonce, loginHint, responseMode: wantsPiFlow ? 'pi.flow' : undefined });
  if (wantsPiFlow) {
    // finishPiFlow builds the callback URL from these two keys.
    req.hostedSession.oauthState = state;
    req.hostedSession.oauthRedirectUri = redirectUri;
    return piFlow.openPiFlow(onHostedSession(req), res, authUrl, 'pingone');
  }
  return req.hostedSession.save((err) => {
    if (err) {
      finishFailure(req, 'session_persist_failed');
      return res.status(500).json({ error: 'hosted_access_login_failed' });
    }
    return res.redirect(authUrl);
  });
});

// Password step of the front-door pi.flow. Anything but a finished password flow answers {fallback:true}.
router.post('/pi-flow/credentials', (req, res) => {
  if (!piFlowAvailable()) return res.status(404).json({ error: 'pi_flow_unavailable' });
  // res is per-request, so wrapping json here cannot leak; status codes the driver sets pass through untouched.
  const sendJson = res.json.bind(res);
  res.json = (payload) => {
    if (payload && UNDRIVEN_STEPS.has(payload.step)) {
      delete req.hostedSession.oauthPiFlow;
      return sendJson({ fallback: true, status: payload.step });
    }
    return sendJson(payload);
  };
  return piFlow.handleCredentialsStep(onHostedSession(req), res);
});

router.get('/callback', async (req, res) => {
  req.hostedAudit = true;
  const { code, state, error } = req.query;
  resumeLoginAudit(req, state, 'frontdoor');
  const session = req.hostedSession;
  const destroyAndReply = (status = 403) => session.destroy(() => sendAccessRestricted(res, status));

  if (error) {
    finishFailure(req, 'oauth_provider_error');
    return destroyAndReply(403);
  }
  if (!code) {
    finishFailure(req, 'authorization_code_missing');
    return destroyAndReply(403);
  }
  if (!state || state !== session.hostedOAuthState) {
    finishFailure(req, 'invalid_state');
    return destroyAndReply(403);
  }
  if (!session.hostedOAuthCodeVerifier || !session.hostedOAuthNonce) {
    finishFailure(req, 'callback_failed');
    return destroyAndReply(403);
  }


  try {
    const tokenData = await hostedOAuth.exchangeCodeForToken(code, session.hostedOAuthCodeVerifier, session.hostedOAuthRedirectUri);
    const { idTokenClaims, userInfo } = await hostedOAuth.validateIdentity(tokenData, session.hostedOAuthNonce);
    const policy = loadHostedAccessPolicy();
    const claims = coherentHostedIdentityClaims(idTokenClaims, userInfo);
    const decision = evaluateHostedIdentity(claims, policy);
    if (!decision.allowed) {
      finishLoginAudit(req, { outcome: 'denied', reasonCode: decision.reason, identity: decision });
      return destroyAndReply(403);
    }

    stampHostedAccessApproval(session, decision, policy);
    session.hostedAccessIdentity = { subject: decision.subject };
    const returnPath = session.hostedReturnToPath || '/';
    clearHostedOAuthState(session);
    return session.save((saveErr) => {
      if (saveErr) {
        finishFailure(req, 'session_persist_failed');
        return res.status(500).json({ error: 'hosted_access_login_failed' });
      }
      finishLoginAudit(req, { outcome: 'success', reasonCode: 'allowed', identity: decision });
      return res.redirect(`${getFrontendOrigin()}${sanitizeReturnPath(returnPath)}`);
    });
  } catch (err) {
    finishFailure(req, err.reasonCode || 'callback_failed');
    return destroyAndReply(403);
  }
});

router.get('/check', hostedAccessCheck());

// Public sign-up policy for the sign-in modal: which identifiers are exempt
// from plus-addressing rejection. The modal fetches this so the front-end
// check and the server-side gate can never disagree. No secrets: the
// allowlist is demo test-account names, and the endpoint is in the ingress
// oauth-bypass list alongside /login.
router.get('/identifier-policy', (req, res) => {
  const policy = loadHostedAccessPolicy();
  return res.json({
    rejectPlusAddressing: Boolean(policy.enabled && policy.rejectPlusAddressing),
    // The SPA only asks for the front-door modal when the wall is on and pi.flow can run.
    frontDoorPiFlow: Boolean(policy.enabled && piFlowAvailable()),
    allowedIdentifiers: policy.allowedIdentifiers,
  });
});

router.get('/logout', (req, res) => {
  const returnPath = sanitizeReturnPath(req.query.return_to);
  return req.hostedSession.destroy((err) => {
    if (err) return res.status(500).json({ error: 'hosted_access_logout_failed' });
    return res.redirect(`${getFrontendOrigin()}${returnPath}`);
  });
});

module.exports = router;
