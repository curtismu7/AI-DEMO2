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
 *   Exchange #3 pre-conditions (Gateway token → backend MCP-server tokens):
 *     5. MCP Server resource has all mirroredScopes defined on it (usually
 *        already true — provisioned since Phase 243)
 *     6. MCP Invest resource EXISTS (create if missing), with scopes +
 *        mirroredScopes from the topology
 *     7. MCP Gateway app is granted all scopes on BOTH backend resources
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
async function _reconcileAppGrants(client, appId, resourceId, resourceTopologyName, label, excludeNames = new Set()) {
  // PingOne enforces scope-NAME uniqueness across an app's grants: the same
  // scope name cannot be granted to one application on two different resources
  // (documented in scopeTopology.js and a2aDelegationService.js). `excludeNames`
  // lets a caller reserve a shared scope name for a sibling resource's grant
  // (e.g. keep `invest:read` on the MCP Invest grant, off the MCP Server grant).
  const expected = scopeTopology.resourceScopes(resourceTopologyName)
    .filter(n => !excludeNames.has(n));

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
    // PingOne's grant-update verb is PUT (full replace), NOT PATCH — a PATCH is
    // rejected at the API edge (403, "Invalid key=value pair … in Authorization
    // header"). Send the full desired scope set for this resource's grant.
    await axios.put(
      `${client.base}/applications/${appId}/grants/${resourceGrant.id}`,
      { resource: { id: resourceId }, scopes: allDesiredIds.map(id => ({ id })) },
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

/**
 * Resolve a resource by audience, CREATING it if missing. Mirrors the create
 * shape proven in pingoneProvisionService.js (type CUSTOM, single-string
 * audience). Returns { id, created }.
 */
async function _resolveOrCreateResourceId(client, audience, displayName, label) {
  const data = await client.get(`/resources?limit=100`);
  const resources = data._embedded?.resources || [];
  const match = resources.find(r => r.audience === audience);
  if (match) return { id: match.id, created: false };

  const resource = await client.post('/resources', {
    name: displayName,
    description: `${label} resource (RFC 8693 backend audience)`,
    type: 'CUSTOM',
    audience,
  });
  console.log(`${TAG} Created missing ${label} resource: ${displayName} (aud=${audience})`);
  return { id: resource.id, created: true };
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
  const mcpGatewayClientId = configStore.getEffective('pingone_mcp_gateway_client_id')
    || process.env.PINGONE_MCP_GATEWAY_CLIENT_ID
    || process.env.MCP_GW_CLIENT_ID;

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

  // ── Exchange #3 pre-conditions ─────────────────────────────────────────────
  // Gateway token → backend MCP-server tokens (olb + invest). The MCP Gateway
  // app performs the RFC 8693 credential swap to BOTH backend resources, so:
  //   5. MCP Server resource carries all mirroredScopes.
  //   6. MCP Invest resource EXISTS (create if missing) with scopes + mirrored.
  //   7. MCP Gateway app is granted all scopes on BOTH backend resources.

  let ex3ServerScopeResult = { created: [], existing: [] };
  let ex3InvestScopeResult = { created: [], existing: [] };
  let ex3ServerGrantResult = { added: [], unchanged: [] };
  let ex3InvestGrantResult = { added: [], unchanged: [] };
  let ex3InvestResourceCreated = false;

  const mcpServerAud       = scopeTopology.resourceUri('Super Banking MCP Server');
  const mcpInvestAud       = scopeTopology.resourceUri('Super Banking MCP Invest');
  const mcpInvestName      = scopeTopology.provisionedResourceName('Super Banking MCP Invest');

  let mcpServerResourceId = null;
  let mcpInvestResourceId = null;

  try {
    mcpServerResourceId = await _resolveResourceId(client, mcpServerAud, 'MCP Server');
  } catch (err) {
    console.warn(`${TAG} Could not resolve MCP Server resource: ${err.message}`);
  }

  try {
    const investRes = await _resolveOrCreateResourceId(client, mcpInvestAud, mcpInvestName, 'MCP Invest');
    mcpInvestResourceId = investRes.id;
    ex3InvestResourceCreated = investRes.created;
  } catch (err) {
    console.warn(`${TAG} Could not resolve/create MCP Invest resource: ${err.message}`);
  }

  // Pre-condition 5: MCP Server resource scopes (native + mirrored).
  if (mcpServerResourceId) {
    try {
      ex3ServerScopeResult = await _reconcileResourceScopes(client, mcpServerResourceId, 'Super Banking MCP Server', 'MCP Server');
    } catch (err) {
      console.warn(`${TAG} Exchange #3 MCP Server scope reconcile failed: ${err.message}`);
    }
  }

  // Pre-condition 6: MCP Invest resource scopes (native + mirrored).
  if (mcpInvestResourceId) {
    try {
      ex3InvestScopeResult = await _reconcileResourceScopes(client, mcpInvestResourceId, 'Super Banking MCP Invest', 'MCP Invest');
    } catch (err) {
      console.warn(`${TAG} Exchange #3 MCP Invest scope reconcile failed: ${err.message}`);
    }
  }

  // Pre-condition 7: MCP Gateway app granted the backend scopes on BOTH resources.
  //
  // PingOne enforces scope-NAME uniqueness across an app's grants, so the gateway
  // app cannot hold a given scope name on both backend resources. We therefore
  // partition the shared names by which backend actually needs them at runtime:
  //   - `invest:read` is the invest backend's least-privilege scope (a2a specialist
  //     tokens carry ONLY invest:read) → reserved for the MCP Invest grant.
  //   - all other olb tool scopes (read/write/… + mcp:invoke) → the MCP Server grant.
  // The router sends invest tools to the invest backend and olb tools to olb, so a
  // token's surviving scope never needs the same name on both grants.
  const INVEST_RESERVED_SCOPE = 'invest:read';
  const serverExclude = new Set([INVEST_RESERVED_SCOPE]);
  // On the invest grant, drop any scope name already granted on the MCP Server
  // grant (read, mcp:invoke, …) — leaving invest:read as the invest-only grant.
  const serverGrantedNames = new Set(
    scopeTopology.resourceScopes('Super Banking MCP Server').filter(n => !serverExclude.has(n))
  );
  const investExclude = new Set(
    scopeTopology.resourceScopes('Super Banking MCP Invest').filter(n => serverGrantedNames.has(n))
  );

  if (mcpGatewayClientId) {
    let mcpGatewayAppId = null;
    try {
      mcpGatewayAppId = await _resolveAppId(client, mcpGatewayClientId, 'MCP Gateway');
    } catch (err) {
      console.warn(`${TAG} Could not resolve MCP Gateway app (non-fatal): ${err.message}`);
    }
    if (mcpGatewayAppId && mcpServerResourceId) {
      try {
        ex3ServerGrantResult = await _reconcileAppGrants(client, mcpGatewayAppId, mcpServerResourceId, 'Super Banking MCP Server', 'MCP Gateway on MCP Server', serverExclude);
      } catch (err) {
        console.warn(`${TAG} Exchange #3 MCP Gateway→MCP Server grant reconcile failed: ${err.message}`);
      }
    }
    if (mcpGatewayAppId && mcpInvestResourceId) {
      try {
        ex3InvestGrantResult = await _reconcileAppGrants(client, mcpGatewayAppId, mcpInvestResourceId, 'Super Banking MCP Invest', 'MCP Gateway on MCP Invest', investExclude);
      } catch (err) {
        console.warn(`${TAG} Exchange #3 MCP Gateway→MCP Invest grant reconcile failed: ${err.message}`);
      }
    }
  } else {
    console.log(`${TAG} MCP Gateway client ID not configured — skipping Exchange #3 grant check`);
  }

  // ── Summary ────────────────────────────────────────────────────────────────

  const totalCreated = ex1ScopeResult.created.length + ex2ScopeResult.created.length
    + ex3ServerScopeResult.created.length + ex3InvestScopeResult.created.length;
  const totalAdded   = ex1GrantResult.added.length   + ex2GrantResult.added.length
    + ex3ServerGrantResult.added.length  + ex3InvestGrantResult.added.length;

  if (totalCreated === 0 && totalAdded === 0 && !ex3InvestResourceCreated) {
    console.log(`${TAG} OK — Exchange #1, #2, and #3 scopes and grants match scope-topology.json`);
  } else {
    const parts = [];
    if (ex1ScopeResult.created.length) parts.push(`Agent Gateway scopes created: [${ex1ScopeResult.created.join(', ')}]`);
    if (ex1GrantResult.added.length)   parts.push(`AI Agent→AgentGw grants added: [${ex1GrantResult.added.join(', ')}]`);
    if (ex2ScopeResult.created.length) parts.push(`MCP Gateway scopes created: [${ex2ScopeResult.created.join(', ')}]`);
    if (ex2GrantResult.added.length)   parts.push(`MCP Exchanger→McpGw grants added: [${ex2GrantResult.added.join(', ')}]`);
    if (ex3InvestResourceCreated)          parts.push('MCP Invest resource created');
    if (ex3ServerScopeResult.created.length) parts.push(`MCP Server scopes created: [${ex3ServerScopeResult.created.join(', ')}]`);
    if (ex3InvestScopeResult.created.length) parts.push(`MCP Invest scopes created: [${ex3InvestScopeResult.created.join(', ')}]`);
    if (ex3ServerGrantResult.added.length)   parts.push(`MCP Gateway→McpServer grants added: [${ex3ServerGrantResult.added.join(', ')}]`);
    if (ex3InvestGrantResult.added.length)   parts.push(`MCP Gateway→McpInvest grants added: [${ex3InvestGrantResult.added.join(', ')}]`);
    console.log(`${TAG} Healed — ${parts.join('; ')}`);
  }
}

module.exports = { reconcileTwoExchangeGrants };
