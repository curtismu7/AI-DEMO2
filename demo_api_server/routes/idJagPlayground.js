'use strict';

/**
 * ID-JAG playground (/api/id-jag-playground) — run the real PingFederate ID-JAG flow
 * one step at a time, inspect each artifact, and check the implementation against
 * draft-ietf-oauth-identity-assertion-authz-grant.
 *
 * Modelled on Okta's xaa.dev (guided steps, inspect every request/response) and
 * MCPJam's XAA debugger (pre-send claim inspector, strict negative tests), but run
 * against THIS stack: PingFederate issues, oauth-mcp redeems, the MCP gateway carries
 * the call. Works for every vertical: step 4 lists whatever tools the redeemed token
 * can see instead of assuming a banking tool.
 *
 * Custody: raw tokens never leave the server. The ID-JAG and the redeemed access
 * token live in the session; responses carry decoded header/claims and redacted
 * request bodies only.
 */

const express = require('express');
const axios = require('axios');
const configStore = require('../services/configStore');
const oauthService = require('../services/oauthService');
const { decodeJwt } = require('../utils/tokenUtils');
const { callToolViaGateway, getMcpGatewayHttpUrl } = require('../services/mcpGatewayClient');
const { getFrontendOrigin } = require('../services/oauthRedirectUris');

const router = express.Router();
router.use(express.json());
// Every POST acts on the caller's tokens: same-origin only (CSRF), like the other auth routes.
router.use((req, res, next) => (req.method === 'POST' && req.get('origin') !== getFrontendOrigin()
  ? res.status(403).json({ error: 'invalid_origin' }) : next()));

const ID_JAG_TOKEN_TYPE = 'urn:ietf:params:oauth:token-type:id-jag';
const JWT_BEARER = 'urn:ietf:params:oauth:grant-type:jwt-bearer';
const OIDC_ONLY = new Set(['openid', 'profile', 'email', 'offline_access', 'phone', 'address']);
const SPEC = 'draft-ietf-oauth-identity-assertion-authz-grant';

const cfg = (k) => String(configStore.getEffective(k) || '').trim();
const scopeList = (s) => String(s || '').split(/\s+/).filter(Boolean);

function settings() {
  const issuer = cfg('pf_issuer') || cfg('pf_issuer_uri');
  return {
    provider: configStore.getOAuthProvider?.() || null,
    enabled: ['true', true].includes(configStore.getEffective('pf_id_jag_enabled')),
    idp: {
      name: 'PingFederate',
      issuer,
      jwksUrl: cfg('pf_jwks_uri') || (issuer ? `${issuer}/pf/JWKS` : ''),
      tokenEndpoint: cfg('pf_token_endpoint'),
      exchangeClientId: cfg('pf_user_client_id') || cfg('pf_token_exchange_client_id'),
    },
    resourceAs: {
      name: 'oauth-mcp',
      issuer: cfg('pf_id_jag_audience') || cfg('enterprise_mcp_as_issuer'),
      tokenEndpoint: cfg('pf_id_jag_redemption_token_endpoint'),
      clientId: cfg('pf_id_jag_redemption_client_id'),
    },
    request: {
      audience: cfg('pf_id_jag_audience') || cfg('enterprise_mcp_as_issuer'),
      resource: cfg('pf_id_jag_resource'),
      scope: cfg('pf_id_jag_scope'),
      subjectTokenType: cfg('pf_id_jag_subject_token_type') || 'urn:ietf:params:oauth:token-type:refresh_token',
    },
  };
}

function subjectToken(req, type) {
  const t = req.session?.oauthTokens || {};
  const byType = {
    'urn:ietf:params:oauth:token-type:refresh_token': t.refreshToken,
    'urn:ietf:params:oauth:token-type:id_token': t.idToken,
    'urn:ietf:params:oauth:token-type:access_token': t.accessToken,
  };
  const token = byType[type];
  return token && token !== '_cookie_session' ? token : null;
}

function pfSignedIn(req) {
  const s = req.session || {};
  return Boolean(s.oauthProvider === 'pingfederate' && s.oauthTokens?.refreshToken);
}

function decoded(token) {
  const d = decodeJwt(token);
  return d ? { header: d.header, claims: d.claims } : null;
}

