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
const { CircuitBreaker } = require('../utils/circuitBreaker');
const { buildTestCasesForRule } = require('./policyTestCaseSolver');

// Bounded fetch: every outbound PingOne Authorize call gets a timeout so a
// provider outage yields a controlled failure in the authorization-decision
// path instead of an indefinite hang (fetch has no default timeout). Callers
// keep passing their normal options; a caller-supplied signal still wins.
// Resolved from globalThis at call time (not captured) so a test's fetch mock
// is still honoured.
const AUTHZ_FETCH_TIMEOUT_MS = Number(process.env.PINGONE_AUTHZ_TIMEOUT_MS) || 15000;
function fetchT(url, opts = {}) {
  return globalThis.fetch(url, { ...opts, signal: opts.signal ?? AbortSignal.timeout(AUTHZ_FETCH_TIMEOUT_MS) });
}

// Retry is OPT-IN, not a property of fetchT (P1AZ hardening amendment §C):
// applied ONLY to the idempotent evaluate/token calls, NEVER to provisioning
// writes (a create-endpoint POST that succeeds server-side but times out
// client-side must not be re-fired into a duplicate). These calls also get a
// tighter default timeout (5s vs fetchT's 15s) so a frozen P1AZ hands off to
// failover fast; PINGONE_AUTHZ_TIMEOUT_MS still overrides. At most one retry,
// on a transient failure only (network/timeout or 5xx); a 4xx is never retried.
const AUTHZ_EVAL_TIMEOUT_MS = Number(process.env.PINGONE_AUTHZ_TIMEOUT_MS) || 5000;
async function fetchRetryable(url, opts = {}) {
  const attempt = () =>
    globalThis.fetch(url, { ...opts, signal: opts.signal ?? AbortSignal.timeout(AUTHZ_EVAL_TIMEOUT_MS) });
  let response;
  try {
    response = await attempt();
  } catch (err) {
    // network error / timeout — one retry
    return attempt();
  }
  if (response.status >= 500) {
    // transient server error — one retry
    return attempt();
  }
  return response; // 2xx / 3xx / 4xx — never retried
}

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
// Worker token cache (P1AZ hardening amendment §E). Reused until 60s before the
// token's own `expires_in` elapses, so a decision no longer pays a
// client-credentials round-trip every call. Keyed by credentials/env so an
// admin credential or environment rotation is picked up immediately instead of
// surviving until expiry. `_workerTokenInflight` is a single-flight guard:
// concurrent gate evaluations before the cache is warm share ONE token request
// rather than stampeding the token endpoint.
const WORKER_TOKEN_EXPIRY_MARGIN_MS = 60_000;
let _workerTokenCache = null;   // { token, expiresAt, credKey }
let _workerTokenInflight = null; // Promise<string> | null

/** Non-secret cache key: which worker app + environment minted the token. */
function _workerCredKey(clientId, envId) {
  return `${envId}:${clientId}`;
}

