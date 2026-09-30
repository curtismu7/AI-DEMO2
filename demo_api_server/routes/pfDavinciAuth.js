'use strict';

// A separate PF sign-in proof for the DaVinci Integration Kit lesson. It uses
// the already registered PF end-user client and never replaces the PingOne
// tokens that power the rest of the demo.
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { getFrontendOrigin } = require('../services/oauthRedirectUris');

const LESSON_PATH = '/pingfederate-davinci-kit';
const CALLBACK_PATH = '/api/auth/oauth/user/callback';
const PROOF_MAX_AGE_MS = 15 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 10_000;

function settings() {
  const issuer = (process.env.PF_ISSUER || '').replace(/\/$/, '');
  const clientId = process.env.PF_USER_CLIENT_ID || '';
  const clientSecret = process.env.PF_USER_CLIENT_SECRET || '';
  const redirectUri = process.env.PF_USER_REDIRECT_URI || '';
  let validRedirect = false;
  try {
    const redirect = new URL(redirectUri);
    validRedirect = redirect.origin === new URL(getFrontendOrigin()).origin
      && redirect.pathname === CALLBACK_PATH && !redirect.search && !redirect.hash;
  } catch { /* missing or malformed callback */ }
  return { issuer, clientId, clientSecret, redirectUri, configured: Boolean(
    issuer.startsWith('https://') && clientId && clientSecret && validRedirect
  ) };
}

async function discovery(issuer) {
  const response = await fetch(`${issuer}/.well-known/openid-configuration`, {
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error('PF discovery unavailable');
  const document = await response.json();
  if (document.issuer !== issuer) throw new Error('PF issuer mismatch');
  for (const field of ['authorization_endpoint', 'token_endpoint', 'jwks_uri']) {
    const endpoint = new URL(document[field]);
    if (endpoint.origin !== new URL(issuer).origin) throw new Error(`PF ${field} origin mismatch`);
  }
  return document;
}

function proof(req) {
  const value = req.session?.pfDavinciProof;
  return value?.issuer === settings().issuer && Number(value.expiresAt) > Date.now();
}

function status(req, res) {
  res.json({ configured: settings().configured, authenticated: Boolean(proof(req)) });
}

async function login(req, res) {
  const config = settings();
  if (!config.configured) return res.status(503).json({ error: 'pf_davinci_not_configured' });
  try {
    const metadata = await discovery(config.issuer);
    const state = `pf-${crypto.randomBytes(24).toString('hex')}`;
    const nonce = crypto.randomBytes(24).toString('hex');
    const verifier = crypto.randomBytes(32).toString('base64url');
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
    req.session.pfDavinciPending = { state, nonce, verifier, createdAt: Date.now() };
    delete req.session.pfDavinciProof;
    const url = new URL(metadata.authorization_endpoint);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', config.clientId);
    url.searchParams.set('redirect_uri', config.redirectUri);
    url.searchParams.set('scope', 'openid profile email');
    url.searchParams.set('state', state);
    url.searchParams.set('nonce', nonce);
    url.searchParams.set('code_challenge', challenge);
    url.searchParams.set('code_challenge_method', 'S256');
    url.searchParams.set('prompt', 'login');
    req.session.save((error) => {
      if (error) return res.status(500).json({ error: 'pf_davinci_session_save_failed' });
      res.redirect(url.toString());
    });
  } catch (error) {
    console.warn('[pf-davinci/login] PF discovery failed:', error.message);
    res.status(502).json({ error: 'pf_davinci_discovery_failed' });
  }
}

async function callback(req, res) {
  const config = settings();
  const pending = req.session?.pfDavinciPending;
  delete req.session.pfDavinciPending;
  const failure = () => res.redirect(`${getFrontendOrigin()}${LESSON_PATH}?pf_davinci=error`);
  if (!config.configured || !pending || req.query.state !== pending.state
    || Date.now() - pending.createdAt > 5 * 60 * 1000 || req.query.error
    || typeof req.query.code !== 'string') return failure();
  try {
    const metadata = await discovery(config.issuer);
    const body = new URLSearchParams({
      grant_type: 'authorization_code', code: req.query.code,
      redirect_uri: config.redirectUri, code_verifier: pending.verifier,
    });
    const tokenResponse = await fetch(metadata.token_endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!tokenResponse.ok) throw new Error(`PF token endpoint returned ${tokenResponse.status}`);
    const tokens = await tokenResponse.json();
    if (typeof tokens.id_token !== 'string') throw new Error('PF did not issue an ID token');
    const header = jwt.decode(tokens.id_token, { complete: true })?.header;
    if (!header?.kid || !['RS256', 'RS384', 'RS512', 'ES256', 'ES384', 'ES512'].includes(header.alg)) {
      throw new Error('Unsupported PF ID token header');
    }
    const jwksResponse = await fetch(metadata.jwks_uri, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    if (!jwksResponse.ok) throw new Error('PF JWKS unavailable');
    const jwks = await jwksResponse.json();
    const keyType = header.alg.startsWith('RS') ? 'RSA' : 'EC';
    const key = jwks.keys?.find((candidate) => candidate.kid === header.kid
      && candidate.kty === keyType && (!candidate.alg || candidate.alg === header.alg));
    if (!key) throw new Error('PF signing key not found');
    const publicKey = crypto.createPublicKey({ key, format: 'jwk' });
    const claims = jwt.verify(tokens.id_token, publicKey, {
      algorithms: [header.alg], issuer: config.issuer, audience: config.clientId,
    });
    if (!claims.sub || claims.nonce !== pending.nonce || !Number.isFinite(claims.exp)) {
      throw new Error('PF nonce, subject, or expiry invalid');
    }
    // Kept server-side only, beside (never inside) the PingOne oauthTokens, so
    // it can be the subject token for the ID-JAG exchange below.
    req.session.pfDavinciProof = {
      issuer: config.issuer,
      expiresAt: Math.min(claims.exp * 1000, Date.now() + PROOF_MAX_AGE_MS),
      idToken: tokens.id_token,
    };
    req.session.save((error) => {
      if (error) return failure();
      res.redirect(`${getFrontendOrigin()}${LESSON_PATH}?pf_davinci=success`);
    });
  } catch (error) {
    console.warn('[pf-davinci/callback] PF sign-in failed:', error.message);
    failure();
  }
}

// RFC 8693 exchange of the session's PF ID token for an ID-JAG at PF's token
// endpoint. Returns null when there is no live PF sign-in (caller may fall
// back); { error } when PF refuses; the token response fields otherwise.
async function exchangeIdJag(req, { audience, resource, scope }) {
  const config = settings();
  const idToken = config.configured && proof(req) ? req.session.pfDavinciProof.idToken : null;
  if (!idToken) return null;
  const metadata = await discovery(config.issuer);
  const body = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
    requested_token_type: 'urn:ietf:params:oauth:token-type:id-jag',
    subject_token: idToken,
    subject_token_type: 'urn:ietf:params:oauth:token-type:id_token',
    audience,
  });
  if (resource) body.set('resource', resource);
  if (scope) body.set('scope', scope);
  const tokenResponse = await fetch(metadata.token_endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const result = await tokenResponse.json().catch(() => ({}));
  if (!tokenResponse.ok) return { error: typeof result.error === 'string' ? result.error : 'id_jag_exchange_failed' };
  const { access_token, issued_token_type, token_type, expires_in } = result;
  return { access_token, issued_token_type, token_type, expires_in };
}

module.exports = { status, login, callback, exchangeIdJag };
