/**
 * ConfigStore — persists app configuration across server/browser restarts.
 *
 * Uses LMDB via services/lmdb/configStore.lmdb.js → data/persistent/lmdb/
 *
 * Secrets (clientSecret, sessionSecret) are encrypted with AES-256-GCM before
 * being written to storage, using a key derived from CONFIG_ENCRYPTION_KEY or
 * SESSION_SECRET.  The in-memory cache always holds plaintext values.
 *
 * The exported singleton exposes:
 *   configStore.get(key)              → sync read from in-memory cache
 *   await configStore.setConfig(data) → validate + save + update cache
 *   configStore.getMasked()           → safe subset for sending to the browser
 *   await configStore.ensureInitialized() → call once before handling requests
 */

'use strict';

const crypto = require('node:crypto');
const path = require('node:path');
const fs = require('node:fs');

// Load scope-topology.json (master SoT for OAuth audiences + deployment URLs)
let scopeTopology = null;
function loadScopeTopology() {
  if (scopeTopology) return scopeTopology;
  // SCOPE_TOPOLOGY_PATH lets Docker point at a directory-mounted copy that
  // survives host-file replacement; defaults to the repo-root SSOT otherwise.
  const scopePath =
    process.env.SCOPE_TOPOLOGY_PATH ||
    path.join(__dirname, '../../scope-topology.json');
  try {
    scopeTopology = JSON.parse(fs.readFileSync(scopePath, 'utf8'));
    return scopeTopology;
  } catch (err) {
    console.warn('[ConfigStore] Failed to load scope-topology.json:', err.message);
    return null;
  }
}

// Determine current deployment environment (local or k8s based on NODE_ENV)
function getDeploymentEnvironment() {
  // In k8s, NODE_ENV=production. Locally, NODE_ENV=development.
  // For safety, default to 'local' if unknown.
  const env = process.env.NODE_ENV?.toLowerCase() || 'development';
  return env === 'production' ? 'k8s' : 'local';
}

