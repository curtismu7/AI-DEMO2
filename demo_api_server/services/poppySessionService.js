'use strict';

/**
 * Personal Agent Protocol (Poppy, Draft 0.3) — Poppy-Session header (spec §5.2).
 * Zero external deps, Node built-in crypto only (same style as dpopKeyService).
 *
 * A Session JWT is signed by a short-lived delegated key; the delegation JWT binding
 * that key to the agent's client_id travels in the `pap_dlg` header and is signed by a
 * key in the agent's jwks_uri. Both halves live here: the verifier (Company side) and
 * the signers (used by the test signer script and, later, a Personal Agent).
 */

const crypto = require('node:crypto');

const SESSION_TYP = 'poppy-session+jwt';
const DELEGATION_TYP = 'pap-delegation+jwt';
const MAX_DELEGATION_SECONDS = 24 * 60 * 60;
const DEFAULT_IAT_WINDOW_SECONDS = 60;

class PoppyError extends Error {
  constructor(code, reason) {
    super(`${code}: ${reason}`);
    this.code = code;
    this.reason = reason;
  }
}

const invalid = (reason) => new PoppyError('invalid_session', reason);
const b64url = (input) => Buffer.from(input).toString('base64url');

function jwkThumbprint(jwk) {
  const canonical = JSON.stringify({ crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y });
  return crypto.createHash('sha256').update(canonical).digest('base64url');
}

function signJws(header, payload, privateKey) {
  const input = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const sig = crypto.sign('sha256', Buffer.from(input), { key: privateKey, dsaEncoding: 'ieee-p1363' });
  return `${input}.${sig.toString('base64url')}`;
}

function decodeJws(token, label) {
  const parts = typeof token === 'string' ? token.split('.') : [];
  if (parts.length !== 3) throw invalid(`${label} is not a compact JWS`);
  try {
    return {
      header: JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')),
      payload: JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')),
      signingInput: Buffer.from(`${parts[0]}.${parts[1]}`),
      signature: Buffer.from(parts[2], 'base64url'),
    };
  } catch {
    throw invalid(`${label} is not valid JSON`);
  }
}

function verifySignature(alg, jwk, jws, label) {
  let ok = false;
  try {
    const key = crypto.createPublicKey({ key: jwk, format: 'jwk' });
    if (alg === 'ES256') {
      ok = crypto.verify('sha256', jws.signingInput, { key, dsaEncoding: 'ieee-p1363' }, jws.signature);
    } else if (alg === 'PS384') {
      ok = crypto.verify(
        'sha384',
        jws.signingInput,
        { key, padding: crypto.constants.RSA_PKCS1_PSS_PADDING, saltLength: 48 },
        jws.signature,
      );
    }
  } catch {
    ok = false;
  }
  if (!ok) throw invalid(`${label} signature does not verify`);
}

/**
 * A Session ID belongs to one User, one agent and one client (spec 5.3). The first verified use binds it; a later use that names a
 * different User ID, agent or client is refused. Bounded in size and expires after a day.
 */
function createSessionBinding({ maxEntries = 10000, ttlSeconds = 24 * 3600 } = {}) {
  const bound = new Map(); // sid key -> { sub, agentId, clientId, exp }
  return {
    /** @returns {boolean} true if the sid is already bound to something else */
    conflicts(key, { sub, agentId, clientId }, nowSeconds) {
      for (const [k, v] of bound) if (v.exp <= nowSeconds) bound.delete(k); else break;
      const hit = bound.get(key);
      if (hit) return hit.sub !== sub || hit.clientId !== clientId || (hit.agentId ?? null) !== (agentId ?? null);
      bound.set(key, { sub, agentId, clientId, exp: nowSeconds + ttlSeconds });
      while (bound.size > maxEntries) bound.delete(bound.keys().next().value);
      return false;
    },
  };
}

/** In-memory jti replay guard; entries expire with the iat window. */
function createReplayCache(ttlSeconds = DEFAULT_IAT_WINDOW_SECONDS * 2) {
  const seen = new Map();
  return {
    /** @returns {boolean} true if the jti was already seen */
    check(jti, nowSeconds) {
      for (const [id, exp] of seen) if (exp <= nowSeconds) seen.delete(id);
      if (seen.has(jti)) return true;
      seen.set(jti, nowSeconds + ttlSeconds);
      return false;
    },
  };
}

