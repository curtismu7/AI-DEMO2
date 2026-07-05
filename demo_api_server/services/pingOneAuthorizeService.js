/**
 * pingOneAuthorizeService.js
 *
 * Evaluates transactions against a PingOne Authorize policy.
 *
 * Two API paths are supported — the service auto-selects based on config:
 *
 *   NEW (Phase 2):  POST /v1/environments/{envId}/decisionEndpoints/{endpointId}
 *                   Requires authorize_decision_endpoint_id / PINGONE_AUTHORIZE_DECISION_ENDPOINT_ID
 *                   Request body: { parameters: { Amount, TransactionType, UserId, ... } }
 *
 *   LEGACY (Phase 1 / fallback):
 *                   POST /v1/environments/{envId}/governance/policyDecisionPoints/{policyId}/evaluate
 *                   Requires authorize_policy_id / PINGONE_AUTHORIZE_POLICY_ID
 *                   Request body: { context: { user, transaction } }
 *
 * Worker credentials are read from configStore first, falling back to environment
 * variables so existing deployments continue to work without migration:
 *
 *   configStore:  authorize_worker_client_id / authorize_worker_client_secret
 *   Env vars:     PINGONE_AUTHORIZE_WORKER_CLIENT_ID / PINGONE_AUTHORIZE_WORKER_CLIENT_SECRET
 *
 * The environment ID and region come from configStore (pingone_environment_id /
 * pingone_region) with the same env-var fallbacks used throughout the app.
 *
 * Exported functions:
 *   evaluateTransaction(params)   — full policy evaluation returning PERMIT/DENY/INDETERMINATE
 *   evaluateMcpToolDelegation(params) — MCP first-tool gate (DecisionContext=McpFirstTool); requires authorize_mcp_decision_endpoint_id
 *   checkStepUpRequired(params)   — lightweight check: returns { stepUpRequired, reason }
 *   getRecentDecisions(endpointId, limit) — Phase 3: last N decisions for an endpoint
 *   isConfigured()                — returns true if all required credentials are present
 *   isMcpDelegationDecisionReady()  — worker + MCP decision endpoint ID configured
 *   getDecisionEndpoints()        — list all decision endpoints in the environment
 *   isWorkerCredentialReady()   — env + worker client id/secret (no decision endpoint required)
 *   provisionDemoDecisionEndpoints(opts) — create/link Super Banking demo decision endpoints via Platform API
 */

'use strict';

const crypto = require('crypto');
const configStore = require('./configStore');
const { classifyObligations } = require('./authorizeObligations');

/** Stable names — idempotent GET list + create if missing */
const DEMO_TX_ENDPOINT_NAME = 'Super Banking Demo — Transactions';
const DEMO_MCP_ENDPOINT_NAME = 'Super Banking Demo — MCP first tool';

const REGION_TLD_MAP = {
  com: 'com',
  eu: 'eu',
  ca: 'ca',
  asia: 'asia',
  'com.au': 'com.au',
};

// ---------------------------------------------------------------------------
// Credential resolution — configStore first, env var fallback
// ---------------------------------------------------------------------------

function _getCredentials() {
  // Use getEffective() so the alias map in configStore is traversed (vault →
  // LMDB → env var fallbacks). configStore.get() only checks the LMDB cache
  // and missed the env-var aliases added for PINGONE_WORKER_CLIENT_ID.
  const envId =
    configStore.getEffective('pingone_environment_id') ||
    process.env.PINGONE_ENVIRONMENT_ID;

  const region =
    configStore.getEffective('pingone_region') ||
    process.env.PINGONE_REGION ||
    'com';

  // Authorize-specific worker first, then fall back to the general management
  // worker (PINGONE_WORKER_CLIENT_ID). Most deployments use one worker app for
  // both PingOne Management API calls and PingOne Authorize — this keeps them
  // working without requiring a second set of credentials.
  const clientId =
    configStore.getEffective('authorize_worker_client_id') ||
    configStore.getEffective('pingone_authorize_worker_client_id') ||
    configStore.getEffective('pingone_worker_client_id') ||
    process.env.PINGONE_AUTHORIZE_WORKER_CLIENT_ID ||
    process.env.PINGONE_WORKER_CLIENT_ID;

  const clientSecret =
    configStore.getEffective('authorize_worker_client_secret') ||
    configStore.getEffective('pingone_authorize_worker_client_secret') ||
    configStore.getEffective('pingone_worker_client_secret') ||
    process.env.PINGONE_AUTHORIZE_WORKER_CLIENT_SECRET ||
    process.env.PINGONE_WORKER_CLIENT_SECRET;

  const decisionEndpointId =
    configStore.getEffective('authorize_decision_endpoint_id') ||
    process.env.PINGONE_AUTHORIZE_DECISION_ENDPOINT_ID;

  const policyId =
    configStore.getEffective('authorize_policy_id') ||
    process.env.PINGONE_AUTHORIZE_POLICY_ID;

  /** Optional second decision endpoint for MCP first-tool delegation (Trust Framework: DecisionContext=McpFirstTool). */
  const mcpDecisionEndpointId =
    configStore.getEffective('authorize_mcp_decision_endpoint_id') ||
    process.env.PINGONE_AUTHORIZE_MCP_DECISION_ENDPOINT_ID;

  const regionTld = REGION_TLD_MAP[(region || 'com').toLowerCase()] || 'com';

  return { envId, clientId, clientSecret, decisionEndpointId, policyId, mcpDecisionEndpointId, regionTld };
}

