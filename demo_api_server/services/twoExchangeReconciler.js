'use strict';

/**
 * twoExchangeReconciler.js — runtime self-healing for the RFC 8693 two-exchange
 * delegation chain.
 *
 * Reads scope-topology.json as the single source of truth and verifies (then
 * repairs) the live PingOne state needed for the two-exchange chip flow:
 *
 *   Exchange #1 pre-conditions (User Token → Agent Gateway intermediate token):
 *     1. Agent Gateway resource has all mirroredScopes defined on it
 *     2. AI Agent app is granted all Agent Gateway scopes (agent:invoke + tool scopes)
 *
 *   Exchange #2 pre-conditions (intermediate + MCP Exchanger CC → MCP Gateway token):
 *     3. MCP Gateway resource has all mirroredScopes defined on it
 *     4. MCP Exchanger app is granted all MCP Gateway scopes (mcp:invoke + tool scopes)
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

// ── Shared reconciliation helpers ──────────────────────────────────────────

/**
 * Ensure all scope-topology scopes for a resource exist on the PingOne resource.
 * Creates any that are missing. Returns { created: string[], existing: string[] }.
 */
async function _reconcileResourceScopes(client, resourceId, resourceTopologyName, label) {
  const expected = scopeTopology.resourceScopes(resourceTopologyName);
  const data = await client.get(`/resources/${resourceId}/scopes?limit=200`);
  const existingNames = new Set((data._embedded?.scopes || []).map(s => s.name));

  const missing = expected.filter(n => !existingNames.has(n));
  const created = [];

  for (const name of missing) {
    const meta = scopeTopology.scopeMeta(name);
    await client.post(`/resources/${resourceId}/scopes`, {
      name,
      description: (meta && meta.description) || `Scope: ${name}`,
    });
    created.push(name);
    console.log(`${TAG} Created missing ${label} scope: ${name}`);
  }

  return { created, existing: expected.filter(n => existingNames.has(n)) };
}

/**
 * Ensure an app has all expected scopes granted on a resource.
 * Resolves scope names → IDs on the resource, diffs vs. existing grant,
 * and adds only what's missing.
 * Returns { added: string[], unchanged: string[] }.
 */
async function _reconcileAppGrants(client, appId, resourceId, resourceTopologyName, label) {
  const expected = scopeTopology.resourceScopes(resourceTopologyName);

  // Resolve current scope name→id map on resource
  const scopeData = await client.get(`/resources/${resourceId}/scopes?limit=200`);
  const idByName = new Map((scopeData._embedded?.scopes || []).map(s => [s.name, s.id]));

  // Resolve existing grants on this app
  const grantData = await client.get(`/applications/${appId}/grants`);
  const grants = grantData._embedded?.grants || [];

  // Build set of scope IDs already granted on this specific resource.
  // Check only by scope ID on this resource's grant — NOT by name on other
  // resources — to avoid false-positives where the same scope name (e.g. "read")
  // exists on both the enduser API grant and this resource's grant.
  const resourceGrant = grants.find(g => g.resource?.id === resourceId);
  const grantedIds = new Set((resourceGrant?.scopes || []).map(s => s.id));

  const toAdd = [];
  const unchanged = [];
  for (const name of expected) {
    const id = idByName.get(name);
    if (!id) continue; // scope doesn't exist on resource yet (reconcileScopes should fix it)
    if (grantedIds.has(id)) {
      unchanged.push(name);
    } else {
      toAdd.push({ id, name });
    }
  }

  if (toAdd.length === 0) return { added: [], unchanged };

  const allDesiredIds = [...grantedIds, ...toAdd.map(s => s.id)];

  if (resourceGrant) {
    await axios.patch(
      `${client.base}/applications/${appId}/grants/${resourceGrant.id}`,
      { scopes: allDesiredIds.map(id => ({ id })) },
      { headers: { Authorization: `Bearer ${client.token}`, 'Content-Type': 'application/json' }, timeout: 10000 }
    );
  } else {
    await client.post(`/applications/${appId}/grants`, {
      resource: { id: resourceId },
      scopes: allDesiredIds.map(id => ({ id })),
    });
  }

  for (const s of toAdd) {
    console.log(`${TAG} Granted missing scope to ${label}: ${s.name}`);
  }

  return { added: toAdd.map(s => s.name), unchanged };
}

// ── Resource ID resolution ─────────────────────────────────────────────────

async function _resolveResourceId(client, audience, label) {
  const data = await client.get(`/resources?limit=50`);
  const resources = data._embedded?.resources || [];
  const match = resources.find(r => r.audience === audience);
  if (!match) throw new Error(`${label} resource not found in PingOne (aud=${audience})`);
  return match.id;
}

