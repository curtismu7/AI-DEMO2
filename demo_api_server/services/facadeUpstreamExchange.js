'use strict';
/**
 * facadeUpstreamExchange.js — RFC 8693 exchange for the façade's next hop.
 *
 * WHY THIS EXISTS. A façade door that forwards the caller's bearer hands the
 * upstream a token minted for the GATEWAY's audience. `oauth-mcp` refuses that
 * on purpose (auth/lastHopAuthorization.ts, "D-05 anti-bypass"):
 *
 *   D-05 violation: gateway-audience token cannot be used at upstream
 *   (aud includes "mcpgateway.ping.demo").
 *   The gateway must perform RFC 8693 exchange before forwarding.
 *
 * That refusal is not a bug to route around — it is the invariant this demo
 * exists to show: a per-hop token must not skip a hop. The fix is to do what it
 * asks, which is what this module does.
 *
 * THE CONTRACT IS NARROWER THAN IT LOOKS. `MCP_SERVER_RESOURCE_URI` lists
 * several accepted audiences AND includes the gateway audience, so satisfying
 * "upstream aud matches" is not enough — Rule 1 rejects any token still
 * carrying the gateway audience. The exchanged token must name the upstream
 * audience SPECIFICALLY (e.g. `mcpserver.ping.demo`) and must not also carry
 * the gateway one. Requesting a single `audience` is what keeps that true.
 *
 * Deliberately NOT reusing agentMcpTokenService: its exchange is welded to the
 * agent request/tool/use-case pipeline (token event streams, use-case
 * simulation, TraT/RAR extras). This hop needs one thing — swap audience A for
 * audience B — and borrowing that machinery would drag the agent's semantics
 * onto a plain proxy hop.
 *
 * client_secret_POST, not basic: measured against client 6586d3de — basic is
 * refused with `invalid_client: Unsupported authentication method`.
 */
const axios = require('axios');
const configStore = require('./configStore');
const scopeTopology = require('./scopeTopology');
const { normalizeAxiosError } = require('../utils/normalizeAxiosError');

const TIMEOUT_MS = 10_000;
const GRANT_TYPE = 'urn:ietf:params:oauth:grant-type:token-exchange';
const ACCESS_TOKEN_TYPE = 'urn:ietf:params:oauth:token-type:access_token';

/**
 * Short-lived cache keyed by (subject token, audience).
 *
 * A tools/list plus a handful of tools/call would otherwise mint a fresh token
 * per JSON-RPC message. Keyed by the SUBJECT token so a different caller can
 * never be served another caller's exchanged token, and expired entries are
 * swept on write so there is no timer to leak.
 */
const cache = new Map();
const EXPIRY_SKEW_MS = 30_000;

function cacheKey(subjectToken, audience, scopes = []) {
  // The subject token is the identity here; hashing keeps whole JWTs out of a
  // long-lived map without weakening the key.
  const crypto = require('node:crypto');
  return `${crypto.createHash('sha256').update(String(subjectToken)).digest('hex')}::${audience}::${scopes.join(' ')}`;
}

function readCache(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (hit.expiresAt - EXPIRY_SKEW_MS <= Date.now()) {
    cache.delete(key);
    return null;
  }
  return hit.accessToken;
}

function writeCache(key, accessToken, expiresInSeconds) {
  const now = Date.now();
  for (const [k, v] of cache) if (v.expiresAt <= now) cache.delete(k);
  cache.set(key, { accessToken, expiresAt: now + (expiresInSeconds || 300) * 1000 });
}

function resolveExchangeClient() {
  const region = process.env.PINGONE_REGION || configStore.getEffective('PINGONE_REGION') || 'com';
  const envId = process.env.PINGONE_ENVIRONMENT_ID || configStore.getEffective('PINGONE_ENVIRONMENT_ID');
  const clientId = process.env.PINGONE_MCP_GATEWAY_CLIENT_ID
    || configStore.getEffective('PINGONE_MCP_GATEWAY_CLIENT_ID');
  const clientSecret = process.env.PINGONE_MCP_GATEWAY_CLIENT_SECRET
    || configStore.getEffective('PINGONE_MCP_GATEWAY_CLIENT_SECRET');
  if (!envId || !clientId || !clientSecret) return null;
  return { tokenEndpoint: `https://auth.pingone.${region}/${envId}/as/token`, clientId, clientSecret };
}

