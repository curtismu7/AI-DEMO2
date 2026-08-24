'use strict';

/**
 * enterpriseIdp.js — demo Enterprise IdP for MCP Enterprise-Managed Authorization.
 *
 * PingOne does not yet issue ID-JAG assertions, so this endpoint performs the
 * signing step only. PingOne remains the authority for identity and group policy:
 * enterpriseMcpPolicyService.checkPolicy is what decides PERMIT/DENY here.
 *
 * The policy gate runs BEFORE minting on purpose. The extension requires that a
 * client never receive a token for a server it is not authorized for, so a denied
 * user gets an OAuth error and no assertion at all.
 *
 * @see docs/superpowers/specs/2026-08-22-enterprise-managed-mcp-authorization-design.md
 */

const express = require('express');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const axios = require('axios');

const router = express.Router();
const configStore = require('../services/configStore');
const enterpriseMcpPolicy = require('../services/enterpriseMcpPolicyService');
const enterpriseIdpKey = require('../services/enterpriseIdpKey');
const clientRegistry = require('../services/enterpriseIdpClientRegistry');
const authStore = require('../services/enterpriseIdpAuthStore');
const { getJwtClaim } = require('../utils/jwtDecoder');

const ID_JAG_TOKEN_TYPE = 'urn:ietf:params:oauth:token-type:id-jag';
const TOKEN_EXCHANGE_GRANT = 'urn:ietf:params:oauth:grant-type:token-exchange';
const AUTHORIZATION_CODE_GRANT = 'authorization_code';
const ID_JAG_LIFETIME_SECONDS = 120;
const ID_TOKEN_LIFETIME_SECONDS = 1800;

function issuer() {
  return configStore.getEffective('enterprise_idp_issuer') || '';
}

function callbackUri() {
  return `${issuer()}/api/enterprise-idp/authorize/callback`;
}

/** Public JWKS so the MCP Authorization Server can verify our assertions. */
router.get('/jwks', (_req, res) => {
  res.json({ keys: [enterpriseIdpKey.getPublicJwk()] });
});

/**
 * EMA leg 1, step 1 (RFC 6749 authorization endpoint). Federates to PingOne's
 * real login exactly the way oauth-mcp's own /authorize already federates for
 * the external-door flow (see oauth-mcp/src/oauth/OAuthRouter.ts) — this
 * demo IdP is a public-shaped RP on the outbound PingOne hop with its own,
 * separate PKCE pair, entirely independent of the downstream client's PKCE.
 */
router.get('/authorize', (req, res) => {
  const { client_id: clientId, redirect_uri: redirectUri, response_type: responseType } = req.query;
  const scope = req.query.scope || 'openid';
  const clientState = req.query.state || '';
  const codeChallenge = req.query.code_challenge;
  const codeChallengeMethod = req.query.code_challenge_method || 'S256';

  if (!clientId || !redirectUri || responseType !== 'code') {
    return res.status(400).json({ error: 'invalid_request', error_description: 'client_id, redirect_uri and response_type=code are required' });
  }

  const client = clientRegistry.getClient(clientId);
  if (!client) {
    return res.status(400).json({ error: 'invalid_client', error_description: 'Unknown client_id' });
  }
  if (!clientRegistry.validateRedirectUri(clientId, redirectUri)) {
    return res.status(400).json({ error: 'invalid_request', error_description: 'redirect_uri not registered for this client' });
  }
  if (!codeChallenge) {
    return res.status(400).json({ error: 'invalid_request', error_description: 'PKCE code_challenge is required' });
  }

  const pingOneClientId = process.env.ENTERPRISE_IDP_PINGONE_CLIENT_ID;
  const pingOneAuthEndpoint = process.env.PINGONE_AUTHORIZATION_ENDPOINT;
  if (!pingOneClientId || !pingOneAuthEndpoint) {
    return res.status(503).json({
      error: 'temporarily_unavailable',
      error_description: 'PingOne federation is not configured (ENTERPRISE_IDP_PINGONE_CLIENT_ID / PINGONE_AUTHORIZATION_ENDPOINT)',
    });
  }

  const pingOneCodeVerifier = crypto.randomBytes(32).toString('base64url');
  const pingOneCodeChallenge = crypto.createHash('sha256').update(pingOneCodeVerifier).digest('base64url');

  const relayState = authStore.createPendingAuthorization({
    clientId, redirectUri, scope, codeChallenge, codeChallengeMethod, clientState, pingOneCodeVerifier,
  });

  const pingOneAuthorize = new URL(pingOneAuthEndpoint);
  pingOneAuthorize.searchParams.set('client_id', pingOneClientId);
  pingOneAuthorize.searchParams.set('redirect_uri', callbackUri());
  pingOneAuthorize.searchParams.set('response_type', 'code');
  pingOneAuthorize.searchParams.set('state', relayState);
  pingOneAuthorize.searchParams.set('code_challenge', pingOneCodeChallenge);
  pingOneAuthorize.searchParams.set('code_challenge_method', 'S256');
  pingOneAuthorize.searchParams.set('scope', 'openid profile email');

  res.redirect(302, pingOneAuthorize.toString());
});

