'use strict';

/**
 * PingOne bearer gate for the A2A hop (A2A v1.0 §7.3-7.5).
 *
 * The hop carries the Exchange #1 DELEGATED token: subject = the user,
 * act = the generalist, audience = this one specialist's intermediate resource.
 * A bare client_credentials token is rejected — it proves no user.
 *
 * Today, only the HTTP route (services/a2aProtocolServer.js, via
 * requireA2aPingOneBearer) enforces this. services/a2aProtocolClient.js's
 * in-process path does not yet call verifyA2aBearer — wiring it there is a
 * later task, not done here. Until that lands, the in-process path is a gap.
 */

const { validateToken } = require('../services/tokenValidationService');
const oauthConfig = require('../config/oauth');
const { specialistForVertical } = require('../config/a2aSpecialists');

function defaultConfigStore() {
  return require('../services/configStore');
}
function defaultDelegation() {
  return require('../services/a2aDelegationService');
}

class A2aAuthError extends Error {
  /**
   * @param {'invalid_token'|'insufficient_scope'} code
   * @param {{ status: number, challenge: string, logDetail: string }} info
   */
  constructor(code, { status, challenge, logDetail }) {
    // Deliberately generic: the specific reason goes to the log, not the client
    // (spec §3.3.2 — MUST NOT reveal what the caller is not authorized to see).
    super(code === 'insufficient_scope' ? 'insufficient_scope' : 'unauthorized');
    this.name = 'A2aAuthError';
    this.code = code;
    this.status = status;
    this.challenge = challenge;
    this.logDetail = logDetail;
  }
}

function invalidToken(logDetail) {
  return new A2aAuthError('invalid_token', {
    status: 401,
    challenge: 'Bearer error="invalid_token"',
    logDetail,
  });
}

function insufficientScope(scope, logDetail) {
  return new A2aAuthError('insufficient_scope', {
    status: 403,
    challenge: `Bearer error="insufficient_scope", scope="${scope}"`,
    logDetail,
  });
}

/** aud may be a string or an array (PingOne emits either). */
function audienceMatches(aud, expected) {
  if (!expected) return false;
  const list = Array.isArray(aud) ? aud : [aud];
  return list.filter(Boolean).map(String).includes(String(expected));
}

/** RFC 8693 §4.1 canonical actor is act.sub; PingOne also emits act.client_id. */
function actorIdOf(act) {
  if (!act || typeof act !== 'object') return null;
  return String(act.client_id || act.sub || '') || null;
}

/**
 * Validate an inbound A2A bearer for one specialist.
 * @param {string} token
 * @param {{ vertical: string, cfg?: object, deps?: object }} opts
 * @returns {Promise<object>} validated claims
 * @throws {A2aAuthError}
 */
async function verifyA2aBearer(token, { vertical, cfg: cfgArg, deps = {} } = {}) {
  if (!token) throw invalidToken('no bearer presented');

  const specialist = specialistForVertical(vertical);
  if (!specialist) throw invalidToken(`no specialist for vertical "${vertical}"`);

  const cfg = cfgArg || deps.configStore || defaultConfigStore();
  const delegation = deps.delegation || defaultDelegation();
  const { resolveA2aConfig, countActDepth } = delegation;
  const c = resolveA2aConfig(cfg, specialist);
  const requiredScope = `agent:invoke:${specialist.appKey}`;

  // 1. Signature (RS256 via PingOne JWKS), issuer, exp, nbf.
  let claims;
  try {
    claims = await validateToken(token, {
      jwksUri: oauthConfig.jwksEndpoint,
      issuer: oauthConfig.issuer,
    });
  } catch (err) {
    throw invalidToken(`signature/issuer/expiry check failed: ${err.message}`);
  }
  if (!claims || typeof claims !== 'object') throw invalidToken('token is not a decodable JWT');

  // 2. Audience — RFC 8707. A token for specialist A must not work on B.
  if (!audienceMatches(claims.aud, c.intermediateAud)) {
    throw invalidToken(
      `aud ${JSON.stringify(claims.aud)} does not include this specialist's ${c.intermediateAud}`,
    );
  }

  // 3. Scope.
  const scopes = String(claims.scope || '').split(/\s+/).filter(Boolean);
  if (!scopes.includes(requiredScope)) {
    throw insufficientScope(requiredScope, `scope "${claims.scope || ''}" lacks ${requiredScope}`);
  }

  // 4. Delegation shape: act present, exactly one level deep.
  //    No act  → a machine token with no user behind it.
  //    Depth 2 → an Exchange #2 token replayed back into the hop.
  const depth = countActDepth(claims.act);
  if (depth !== 1) throw invalidToken(`act chain depth ${depth}, expected exactly 1`);

  // 5. Actor must be the generalist — only it may call a specialist.
  const generalist = String(cfg.getEffective('pingone_ai_agent_client_id') || '');
  const actor = actorIdOf(claims.act);
  if (!generalist || actor !== generalist) {
    throw invalidToken(`actor ${actor || '(none)'} is not the generalist ${generalist || '(unset)'}`);
  }

  if (!claims.sub) throw invalidToken('no subject (sub) on the delegated token');
  return claims;
}

/**
 * Express middleware factory for one vertical's JSON-RPC mount.
 * @param {string} vertical
 */
function requireA2aPingOneBearer(vertical) {
  return async function a2aBearerGate(req, res, next) {
    const match = /^Bearer\s+(.+)$/i.exec(req.headers.authorization || '');
    if (!match) {
      res.set('WWW-Authenticate', 'Bearer error="invalid_token"');
      return res.status(401).json({ error: 'unauthorized' });
    }
    try {
      const token = match[1].trim();
      const claims = await verifyA2aBearer(token, { vertical });
      req.a2aPingOne = {
        token,
        claims,
        clientId: actorIdOf(claims.act),
        userSub: String(claims.sub),
      };
      return next();
    } catch (err) {
      const e = err instanceof A2aAuthError ? err : invalidToken(err.message);
      console.warn('[a2a] bearer rejected for %s: %s', vertical, e.logDetail);
      res.set('WWW-Authenticate', e.challenge);
      return res.status(e.status).json({ error: e.message });
    }
  };
}

/**
 * @a2a-js UserBuilder: the A2A user is the USER the token is for, with the
 * generalist recorded as the actor. Call only after requireA2aPingOneBearer.
 */
function pingOneA2aUserBuilder(req) {
  const info = req.a2aPingOne;
  const name = info?.userSub || 'anonymous';
  const authed = !!info?.userSub;
  return Promise.resolve({
    get isAuthenticated() {
      return authed;
    },
    get userName() {
      return name;
    },
    get actor() {
      return info?.clientId || null;
    },
  });
}

module.exports = {
  verifyA2aBearer,
  requireA2aPingOneBearer,
  pingOneA2aUserBuilder,
  A2aAuthError,
};