// Extract deployment URLs from scope-topology.json and return as config object
function getDeploymentUrls() {
  const topo = loadScopeTopology();
  if (!topo?.deployment?.environments) {
    console.warn('[ConfigStore] scope-topology.json has no deployment.environments');
    return {};
  }
  const envName = getDeploymentEnvironment();
  const envConfig = topo.deployment.environments[envName];
  if (!envConfig) {
    console.warn(`[ConfigStore] No deployment config for environment "${envName}" in scope-topology.json`);
    return {};
  }
  // Map scope-topology deployment fields to env var names
  const urls = {};
  if (envConfig.publicAppUrl) {
    urls.PINGONE_PUBLIC_APP_URL = envConfig.publicAppUrl;
    urls.PUBLIC_APP_URL = envConfig.publicAppUrl;
    urls.REACT_APP_CLIENT_URL = envConfig.publicAppUrl;
    urls.CORS_ORIGIN = envConfig.publicAppUrl;
    // Derive redirect URIs from publicAppUrl
    urls.PINGONE_ADMIN_REDIRECT_URI = `${envConfig.publicAppUrl}/api/auth/oauth/callback`;
    urls.PINGONE_USER_REDIRECT_URI = `${envConfig.publicAppUrl}/api/auth/oauth/user/callback`;
  }
  if (envConfig.pingGatewayResourceUri) {
    urls.PINGONE_RESOURCE_PINGGATEWAY_URI = envConfig.pingGatewayResourceUri;
  }
  return urls;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// Fields that must be encrypted at rest. Listed verbatim for reviewability;
// some entries are UPPER (PingOne app secrets) and some lowercase (FIELD_DEFS
// keys), matching how each is written by callers.
const _SECRET_KEYS_RAW = [
  'PINGONE_ADMIN_CLIENT_SECRET',
  'PINGONE_USER_CLIENT_SECRET',
  'PINGONE_SESSION_SECRET',
  'PINGONE_AUTHORIZE_WORKER_CLIENT_SECRET',
  'PINGONE_MANAGEMENT_CLIENT_SECRET',
  'PINGONE_AGENT_CLIENT_SECRET',
  'PINGONE_AI_AGENT_ACTOR_CLIENT_SECRET',
  'PINGONE_A2A_INVESTMENT_AGENT_CLIENT_SECRET',
  'PINGONE_A2A_RECORDS_AGENT_CLIENT_SECRET',
  'PINGONE_A2A_PURCHASE_AGENT_CLIENT_SECRET',
  'PINGONE_A2A_MEMBERSHIP_AGENT_CLIENT_SECRET',
  'PINGONE_A2A_PAYROLL_AGENT_CLIENT_SECRET',
  'helix_api_key',
  'google_api_key',
  'pingone_introspection_client_secret',
  'posthog_api_key',
  'demo_password',
  'demo_admin_password',
  'mcp_gw_client_secret',
  'RECOGNIZE_API_KEY',
  'gw_introspection_client_secret',
  'pingone_client_jwt_private_key',
];
// Membership is UPPER-canonical: config keys are stored UPPER everywhere
// (in-memory cache + LMDB rows), so secret detection must match regardless
// of the case a caller or FIELD_DEFS uses, otherwise encrypt-on-write and
// decrypt-on-load become asymmetric and lowercase secrets reload as
// ciphertext. See REGRESSION_PLAN §4 (SECRET_KEYS casing).
const SECRET_KEYS = new Set(_SECRET_KEYS_RAW.map((k) => k.toUpperCase()));

// ---------------------------------------------------------------------------
// Bootstrap allowlist — keys read BEFORE the vault can be unlocked / before
// configStore can decrypt LMDB. For these, .env (process.env) MUST stay
// authoritative even when a vault/LMDB value exists, or the app cannot
// reach the point where the vault could be opened. Lowercase — getEffective
// has already lowercased `key` before the membership test. See
// REGRESSION_PLAN §1 "Config UI / configStore" + §4.
const BOOTSTRAP_ALLOWLIST = new Set([
  'session_secret',
  'config_encryption_key',
  'vault_password',
  'vault_path',
  'node_env',
  'port',
  'pingone_environment_id',
  'pingone_region',
  // OAuth issuer and management credentials are identity-critical: a stale LMDB
  // value for these causes JWT validation failures or Management API auth errors
  // even when .env has the correct values. Treat them as bootstrap-authoritative
  // so .env always wins when set.
  'oauth_issuer',
  'oauth_authorization_endpoint',
  'oauth_token_endpoint',
  'oauth_userinfo_endpoint',
  'oauth_jwks_uri',
  'oauth_discovery_endpoint',
  'user_redirect_uri',
  'admin_redirect_uri',
  'pingone_mgmt_client_id',
  'pingone_mgmt_client_secret',
  'pingone_management_client_id',
  'pingone_management_client_secret',
]);

// All known config keys with their defaults and whether they are public
const FIELD_DEFS = {
  // PingOne environment
  PINGONE_ENVIRONMENT_ID: { public: true,  default: '' },
  PINGONE_REGION:         { public: true,  default: 'com' },
  PINGONE_BASE_URL:       { public: true,  default: '' },

  // Admin OAuth app
  PINGONE_ADMIN_CLIENT_ID:        { public: true,  default: '' },
  PINGONE_ADMIN_CLIENT_SECRET:    { public: false, default: '' },
  PINGONE_ADMIN_REDIRECT_URI:     { public: true,  default: '' },
  // 'basic' = client_secret via Authorization header; 'post' = client_secret in form body (match PingOne app).
  PINGONE_ADMIN_TOKEN_ENDPOINT_AUTH_METHOD: { public: true, default: 'basic' },

  // End-user OAuth app
  PINGONE_USER_CLIENT_ID:         { public: true,  default: '' },
  PINGONE_USER_CLIENT_SECRET:     { public: false, default: '' },
  PINGONE_USER_REDIRECT_URI:      { public: true,  default: '' },

  // SDK centralized-login demo (/sdk-login) — a PUBLIC PKCE SPA client (token
  // endpoint auth = None, no secret). Browser-side token custody; this is NOT the
  // BFF login. Consumed by GET /api/sdk-demo/config + demo_api_ui SdkLoginPage.
  PINGONE_SDK_DEMO_CLIENT_ID:     { public: true,  default: '' },
  PINGONE_SDK_DEMO_REDIRECT_URI:  { public: true,  default: '' },
  PINGONE_SDK_DEMO_SCOPE:         { public: true,  default: 'openid profile email' },

  // Management API worker (client_credentials) — CIMD registration, email, bootstrap run.
  // Not the admin sign-in app. Env: PINGONE_MANAGEMENT_CLIENT_ID / PINGONE_MANAGEMENT_CLIENT_SECRET.
  PINGONE_MANAGEMENT_CLIENT_ID:     { public: true,  default: '' },
  PINGONE_MANAGEMENT_CLIENT_SECRET: { public: false, default: '' },

  // Dedicated management API worker credentials — used by WorkerAppConfigTab and delegationService.
  // Preferred over PINGONE_MANAGEMENT_CLIENT_ID when set. Env: PINGONE_MGMT_CLIENT_ID / PINGONE_MGMT_CLIENT_SECRET.
  PINGONE_MGMT_CLIENT_ID:          { public: true,  default: '' },
  PINGONE_MGMT_CLIENT_SECRET:      { public: false, default: '' },
  // Token endpoint auth method for the management worker: 'basic' (default) or 'post'.
  PINGONE_MGMT_TOKEN_AUTH_METHOD:  { public: true,  default: 'basic' },

  // PingOne authorize: pi.flow + response_mode=pi.flow for apps that support it (e.g. DaVinci flow policies).
  // See https://developer.pingidentity.com/pingone-api/auth/auth-config-options/browserless-authentication-flow-options.html
  PINGONE_ADMIN_AUTHORIZE_PI_FLOW: { public: true, default: 'false' },
  PINGONE_USER_AUTHORIZE_PI_FLOW:  { public: true, default: 'false' },
  /** Marketing home: redirect (standard code+PKCE) vs slide-over panel + authorize with use_pi_flow=1 */
  marketing_customer_login_mode:   { public: true, default: 'redirect' },
  marketing_demo_username_hint:    { public: true, default: '' },
  marketing_demo_password_hint:    { public: true, default: '' },

  // Copilot Studio agent mode (Part 2 of the Copilot round-trip). All public/non-secret.
  // copilot_mode_enabled gates the /copilot route; the rest configure the browser MSAL
  // + Copilot Studio client. The Entra app + published agent are created out-of-band
  // (see demo_api_ui/COPILOT_SETUP.md).
  copilot_mode_enabled:            { public: true, default: 'false' },
  copilot_entra_client_id:         { public: true, default: '' },
  copilot_entra_tenant_id:         { public: true, default: '' },
  copilot_environment_id:          { public: true, default: '' },
  copilot_agent_schema_name:       { public: true, default: '' },

  // Auth server
  admin_role:             { public: true,  default: 'admin' },
  user_role:              { public: true,  default: 'customer' },
  // Comma-separated list of PingOne preferred_usernames that always receive admin role
  admin_username:         { public: true,  default: '' },
  // PingOne population ID whose members are treated as admin (no schema changes needed)
  admin_population_id:    { public: true,  default: '' },
  // PingOne userinfo/ID-token claim whose value is compared against admin_role (e.g. a custom attribute)
  PINGONE_ADMIN_ROLE_CLAIM:       { public: true,  default: '' },

  // Server / misc
  PINGONE_SESSION_SECRET:         { public: false, default: '' },
  FRONTEND_URL:           { public: true,  default: '' },
  // MCP server WebSocket/HTTP URL — BFF dials this to reach the MCP server (or gateway).
  // Scheme is part of the value: ws:// / wss:// for direct MCP; kept for backwards-compat alias.
  // Canonical persisted key is mcp_server_url (lowercase, env alias: MCP_SERVER_URL).
  PINGONE_MCP_SERVER_URL:         { public: true,  default: 'ws://localhost:8080' },
  mcp_server_url:                 { public: true,  default: 'ws://localhost:8080' },
  // MCP Gateway HTTP base URL — scheme + host + port for the BFF → gateway HTTP channel.
  // Local dev: https://api.ping.demo:3005 (TLS via mkcert). Env alias: MCP_GATEWAY_HTTP_URL.
  mcp_gateway_http_url:           { public: true,  default: 'https://api.ping.demo:3005' },
  PINGONE_DEBUG_OAUTH:            { public: true,  default: 'false' },

  // PingOne Authorize (policy decision point for transfers/withdrawals)
  PINGONE_AUTHORIZE_ENABLED:                { public: true,  default: 'false' },
  // Phase 2: Decision Endpoints API — preferred path (set this in PingOne Authorize → Decision Endpoints)
  PINGONE_AUTHORIZE_DECISION_ENDPOINT_ID:   { public: true,  default: '' },
  // Optional: second decision endpoint for MCP first-tool delegation (DecisionContext=McpFirstTool in TF params)
  PINGONE_AUTHORIZE_MCP_DECISION_ENDPOINT_ID: { public: true, default: '' },
  // Phase 1: Legacy PDP path — fallback when decision endpoint ID is not set
  PINGONE_AUTHORIZE_POLICY_ID:              { public: true,  default: '' },
  PINGONE_AUTHORIZE_WORKER_CLIENT_ID:       { public: true,  default: '' },
  PINGONE_AUTHORIZE_WORKER_CLIENT_SECRET:   { public: false, default: '' },
  PINGONE_MCP_TOKEN_EXCHANGER_CLIENT_ID:    { public: true,  default: '' },
  pingone_worker_client_id:                 { public: true,  default: '' },

  // A2A (agent-to-agent) — Investment Advisor specialist agent (Agent 2) + intermediate audience.
  // Used by a2aDelegationService for the chained RFC 8693 exchange that nests act:{sub:agent2, act:{sub:agent1}}.
  PINGONE_A2A_INVESTMENT_AGENT_CLIENT_ID:     { public: true,  default: '' },
  PINGONE_A2A_INVESTMENT_AGENT_CLIENT_SECRET: { public: false, default: '' },
  PINGONE_A2A_RECORDS_AGENT_CLIENT_ID:        { public: true,  default: '' },
  PINGONE_A2A_RECORDS_AGENT_CLIENT_SECRET:    { public: false, default: '' },
  PINGONE_A2A_PURCHASE_AGENT_CLIENT_ID:       { public: true,  default: '' },
  PINGONE_A2A_PURCHASE_AGENT_CLIENT_SECRET:   { public: false, default: '' },
  PINGONE_A2A_MEMBERSHIP_AGENT_CLIENT_ID:     { public: true,  default: '' },
  PINGONE_A2A_MEMBERSHIP_AGENT_CLIENT_SECRET: { public: false, default: '' },
  PINGONE_A2A_PAYROLL_AGENT_CLIENT_ID:        { public: true,  default: '' },
  PINGONE_A2A_PAYROLL_AGENT_CLIENT_SECRET:    { public: false, default: '' },
  PINGONE_RESOURCE_A2A_INTERMEDIATE_URI:      { public: true,  default: '' },

  // Feature flags — granular toggles for in-development features
  // Each maps to a runtime behaviour controlled via /api/admin/feature-flags.
  ff_authorize_fail_open:  { public: true, default: 'false' }, // fail closed by default; enable to allow transactions when auth service is unavailable
  ff_authorize_deposits:   { public: true, default: 'false' }, // apply Authorize to deposits too
  // Single flip flag for the authorize engine. Default 'false' => real PingOne
  // Authorize is used; with authorize_failover_mode='fallback_simulated' (the
  // default) a genuine PingOne failure falls back to the in-process simulated
  // engine (and surfaces a fallback modal). Flip to 'true' to force the
  // simulated/education engine (no PingOne call). NOTE: leave the explicit
  // `authorize_mode` UNSET so this flag drives the engine — an explicit
  // authorize_mode wins in resolveAuthorizeMode() and would ignore this flag.
  ff_authorize_simulated:      { public: true, default: 'false' },
  ff_authorize_rules_panel:    { public: true, default: 'true'  },
  // Scenario 1 — group-membership deny. OFF by default (no behavior change);
  // SE enables it for the "user not in group" demo. When on, the authorize
  // engines DENY a restricted tool unless the user is in its required group.
  ff_authorize_group_policy:   { public: true, default: 'false' },
  ff_hitl_enabled:             { public: true, default: 'true'  }, // require human approval for agent-initiated high-value transactions
  ff_tracing:                  { public: true, default: 'true'  }, // OTel→Jaeger tracing; reconciled by run-docker.sh demo-sync
  // Helix → LM Studio failover: when Helix returns a quota-exhausted reply, retry the turn on a local LM Studio model
  ff_helix_lmstudio_fallback:  { public: true, default: 'true'  },
  ff_knowledge_grounding:            { public: true, default: 'false' }, // knowledge grounding — inject deterministic assertions into agent system prompt with [Kn] citations
  lmstudio_base_url:           { public: true, default: 'http://localhost:1234/v1' },
  lmstudio_model:              { public: true, default: '' }, // empty → LM Studio uses its currently loaded model
  ff_rar:                          { public: true, default: 'false' }, // UC14: RFC 9396 RAR enforcement — bind agent tools to attested amount/payee from azd.authorization_details; default OFF
  ff_rar_gateway_enforcement:      { public: true, default: 'false' }, // UC14b: when ON, also arm the gateway's local requireRarIntent check; default OFF so PingOne Authorize (RarMaxAmount rule) is the sole RAR enforcement point
  ff_require_act_for_agent_tools: { public: true, default: 'true' }, // UC16: deny agent-mediated tool calls that carry no act claim (impersonation block); default ON — the act-based replacement for the removed may_act-based checks
  ff_a2a_delegation:       { public: true, default: 'false' }, // Enable agent-to-agent (A2A) specialist delegation — Investment Advisor (Agent 2) via chained RFC 8693 nested act; authorization decided by Authorize over the act chain (no may_act)
  ff_inject_audience:      { public: true, default: 'false' }, // BFF-add mcp_resource_uri to aud claim snapshot when absent (demo/dev — no PingOne change needed)
  ff_inject_scopes:        { public: true, default: 'false' }, // BFF-inject read write scopes when absent from user token (demo/dev — no PingOne change needed)
  ff_skip_token_exchange:  { public: true, default: 'false' }, // Skip RFC 8693 — pass user access token directly to MCP (demo mode; token exchange not required)
  ff_oidc_only_authorize:  { public: true, default: 'false' }, // Strip resource scopes from user /authorize — fixes multi-resource error when scopes are on a PingOne Resource Server
  mcp_use_legacy_protocol: { public: true, default: 'false' }, // When 'true', BFF uses protocolVersion 2024-11-05 in MCP initialize; default (false) = 2025-11-25
ff_heuristic_enabled:      { public: true, default: 'true'  }, // Fallback to Heuristics for known chips (true) vs LLM only (false)
  ff_prompt_injection_guard: { public: true, default: 'true'  }, // Block common prompt-injection patterns on NL/agent inputs
  ff_agent_results_panel:    { public: true, default: 'false' }, // Floating Results Panel in Banking Agent (off by default)
  ff_agui_enabled:           { public: true, default: 'true'  }, // AG-UI streaming agent via POST /api/agent/run
  ff_activity_narration:     { public: true, default: 'true'  }, // "What's happening" activity narration panel (always visible when on, no toggle)
  ff_agent_clinical_split:   { public: true, default: 'false' }, // 2B refined clinical-split dashboard layout (chat-left, audit-timeline-right) behind feature flag
  llm_framework:             { public: true, default: 'langchain' }, // Agent framework: langchain | openai_agents | mastra | pydantic_ai
  // Feature-flag registry IDs that were missing from FIELD_DEFS — without an
  // entry getEffective() can't resolve them and the env-override fallback below
  // never applies. defaults MUST match routes/featureFlags.js FLAG_REGISTRY.
  ff_authorize_mcp_first_tool:     { public: true, default: 'false' }, // Authorize first MCP tool call per session (DecisionContext=McpFirstTool)
  ff_vertical_tools_via_mcp:       { public: true, default: 'true' }, // Route vertical action tools (Slice 1: view_benefits) through the full MCP pipeline instead of in-process
  ff_id_token_exchange:            { public: true, default: 'false' }, // RFC 8693 with ID token as subject_token (agent never holds access token)
  ff_token_auth_private_key_jwt:   { public: true, default: 'false' }, // BFF authenticates to the PingOne token endpoint with a signed JWT assertion (private_key_jwt, RFC 7523) instead of client_secret
  mcp_use_pingone_server:          { public: true, default: 'false' }, // Route PingOne admin tools to the hosted PingOne MCP server (HTTP); bypass custom gateway
  mcp_inspector_pingone_live:      { public: true, default: 'true'  }, // PingOne MCP Inspector page queries the stdio server live (page-only; does NOT reroute agent calls)
  ff_show_agent_in_middle: { public: true, default: 'false' }, // Show banking column alongside centered agent (legacy dashboard layout)
  ff_customer_skin_ping2026: { public: true, default: 'false' }, // Customer dashboard new Ping2026 skin (component fork via DashboardContent). OFF by default — must match routes/featureFlags.js FLAG_REGISTRY (defaultValue:false); unfinished component, not for prod-on.
  ff_admin_skin_ping2026:    { public: true, default: 'true'  }, // Admin dashboard new Ping2026 skin — ON by default
  ff_use_cases_launcher:     { public: true, default: 'true'  }, // Use-Case Launcher page at /use-cases (A5)
  ff_error_classification_enabled: { public: true, default: 'true' }, // Comprehensive auth error classification + auto-retry transient errors
  ff_dpop:                   { public: true, default: 'false' }, // DPoP (Demonstration of Proof-of-Possession) for token requests (RFC 9449)
  ff_private_key_jwt_token_exchange: { public: true, default: 'false' }, // BFF authenticates to token endpoint with signed JWT (RFC 7523) instead of client_secret
  ff_rfc9470_challenge:      { public: true, default: 'true'  }, // RFC 9470 step-up challenge support in authorization
  hitl_consent_mfa_mode:     { public: true, default: 'onetime' }, // HITL consent MFA mode: 'onetime' (default) or 'multi' — affects challenge UX
  step_up_enabled:                 { public: true, default: 'false' }, // Step-up MFA gate; mirrored into runtimeSettings.stepUpEnabled (runtimeKey)
  ff_trat_mode:                    { public: true, default: 'true'  }, // Enrich RFC 8693 exchange with Transaction Token (TraT) claims — draft-oauth-transaction-tokens-for-agents-00
  mcp_step9_resource_uri:          { public: true, default: ''     }, // MCP server BANKING_API_RESOURCE_URI mirror — when set, Step 9 exchange event appears in token chain
  ff_agent_restrictions:           { public: true, default: 'false' }, // P1AZ resource server gate + AgentRestrictions attribute
  introspectionProvider:           { public: true, default: 'pinggateway' }, // Token introspection provider: 'pinggateway' (PingGateway/ForgeRock IG, default) or 'p1az' (PingOne Authorize, optional)
  ff_mcp_gateway_pinggateway:      { public: true, default: 'true' }, // Route MCP traffic through PingGateway (IG) instead of the Node gateway
  ff_mcp_gateway_jwks:             { public: true, default: 'false' }, // PingGateway validates MCP tokens locally (JWKS/HS256) instead of introspecting
  ff_enterprise_managed_mcp_auth:  { public: true, default: 'false' }, // MCP Enterprise-Managed Authorization — IT policy gate + RFC 8693 ID-JAG stand-in (Phase 1–2)
  enterprise_mcp_allowed_groups:    { public: true, default: 'banking-agents,employees' }, // Comma-separated PingOne group names or population IDs
  enterprise_mcp_resource_uris:    { public: true, default: '' }, // Optional override; defaults to scope-topology MCP resource URIs
  // URL of the PingGateway MCP endpoint — used when ff_mcp_gateway_pinggateway is true.
  mcp_pinggateway_url:             { public: true, default: 'https://api.ping.demo:3006' },
  // URL of the demo/Node MCP gateway — used when ff_mcp_gateway_pinggateway is false.
  // Kept separate from mcp_gateway_http_url/MCP_GATEWAY_HTTP_URL, which is baked
  // per-container in docker-compose.yml and can point at PingGateway instead (#375).
  mcp_demo_gateway_url:            { public: true, default: 'http://mcp-gateway:3005' },
  ff_admin_token_exchange:         { public: true, default: 'false' }, // Use token exchange for admin sessions (RFC 8693 with admin app as subject)
  ff_local_fallback_on_exchange_failure: { public: true, default: 'false' }, // Allow the BFF to run a tool through the LOCAL handler when RFC 8693 exchange fails — bypasses the gateway, the MCP server, and every authorization check
  ff_mcp_rate_limit:               { public: true, default: 'false' }, // UC18: per-agent/per-tool sliding-window rate limiting. Demo Agent Gateway: in-process (before P1AZ). PingOne Agent Gateway (IG): PingGateway uc18-rate-limit.groovy (429 before P1AZ; armed via X-UC18-Rate-Limit from BFF).
  ff_bedrock_agentcore_gateway:    { public: false, default: 'false' }, // EKS: route MCP via AgentCore Gateway (requires AWS_DEPLOYMENT=1)
  ff_bedrock_llm:                  { public: false, default: 'false' }, // EKS: Bedrock Converse LLM (requires AWS_DEPLOYMENT=1)
  // MCP Gateway passthrough mode — when true the gateway forwards MCP requests
  // directly to the MCP server without performing a downstream token exchange.
  // Consumed by demo_mcp_gateway/src/config.ts via process.env (gateway service);
  // registered here so the shared .env value is tracked in the config registry.
  mcp_gw_passthrough_to_mcp_server: { public: true, default: 'false' },

  // Dev-only TLS bypass for the gateway health probe and MCP WebSocket client.
  // When true AND NODE_ENV != 'production', skips TLS verification on wss:// and
  // the gateway /health probe. Production code hard-ignores this flag regardless
  // of the stored value. Set via GATEWAY_HEALTH_PROBE_INSECURE in .env.
  gateway_health_probe_insecure:        { public: true, default: 'false' },
  mcp_gateway_reject_unauthorized:      { public: true, default: 'true' },

  // Optional PingOne configuration check at server startup.
  // When true, validates resource servers (audience) and scopes against the
  // reference values in docs/PINGONE_CONFIG.md. Requires management worker
  // credentials (PINGONE_WORKER_CLIENT_ID / PINGONE_WORKER_CLIENT_SECRET).
  // Non-blocking — warnings only; never prevents startup.
  pingone_validate_on_startup:     { public: true, default: 'false' },

  // Token endpoint auth method overrides (configurable at runtime from Demo Data page)
  // Fallback: env vars AI_AGENT_TOKEN_ENDPOINT_AUTH_METHOD / MCP_EXCHANGER_TOKEN_ENDPOINT_AUTH_METHOD
  ai_agent_token_endpoint_auth_method:      { public: true, default: '' },
  mcp_exchanger_token_endpoint_auth_method: { public: true, default: '' },

  // Canonical single-exchange chain — AI Agent App is the ACTOR; the BFF's one
  // RFC 8693 exchange (user subject + AI Agent actor) is audienced to the MCP
  // Gateway. (PINGONE_RESOURCE_AGENT_GATEWAY_URI = the AI Agent actor-CC
  // audience.) The gateway re-exchanges downstream.
  PINGONE_AI_AGENT_ACTOR_CLIENT_ID:       { public: true,  default: '' }, // Demo AI Agent App client ID — the RFC 8693 actor
  // No defaults for audience URIs — an unconfigured audience must fail explicitly,
  // not silently use a stale fallback value that produces a confusing token error.
  PINGONE_RESOURCE_AGENT_GATEWAY_URI:     { public: true,  default: '' }, // AI Agent actor client-credentials audience — matches Demo Agent Gateway resource aud in PingOne
  PINGONE_RESOURCE_MCP_GATEWAY_URI:       { public: true,  default: '' }, // Single-exchange output audience (MCP Gateway) — matches Demo MCP Gateway resource aud in PingOne

  // RFC 8693 Token Exchange — MCP server resource URI
  // When set, the Backend-for-Frontend (BFF) exchanges user tokens for delegated tokens scoped to this
  // audience before forwarding to the MCP server (act claim identifies the Backend-for-Frontend (BFF)).
  PINGONE_RESOURCE_MCP_SERVER_URI:        { public: true,  default: '' },

  // RFC 8693 Token Exchange — langchain chat agent resource URI (Path A).
  // The BFF chat-WS proxy requests a token-exchange to this audience before
  // delivering the token to langchain in session_init. langchain validates
  // `aud` against this value (T-5: per-hop audience, no cascade).
  // No default: this resource server is not provisioned by bootstrap; must be
  // set explicitly via PINGONE_RESOURCE_LANGCHAIN_AGENT_URI in .env if used.
  PINGONE_RESOURCE_LANGCHAIN_AGENT_URI:   { public: true,  default: '' },

  // Demo Data — persistent demo accounts (JSON string, ignored for local LMDB)
  demo_accounts:              { public: false, default: '' },

  // Vertical — active demo vertical (banking, retail, workforce)
  active_vertical:            { public: true,  default: 'banking' },

  // Helix LLM Provider Configuration
  // Helix LLM Provider Configuration
  anthropic_api_key:          { public: false, default: '' },
  google_api_key:             { public: false, default: '' },
  helix_base_url:             { public: true,  default: 'https://openam-helix.forgeblocks.com' },
  helix_api_key:              { public: false, default: '' },
  helix_environment_id:       { public: true,  default: 'fe213c3c-9c1d-4bdb-954a-a22879dad26d' },
  helix_agent_id:             { public: true,  default: 'LLM' },
  // Which agent version conversations run: 'published' (default) or 'draft'.
  // Lets the demo run a staged driver fix when the Helix admin API exposes no
  // publish action (see helixLlmService.callHelixAgent).
  helix_agent_version:        { public: true,  default: '' },
  helix_prompt_field_id:      { public: true,  default: 'textInput502c5045a61c' },

  // CIBA — Client-Initiated Backchannel Authentication
  CIBA_ENABLED:               { public: true,  default: 'false' },
  CIBA_TOKEN_DELIVERY_MODE:   { public: true,  default: 'poll' },
  CIBA_BINDING_MESSAGE:       { public: true,  default: 'Banking App Authentication' },
  CIBA_NOTIFICATION_ENDPOINT: { public: true,  default: '' },
  CIBA_POLL_INTERVAL_MS:      { public: true,  default: '5000' },
  CIBA_AUTH_REQUEST_EXPIRY:   { public: true,  default: '300' },

  // Step-up authentication method for large transfers / withdrawals
  // 'ciba'  → back-channel (CIBA) challenge shown inline on the dashboard
  // 'email' → OIDC re-authentication redirect (PingOne email / OTP MFA)
  STEP_UP_METHOD: { public: true, default: 'email' },
  STEP_UP_AMOUNT_THRESHOLD: { public: true, default: 500 },
  /** Maximum allowed transaction amount (hard limit, all transaction types). Blocks anything over this. */
  MAX_TRANSACTION_AMOUNT: { public: true, default: 1000 },

  /** UI industry / white-label preset (client applies colors + logo). See banking_api_ui/src/config/industryPresets.js */
  UI_INDUSTRY_PRESET: { public: true, default: 'bx_finance' },

  /**
   * Space-separated OAuth scopes the demo presenter selects for the agent on the
   * Application Configuration page ("Agent MCP scopes"). Advisory/catalog config
   * only — it does NOT make an authorization decision in the BFF.
   *
   * Architecture-note R1 (2026-05-15) / T-2: the former local
   * `agentMcpScopePolicy` veto that consumed this value to block tool calls has
   * been removed. Whether an MCP tool call is permitted is decided solely by
   * PingAuthorize (`mcpToolAuthorizationService.evaluateMcpFirstToolGate`). To
   * demo a read-only agent (e.g. disable transfers), restrict the scopes in the
   * PingOne Authorize / token-exchange policy — not via this local key.
   */
  agent_mcp_allowed_scopes: {
    public: true,
    default:
      'read write accounts:read transactions:read transactions:write ai_agent',
  },

  // Multi-IDP: configurable OAuth endpoints — optional overrides for non-PingOne IDPs.
  // When empty, services fall back to computing PingOne URLs from environment_id + region.
  oauth_authorization_endpoint: { public: true,  default: '' },
  oauth_token_endpoint:          { public: true,  default: '' },
  oauth_userinfo_endpoint:       { public: true,  default: '' },
  oauth_jwks_uri:                { public: true,  default: '' },
  oauth_issuer:                  { public: true,  default: '' },
  oauth_discovery_endpoint:      { public: true,  default: '' },
  oauth_discovery_enabled:       { public: true,  default: 'false' },
  oauth_admin_callback_path:     { public: true,  default: '/api/auth/oauth/callback' },
  oauth_user_callback_path:      { public: true,  default: '/api/auth/oauth/user/callback' },
  // Role claim mapping — which token claim contains role/group info?
  oauth_role_claim_name:           { public: true,  default: 'population_id' },
  oauth_role_claim_value_admin:    { public: true,  default: '' },
  oauth_role_claim_value_customer: { public: true,  default: '' },
  oauth_role_claim_is_array:       { public: true,  default: 'false' },

  // UI / Demo experience toggles — saved and loaded by the config page
  show_education_panel:            { public: true, default: 'true' },
  enable_token_chain_display:      { public: true, default: 'true' },
  agent_ui_mode:                   { public: true, default: 'standard' },
  demo_scenario:                   { public: true, default: '' },
  industry_id:                     { public: true, default: 'bx_finance' },
  demo_account_count:              { public: true, default: '3' },
  transaction_preset:              { public: true, default: '' },
  max_token_chain_history:         { public: true, default: '50' },
  agent_history_limit:             { public: true, default: '10' },
  agent_transaction_count_limit:   { public: true, default: '3' },
  agent_transaction_value_limit:   { public: true, default: '5000' },
  agent_mode:                      { public: true, default: 'heuristics' },

  // Step-up / HITL thresholds (USD)
  confirm_threshold_usd:           { public: true, default: '250' },
  mfa_threshold_usd:               { public: true, default: '500' },
  step_up_amount_threshold:        { public: true, default: '500' },
  confirm_stepup_threshold_usd:    { public: true, default: '500' },

  // Debug / server logging
  log_level:                       { public: true, default: 'info' },
  debug_show_token_details:        { public: true, default: 'false' },
  debug_show_api_calls:            { public: true, default: 'false' },
  log_filter_categories:           { public: true, default: '' },

  // PingOne Authorize failover — what happens when the live policy engine is unreachable.
  // 'deny' (default): PingOne-ONLY — block all transactions with 503 (fail-closed).
  //   Combined with ff_authorize_simulated='false' this makes the steady-state
  //   engine strict 'pingone' (no mock fallback). Flip ff_authorize_simulated to
  //   'true' to use the simulated engine; set 'fallback_simulated' here to allow
  //   falling back to the mock on a genuine PingOne outage.
  // 'fallback_simulated': switch to in-process simulated engine (keeps demo running)
  // 'permit': allow all transactions with a warning log (fail-open — weakest)
  // Legacy: ff_authorize_fail_open=true is treated as authorize_failover_mode=permit.
  authorize_failover_mode: { public: true, default: 'deny' },

  // PingOne Authorize engine mode — single source of truth for which engine evaluates.
  // 'pingone'                    : real PingOne Authorize only (failover = deny)
  // 'simulated'                  : in-process simulated/demo engine only
  // 'pingone_fallback_simulated' : real PingOne, fall back to simulated when unreachable
  // DEFAULT 'pingone' — fail CLOSED. The same failoverMode that governs an outage
  // also governs the NOT-CONFIGURED path (transactionAuthorizationService.js:157,
  // mcpToolAuthorizationService.js:326): a 'pingone_fallback_simulated' default
  // makes a fresh/misconfigured install silently gate every request with the
  // in-process mock (engine:'simulated', no authorizeFallback modal) instead of a
  // loud 503 — the operator believes real PingOne Authorize is enforcing when it
  // never ran (P1AZ hardening amendment §B). Operators who want the demo to keep
  // running through a live P1AZ outage set 'pingone_fallback_simulated' explicitly;
  // the demo engine requires an explicit authorize_mode='simulated' (Admin Config /
  // Authorize page). See simulatedAuthorizeService.resolveAuthorizeMode().
  authorize_mode: { public: true, default: 'pingone' },

  // PingOne Authorize decision-endpoint IDs — canonical lowercase keys saved by
  // POST /api/authorize/bootstrap-demo-endpoints and the Admin Config UI, read
  // back via getEffective (the PINGONE_AUTHORIZE_*_ENDPOINT_ID env vars still
  // win through its env-fallback map). Without these entries setConfig silently
  // dropped the bootstrap route's patch while the route reported
  // configSaved:true, so the MCP first-tool gate failed closed (503) even after
  // a "successful" bootstrap.
  authorize_decision_endpoint_id:     { public: true, default: '' },
  authorize_mcp_decision_endpoint_id: { public: true, default: '' },

  // Simulated (mock) Authorize rules — override env vars at runtime
  SIMULATED_AUTHORIZE_CONFIRM_AMOUNT:    { public: true, default: '250' },
  SIMULATED_AUTHORIZE_DENY_AMOUNT:       { public: true, default: '2000' },
  SIMULATED_AUTHORIZE_STEPUP_AMOUNT:     { public: true, default: '500' },
  SIMULATED_MCP_DENY_TOOLS:              { public: true, default: '' },
  SIMULATED_MCP_HITL_TOOLS:              { public: true, default: '' },

  // Token audiences — resource URIs used in token requests and exchange
  enduser_audience:                      { public: true,  default: '' },
  ai_agent_audience:                     { public: true,  default: '' },
  ai_agent_scope:                        { public: true,  default: 'ai_agent' },
  banking_api_resource_uri:              { public: true,  default: '' },
  mcp_token_exchange_scopes:             { public: true,  default: 'read write mcp:invoke largepurchase:read records:read gear:read expense:read' },

  // Token exchange auth methods
  pingone_token_exchange_auth_method:    { public: true,  default: 'post' },
  pingone_mcp_token_exchanger_cc_auth_method: { public: true, default: 'post' },
  // private_key_jwt (RFC 7523) client authentication for the BFF/admin client.
  // Gated by ff_token_auth_private_key_jwt. Private key is encrypted at rest
  // (see SECRET_KEYS). kid is stamped into both the JWK and the assertion header.
  pingone_client_jwt_private_key:        { public: false, default: '' },
  pingone_client_jwt_kid:                { public: true,  default: '' },
  // Dedicated private_key_jwt app for RFC 8693 token exchange (PRIVATE_KEY_JWT client auth).
  // Gated by ff_private_key_jwt_token_exchange. Client ID and private key are encrypted
  // at rest (see SECRET_KEYS). kid is stamped into both the JWK and the assertion header.
  // When enabled, the BFF uses this app to exchange tokens instead of the main admin app.
  pingone_private_key_jwt_exchanger_client_id:    { public: true,  default: '' },
  pingone_private_key_jwt_exchanger_private_key:  { public: false, default: '' },
  pingone_private_key_jwt_exchanger_kid:          { public: true,  default: '' },
  // Actor-CC token scope for the MCP Exchanger app. MUST be a SINGLE
  // PingOne resource's scope: PingOne's CC token endpoint rejects a request
  // whose scopes span >1 resource ("invalid_scope: May not request scopes
  // for multiple resources"). Empty here meant "no scope param" → PingOne
  // defaulted to ALL the app's grants (which span 2 resources) → 502 on
  // every chip. mcp:invoke is the MCP/gateway resource scope the
  // actor token targets (matches the working [CC-As] actor mint).
  pingone_mcp_token_exchanger_client_scopes: { public: true, default: 'mcp:invoke' },

  // Introspection (RFC 7662)
  pingone_introspection_endpoint:        { public: true,  default: '' },
  pingone_introspection_client_id:       { public: true,  default: '' },
  pingone_introspection_client_secret:   { public: false, default: '' },
  pingone_introspection_auth_method:     { public: true,  default: 'post' },

  // Agent / MCP runtime flags
  use_agent_actor_for_mcp:               { public: true,  default: 'true' },
  token_exchange_auto_fallback:          { public: true,  default: 'true' },
  token_exchange_log_mode_switches:      { public: true,  default: 'true' },

  // Token validation / JWKS
  skip_token_signature_validation:       { public: true,  default: 'false' },
  strict_scope_validation:               { public: true,  default: 'false' },
  scope_validation_timeout:              { public: true,  default: '10000' },
  cache_token_validation:                { public: true,  default: 'true' },
  token_cache_ttl:                       { public: true,  default: '600' },
  jwks_requests_per_minute:              { public: true,  default: '30' },
  jwks_cache_max_age:                    { public: true,  default: '600000' },

  // Debug flags
  debug_scopes:                          { public: true,  default: 'false' },
  debug_tokens:                          { public: true,  default: 'false' },
  // Verbose OAuth logging — read by utils/oauthDebugFlags.isOAuthVerboseDebug()
  // and toggled on the /oauth-debug-logs page. Env alias DEBUG_OAUTH (see below).
  debug_oauth:                           { public: true,  default: 'false' },

  // Step-up
  step_up_acr_value:                     { public: true,  default: '' },

  // Frontend URLs
  frontend_dashboard_url:                { public: true,  default: '' },

  // Observability
  posthog_api_key:                       { public: false, default: '' },
  posthog_host:                          { public: true,  default: 'https://us.i.posthog.com' },

  // PingOne MCP stdio adapter
  pingone_mcp_environment_id:            { public: true,  default: '' },
  pingone_authorization_code_client_id:  { public: true,  default: '' },
  pingone_root_domain:                   { public: true,  default: 'pingone.com' },

  // Server
  port:                                  { public: true,  default: '3001' },
  default_user_type:                     { public: true,  default: 'customer' },

  // Demo credentials (local only)
  demo_username:                         { public: true,  default: '' },
  demo_password:                         { public: false, default: '' },
  demo_admin_username:                   { public: true,  default: '' },
  demo_admin_password:                   { public: false, default: '' },

  // MCP Gateway delegated-exchange app credentials
  mcp_gw_client_id:                      { public: true,  default: '' },
  mcp_gw_client_secret:                  { public: false, default: '' },
  mcp_gw_resource_uri:                   { public: true,  default: '' },
  mcp_gw_token_endpoint_auth_method:     { public: true,  default: '' },

  // Admin token lifetimes (seconds)
  admin_token_lifetime:                  { public: true,  default: '' },
  admin_refresh_token_lifetime:          { public: true,  default: '' },

  // Phase 266 — Path A demo: service API key the gateway swaps in (masked last-4 shown on info page)
  demo_apikey_backend_service_key:       { public: false, default: 'demo-api-key-0000' },

  // PingGateway vault bridge (/internal/vault/service-key) — shared secret the
  // apikey-dispatch.groovy handler injects as X-API-Key to demo_mortgage_service.
  // Must match MORTGAGE_SERVICE_API_KEY on that backend. Defaults keep the local
  // demo runnable when vault-migrate has not seeded these entries yet.
  demo_mortgage_service_key:             { public: false, default: 'demo-mortgage-key-0000' },
  demo_invest_service_key:               { public: false, default: 'demo-mortgage-key-0000' },

  // PingOne Recognize — biometric / device intelligence
  RECOGNIZE_API_KEY:    { public: false, default: '' },
  RECOGNIZE_TENANT_NAME: { public: true,  default: '' },

  // MCP Gateway token introspection credentials (GW_INTROSPECTION_*).
  // Consumed by demo_mcp_gateway/src/config.ts via process.env; registered here
  // so the shared .env coverage guard can verify they are reachable via configStore.
  gw_introspection_client_id:     { public: true,  default: '' },
  gw_introspection_client_secret: { public: false, default: '' },

  // Intent-based authorization — gate high-risk actions based on user intent confidence
  ff_intent_authorization_enabled: { public: true,  default: 'true' }, // Enable intent-based authorization checks
  intent_min_confidence:           { public: true,  default: '0.7' },  // Minimum confidence (0–1) required to authorize any intent
  intent_requires_consent:         { public: true,  default: 'transfer' },  // Comma-separated list of intents requiring HITL consent
  intent_max_amount_low_confidence: { public: true, default: '100' },  // USD: block transfers > this amount if confidence < intent_min_confidence

  // Intent token — cryptographically bind the original prompt intent for downstream MCP validation
  ff_intent_token_enabled: { public: true, default: 'true' }, // Mint intent JWT at prompt receipt; default on (opt-out)

  // Operator identity — used by bootstrap and management scripts, not at runtime.
  ping_email: { public: true, default: '' },
};

// ---------------------------------------------------------------------------
// Encryption helpers
// ---------------------------------------------------------------------------

let _encryptionKeyCache = null;

function _getEncryptionKey() {
  if (_encryptionKeyCache) return _encryptionKeyCache;
  const rawKey = process.env.CONFIG_ENCRYPTION_KEY || process.env.SESSION_SECRET || '';
  if (!rawKey) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        '[ConfigStore] FATAL: CONFIG_ENCRYPTION_KEY or SESSION_SECRET must be set in production. ' +
        'Refusing to start with an insecure fallback key.'
      );
    }
    console.error('[ConfigStore] CRITICAL: No CONFIG_ENCRYPTION_KEY or SESSION_SECRET set — using insecure dev fallback key. Set one of these env vars before deploying.');
  }
  const effectiveKey = rawKey || 'dev-fallback-key-do-not-use-in-production';
  _encryptionKeyCache = crypto.scryptSync(effectiveKey, 'banking-config-salt-v1', 32);
  return _encryptionKeyCache;
}

