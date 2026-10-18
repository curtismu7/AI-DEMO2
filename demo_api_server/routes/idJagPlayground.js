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

const crypto = require('crypto');
const express = require('express');
const axios = require('axios');
const configStore = require('../services/configStore');
const oauthService = require('../services/oauthService');
const { decodeJwt } = require('../utils/tokenUtils');
const { callToolViaGateway } = require('../services/mcpGatewayClient');
const { getFrontendOrigin, getUserRedirectUri } = require('../services/oauthRedirectUris');
const trustedIdps = require('../services/idJagTrustedIdps');
const { authenticateToken, requireAdmin } = require('../middleware/auth');

const router = express.Router();
router.use(express.json());
// Every write acts on the caller's tokens or the registry: same-origin only (CSRF), like the other auth routes.
router.use((req, res, next) => (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.get('origin') !== getFrontendOrigin()
  ? res.status(403).json({ error: 'invalid_origin' }) : next()));

const ID_JAG_TOKEN_TYPE = 'urn:ietf:params:oauth:token-type:id-jag';
const JWT_BEARER = 'urn:ietf:params:oauth:grant-type:jwt-bearer';
const OIDC_ONLY = new Set(['openid', 'profile', 'email', 'offline_access', 'phone', 'address']);
const SPEC = 'draft-ietf-oauth-identity-assertion-authz-grant';

const cfg = (k) => String(configStore.getEffective(k) || '').trim();
const scopeList = (s) => String(s || '').split(/\s+/).filter(Boolean);
const claimScopes = (c) => (Array.isArray(c?.scope) ? c.scope.map(String) : scopeList(c?.scope));
const PLAYGROUND_PATH = '/pingfederate-id-jag/playground';

// Two real pairings. 'oauth-mcp': the app's PingFederate issues, oauth-mcp redeems.
// 'pf-pf': the SE PingFederate issues and the local PingFederate redeems (JWT bearer via
// an IdP connection). Two PingFederates because an IdP must not redeem its own ID-JAG
// (draft §9.3), and the SE one must be the issuer: only its JWKS is reachable from both.
// 'byo': an outside IdP from the trusted-IdP registry issued the ID-JAG; the user pastes it.
const MODES = ['oauth-mcp', 'pf-pf', 'byo'];
const env = (k) => String(process.env[k] || '').trim();

function pfPfSettings() {
  const issuer = (cfg('pf_id_jag_issuer_pf_url') || env('PF_IDJAG_ISSUER_PF_URL')
    || (env('PINGFEDERATE_HOST') ? `https://${env('PINGFEDERATE_HOST')}` : '')).replace(/\/$/, '');
  const localIssuer = cfg('pf_issuer') || cfg('pf_issuer_uri');
  return {
    provider: configStore.getOAuthProvider?.() || null,
    enabled: ['true', true].includes(configStore.getEffective('pf_id_jag_enabled')),
    idp: {
      name: 'PingFederate (SE, issuer)',
      issuer,
      jwksUrl: issuer ? `${issuer}/pf/JWKS` : '',
      tokenEndpoint: issuer ? `${issuer}/as/token.oauth2` : '',
      authorizationEndpoint: issuer ? `${issuer}/as/authorization.oauth2` : '',
      exchangeClientId: cfg('pf_user_client_id'),
    },
    resourceAs: {
      name: 'PingFederate (local, resource AS)',
      issuer: localIssuer,
      tokenEndpoint: cfg('pf_token_endpoint'),
      clientId: cfg('pf_id_jag_pf_redeemer_client_id') || 'ai-demo-pf-idjag-redeemer',
    },
    request: {
      audience: localIssuer,
      resource: cfg('pf_id_jag_pf_resource') || 'https://api.ping.demo:3036/mcp',
      scope: cfg('pf_id_jag_scope'),
      subjectTokenType: 'urn:ietf:params:oauth:token-type:refresh_token',
    },
  };
}

function pfPfUnavailableReason() {
  const s = pfPfSettings();
  if (!s.idp.issuer) return 'Set PF_IDJAG_ISSUER_PF_URL (or PINGFEDERATE_HOST) to the SE PingFederate.';
  if (!env('PF_IDJAG_PF_REDEEMER_CLIENT_SECRET')) return 'PF_IDJAG_PF_REDEEMER_CLIENT_SECRET is not set for the local PingFederate redeemer.';
  return null;
}

const modeOf = (req) => (MODES.includes(req?.session?.idJagPlaygroundMode) ? req.session.idJagPlaygroundMode : 'oauth-mcp');

// Always the Node demo MCP gateway: it trusts oauth-mcp's and PingFederate's tokens. PingGateway
// (ff_mcp_gateway_pinggateway) demands gateway:mcp:invoke and a PingOne/PF issuer, so it 401s these.
const nodeGatewayUrl = () => (env('MCP_DEMO_GATEWAY_URL') || cfg('mcp_demo_gateway_url')).replace(/\/$/, '');

// oauth-mcp's REST resource behind its tools-path bearer validation: same server that redeems the ID-JAG.
const protectedResourceUrl = () => {
  const tokenEndpoint = cfg('pf_id_jag_redemption_token_endpoint');
  return tokenEndpoint ? `${tokenEndpoint.replace(/\/token\/?$/, '')}/protected/profile` : '';
};