/**
 * EMA leg 1, step 2. PingOne's login is real; this exchanges its code for a
 * real PingOne access token (server-to-server, TLS + client_secret — already
 * a trusted channel, so we decode rather than re-verify, matching this repo's
 * existing jwtDecoder.js convention), then mints our OWN one-time code bound
 * to the resolved subject for the ORIGINAL client to redeem at /token.
 */
router.get('/authorize/callback', async (req, res) => {
  const { code, state: relayState, error: pingOneError } = req.query;

  if (pingOneError) {
    return res.status(400).json({ error: 'access_denied', error_description: `PingOne login failed: ${pingOneError}` });
  }
  if (!code || !relayState) {
    return res.status(400).json({ error: 'invalid_request', error_description: 'Missing code or state from PingOne callback' });
  }

  const pending = authStore.consumePendingAuthorization(relayState);
  if (!pending) {
    return res.status(400).json({ error: 'invalid_grant', error_description: 'Unknown or expired authorization request' });
  }

  const pingOneClientId = process.env.ENTERPRISE_IDP_PINGONE_CLIENT_ID;
  const pingOneClientSecret = process.env.ENTERPRISE_IDP_PINGONE_CLIENT_SECRET;
  const pingOneTokenEndpoint = process.env.PINGONE_TOKEN_ENDPOINT;
  if (!pingOneClientId || !pingOneClientSecret || !pingOneTokenEndpoint) {
    return res.status(503).json({ error: 'temporarily_unavailable', error_description: 'PingOne federation is not configured' });
  }

  let subject;
  let email;
  try {
    const tokenParams = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: callbackUri(),
      client_id: pingOneClientId,
      client_secret: pingOneClientSecret,
      code_verifier: pending.pingOneCodeVerifier,
    });
    const tokenResponse = await axios.post(pingOneTokenEndpoint, tokenParams.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    const pingOneAccessToken = tokenResponse.data.access_token;
    subject = getJwtClaim(pingOneAccessToken, 'sub');
    email = getJwtClaim(pingOneAccessToken, 'email');
    if (!subject) throw new Error('PingOne access token has no sub claim');
  } catch (err) {
    return res.status(502).json({ error: 'server_error', error_description: `PingOne login verification failed: ${err.message}` });
  }

  const ownCode = authStore.createCode({
    clientId: pending.clientId,
    redirectUri: pending.redirectUri,
    scope: pending.scope,
    codeChallenge: pending.codeChallenge,
    codeChallengeMethod: pending.codeChallengeMethod,
    subject,
    ...(email ? { email } : {}),
  });

  const callback = new URL(pending.redirectUri);
  callback.searchParams.set('code', ownCode);
  if (pending.clientState) callback.searchParams.set('state', pending.clientState);
  res.redirect(302, callback.toString());
});