/**
 * Verify a Poppy-Session header (spec §5.2, resource-side order).
 *
 * @param {object} p
 * @param {string} p.sessionJwt        value of the Poppy-Session header
 * @param {string} p.method            request method
 * @param {string} p.url               absolute request URL (query and fragment are stripped)
 * @param {string} p.issuer            this Company's authorization server issuer (session `aud`)
 * @param {string} [p.accessToken]     bearer/DPoP access token on the request, if any
 * @param {string} [p.accessTokenClientId] client_id claim of that token, if known
 * @param {(clientId: string) => Promise<{keys: object[]}>} p.resolveJwks agent's jwks_uri contents
 * @param {{check: Function}} p.replayCache
 * @param {number} [p.now]             epoch seconds (tests)
 * @param {number} [p.iatWindowSeconds]
 * @returns {Promise<{sub: string, sid: string, agentId?: string, clientId: string}>}
 */
async function verifyPoppySession(p) {
  const now = p.now ?? Math.floor(Date.now() / 1000);
  const window = p.iatWindowSeconds ?? DEFAULT_IAT_WINDOW_SECONDS;

  const session = decodeJws(p.sessionJwt, 'Poppy-Session');
  const { header } = session;
  if (header.typ !== SESSION_TYP) throw invalid('Poppy-Session typ is wrong');
  if (header.alg !== 'ES256') throw invalid('Poppy-Session alg must be ES256');
  if (typeof header.kid !== 'string' || typeof header.pap_dlg !== 'string') {
    throw invalid('Poppy-Session header needs kid and pap_dlg');
  }

  // 1. Delegation, verified against the agent's jwks_uri.
  const delegation = decodeJws(header.pap_dlg, 'delegation');
  const d = delegation.payload;
  if (delegation.header.typ !== DELEGATION_TYP) throw invalid('delegation typ is wrong');
  if (!['ES256', 'PS384'].includes(delegation.header.alg)) throw invalid('delegation alg must be ES256 or PS384');
  if (typeof d.iss !== 'string' || typeof delegation.header.kid !== 'string') throw invalid('delegation needs iss and kid');
  if (!d.cnf || !d.cnf.jwk) throw invalid('delegation needs cnf.jwk');
  if (typeof d.jti !== 'string') throw invalid('delegation needs jti');
  if (!Number.isFinite(d.iat) || !Number.isFinite(d.exp)) throw invalid('delegation needs iat and exp');
  if (d.exp - d.iat > MAX_DELEGATION_SECONDS) throw invalid('delegation lifetime exceeds 24 hours');
  if (d.exp <= now) throw invalid('delegation has expired');
  if ('sub' in d || 'agent_id' in d || 'aud' in d) throw invalid('delegation must not carry identifying data');

  let jwks;
  try {
    jwks = await p.resolveJwks(d.iss);
  } catch {
    throw invalid('agent jwks could not be resolved');
  }
  const signer = (jwks?.keys || []).find((k) => k.kid === delegation.header.kid);
  if (!signer) throw invalid('delegation kid not found in agent jwks');
  verifySignature(delegation.header.alg, signer, delegation, 'delegation');

  // 2. Session JWT, verified with the delegated key.
  if (header.kid !== jwkThumbprint(d.cnf.jwk)) throw invalid('Poppy-Session kid is not the delegated key thumbprint');
  verifySignature('ES256', d.cnf.jwk, session, 'Poppy-Session');

  const c = session.payload;
  if (c.iss !== d.iss) throw invalid('Poppy-Session iss does not match the delegation');
  if (c.aud !== p.issuer) throw invalid('Poppy-Session aud is not this issuer');
  if (typeof c.sid !== 'string' || typeof c.sub !== 'string' || typeof c.jti !== 'string') {
    throw invalid('Poppy-Session needs sid, sub and jti');
  }
  if (c.htm !== String(p.method).toUpperCase()) throw invalid('Poppy-Session htm does not match the request method');
  const htu = String(p.url).split('#')[0].split('?')[0];
  if (c.htu !== htu) throw invalid('Poppy-Session htu does not match the request URL');
  if (!Number.isFinite(c.iat) || Math.abs(now - c.iat) > window) throw invalid('Poppy-Session iat is outside the accepted window');
  if (c.iat > d.exp) throw invalid('Poppy-Session iat is after the delegation expired');

  if (!p.accessToken && c.ath !== undefined) throw invalid('Poppy-Session has ath but the request has no access token');
  if (p.accessToken) {
    const ath = crypto.createHash('sha256').update(p.accessToken).digest('base64url');
    if (c.ath !== ath) throw invalid('Poppy-Session ath does not match the access token');
    if (p.accessTokenClientId && p.accessTokenClientId !== c.iss) {
      throw invalid('access token client_id does not match the Poppy-Session iss');
    }
  }

  if (p.replayCache.check(`${c.iss}|${c.jti}`, now)) throw invalid('Poppy-Session jti was already used');
  if (p.sessionBinding && p.sessionBinding.conflicts(`${c.iss}|${c.sid}`, { sub: c.sub, agentId: c.agent_id, clientId: c.iss }, now)) {
    throw invalid('Poppy-Session sid is bound to another User ID, agent or client');
  }

  return { sub: c.sub, sid: c.sid, agentId: c.agent_id, clientId: c.iss };
}