function _encrypt(plaintext) {
  try {
    const key = _getEncryptionKey();
    const iv  = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, tag, encrypted]).toString('base64');
  } catch (err) {
    throw new Error(`Config encryption failed: ${err.message}`, { cause: err });
  }
}

function _decrypt(ciphertext) {
  try {
    const key  = _getEncryptionKey();
    const data = Buffer.from(ciphertext, 'base64');
    const iv   = data.subarray(0, 12);
    const tag  = data.subarray(12, 28);
    const enc  = data.subarray(28);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
  } catch (err) {
    // Corrupted or mis-keyed ciphertext — likely a key rotation or env mismatch.
    // Return '' so the field shows as "not set", but warn so operators can diagnose.
    console.warn('[ConfigStore] Decryption failed — possible key mismatch or key rotation. Re-enter the affected credential in the admin UI.', err.message);
    return '';
  }
}

// ---------------------------------------------------------------------------
// LMDB helpers
// ---------------------------------------------------------------------------

const _lmdbConfig = require('./lmdb/configStore.lmdb');

// ---------------------------------------------------------------------------
// ConfigStore class
// ---------------------------------------------------------------------------

class ConfigStore {
  constructor() {
    /** @type {Record<string, string>} plaintext in-memory cache */
    this._cache = {};
    /** @type {Record<string, 'vault'|'sqlite'>} which tier set each cache key */
    this._provenance = {};
    this._envReconcileVerdict = null;
    this.lastEnvReconcile = null;
    this._initPromise = null;
  }