/**
 * Verifies a bearer token as one WE previously self-signed (the ID token
 * minted by the authorization_code grant below) — a local RS256 signature
 * check against our own key, no external call. Returns { sub, email } or
 * throws.
 */
function verifyOwnIdToken(token) {
  const publicKeyPem = crypto
    .createPublicKey({ key: enterpriseIdpKey.getPublicJwk(), format: 'jwk' })
    .export({ type: 'spki', format: 'pem' });
  const payload = jwt.verify(token, publicKeyPem, { algorithms: ['RS256'], issuer: issuer() });
  return { sub: payload.sub, email: payload.email };
}

/**
 * EMA leg 1, step 3 (RFC 6749 token endpoint, authorization_code grant).
 * Redeems the code minted at /authorize/callback for a self-signed ID token
 * — the identity assertion the MCP client (Inspector) then presents as
 * subject_token to the token-exchange grant below.
 */
async function handleAuthorizationCodeGrant(req, res) {
  const { code, code_verifier: codeVerifier, client_id: clientId, client_secret: clientSecret } = req.body || {};

  const entry = authStore.consumeCode(code);
  if (!entry) {
    return res.status(400).json({ error: 'invalid_grant', error_description: 'Unknown or expired code' });
  }

  const challenge = crypto.createHash('sha256').update(codeVerifier || '').digest('base64url');
  if (challenge !== entry.codeChallenge) {
    return res.status(400).json({ error: 'invalid_grant', error_description: 'code_verifier does not match code_challenge' });
  }

  if (!clientRegistry.validateClientCredentials(clientId, clientSecret) || clientId !== entry.clientId) {
    return res.status(400).json({ error: 'invalid_client', error_description: 'Unknown client or wrong client_secret' });
  }

  const now = Math.floor(Date.now() / 1000);
  const idToken = jwt.sign(
    {
      iss: issuer(),
      sub: entry.subject,
      ...(entry.email ? { email: entry.email } : {}),
      aud: clientId,
      iat: now,
      exp: now + ID_TOKEN_LIFETIME_SECONDS,
    },
    enterpriseIdpKey.getPrivateKeyPem(),
    { algorithm: 'RS256', header: { alg: 'RS256', kid: enterpriseIdpKey.getKid() } },
  );

  return res.json({ id_token: idToken, token_type: 'Bearer', expires_in: ID_TOKEN_LIFETIME_SECONDS, scope: entry.scope });
}

/**
 * RFC 8693 exchange issuing an ID-JAG.
 * Body: grant_type, requested_token_type, subject_token, subject_token_type,
 *       audience (MCP AS issuer), resource (MCP server), scope.
 */