/** Delegation JWT (agent side): jwks_uri key vouches for a short-lived delegated public key. */
function signDelegation({ clientId, jwksKid, jwksPrivateKey, delegatedPublicJwk, now, lifetimeSeconds = 3600 }) {
  const iat = now ?? Math.floor(Date.now() / 1000);
  return signJws(
    { typ: DELEGATION_TYP, alg: 'ES256', kid: jwksKid },
    { iss: clientId, iat, exp: iat + lifetimeSeconds, jti: crypto.randomUUID(), cnf: { jwk: delegatedPublicJwk } },
    jwksPrivateKey,
  );
}

/** Session JWT (agent side), signed by the delegated key. */
function signSession({ delegation, delegatedPrivateKey, delegatedPublicJwk, clientId, issuer, sid, sub, agentId, method, url, accessToken, now }) {
  const payload = {
    iss: clientId,
    aud: issuer,
    sid,
    sub,
    htm: String(method).toUpperCase(),
    htu: String(url).split('#')[0].split('?')[0],
    iat: now ?? Math.floor(Date.now() / 1000),
    jti: crypto.randomUUID(),
  };
  if (agentId) payload.agent_id = agentId;
  if (accessToken) payload.ath = crypto.createHash('sha256').update(accessToken).digest('base64url');
  return signJws(
    { typ: SESSION_TYP, alg: 'ES256', kid: jwkThumbprint(delegatedPublicJwk), pap_dlg: delegation },
    payload,
    delegatedPrivateKey,
  );
}

/**
 * Express middleware: enforce Poppy-Session on requests that carry an access token (spec §5.2:
 * "Requests with an access token but no Session header must be rejected").
 * Requests with neither header pass through (anonymous browsing); invalid sessions get 400.
 */
function requirePoppySession({ getIssuer, resolveJwks, replayCache = createReplayCache(), now }) {
  return async (req, res, next) => {
    const header = req.get('poppy-session');
    const auth = req.get('authorization') || '';
    const accessToken = /^(Bearer|DPoP)\s+(.+)$/i.exec(auth)?.[2];
    try {
      if (!header) {
        if (accessToken) throw invalid('access token sent without a Poppy-Session header');
        return next();
      }
      req.poppy = await verifyPoppySession({
        sessionJwt: header,
        method: req.method,
        url: `${req.protocol}://${req.get('host')}${req.originalUrl}`,
        issuer: getIssuer(),
        accessToken,
        resolveJwks,
        replayCache,
        now: now?.(),
      });
      return next();
    } catch (err) {
      if (err instanceof PoppyError) return res.status(400).json({ error: err.code, error_description: err.reason });
      return next(err);
    }
  };
}

module.exports = {
  createSessionBinding,
  PoppyError,
  jwkThumbprint,
  createReplayCache,
  verifyPoppySession,
  signDelegation,
  signSession,
  requirePoppySession,
};