async function _requestWorkerToken({ envId, clientId, clientSecret, regionTld }) {
  const tokenUrl = `${authBase(regionTld)}/${envId}/as/token`;
  const encoded = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  const response = await fetchRetryable(tokenUrl, {
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
  const ttlMs = Number(data.expires_in) > 0 ? Number(data.expires_in) * 1000 : 3600_000;
  return {
    token: data.access_token,
    expiresAt: Date.now() + ttlMs - WORKER_TOKEN_EXPIRY_MARGIN_MS,
  };
}

async function getWorkerToken() {
  const creds = _getCredentials();
  const { envId, clientId, clientSecret } = creds;

  if (!envId || !clientId || !clientSecret) {
    throw new Error(
      'PingOne Authorize worker credentials are not fully configured. ' +
      'Set PINGONE_WORKER_CLIENT_ID + PINGONE_WORKER_CLIENT_SECRET in .env (or the dedicated ' +
      'PINGONE_AUTHORIZE_WORKER_CLIENT_ID + PINGONE_AUTHORIZE_WORKER_CLIENT_SECRET if using a separate app), ' +
      'or enter authorize_worker_client_id / authorize_worker_client_secret in Admin → Configuration → PingOne Authorize.'
    );
  }

  const credKey = _workerCredKey(clientId, envId);

  // Reuse a still-valid token minted by the SAME credentials/environment.
  if (_workerTokenCache && _workerTokenCache.credKey === credKey && Date.now() < _workerTokenCache.expiresAt) {
    return _workerTokenCache.token;
  }

  // Single-flight: concurrent callers share one client-credentials request.
  if (_workerTokenInflight) return _workerTokenInflight;

  _workerTokenInflight = (async () => {
    try {
      const { token, expiresAt } = await _requestWorkerToken(creds);
      _workerTokenCache = { token, expiresAt, credKey };
      return token;
    } finally {
      _workerTokenInflight = null;
    }
  })();

  return _workerTokenInflight;
}

/**
 * Invalidate the cached worker token iff it matches the one that just failed
 * (e.g. a 401 from a decision call). Only clears when the failing token is the
 * cached token, so a concurrent refresh that already replaced it is not wiped.
 */
function _invalidateWorkerToken(failedToken) {
  if (_workerTokenCache && (!failedToken || _workerTokenCache.token === failedToken)) {
    _workerTokenCache = null;
  }
}

// Per-endpoint circuit breakers (P1AZ hardening amendment §E). One breaker per
// evaluate target (decision endpoint id / policy id) so a failure streak on one
// endpoint does not fast-fail an unrelated healthy one. After 3 consecutive
// OUTAGE failures (timeout/network/5xx) the breaker opens for 60s and evaluate
// calls fail fast with err.code='authorize_circuit_open' — the gates' existing
// failover then engages instantly instead of paying the full timeout per call.
const AUTHZ_BREAKER_THRESHOLD = 3;
const AUTHZ_BREAKER_OPEN_MS = 60_000;
const _breakers = new Map();
function _getBreaker(key) {
  let breaker = _breakers.get(key);
  if (!breaker) {
    breaker = new CircuitBreaker({ threshold: AUTHZ_BREAKER_THRESHOLD, openMs: AUTHZ_BREAKER_OPEN_MS });
    _breakers.set(key, breaker);
  }
  return breaker;
}

/**
 * Run an evaluate against its endpoint's circuit breaker. Only an OUTAGE (5xx or
 * a network/timeout error with no HTTP status) counts as a failure; a reachable
 * 4xx — including a 404 policy_not_found or the UserGroups 400 that has its own
 * self-heal — records success so the engine's own error handlers keep running
 * and config drift never masquerades as an outage.
 */
async function _evaluateWithBreaker(key, doEvaluate) {
  const breaker = _getBreaker(key);
  if (!breaker.canRequest()) {
    const err = new Error('PingOne Authorize circuit open — failing fast to failover');
    err.code = 'authorize_circuit_open';
    throw err;
  }
  try {
    const result = await doEvaluate();
    breaker.recordSuccess();
    return result;
  } catch (err) {
    if (typeof err?.status === 'number' && err.status >= 400 && err.status < 500) {
      breaker.recordSuccess(); // reachable 4xx — engine is up, not an outage
    } else {
      breaker.recordFailure(); // 5xx or network/timeout
    }
    throw err;
  }
}

/** Test hook: clear in-process authorize runtime state (worker token cache + breakers). */
function _resetAuthorizeRuntimeState() {
  _workerTokenCache = null;
  _workerTokenInflight = null;
  _breakers.clear();
}

/**
 * POST a decision request with the worker token, retrying ONCE on a 401 with a
 * freshly-minted token (the cached token may have been rotated/revoked at P1AZ).
 * Idempotent evaluate call, so the underlying fetchRetryable transient-retry is
 * safe. A 401 that survives the refresh is returned to the caller as-is.
 */
async function _postDecisionWithAuth(url, body) {
  const doFetch = (tok) => fetchRetryable(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
    body,
  });

  let workerToken = await getWorkerToken();
  let response = await doFetch(workerToken);
  if (response.status === 401) {
    _invalidateWorkerToken(workerToken);
    workerToken = await getWorkerToken();
    response = await doFetch(workerToken);
  }
  return response;
}

// ---------------------------------------------------------------------------
// Phase 2 — Decision Endpoints evaluation (current / preferred path)
// POST /v1/environments/{envId}/decisionEndpoints/{endpointId}
// ---------------------------------------------------------------------------

// C1 fail-closed decision normalisation. The authorization *effect* lives under
// `decision` / `result.decision` / `details.decision`; `status` is a transport
// wrapper (`SUCCESS` on every completed evaluation) and must never be read as
// the effect — the old `raw.decision || raw.status` fallthrough turned a live
// DENY into a silent PERMIT. Anything not positively PERMIT/DENY collapses to
// DENY unless an enforceable obligation is present (caller acts on it).
const _PERMIT_EFFECTS = new Set(['permit', 'allow', 'allowed']);
const _DENY_EFFECTS = new Set(['deny', 'denied']);

function _rawEffect(raw) {
  const effect = raw && typeof raw === 'object'
    ? raw.decision ?? raw.result?.decision ?? raw.details?.decision
    : undefined;
  return typeof effect === 'string' ? effect.trim().toLowerCase() : '';
}

function _normalizeDecision(raw, { hasObligation = false } = {}) {
  const value = _rawEffect(raw);
  if (_PERMIT_EFFECTS.has(value)) return 'PERMIT';
  if (_DENY_EFFECTS.has(value)) return 'DENY';
  return hasObligation ? 'INDETERMINATE' : 'DENY';
}

// Drift detector (P1AZ hardening amendment §A). True only when the engine
// evaluated successfully but no policy matched — the "code added a tool/action
// P1AZ has no policy for" case, which returns a literal not_applicable effect.
// This is a SIDE CHANNEL: `_normalizeDecision` still collapses the same input to
// DENY, so a consumer that ignores this flag stays fail-closed.
function _isPolicyNotFoundEffect(raw) {
  return _rawEffect(raw).replace(/[-_\s]/g, '') === 'notapplicable';
}

// Single status->error mapping for both decision paths (amendment §A / altitude).
// A 404 means the configured decision-endpoint/policy id does not exist in P1AZ
// (config drift), distinct from a genuine outage; tag it so failover and the
// gates can tell them apart. All other statuses stay plain outages.
function _decisionError(status, text, label) {
  const err = new Error(`PingOne Authorize ${label} evaluation failed (${status}): ${text}`);
  err.status = status;
  if (status === 404) err.code = 'policy_not_found';
  return err;
}

/**
 * POST a Trust Framework parameters object to a decision endpoint (Phase 2).
 * @param {string} endpointId
 * @param {Record<string, unknown>} parameters
 * @returns {Promise<{ decision, stepUpRequired, raw, decisionId, path }>}
 */
async function _postDecisionEndpoint(endpointId, parameters) {
  const { envId, regionTld } = _getCredentials();

  const url = `${apiBase(regionTld)}/v1/environments/${envId}/decisionEndpoints/${endpointId}`;

  console.log('[BFF→P1AZ] REQUEST: url=%s', url);
  console.log('[BFF→P1AZ] PARAMETERS: %j', parameters);

  return _evaluateWithBreaker(`decision:${endpointId}`, async () => {
    const response = await _postDecisionWithAuth(url, JSON.stringify({ parameters }));

    if (!response.ok) {
      const text = await response.text();
      throw _decisionError(response.status, text, 'decision endpoint');
    }

    const raw = await response.json();
    console.log('[BFF→P1AZ] RESPONSE: status=%d body=%j', response.status, raw);
    const { stepUpRequired, hitlRequired, consentRequired } = _classifyRawObligations(raw);
    const decision = _normalizeDecision(raw, {
      hasObligation: stepUpRequired || hitlRequired || consentRequired,
    });
    const policyNotFound = _isPolicyNotFoundEffect(raw);

    const decisionId = raw.id || raw.decisionId || null;

    const _debug = {
      request: { method: 'POST', url, contentType: 'application/json', body: { parameters } },
      response: raw,
    };
    return { decision, policyNotFound, stepUpRequired, hitlRequired, consentRequired, raw, decisionId, path: 'decision-endpoint', _debug };
  });
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
  // Transaction type (transfer/deposit/withdrawal) for amount-threshold-aware
  // policy evaluation. Without this, PingOne can't distinguish amount bands.
  transactionType = null,
  // HITL receipt (receipt-aware PERMIT). When the BFF/gateway has verified an
  // approved, caller-bound HITL challenge for THIS tool call, it sets
  // hitlApproved=true. We only FORWARD it as a decision parameter — the Trust
  // Framework policy is what flips INDETERMINATE→PERMIT when it sees
  // HitlApproved==true on a confirm-gated call. The policy must NOT let a
  // receipt satisfy a STEP_UP obligation (parity with the simulated engine,
  // where step-up wins before the consent branch). Emitted only when true,
  // matching the conditional-spread style of Acr (and the simulated engine).
  hitlApproved = false,
  // Challenge id that produced hitlApproved (mock authz requires both).
  hitlChallengeId = null,
  // Group-membership policy (Scenario 1). Live PingOne receives RequiredGroup plus
  // BFF-pre-resolved InRequiredGroup / UserTier scalars (the snapshot DSL has no
  // array-contains). userGroups is accepted for caller parity but is NOT forwarded
  // to PingOne — a JS array triggers INVALID_VALUE on parameters.UserGroups.
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
  // RAR (NNP-1) attested-authorization parity with the simulated engine. The
  // ceiling + permitted payees come from the token's azd (never the request body);
  // ToAccountId is the stated destination checked against them. Emitted only when
  // present so the deployed policy can enforce rar_amount_exceeded /
  // rar_payee_not_permitted (inert if the policy defines no RAR rule).
  rarMaxAmount = null,
  rarPermittedPayees = null,
  toAccountId = null,
  // Active vertical — sent as Vertical so PingOne policy can key on it
  verticalId = null,
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
    ...(hitlApproved && hitlChallengeId ? { HitlChallengeId: hitlChallengeId } : {}),
    ...(requiredGroup ? { RequiredGroup: requiredGroup } : {}),
    ...(userTier ? { UserTier: userTier } : {}),
    ...(inRequiredGroup != null ? { InRequiredGroup: inRequiredGroup } : {}),
    ...(amount != null ? { Amount: amount, TransactionAmount: String(amount) } : {}),
    ...(transactionType ? { TransactionType: transactionType } : {}),
    ...(resourceOwnerId ? { ResourceOwnerId: resourceOwnerId } : {}),
    ...(rarMaxAmount != null ? { RarMaxAmount: rarMaxAmount } : {}),
    ...(Array.isArray(rarPermittedPayees) ? { RarPermittedPayees: rarPermittedPayees } : {}),
    ...(toAccountId ? { ToAccountId: toAccountId } : {}),
    ...(verticalId ? { Vertical: verticalId } : {}),
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

  return _evaluateWithBreaker(`pdp:${policyId}`, async () => {
    const response = await _postDecisionWithAuth(url, JSON.stringify(payload));

    if (!response.ok) {
      const text = await response.text();
      throw _decisionError(response.status, text, 'PDP');
    }

    const raw = await response.json();
    const { stepUpRequired } = _classifyRawObligations(raw);
    const decision = _normalizeDecision(raw, { hasObligation: stepUpRequired });
    const policyNotFound = _isPolicyNotFoundEffect(raw);

    return { decision, policyNotFound, stepUpRequired, raw, decisionId: null, path: 'pdp-legacy' };
  });
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

  const response = await fetchT(url, {
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

  const response = await fetchT(url, {
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

  const response = await fetchT(url, {
    headers: { Authorization: `Bearer ${workerToken}` },
  });

  if (!response.ok) {
    const text = await response.text();
    const err = new Error(`Authorization policies list failed (${response.status}): ${text}`);
    err.status = response.status;
    throw err;
  }

  const data = await response.json();
  const roots = data._embedded?.authorizationPolicies || data.authorizationPolicies || [];
  return roots.map((r) => _normalizePolicyNode(r, 0)).filter(Boolean);
}

/**
 * Build the policy tree from the repo's P1AZ snapshot file — the import
 * source of truth (see pingone/pingone-authorize-configure/SKILL.md: policies
 * are configured by editing this snapshot and importing it in the console;
 * PingOne's policy-editor API rejects worker client_credentials tokens, so a
 * live GET /authorizationPolicies is not possible with our credentials).
 *
 * Snapshot entries carry `type: PolicySet|Policy|Rule` with `children` as
 * {id, type} refs; this resolves the refs into the same normalized node shape
 * _normalizePolicyNode produces so the UI renders identically.
 *
 * @returns {Array|null} normalized root policy-set nodes, or null when the
 *   snapshot cannot be read (missing from the image, malformed, etc.)
 */
function getAuthorizationPoliciesFromSnapshot() {
  const fs = require('fs');
  const path = require('path');
  const candidates = [
    // Native run: demo_api_server/services → repo root snapshots/
    path.join(__dirname, '..', '..', 'snapshots', 'Super_Banking_Transaction_Authorization_P1AZ.snapshot.json'),
    // Docker image: COPY snapshots/ ./snapshots/ lands beside the app code
    path.join(__dirname, '..', 'snapshots', 'Super_Banking_Transaction_Authorization_P1AZ.snapshot.json'),
  ];
  const file = candidates.find((p) => { try { return fs.existsSync(p); } catch (_) { return false; } });
  if (!file) return null;

  let entries;
  try { entries = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (_) { return null; }
  if (!Array.isArray(entries)) return null;

  const byId = new Map();
  const conditionIndex = new Map();
  for (const e of entries) {
    if (!e || !e.id) continue;
    if (e.type === 'PolicySet' || e.type === 'Policy' || e.type === 'Rule') byId.set(e.id, e);
    if (e.type === 'CONDITION' || e.type === 'ATTRIBUTE') conditionIndex.set(e.id, e);
  }
  if (byId.size === 0) return null;

  const toNode = (entry, depth) => {
    if (!entry) return null;
    const isRule = entry.type === 'Rule';
    const childRefs = Array.isArray(entry.children) ? entry.children : [];
    return {
      id: entry.id,
      kind: isRule ? 'RULE' : (depth === 0 ? 'POLICY_SET' : 'POLICY'),
      name: entry.name || '(unnamed)',
      description: entry.description || '',
      enabled: entry.disabled !== true,
      algorithm: entry.combiningAlgorithm?.algorithm || null,
      effect: entry.effectSettings?.type || null,
      children: childRefs.map((c) => toNode(byId.get(c.id), depth + 1)).filter(Boolean),
      ...(isRule ? { testCases: buildTestCasesForRule(entry, conditionIndex) } : {}),
    };
  };

  // Roots are the PolicySets; everything else is reachable through children refs.
  const roots = [...byId.values()].filter((e) => e.type === 'PolicySet');
  return roots.map((r) => toNode(r, 0)).filter(Boolean);
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
    return fetchT(url, {
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

  const getResponse = await fetchT(url, { headers: { Authorization: `Bearer ${workerToken}` } });
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

  const putResponse = await fetchT(url, {
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

/**
 * On-demand drift check (P1AZ hardening amendment §E). Verifies each configured
 * gate's decision endpoint EXISTS in PingOne Authorize by listing endpoints —
 * the reliable, side-effect-free signal. It deliberately does NOT fire synthetic
 * decisions: those would pollute the recent-decisions log, and against the demo
 * snapshot's always-applicable catch-all rules a synthetic request cannot surface
 * NOT_APPLICABLE drift anyway. Never throws — failures are classified.
 *
 * @returns {Promise<{ readiness: 'ready'|'policy_not_found'|'not_configured'|'skipped'|'error', gates: Array, reason?, error? }>}
 */
async function checkPolicyReadiness() {
  if (!isWorkerCredentialReady()) {
    return { readiness: 'skipped', reason: 'worker_creds_missing', gates: [] };
  }

  let liveIds;
  try {
    const endpoints = await getDecisionEndpoints();
    liveIds = new Set((endpoints || []).map((ep) => ep.id));
  } catch (err) {
    return { readiness: 'error', error: err.message, gates: [] };
  }

  const toCheck = [
    { key: 'authorize_decision_endpoint_id', gate: 'Transaction decision endpoint' },
    { key: 'authorize_mcp_decision_endpoint_id', gate: 'MCP first-tool decision endpoint' },
  ];
  const gates = toCheck.map(({ key, gate }) => {
    const id = configStore.getEffective(key) || process.env[key.toUpperCase()];
    if (!id) return { gate, status: 'not_configured', id: null };
    return { gate, status: liveIds.has(id) ? 'ready' : 'policy_not_found', id };
  });

  const readiness = gates.some((g) => g.status === 'policy_not_found')
    ? 'policy_not_found'
    : (gates.some((g) => g.status === 'ready') ? 'ready' : 'not_configured');

  return { readiness, gates };
}

module.exports = {
  _normalizeDecision,
  _isPolicyNotFoundEffect,
  _decisionError,
  _invalidateWorkerToken,
  _resetAuthorizeRuntimeState,
  _fetchRetryable: fetchRetryable,
  _postDecisionWithAuth,
  _evaluateWithBreaker,
  evaluateTransaction,
  evaluateMcpToolDelegation,
  evaluateDecisionEndpoint,
  checkStepUpRequired,
  getRecentDecisions,
  getDecisionEndpoints,
  getAuthorizationPolicies,
  getAuthorizationPoliciesFromSnapshot,
  setEndpointRecording,
  isConfigured,
  isMcpDelegationDecisionReady,
  isWorkerCredentialReady,
  provisionDemoDecisionEndpoints,
  getWorkerToken,
  warmup,
  checkPolicyReadiness,
};
