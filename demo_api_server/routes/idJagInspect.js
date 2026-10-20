'use strict';

/**
 * ID-JAG Inspector API (mounted at /api/id-jag-inspect behind authenticateToken): decode any pasted token and run
 * the spec checks, and fetch each backend's discovery metadata. Stateless: a pasted token is decoded and dropped,
 * never stored or echoed back whole. Ported from the kit's server/src/inspectApi.js. The demo's resource AS
 * (oauth-mcp) keeps no decision record, so there is no events feed and no replay check here.
 */

const express = require('express');
const axios = require('axios');
const trustedIdps = require('../services/idJagTrustedIdps');
const { describeAssertion } = require('../services/samlAssertion');
const { decodeJwt } = require('../utils/tokenUtils');
const playground = require('./idJagPlayground');

const router = express.Router();
router.use(express.json());

const originOf = (u) => { try { return new URL(u).origin; } catch { return ''; } };
const trimSlash = (u) => String(u).replace(/\/$/, '');

/** Plain XML text from a pasted SAML assertion (raw, base64 or base64url), or null. */
function samlXml(token) {
  const t = String(token).trim();
  if (t.startsWith('<')) return t;
  if (/^[A-Za-z0-9+/_=-]+$/.test(t)) {
    const x = Buffer.from(t, 'base64').toString('utf8').trim();
    if (x.startsWith('<')) return x;
  }
  return null;
}

/** 'id-jag' | 'id-token' | 'access-token' | 'saml' | 'unknown'. */
function classify(token) {
  if (samlXml(token)) return 'saml';
  const d = decodeJwt(String(token).trim());
  if (!d) return 'unknown';
  const { header: h, claims: c } = d;
  if (h.typ === 'oauth-id-jag+jwt') return 'id-jag';
  if (String(h.typ).toLowerCase() === 'at+jwt') return 'access-token';
  if (c.nonce !== undefined || c.at_hash !== undefined || c.auth_time !== undefined) return 'id-token';
  return c.scope !== undefined || c.scp !== undefined || c.client_id !== undefined ? 'access-token' : 'id-token';
}

const checker = () => {
  const checks = [];
  return { checks, add: (id, label, ok, expected, actual, cite, warn = false) =>
    checks.push({ id, label, status: ok ? 'pass' : (warn ? 'warn' : 'fail'), expected, actual, cite }) };
};

/**
 * Who this ID-JAG's issuer is to the demo: the app's own PingFederate (oauth-mcp or the local PingFederate redeems),
 * or an enabled trusted-IdP registry entry. Returns { settings, name } or null.
 */
function trustFor(claims) {
  const own = playground._settings('oauth-mcp');
  if (own.idp.issuer && claims.iss === own.idp.issuer) return { name: own.idp.name, s: own };
  const entry = trustedIdps.findByIssuer(claims.iss);
  if (!entry) return null;
  const pfSettings = playground._settings('pf-pf');
  const target = pfSettings.resourceAs.issuer && claims.aud === pfSettings.resourceAs.issuer && entry.targets.includes('pingfederate') ? 'pingfederate' : 'oauth-mcp';
  const s = playground._byoSettings(target, entry);
  return { name: entry.name, entry, target, s: { ...s, resourceAs: { ...s.resourceAs, clientId: entry.idJagClientId || s.resourceAs.clientId } } };
}

async function checkIdJag(token, verify) {
  const d = decodeJwt(token);
  const trust = trustFor(d.claims);
  const s = trust ? trust.s : { ...playground._settings('oauth-mcp'), idp: { name: 'unknown issuer', issuer: d.claims.iss, jwksUrl: '' } };
  const result = await playground._inspect(token, s, trust ? verify : async () => ({ ok: false, note: 'not checked: the issuer is not a trusted IdP' }));
  const { checks, add } = checker();
  add('trusted-idp', 'Issuer is an approved trusted IdP', !!trust, 'the app\'s PingFederate or an enabled Trusted IdP entry', trust ? trust.name : (d.claims.iss || '(missing)'),
    'RFC 7523 §3: the AS MUST trust the issuer');
  return { ...result, checks: [...checks, ...result.checks], idp: trust ? { id: trust.entry?.id || 'pingfederate', name: trust.name } : null };
}