function settings(mode = 'oauth-mcp') {
  if (mode === 'pf-pf') return pfPfSettings();
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

/** byo: the outside IdP (registry entry) issues; oauth-mcp or the local PingFederate redeems. */
function byoSettings(target = 'oauth-mcp', entry = null) {
  const pf = target === 'pingfederate';
  const base = pf ? pfPfSettings() : settings('oauth-mcp');
  return {
    provider: base.provider, enabled: true, target,
    idp: { name: entry?.name || 'Your IdP', issuer: entry?.issuer || '', jwksUrl: entry?.jwksUrl || '', tokenEndpoint: '', exchangeClientId: '' },
    resourceAs: { ...base.resourceAs, clientId: pf ? (entry?.pfClientId || base.resourceAs.clientId) : (entry?.clientId || 'demo-bff-mcp-client') },
    request: { audience: base.resourceAs.issuer, resource: base.request.resource, scope: entry?.scopes || '' },
  };
}

/** Settings for the session's mode; byo reads the IdP and target stored with the pasted ID-JAG. */
function settingsFor(req) {
  const mode = modeOf(req);
  if (mode !== 'byo') return settings(mode);
  const byo = req.session?.idJagPlayground?.byo || {};
  return byoSettings(byo.target, byo.idpId ? trustedIdps.findById(byo.idpId) : null);
}

// Settings read by name only: the values never leave the BFF.
const secretSetting = (k) => env(k) || cfg(k);

// byo IdPs whose redeeming client at oauth-mcp is not ours: trusted-IdP entry id -> the names of the
// settings holding that client's id and secret (secrets never go in the registry: oauth-mcp reads it).
// The secret is sent (client_secret_post) only while the entry still names that client.
const BYO_REDEEM_CLIENTS = { 'xaa-dev': { id: 'XAA_DEV_OUR_AS_CLIENT_ID', secret: 'XAA_DEV_OUR_AS_CLIENT_SECRET' } };

/** Who redeems for this session, and with which default secret. */
function redeemContext(req) {
  const mode = modeOf(req);
  const s = settingsFor(req);
  if (mode === 'pf-pf' || s.target === 'pingfederate') return { s, defaultSecret: env('PF_IDJAG_PF_REDEEMER_CLIENT_SECRET') };
  const named = mode === 'byo' ? BYO_REDEEM_CLIENTS[req.session?.idJagPlayground?.byo?.idpId] : null;
  if (named && secretSetting(named.id) === s.resourceAs.clientId) return { s, defaultSecret: secretSetting(named.secret), secretPost: true };
  // byo to oauth-mcp: the redemption secret belongs to our configured client only.
  const ours = mode !== 'byo' || s.resourceAs.clientId === (cfg('pf_id_jag_redemption_client_id') || 'demo-bff-mcp-client');
  return { s, defaultSecret: ours ? cfg('pf_id_jag_redemption_client_secret') : '' };
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
  if (modeOf(req) === 'pf-pf') return Boolean(s.idJagIssuer?.refreshToken);
  return Boolean(s.oauthProvider === 'pingfederate' && s.oauthTokens?.refreshToken);
}

function decoded(token) {
  const d = decodeJwt(token);
  return d ? { header: d.header, claims: d.claims } : null;
}

/** Every real step requires a PingFederate sign-in: there is no PingOne ID-JAG. */
function requirePf(req, res, next) {
  const mode = modeOf(req);
  if (mode === 'byo') return next(); // the user brings the ID-JAG: no sign-in here
  const s = settings(mode);
  if (mode === 'pf-pf') {
    const reason = pfPfUnavailableReason();
    if (reason) return res.status(409).json({ error: 'pf_pf_unavailable', message: reason });
    if (!s.enabled) return res.status(409).json({ error: 'id_jag_disabled', message: 'pf_id_jag_enabled is off.' });
    if (!pfSignedIn(req)) return res.status(401).json({ error: 'pf_sign_in_required', message: 'Sign in at the SE PingFederate first; it issues the ID-JAG.' });
    return next();
  }
  if (s.provider !== 'pingfederate') {
    return res.status(409).json({ error: 'id_jag_provider_required', message: 'ID-JAG runs on PingFederate. Switch the login provider to PingFederate and sign in.' });
  }
  if (!s.enabled) return res.status(409).json({ error: 'id_jag_disabled', message: 'pf_id_jag_enabled is off.' });
  if (!pfSignedIn(req) || !subjectToken(req, s.request.subjectTokenType)) {
    return res.status(401).json({ error: 'pf_sign_in_required', message: 'Sign in with PingFederate first; the ID-JAG is minted from your session.' });
  }
  return next();
}

const basic = (id, secret) => `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`;

/** RFC 8693 exchange for an ID-JAG at the SE PingFederate, with the issuer-side refresh token. */
async function exchangeAtIssuerPf(req, s, scope) {
  const body = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
    requested_token_type: ID_JAG_TOKEN_TYPE,
    subject_token: req.session.idJagIssuer.refreshToken,
    subject_token_type: s.request.subjectTokenType,
    audience: s.request.audience,
  });
  if (s.request.resource) body.set('resource', s.request.resource);
  if (scope) body.set('scope', scope);
  const r = await axios.post(s.idp.tokenEndpoint, body.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: basic(s.idp.exchangeClientId, cfg('pf_user_client_secret')) },
    timeout: 15000, validateStatus: () => true,
  });
  if (r.status !== 200 || !r.data?.access_token) {
    const err = new Error(`SE PingFederate refused the exchange (HTTP ${r.status} ${r.data?.error || ''})`);
    err.pfError = r.data?.error; err.pfErrorDescription = r.data?.error_description;
    throw err;
  }
  return r.data.access_token;
}