  /**
   * Write into the in-memory cache with tier provenance.
   * Vault (persist:false at startup) outranks LMDB: once a key is
   * vault-owned, a later LMDB write updates the stored cache value but
   * MUST NOT change provenance, and getEffective() prefers the vault value.
   *
   * @param {Record<string,string>} data
   * @param {'vault'|'sqlite'} tier
   */
  _setCache(data, tier) {
    for (const [k, v] of Object.entries(data)) {
      const key = String(k).toUpperCase();
      const owner = this._provenance[key];
      if (owner === 'vault' && tier === 'sqlite') {
        // Vault already owns this key — keep the vault value authoritative.
        // (We deliberately do NOT overwrite this._cache[key] here so a later
        //  vault re-unlock isn't needed to "win"; the vault value stays put.)
        continue;
      }
      this._cache[key] = v;
      this._provenance[key] = tier;
    }
  }

  /**
   * Ensure the store is loaded before use.
   * Safe to call multiple times — only initialises once.
   */
  ensureInitialized() {
    if (!this._initPromise) {
      this._initPromise = this._initialize().catch((err) => {
        console.error('[ConfigStore] initialization error:', err.message);
        this._initPromise = null; // allow retry
      });
    }
    return this._initPromise;
  }

  async _initialize() {
    try {
      this._loadFromLmdb();
    } catch (err) {
      console.warn('[ConfigStore] LMDB initialization failed, using in-memory fallback:', err.message);
    }
    try {
      this._reconcileEnvId();
    } catch (err) {
      console.warn('[ConfigStore] env-id reconcile failed (non-fatal):', err.message);
    }
    try {
      // Load deployment URLs from scope-topology.json (OAuth public URLs + redirect URIs).
      // These are sourced from scope-topology.json's deployment section, not .env,
      // to keep OAuth topology centralized. They can still be overridden via .env (bootstrap-like behavior).
      const deploymentUrls = getDeploymentUrls();
      if (Object.keys(deploymentUrls).length > 0) {
        this._setCache(deploymentUrls, 'sqlite');
        console.log(`[ConfigStore] Loaded ${Object.keys(deploymentUrls).length} deployment URLs from scope-topology.json`);
      }
    } catch (err) {
      console.warn('[ConfigStore] deployment URL loading failed (non-fatal):', err.message);
    }
    try {
      this._seedFromEnv();
    } catch (err) {
      console.warn('[ConfigStore] env-to-LMDB seed failed (non-fatal):', err.message);
    }
  }

  /**
   * Write every FIELD_DEFS key whose env var has a value but LMDB does not.
   * Safe to call repeatedly — only fills gaps, never overwrites existing LMDB rows.
   * BOOTSTRAP_ALLOWLIST keys are skipped (env is always authoritative for them).
   *
   * Synchronous by design: called from _initialize() without going through
   * ensureInitialized() to avoid re-entrant deadlock on the init promise.
   */
  _seedFromEnv() {
    const updates = {};
    const cacheUpdates = {};

    for (const fieldKey of Object.keys(FIELD_DEFS)) {
      const lk = fieldKey.toLowerCase();
      if (BOOTSTRAP_ALLOWLIST.has(lk)) continue;
      if (this.get(fieldKey)) continue;
      const val = this.getEffective(lk);
      const def = FIELD_DEFS[fieldKey]?.default;
      if (!val || val === String(def)) continue;
      updates[fieldKey]      = SECRET_KEYS.has(String(fieldKey).toUpperCase()) ? _encrypt(val) : val;
      cacheUpdates[fieldKey] = val;
    }

    if (Object.keys(updates).length === 0) return;

    console.log(`[ConfigStore] Seeding ${Object.keys(updates).length} keys from env into LMDB`);
    try {
      for (const [key, value] of Object.entries(updates)) {
        _lmdbConfig.upsert(String(key).toUpperCase(), value);
      }
    } catch (err) {
      console.warn('[ConfigStore] LMDB seed write failed:', err.message);
    }
    this._setCache(cacheUpdates, 'sqlite');
  }

