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

const router = express.Router();

function sanitizeReturnPath(raw) {
  if (typeof raw !== 'string') return '/';
  const value = raw.trim();
  return value.startsWith('/') && !value.startsWith('//') && value.length <= 160
    && /^[/a-zA-Z0-9._~-]+$/.test(value) ? value : '/';
}

function clearHostedOAuthState(session) {
  delete session.hostedOAuthState;
  delete session.hostedOAuthCodeVerifier;
  delete session.hostedOAuthNonce;
  delete session.hostedOAuthRedirectUri;
  delete session.hostedReturnToPath;
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

  const authUrl = hostedOAuth.generateAuthorizationUrl({ state, codeVerifier, redirectUri, nonce, loginHint });
  return req.hostedSession.save((err) => {
    if (err) {
      finishFailure(req, 'session_persist_failed');
      return res.status(500).json({ error: 'hosted_access_login_failed' });
    }
    return res.redirect(authUrl);
  });
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
    const { idTokenClaims, userInfo } = await hostedOAuth.validateIdentity(tokenData);
    if (!idTokenClaims?.nonce) {
      finishFailure(req, 'nonce_missing');
      return destroyAndReply(403);
    }
    if (idTokenClaims.nonce !== session.hostedOAuthNonce) {
      finishFailure(req, 'nonce_mismatch');
      return destroyAndReply(403);
    }
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

router.get('/logout', (req, res) => {
  const returnPath = sanitizeReturnPath(req.query.return_to);
  return req.hostedSession.destroy((err) => {
    if (err) return res.status(500).json({ error: 'hosted_access_logout_failed' });
    return res.redirect(`${getFrontendOrigin()}${returnPath}`);
  });
});

module.exports = router;