const apiBase  = (tld) => `https://api.pingone.${tld}`;
const authBase = (tld) => `https://auth.pingone.${tld}`;

// ---------------------------------------------------------------------------
// Worker token (client credentials grant)
// ---------------------------------------------------------------------------

/**
 * Obtain a short-lived worker access_token via client credentials.
 * @returns {Promise<string>} access_token
 */
async function getWorkerToken() {
  const { envId, clientId, clientSecret, regionTld } = _getCredentials();

  if (!envId || !clientId || !clientSecret) {
    throw new Error(
      'PingOne Authorize worker credentials are not fully configured. ' +
      'Set PINGONE_WORKER_CLIENT_ID + PINGONE_WORKER_CLIENT_SECRET in .env (or the dedicated ' +
      'PINGONE_AUTHORIZE_WORKER_CLIENT_ID + PINGONE_AUTHORIZE_WORKER_CLIENT_SECRET if using a separate app), ' +
      'or enter authorize_worker_client_id / authorize_worker_client_secret in Admin → Configuration → PingOne Authorize.'
    );
  }

  const tokenUrl = `${authBase(regionTld)}/${envId}/as/token`;
  const encoded  = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${encoded}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Worker token request failed (${response.status}): ${text}`);
  }

  const data = await response.json();
  if (!data.access_token) {
    throw new Error('Worker token response did not include access_token');
  }
  return data.access_token;
}

// ---------------------------------------------------------------------------
// Phase 2 — Decision Endpoints evaluation (current / preferred path)
// POST /v1/environments/{envId}/decisionEndpoints/{endpointId}
// ---------------------------------------------------------------------------

/**
 * POST a Trust Framework parameters object to a decision endpoint (Phase 2).
 * @param {string} endpointId
 * @param {Record<string, unknown>} parameters
 * @returns {Promise<{ decision, stepUpRequired, raw, decisionId, path }>}
 */
async function _postDecisionEndpoint(endpointId, parameters) {
  const { envId, regionTld } = _getCredentials();

  const workerToken = await getWorkerToken();

  const url = `${apiBase(regionTld)}/v1/environments/${envId}/decisionEndpoints/${endpointId}`;

  console.log('[BFF→P1AZ] REQUEST: url=%s', url);
  console.log('[BFF→P1AZ] PARAMETERS: %j', parameters);

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${workerToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ parameters }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`PingOne Authorize decision endpoint evaluation failed (${response.status}): ${text}`);
  }

  const raw = await response.json();
  console.log('[BFF→P1AZ] RESPONSE: status=%d body=%j', response.status, raw);
  const { stepUpRequired, hitlRequired, consentRequired } = _classifyRawObligations(raw);
  const decision = _normalizeDecision(raw, { hasObligation: stepUpRequired || hitlRequired || consentRequired });

  const decisionId = raw.id || raw.decisionId || null;

  const _debug = {
    request: { method: 'POST', url, contentType: 'application/json', body: { parameters } },
    response: raw,
  };
  return { decision, stepUpRequired, hitlRequired, consentRequired, raw, decisionId, path: 'decision-endpoint', _debug };
}

/**
 * Evaluate using the Decision Endpoints API (Phase 2 path).
 * Parameters map to Trust Framework attribute names defined in PingOne Authorize.
 *
 * @param {object} opts
 * @param {string} opts.endpointId
 * @param {string} opts.userId
 * @param {number} opts.amount
 * @param {string} opts.type        - 'transfer' | 'withdrawal' | 'deposit'
 * @param {string} [opts.acr]
 * @param {object} [opts.extra]     - Additional Trust Framework attributes
 * @returns {Promise<{ decision, stepUpRequired, raw, decisionId, path }>}
 */
async function _evaluateViaDecisionEndpoint({ endpointId, userId, amount, type, acr, extra = {} }) {
  const parameters = {
    Amount: amount,
    TransactionType: type,
    UserId: userId,
    ...(acr ? { Acr: acr } : {}),
    Timestamp: new Date().toISOString(),
    ...extra,
  };
  return _postDecisionEndpoint(endpointId, parameters);
}

/**
 * MCP first-tool delegation evaluation (separate Trust Framework shape).
 * Requires authorize_mcp_decision_endpoint_id (or explicit decisionEndpointId).
 * PingOne policy should key off DecisionContext === "McpFirstTool" and attributes below.
 *
 * @param {object} opts
 * @param {string} [opts.decisionEndpointId] - overrides config authorize_mcp_decision_endpoint_id
 * @param {string} opts.userId
 * @param {string} opts.toolName
 * @param {string} [opts.tokenAudience] - MCP access token aud (string)
 * @param {string} [opts.actClientId] - act.client_id or act.sub from MCP token (RFC 8693 §4.1 canonical: act.sub)
 * @param {string} [opts.nestedActClientId] - act.act.client_id or act.act.sub (nested delegation, RFC 8693 two-hop)
 * @param {string} [opts.mcpResourceUri] - expected MCP resource audience
 * @param {string} [opts.acr] - end-user ACR from session when available
 */
async function evaluateMcpToolDelegation({
  decisionEndpointId,
  userId,
  toolName,
  tokenAudience,
  actClientId,
  nestedActClientId,
  mcpResourceUri,
  acr,
  // HITL receipt (receipt-aware PERMIT). When the BFF/gateway has verified an
  // approved, caller-bound HITL challenge for THIS tool call, it sets
  // hitlApproved=true. We only FORWARD it as a decision parameter — the Trust
  // Framework policy is what flips INDETERMINATE→PERMIT when it sees
  // HitlApproved==true on a confirm-gated call. The policy must NOT let a
  // receipt satisfy a STEP_UP obligation (parity with the simulated engine,
  // where step-up wins before the consent branch). Emitted only when true,
  // matching the conditional-spread style of Acr (and the simulated engine).
  hitlApproved = false,
  // Group-membership policy (Scenario 1). Forwarded as RequiredGroup / UserGroups
  // so the live PingOne policy can DENY a restricted tool when the user is not in
  // its group — the same rule the simulated engine and demo_authz_server apply.
  // Supplied by the caller only when ff_authorize_group_policy is on.
  requiredGroup = null,
  userGroups = null,
  // UC21 entitlement tier + UC9 membership, pre-resolved by the BFF (the
  // snapshot DSL has no array-contains). UserTier drives the tier rules,
  // InRequiredGroup the group rule. Amount drives the per-tier amount cap.
  // Supplied only when ff_authorize_group_policy is on.
  userTier = null,
  inRequiredGroup = null,
  amount = null,
  // Resource-owner binding (NNP-3, confused-deputy / meta-chatbot prevention).
  // Forwarded as ResourceOwnerId so the live PingOne policy can DENY
  // resource_owner_mismatch when a caller acts on another user's resource —
  // the same gate the simulated engine and demo_authz_server already enforce.
  // Emitted only when present (absent → no resource-scoped gate, i.e. PERMIT).
  resourceOwnerId = null,
}) {
  const creds = _getCredentials();
  const endpointId = decisionEndpointId || creds.mcpDecisionEndpointId;

  if (!creds.envId) {
    throw new Error('PingOne environment ID is not configured.');
  }
  if (!endpointId) {
    throw new Error(
      'MCP delegation decision endpoint is not configured. Set authorize_mcp_decision_endpoint_id in Admin → Config.',
    );
  }

  const parameters = {
    DecisionContext: 'McpFirstTool',
    UserId: userId,
    ToolName: toolName || '',
    TokenAudience: tokenAudience != null ? String(tokenAudience) : '',
    ActClientId: actClientId || '',          // from act.client_id || act.sub
    NestedActClientId: nestedActClientId || '', // from act.act.client_id || act.act.sub
    McpResourceUri: mcpResourceUri || '',    // expected MCP resource URI from config
    ...(acr ? { Acr: acr } : {}),
    ...(hitlApproved ? { HitlApproved: true } : {}),
    ...(requiredGroup ? { RequiredGroup: requiredGroup } : {}),
    ...(Array.isArray(userGroups) ? { UserGroups: userGroups } : {}),
    ...(userTier ? { UserTier: userTier } : {}),
    ...(inRequiredGroup != null ? { InRequiredGroup: inRequiredGroup } : {}),
    ...(amount != null ? { Amount: amount } : {}),
    ...(resourceOwnerId ? { ResourceOwnerId: resourceOwnerId } : {}),
    Timestamp: new Date().toISOString(),
  };

  return _postDecisionEndpoint(endpointId, parameters);
}

// ---------------------------------------------------------------------------
// Phase 1 — Legacy PDP evaluation (fallback path)
// POST /v1/environments/{envId}/governance/policyDecisionPoints/{policyId}/evaluate
// ---------------------------------------------------------------------------

/**
 * Evaluate using the legacy Policy Decision Points path.
 *
 * @param {object} opts
 * @param {string} opts.policyId
 * @param {string} opts.userId
 * @param {number} opts.amount
 * @param {string} opts.type
 * @param {string} [opts.acr]
 * @param {object} [opts.context]
 * @returns {Promise<{ decision, stepUpRequired, raw, decisionId, path }>}
 */
async function _evaluateViaPdp({ policyId, userId, amount, type, acr, context = {} }) {
  const { envId, regionTld } = _getCredentials();

  const workerToken = await getWorkerToken();

  const url = `${apiBase(regionTld)}/v1/environments/${envId}/governance/policyDecisionPoints/${policyId}/evaluate`;

  const payload = {
    context: {
      user: {
        id: userId,
        acr: acr || null,
      },
      transaction: {
        amount,
        type,
        timestamp: new Date().toISOString(),
      },
      ...context,
    },
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${workerToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`PingOne Authorize PDP evaluation failed (${response.status}): ${text}`);
  }

  const raw = await response.json();
  const { stepUpRequired } = _classifyRawObligations(raw);
  const decision = _normalizeDecision(raw, { hasObligation: stepUpRequired });

  return { decision, stepUpRequired, raw, decisionId: null, path: 'pdp-legacy' };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Evaluate a transaction against PingOne Authorize.
 *
 * Automatically selects the API path:
 *   - Decision Endpoints path (Phase 2) when authorize_decision_endpoint_id is configured.
 *   - Legacy PDP path (Phase 1) when only authorize_policy_id is configured.
 *
 * @param {object} params
 * @param {string} [params.policyId]          - Legacy PDP ID (configStore fallback)
 * @param {string} [params.decisionEndpointId]- Decision endpoint ID (Phase 2; configStore fallback)
 * @param {string} params.userId
 * @param {number} params.amount
 * @param {string} params.type                - 'transfer' | 'withdrawal' | 'deposit'
 * @param {string} [params.acr]
 * @param {object} [params.context]           - Extra context (legacy path) / extra parameters (new path)
 * @returns {Promise<{ decision: 'PERMIT'|'DENY'|'INDETERMINATE', stepUpRequired: boolean, raw: object, decisionId: string|null, path: string }>}
 */
async function evaluateTransaction({ policyId, decisionEndpointId, userId, amount, type, acr, context = {} }) {
  const creds = _getCredentials();

  // Resolve endpoint / policy — caller param takes priority over configStore
  const resolvedEndpointId = decisionEndpointId || creds.decisionEndpointId;
  const resolvedPolicyId   = policyId           || creds.policyId;

  if (!creds.envId) throw new Error('PingOne environment ID is not configured.');

  if (resolvedEndpointId) {
    // Phase 2 — preferred path
    return _evaluateViaDecisionEndpoint({
      endpointId: resolvedEndpointId,
      userId,
      amount,
      type,
      acr,
      extra: context,
    });
  }

  if (resolvedPolicyId) {
    // Phase 1 — legacy fallback
    console.warn('[Authorize] Using legacy PDP path. Set authorize_decision_endpoint_id for Phase 2 API.');
    return _evaluateViaPdp({ policyId: resolvedPolicyId, userId, amount, type, acr, context });
  }

  throw new Error('authorize_decision_endpoint_id or authorize_policy_id must be configured.');
}

/**
 * Lightweight check: call PingOne Authorize to determine if step-up MFA is
 * required for this transaction, without rendering a final permit/deny decision.
 *
 * Returns early (stepUpRequired: false) if Authorize is not configured.
 *
 * @param {object} params
 * @param {string} [params.policyId]
 * @param {string} [params.decisionEndpointId]
 * @param {string} params.userId
 * @param {number} params.amount
 * @param {string} params.type
 * @param {string} [params.acr]
 * @returns {Promise<{ stepUpRequired: boolean, reason: string|null, raw: object|null }>}
 */
async function checkStepUpRequired({ policyId, decisionEndpointId, userId, amount, type, acr }) {
  if (!isConfigured()) {
    return { stepUpRequired: false, reason: null, raw: null };
  }

  try {
    const { decision, stepUpRequired, raw } = await evaluateTransaction({
      policyId,
      decisionEndpointId,
      userId,
      amount,
      type,
      acr,
      context: { checkType: 'step_up_check' },
    });

    if (stepUpRequired) {
      return { stepUpRequired: true, reason: 'policy_step_up_obligation', raw };
    }

    if (decision === 'DENY') {
      return { stepUpRequired: true, reason: 'policy_deny', raw };
    }

    return { stepUpRequired: false, reason: null, raw };
  } catch (err) {
    console.warn(`[Authorize] checkStepUpRequired failed — defaulting to not required: ${err.message}`);
    return { stepUpRequired: false, reason: null, raw: null };
  }
}

/**
 * Phase 3 — Fetch recent decisions for a decision endpoint.
 * Requires recordRecentRequests: true on the endpoint in PingOne Authorize.
 *
 * @param {string} [endpointId]  - defaults to authorize_decision_endpoint_id from configStore
 * @param {number} [limit=20]    - PingOne returns at most 20; 24-hour window
 * @returns {Promise<{ decisions: Array, endpointId: string }>}
 */
async function getRecentDecisions(endpointId, limit = 20) {
  const { envId, regionTld, decisionEndpointId } = _getCredentials();
  const resolvedId = endpointId || decisionEndpointId;

  if (!envId)        throw new Error('PingOne environment ID is not configured.');
  if (!resolvedId)   throw new Error('authorize_decision_endpoint_id is required for recent decisions.');

  const workerToken = await getWorkerToken();

  const url = `${apiBase(regionTld)}/v1/environments/${envId}/decisionEndpoints/${resolvedId}/recentDecisions?limit=${limit}`;

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${workerToken}` },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Recent decisions fetch failed (${response.status}): ${text}`);
  }

  const data = await response.json();
  // PingOne returns the collection under _embedded.recentDecisions (the HAL key
  // matches the sub-resource name). Keep the older keys as defensive fallbacks.
  const decisions = data._embedded?.recentDecisions || data._embedded?.decisions || data.decisions || [];

  return { decisions, endpointId: resolvedId };
}

/**
 * List all decision endpoints in the PingOne environment.
 * Useful for the Config UI and education panel.
 *
 * @returns {Promise<Array<{ id, name, description, recordRecentRequests }>>}
 */
async function getDecisionEndpoints() {
  const { envId, regionTld } = _getCredentials();
  if (!envId) throw new Error('PingOne environment ID is not configured.');

  const workerToken = await getWorkerToken();

  const url = `${apiBase(regionTld)}/v1/environments/${envId}/decisionEndpoints`;

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${workerToken}` },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Decision endpoints list failed (${response.status}): ${text}`);
  }

  const data = await response.json();
  return data._embedded?.decisionEndpoints || data.decisionEndpoints || [];
}

/**
 * Normalize one raw PingOne Authorize policy-tree node into a compact,
 * UI-friendly shape. A node is a Policy Set, a Policy, or a Rule:
 *   - Policy Set / Policy → has `combiningAlgorithm` + `children`
 *   - Rule                → has `effectSettings` (PERMIT / DENY effect)
 */
function _normalizePolicyNode(node, depth = 0) {
  if (!node || typeof node !== 'object') return null;
  const children = node._embedded?.children || node.children || [];
  const isRule = !!node.effectSettings && children.length === 0;
  const kind = isRule ? 'RULE' : (depth === 0 ? 'POLICY_SET' : 'POLICY');
  return {
    id: node.id,
    kind,
    name: node.name || '(unnamed)',
    description: node.description || '',
    enabled: node.enabled !== false,
    algorithm: node.combiningAlgorithm?.algorithm || null,
    effect: node.effectSettings?.type || null,
    children: children.map((c) => _normalizePolicyNode(c, depth + 1)).filter(Boolean),
  };
}

/**
 * List the full PingOne Authorize policy tree (Policy Sets → Policies → Rules)
 * for the configured environment, expanded one level so children come back
 * inline. This is the actual authorization policy that decision endpoints
 * enforce — distinct from the decision endpoints themselves.
 *
 * @returns {Promise<Array>} normalized root policy-set nodes
 */
async function getAuthorizationPolicies() {
  const { envId, regionTld } = _getCredentials();
  if (!envId) throw new Error('PingOne environment ID is not configured.');

  const workerToken = await getWorkerToken();

  const url = `${apiBase(regionTld)}/v1/environments/${envId}/authorizationPolicies?expand=children`;

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${workerToken}` },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Authorization policies list failed (${response.status}): ${text}`);
  }

  const data = await response.json();
  const roots = data._embedded?.authorizationPolicies || data.authorizationPolicies || [];
  return roots.map((r) => _normalizePolicyNode(r, 0)).filter(Boolean);
}

/**
 * Returns true if all required credentials are available (configStore or env).
 * Accepts either decision endpoint ID (Phase 2) or policy ID (Phase 1).
 */
function isConfigured() {
  const { envId, clientId, clientSecret, decisionEndpointId, policyId } = _getCredentials();
  return !!(envId && clientId && clientSecret && (decisionEndpointId || policyId));
}

/**
 * True when PingOne Authorize worker app credentials are present (can call Management API).
 */
function isWorkerCredentialReady() {
  const { envId, clientId, clientSecret } = _getCredentials();
  return !!(envId && clientId && clientSecret);
}

// ---------------------------------------------------------------------------
// Cold-start warmup
// ---------------------------------------------------------------------------

let _lastWarmAtMs = 0;
const WARMUP_THROTTLE_MS = 60_000;

/**
 * Pre-open the worker-token + TLS connection to PingOne Authorize so the FIRST
 * real decision after a cold start (container restart / long idle) does not pay
 * the connect + worker-token round-trip. That cold-start latency is what
 * intermittently trips the "Demo Authorize" degraded badge on the agent panel.
 *
 * Implementation detail: we issue the decision-endpoints LIST call. It mints the
 * worker token (auth.pingone.com) and hits the decision host (api.pingone.com) —
 * the exact origins a real decision reuses via undici's keep-alive pool — but
 * creates NO synthetic authorization decision, so the demo's decision log stays
 * clean.
 *
 * Safe to call on every page load: throttled to one live warm per
 * WARMUP_THROTTLE_MS. No-op in simulated mode or when worker credentials are
 * absent. Never throws.
 *
 * @param {object} [opts]
 * @param {boolean} [opts.force] - bypass the throttle (used by the boot warm).
 * @returns {Promise<{ ok:boolean, skipped?:string, ms?:number, cached?:boolean, error?:string }>}
 */
async function warmup({ force = false } = {}) {
  // The simulated engine runs in-process — nothing live to warm.
  if (configStore.getEffective('ff_authorize_simulated') === 'true') {
    return { ok: false, skipped: 'simulated' };
  }
  if (!isWorkerCredentialReady()) {
    return { ok: false, skipped: 'unconfigured' };
  }
  const startedAt = Date.now();
  if (!force && startedAt - _lastWarmAtMs < WARMUP_THROTTLE_MS) {
    return { ok: true, cached: true };
  }
  try {
    await getDecisionEndpoints();
    _lastWarmAtMs = Date.now();
    return { ok: true, ms: Date.now() - startedAt };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * Find a decision endpoint returned from getDecisionEndpoints() by exact name.
 * @param {Array<{ id?: string, name?: string }>} endpoints
 * @param {string} name
 */
function _findEndpointByName(endpoints, name) {
  if (!Array.isArray(endpoints)) return null;
  return endpoints.find((e) => String(e?.name || '') === name) || null;
}

/**
 * POST /v1/environments/{envId}/decisionEndpoints — create a policy decision endpoint.
 * @see https://developer.pingidentity.com/pingone-api/authorize/authorization-decisions/decision-endpoints/create-decision-endpoint.html
 * @param {{ name: string, description: string, policyId?: string, authorizationVersionId?: string }} opts
 * @returns {Promise<{ id: string, raw: object }>}
 */
async function _createDecisionEndpointResource(opts) {
  const { envId, regionTld } = _getCredentials();
  const workerToken = await getWorkerToken();
  const url = `${apiBase(regionTld)}/v1/environments/${envId}/decisionEndpoints`;

  const base = {
    name: opts.name,
    description: opts.description,
    recordRecentRequests: true,
  };
  if (opts.policyId) base.policyId = opts.policyId;
  if (opts.authorizationVersionId) {
    base.authorizationVersion = { id: opts.authorizationVersionId };
  }

  async function postWithPayload(payload) {
    return fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${workerToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
  }

  // Prefer server-assigned id; some tenants require a client UUID — retry with id on 400.
  let response = await postWithPayload(base);
  if (!response.ok && response.status === 400) {
    const withId = { ...base, id: crypto.randomUUID() };
    response = await postWithPayload(withId);
  }

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Create decision endpoint failed (${response.status}): ${text}`);
  }

  const raw = await response.json();
  const id = raw.id;
  if (!id) throw new Error('PingOne did not return decision endpoint id');
  return { id, raw };
}

