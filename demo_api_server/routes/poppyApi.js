'use strict';

/**
 * Personal Agent Protocol (Poppy, Draft 0.3) — the Company's OpenAPI API (§7).
 *
 *   GET /poppy/api/openapi.json   public description (listed in poppy.json `apis`)
 *   GET /poppy/api/v1/me          needs a PingFederate bearer with accounts:read AND a Poppy-Session
 *
 * Every request to /v1 must carry a Poppy-Session header (§5.2); the token's client_id must be the
 * session's iss. Only agents listed in POPPY_ALLOWED_AGENTS (client_id URLs) are accepted — the
 * list is empty by default, so nothing is accepted until an operator names an agent (§4.1: Companies
 * decide which Personal Agents they accept). Refusals at a resource are `invalid_session` (§4.1).
 */

const express = require('express');
const configStore = require('../services/configStore');
const { validateToken } = require('../services/tokenValidationService');
const { verifyPoppySession, createReplayCache } = require('../services/poppySessionService');
const { isPoppyHost } = require('./poppyDiscovery');

const REQUIRED_SCOPE = 'accounts:read';
const JWKS_TTL_MS = 5 * 60 * 1000;

const OPENAPI = {
  openapi: '3.1.0',
  info: { title: 'Super Banking Poppy API', version: '0.1.0' },
  paths: {
    '/poppy/api/v1/me': {
      get: {
        operationId: 'getMe',
        summary: 'Who the Company sees for this Poppy Session',
        security: [{ oauth: [REQUIRED_SCOPE] }],
        responses: { 200: { description: 'The Poppy User ID, Session ID and granted scopes' } },
      },
    },
  },
  components: {
    securitySchemes: {
      oauth: {
        type: 'oauth2',
        flows: { authorizationCode: { authorizationUrl: 'about:blank', tokenUrl: 'about:blank', scopes: { [REQUIRED_SCOPE]: 'Read account details' } } },
      },
    },
  },
};

function allowedAgents() {
  return String(process.env.POPPY_ALLOWED_AGENTS || '').split(',').map((s) => s.trim()).filter(Boolean);
}

/**
 * Resolve an allow-listed agent's public keys: client metadata document (CIMD) at the client_id URL,
 * then its jwks_uri on the same host (§4.1). Only allow-listed https URLs are ever fetched.
 */
function createAgentJwksResolver({ fetchJson, now = () => Date.now() } = {}) {
  const cache = new Map();
  const get = fetchJson || (async (url) => {
    const r = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(5000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  });
  return async function resolveJwks(clientId) {
    if (!allowedAgents().includes(clientId)) throw new Error('agent not allowed');
    const hit = cache.get(clientId);
    if (hit && hit.exp > now()) return hit.jwks;
    const url = new URL(clientId);
    if (url.protocol !== 'https:') throw new Error('client_id must be https');
    const meta = await get(clientId);
    if (meta.client_id !== clientId) throw new Error('client metadata client_id mismatch');
    const jwksUrl = new URL(meta.jwks_uri);
    if (jwksUrl.protocol !== 'https:' || jwksUrl.host !== url.host) throw new Error('jwks_uri must be https on the client_id host');
    const jwks = await get(meta.jwks_uri);
    cache.set(clientId, { jwks, exp: now() + JWKS_TTL_MS });
    return jwks;
  };
}

function scopesOf(payload) {
  if (typeof payload.scope === 'string') return payload.scope.split(' ').filter(Boolean);
  if (Array.isArray(payload.scope)) return payload.scope;
  if (Array.isArray(payload.scp)) return payload.scp;
  return [];
}

function createPoppyApiRouter(deps = {}) {
  const router = express.Router();
  const verifyToken = deps.validateToken || validateToken;
  const resolveJwks = deps.resolveJwks || createAgentJwksResolver();
  const replayCache = deps.replayCache || createReplayCache();
  const now = deps.now || (() => undefined);
  const issuer = () => String(configStore.getEffective('pf_issuer') || '').trim();

  router.use((req, res, next) => (isPoppyHost(req) ? next() : res.status(404).json({ error: 'not_found' })));

  router.get('/openapi.json', (_req, res) => res.json(OPENAPI));

  router.use('/v1', async (req, res, next) => {
    const invalidSession = (reason) => res.status(400).json({ error: 'invalid_session', error_description: reason });
    const sessionJwt = req.get('poppy-session');
    if (!sessionJwt) return invalidSession('Poppy-Session header is required');

    const match = /^Bearer\s+(.+)$/i.exec(req.get('authorization') || '');
    if (!match) {
      res.set('WWW-Authenticate', `Bearer scope="${REQUIRED_SCOPE}"`);
      return res.status(401).json({ error: 'unauthorized' });
    }
    const accessToken = match[1];

    let payload;
    try {
      const iss = issuer();
      payload = await verifyToken(accessToken, { jwksUri: process.env.PF_JWKS_URI || `${iss}/pf/JWKS`, issuer: iss });
    } catch {
      res.set('WWW-Authenticate', 'Bearer error="invalid_token"');
      return res.status(401).json({ error: 'invalid_token' });
    }
    if (typeof payload.client_id !== 'string') {
      res.set('WWW-Authenticate', 'Bearer error="invalid_token"');
      return res.status(401).json({ error: 'invalid_token' });
    }
    const scopes = scopesOf(payload);
    if (!scopes.includes(REQUIRED_SCOPE)) {
      res.set('WWW-Authenticate', `Bearer error="insufficient_scope", scope="${REQUIRED_SCOPE}"`);
      return res.status(403).json({ error: 'insufficient_scope', scope: REQUIRED_SCOPE });
    }

    try {
      req.poppy = await verifyPoppySession({
        sessionJwt,
        method: req.method,
        url: `https://${req.get('host')}${req.originalUrl}`,
        issuer: issuer(),
        accessToken,
        accessTokenClientId: payload.client_id,
        resolveJwks,
        replayCache,
        now: now(),
      });
    } catch (err) {
      if (err && err.code === 'invalid_session') return invalidSession(err.reason);
      return next(err);
    }
    req.poppyScopes = scopes;
    return next();
  });

  router.get('/v1/me', (req, res) => {
    res.json({ user_id: req.poppy.sub, session_id: req.poppy.sid, agent_id: req.poppy.agentId, scopes: req.poppyScopes });
  });

  return router;
}

module.exports = { createPoppyApiRouter, createAgentJwksResolver, OPENAPI };
