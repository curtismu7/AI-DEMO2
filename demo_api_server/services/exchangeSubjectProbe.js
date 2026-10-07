'use strict';

/**
 * Boot-time token-exchange subject probe.
 *
 * The 2026-09-25 outage class: PingOne's native token-exchange grant accepts a
 * subject token only from clients the tenant's token-exchange policy trusts.
 * When a NEW login app (e.g. the DaVinci SDK Login app) starts issuing session
 * tokens, every downstream RFC 8693 exchange fails with
 * "Not a valid access token for request param 'subject_token'" — and the only
 * symptom is a polite tool error at chip-click, hours after the tenant drifted.
 *
 * This probe runs once shortly after boot and turns that silent drift into a
 * named, diagnosable warning:
 *   1. Liveness — mint the AI Agent actor's CC token (scope-pinned) and exchange
 *      it as subject to the Agent Gateway audience. Proves the exchange SP,
 *      exchanger credentials, and agent-gateway resource are all wired.
 *   2. Client allow-list — for every DISTINCT PingOne-issued client found in
 *      live LMDB sessions, probe one exchange. A client PingOne rejects is the
 *      tenant-policy gap; name the client in the warning so the fix is obvious.
 *
 * Advisory only — never fatal, never throws. The probe deliberately does NOT
 * cache any exchanged token (scope is discovery-only) and does NOT touch the
 * session store's tokens.
 */

const KNOWN_GOOD_SUBJECT_CLIENTS = new Set(
  String(process.env.TOKEN_EXCHANGE_TRUSTED_SUBJECT_CLIENTS || '')
    .split(/[\s,]+/)
    .filter(Boolean)
);

function decodeJwtPayload(token) {
  try {
    return JSON.parse(Buffer.from(String(token).split('.')[1], 'base64url').toString());
  } catch (_) {
    return null;
  }
}

async function mintAgentActorToken(configStore, oauthService) {
  const clientId = configStore.getEffective('pingone_ai_agent_actor_client_id');
  const clientSecret = configStore.getEffective('pingone_ai_agent_actor_client_secret');
  // ff_agent_identity_sidecar: a client the sidecar holds needs no secret here.
  // (Required lazily, like the probe's other dependencies, to keep boot ordering unchanged.)
  const sidecarRelay = require('./sidecarClientRelay');
  if (!clientId || (!clientSecret && !(await sidecarRelay.manages(clientId)))) return null;
  // The actor client is a PingOne app. When the BFF's token endpoint is PingFederate's
  // (`/as/token.oauth2`), presenting it there fails with a PF "Invalid client" that reads
  // like a stale secret. It is not one, so skip the mint instead of logging a false alarm.
  const tokenEndpoint = oauthService.config?.tokenEndpoint || '';
  if (tokenEndpoint.endsWith('/as/token.oauth2')) {
    console.log('[EXCHANGE-PROBE] skipped actor mint: token endpoint is PingFederate, the actor client is a PingOne app');
    return null;
  }
  const scope = (configStore.getEffective('pingone_ai_agent_actor_scope') || 'agent:invoke').trim();
  try {
    // Single-resource scope: the actor app holds grants on two resources, so an
    // unpinned CC request 400s ("May not request scopes for multiple resources").
    return await oauthService.getClientCredentialsTokenAs(
      clientId, clientSecret, 'agentgateway.ping.demo', 'post', scope,
    );
  } catch (err) {
    console.warn('[EXCHANGE-PROBE] could not mint actor CC token:', err.message);
    return null;
  }
}

async function probeExchange(configStore, oauthService, subjectToken, audience, scopes) {
  const exchangerId = configStore.getEffective('pingone_mcp_token_exchanger_client_id');
  const exchangerSecret = configStore.getEffective('pingone_mcp_token_exchanger_client_secret');
  const sidecarRelay = require('./sidecarClientRelay');
  if (!exchangerId || (!exchangerSecret && !(await sidecarRelay.manages(exchangerId)))) {
    return { ok: false, reason: 'no exchanger credentials configured' };
  }
  try {
    await oauthService.performTokenExchangeAs(
      subjectToken, null, exchangerId, exchangerSecret, [audience], scopes, 'post',
    );
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err.pingoneErrorDescription || err.pingoneError || err.message };
  }
}

async function listSessionSubjectClients(sessionStore) {
  if (!sessionStore || typeof sessionStore.all !== 'function') return [];
  return new Promise((resolve) => {
    sessionStore.all((err, list) => {
      if (err || !list) return resolve([]);
      const byClient = new Map();
      for (const sess of Object.values(list)) {
        const raw = sess && sess.oauthTokens && (sess.oauthTokens.accessToken || sess.oauthTokens.access_token);
        if (!raw || raw === '_cookie_session') continue;
        const claims = decodeJwtPayload(raw);
        const iss = claims && claims.iss;
        if (!iss || !iss.includes('auth.pingone.com')) continue; // probe PingOne-issued subjects only
        const client = claims.client_id || 'unknown';
        if (!byClient.has(client)) byClient.set(client, { token: raw, sub: claims.sub, exp: claims.exp });
      }
      resolve([...byClient.entries()]);
    });
  });
}

async function runExchangeSubjectProbe() {
  try {
    const configStore = require('./configStore');
    const oauthService = require('./oauthService');

    const audience = configStore.getEffective('pingone_resource_mcp_gateway_uri');
    if (!audience) {
      console.log('[EXCHANGE-PROBE] skipped — pingone_resource_mcp_gateway_uri not configured');
      return;
    }

    // 1) Chain liveness with a machine subject (mintable server-side).
    const actorToken = await mintAgentActorToken(configStore, oauthService);
    if (actorToken) {
      const ping = await probeExchange(
        configStore, oauthService, actorToken, ['agentgateway.ping.demo'], ['agent:invoke'],
      );
      if (ping.ok) {
        console.log('[EXCHANGE-PROBE] OK — token exchange chain alive (machine subject → agent gateway)');
      } else {
        console.error(
          `[EXCHANGE-PROBE] ❌ token exchange chain BROKEN for a machine subject: ${ping.reason}\n` +
          '  Check the exchanger credentials/audience or the tenant token-exchange policy — every delegated tool call will fail.');
      }
    }

    // 2) Per-client probe of real, live session subjects.
    let store;
    try {
      const { LmdbSessionStore } = require('./lmdb/sessionStore');
      store = new LmdbSessionStore({ ttl: 24 * 60 * 60 * 1000 });
    } catch (_) {
      return; // memory store / unavailable — nothing to probe
    }
    const clients = await listSessionSubjectClients(store);
    if (store && typeof store.close === 'function') store.close();
    if (clients.length === 0) return;

    for (const [client, { token, exp }] of clients) {
      if (exp && exp * 1000 < Date.now()) continue; // expired — skip silently
      if (KNOWN_GOOD_SUBJECT_CLIENTS.has(client)) continue;
      const probe = await probeExchange(
        configStore, oauthService, token, ['agentgateway.ping.demo'], ['agent:invoke'],
      );
      if (probe.ok) continue;
      console.error(
        `[EXCHANGE-PROBE] ⚠️ subject tokens from client ${client} are REJECTED by the token exchange: ${probe.reason}\n` +
        `  Live sessions signed in through this client cannot delegate tools (RFC 8693) — every tool call 502s.\n` +
        `  Fix: add this client to the tenant's token-exchange policy (PingOne Authorize console), or sign in via a trusted login app.`);
    }
  } catch (err) {
    console.warn('[EXCHANGE-PROBE] skipped (non-fatal):', err.message);
  }
}

module.exports = { runExchangeSubjectProbe, mintAgentActorToken };