/**
 * Ensure two demo decision endpoints exist in PingOne (transactions + MCP first-tool).
 * Reuses existing endpoints if names match (idempotent).
 *
 * @param {{ policyId?: string, authorizationVersionId?: string }} [options]
 * @returns {Promise<{ transactionEndpointId: string, mcpEndpointId: string, created: { transaction: boolean, mcp: boolean } }>}
 */
async function provisionDemoDecisionEndpoints(options = {}) {
  if (!isWorkerCredentialReady()) {
    throw new Error(
      'PingOne Authorize worker is not configured. Set PINGONE_WORKER_CLIENT_ID + PINGONE_WORKER_CLIENT_SECRET ' +
        'in .env, or enter authorize_worker_client_id / authorize_worker_client_secret in Application Configuration.'
    );
  }

  const policyId = options.policyId && String(options.policyId).trim() ? String(options.policyId).trim() : undefined;
  const authorizationVersionId =
    options.authorizationVersionId && String(options.authorizationVersionId).trim()
      ? String(options.authorizationVersionId).trim()
      : undefined;

  const list = await getDecisionEndpoints();
  let tx = _findEndpointByName(list, DEMO_TX_ENDPOINT_NAME);
  let mcp = _findEndpointByName(list, DEMO_MCP_ENDPOINT_NAME);

  const created = { transaction: false, mcp: false };

  if (!tx) {
    const r = await _createDecisionEndpointResource({
      name: DEMO_TX_ENDPOINT_NAME,
      description:
        'Super Banking demo — transactions (Trust Framework: Amount, TransactionType, UserId, Acr, Timestamp). Created by Application Configuration bootstrap.',
      policyId,
      authorizationVersionId,
    });
    tx = { id: r.id, name: DEMO_TX_ENDPOINT_NAME };
    created.transaction = true;
  }

  if (!mcp) {
    const r = await _createDecisionEndpointResource({
      name: DEMO_MCP_ENDPOINT_NAME,
      description:
        'Super Banking demo — first MCP tool gate (DecisionContext=McpFirstTool). Trust Framework attributes: TokenAudience (aud), ActClientId (act.client_id|act.sub), NestedActClientId (act.act.client_id|act.act.sub). Created by Application Configuration bootstrap.',
      policyId,
      authorizationVersionId,
    });
    mcp = { id: r.id, name: DEMO_MCP_ENDPOINT_NAME };
    created.mcp = true;
  }

  return {
    transactionEndpointId: tx.id,
    mcpEndpointId: mcp.id,
    created,
  };
}