async function mintIdJag(req, scopeOverride) {
  const mode = modeOf(req);
  const s = settings(mode);
  const scope = scopeOverride ?? s.request.scope;
  const idJag = mode === 'pf-pf'
    ? await exchangeAtIssuerPf(req, s, scope)
    : await oauthService.performIdJagExchange(
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
async function redeem(assertion, { clientId, clientSecret, scope, s = settings(), defaultSecret = '', secretPost = false } = {}) {
  const id = clientId ?? s.resourceAs.clientId;
  const secret = clientSecret !== undefined ? clientSecret : defaultSecret;
  const body = new URLSearchParams({ grant_type: JWT_BEARER, assertion, client_id: id });
  if (s.request.resource) body.set('resource', s.request.resource);
  if (scope) body.set('scope', scope);
  const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
  if (secret && secretPost) body.set('client_secret', secret);
  else if (secret) headers.Authorization = basic(id, secret);
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
      // The same key may be listed under several kids (static PF key sets): count distinct keys.
      const distinct = [...new Map(match.map((k) => [`${k.kty}.${k.n}.${k.e}.${k.x}.${k.y}`, k])).values()];
      if (distinct.length !== 1) throw new Error(`expected one JWKS key for x5t ${h.x5t}, found ${distinct.length}`);
      key = await importJWK(distinct[0], h.alg || 'RS256');
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
  add('iss', `Issuer is ${s.idp.name}`, c.iss === s.idp.issuer, s.idp.issuer, c.iss, 'RFC 7523 §3');
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
  add('signature', `Signature verifies against ${s.idp.name} JWKS`, sig.ok, `valid against ${s.idp.jwksUrl}`, sig.note, 'RFC 7523 §3 item 9');
  return { header: h, claims: c, checks };
}

function configFor(req) {
  const mode = modeOf(req);
  const pfPfReason = pfPfUnavailableReason();
  const oauthMcp = settings('oauth-mcp');
  return { ...settingsFor(req), mode,
    modes: [
      { id: 'oauth-mcp', label: 'PingFederate → oauth-mcp', available: true, reason: null },
      { id: 'pf-pf', label: 'PingFederate → PingFederate', available: !pfPfReason, reason: pfPfReason },
      { id: 'byo', label: 'Your IdP → our resource AS', available: true, reason: null },
    ],
    // What an outside IdP needs: aud = the issuer, and where its client redeems.
    publicEndpoints: {
      // What an outside agent calls, derived from each issuer (the in-cluster URLs the BFF
      // itself uses are not reachable from outside). ID_JAG_PUBLIC_OAUTH_MCP_TOKEN_ENDPOINT overrides.
      'oauth-mcp': { issuer: oauthMcp.resourceAs.issuer,
        tokenEndpoint: env('ID_JAG_PUBLIC_OAUTH_MCP_TOKEN_ENDPOINT') || (oauthMcp.resourceAs.issuer ? `${oauthMcp.resourceAs.issuer.replace(/\/$/, '')}/token` : '') },
      pingfederate: { issuer: cfg('pf_issuer') || cfg('pf_issuer_uri'),
        tokenEndpoint: (cfg('pf_issuer') || cfg('pf_issuer_uri')) ? `${(cfg('pf_issuer') || cfg('pf_issuer_uri')).replace(/\/$/, '')}/as/token.oauth2` : '' },
    },
    byo: req.session?.idJagPlayground?.byo || null,
    xaa: { available: !xaaUnavailableReason(), reason: xaaUnavailableReason(), signedIn: !!req.session?.idJagXaa,
      user: req.session?.idJagXaa ? (req.session.idJagXaa.email || req.session.idJagXaa.sub) : null },
    signedIn: pfSignedIn(req), hasIdJag: !!req.session?.idJagPlayground?.idJag,
    hasAccessToken: !!req.session?.idJagPlayground?.accessToken };
}

router.get('/config', (req, res) => res.json(configFor(req)));

router.post('/mode', (req, res) => {
  const mode = req.body?.mode;
  if (!MODES.includes(mode)) return res.status(400).json({ error: 'invalid_mode' });
  if (modeOf(req) !== mode) delete req.session.idJagPlayground; // tokens belong to one pairing
  req.session.idJagPlaygroundMode = mode;
  return req.session.save(() => res.json(configFor(req)));
});

// ---- Preflight: what would make the next button fail, checked before it is pressed. ----

const PREFLIGHT_STEPS = ['signin', 'issue', 'redeem', 'call', 'negative', 'resource', 'mode', 'xaa'];
const PROBE_TTL_MS = 30 * 1000;
const probes = new Map();

/** GET with a short timeout. HTTP answers are cached 30 s; network failures are not, so a re-check sees a host come back. */
async function probe(url, fresh) {
  const hit = probes.get(url);
  if (!fresh && hit && Date.now() - hit.at < PROBE_TTL_MS) return hit.result;
  try {
    const r = await axios.get(url, { timeout: 4000, validateStatus: () => true });
    const result = { status: r.status, data: r.data };
    probes.set(url, { at: Date.now(), result });
    return result;
  } catch (err) {
    probes.delete(url);
    return { error: err.code || err.message };
  }
}

const originOf = (u) => { try { return new URL(u).origin; } catch { return ''; } };
const unreachable = (url, r) => (r.error ? `Could not reach ${url} (${r.error}).` : `${url} answered HTTP ${r.status}.`);

/** Settings the mode cannot run without, by the name the operator sets. Values are never returned. */
function missingConfig(mode, s) {
  const pfAs = mode === 'pf-pf' || s.target === 'pingfederate';
  const need = [
    ...(mode === 'oauth-mcp' ? [['pf_issuer', s.idp.issuer], ['pf_token_endpoint', s.idp.tokenEndpoint], ['pf_user_client_id', s.idp.exchangeClientId],
      ['pf_id_jag_redemption_client_id', s.resourceAs.clientId]] : []),
    ...(mode === 'pf-pf' ? [['PF_IDJAG_ISSUER_PF_URL', s.idp.issuer], ['pf_user_client_id', s.idp.exchangeClientId],
      ['pf_user_client_secret', cfg('pf_user_client_secret')]] : []),
    pfAs ? ['pf_issuer', s.resourceAs.issuer] : ['pf_id_jag_audience', s.resourceAs.issuer],
    pfAs ? ['pf_token_endpoint', s.resourceAs.tokenEndpoint] : ['pf_id_jag_redemption_token_endpoint', s.resourceAs.tokenEndpoint],
  ];
  return [...new Set(need.filter(([, v]) => !v).map(([k]) => k))];
}

function signedInCheck(req, mode, s) {
  const sess = req.session || {};
  if (mode === 'pf-pf') {
    const ok = !!sess.idJagIssuer?.refreshToken;
    return ['signed-in', 'Signed in at the issuer PingFederate', ok ? 'pass' : 'fail',
      ok ? 'The BFF holds your issuer session.' : 'No issuer sign-in in this session (never signed in, or the session expired).',
      'Click "Sign in at the issuer PingFederate" in step 1.'];
  }
  const label = 'Signed in with PingFederate';
  const fix = 'Click "Sign in with PingFederate" in step 1.';
  if (!sess.oauthTokens) return ['signed-in', label, 'fail', 'Not signed in (or the session expired).', fix];
  if (sess.oauthProvider !== 'pingfederate') {
    return ['signed-in', label, 'fail', `Signed in with ${sess.oauthProvider || 'another provider'}, not PingFederate.`, `${fix} It replaces this session.`];
  }
  const type = s.request.subjectTokenType;
  const name = type.split(':').pop().replace('_', ' ');
  if (!subjectToken(req, type)) {
    return ['signed-in', label, 'fail', `Signed in, but the session holds no ${name} to exchange for an ID-JAG.`,
      `Sign in again in step 1.${name === 'refresh token' ? ' PingFederate must grant offline_access so the BFF keeps a refresh token.' : ''}`];
  }
  if (type.endsWith(':access_token') && sess.oauthTokens.expiresAt && sess.oauthTokens.expiresAt < Date.now()) {
    return ['signed-in', label, 'fail', 'Your PingFederate access token expired.', 'Sign in again in step 1.'];
  }
  return ['signed-in', label, 'pass', `The session holds a ${name}.`];
}

/** Every check that can make the next button fail, for the session's mode. Never returns a token or a secret. */
async function preflight(req, step) {
  const checks = [];
  const add = (id, label, status, detail, fix) => checks.push(status === 'pass' ? { id, label, status, detail } : { id, label, status, detail, fix });
  const at = (...steps) => steps.includes(step);
  const fresh = req.query.fresh === '1';
  const nowSec = Math.floor(Date.now() / 1000);
  const front = getFrontendOrigin();
  const page = `${front}${PLAYGROUND_PATH}`;
  const here = originOf(req.query.origin) || originOf(req.get('referer'));

  add('origin', 'This page is on the app host', !here ? 'warn' : here === front ? 'pass' : 'fail',
    !here ? 'Could not tell which host this page is on.' : here === front ? here : `This page is on ${here}, but sign-in and every action go through ${front}.`,
    `Open ${page}. Sign-in returns to that host, so a session started on another host is lost ("Invalid state").`);

  if (step === 'mode') {
    const target = String(req.query.mode || '');
    const known = MODES.includes(target);
    const reason = !known ? `"${target}" is not a playground mode.` : target === 'pf-pf' ? pfPfUnavailableReason() : null;
    add('mode', `This server can run ${known ? target : 'that mode'}`, reason ? 'fail' : 'pass', reason || 'Available.', known ? reason : 'Pick a mode from the toolbar.');
    return checks;
  }

  const mode = modeOf(req);
  if (req.query.mode && req.query.mode !== mode) {
    add('mode-sync', 'The server session is in this mode', 'fail',
      `This page is in ${req.query.mode}, the server session in ${mode} (the session was reset, or changed in another tab).`,
      'Reload the page: it puts the server session back in this mode.');
    return checks;
  }

  const byo = mode === 'byo';
  const s = settingsFor(req);
  const pg = req.session?.idJagPlayground;
  const pfRedeems = mode === 'pf-pf' || s.target === 'pingfederate';

  if (step === 'resource') {
    const url = protectedResourceUrl();
    if (!url) {
      add('resource', 'Protected resource is configured', 'fail', 'No oauth-mcp URL: pf_id_jag_redemption_token_endpoint is unset.', 'Set pf_id_jag_redemption_token_endpoint to oauth-mcp\'s /token; its /protected/profile sits beside it.');
    } else {
      const r = await probe(url, fresh);
      const bad = !!r.error || r.status === 404 || r.status >= 500;
      add('resource', 'Protected resource answers', bad ? 'fail' : 'pass', bad ? unreachable(url, r) : `${url} answered (HTTP ${r.status}).`,
        r.status === 404 ? 'This oauth-mcp predates /protected/profile: deploy the latest mcp-server image.' : 'Start oauth-mcp (mcp-server), or fix pf_id_jag_redemption_token_endpoint.');
    }
    const variant = req.query.variant;
    if (variant === 'token') {
      const exp = decodeJwt(pg?.accessToken)?.claims?.exp;
      const left = typeof exp === 'number' ? exp - nowSec : null;
      add('access-token', 'Access token from step 3', !pg?.accessToken || (left !== null && left <= 0) ? 'fail' : 'pass',
        !pg?.accessToken ? 'No access token yet.' : left !== null && left <= 0 ? `It expired ${-left} s ago.` : 'Present.', 'Redeem a fresh ID-JAG in step 3.');
    }
    if (variant === 'id-jag') {
      add('id-jag', 'An ID-JAG to present', pg?.idJag ? 'pass' : 'fail', pg?.idJag ? 'Present.' : 'No ID-JAG in this session yet.',
        byo ? 'Paste your ID-JAG in step 1.' : 'Click Request ID-JAG (step 2).');
    }
    if (pfRedeems && variant === 'token') {
      add('resource-issuer', 'oauth-mcp trusts this token\'s issuer', 'warn', 'In this mode the access token comes from the local PingFederate; oauth-mcp\'s resource trusts oauth-mcp and PingOne issuers only.',
        'Expect a refusal at the issuer check. Use PingFederate → oauth-mcp to see the resource accept the token.');
    }
    return checks;
  }

  if (step === 'xaa') {
    const reason = xaaUnavailableReason();
    add('xaa-available', 'xaa.dev sign-in is available here', reason ? 'fail' : 'pass', reason || 'IdenX client set; oauth-mcp has a public https issuer.',
      /hosted demo/.test(reason || '') ? 'Use the hosted demo: its oauth-mcp issuer is public and registered at xaa.dev.'
        : 'Set XAA_DEV_IDP_CLIENT_ID and XAA_DEV_IDP_CLIENT_SECRET (our requesting app at xaa.dev) on the BFF, then restart it.');
    const url = `${XAA_ISSUER}/.well-known/openid-configuration`;
    const r = await probe(url, fresh);
    const up = r.status === 200 && r.data?.issuer === XAA_ISSUER;
    add('idenx', 'IdenX (xaa.dev) answers', up ? 'pass' : 'fail', up ? `${url} names ${XAA_ISSUER}.` : unreachable(url, r),
      `xaa.dev may be down (try again later), or the BFF cannot reach ${XAA_ISSUER}.`);
    const e = trustedIdps.findById(XAA_ENTRY_ID);
    const trusted = !!e && e.enabled && e.targets.includes('oauth-mcp') && e.issuer === XAA_ISSUER;
    add('xaa-trusted-idp', 'IdenX is a trusted IdP for oauth-mcp', trusted ? 'pass' : 'fail',
      !e ? `No trusted IdP "${XAA_ENTRY_ID}".` : trusted ? `${e.name} is enabled for oauth-mcp.`
        : `${e.name} is ${!e.enabled ? 'disabled' : e.issuer !== XAA_ISSUER ? `for ${e.issuer}, not ${XAA_ISSUER}` : 'not targeted at oauth-mcp'}.`,
      `On the Trusted IdPs panel (admin), add or fix "${XAA_ENTRY_ID}": issuer ${XAA_ISSUER}, JWKS ${XAA_ISSUER}/jwks, target oauth-mcp, enabled, both client ids = XAA_DEV_OUR_AS_CLIENT_ID.`);
    const missing = ['XAA_DEV_OUR_AS_CLIENT_ID', 'XAA_DEV_OUR_AS_CLIENT_SECRET'].filter((k) => !secretSetting(k));
    const named = !!e && secretSetting('XAA_DEV_OUR_AS_CLIENT_ID') === e.clientId;
    add('xaa-client', 'Our redeeming client at oauth-mcp is configured', !missing.length && named ? 'pass' : 'fail',
      missing.length ? `Missing: ${missing.join(', ')}.` : named ? `Set, and "${XAA_ENTRY_ID}" names it.` : `"${XAA_ENTRY_ID}" does not name XAA_DEV_OUR_AS_CLIENT_ID as our client at oauth-mcp.`,
      missing.length ? `Set ${missing.join(' and ')} on the BFF to the client registered at oauth-mcp for xaa.dev, then restart it.`
        : `Set "Our client at oauth-mcp" on "${XAA_ENTRY_ID}" to XAA_DEV_OUR_AS_CLIENT_ID.`);
    return checks;
  }

  if (byo && step === 'issue') {
    const target = req.query.target === 'pingfederate' ? 'pingfederate' : 'oauth-mcp';
    const n = trustedIdps.list().filter((e) => e.enabled && e.targets.includes(target)).length;
    add('trusted-idp', `A trusted IdP can redeem at ${target}`, n ? 'pass' : 'warn', `${n} enabled trusted IdP(s) target ${target}.`,
      `Add your IdP on the Trusted IdPs panel below (admin) with ${target} as a target, or the inspection reports it untrusted.`);
    return checks;
  }
  if (byo && step === 'signin') return checks;

  if (mode === 'oauth-mcp') {
    const provider = configStore.getOAuthProvider?.() || 'unset';
    add('provider', 'Login provider is PingFederate', provider === 'pingfederate' ? 'pass' : 'fail', `The app's login provider is ${provider}.`,
      'Switch the login provider to PingFederate (P1/PF toggle in the top bar, admin), then sign in again in step 1. PingOne does not issue ID-JAGs.');
  }
  if (!byo) {
    add('enabled', 'ID-JAG is enabled', s.enabled ? 'pass' : 'fail', `pf_id_jag_enabled is ${s.enabled ? 'on' : 'off'}.`,
      'Set pf_id_jag_enabled=true in the BFF configuration, then reload this page.');
  }
  const missing = missingConfig(mode, s);
  add('config', 'Required settings are present', missing.length ? 'fail' : 'pass', missing.length ? `Missing: ${missing.join(', ')}.` : 'All set.',
    `Set ${missing.join(', ')} in the BFF configuration (config store or environment), then reload this page.`);

  if (mode === 'oauth-mcp' && step === 'signin' && here) {
    const cb = originOf(getUserRedirectUri(req));
    if (cb) {
      add('redirect-host', 'PingFederate returns the sign-in to this host', cb === here ? 'pass' : 'fail',
        cb === here ? `The callback is on ${cb}.` : `The sign-in callback is on ${cb}, not ${here}: the session would land on the other host.`,
        cb === front ? `Open ${page} and sign in there.` : `Set pf_user_redirect_uri to ${front}/api/auth/oauth/user/callback (and register it at PingFederate) so sign-in returns to the app host.`);
    }
  }

  if (pfRedeems && at('redeem', 'negative')) {
    const ok = !!env('PF_IDJAG_PF_REDEEMER_CLIENT_SECRET');
    add('redeemer-secret', 'Redeemer client secret is set', ok ? 'pass' : 'fail',
      ok ? `Set for ${s.resourceAs.clientId}.` : `No secret for ${s.resourceAs.clientId} at the local PingFederate.`,
      `Set PF_IDJAG_PF_REDEEMER_CLIENT_SECRET on the BFF to the secret of ${s.resourceAs.clientId} at the local PingFederate, then restart the BFF.`);
  }

  if (byo && pg?.byo && at('redeem', 'negative')) {
    const e = trustedIdps.findById(pg.byo.idpId);
    const ok = !!e && e.enabled && e.targets.includes(pg.byo.target);
    add('trusted-idp', `Your IdP is trusted at ${pg.byo.target}`, ok ? 'pass' : 'fail',
      !e ? 'The trusted IdP for this ID-JAG was removed.' : ok ? `${e.name} is enabled for ${pg.byo.target}.` : `${e.name} is ${e.enabled ? 'not targeted at' : 'disabled for'} ${pg.byo.target}.`,
      `Enable ${e?.name || 'your IdP'} for ${pg.byo.target} on the Trusted IdPs panel (admin), then paste the ID-JAG again.`);
  }

  if (!byo && step !== 'signin') add(...signedInCheck(req, mode, s));

  if (!byo && at('signin', 'issue', 'negative') && s.idp.issuer) {
    const key = mode === 'pf-pf' ? 'PF_IDJAG_ISSUER_PF_URL' : 'pf_issuer';
    const url = `${s.idp.issuer.replace(/\/$/, '')}/.well-known/openid-configuration`;
    const r = await probe(url, fresh);
    const got = r.status === 200 ? r.data?.issuer : undefined;
    add('issuer', `${s.idp.name} is up and is the issuer`, got === s.idp.issuer ? 'pass' : 'fail',
      r.status !== 200 ? unreachable(url, r) : !got ? `${url} names no issuer.` : got === s.idp.issuer ? `${url} names ${got}.` : `Discovery says the issuer is ${got}, but ${key} is ${s.idp.issuer}.`,
      got ? `Set ${key} to ${got} exactly.` : `Start ${s.idp.name} at ${s.idp.issuer}, or fix ${key}.`);
  }

  if (s.idp.jwksUrl && at('issue', 'redeem', 'negative')) {
    const url = s.idp.jwksUrl;
    const r = await probe(url, fresh);
    const keys = Array.isArray(r.data?.keys) ? r.data.keys : [];
    // A key listed under several kids is one key: count distinct moduli.
    const rsa = [...new Map(keys.filter((k) => k.kty === 'RSA').map((k) => [`${k.n}.${k.e}`, k])).values()];
    const withX5t = rsa.filter((k) => k.x5t).length;
    if (r.error || r.status !== 200) {
      add('jwks', `${s.idp.name} signing keys`, 'fail', unreachable(url, r), `Make ${url} reachable: the redeemer fetches ${s.idp.name}'s signing keys there.`);
    } else if (!keys.length) {
      add('jwks', `${s.idp.name} signing keys`, 'fail', `${url} lists no keys.`, `Give ${s.idp.name} an active signing key.`);
    } else if (pfRedeems && (rsa.length !== 1 || withX5t !== 1)) {
      add('jwks', `${s.idp.name} signing keys`, 'warn',
        `${rsa.length} distinct RSA keys (${withX5t} with x5t): the PingFederate redeemer may pick the wrong key and answer "Invalid JWT token".`,
        'Publish a single-key JWKS at the issuer (one active RSA signing key), then make the local PingFederate re-fetch it: re-save its IdP connection for this issuer, or restart it, so it drops the cached JWKS.');
    } else {
      add('jwks', `${s.idp.name} signing keys`, 'pass', `${keys.length} key(s), ${rsa.length} distinct RSA.`);
    }
  }

  if (step === 'redeem' || (byo && step === 'negative')) {
    const again = byo ? 'Get a fresh ID-JAG from your IdP and paste it in step 1.' : 'Request a new ID-JAG (step 2).';
    const c = pg?.idJag ? (decodeJwt(pg.idJag)?.claims || {}) : null;
    const left = typeof c?.exp === 'number' ? c.exp - nowSec : null;
    if (!c) add('id-jag', 'An unused, unexpired ID-JAG', 'fail', 'No ID-JAG in this session yet.', byo ? 'Paste your ID-JAG and click Inspect ID-JAG (step 1).' : 'Click Request ID-JAG (step 2).');
    else if (pg.redeemed) add('id-jag', 'An unused, unexpired ID-JAG', 'fail', 'This ID-JAG was already redeemed, and each one is single-use.', again);
    else if (left !== null && left <= 0) add('id-jag', 'An unused, unexpired ID-JAG', 'fail', `It expired ${-left} s ago (ID-JAGs live about 5 minutes).`, again);
    else add('id-jag', 'An unused, unexpired ID-JAG', 'pass', left === null ? 'Unused (no exp claim).' : `Unused, ${left} s left.`);
    if (c && typeof c.exp === 'number' && typeof c.iat === 'number' && c.exp - c.iat > 300) {
      add('lifetime', 'ID-JAG lifetime is 5 minutes or less', 'warn', `${c.exp - c.iat} s; the profile expects 300 s or less.`,
        `Lower the ID-JAG lifetime at ${s.idp.name} to 300 s${byo ? '' : ' (on PingFederate: the token lifetime of the access token manager that mints it)'}.`);
    }
    if (c && step === 'redeem') {
      const asked = scopeList(req.query.scope);
      const extra = asked.filter((x) => !claimScopes(c).includes(x));
      add('scope', 'Requested scope is in the ID-JAG', extra.length ? 'fail' : 'pass',
        extra.length ? `The ID-JAG does not grant ${extra.join(' ')}.` : asked.length ? `Narrowing to ${asked.join(' ')}.` : 'All scopes in this ID-JAG.',
        'Pick a scope from the list in step 3, or "All scopes in this ID-JAG".');
    }
  }

  if (at('redeem', 'negative') && s.resourceAs.tokenEndpoint) {
    const url = s.resourceAs.tokenEndpoint;
    const r = await probe(url, fresh);
    const bad = !!r.error || r.status >= 500;
    add('resource-as', `${s.resourceAs.name} token endpoint answers`, bad ? 'fail' : 'pass', bad ? unreachable(url, r) : `${url} answered (HTTP ${r.status}).`,
      pfRedeems ? 'Start the local PingFederate, or fix pf_token_endpoint.' : 'Start oauth-mcp (the MCP authorization server), or fix pf_id_jag_redemption_token_endpoint.');
  }

  if (step === 'call') {
    const t = pg?.accessToken;
    const exp = decodeJwt(t)?.claims?.exp;
    const left = typeof exp === 'number' ? exp - nowSec : null;
    if (!t) add('access-token', 'Access token from step 3', 'fail', 'No access token yet.', 'Redeem the ID-JAG (step 3).');
    else if (left !== null && left <= 0) {
      add('access-token', 'Access token from step 3', 'fail', `It expired ${-left} s ago.`,
        byo ? 'Paste a fresh ID-JAG (step 1) and redeem it (step 3).' : 'Request a new ID-JAG (step 2) and redeem it (step 3).');
    } else add('access-token', 'Access token from step 3', 'pass', left === null ? 'Present (opaque; expiry unknown).' : `${left} s left.`);
    const gw = nodeGatewayUrl();
    if (!gw) {
      add('gateway', 'MCP gateway for ID-JAG tokens', 'fail', 'The Node demo MCP gateway URL is not configured.',
        'Set MCP_DEMO_GATEWAY_URL (or mcp_demo_gateway_url) to the Node demo MCP gateway: it trusts oauth-mcp and PingFederate tokens; PingGateway does not.');
    } else {
      const r = await probe(`${gw}/health`, fresh);
      const bad = !!r.error || r.status >= 500;
      add('gateway', 'MCP gateway for ID-JAG tokens', bad ? 'fail' : 'pass', bad ? unreachable(`${gw}/health`, r) : `${gw} answered (HTTP ${r.status}).`,
        `Start the Node demo MCP gateway at ${gw}, or fix MCP_DEMO_GATEWAY_URL.`);
    }
  }
  return checks;
}

router.get('/preflight', async (req, res) => {
  const step = String(req.query.step || '');
  if (!PREFLIGHT_STEPS.includes(step)) return res.status(400).json({ error: 'invalid_step', message: `step must be one of ${PREFLIGHT_STEPS.join(', ')}` });
  try {
    const checks = await preflight(req, step);
    return res.json({ ok: !checks.some((c) => c.status === 'fail'), step, mode: step === 'mode' ? req.query.mode : modeOf(req), checks });
  } catch (err) {
    return res.status(500).json({ error: 'preflight_failed', message: err.message });
  }
});

const safeReturnTo = (p) => (typeof p === 'string' && /^\/(?!\/)/.test(p) ? p : PLAYGROUND_PATH);
const issuerRedirectUri = () => `${getFrontendOrigin()}/api/id-jag-playground/issuer/callback`;

/** pf-pf: sign in at the SE PingFederate (code + PKCE) so it holds a refresh token to exchange. */
router.get('/issuer/login', (req, res) => {
  const s = pfPfSettings();
  if (pfPfUnavailableReason()) return res.redirect(safeReturnTo(req.query.return_to));
  const verifier = crypto.randomBytes(32).toString('base64url');
  const state = crypto.randomBytes(16).toString('hex');
  req.session.idJagIssuerLogin = { state, verifier, returnTo: safeReturnTo(req.query.return_to), at: Date.now() };
  const u = new URL(s.idp.authorizationEndpoint);
  u.search = new URLSearchParams({
    response_type: 'code', client_id: s.idp.exchangeClientId, redirect_uri: issuerRedirectUri(),
    scope: 'openid profile email offline_access', state, prompt: 'login',
    code_challenge: crypto.createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256',
  }).toString();
  return req.session.save(() => res.redirect(u.toString()));
});

router.get('/issuer/callback', async (req, res) => {
  const pending = req.session?.idJagIssuerLogin;
  const back = pending?.returnTo || '/pingfederate-id-jag/playground';
  delete req.session.idJagIssuerLogin;
  if (!pending || !req.query.code || req.query.state !== pending.state || Date.now() - pending.at > 10 * 60 * 1000) {
    return req.session.save(() => res.redirect(`${back}?issuer_error=invalid_state`));
  }
  const s = pfPfSettings();
  try {
    const r = await axios.post(s.idp.tokenEndpoint, new URLSearchParams({
      grant_type: 'authorization_code', code: String(req.query.code), redirect_uri: issuerRedirectUri(), code_verifier: pending.verifier,
    }).toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: basic(s.idp.exchangeClientId, cfg('pf_user_client_secret')) },
      timeout: 15000, validateStatus: () => true,
    });
    if (r.status !== 200 || !r.data?.refresh_token) {
      return req.session.save(() => res.redirect(`${back}?issuer_error=${encodeURIComponent(r.data?.error || `http_${r.status}`)}`));
    }
    req.session.idJagIssuer = { refreshToken: r.data.refresh_token, sub: decodeJwt(r.data.id_token || '')?.claims?.sub || null };
    delete req.session.idJagPlayground;
    return req.session.save(() => res.redirect(back));
  } catch (err) {
    return req.session.save(() => res.redirect(`${back}?issuer_error=exchange_failed`));
  }
});