/** Every real step requires a PingFederate sign-in: there is no PingOne ID-JAG. */
function requirePf(req, res, next) {
  const s = settings();
  if (s.provider !== 'pingfederate') {
    return res.status(409).json({ error: 'id_jag_provider_required', message: 'ID-JAG runs on PingFederate. Switch the login provider to PingFederate and sign in.' });
  }
  if (!s.enabled) return res.status(409).json({ error: 'id_jag_disabled', message: 'pf_id_jag_enabled is off.' });
  if (!pfSignedIn(req) || !subjectToken(req, s.request.subjectTokenType)) {
    return res.status(401).json({ error: 'pf_sign_in_required', message: 'Sign in with PingFederate first; the ID-JAG is minted from your session.' });
  }
  return next();
}

async function mintIdJag(req, scopeOverride) {
  const s = settings();
  const scope = scopeOverride ?? s.request.scope;
  const idJag = await oauthService.performIdJagExchange(
    subjectToken(req, s.request.subjectTokenType), s.request.subjectTokenType,
    s.request.audience, s.request.resource, scopeList(scope),
  );
  return { idJag, request: {
    endpoint: `POST ${s.idp.tokenEndpoint}`,
    body: {
      grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
      requested_token_type: ID_JAG_TOKEN_TYPE,
      subject_token: '[your session token, never sent to the browser]',
      subject_token_type: s.request.subjectTokenType,
      audience: s.request.audience,
      resource: s.request.resource || undefined,
      scope: scope || undefined,
      client_id: s.idp.exchangeClientId,
    },
  } };
}

/** Redeem at the resource AS and return status + body, error or not (negative tests need both). */
async function redeem(assertion, { clientId, clientSecret, scope } = {}) {
  const s = settings();
  const id = clientId ?? s.resourceAs.clientId;
  const secret = clientSecret !== undefined ? clientSecret : cfg('pf_id_jag_redemption_client_secret');
  const body = new URLSearchParams({ grant_type: JWT_BEARER, assertion, client_id: id });
  if (s.request.resource) body.set('resource', s.request.resource);
  if (scope) body.set('scope', scope);
  const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
  if (secret) headers.Authorization = `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`;
  const res = await axios.post(s.resourceAs.tokenEndpoint, body.toString(), { headers, timeout: 15000, validateStatus: () => true });
  return { status: res.status, data: res.data || {}, request: {
    endpoint: `POST ${s.resourceAs.tokenEndpoint}`,
    body: { grant_type: JWT_BEARER, assertion: '[the ID-JAG]', client_id: id, resource: s.request.resource || undefined, scope: scope || undefined },
  } };
}

function redactedTokenResponse(data) {
  const out = { ...data };
  if (out.access_token) out.access_token = '[access token, kept server-side]';
  if (out.refresh_token) out.refresh_token = '[refresh token, kept server-side]';
  return out;
}

let joseP;
const jose = () => (joseP ||= import('jose'));

/** Verify the ID-JAG signature against PingFederate's JWKS. Returns { ok, note }. */
async function verifySignature(idJag, h, s) {
  try {
    const { jwtVerify, createRemoteJWKSet, importJWK } = await jose();
    let key;
    if (h.x5t) {
      // PingFederate publishes certificate-backed keys identified by x5t.
      const { data } = await axios.get(s.idp.jwksUrl, { timeout: 10000 });
      const match = (data.keys || []).filter((k) => k.x5t === h.x5t && (!k.alg || k.alg === h.alg));
      if (match.length !== 1) throw new Error(`expected one JWKS key for x5t ${h.x5t}, found ${match.length}`);
      key = await importJWK(match[0], h.alg || 'RS256');
    } else {
      key = createRemoteJWKSet(new URL(s.idp.jwksUrl));
    }
    await jwtVerify(idJag, key, { algorithms: [h.alg || 'RS256'], clockTolerance: 5 });
    return { ok: true, note: 'valid' };
  } catch (err) {
    return { ok: false, note: err.message };
  }
}