/**
 * True when worker credentials and authorize_mcp_decision_endpoint_id are set (live MCP first-tool gate).
 */
function isMcpDelegationDecisionReady() {
  const { envId, clientId, clientSecret, mcpDecisionEndpointId } = _getCredentials();
  return !!(envId && clientId && clientSecret && mcpDecisionEndpointId && String(mcpDecisionEndpointId).trim());
}

/**
 * Evaluate an arbitrary Trust Framework parameters object against ANY decision
 * endpoint in the environment. Powers the admin Live Policy Console — lets an
 * operator send a real decision request to any endpoint (transaction, MCP, or
 * bespoke) and inspect the verbatim PingOne verdict. Always calls live PingOne
 * (never the simulated engine); callers gate this behind admin auth.
 *
 * @param {string} endpointId
 * @param {Record<string, unknown>} [parameters] - Trust Framework attributes
 * @returns {Promise<{ decision, stepUpRequired, hitlRequired, consentRequired, raw, decisionId, path, _debug }>}
 */
async function evaluateDecisionEndpoint(endpointId, parameters = {}) {
  if (!endpointId) throw new Error('endpointId is required.');
  const { envId } = _getCredentials();
  if (!envId) throw new Error('PingOne environment ID is not configured.');
  return _postDecisionEndpoint(endpointId, parameters || {});
}