router.post('/issue', requirePf, async (req, res) => {
  if (modeOf(req) === 'byo') return res.status(409).json({ error: 'byo_mode', message: 'Your IdP issues the ID-JAG: paste it in step 1.' });
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
  const s = settingsFor(req);
  // byo: the ID-JAG carries the client_id the IdP knows us by, not the redeeming client.
  const entry = modeOf(req) === 'byo' ? trustedIdps.findById(req.session.idJagPlayground.byo?.idpId) : null;
  res.json(await inspect(idJag, entry ? { ...s, resourceAs: { ...s.resourceAs, clientId: entry.idJagClientId } } : s));
});

const JWT_SHAPE = /^[\w-]+\.[\w-]+\.[\w-]*$/;

/** byo step 1: inspect an ID-JAG against the trusted IdP its (unverified) iss names, and keep it for redeem. */
async function loadByoIdJag(req, idJag, target) {
  delete req.session.idJagPlayground;
  const d = decoded(idJag) || { header: {}, claims: {} };
  const iss = d.claims?.iss;
  const entry = trustedIdps.findByIssuer(iss);
  if (!entry || !entry.targets.includes(target)) {
    return { ...d, trusted: false,
      hint: entry ? `${entry.name} is trusted, but not for ${target}. Add ${target} to its targets on the Trusted IdPs panel.`
        : 'Add this issuer on the Trusted IdPs panel (admin) so our resource AS trusts it.',
      checks: [{ id: 'trusted-idp', label: 'Issuer is a trusted IdP', status: 'fail',
        expected: `an enabled Trusted IdP targeting ${target}`, actual: iss || '(missing)', cite: 'RFC 7523 §3: the AS MUST trust the issuer' }] };
  }
  req.session.idJagPlayground = { idJag, issuedAt: Date.now(), redeemed: false, byo: { target, idpId: entry.id } };
  const s = byoSettings(target, entry);
  const result = await inspect(idJag, { ...s, resourceAs: { ...s.resourceAs, clientId: entry.idJagClientId } });
  return { ...result, trusted: true, idp: { id: entry.id, name: entry.name }, config: configFor(req) };
}