/** Spec checks on a PingFederate-issued ID-JAG. Pure except the injected signature check. */
async function inspect(idJag, s = settings(), verify = verifySignature) {
  const d = decodeJwt(idJag) || { header: {}, claims: {} };
  const h = d.header || {};
  const c = d.claims || {};
  const now = Math.floor(Date.now() / 1000);
  const checks = [];
  const add = (id, label, ok, expected, actual, cite, warn = false) =>
    checks.push({ id, label, status: ok ? 'pass' : (warn ? 'warn' : 'fail'), expected, actual, cite });

  add('typ', 'Header typ', h.typ === 'oauth-id-jag+jwt', 'oauth-id-jag+jwt', h.typ, `${SPEC} §3.1 (MUST)`);
  add('alg', 'Signed, not alg:none', !!h.alg && h.alg !== 'none', 'RS256 (or another asymmetric alg)', h.alg, 'RFC 8725 §3.1');
  for (const k of ['iss', 'sub', 'aud', 'client_id', 'jti', 'exp', 'iat']) {
    add(`claim-${k}`, `Required claim ${k}`, c[k] !== undefined && c[k] !== '', 'present', c[k] === undefined ? '(missing)' : c[k], `${SPEC} §3.1 (REQUIRED)`);
  }
  add('iss', 'Issuer is PingFederate', c.iss === s.idp.issuer, s.idp.issuer, c.iss, 'RFC 7523 §3');
  const audOk = Array.isArray(c.aud) ? (c.aud.length === 1 && c.aud[0] === s.resourceAs.issuer) : c.aud === s.resourceAs.issuer;
  add('aud', 'Audience is the resource AS issuer (single value)', audOk, s.resourceAs.issuer, c.aud, `${SPEC} §4.4.1 (MUST)`);
  add('client_id', 'client_id is the client at the resource AS', c.client_id === s.resourceAs.clientId, s.resourceAs.clientId, c.client_id,
    `${SPEC} §4.4.1: client_id MUST identify the client authenticating at the resource AS (the IdP maps it)`);
  if (s.request.resource) {
    add('resource', 'Resource is the requested MCP resource', c.resource === undefined || c.resource === s.request.resource, s.request.resource,
      c.resource === undefined ? '(not set)' : c.resource, 'RFC 8707 / MCP profile', c.resource === undefined);
  }
  add('exp', 'Not expired', typeof c.exp === 'number' && c.exp > now, `> ${now}`, c.exp, 'RFC 7519 §4.1.4');
  const life = typeof c.exp === 'number' && typeof c.iat === 'number' ? c.exp - c.iat : null;
  add('lifetime', 'Short-lived (5 minutes or less)', life !== null && life <= 300, '<= 300 s', life === null ? '?' : `${life} s`,
    'Okta / Auth0 / WorkOS issue 300 s ID-JAGs', true);
  const scopes = scopeList(c.scope);
  const mcpScopes = scopes.filter((x) => !OIDC_ONLY.has(x));
  add('scope', 'Scope names MCP permissions, not just login scopes', mcpScopes.length > 0, 'the MCP scopes the IdP grants for this server',
    c.scope || '(none)', `${SPEC} §4.3: the IdP reflects the granted scope; OIDC-only scope grants nothing at the MCP server`);

  const sig = await verify(idJag, h, s);
  add('signature', 'Signature verifies against PingFederate JWKS', sig.ok, `valid against ${s.idp.jwksUrl}`, sig.note, 'RFC 7523 §3 item 9');
  return { header: h, claims: c, checks };
}

router.get('/config', (req, res) => {
  const s = settings();
  res.json({ ...s, signedIn: pfSignedIn(req), hasIdJag: !!req.session?.idJagPlayground?.idJag,
    hasAccessToken: !!req.session?.idJagPlayground?.accessToken });
});

router.post('/issue', requirePf, async (req, res) => {
  try {
    const { idJag, request } = await mintIdJag(req, req.body?.scope);
    req.session.idJagPlayground = { idJag, issuedAt: Date.now(), redeemed: false };
    res.json({ request, response: { issued_token_type: ID_JAG_TOKEN_TYPE, token_type: 'N_A', access_token: '[the ID-JAG, kept server-side]' }, token: decoded(idJag) });
  } catch (err) {
    res.status(502).json({ error: 'id_jag_issue_failed', message: err.message, pfError: err.pfError, pfErrorDescription: err.pfErrorDescription });
  }
});

router.post('/inspect', requirePf, async (req, res) => {
  const idJag = req.session?.idJagPlayground?.idJag;
  if (!idJag) return res.status(409).json({ error: 'no_id_jag', message: 'Issue an ID-JAG first.' });
  res.json(await inspect(idJag));
});

router.post('/redeem', requirePf, async (req, res) => {
  const pg = req.session?.idJagPlayground;
  if (!pg?.idJag) return res.status(409).json({ error: 'no_id_jag', message: 'Issue an ID-JAG first.' });
  try {
    const r = await redeem(pg.idJag, { scope: req.body?.scope });
    if (r.status === 200 && r.data.access_token) {
      req.session.idJagPlayground = { ...pg, redeemed: true, accessToken: r.data.access_token };
    }
    res.status(r.status === 200 ? 200 : 422).json({ request: r.request, status: r.status, response: redactedTokenResponse(r.data),
      token: r.data.access_token ? decoded(r.data.access_token) : null });
  } catch (err) {
    res.status(502).json({ error: 'redeem_failed', message: err.message });
  }
});