async function _resolveAppId(client, clientId, label) {
  const data = await client.get(`/applications/${clientId}`);
  if (!data.id) throw new Error(`${label} app not found (clientId=${clientId})`);
  return data.id;
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
  const mcpExchangerClientId = configStore.getEffective('pingone_mcp_token_exchanger_client_id')
    || process.env.PINGONE_TOKEN_EXCHANGER_CLIENT_ID
    || process.env.PINGONE_MCP_TOKEN_EXCHANGER_CLIENT_ID;

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

  // ── Resolve resource IDs ──────────────────────────────────────────────────

  const agentGwAud = scopeTopology.resourceUri('Super Banking Agent Gateway');
  const mcpGwAud   = scopeTopology.resourceUri('Super Banking MCP Gateway');

  let agentGwResourceId, mcpGwResourceId;
  try {
    [agentGwResourceId, mcpGwResourceId] = await Promise.all([
      _resolveResourceId(client, agentGwAud, 'Agent Gateway'),
      _resolveResourceId(client, mcpGwAud,   'MCP Gateway'),
    ]);
  } catch (err) {
    console.warn(`${TAG} Resource lookup failed: ${err.message} — skipping`);
    return;
  }

  // ── Resolve app IDs ────────────────────────────────────────────────────────

  let aiAgentAppId;
  try {
    aiAgentAppId = await _resolveAppId(client, aiAgentClientId, 'AI Agent');
  } catch (err) {
    console.warn(`${TAG} Could not resolve AI Agent app: ${err.message}`);
    return;
  }

  let mcpExchangerAppId = null;
  if (mcpExchangerClientId) {
    try {
      mcpExchangerAppId = await _resolveAppId(client, mcpExchangerClientId, 'MCP Exchanger');
    } catch (err) {
      console.warn(`${TAG} Could not resolve MCP Exchanger app (non-fatal): ${err.message}`);
    }
  }

  // ── Exchange #1 pre-conditions ─────────────────────────────────────────────
  // Agent Gateway resource scopes + AI Agent grants on Agent Gateway.

  let ex1ScopeResult = { created: [], existing: [] };
  let ex1GrantResult = { added: [], unchanged: [] };

  try {
    ex1ScopeResult = await _reconcileResourceScopes(client, agentGwResourceId, 'Super Banking Agent Gateway', 'Agent Gateway');
  } catch (err) {
    console.warn(`${TAG} Exchange #1 scope reconcile failed: ${err.message}`);
  }

  try {
    ex1GrantResult = await _reconcileAppGrants(client, aiAgentAppId, agentGwResourceId, 'Super Banking Agent Gateway', 'AI Agent on Agent Gateway');
  } catch (err) {
    console.warn(`${TAG} Exchange #1 grant reconcile failed: ${err.message}`);
  }

  // ── Exchange #2 pre-conditions ─────────────────────────────────────────────
  // MCP Gateway resource scopes + MCP Exchanger grants on MCP Gateway.

  let ex2ScopeResult = { created: [], existing: [] };
  let ex2GrantResult = { added: [], unchanged: [] };

  try {
    ex2ScopeResult = await _reconcileResourceScopes(client, mcpGwResourceId, 'Super Banking MCP Gateway', 'MCP Gateway');
  } catch (err) {
    console.warn(`${TAG} Exchange #2 scope reconcile failed: ${err.message}`);
  }

  if (mcpExchangerAppId) {
    try {
      ex2GrantResult = await _reconcileAppGrants(client, mcpExchangerAppId, mcpGwResourceId, 'Super Banking MCP Gateway', 'MCP Exchanger on MCP Gateway');
    } catch (err) {
      console.warn(`${TAG} Exchange #2 grant reconcile failed: ${err.message}`);
    }
  } else {
    console.log(`${TAG} MCP Exchanger client ID not configured — skipping Exchange #2 grant check`);
  }

  // ── Summary ────────────────────────────────────────────────────────────────

  const totalCreated = ex1ScopeResult.created.length + ex2ScopeResult.created.length;
  const totalAdded   = ex1GrantResult.added.length   + ex2GrantResult.added.length;

  if (totalCreated === 0 && totalAdded === 0) {
    console.log(`${TAG} OK — Exchange #1 and #2 scopes and grants match scope-topology.json`);
  } else {
    const parts = [];
    if (ex1ScopeResult.created.length) parts.push(`Agent Gateway scopes created: [${ex1ScopeResult.created.join(', ')}]`);
    if (ex1GrantResult.added.length)   parts.push(`AI Agent→AgentGw grants added: [${ex1GrantResult.added.join(', ')}]`);
    if (ex2ScopeResult.created.length) parts.push(`MCP Gateway scopes created: [${ex2ScopeResult.created.join(', ')}]`);
    if (ex2GrantResult.added.length)   parts.push(`MCP Exchanger→McpGw grants added: [${ex2GrantResult.added.join(', ')}]`);
    console.log(`${TAG} Healed — ${parts.join('; ')}`);
  }
}

module.exports = { reconcileTwoExchangeGrants };