router.post('/byo/inspect', async (req, res) => {
  if (modeOf(req) !== 'byo') return res.status(409).json({ error: 'not_byo_mode', message: 'Switch to the "Your IdP" mode first.' });
  const idJag = typeof req.body?.idJag === 'string' ? req.body.idJag.trim() : '';
  const target = req.body?.target === 'pingfederate' ? 'pingfederate' : 'oauth-mcp';
  if (idJag.length > 16384 || !JWT_SHAPE.test(idJag)) return res.status(400).json({ error: 'invalid_id_jag', message: 'Paste a compact JWT (header.payload.signature).' });
  return res.json(await loadByoIdJag(req, idJag, target));
});

// ---- xaa.dev (Okta's public XAA playground): its IdP, IdenX, as a real outside IdP for byo. ----
// Any email + any 6-digit code signs in at IdenX. Our requesting app there is XAA_DEV_IDP_CLIENT_ID; the
// ID-JAGs it issues name XAA_DEV_OUR_AS_CLIENT_ID, our client at oauth-mcp (trusted-IdP entry xaa-dev).
// IdenX tokens live in session.idJagXaa only; the browser gets decoded claims.

const XAA_ISSUER = 'https://idp.xaa.dev';
const XAA_ENTRY_ID = 'xaa-dev';
const TOKEN_EXCHANGE = 'urn:ietf:params:oauth:grant-type:token-exchange';
const FORM = { 'Content-Type': 'application/x-www-form-urlencoded' };
const xaaRedirectUri = () => `${getFrontendOrigin()}/api/id-jag-playground/xaa/callback`;
const xaaClient = () => ({ client_id: secretSetting('XAA_DEV_IDP_CLIENT_ID'), client_secret: secretSetting('XAA_DEV_IDP_CLIENT_SECRET') });

