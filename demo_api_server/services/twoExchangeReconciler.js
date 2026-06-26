'use strict';

/**
 * twoExchangeReconciler.js — runtime self-healing for the RFC 8693 two-exchange
 * delegation chain.
 *
 * Reads scope-topology.json as the single source of truth and verifies (then
 * repairs) the live PingOne state needed for the two-exchange chip flow:
 *
 *   1. Agent Gateway resource has all mirroredScopes defined on it
 *   2. AI Agent app is granted all Agent Gateway scopes (agent:invoke + tool scopes)
 *
 * Runs once at startup (non-fatal async). Any drift is healed and logged so the
 * chip flow never silently breaks due to a missed provisioning step.
 */

const axios = require('axios');
const scopeTopology = require('./scopeTopology');
const configStore = require('./configStore');

const TAG = '[TwoExchangeReconciler]';

// ── PingOne Management API client ──────────────────────────────────────────

class PingOneClient {
  constructor(envId, region, workerToken) {
    this.base = `https://api.pingone.${region}/v1/environments/${envId}`;
    this.token = workerToken;
  }

  async get(path) {
    const r = await axios.get(`${this.base}${path}`, {
      headers: { Authorization: `Bearer ${this.token}` },
      timeout: 10000,
    });
    return r.data;
  }

  async post(path, body) {
    const r = await axios.post(`${this.base}${path}`, body, {
      headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' },
      timeout: 10000,
    });
    return r.data;
  }
}

async function _getWorkerToken(envId, clientId, secret, region) {
  const r = await axios.post(
    `https://auth.pingone.${region}/${envId}/as/token`,
    'grant_type=client_credentials',
    { auth: { username: clientId, password: secret },
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 10000 }
  );
  return r.data.access_token;
}

// ── Reconciliation logic ───────────────────────────────────────────────────

/**
 * Ensure all scope-topology mirroredScopes for Agent Gateway exist on the
 * PingOne resource. Creates any that are missing.
 * Returns { created: string[], existing: string[] }.
 */
async function _reconcileAgentGwScopes(client, agentGwResourceId) {
  const expected = scopeTopology.resourceScopes('Super Banking Agent Gateway');
  const data = await client.get(`/resources/${agentGwResourceId}/scopes?limit=200`);
  const existingNames = new Set((data._embedded?.scopes || []).map(s => s.name));

  const missing = expected.filter(n => !existingNames.has(n));
  const created = [];

  for (const name of missing) {
    const meta = scopeTopology.scopeMeta(name);
    await client.post(`/resources/${agentGwResourceId}/scopes`, {
      name,
      description: (meta && meta.description) || `Scope: ${name}`,
    });
    created.push(name);
    console.log(`${TAG} Created missing Agent Gateway scope: ${name}`);
  }

  return { created, existing: expected.filter(n => existingNames.has(n)) };
}

/**
 * Ensure the AI Agent app has all Agent Gateway scopes granted.
 * Resolves scope names → IDs on the resource, diffs vs. existing grant,
 * and adds only what's missing.
 * Returns { added: string[], unchanged: string[] }.
 */
async function _reconcileAiAgentGrants(client, aiAgentAppId, agentGwResourceId) {
  const expected = scopeTopology.resourceScopes('Super Banking Agent Gateway');

  // Resolve current scope name→id map on Agent Gateway
  const scopeData = await client.get(`/resources/${agentGwResourceId}/scopes?limit=200`);
  const idByName = new Map((scopeData._embedded?.scopes || []).map(s => [s.name, s.id]));

  // Resolve existing grants on this app (across all resources)
  const grantData = await client.get(`/applications/${aiAgentAppId}/grants`);
  const grants = grantData._embedded?.grants || [];

  // Build set of scope IDs already granted on Agent Gateway specifically
  const agentGwGrant = grants.find(g => g.resource?.id === agentGwResourceId);
  const grantedIds = new Set((agentGwGrant?.scopes || []).map(s => s.id));

  // Scope IDs we need to add to the Agent Gateway grant.
  // NOTE: PingOne allows the same scope NAME on multiple resources (different IDs).
  // We check only by scope ID on the Agent Gateway grant — NOT by name on other
  // resources — to avoid the false-positive where read/write/transfer exist on the
  // enduser API grant and would be incorrectly skipped here.
  const toAdd = [];
  const unchanged = [];
  for (const name of expected) {
    const id = idByName.get(name);
    if (!id) continue; // scope doesn't exist yet on resource (reconcileScopes should have fixed it)
    if (grantedIds.has(id)) {
      unchanged.push(name);
    } else {
      toAdd.push({ id, name });
    }
  }

  if (toAdd.length === 0) return { added: [], unchanged };

  const allDesiredIds = [...grantedIds, ...toAdd.map(s => s.id)];

  if (agentGwGrant) {
    // PATCH existing grant to add new scope IDs
    await axios.patch(
      `${client.base}/applications/${aiAgentAppId}/grants/${agentGwGrant.id}`,
      { scopes: allDesiredIds.map(id => ({ id })) },
      { headers: { Authorization: `Bearer ${client.token}`, 'Content-Type': 'application/json' }, timeout: 10000 }
    );
  } else {
    // POST new grant
    await client.post(`/applications/${aiAgentAppId}/grants`, {
      resource: { id: agentGwResourceId },
      scopes: allDesiredIds.map(id => ({ id })),
    });
  }

  for (const s of toAdd) {
    console.log(`${TAG} Granted missing scope to AI Agent on Agent Gateway: ${s.name}`);
  }

  return { added: toAdd.map(s => s.name), unchanged };
}