/**
 * Enable (default) or disable recent-decision recording on a decision endpoint.
 * PingOne returns recent decisions (last 20, 24h window) only when
 * recordRecentRequests is true. PingOne's PUT replaces the full representation,
 * so we read-modify-write: GET the current resource, flip the flag, PUT it back
 * — reusing a single worker token for both calls.
 *
 * @param {string} endpointId
 * @param {boolean} [enabled=true]
 * @returns {Promise<{ id: string, name: string, recordRecentRequests: boolean }>}
 */
async function setEndpointRecording(endpointId, enabled = true) {
  const { envId, regionTld } = _getCredentials();
  if (!envId) throw new Error('PingOne environment ID is not configured.');
  if (!endpointId) throw new Error('endpointId is required.');

  const workerToken = await getWorkerToken();
  const url = `${apiBase(regionTld)}/v1/environments/${envId}/decisionEndpoints/${endpointId}`;

  const getResponse = await fetch(url, { headers: { Authorization: `Bearer ${workerToken}` } });
  if (!getResponse.ok) {
    const text = await getResponse.text();
    throw new Error(`Decision endpoint fetch failed (${getResponse.status}): ${text}`);
  }
  const current = await getResponse.json();

  // PUT replaces the representation — strip server-managed / read-only fields
  // and flip the recording flag, leaving everything else intact.
  const body = { ...current };
  delete body.id;
  delete body.environment;
  delete body._links;
  delete body._embedded;
  delete body.createdAt;
  delete body.updatedAt;
  body.recordRecentRequests = !!enabled;

  const putResponse = await fetch(url, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${workerToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!putResponse.ok) {
    const text = await putResponse.text();
    throw new Error(`Update decision endpoint failed (${putResponse.status}): ${text}`);
  }
  const raw = await putResponse.json();
  return { id: raw.id || endpointId, name: raw.name, recordRecentRequests: !!raw.recordRecentRequests };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Classify a PingOne Authorize raw response into the three enforcement flags.
 *
 * This function owns ONLY the PingOne-specific source merge — a PA response
 * can carry signals under raw.obligations, raw.advice, raw.details.obligations
 * and raw.details.advice. Those are flattened into one normalized list, then
 * the shared classifier (services/authorizeObligations.js) applies the single
 * type -> flag mapping + highest-gate-wins precedence. The simulated AS uses
 * the SAME classifier on its own flat obligations array, so the two engines
 * can no longer disagree on what a given obligation type means (H2).
 *
 * @param {object} raw PingOne Authorize response body
 * @returns {{ stepUpRequired: boolean, hitlRequired: boolean, consentRequired: boolean, classified: object }}
 */
/**
 * Fail-closed decision normalisation. The authorization *effect* of a PingOne
 * Authorize decision-endpoint response lives under `decision` (top level) or
 * `result.decision` / `details.decision` (envelope form) — NEVER under `status`,
 * which is a transport-level 'SUCCESS' wrapper. Reading `status` as the decision
 * turns a live DENY (or an unexpected/renamed envelope) into a silent PERMIT.
 *
 * Any value we cannot positively recognise as PERMIT collapses to DENY unless an
 * enforceable obligation (step-up / consent / HITL) is present — in which case
 * the caller acts on that obligation and we return INDETERMINATE so the response
 * is not mistaken for a clean permit.
 * @param {any} raw
 * @param {{ hasObligation?: boolean }} [opts]
 * @returns {'PERMIT'|'DENY'|'INDETERMINATE'}
 */
function _normalizeDecision(raw, { hasObligation = false } = {}) {
  const candidate = String(
    (raw && (raw.decision ?? raw.result?.decision ?? raw.details?.decision)) || '',
  ).trim().toUpperCase();
  if (candidate === 'PERMIT' || candidate === 'ALLOW') return 'PERMIT';
  if (candidate === 'DENY' || candidate === 'DENIED') return 'DENY';
  return hasObligation ? 'INDETERMINATE' : 'DENY';
}

function _classifyRawObligations(raw) {
  // XACML-style obligations/advice carry the identifier under type/id; the
  // PingOne Authorize decision endpoint returns applied rule effects under
  // `statements[].code` instead. Merge ALL of them so a gate fires regardless of
  // which shape this environment returns (classifyObligation reads type|id|code).
  const obligationsAndAdvice = [
    ...(raw.obligations || []),
    ...(raw.advice || []),
    ...(raw.details?.obligations || []),
    ...(raw.details?.advice || []),
  ];
  const merged = [
    ...obligationsAndAdvice,
    ...(raw.statements || []),
    ...(raw.details?.statements || []),
  ];

  // F4: warn on obligation/advice types the classifier doesn't recognise so
  // policy changes don't silently fall through as PERMIT. Statements are
  // excluded from this check: PERMIT statements (transaction-approved,
  // mcp-tool-authorized) are benign non-gates and would be false positives.
  const unrecognised = obligationsAndAdvice.filter((ob) => {
    const key = String((ob && (ob.type || ob.id || ob.code)) || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!key) return false;
    return !key.includes('HITL') && !key.includes('STEPUP') && !key.includes('HUMANAPPROVAL');
  });
  if (unrecognised.length > 0) {
    console.warn(
      '[PingOneAuthorize] Unrecognised obligation types — not enforced (check policy config):',
      unrecognised.map((ob) => ob.type || ob.id || ob.code),
    );
  }

  return classifyObligations(merged);
}

module.exports = {
  evaluateTransaction,
  evaluateMcpToolDelegation,
  evaluateDecisionEndpoint,
  checkStepUpRequired,
  getRecentDecisions,
  getDecisionEndpoints,
  getAuthorizationPolicies,
  setEndpointRecording,
  isConfigured,
  isMcpDelegationDecisionReady,
  isWorkerCredentialReady,
  provisionDemoDecisionEndpoints,
  getWorkerToken,
  warmup,
  // Exported for unit tests only (fail-closed decision normalisation).
  _normalizeDecision,
};