router.post('/token', express.json(), express.urlencoded({ extended: false }), async (req, res) => {
  try {
    if (req.body && req.body.grant_type === AUTHORIZATION_CODE_GRANT) {
      return await handleAuthorizationCodeGrant(req, res);
    }

    const { grant_type, requested_token_type, subject_token, audience, resource, scope } = req.body || {};

    if (grant_type !== TOKEN_EXCHANGE_GRANT || requested_token_type !== ID_JAG_TOKEN_TYPE || !subject_token || !audience) {
      return res.status(400).json({
        error: 'invalid_request',
        error_description: 'grant_type=...token-exchange, requested_token_type=...id-jag, subject_token and audience are required',
      });
    }

    // The BFF's own orchestrated calls (e.g. UC39) carry a live session and
    // never present subject_token/client credentials — that path is
    // unchanged. An external MCP client (no session) instead presents a
    // subject_token we can verify ourselves (it's our own previously-issued
    // ID token) plus its own client_id/client_secret from the registry.
    let user = req.session && req.session.user;
    if (!user) {
      // subject_token's presence was already enforced above (RFC 8693 shape
      // check) — every path reaching here has one; only its verification can
      // still fail.
      if (!clientRegistry.validateClientCredentials(req.body.client_id, req.body.client_secret)) {
        return res.status(400).json({ error: 'invalid_client', error_description: 'Unknown client or wrong client_secret' });
      }
      try {
        const claims = verifyOwnIdToken(subject_token);
        user = { oauthId: claims.sub, email: claims.email };
      } catch (err) {
        return res.status(400).json({ error: 'invalid_grant', error_description: `subject_token verification failed: ${err.message}` });
      }
    }
    if (!user.oauthId) {
      return res.status(401).json({ error: 'invalid_grant', error_description: 'No signed-in user for this exchange.' });
    }

    // Checked before the policy call on purpose: an unapproved resource is a bad
    // request regardless of who is asking, and evaluating policy first would leak
    // a group-membership answer for a server we do not serve.
    if (resource) {
      const allowed = enterpriseMcpPolicy.getAllowedResourceUris();
      if (allowed.length && !allowed.includes(resource)) {
        return res.status(400).json({
          error: 'invalid_target',
          error_description: `resource ${resource} is not an approved MCP server.`,
        });
      }
    }

    // checkPolicy reads req.session.user; an externally-resolved identity (from
    // subject_token, no real session) is handed through the same shape rather
    // than changing checkPolicy itself.
    const policyReq = (req.session && req.session.user) ? req : { session: { user } };
    const policy = await enterpriseMcpPolicy.checkPolicy(policyReq);
    if (!policy.allowed) {
      return res.status(policy.httpStatus || 403).json({
        error: 'access_denied',
        error_description: policy.message || 'Enterprise MCP policy denied.',
        code: policy.code || 'enterprise_mcp_policy_denied',
      });
    }

    const now = Math.floor(Date.now() / 1000);
    const idJag = jwt.sign(
      {
        jti: crypto.randomUUID(),
        iss: configStore.getEffective('enterprise_idp_issuer') || '',
        sub: user.oauthId,
        ...(user.email ? { email: user.email } : {}),
        aud: audience,
        ...(resource ? { resource } : {}),
        client_id: req.body.client_id || 'demo-bff-mcp-client',
        iat: now,
        exp: now + ID_JAG_LIFETIME_SECONDS,
        scope: scope || '',
      },
      enterpriseIdpKey.getPrivateKeyPem(),
      { algorithm: 'RS256', header: { alg: 'RS256', typ: 'oauth-id-jag+jwt', kid: enterpriseIdpKey.getKid() } },
    );

    return res.json({
      issued_token_type: ID_JAG_TOKEN_TYPE,
      access_token: idJag,
      token_type: 'N_A',
      expires_in: ID_JAG_LIFETIME_SECONDS,
    });
  } catch (err) {
    console.error('[enterpriseIdp] /token failed:', err.message);
    return res.status(500).json({ error: 'server_error', error_description: err.message });
  }
});

/**
 * RFC 8414 / OpenID Provider Metadata for this demo IdP — served by server.js
 * at both /.well-known/oauth-authorization-server and
 * /.well-known/openid-configuration on the bare BFF origin (not nested under
 * /api/enterprise-idp), since MCP Inspector's EMA leg 1 discovers the IdP's
 * endpoints from the issuer before it knows anything else about this server.
 */
function buildDiscoveryDocument() {
  const base = issuer();
  return {
    issuer: base,
    authorization_endpoint: `${base}/api/enterprise-idp/authorize`,
    token_endpoint: `${base}/api/enterprise-idp/token`,
    jwks_uri: `${base}/api/enterprise-idp/jwks`,
    response_types_supported: ['code'],
    subject_types_supported: ['public'],
    id_token_signing_alg_values_supported: ['RS256'],
    scopes_supported: ['openid', 'profile', 'email'],
    token_endpoint_auth_methods_supported: ['client_secret_post'],
    code_challenge_methods_supported: ['S256'],
    grant_types_supported: [AUTHORIZATION_CODE_GRANT, TOKEN_EXCHANGE_GRANT],
  };
}

router.buildDiscoveryDocument = buildDiscoveryDocument;

module.exports = router;