/** null when this server can run the xaa.dev flow, else why not. */
function xaaUnavailableReason() {
  const missing = ['XAA_DEV_IDP_CLIENT_ID', 'XAA_DEV_IDP_CLIENT_SECRET'].filter((k) => !secretSetting(k));
  if (missing.length) return `${missing.join(' and ')} not set on the BFF (our requesting app at xaa.dev).`;
  const issuer = settings('oauth-mcp').resourceAs.issuer;
  if (!/^https:\/\//i.test(issuer)) {
    return `Available on the hosted demo: xaa.dev addresses its ID-JAGs to a public https issuer, and oauth-mcp's issuer here is ${issuer || '(unset)'}.`;
  }
  return null;
}

let xaaDiscoveryP = null;
/** IdenX's OIDC discovery, cached per process (a failure is not). */
function xaaDiscovery() {
  xaaDiscoveryP ||= axios.get(`${XAA_ISSUER}/.well-known/openid-configuration`, { timeout: 10000 }).then(({ data }) => {
    if (data?.issuer !== XAA_ISSUER || !data.authorization_endpoint || !data.token_endpoint || !data.jwks_uri) throw new Error(`discovery is not for ${XAA_ISSUER}`);
    return data;
  }).catch((err) => { xaaDiscoveryP = null; throw err; });
  return xaaDiscoveryP;
}