/** Is the exchange configured at all? Callers use this to stay a no-op when it is not. */
function isConfigured() {
  return Boolean(resolveExchangeClient());
}

/**
 * Exchange `subjectToken` for one whose `aud` is `audience`.
 *
 * Throws rather than returning the original token on failure: silently
 * forwarding the un-exchanged token is exactly the bypass D-05 exists to catch,
 * and it would surface as a confusing upstream 401 instead of a clear reason
 * here.
 *
 * @param {string} subjectToken caller's bearer (gateway audience)
 * @param {string} audience     the upstream's audience, e.g. mcpserver.ping.demo
 * @param {string[]} [scopes]   optional scope narrowing
 * @returns {Promise<{accessToken: string, cached: boolean}>} `cached` is
 *   reported so the trace can show a real mint distinctly from a cache hit —
 *   a demo that shows "exchange" on every message teaches the wrong thing
 *   about how often a token is actually minted.
 */
async function exchangeForUpstream(subjectToken, audience, scopes = []) {
  if (!subjectToken) {
    const e = new Error('token exchange requires a subject token');
    e.code = 'exchange_no_subject';
    throw e;
  }
  if (!audience) {
    const e = new Error('token exchange requires a target audience');
    e.code = 'exchange_no_audience';
    throw e;
  }
  const client = resolveExchangeClient();
  if (!client) {
    const e = new Error(
      'RFC 8693 exchange is not configured — set PINGONE_MCP_GATEWAY_CLIENT_ID and '
      + 'PINGONE_MCP_GATEWAY_CLIENT_SECRET (demo_api_server/.env).',
    );
    e.code = 'exchange_not_configured';
    throw e;
  }

  const key = cacheKey(subjectToken, audience, scopes);
  const cached = readCache(key);
  if (cached) return { accessToken: cached, cached: true };

  const body = new URLSearchParams({
    grant_type: GRANT_TYPE,
    subject_token: subjectToken,
    subject_token_type: ACCESS_TOKEN_TYPE,
    audience,
    client_id: client.clientId,
    client_secret: client.clientSecret,
  });
  if (scopes.length) body.set('scope', scopes.join(' '));

  let resp;
  try {
    resp = await axios.post(client.tokenEndpoint, body.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: TIMEOUT_MS,
    });
  } catch (err) {
    const n = normalizeAxiosError(err, { label: 'RFC 8693 upstream exchange', timeoutMs: TIMEOUT_MS });
    n.code = 'exchange_failed';
    throw n;
  }

  const token = resp.data?.access_token;
  if (!token) {
    const e = new Error('RFC 8693 exchange returned no access_token');
    e.code = 'exchange_no_token';
    throw e;
  }
  writeCache(key, token, resp.data.expires_in);
  return { accessToken: token, cached: false };
}

function resolveAgentGatewayClient() {
  const region = process.env.PINGONE_REGION || configStore.getEffective('PINGONE_REGION') || 'com';
  const envId = process.env.PINGONE_ENVIRONMENT_ID || configStore.getEffective('PINGONE_ENVIRONMENT_ID');
  const clientId = process.env.PINGONE_AI_AGENT_ACTOR_CLIENT_ID
    || configStore.getEffective('pingone_ai_agent_actor_client_id');
  const clientSecret = process.env.PINGONE_AI_AGENT_ACTOR_CLIENT_SECRET
    || configStore.getEffective('pingone_ai_agent_actor_client_secret');
  if (!envId || !clientId || !clientSecret) return null;
  return {
    tokenEndpoint: `https://auth.pingone.${region}/${envId}/as/token`,
    clientId,
    clientSecret,
    authMethod: (process.env.PINGONE_AI_AGENT_CC_AUTH_METHOD || 'post').toLowerCase(),
  };
}

function agentGatewayAudience() {
  return process.env.PINGONE_RESOURCE_AGENT_GATEWAY_URI
    || configStore.getEffective('pingone_resource_agent_gateway_uri')
    || scopeTopology.resourceUri('Super Banking Agent Gateway')
    || 'agentgateway.ping.demo';
}