router.post('/call', requirePf, async (req, res) => {
  const token = req.session?.idJagPlayground?.accessToken;
  if (!token) return res.status(409).json({ error: 'no_access_token', message: 'Redeem the ID-JAG first.' });
  const gatewayUrl = getMcpGatewayHttpUrl();
  const tool = typeof req.body?.tool === 'string' ? req.body.tool : '';
  try {
    if (!tool) {
      const result = await callToolViaGateway(gatewayUrl, token, null, {}, { rpcMethod: 'tools/list' });
      const tools = (result?.tools || []).map((t) => ({ name: t.name, description: (t.description || '').slice(0, 160) }));
      return res.json({ request: { endpoint: `POST ${gatewayUrl}`, body: { jsonrpc: '2.0', method: 'tools/list' }, authorization: 'Bearer [access token]' }, tools });
    }
    const params = req.body?.arguments && typeof req.body.arguments === 'object' ? req.body.arguments : {};
    const result = await callToolViaGateway(gatewayUrl, token, tool, params);
    return res.json({ request: { endpoint: `POST ${gatewayUrl}`, body: { jsonrpc: '2.0', method: 'tools/call', params: { name: tool, arguments: params } }, authorization: 'Bearer [access token]' }, result });
  } catch (err) {
    return res.status(err.httpStatus && err.httpStatus < 600 ? err.httpStatus : 502).json({ error: err.code || 'gateway_call_failed', message: err.message });
  }
});

/**
 * Live negative tests against the real resource AS. Each one uses a FRESH ID-JAG
 * (ours are single-use), breaks one thing, and expects a refusal with no token.
 */
const NEGATIVE_TESTS = {
  replay: { label: 'Replay a redeemed ID-JAG', expect: 'invalid_grant',
    why: 'The resource AS enforces single-use jti (a hardening beyond the draft, which lets clients resubmit).' },
  'bad-signature': { label: 'Tampered signature', expect: 'invalid_grant', why: 'RFC 7523 §3: the AS MUST verify the signature.' },
  'client-mismatch': { label: 'Redeemed by a different client', expect: 'invalid_grant or invalid_client',
    why: `${SPEC} §4.4.1: client_id MUST identify the authenticating client.` },
  'scope-not-granted': { label: 'Ask for a scope the IdP did not grant', expect: 'invalid_scope',
    why: `${SPEC} §4.4.1: the AS grants at most what the ID-JAG grants.` },
};

router.get('/negative', (_req, res) => res.json(Object.entries(NEGATIVE_TESTS).map(([id, t]) => ({ id, ...t }))));

router.post('/negative/:id', requirePf, async (req, res) => {
  const test = NEGATIVE_TESTS[req.params.id];
  if (!test) return res.status(404).json({ error: 'unknown_test' });
  try {
    const { idJag } = await mintIdJag(req);
    let r;
    if (req.params.id === 'replay') {
      const first = await redeem(idJag);
      if (first.status !== 200) return res.json({ id: req.params.id, ...test, pass: false, note: `setup redeem failed (${first.status} ${first.data.error || ''})` });
      r = await redeem(idJag);
    } else if (req.params.id === 'bad-signature') {
      const [h, p, sig] = idJag.split('.');
      const flipped = sig.slice(0, -2) + (sig.slice(-2) === 'AA' ? 'BB' : 'AA');
      r = await redeem(`${h}.${p}.${flipped}`);
    } else if (req.params.id === 'client-mismatch') {
      r = await redeem(idJag, { clientId: 'mcp-inspector', clientSecret: '' });
    } else {
      r = await redeem(idJag, { scope: 'admin:delete' });
    }
    const refused = r.status >= 400 && !r.data.access_token;
    res.json({ id: req.params.id, ...test, pass: refused, status: r.status, error: r.data.error || null,
      error_description: r.data.error_description || null, request: r.request });
  } catch (err) {
    res.status(502).json({ id: req.params.id, ...test, pass: false, note: err.message });
  }
});

router.post('/reset', (req, res) => {
  if (req.session) delete req.session.idJagPlayground;
  res.json({ ok: true });
});

module.exports = router;
module.exports._inspect = inspect;
module.exports._settings = settings;