async function verifyXaaIdToken(idToken, d, nonce) {
  const { jwtVerify, createLocalJWKSet } = await jose();
  const { data } = await axios.get(d.jwks_uri, { timeout: 10000 });
  const { payload } = await jwtVerify(idToken, createLocalJWKSet(data), {
    issuer: XAA_ISSUER, audience: secretSetting('XAA_DEV_IDP_CLIENT_ID'), algorithms: ['RS256'], clockTolerance: 5,
  });
  if (payload.nonce !== nonce) throw new Error('nonce mismatch');
  return payload;
}

/** Sign in at IdenX: code + PKCE + state + nonce. */
router.get('/xaa/login', async (req, res) => {
  const back = safeReturnTo(req.query.return_to);
  if (xaaUnavailableReason()) return res.redirect(`${back}?xaa_error=unavailable`);
  let d;
  try { d = await xaaDiscovery(); } catch { return res.redirect(`${back}?xaa_error=idenx_unreachable`); }
  const verifier = crypto.randomBytes(32).toString('base64url');
  const state = crypto.randomBytes(16).toString('hex');
  const nonce = crypto.randomBytes(16).toString('hex');
  req.session.idJagXaaLogin = { state, nonce, verifier, returnTo: back, at: Date.now() };
  const u = new URL(d.authorization_endpoint);
  // prompt=consent: an OpenID Provider grants offline_access (the refresh token we exchange) only with it (OIDC Core §11).
  u.search = new URLSearchParams({
    response_type: 'code', client_id: secretSetting('XAA_DEV_IDP_CLIENT_ID'), redirect_uri: xaaRedirectUri(),
    scope: 'openid profile email offline_access', prompt: 'consent', state, nonce,
    code_challenge: crypto.createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256',
  }).toString();
  return req.session.save(() => res.redirect(u.toString()));
});

router.get('/xaa/callback', async (req, res) => {
  const pending = req.session?.idJagXaaLogin;
  const back = pending?.returnTo || PLAYGROUND_PATH;
  delete req.session.idJagXaaLogin;
  const done = (q) => req.session.save(() => res.redirect(`${back}?${q}`));
  if (!pending || req.query.state !== pending.state || Date.now() - pending.at > 10 * 60 * 1000) return done('xaa_error=invalid_state');
  if (!req.query.code) return done(`xaa_error=${encodeURIComponent(String(req.query.error || 'no_code'))}`);
  try {
    const d = await xaaDiscovery();
    const r = await axios.post(d.token_endpoint, new URLSearchParams({
      grant_type: 'authorization_code', code: String(req.query.code), redirect_uri: xaaRedirectUri(), code_verifier: pending.verifier, ...xaaClient(),
    }).toString(), { headers: FORM, timeout: 15000, validateStatus: () => true });
    if (r.status !== 200 || !r.data?.id_token) return done(`xaa_error=${encodeURIComponent(r.data?.error || `http_${r.status}`)}`);
    let claims;
    try { claims = await verifyXaaIdToken(r.data.id_token, d, pending.nonce); } catch { return done('xaa_error=invalid_id_token'); }
    req.session.idJagXaa = { refreshToken: r.data.refresh_token || null, idToken: r.data.id_token, sub: claims.sub, email: claims.email || null };
    return done('xaa=signed_in');
  } catch {
    return done('xaa_error=exchange_failed');
  }
});

/** RFC 8693 at IdenX for an ID-JAG addressed to our public oauth-mcp, then the byo inspect path. */
router.post('/xaa/id-jag', async (req, res) => {
  if (modeOf(req) !== 'byo') return res.status(409).json({ error: 'not_byo_mode', message: 'Switch to the "Your IdP" mode first.' });
  const reason = xaaUnavailableReason();
  if (reason) return res.status(409).json({ error: 'xaa_unavailable', message: reason });
  const x = req.session?.idJagXaa;
  if (!x) return res.status(401).json({ error: 'xaa_sign_in_required', message: 'Sign in at IdenX (xaa.dev) first.' });
  const audience = settings('oauth-mcp').resourceAs.issuer;
  const [subject, type, name] = x.refreshToken
    ? [x.refreshToken, 'urn:ietf:params:oauth:token-type:refresh_token', 'refresh token']
    : [x.idToken, 'urn:ietf:params:oauth:token-type:id_token', 'ID token'];
  const body = { grant_type: TOKEN_EXCHANGE, requested_token_type: ID_JAG_TOKEN_TYPE, subject_token_type: type,
    audience, resource: `${audience.replace(/\/$/, '')}/mcp`, scope: 'read' };
  try {
    const d = await xaaDiscovery();
    const request = { endpoint: `POST ${d.token_endpoint}`,
      body: { ...body, subject_token: `[your IdenX ${name}, kept server-side]`, client_id: secretSetting('XAA_DEV_IDP_CLIENT_ID') } };
    const r = await axios.post(d.token_endpoint, new URLSearchParams({ ...body, subject_token: subject, ...xaaClient() }).toString(),
      { headers: FORM, timeout: 15000, validateStatus: () => true });
    if (r.status !== 200 || !r.data?.access_token) {
      if (r.data?.error === 'invalid_grant') delete req.session.idJagXaa; // dead IdenX session: the next click signs in again
      return res.status(502).json({ error: 'xaa_exchange_failed', message: `IdenX refused the ID-JAG exchange (HTTP ${r.status}${r.data?.error ? ` ${r.data.error}` : ''}).`,
        idpError: r.data?.error, idpErrorDescription: r.data?.error_description, request });
    }
    return res.json({ ...(await loadByoIdJag(req, r.data.access_token, 'oauth-mcp')), request, response: redactedTokenResponse(r.data) });
  } catch (err) {
    return res.status(502).json({ error: 'xaa_exchange_failed', message: `Could not reach IdenX (${err.code || err.message}).` });
  }
});