function checkJwt(type, token) {
  const { header: h, claims: c } = decodeJwt(token);
  const { checks, add } = checker();
  const now = Math.floor(Date.now() / 1000);
  add('alg', 'Signed, not alg:none', !!h.alg && h.alg !== 'none', 'RS256 (or another asymmetric alg)', h.alg, 'RFC 8725 §3.1');
  const required = type === 'id-token' ? ['iss', 'sub', 'aud', 'exp', 'iat'] : ['iss', 'sub', 'aud', 'exp'];
  for (const k of required) {
    add(`claim-${k}`, `Required claim ${k}`, c[k] !== undefined && c[k] !== '', 'present', c[k] === undefined ? '(missing)' : c[k],
      type === 'id-token' ? 'OpenID Connect Core §2' : 'RFC 9068 §2.2');
  }
  add('exp', 'Not expired', typeof c.exp === 'number' && c.exp > now, `> ${now}`, c.exp, 'RFC 7519 §4.1.4');
  add('signature', 'Signature', false, 'checked against the issuer JWKS', 'not checked here: only ID-JAGs from trusted IdPs are verified', 'RFC 7515', true);
  return { header: h, claims: c, checks };
}

function checkSaml(xml) {
  const a = describeAssertion(xml);
  const { checks, add } = checker();
  add('saml-issuer', 'Issuer present', !!a.issuer, 'present', a.issuer || '(missing)', 'SAML 2.0 Core §2.3.3');
  add('saml-subject', 'Subject NameID present', !!a.nameId, 'present', a.nameId || '(missing)', 'SAML 2.0 Core §2.3.3');
  add('saml-audience', 'Audience restriction present', !!a.audience, 'present', a.audience || '(missing)', 'SAML 2.0 Core §2.5.1.4');
  add('saml-expiry', 'Not expired', Date.parse(a.notOnOrAfter) > Date.now(), 'NotOnOrAfter in the future', a.notOnOrAfter || '(missing)', 'SAML 2.0 Core §2.5.1');
  add('saml-signature', 'Signed', !!a.signature.algorithm, 'a ds:Signature', a.signature.algorithm || '(none)', 'SAML 2.0 Core §5');
  return { assertion: a, checks };
}

/** Detect the token kind and run its checks. verify is injectable for tests. */
async function checkToken(token, { verify } = {}) {
  const t = String(token).trim();
  const type = classify(t);
  if (type === 'unknown') return { type, checks: [] };
  if (type === 'saml') {
    try { return { type, ...checkSaml(samlXml(t)) }; } catch { return { type: 'unknown', checks: [] }; }
  }
  return { type, ...(type === 'id-jag' ? await checkIdJag(t, verify) : checkJwt(type, t)) };
}

router.post('/decode', async (req, res) => {
  const token = typeof req.body?.token === 'string' ? req.body.token.trim() : '';
  if (!token || token.length > 65536) return res.status(400).json({ error: 'invalid_token', message: 'Paste a token (a JWT or a SAML assertion).' });
  return res.json(await checkToken(token));
});

/**
 * Reveal the ID-JAG this session minted in the playground, on an explicit click only. The token is read from the
 * caller's own session (never from the request), sent once with no-store, and never logged.
 */
router.post('/issued-token', (req, res) => {
  res.set('Cache-Control', 'no-store');
  if (!req.user) return res.status(401).json({ error: 'unauthorized', message: 'Sign in to use the Inspector.' });
  const minted = req.session?.idJagPlayground;
  if (!minted?.idJag || !minted.issuedAt) return res.status(404).json({ error: 'no_id_jag', message: 'Get an ID-JAG first.' });
  return res.json({ token: minted.idJag });
});

const PROFILE_FIELDS = ['authorization_grant_profiles_supported', 'scopes_supported'];

router.get('/discovery', async (_req, res) => {
  const s = playground._settings('oauth-mcp');
  const as = originOf(s.resourceAs.tokenEndpoint);
  const gw = playground._nodeGatewayUrl();
  const targets = [
    { id: 'resource-as', label: 'Resource AS (oauth-mcp)', url: as && `${as}/.well-known/oauth-authorization-server` },
    { id: 'pingfederate', label: 'PingFederate', url: s.idp.issuer && `${trimSlash(s.idp.issuer)}/.well-known/openid-configuration` },
    { id: 'mcp', label: 'MCP gateway', url: gw && `${originOf(gw)}/.well-known/oauth-protected-resource` },
  ].filter((t) => t.url);
  const backends = await Promise.all(targets.map(async (t) => {
    try {
      const r = await axios.get(t.url, { timeout: 4000, validateStatus: () => true });
      if (r.status !== 200 || !r.data || typeof r.data !== 'object') return { ...t, error: `HTTP ${r.status}` };
      return { ...t, data: r.data, profileFields: Object.fromEntries(PROFILE_FIELDS.map((f) => [f, Array.isArray(r.data[f]) && r.data[f].length > 0])) };
    } catch (err) {
      return { ...t, error: err.code || err.message };
    }
  }));
  res.json({ backends });
});

module.exports = { router, classify, checkToken };