  _loadFromLmdb() {
    const rows = _lmdbConfig.loadAll();
    const decoded = {};
    for (const row of rows) {
      // Bootstrap keys: load into cache so they can serve as a fallback when
      // .env is absent. getEffective() still consults process.env first for
      // these keys, so .env always wins when set. See REGRESSION_PLAN §4.
      decoded[row.key] = SECRET_KEYS.has(String(row.key).toUpperCase()) ? _decrypt(row.value) : row.value;
    }
    this._setCache(decoded, 'sqlite');
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Synchronous cache lookup.  Returns null if not set.
   * Always call ensureInitialized() before the first get().
   */
  get(key) {
    const upper = String(key).toUpperCase();
    const v = this._cache[upper];
    if (v !== undefined && v !== '') return v;
    // Transparent env-var fallback: if nothing is cached, return the exact
    // matching process.env entry (same key, uppercased). This prevents callers
    // that use .get('SOME_ENV_KEY') from silently returning null when the value
    // lives in .env but hasn't been loaded into the LMDB cache yet — the class
    // of bug that caused P1AZ "worker credentials not configured" warnings even
    // though PINGONE_WORKER_CLIENT_ID was present in .env.
    const envVal = process.env[upper];
    return (envVal !== undefined && envVal !== '') ? envVal : null;
  }

  /**
   * Persist new configuration values.
   * Accepts partial updates — only sets keys that are provided and non-empty.
   * Secrets are encrypted before writing to storage.
   */
  async setConfig(data) {
    await this.ensureInitialized();

    // Validate DEMO_ACCOUNTS if present
    if (data.demo_accounts) {
      try {
        JSON.parse(data.demo_accounts);
      } catch {
        throw new Error('DEMO_ACCOUNTS must be valid JSON string');
      }
    }

    const updates = {};        // what goes into storage (encrypted secrets)
    const cacheUpdates = {};   // what goes into the in-memory cache (plaintext)

    const allowEmptyStringKeys = new Set(['marketing_demo_username_hint', 'marketing_demo_password_hint', 'demo_accounts']);
    for (const [key, value] of Object.entries(data)) {
      if (!(key in FIELD_DEFS)) continue;          // ignore unknown keys
      // Bootstrap keys: skip only when .env is already providing the value —
      // allow the write when .env is absent so Config UI can supply a fallback.
      if (BOOTSTRAP_ALLOWLIST.has(String(key).toLowerCase()) && process.env[String(key).toUpperCase()]) continue;
      if (value === null || value === undefined) continue;
      if (value === '' && !allowEmptyStringKeys.has(key)) continue;
      // Value is a non-empty string
      const stored = SECRET_KEYS.has(String(key).toUpperCase()) ? _encrypt(value) : value;
      updates[key]      = stored;
      cacheUpdates[key] = value;
    }

    if (Object.keys(updates).length === 0) return;

    try {
      for (const [key, value] of Object.entries(updates)) {
        _lmdbConfig.upsert(String(key).toUpperCase(), value);
      }
    } catch (err) {
      console.warn('[ConfigStore] LMDB write failed, config will be in-memory only:', err.message);
    }

    this._setCache(cacheUpdates, 'sqlite');
  }

  /**
   * Persist arbitrary key-value pairs to LMDB and cache without FIELD_DEFS validation.
   * Used by feature flags, which have their own flag-ID namespace (not in FIELD_DEFS).
   *
   * opts.persist (boolean, default true) — when explicitly false,
   * skip the LMDB write and update only the in-memory cache. The vault
   * loader uses this so secrets never get duplicated at rest
   * (the vault is already the encrypted-at-rest source of truth).
   */
  async setRaw(data, opts = {}) {
    await this.ensureInitialized();
    // Strict boolean check — catch typos like {persist:'no'} or {persist:1}
    if (opts.persist !== undefined && typeof opts.persist !== 'boolean') {
      throw new Error(`ConfigStore.setRaw: opts.persist must be boolean, got ${typeof opts.persist}`);
    }
    const shouldPersist = opts.persist !== false;
    if (shouldPersist) {
      try {
        for (const [key, value] of Object.entries(data)) {
          // Skip bootstrap keys only when .env is already providing the value.
          if (BOOTSTRAP_ALLOWLIST.has(String(key).toLowerCase()) && process.env[String(key).toUpperCase()]) continue;
          _lmdbConfig.upsert(String(key).toUpperCase(), String(value));
        }
      } catch (err) {
        console.warn('[ConfigStore] LMDB write failed, raw config will be in-memory only:', err.message);
      }
    }
    // Update cache regardless of LMDB outcome (or skip).
    // persist:false is the vault loader's path → provenance 'vault';
    // persist:true (or default) is an LMDB-backed write → 'sqlite' provenance (internal tier label).
    this._setCache(data, shouldPersist ? 'sqlite' : 'vault');
  }

  /**
   * Delete one or more keys from both cache and LMDB storage.
   * Used at startup to clear stale values that would override env vars.
   */
  deleteRaw(key) {
    const upper = String(key).toUpperCase();
    delete this._cache[upper];
    delete this._provenance[upper];
    try {
      _lmdbConfig.remove(upper);
    } catch (err) {
      console.warn('[ConfigStore] LMDB delete failed for key:', upper, err.message);
    }
  }

  /**
   * Returns the full stored config with secrets replaced by '••••••••'.
   * Also includes a `<key>_set` boolean for each secret field.
   * Public fields are returned as-is.
   */
  getMasked() {
    const result = {};
    for (const key of Object.keys(FIELD_DEFS)) {
      if (SECRET_KEYS.has(String(key).toUpperCase())) {
        const isSet = String(this.getEffective(key) || '').trim() !== '';
        result[key] = isSet ? '••••••••' : '';
        result[`${key}_set`] = isSet;
      } else {
        result[key] = this.getEffective(key) || '';
      }
    }
    return result;
  }

  /**
   * Returns the effective value for a key:
   * - With persisted store (LMDB): cache first, then env fallbacks, then default.
   * - Without persistence: env vars only (no runtime persistence).
   * This is what config/oauth.js getters call.
   *
   * Keys are normalized to lowercase internally, so callers may pass either
   * 'pingone_environment_id' or 'PINGONE_ENVIRONMENT_ID' — both work.
   */
  getEffective(key) {
    // Normalize to lowercase so callers don't need to worry about case
    key = String(key).toLowerCase();
    // Env-var fallback map (PINGONE_CORE_* / PINGONE_AI_CORE_* / PINGONE_ADMIN_* all refer to the same PingOne apps)
    // NOTE: env vars always take priority — over LMDB and committed defaults.
    // This ensures env vars override anything saved in the Config UI.
    const envFallbackMap = {
      pingone_environment_id: ['PINGONE_ENVIRONMENT_ID'],
      pingone_region:         ['PINGONE_REGION'],
      pingone_base_url:       ['PINGONE_BASE_URL'],
      admin_client_id:        [
        'PINGONE_AI_CORE_CLIENT_ID',
        'PINGONE_CORE_CLIENT_ID',
        'PINGONE_ADMIN_CLIENT_ID',
        'VITE_PINGONE_CLIENT_ID',
      ],
      admin_client_secret:    [
        'PINGONE_AI_CORE_CLIENT_SECRET',
        'PINGONE_CORE_CLIENT_SECRET',
        'PINGONE_ADMIN_CLIENT_SECRET',
        'VITE_PINGONE_CLIENT_SECRET',
      ],
      admin_redirect_uri:     [
        'PINGONE_AI_CORE_REDIRECT_URI',
        'PINGONE_CORE_REDIRECT_URI',
        'PINGONE_ADMIN_REDIRECT_URI',
      ],
      admin_token_endpoint_auth_method: [
        'PINGONE_ADMIN_TOKEN_ENDPOINT_AUTH',
        'ADMIN_TOKEN_ENDPOINT_AUTH',
      ],
      pingone_admin_token_endpoint_auth: ['PINGONE_ADMIN_TOKEN_ENDPOINT_AUTH', 'ADMIN_TOKEN_ENDPOINT_AUTH'],
      user_client_id:         [
        'PINGONE_AI_CORE_USER_CLIENT_ID',
        'PINGONE_CORE_USER_CLIENT_ID',
        'PINGONE_USER_CLIENT_ID',
        'VITE_PINGONE_CLIENT_ID',
      ],
      user_client_secret:     [
        'PINGONE_AI_CORE_USER_CLIENT_SECRET',
        'PINGONE_CORE_USER_CLIENT_SECRET',
        'PINGONE_USER_CLIENT_SECRET',
        'VITE_PINGONE_CLIENT_SECRET',
      ],
      user_redirect_uri:      [
        'PINGONE_AI_CORE_USER_REDIRECT_URI',
        'PINGONE_CORE_USER_REDIRECT_URI',
        'PINGONE_USER_REDIRECT_URI',
      ],
      // SDK centralized-login demo (public PKCE SPA client) — see FIELD_DEFS above.
      pingone_sdk_demo_client_id:    ['PINGONE_SDK_DEMO_CLIENT_ID'],
      pingone_sdk_demo_redirect_uri: ['PINGONE_SDK_DEMO_REDIRECT_URI'],
      pingone_sdk_demo_scope:        ['PINGONE_SDK_DEMO_SCOPE'],
      pingone_client_id:     ['PINGONE_MANAGEMENT_CLIENT_ID', 'PINGONE_CIMD_CLIENT_ID', 'PINGONE_ADMIN_CLIENT_ID', 'PINGONE_WORKER_TOKEN_CLIENT_ID', 'PINGONE_WORKER_CLIENT_ID'],
      pingone_client_secret: ['PINGONE_MANAGEMENT_CLIENT_SECRET', 'PINGONE_CIMD_CLIENT_SECRET', 'PINGONE_ADMIN_CLIENT_SECRET', 'PINGONE_WORKER_TOKEN_CLIENT_SECRET', 'PINGONE_WORKER_CLIENT_SECRET'],
      pingone_mgmt_client_id:          ['PINGONE_MGMT_CLIENT_ID', 'PINGONE_MANAGEMENT_CLIENT_ID', 'PINGONE_ADMIN_CLIENT_ID', 'PINGONE_WORKER_TOKEN_CLIENT_ID', 'PINGONE_WORKER_CLIENT_ID'],
      pingone_mgmt_client_secret:      ['PINGONE_MGMT_CLIENT_SECRET', 'PINGONE_MANAGEMENT_CLIENT_SECRET', 'PINGONE_ADMIN_CLIENT_SECRET', 'PINGONE_WORKER_TOKEN_CLIENT_SECRET', 'PINGONE_WORKER_CLIENT_SECRET'],
      // Do NOT alias PINGONE_ADMIN_TOKEN_ENDPOINT_AUTH here: that is the ADMIN login client's
      // auth method (commonly client_secret_post), whereas the worker/management app uses
      // client_secret_basic. Cross-wiring them made the worker token request 401 and silently
      // no-op'd persona role hardening at boot. The admin client reads admin_token_endpoint_auth_method.
      pingone_mgmt_token_auth_method:  ['PINGONE_MGMT_TOKEN_AUTH_METHOD', 'PINGONE_WORKER_TOKEN_AUTH_METHOD'],
      admin_pingone_authorize_pi_flow: ['PINGONE_ADMIN_AUTHORIZE_PI_FLOW'],
      user_pingone_authorize_pi_flow:  ['PINGONE_USER_AUTHORIZE_PI_FLOW'],
      admin_role:             ['ADMIN_ROLE'],
      user_role:              ['USER_ROLE'],
      admin_username:         ['ADMIN_USERNAME'],
      admin_population_id:    ['ADMIN_POPULATION_ID'],
      admin_role_claim:       ['ADMIN_ROLE_CLAIM'],
      session_secret:         ['SESSION_SECRET'],
      // Shared secret for BFF <-> MCP Gateway internal calls (x-internal-gateway-secret).
      // Read directly via process.env in agentReasoningClient.js / routes/agentIdToken.js
      // / server.js; mapped here so the env-coverage guard sees it resolve.
      bff_internal_secret:    ['BFF_INTERNAL_SECRET'],
      // Shared secret for BFF <-> HITL service internal calls (X-HITL-Internal-Secret).
      // Read directly via process.env in services/hitlServiceClient.js; mapped here so
      // the env-coverage guard sees it resolve (same pattern as bff_internal_secret).
      hitl_internal_secret:   ['HITL_INTERNAL_SECRET'],
      frontend_url:           ['REACT_APP_CLIENT_URL', 'FRONTEND_ADMIN_URL'],
      frontend_admin_url:     ['FRONTEND_ADMIN_URL', 'REACT_APP_CLIENT_URL'],
      react_app_client_url:   ['REACT_APP_CLIENT_URL', 'FRONTEND_ADMIN_URL'],
      public_app_url:         ['PUBLIC_APP_URL'],
      mcp_server_url:                   ['MCP_SERVER_URL'],
      // MCP_SERVER_RESOURCE_URI is the authoritative env var for the MCP server audience.
      // MCP_RESOURCE_URI is kept as a fallback AFTER MCP_SERVER_RESOURCE_URI so that
      // MCP_RESOURCE_URI=mcpgateway.ping.demo (gateway audience) does not shadow the
      // MCP server audience when both are set. PINGONE_RESOURCE_MCP_SERVER_URI wins first.
      pingone_resource_mcp_server_uri:  ['PINGONE_RESOURCE_MCP_SERVER_URI', 'MCP_SERVER_RESOURCE_URI', 'MCP_RESOURCE_URI'],
      // Alias of the line above for Token Chain / mcpInspector callers that use 'mcp_resource_uri'.
      // MCP_SERVER_RESOURCE_URI before MCP_RESOURCE_URI — same priority fix as above.
      mcp_resource_uri:                 ['PINGONE_RESOURCE_MCP_SERVER_URI', 'MCP_SERVER_RESOURCE_URI', 'MCP_RESOURCE_URI'],
      // Direct alias so getEffective('pingone_user_client_id') and getEffective('PINGONE_USER_CLIENT_ID') both work.
      pingone_user_client_id:           ['PINGONE_USER_CLIENT_ID', 'PINGONE_AI_CORE_USER_CLIENT_ID', 'PINGONE_CORE_USER_CLIENT_ID'],
      // Direct alias so getEffective('pingone_admin_client_id') and getEffective('PINGONE_ADMIN_CLIENT_ID') both work.
      pingone_admin_client_id:          ['PINGONE_ADMIN_CLIENT_ID', 'PINGONE_AI_CORE_CLIENT_ID', 'PINGONE_CORE_CLIENT_ID'],
      pingone_resource_langchain_agent_uri: ['PINGONE_RESOURCE_LANGCHAIN_AGENT_URI'],
      authorize_decision_endpoint_id:   ['PINGONE_AUTHORIZE_DECISION_ENDPOINT_ID'],
      authorize_failover_mode:          ['PINGONE_AUTHORIZE_FAILOVER_MODE'],
      authorize_mode:                   ['AUTHORIZE_MODE', 'PINGONE_AUTHORIZE_MODE'],
      authorize_mcp_decision_endpoint_id: ['PINGONE_AUTHORIZE_MCP_DECISION_ENDPOINT_ID'],
      debug_oauth:                      ['DEBUG_OAUTH'],
      ciba_enabled:           ['CIBA_ENABLED'],
      step_up_method:         ['STEP_UP_METHOD'],
      step_up_amount_threshold: ['STEP_UP_AMOUNT_THRESHOLD'],
      confirm_threshold_usd:    ['CONFIRM_THRESHOLD_USD', 'STEP_UP_AMOUNT_THRESHOLD'],
      mfa_threshold_usd:        ['MFA_THRESHOLD_USD'],
      pingone_mfa_policy_id:  ['PINGONE_MFA_POLICY_ID'],
      agent_mcp_allowed_scopes: ['AGENT_MCP_ALLOWED_SCOPES'],
      ff_heuristic_enabled:            ['FF_HEURISTIC_ENABLED'],
      ff_prompt_injection_guard:       ['FF_PROMPT_INJECTION_GUARD'],
      ff_a2a_delegation:               ['FF_A2A_DELEGATION'],
      ff_mcp_gateway_pinggateway:      ['FF_MCP_GATEWAY_PINGGATEWAY'],
      ff_mcp_gateway_jwks:             ['FF_MCP_GATEWAY_JWKS'],
      ff_local_fallback_on_exchange_failure: ['FF_LOCAL_FALLBACK_ON_EXCHANGE_FAILURE'],
      ff_bedrock_agentcore_gateway:    ['FF_BEDROCK_AGENTCORE_GATEWAY'],
      ff_bedrock_llm:                  ['FF_BEDROCK_LLM'],
      pingone_resource_pinggateway_uri: ['PINGONE_RESOURCE_PINGGATEWAY_URI'],
      ff_authorize_simulated:          ['FF_AUTHORIZE_SIMULATED'],
      pingone_ai_agent_client_id:       ['PINGONE_AI_AGENT_ACTOR_CLIENT_ID', 'PINGONE_AI_AGENT_CLIENT_ID', 'AI_AGENT_CLIENT_ID', 'AGENT_CLIENT_ID'],
      pingone_ai_agent_client_secret:    ['PINGONE_AI_AGENT_ACTOR_CLIENT_SECRET', 'PINGONE_AI_AGENT_CLIENT_SECRET', 'AI_AGENT_CLIENT_SECRET', 'AGENT_CLIENT_SECRET'],
      // Direct aliases for the renamed env vars so getEffective(lowercased-new-name) works.
      pingone_ai_agent_actor_client_id:      ['PINGONE_AI_AGENT_ACTOR_CLIENT_ID', 'PINGONE_AI_AGENT_CLIENT_ID', 'AI_AGENT_CLIENT_ID'],
      pingone_ai_agent_actor_client_secret:  ['PINGONE_AI_AGENT_ACTOR_CLIENT_SECRET', 'PINGONE_AI_AGENT_CLIENT_SECRET', 'AI_AGENT_CLIENT_SECRET'],
      pingone_token_exchanger_client_id:     ['PINGONE_TOKEN_EXCHANGER_CLIENT_ID', 'PINGONE_MCP_TOKEN_EXCHANGER_CLIENT_ID', 'PINGONE_MCP_EXCHANGER_CLIENT_ID', 'AGENT_OAUTH_CLIENT_ID'],
      pingone_token_exchanger_client_secret: ['PINGONE_TOKEN_EXCHANGER_CLIENT_SECRET', 'PINGONE_MCP_TOKEN_EXCHANGER_CLIENT_SECRET', 'PINGONE_MCP_EXCHANGER_CLIENT_SECRET', 'AGENT_OAUTH_CLIENT_SECRET'],
      pingone_mcp_gateway_client_id:         ['PINGONE_MCP_GATEWAY_CLIENT_ID', 'MCP_GW_CLIENT_ID'],
      pingone_mcp_gateway_client_secret:     ['PINGONE_MCP_GATEWAY_CLIENT_SECRET', 'MCP_GW_CLIENT_SECRET'],
      pingone_worker_client_id:                    ['PINGONE_AUTHORIZE_WORKER_CLIENT_ID', 'PINGONE_WORKER_CLIENT_ID'],
      pingone_mcp_token_exchanger_client_id:     ['PINGONE_TOKEN_EXCHANGER_CLIENT_ID', 'PINGONE_MCP_TOKEN_EXCHANGER_CLIENT_ID', 'PINGONE_MCP_EXCHANGER_CLIENT_ID', 'AGENT_OAUTH_CLIENT_ID'],
      pingone_mcp_token_exchanger_client_secret: ['PINGONE_TOKEN_EXCHANGER_CLIENT_SECRET', 'PINGONE_MCP_TOKEN_EXCHANGER_CLIENT_SECRET', 'PINGONE_MCP_EXCHANGER_CLIENT_SECRET', 'AGENT_OAUTH_CLIENT_SECRET'],
      pingone_mcp_token_exchanger_client_scopes: ['PINGONE_MCP_TOKEN_EXCHANGER_CLIENT_SCOPES', 'AGENT_OAUTH_CLIENT_SCOPES'],
      pingone_resource_agent_gateway_uri: ['PINGONE_RESOURCE_AGENT_GATEWAY_URI', 'AGENT_GATEWAY_AUDIENCE'],
      agent_gateway_audience:             ['AGENT_GATEWAY_AUDIENCE', 'PINGONE_RESOURCE_AGENT_GATEWAY_URI'],
      // A2A (agent-to-agent): per-vertical specialist (Agent 2) credentials + intermediate audience.
      pingone_investment_agent_client_id:     ['PINGONE_A2A_INVESTMENT_AGENT_CLIENT_ID', 'PINGONE_INVESTMENT_AGENT_CLIENT_ID'],
      pingone_investment_agent_client_secret: ['PINGONE_A2A_INVESTMENT_AGENT_CLIENT_SECRET', 'PINGONE_INVESTMENT_AGENT_CLIENT_SECRET'],
      pingone_records_agent_client_id:        ['PINGONE_A2A_RECORDS_AGENT_CLIENT_ID'],
      pingone_records_agent_client_secret:    ['PINGONE_A2A_RECORDS_AGENT_CLIENT_SECRET'],
      pingone_purchase_agent_client_id:       ['PINGONE_A2A_PURCHASE_AGENT_CLIENT_ID'],
      pingone_purchase_agent_client_secret:   ['PINGONE_A2A_PURCHASE_AGENT_CLIENT_SECRET'],
      pingone_membership_agent_client_id:     ['PINGONE_A2A_MEMBERSHIP_AGENT_CLIENT_ID'],
      pingone_membership_agent_client_secret: ['PINGONE_A2A_MEMBERSHIP_AGENT_CLIENT_SECRET'],
      pingone_payroll_agent_client_id:        ['PINGONE_A2A_PAYROLL_AGENT_CLIENT_ID'],
      pingone_payroll_agent_client_secret:    ['PINGONE_A2A_PAYROLL_AGENT_CLIENT_SECRET'],
      // Per-specialist A2A intermediate audiences (RFC 8707 — one resource per
      // specialist, not one shared across all of them; see a2aSpecialists.js).
      a2a_intermediate_audience_investment:   ['A2A_INTERMEDIATE_AUDIENCE_INVESTMENT'],
      a2a_intermediate_audience_records:      ['A2A_INTERMEDIATE_AUDIENCE_RECORDS'],
      a2a_intermediate_audience_purchase:     ['A2A_INTERMEDIATE_AUDIENCE_PURCHASE'],
      a2a_intermediate_audience_membership:   ['A2A_INTERMEDIATE_AUDIENCE_MEMBERSHIP'],
      a2a_intermediate_audience_payroll:      ['A2A_INTERMEDIATE_AUDIENCE_PAYROLL'],
      a2a_intermediate_audience_tax:          ['A2A_INTERMEDIATE_AUDIENCE_TAX'],
      a2a_intermediate_audience_finaid:       ['A2A_INTERMEDIATE_AUDIENCE_FINAID'],
      a2a_intermediate_audience_supplier:     ['A2A_INTERMEDIATE_AUDIENCE_SUPPLIER'],
      // A2A specialists' Exchange #2 (final) destination — separate from
      // pingone_resource_mcp_gateway_uri so its nested-act composer SPEL never
      // touches the non-A2A two-exchange flow (see pingoneProvisionService.js
      // Step 37a-A2A).
      a2a_gateway_audience:                   ['A2A_GATEWAY_AUDIENCE'],
      pingone_resource_a2a_intermediate_uri:  ['PINGONE_RESOURCE_A2A_INTERMEDIATE_URI', 'A2A_INTERMEDIATE_AUDIENCE'],
      a2a_intermediate_audience:              ['A2A_INTERMEDIATE_AUDIENCE', 'PINGONE_RESOURCE_A2A_INTERMEDIATE_URI'],
      a2a_intermediate_scope:                 ['A2A_INTERMEDIATE_SCOPE'],
      a2a_invest_scope:                       ['A2A_INVEST_SCOPE'],
      // Two-exchange audiences: intermediate (Exchange #1 result) and final (Exchange #2 result).
      // Fall back to PINGONE_RESOURCE_AGENT_GATEWAY_URI / MCP_RESOURCE_URI when the explicit
      // vars are absent — keeps single-resource deployments working without extra env config.
      ai_agent_intermediate_audience:     ['AI_AGENT_INTERMEDIATE_AUDIENCE', 'PINGONE_RESOURCE_AGENT_GATEWAY_URI'],
      pingone_resource_two_exchange_uri:  ['PINGONE_RESOURCE_TWO_EXCHANGE_URI', 'MCP_RESOURCE_URI', 'PINGONE_RESOURCE_MCP_SERVER_URI'],
      pingone_resource_mcp_gateway_uri: ['PINGONE_RESOURCE_MCP_GATEWAY_URI', 'MCP_GATEWAY_AUDIENCE', 'MCP_GW_RESOURCE_URI'],
      // MCP Gateway delegated-exchange app credentials (direct MCP_GW_* names —
      // previously only read via direct process.env in gateway token glue)
      mcp_gw_client_id:                 ['PINGONE_MCP_GATEWAY_CLIENT_ID', 'MCP_GW_CLIENT_ID'],
      mcp_gw_client_secret:             ['PINGONE_MCP_GATEWAY_CLIENT_SECRET', 'MCP_GW_CLIENT_SECRET'],
      mcp_gw_resource_uri:              ['MCP_GW_RESOURCE_URI', 'PINGONE_RESOURCE_MCP_GATEWAY_URI'],
      mcp_gw_token_endpoint_auth_method:      ['MCP_GW_TOKEN_ENDPOINT_AUTH_METHOD'],
      mcp_gw_passthrough_to_mcp_server:       ['MCP_GW_PASSTHROUGH_TO_MCP_SERVER'],
      gateway_health_probe_insecure:           ['GATEWAY_HEALTH_PROBE_INSECURE'],
      mcp_gateway_reject_unauthorized:         ['MCP_GATEWAY_REJECT_UNAUTHORIZED'],
      pingone_validate_on_startup:             ['PINGONE_VALIDATE_ON_STARTUP'],
      // RFC 8707: single-resource scope for the actor client-credentials token
      // used in the BFF's single subject+actor RFC 8693 exchange. MUST stay in
      // sync with pingoneProvisionService.js grants — the AI Agent / MCP
      // Exchanger apps are granted scopes on >1 resource, so the CC request
      // needs an explicit single-resource scope or PingOne rejects with
      // invalid_scope: "May not request scopes for multiple resources".
      agent_gateway_cc_scope: ['AGENT_GATEWAY_CC_SCOPE'],
      two_exchange_intermediate_scope: ['TWO_EXCHANGE_INTERMEDIATE_SCOPE'],
      mcp_gateway_cc_scope:   ['MCP_GATEWAY_CC_SCOPE'],
      marketing_customer_login_mode: ['MARKETING_CUSTOMER_LOGIN_MODE'],
      marketing_demo_username_hint: ['MARKETING_DEMO_USERNAME_HINT'],
      marketing_demo_password_hint: ['MARKETING_DEMO_PASSWORD_HINT'],
      ai_agent_token_endpoint_auth_method:   ['AI_AGENT_TOKEN_ENDPOINT_AUTH_METHOD'],
      mcp_exchanger_token_endpoint_auth_method: ['MCP_EXCHANGER_TOKEN_ENDPOINT_AUTH_METHOD'],
      oauth_authorization_endpoint: ['OAUTH_AUTHORIZATION_ENDPOINT'],
      oauth_token_endpoint:          ['OAUTH_TOKEN_ENDPOINT'],
      oauth_userinfo_endpoint:       ['OAUTH_USERINFO_ENDPOINT'],
      oauth_jwks_uri:                ['OAUTH_JWKS_URI'],
      oauth_issuer:                  ['OAUTH_ISSUER'],
      oauth_discovery_endpoint:      ['OAUTH_DISCOVERY_ENDPOINT'],
      oauth_discovery_enabled:       ['OAUTH_DISCOVERY_ENABLED'],
      oauth_admin_callback_path:       ['OAUTH_ADMIN_CALLBACK_PATH'],
      oauth_user_callback_path:        ['OAUTH_USER_CALLBACK_PATH'],
      oauth_role_claim_name:           ['OAUTH_ROLE_CLAIM_NAME'],
      oauth_role_claim_value_admin:    ['OAUTH_ROLE_CLAIM_VALUE_ADMIN'],
      oauth_role_claim_value_customer: ['OAUTH_ROLE_CLAIM_VALUE_CUSTOMER'],
      oauth_role_claim_is_array:       ['OAUTH_ROLE_CLAIM_IS_ARRAY'],
      helix_base_url:                  ['HELIX_BASE_URL'],
      helix_api_key:                   ['HELIX_API_KEY'],
      helix_environment_id:            ['HELIX_ENVIRONMENT_ID'],
      helix_agent_id:                  ['HELIX_AGENT_ID'],
      helix_prompt_field_id:           ['HELIX_PROMPT_FIELD_ID'],

      // Intent-based authorization
      ff_intent_authorization_enabled: ['FF_INTENT_AUTHORIZATION_ENABLED'],
      intent_min_confidence:           ['INTENT_MIN_CONFIDENCE'],
      intent_requires_consent:         ['INTENT_REQUIRES_CONSENT'],
      intent_max_amount_low_confidence:['INTENT_MAX_AMOUNT_LOW_CONFIDENCE'],
      ff_intent_token_enabled:         ['FF_INTENT_TOKEN_ENABLED'],

      // Token audiences
      enduser_audience:                     ['ENDUSER_AUDIENCE'],
      ai_agent_audience:                    ['AI_AGENT_AUDIENCE'],
      ai_agent_scope:                       ['AI_AGENT_SCOPE'],
      banking_api_resource_uri:             ['BANKING_API_RESOURCE_URI'],
      mcp_token_exchange_scopes:            ['MCP_TOKEN_EXCHANGE_SCOPES'],

      // Token exchange auth methods
      pingone_token_exchange_auth_method:   ['PINGONE_TOKEN_EXCHANGE_AUTH_METHOD'],
      pingone_mcp_token_exchanger_cc_auth_method: ['PINGONE_MCP_TOKEN_EXCHANGER_CC_AUTH_METHOD', 'PINGONE_MCP_TOKEN_EXCHANGER_AUTH_METHOD', 'MCP_EXCHANGER_TOKEN_ENDPOINT_AUTH_METHOD', 'AGENT_TOKEN_ENDPOINT_AUTH_METHOD'],
      pingone_client_jwt_private_key:       ['PINGONE_CLIENT_JWT_PRIVATE_KEY'],
      pingone_client_jwt_kid:               ['PINGONE_CLIENT_JWT_KID'],

      // Introspection
      pingone_introspection_endpoint:       ['PINGONE_INTROSPECTION_ENDPOINT'],
      pingone_introspection_client_id:      ['PINGONE_INTROSPECTION_CLIENT_ID'],
      pingone_introspection_client_secret:  ['PINGONE_INTROSPECTION_CLIENT_SECRET'],
      pingone_introspection_auth_method:    ['PINGONE_INTROSPECTION_AUTH_METHOD'],

      // Agent / MCP runtime flags
      use_agent_actor_for_mcp:              ['USE_AGENT_ACTOR_FOR_MCP'],
      token_exchange_auto_fallback:         ['TOKEN_EXCHANGE_AUTO_FALLBACK'],
      token_exchange_log_mode_switches:     ['TOKEN_EXCHANGE_LOG_MODE_SWITCHES'],

      // Token validation / JWKS
      skip_token_signature_validation:      ['SKIP_TOKEN_SIGNATURE_VALIDATION'],
      strict_scope_validation:              ['STRICT_SCOPE_VALIDATION'],
      scope_validation_timeout:             ['SCOPE_VALIDATION_TIMEOUT'],
      cache_token_validation:               ['CACHE_TOKEN_VALIDATION'],
      token_cache_ttl:                      ['TOKEN_CACHE_TTL'],
      jwks_requests_per_minute:             ['JWKS_REQUESTS_PER_MINUTE'],
      jwks_cache_max_age:                   ['JWKS_CACHE_MAX_AGE'],

      // Debug flags
      debug_scopes:                         ['DEBUG_SCOPES'],
      debug_tokens:                         ['DEBUG_TOKENS'],

      // Step-up
      step_up_acr_value:                    ['STEP_UP_ACR_VALUE'],

      // Frontend URLs
      frontend_dashboard_url:               ['FRONTEND_DASHBOARD_URL'],

      // Observability
      posthog_api_key:                      ['POSTHOG_API_KEY'],
      posthog_host:                         ['POSTHOG_HOST'],

      // PingOne MCP stdio adapter
      pingone_mcp_environment_id:           ['PINGONE_MCP_ENVIRONMENT_ID'],
      pingone_authorization_code_client_id: ['PINGONE_AUTHORIZATION_CODE_CLIENT_ID'],
      pingone_root_domain:                  ['PINGONE_ROOT_DOMAIN'],

      // Server
      port:                                 ['PORT'],
      default_user_type:                    ['DEFAULT_USER_TYPE'],

      // Demo credentials
      demo_username:                        ['USERNAME', 'DEMO_USER_USERNAME'],
      demo_password:                        ['PASSWORD', 'DEMO_USER_PASSWORD'],
      demo_admin_username:                  ['DEMO_ADMIN_USERNAME'],
      demo_admin_password:                  ['DEMO_ADMIN_PASSWORD'],

      // Admin token lifetimes (docs-only env reads, now configStore-routable)
      admin_token_lifetime:                 ['ADMIN_TOKEN_LIFETIME'],
      admin_refresh_token_lifetime:         ['ADMIN_REFRESH_TOKEN_LIFETIME'],

      // MCP gateway HTTP URL
      mcp_gateway_http_url:                 ['MCP_GATEWAY_HTTP_URL'],
      mcp_pinggateway_url:                  ['MCP_PINGGATEWAY_URL'],
      mcp_demo_gateway_url:                 ['MCP_DEMO_GATEWAY_URL'],
      mcp_step9_resource_uri:               ['MCP_STEP9_RESOURCE_URI'],

      // CIBA additional config fields
      ciba_token_delivery_mode:             ['CIBA_TOKEN_DELIVERY_MODE'],
      ciba_binding_message:                 ['CIBA_BINDING_MESSAGE'],
      ciba_poll_interval_ms:                ['CIBA_POLL_INTERVAL_MS'],
      ciba_auth_request_expiry:             ['CIBA_AUTH_REQUEST_EXPIRY'],

      // Authorize worker — dedicated credentials first, then fall back to the
      // general management worker (PINGONE_WORKER_CLIENT_*). Most deployments
      // use one worker app for both Management API and PingOne Authorize calls.
      // Both the prefixed and short-form keys alias identically so every caller
      // pattern (getEffective('authorize_worker_client_id') or the longer form) resolves.
      authorize_worker_client_id:             ['PINGONE_AUTHORIZE_WORKER_CLIENT_ID', 'PINGONE_WORKER_CLIENT_ID'],
      authorize_worker_client_secret:         ['PINGONE_AUTHORIZE_WORKER_CLIENT_SECRET', 'PINGONE_WORKER_CLIENT_SECRET'],
      pingone_authorize_worker_client_id:     ['PINGONE_AUTHORIZE_WORKER_CLIENT_ID', 'PINGONE_WORKER_CLIENT_ID'],
      pingone_authorize_worker_client_secret: ['PINGONE_AUTHORIZE_WORKER_CLIENT_SECRET', 'PINGONE_WORKER_CLIENT_SECRET'],

      // Worker token client (management API)
      pingone_worker_token_client_id:       ['PINGONE_WORKER_TOKEN_CLIENT_ID', 'PINGONE_WORKER_CLIENT_ID'],
      pingone_worker_token_client_secret:   ['PINGONE_WORKER_TOKEN_CLIENT_SECRET', 'PINGONE_WORKER_CLIENT_SECRET'],
      pingone_worker_token_auth_method:     ['PINGONE_WORKER_TOKEN_AUTH_METHOD'],

      // Anthropic / LM Studio LLM providers
      anthropic_api_key:                    ['ANTHROPIC_API_KEY'],
      google_api_key:                       ['GOOGLE_API_KEY', 'GEMINI_API_KEY'],
      lmstudio_base_url:                    ['LMSTUDIO_BASE_URL'],
      lmstudio_model:                       ['LMSTUDIO_MODEL'],
      ff_helix_lmstudio_fallback:           ['FF_HELIX_LMSTUDIO_FALLBACK'],

      // Phase 266 — Path A demo API key
      demo_apikey_backend_service_key:      ['DEMO_APIKEY_SERVICE_KEY'],
      demo_mortgage_service_key:            ['DEMO_MORTGAGE_SERVICE_KEY'],
      demo_invest_service_key:              ['DEMO_INVEST_SERVICE_KEY'],

      // Agent mode (five-mode provider)
      agent_mode:                           ['AGENT_MODE'],
      agent_external_wiring:                ['AGENT_EXTERNAL_WIRING'],

      // MCP Gateway token introspection (consumed by demo_mcp_gateway via process.env)
      gw_introspection_client_id:           ['GW_INTROSPECTION_CLIENT_ID'],
      gw_introspection_client_secret:       ['GW_INTROSPECTION_CLIENT_SECRET'],

      // MCP WebSocket URLs (consumed by demo_mcp_gateway via process.env)
      mcp_olb_ws_url:                       ['MCP_OLB_WS_URL'],
      mcp_invest_ws_url:                    ['MCP_INVEST_WS_URL'],
      upstream_mcp_url:                     ['UPSTREAM_MCP_URL'],

      // PingAuthorize gateway policy endpoint (consumed by routes/authorize.js + verticalManifest.js)
      pingauthorize_endpoint:               ['PINGAUTHORIZE_ENDPOINT'],
      pingauthorize_worker_id:              ['PINGAUTHORIZE_WORKER_ID'],
      mcp_gw_p1az_enabled:                  ['MCP_GW_P1AZ_ENABLED'],

      // Operator identity — used by bootstrap/management scripts, not at runtime.
      ping_email:                           ['PING_EMAIL'],

      // Agent conversation history
      agent_history_limit:                  ['AGENT_HISTORY_LIMIT'],
    };

    const envVars = envFallbackMap[key] || [];
    const readEnv = () => {
      for (const envKey of envVars) {
        const v = process.env[envKey];
        if (v) return v.trim();
      }
      return null;
    };

    if (BOOTSTRAP_ALLOWLIST.has(key)) {
      // Bootstrap keys: .env is authoritative (read before vault unlock).
      const envVal = readEnv();
      if (envVal) return envVal;
      const stored = this.get(key);
      if (stored) return stored;
    } else {
      // Everything else: .env > Vault/LMDB. Env vars set at deploy time
      // (docker-compose, process env) must always override stored values so
      // that a stale LMDB entry from a past UI toggle cannot silently shadow
      // a deployment-level setting (e.g. FF_MCP_GATEWAY_PINGGATEWAY=false).
      // this.get(key) reads the cache holding both vault ('vault') and LMDB
      // ('sqlite') values; vault-owned keys retain vault provenance via
      // _setCache, so a single this.get() encodes "vault, then sqlite".
      const envVal = readEnv();
      if (envVal) return envVal;
      const stored = this.get(key);
      if (stored) return stored;
    }

    // Helix agent API key: when nothing above has it, look for a per-agent
    // export file (<helix_agent_id>.json) in repo root / ~/Documents /
    // ~/Downloads. Lets fresh clones with the demo agent's key file present
    // run Helix with no /setup step. See services/helixAgentKeyLoader.js.
    if (key === 'helix_api_key') {
      try {
        const { loadAgentKey } = require('./helixAgentKeyLoader');
        // Resolve the agent id without recursing into helix_api_key.
        const agentName =
          process.env.HELIX_AGENT_ID ||
          this.get('helix_agent_id') ||
          FIELD_DEFS.helix_agent_id?.default ||
          'LLM';
        const fromFile = loadAgentKey(agentName);
        if (fromFile) return fromFile;
      } catch (_) {
        /* loader missing or threw — fall through to defaults */
      }
    }

    // Optional committed defaults — last resort so any env var above wins.
    // Used for the hosted demo where visitors have no need to configure credentials.
    try {
      const builtin = require('../config/pingoneBackendDefaults');
      if (builtin && builtin[key] !== undefined && String(builtin[key]).trim() !== '') {
        return String(builtin[key]).trim();
      }
    } catch (_) {
      /* optional file missing */
    }

    return (FIELD_DEFS[key] ?? FIELD_DEFS[String(key).toUpperCase()])?.default || '';
  }

  /** Config is always writable (LMDB). */
  isReadOnly() {
    return false;
  }

  /** Storage type. */
  getStorageType() {
    return 'lmdb';
  }

  /**
   * True once admin PingOne OAuth can run.
   * Uses getEffective (same as config/oauth.js) so this matches env vars,
   * not cache alone — avoids redirecting to PingOne with empty client_id or //as path.
   */
  isConfigured() {
    const envId = String(this.getEffective('pingone_environment_id') || '').trim();
    const adminId = String(this.getEffective('admin_client_id') || '').trim();
    return !!(envId && adminId);
  }

  /** True when end-user OAuth (user_client_id) + environment id are present. */
  isUserOAuthConfigured() {
    const envId = String(this.getEffective('pingone_environment_id') || '').trim();
    const userId = String(this.getEffective('user_client_id') || '').trim();
    return !!(envId && userId);
  }

  /**
   * Remove a persisted OAuth client secret so PKCE-only (public) apps do not retain an old confidential secret.
   * Does not unset environment variables — remove those in your deployment settings separately.
   */
  async clearOAuthClientSecret(key) {
    if (key !== 'admin_client_secret' && key !== 'user_client_secret') {
      throw new Error('clearOAuthClientSecret: invalid key');
    }
    await this.ensureInitialized();
    delete this._cache[String(key).toUpperCase()];
    _lmdbConfig.remove(String(key).toUpperCase());
  }

  /** Boot-time PingOne env-id self-heal. Runs after LMDB load, before env seed. */
  _reconcileEnvId() {
    const er = require('./envReconcile');
    const currentEnvId = (process.env.PINGONE_ENVIRONMENT_ID || '').trim();
    const stampEnvId = this._cache[er.ENV_STAMP_KEY] || null;
    const presentScoped = Object.keys(this._cache)
      .filter((k) => k !== er.ENV_STAMP_KEY && er.isEnvScoped(k));
    const verdict = er.computeVerdict({
      currentEnvId, stampEnvId, hasEnvScopedRows: presentScoped.length > 0,
    });
    this._envReconcileVerdict = verdict;

    const purgedKeys = [];
    if (verdict === 'reconcile') {
      for (const k of presentScoped) {
        const upper = String(k).toUpperCase();
        try { _lmdbConfig.remove(upper); } catch (_) { /* best-effort */ }
        delete this._cache[upper];
        delete this._provenance[upper];
        purgedKeys.push(er.normalizeKey(k));
      }
    }
    if (verdict === 'reconcile' || verdict === 'stamp-only') {
      try { _lmdbConfig.upsert(er.ENV_STAMP_KEY, currentEnvId); } catch (_) { /* best-effort */ }
      this._cache[er.ENV_STAMP_KEY] = currentEnvId;
    }
    if (verdict === 'reconcile' || verdict === 'skip-warn') {
      this.lastEnvReconcile = er.buildRecord({
        verdict, fromEnvId: stampEnvId, toEnvId: currentEnvId,
        purgedKeys, vaultDropped: [], now: new Date().toISOString(),
      });
      er.emitRecord(this.lastEnvReconcile);
    }
  }

  /** Verdict from the last boot reconcile: 'noop'|'reconcile'|'skip-warn'|'stamp-only'|null. */
  getEnvReconcileVerdict() {
    return this._envReconcileVerdict;
  }

  /** True if `key` is a PingOne env-scoped config key (delegates to envReconcile). */
  isEnvScoped(key) {
    return require('./envReconcile').isEnvScoped(key);
  }

  /** Record that vaultLoader dropped env-scoped vault keys during this boot's reconcile. */
  recordVaultDropped(keys) {
    const list = Array.isArray(keys) ? keys.map((k) => require('./envReconcile').normalizeKey(k)) : [];
    if (!list.length) return;
    if (this.lastEnvReconcile) {
      this.lastEnvReconcile.vaultDropped =
        [...new Set([...(this.lastEnvReconcile.vaultDropped || []), ...list])];
    }
    try {
      require('./appEventService').logEvent('config', 'warn',
        `env-reconcile: ${list.length} stale vault secret(s) neutralized`,
        { tag: 'config/env-reconcile-vault', metadata: { vaultDropped: list } });
    } catch (_) { /* best-effort */ }
  }

  /** Wipe stored config (LMDB). */
  async resetConfig() {
    for (const row of _lmdbConfig.loadAll()) {
      _lmdbConfig.remove(row.key);
    }
    this._cache = {};
    this._initPromise = null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// RFC 8707: Scope-Audience Mapping (Phase 56-04)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build explicit scope-audience mapping per RFC 8707 resource indicators.
 * Maps each audience URI to the OAuth scopes valid for token exchange to that audience.
 * Reads resource URIs from configStore to support dynamic configuration.
 * 
 * Called at validation time (not at module load) so config changes are reflected.
 */
function buildAllowedScopesByAudience() {
  const mapping = {};

  // Union scopes into the audience entry instead of overwriting. Several
  // resource URIs deliberately collapse to the same value in this demo — most
  // notably the MCP Gateway and MCP Server both audience to mcpgateway.ping.demo
  // (the MCP server validates the GATEWAY aud; there is no hop-#3 re-exchange,
  // see ARCHITECTURE-TRUTHS / reference_mcp_gateway_aud_contract). A plain
  // `mapping[uri] = [...]` let the later block clobber the earlier one, silently
  // dropping gateway-only scopes (transfer, ai:agent) and denying create_transfer.
  const allow = (uri, scopes) => {
    if (!uri) return;
    mapping[uri] = [...new Set([...(mapping[uri] || []), ...scopes])];
  };

  // User End-User banking API (standard 1-exchange)
  // Audience: enduser.ping.demo — see docs/PINGONE_CONFIG.md
  allow(configStore.getEffective('enduser_audience'), [
    'read',
    'write',
    'admin',
    'sensitive',
    'ai:agent',
  ]);

  // Agent Gateway (Step 1 actor token) — 2-exchange only
  // Audience: agentgateway.ping.demo — see docs/PINGONE_CONFIG.md
  allow(configStore.getEffective('pingone_resource_agent_gateway_uri'), [
    'ai:agent',
    'ai_agent',
  ]);

  // MCP Gateway — the BFF's single subject+actor RFC 8693 exchange is
  // audienced here (canonical chain). Must allow the tool scopes the exchange
  // requests (read / write / transfer / mortgage:read) plus the actor/invoke scopes.
  // Audience: mcpgateway.ping.demo — see docs/PINGONE_CONFIG.md and scope-topology.json
  allow(configStore.getEffective('pingone_resource_mcp_gateway_uri'), [
    'read',
    'write',
    'transfer',           // banking — create_transfer (gateway-level authz gate)
    'mcp:invoke',
    'ai:agent',
    'mortgage:read',      // banking — show_mortgage
    'largepurchase:read', // retail — show_large_purchase
    'records:read',       // healthcare — show_health_record
    'gear:read',          // sporting-goods — show_gear_order
    'expense:read',       // workforce — show_expense_report
    'invest:read',        // investment — investment vertical tools
    'permits:read',       // government — permit vertical tools
    'transcript:read',    // university — enrollment/transcript vertical tools
    'workorders:read',    // field-service — work-order vertical tools
    'sensitive:read',     // sensitive account/record details (consent-gated downstream)
    'code:search',        // code-search MCP tools (code_search/get_code/list_codebases)
    'admin:read',         // admin — lookup/view customer profile, accounts, transactions
    'admin:write',        // admin — freeze account, adjust balance, reset password
    'admin:delete',       // admin — delete customer
    'users:read',         // admin — customer lookup/profile/accounts/transactions
    'users:manage',       // admin — freeze/adjust/reset/delete
  ]);

  // MCP Resource Server — the gateway re-exchanges to this audience downstream.
  // Audience: mcpserver.ping.demo — see docs/PINGONE_CONFIG.md and scope-topology.json
  // mirroredScopes from scope-topology.json must be kept in sync here. NOTE:
  // unioned (not overwritten) — when this collapses onto mcpgateway.ping.demo
  // the gateway's transfer/ai:agent scopes must survive.
  allow(configStore.getEffective('pingone_resource_mcp_server_uri'), [
    'read',
    'write',
    'mcp:invoke',
    'mortgage:read',      // banking — show_mortgage
    'largepurchase:read', // retail — show_large_purchase
    'records:read',       // healthcare — show_health_record
    'gear:read',          // sporting-goods — show_gear_order
    'expense:read',       // workforce — show_expense_report
    'invest:read',        // investment — investment vertical tools
    'permits:read',       // government — permit vertical tools
    'transcript:read',    // university — enrollment/transcript vertical tools
    'workorders:read',    // field-service — work-order vertical tools
    'sensitive:read',     // sensitive account/record details (consent-gated downstream)
    'code:search',        // code-search MCP tools (code_search/get_code/list_codebases)
    'admin:read',         // admin — lookup/view customer profile, accounts, transactions
    'admin:write',        // admin — freeze account, adjust balance, reset password
    'admin:delete',       // admin — delete customer
    'users:read',         // admin — customer lookup/profile/accounts/transactions
    'users:manage',       // admin — freeze/adjust/reset/delete
  ]);

  // WR-19: warn when no resource URIs are configured (pre-bootstrap state)
  // so operators don't wonder why scope enforcement is silent.
  if (Object.keys(mapping).length === 0) {
    console.warn(
      '[configStore] buildAllowedScopesByAudience: no resource URIs configured — ' +
      'scope-audience enforcement is disabled until bootstrap completes.'
    );
  }

  return mapping;
}

/**
 * Validate that provided scopes are allowed for the given audience.
 * Implements explicit scope-audience mapping (RFC 8707).
 *
 * @param {string|string[]} scopes  OAuth scopes (array or space-separated string)
 * @param {string}          audience  Target audience URI (resource indicator)
 * @returns {{ valid: true, scopes: string[], narrowed: boolean }}
 * @throws {Error} SCOPE_ERROR when no scopes provided
 * @throws {Error} SCOPE_MISMATCH when none of the provided scopes are valid for the audience
 *
 * Note: unknown audiences pass through with a warning (WR-09).
 */
function validateScopeAudience(scopes, audience) {
  // WR-20: coerce a space-separated string to an array
  if (typeof scopes === 'string') {
    scopes = scopes.split(/\s+/).filter(Boolean);
  }
  if (!Array.isArray(scopes) || scopes.length === 0) {
    throw new Error(
      `SCOPE_ERROR: No scopes provided for audience ${audience}`
    );
  }

  // Build mapping at validation time (allows dynamic config changes)
  const ALLOWED_SCOPES_BY_AUDIENCE = buildAllowedScopesByAudience();

  // Check: audience is known in mapping
  const allowedForAudience = ALLOWED_SCOPES_BY_AUDIENCE[audience];
  if (!allowedForAudience) {
    // WR-09 / hardening: an unknown audience means this RFC 8707 scope-audience
    // allowlist can't narrow the exchange, so every requested scope would pass
    // through unnarrowed. Under STRICT_AUTH fail CLOSED (a misconfigured audience
    // must not silently disable scope narrowing); otherwise keep the permissive
    // pass-through but warn. Gated on STRICT_AUTH (not NODE_ENV) because the local
    // demo runs NODE_ENV=production and may hit audiences not in the static map.
    const note = `Unknown audience — not in scope-audience allowlist: ${audience}`;
    if (process.env.STRICT_AUTH === 'true') {
      throw new Error(`SCOPE_AUDIENCE_UNKNOWN: ${note} — refusing to skip scope narrowing`);
    }
    console.warn(
      '[configStore] validateScopeAudience: unknown audience "%s" — scopes not validated (dev pass-through).',
      audience
    );
    return {
      valid: true,
      scopes,
      narrowed: false,
      note,
    };
  }

  // Filter: keep only scopes valid for this audience
  const allowedSet = new Set(allowedForAudience);
  const validScopes = scopes.filter(s => allowedSet.has(s));

  // Check: at least one scope matches
  if (validScopes.length === 0) {
    throw new Error(
      `SCOPE_MISMATCH: User scopes [${scopes.join(', ')}] ` +
      `do not match allowed scopes for ${audience} ` +
      `[${allowedForAudience.join(', ')}]`
    );
  }

  return {
    valid: true,
    scopes: validScopes,
    narrowed: validScopes.length < scopes.length,
  };
}



// ─────────────────────────────────────────────────────────────────────────────
// RFC 8693 §2.1: Two-Exchange Delegation Configuration Validation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Validate all required configuration for the two-exchange delegation flow.
 * Collects ALL missing values before throwing (not fail-fast), so operators
 * see every problem in one error message.
 *
 * @returns {{ valid: true, credentials: { aiAgentClientId, mcpClientId }, audiences: { agentGatewayAud, intermediateAud, mcpGatewayAud, finalAud } }}
 * @throws {Error} with code='TWO_EXCHANGE_CONFIG_INVALID', httpStatus=503, isConfigError=true, details.missing[]
 */
function validateTwoExchangeConfig() {
  const missing = [];

  // ── Credentials ────────────────────────────────────────────────────────────
  const aiAgentClientId =
    configStore.getEffective('pingone_ai_agent_client_id') ||
    process.env.PINGONE_AI_AGENT_ACTOR_CLIENT_ID ||
    process.env.PINGONE_AI_AGENT_CLIENT_ID;
  if (!aiAgentClientId) missing.push('PINGONE_AI_AGENT_ACTOR_CLIENT_ID');

  const aiAgentClientSecret =
    configStore.getEffective('pingone_ai_agent_client_secret') ||
    process.env.PINGONE_AI_AGENT_ACTOR_CLIENT_SECRET ||
    process.env.PINGONE_AI_AGENT_CLIENT_SECRET;
  if (!aiAgentClientSecret) missing.push('PINGONE_AI_AGENT_ACTOR_CLIENT_SECRET');

  const mcpClientId =
    configStore.getEffective('pingone_mcp_token_exchanger_client_id') ||
    process.env.PINGONE_TOKEN_EXCHANGER_CLIENT_ID ||
    process.env.PINGONE_MCP_TOKEN_EXCHANGER_CLIENT_ID ||
    process.env.AGENT_OAUTH_CLIENT_ID;
  if (!mcpClientId) missing.push('PINGONE_TOKEN_EXCHANGER_CLIENT_ID (or AGENT_OAUTH_CLIENT_ID)');

  const mcpClientSecret =
    configStore.getEffective('pingone_mcp_token_exchanger_client_secret') ||
    process.env.PINGONE_TOKEN_EXCHANGER_CLIENT_SECRET ||
    process.env.PINGONE_MCP_TOKEN_EXCHANGER_CLIENT_SECRET ||
    process.env.AGENT_OAUTH_CLIENT_SECRET;
  if (!mcpClientSecret) missing.push('PINGONE_TOKEN_EXCHANGER_CLIENT_SECRET (or AGENT_OAUTH_CLIENT_SECRET)');

  // ── Audiences ──────────────────────────────────────────────────────────────
  const agentGatewayAud =
    configStore.getEffective('pingone_resource_agent_gateway_uri') ||
    process.env.PINGONE_RESOURCE_AGENT_GATEWAY_URI ||
    process.env.AGENT_GATEWAY_AUDIENCE;
  if (!agentGatewayAud) missing.push('PINGONE_RESOURCE_AGENT_GATEWAY_URI');

  const mcpGatewayAud =
    configStore.getEffective('pingone_resource_mcp_gateway_uri') ||
    process.env.PINGONE_RESOURCE_MCP_GATEWAY_URI;
  if (!mcpGatewayAud) missing.push('PINGONE_RESOURCE_MCP_GATEWAY_URI');

  const intermediateAud =
    configStore.getEffective('ai_agent_intermediate_audience') ||
    process.env.AI_AGENT_INTERMEDIATE_AUDIENCE;
  if (!intermediateAud) missing.push('AI_AGENT_INTERMEDIATE_AUDIENCE');

  const finalAud =
    configStore.getEffective('pingone_resource_two_exchange_uri') ||
    process.env.PINGONE_RESOURCE_TWO_EXCHANGE_URI;
  if (!finalAud) missing.push('PINGONE_RESOURCE_TWO_EXCHANGE_URI');

  if (missing.length > 0) {
    const err = new Error(
      `Two-Exchange Delegation misconfigured. Missing: ${missing.join(', ')}.\n\n` +
      `Remediation Steps:\n` +
      `  1. Set missing environment variables in demo_api_server/.env\n` +
      `  2. Restart the BFF server\n` +
      `  3. Verify all PingOne resource server URIs are correct`
    );
    err.code = 'TWO_EXCHANGE_CONFIG_INVALID';
    err.httpStatus = 503;
    err.isConfigError = true;
    err.details = { missing };
    throw err;
  }

  if (intermediateAud && finalAud && intermediateAud === finalAud) {
    console.warn('[validateTwoExchangeConfig] intermediateAud === finalAud — both exchanges target the same audience');
  }

  return {
    valid: true,
    credentials: {
      aiAgentClientId,
      aiAgentClientSecret,
      mcpClientId,
      mcpClientSecret,
    },
    audiences: {
      agentGatewayAud,
      intermediateAud,
      mcpGatewayAud,
      finalAud,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// RFC 8693 §5.2: Standardized Error Codes (Phase 56-05)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Standardized error codes per RFC 8693 §5.2 and custom extensions.
 * Maps error conditions to RFC-compliant error codes with remediation info.
 */
const ERROR_CODES = {
  // Configuration Errors (operational, not RFC)
  'config.missing_credentials': {
    http_status: 500,
    oauth_error: 'server_error',
    description: 'Application credentials not configured',
    category: 'Configuration',
  },
  'config.invalid_audience': {
    http_status: 500,
    oauth_error: 'server_error',
    description: 'Invalid or missing token audience configuration',
    category: 'Configuration',
  },

  // RFC 8693 §5.2 Error Codes
  'invalid_request': {
    http_status: 400,
    oauth_error: 'invalid_request',
    description: 'The request is missing a required parameter or is otherwise malformed',
    category: 'Request',
  },
  'invalid_client': {
    http_status: 401,
    oauth_error: 'invalid_client',
    description: 'Client authentication failed (unknown client or unsupported auth method)',
    category: 'Authentication',
  },
  'invalid_grant': {
    http_status: 400,
    oauth_error: 'invalid_grant',
    description: 'The provided grant is invalid or expired',
    category: 'Authorization',
  },
  'invalid_scope': {
    http_status: 400,
    oauth_error: 'invalid_scope',
    description: 'The requested scope is invalid, unknown, or exceeds what was granted',
    category: 'Scope',
  },
  'unauthorized_client': {
    http_status: 403,
    oauth_error: 'unauthorized_client',
    description: 'The client is not authorized for this method',
    category: 'Authorization',
  },
  'unsupported_grant_type': {
    http_status: 400,
    oauth_error: 'unsupported_grant_type',
    description: 'The authorization grant type is not supported',
    category: 'Request',
  },
  'server_error': {
    http_status: 500,
    oauth_error: 'server_error',
    description: 'The authorization server encountered an unexpected condition',
    category: 'Server',
  },
  'temporarily_unavailable': {
    http_status: 503,
    oauth_error: 'temporarily_unavailable',
    description: 'The authorization server is unable to handle the request (temp overload)',
    category: 'Server',
  },

  // Custom/Extended Errors
  'access_denied': {
    http_status: 403,
    oauth_error: 'access_denied',
    description: 'The resource owner or authorization server denied the request',
    category: 'Authorization',
  },
  'insufficient_scope': {
    http_status: 403,
    oauth_error: 'insufficient_scope',
    description: 'The access token provided does not have the required scope',
    category: 'Scope',
  },
  'invalid_token': {
    http_status: 401,
    oauth_error: 'invalid_token',
    description: 'The access token provided is expired, revoked, or invalid',
    category: 'Authentication',
  },
  'token_expired': {
    http_status: 401,
    oauth_error: 'invalid_token',
    description: 'The token has expired',
    category: 'Authentication',
  },
  'may_act_validation_failed': {
    http_status: 400,
    oauth_error: 'invalid_grant',
    description: 'The may_act claim does not match the request context',
    category: 'Authorization',
  },
  'subject_mismatch': {
    http_status: 400,
    oauth_error: 'invalid_grant',
    description: 'The subject claim does not match user identity',
    category: 'Authorization',
  },
};

/**
 * Get error details and metadata for an error code.
 * Returns standardized error info for RFC 8693 compliance.
 * 
 * @param {string} errorCode - Error code to look up
 * @returns {object} Error metadata {http_status, oauth_error, description, category}
 */
function getErrorDetails(errorCode) {
  const config = ERROR_CODES[errorCode];
  if (!config) {
    return {
      http_status: 500,
      oauth_error: 'server_error',
      description: 'Unknown error',
      category: 'Server',
    };
  }
  return config;
}

/**
 * Map internal error messages to standardized error codes.
 * Used for translating implementation errors to RFC 8693 codes.
 * 
 * @param {string} errorMessage - Error message or internal error string
 * @param {object} context - Additional context (optional)
 * @returns {string} Error code from ERROR_CODES
 */
function mapErrorToCode(errorMessage, _context = {}) {
  const msg = String(errorMessage).toLowerCase();
  
  // Configuration errors
  if (msg.includes('credentials not configured')) return 'config.missing_credentials';
  if (msg.includes('invalid audience')) return 'config.invalid_audience';
  
  // RFC 8693 errors
  if (msg.includes('invalid_client') || msg.includes('client authentication failed')) return 'invalid_client';
  if (msg.includes('invalid_grant') || msg.includes('grant')) return 'invalid_grant';
  if (msg.includes('invalid_scope') || msg.includes('scope_mismatch')) return 'invalid_scope';
  if (msg.includes('unauthorized_client')) return 'unauthorized_client';
  if (msg.includes('unsupported_grant_type')) return 'unsupported_grant_type';
  if (msg.includes('token_expired') || msg.includes('expired')) return 'token_expired';
  if (msg.includes('invalid_token')) return 'invalid_token';
  
  // Custom errors
  if (msg.includes('may_act')) return 'may_act_validation_failed';
  if (msg.includes('subject')) return 'subject_mismatch';
  if (msg.includes('access_denied')) return 'access_denied';
  if (msg.includes('insufficient_scope')) return 'insufficient_scope';
  if (msg.includes('malformed') || msg.includes('invalid_request')) return 'invalid_request';
  
  // Default
  return 'server_error';
}

/**
 * Sync OAuth endpoint values from .env into LMDB.
 * When LMDB has stale cached values (e.g., old authz-server:9001 from a prior run),
 * overwrites them with correct .env values so LMDB is authoritative going forward.
 *
 * Runs at startup: if LMDB differs from .env, updates LMDB.
 */
async function syncOAuthEndpointsToLmdb() {
  const OAUTH_CONFIG_KEYS = [
    'oauth_authorization_endpoint',
    'oauth_token_endpoint',
    'oauth_userinfo_endpoint',
    'oauth_jwks_uri',
    'oauth_discovery_endpoint',
    'oauth_issuer',
    'user_redirect_uri',
    'admin_redirect_uri',
  ];

  // ENV key → config key mapping
  const envKeyMap = {
    'oauth_authorization_endpoint': 'OAUTH_AUTHORIZATION_ENDPOINT',
    'oauth_token_endpoint': 'OAUTH_TOKEN_ENDPOINT',
    'oauth_userinfo_endpoint': 'OAUTH_USERINFO_ENDPOINT',
    'oauth_jwks_uri': 'OAUTH_JWKS_URI',
    'oauth_discovery_endpoint': 'OAUTH_DISCOVERY_ENDPOINT',
    'oauth_issuer': 'OAUTH_ISSUER',
    'user_redirect_uri': 'PINGONE_USER_REDIRECT_URI',
    'admin_redirect_uri': 'PINGONE_ADMIN_REDIRECT_URI',
  };

  let synced = 0;
  for (const key of OAUTH_CONFIG_KEYS) {
    const envKey = envKeyMap[key];
    const envVal = String(process.env[envKey] || '').trim();
    if (!envVal) continue; // .env has no value for this key

    const stored = configStore.get(key);
    if (stored !== envVal) {
      // LMDB differs from .env (or missing) — update LMDB with .env value
      _lmdbConfig.upsert(key, envVal);
      if (stored) {
        console.log(`[configStore-lmdb-sync] Updated LMDB ${key}: was "${stored.substring(0, 50)}...", now "${envVal.substring(0, 50)}..."`);
      } else {
        console.log(`[configStore-lmdb-sync] Seeded LMDB ${key}: "${envVal.substring(0, 50)}..."`);
      }
      synced++;
    }
  }

  if (synced > 0) {
    console.warn(`[configStore-lmdb-sync] Synced ${synced} OAuth config(s) (endpoints + redirect URIs) from .env into LMDB.`);
  }

  // Sync feature flag env vars into LMDB so the admin UI always reflects the
  // effective (env-var-wins) value and a stale LMDB entry can never silently
  // diverge from what the running server actually uses.
  const FF_ENV_MAP = {
    ff_heuristic_enabled:       'FF_HEURISTIC_ENABLED',
    ff_prompt_injection_guard:  'FF_PROMPT_INJECTION_GUARD',
    ff_a2a_delegation:          'FF_A2A_DELEGATION',
    ff_mcp_gateway_pinggateway: 'FF_MCP_GATEWAY_PINGGATEWAY',
    ff_mcp_gateway_jwks:        'FF_MCP_GATEWAY_JWKS',
    ff_local_fallback_on_exchange_failure: 'FF_LOCAL_FALLBACK_ON_EXCHANGE_FAILURE',
    ff_bedrock_agentcore_gateway: 'FF_BEDROCK_AGENTCORE_GATEWAY',
    ff_bedrock_llm:             'FF_BEDROCK_LLM',
    ff_authorize_simulated:     'FF_AUTHORIZE_SIMULATED',
  };
  let ffSynced = 0;
  for (const [key, envKey] of Object.entries(FF_ENV_MAP)) {
    const envVal = String(process.env[envKey] || '').trim();
    if (!envVal) continue;
    const stored = configStore.get(key);
    if (stored !== envVal) {
      _lmdbConfig.upsert(key, envVal);
      console.log(`[configStore-lmdb-sync] Synced feature flag ${key} from env (${envKey}=${envVal})`);
      ffSynced++;
    }
  }
  if (ffSynced > 0) {
    console.log(`[configStore-lmdb-sync] Synced ${ffSynced} feature flag(s) from .env into LMDB.`);
  }
}

// Singleton
const configStore = new ConfigStore();

/**
 * detectRotatedCredentials — boot-time check for non-bootstrap credential keys
 * where LMDB holds a value that differs from the current .env value.
 *
 * Bootstrap keys (session_secret, management creds, oauth endpoints) are already
 * env-authoritative and handled by BOOTSTRAP_ALLOWLIST. This function covers the
 * remaining secret keys — app client secrets, API keys, demo passwords, etc. —
 * where the LMDB (vault/cache) value could silently beat a rotated .env value,
 * causing 401s or auth failures that look like transient network errors.
 *
 * Never throws; non-blocking advisory. Returns an array of warning strings.
 * Callers are expected to log them and move on.
 */
function detectRotatedCredentials() {
  // Map: lowercase config key → canonical env var name
  const WATCHLIST = [
    ['pingone_admin_client_secret',              'PINGONE_ADMIN_CLIENT_SECRET'],
    ['pingone_user_client_secret',               'PINGONE_USER_CLIENT_SECRET'],
    ['pingone_authorize_worker_client_secret',   'PINGONE_AUTHORIZE_WORKER_CLIENT_SECRET'],
    ['pingone_management_client_secret',         'PINGONE_MANAGEMENT_CLIENT_SECRET'],
    ['pingone_agent_client_secret',              'PINGONE_AGENT_CLIENT_SECRET'],
    ['pingone_a2a_investment_agent_client_secret', 'PINGONE_A2A_INVESTMENT_AGENT_CLIENT_SECRET'],
    ['pingone_a2a_records_agent_client_secret',  'PINGONE_A2A_RECORDS_AGENT_CLIENT_SECRET'],
    ['pingone_a2a_purchase_agent_client_secret', 'PINGONE_A2A_PURCHASE_AGENT_CLIENT_SECRET'],
    ['pingone_a2a_membership_agent_client_secret', 'PINGONE_A2A_MEMBERSHIP_AGENT_CLIENT_SECRET'],
    ['pingone_a2a_payroll_agent_client_secret',  'PINGONE_A2A_PAYROLL_AGENT_CLIENT_SECRET'],
    ['mcp_gw_client_secret',                    'MCP_GW_CLIENT_SECRET'],
    ['gw_introspection_client_secret',          'GW_INTROSPECTION_CLIENT_SECRET'],
    ['demo_password',                           'DEMO_USER_PASSWORD'],
    ['demo_admin_password',                     'DEMO_ADMIN_PASSWORD'],
  ];

  const warnings = [];
  try {
    for (const [configKey, envKey] of WATCHLIST) {
      const envVal = (process.env[envKey] || '').trim();
      if (!envVal) continue; // not set in .env — nothing to compare

      const cached = configStore.get(configKey);
      if (!cached) continue; // not in LMDB — no stale value possible

      if (cached !== envVal) {
        warnings.push(
          `[config-rotation] ${envKey}: .env value differs from LMDB cache — ` +
          'LMDB wins for this key (non-bootstrap). If you rotated this credential, ' +
          'update it via App Configuration or run: configStore.set("' + configKey + '", newValue).',
        );
      }
    }
  } catch (err) {
    warnings.push('[config-rotation] check skipped: ' + err.message);
  }
  return warnings;
}

module.exports = configStore;
module.exports.FIELD_DEFS = FIELD_DEFS;
module.exports.SECRET_KEYS = SECRET_KEYS;
module.exports.BOOTSTRAP_ALLOWLIST = BOOTSTRAP_ALLOWLIST;
module.exports.validateTwoExchangeConfig = validateTwoExchangeConfig;
module.exports.buildAllowedScopesByAudience = buildAllowedScopesByAudience;
module.exports.validateScopeAudience = validateScopeAudience;
module.exports.ERROR_CODES = ERROR_CODES;
module.exports.getErrorDetails = getErrorDetails;
module.exports.mapErrorToCode = mapErrorToCode;
module.exports.syncOAuthEndpointsToLmdb = syncOAuthEndpointsToLmdb;
module.exports.detectRotatedCredentials = detectRotatedCredentials;