function isAgentGatewayConfigured() {
  return Boolean(resolveAgentGatewayClient());
}

function withClientAuth(client, body) {
  if (client.authMethod === 'basic') {
    body.delete('client_secret');
    return { Authorization: `Basic ${Buffer.from(`${client.clientId}:${client.clientSecret}`).toString('base64')}` };
  }
  body.set('client_id', client.clientId);
  body.set('client_secret', client.clientSecret);
  return {};
}

/**
 * Exchange a plain MCP-client user token for the Agent Gateway token that the
 * gateway's agent-mediated tools require. The actor token is deliberately
 * minted by the configured AI Agent application and included in the exchange;
 * a subject-only audience swap would still arrive without an `act` claim and
 * would be denied as impersonation before tool-specific policy runs.
 */
async function exchangeForAgentGateway(subjectToken, scopes = ['agent:invoke']) {
  if (!subjectToken) {
    const e = new Error('token exchange requires a subject token');
    e.code = 'exchange_no_subject';
    throw e;
  }
  const client = resolveAgentGatewayClient();
  if (!client) {
    const e = new Error(
      'Agent Gateway delegation is not configured — set PINGONE_AI_AGENT_ACTOR_CLIENT_ID and '
      + 'PINGONE_AI_AGENT_ACTOR_CLIENT_SECRET (demo_api_server/.env).',
    );
    e.code = 'agent_exchange_not_configured';
    throw e;
  }
  const audience = agentGatewayAudience();
  const requestedScopes = [...new Set(scopes.filter(Boolean))];
  const key = cacheKey(subjectToken, audience, requestedScopes);
  const cached = readCache(key);
  if (cached) return { accessToken: cached, cached: true };

  const actorScope = configStore.getEffective('agent_gateway_cc_scope') || 'agent:invoke';
  const actorKey = cacheKey(client.clientId, audience, [actorScope]);
  let actorToken = readCache(actorKey);
  if (!actorToken) {
    const actorBody = new URLSearchParams({
      grant_type: 'client_credentials',
      audience,
      scope: actorScope,
    });
    const actorHeaders = withClientAuth(client, actorBody);
    let actorResponse;
    try {
      actorResponse = await axios.post(client.tokenEndpoint, actorBody.toString(), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...actorHeaders },
        timeout: TIMEOUT_MS,
      });
    } catch (err) {
      const n = normalizeAxiosError(err, { label: 'AI Agent actor token', timeoutMs: TIMEOUT_MS });
      n.code = 'agent_actor_failed';
      throw n;
    }
    actorToken = actorResponse.data?.access_token;
    if (!actorToken) {
      const e = new Error('AI Agent actor token response missing access_token');
      e.code = 'agent_actor_no_token';
      throw e;
    }
    writeCache(actorKey, actorToken, actorResponse.data.expires_in);
  }

  const exchangeBody = new URLSearchParams({
    grant_type: GRANT_TYPE,
    subject_token: subjectToken,
    subject_token_type: ACCESS_TOKEN_TYPE,
    actor_token: actorToken,
    actor_token_type: ACCESS_TOKEN_TYPE,
    requested_token_type: ACCESS_TOKEN_TYPE,
    resource: audience,
    scope: requestedScopes.join(' '),
  });
  const exchangeHeaders = withClientAuth(client, exchangeBody);
  let response;
  try {
    response = await axios.post(client.tokenEndpoint, exchangeBody.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...exchangeHeaders },
      timeout: TIMEOUT_MS,
    });
  } catch (err) {
    const n = normalizeAxiosError(err, { label: 'RFC 8693 Agent Gateway exchange', timeoutMs: TIMEOUT_MS });
    n.code = 'agent_exchange_failed';
    throw n;
  }
  const token = response.data?.access_token;
  if (!token) {
    const e = new Error('Agent Gateway exchange response missing access_token');
    e.code = 'agent_exchange_no_token';
    throw e;
  }
  writeCache(key, token, response.data.expires_in);
  return { accessToken: token, cached: false };
}

module.exports = {
  exchangeForUpstream,
  exchangeForAgentGateway,
  isConfigured,
  isAgentGatewayConfigured,
  __test: { cache, cacheKey, resolveExchangeClient, resolveAgentGatewayClient },
};