router.post('/redeem', requirePf, async (req, res) => {
  const pg = req.session?.idJagPlayground;
  if (!pg?.idJag) return res.status(409).json({ error: 'no_id_jag', message: 'Issue an ID-JAG first.' });
  // Narrowing only: never ask the AS for a scope the ID-JAG does not carry (the negative test does that on purpose).
  const granted = claimScopes(decodeJwt(pg.idJag)?.claims);
  const extra = scopeList(req.body?.scope).filter((x) => !granted.includes(x));
  if (extra.length) {
    return res.status(400).json({ error: 'scope_not_in_id_jag',
      message: `The ID-JAG does not grant ${extra.join(' ')}. Pick one it carries (${granted.join(' ') || 'none'}), or send no scope to get all of them.` });
  }
  try {
    const r = await redeem(pg.idJag, { scope: req.body?.scope, ...redeemContext(req) });
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
  const endpoint = `POST ${nodeGatewayUrl() || '(MCP_DEMO_GATEWAY_URL not set)'}/mcp`;
  const tool = typeof req.body?.tool === 'string' ? req.body.tool : '';
  const params = req.body?.arguments && typeof req.body.arguments === 'object' ? req.body.arguments : {};
  const request = { endpoint, authorization: 'Bearer [access token]',
    body: tool ? { jsonrpc: '2.0', method: 'tools/call', params: { name: tool, arguments: params } } : { jsonrpc: '2.0', method: 'tools/list' } };
  const pin = { pinNodeGateway: true };
  try {
    if (!tool) {
      const result = await callToolViaGateway(null, token, null, {}, { rpcMethod: 'tools/list', ...pin });
      // The client returns the JSON-RPC envelope (list at result.result); accept a bare { tools } too.
      const list = result?.result || result || {};
      const tools = (list.tools || []).map((t) => ({ name: t.name, description: (t.description || '').slice(0, 160), inputSchema: t.inputSchema || null }));
      const deniedTools = Array.isArray(list._meta?.deniedTools) ? list._meta.deniedTools : [];
      return res.json({ request, tools, deniedTools });
    }
    const result = await callToolViaGateway(null, token, tool, params, pin);
    return res.json({ request, result });
  } catch (err) {
    // The gateway's own answer (status, error code, reason), not just ours.
    return res.status(err.httpStatus && err.httpStatus < 600 ? err.httpStatus : 502).json({ error: err.code || 'gateway_call_failed', message: err.message,
      gatewayStatus: err.gatewayStatus, gatewayErrorCode: err.gatewayErrorCode, gatewayMessage: err.gatewayMessage, request });
  }
});

const RESOURCE_VARIANTS = {
  token: { token: (pg) => pg?.accessToken, shown: 'Bearer [access token]', missing: 'Redeem the ID-JAG first (step 3).' },
  'no-token': { token: () => null, shown: 'none' },
  'id-jag': { token: (pg) => pg?.idJag, shown: 'Bearer [the ID-JAG]', missing: 'Request an ID-JAG first (step 2).' },
};

/** Call oauth-mcp's protected REST resource with the access token, no token, or the raw ID-JAG. Tokens stay server-side. */
router.post('/resource', async (req, res) => {
  const v = RESOURCE_VARIANTS[req.body?.variant];
  if (!v) return res.status(400).json({ error: 'invalid_variant', message: `variant must be one of ${Object.keys(RESOURCE_VARIANTS).join(', ')}` });
  const url = protectedResourceUrl();
  if (!url) return res.status(409).json({ error: 'resource_unconfigured', message: 'pf_id_jag_redemption_token_endpoint is unset, so there is no oauth-mcp URL.' });
  const token = v.token(req.session?.idJagPlayground);
  if (v.missing && !token) return res.status(409).json({ error: 'no_token', message: v.missing });
  const request = { method: 'GET', url, authorization: v.shown };
  try {
    const r = await axios.get(url, { headers: token ? { Authorization: `Bearer ${token}` } : {}, timeout: 10000, validateStatus: () => true });
    return res.json({ request, status: r.status, wwwAuthenticate: r.headers?.['www-authenticate'] || null, body: r.data });
  } catch (err) {
    return res.status(502).json({ error: 'resource_unreachable', message: `Could not reach ${url} (${err.code || err.message}).`, request });
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
  const byo = modeOf(req) === 'byo';
  if (byo && req.params.id === 'replay') {
    return res.json({ id: req.params.id, ...test, pass: null, skipped: true, note: 'Skipped: replay would redeem (and so use up) your ID-JAG.' });
  }
  try {
    // byo reuses the pasted ID-JAG: we cannot mint one at someone else's IdP.
    const idJag = byo ? req.session?.idJagPlayground?.idJag : (await mintIdJag(req)).idJag;
    if (!idJag) return res.status(409).json({ error: 'no_id_jag', message: 'Paste and inspect your ID-JAG first.' });
    const ctx = redeemContext(req);
    let r;
    if (req.params.id === 'replay') {
      const first = await redeem(idJag, ctx);
      if (first.status !== 200) return res.json({ id: req.params.id, ...test, pass: false, note: `setup redeem failed (${first.status} ${first.data.error || ''})` });
      r = await redeem(idJag, ctx);
    } else if (req.params.id === 'bad-signature') {
      const [h, p, sig] = idJag.split('.');
      const flipped = sig.slice(0, -2) + (sig.slice(-2) === 'AA' ? 'BB' : 'AA');
      r = await redeem(`${h}.${p}.${flipped}`, ctx);
    } else if (req.params.id === 'client-mismatch') {
      r = await redeem(idJag, { ...ctx, clientId: 'mcp-inspector', clientSecret: '' });
    } else {
      r = await redeem(idJag, { ...ctx, scope: 'admin:delete' });
    }
    const refused = r.status >= 400 && !r.data.access_token;
    res.json({ id: req.params.id, ...test, pass: refused, status: r.status, error: r.data.error || null,
      error_description: r.data.error_description || null, request: r.request });
  } catch (err) {
    res.status(502).json({ id: req.params.id, ...test, pass: false, note: err.message });
  }
});

// Trusted-IdP registry. oauth-mcp and the PingFederate sync script fetch these server-to-server
// with no session (hosted-access wall bypasses them), so they need the shared ID_JAG_REGISTRY_TOKEN
// as a Bearer. Unconfigured = refuse (503), never serve openly.
function registryAuth(req, res, next) {
  const expected = process.env.ID_JAG_REGISTRY_TOKEN;
  if (!expected) {
    console.error('[id-jag] ID_JAG_REGISTRY_TOKEN is not set; refusing trusted-IdP registry reads (set it on the BFF and mcp-server)');
    return res.status(503).json({ error: 'registry_auth_unconfigured' });
  }
  const got = /^Bearer\s+(\S+)$/i.exec(req.get('authorization') || '')?.[1] || '';
  const digest = (v) => crypto.createHash('sha256').update(v).digest(); // equal lengths for timingSafeEqual
  return crypto.timingSafeEqual(digest(got), digest(expected)) ? next() : res.status(401).json({ error: 'unauthorized' });
}
router.get('/trusted-idps/registry', registryAuth, (_req, res) => res.json(trustedIdps.oauthMcpRegistry()));
router.get('/trusted-idps/pingfederate', registryAuth, (_req, res) => res.json(trustedIdps.pingfederateRegistry()));
router.get('/trusted-idps', authenticateToken, (req, res) => res.json({ idps: trustedIdps.list(), canManage: req.user?.role === 'admin' }));

const registryWrite = (fn) => [authenticateToken, requireAdmin, async (req, res) => {
  try {
    await fn(req, res);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.status === 404 ? 'not_found' : err.status ? 'invalid_request' : 'registry_write_failed', message: err.message });
  }
}];
router.post('/trusted-idps', ...registryWrite(async (req, res) => res.status(201).json(await trustedIdps.create(req.body))));
router.put('/trusted-idps/:id', ...registryWrite(async (req, res) => res.json(await trustedIdps.update(req.params.id, req.body))));
router.delete('/trusted-idps/:id', ...registryWrite(async (req, res) => { await trustedIdps.remove(req.params.id); res.status(204).end(); }));

router.post('/reset', (req, res) => {
  if (req.session) { delete req.session.idJagPlayground; delete req.session.idJagIssuer; delete req.session.idJagXaa; }
  res.json({ ok: true });
});

module.exports = router;
module.exports._inspect = inspect;
module.exports._settings = settings;
module.exports._clearProbeCache = () => probes.clear();
module.exports._resetXaaDiscovery = () => { xaaDiscoveryP = null; };