// ── Public entry point ─────────────────────────────────────────────────────

/**
 * Reconcile the PingOne state required for the two-exchange chip flow.
 * Non-fatal: logs warnings on error, never throws.
 * Should be called once at startup after config is loaded.
 */
async function reconcileTwoExchangeGrants() {
  // Resolve credentials from env/configStore
  const envId = process.env.PINGONE_ENVIRONMENT_ID || configStore.getEffective('pingone_environment_id');
  const region = process.env.PINGONE_REGION || configStore.getEffective('pingone_region') || 'com';
  const workerClientId = process.env.PINGONE_WORKER_CLIENT_ID || configStore.getEffective('pingone_worker_client_id');
  const workerSecret = process.env.PINGONE_WORKER_CLIENT_SECRET || configStore.getEffective('pingone_worker_client_secret');
  const aiAgentClientId = configStore.getEffective('pingone_ai_agent_client_id')
    || process.env.PINGONE_AI_AGENT_ACTOR_CLIENT_ID
    || process.env.PINGONE_AI_AGENT_CLIENT_ID;

  if (!envId || !workerClientId || !workerSecret) {
    console.log(`${TAG} Skipped — PingOne worker credentials not configured`);
    return;
  }
  if (!aiAgentClientId) {
    console.log(`${TAG} Skipped — AI Agent client ID not configured`);
    return;
  }

  let workerToken;
  try {
    workerToken = await _getWorkerToken(envId, workerClientId, workerSecret, region);
  } catch (err) {
    console.warn(`${TAG} Could not get worker token — skipping reconcile: ${err.message}`);
    return;
  }

  const client = new PingOneClient(envId, region, workerToken);

  // Resolve the Agent Gateway PingOne resource ID by audience URI
  const agentGwAud = scopeTopology.resourceUri('Super Banking Agent Gateway');
  let agentGwResourceId;
  try {
    const data = await client.get(`/resources?limit=50`);
    const resources = data._embedded?.resources || [];
    const agentGwResource = resources.find(r => r.audience === agentGwAud);
    if (!agentGwResource) {
      console.warn(`${TAG} Agent Gateway resource not found in PingOne (aud=${agentGwAud}) — skipping`);
      return;
    }
    agentGwResourceId = agentGwResource.id;
  } catch (err) {
    console.warn(`${TAG} Could not list PingOne resources: ${err.message}`);
    return;
  }

  // Resolve AI Agent app ID from clientId
  let aiAgentAppId;
  try {
    const data = await client.get(`/applications/${aiAgentClientId}`);
    aiAgentAppId = data.id;
  } catch (err) {
    console.warn(`${TAG} Could not resolve AI Agent app (clientId=${aiAgentClientId}): ${err.message}`);
    return;
  }

  // 1. Reconcile Agent Gateway scopes
  let scopeResult;
  try {
    scopeResult = await _reconcileAgentGwScopes(client, agentGwResourceId);
  } catch (err) {
    console.warn(`${TAG} Scope reconcile failed: ${err.message}`);
    scopeResult = { created: [], existing: [] };
  }

  // 2. Reconcile AI Agent grants (run even if no scopes were created — grants may still be missing)
  let grantResult;
  try {
    grantResult = await _reconcileAiAgentGrants(client, aiAgentAppId, agentGwResourceId);
  } catch (err) {
    console.warn(`${TAG} Grant reconcile failed: ${err.message}`);
    grantResult = { added: [], unchanged: [] };
  }

  const noop = scopeResult.created.length === 0 && grantResult.added.length === 0;
  if (noop) {
    console.log(`${TAG} OK — Agent Gateway scopes and AI Agent grants match scope-topology.json`);
  } else {
    console.log(
      `${TAG} Healed — scopes created: [${scopeResult.created.join(', ') || 'none'}]; ` +
      `grants added: [${grantResult.added.join(', ') || 'none'}]`
    );
  }
}

module.exports = { reconcileTwoExchangeGrants };
