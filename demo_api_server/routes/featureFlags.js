// banking_api_server/routes/featureFlags.js
'use strict';

/**
 * Feature Flags API — read/write toggles for in-development features.
 *
 * GET  /api/admin/feature-flags        → full registry with current values
 * PATCH /api/admin/feature-flags       → update one or more flag values
 *
 * Values are persisted via configStore (survives restarts on Vercel+KV or SQLite).
 * The FLAG_REGISTRY is the single source of truth for what flags exist.
 */

const express        = require('express');
const router         = express.Router();
const configStore    = require('../services/configStore');
const runtimeSettings = require('../config/runtimeSettings');

// ---------------------------------------------------------------------------
// Flag registry — add new flags here; they appear automatically in the UI.
// ---------------------------------------------------------------------------

/** @type {Array<{
 *   id: string, name: string, category: string,
 *   description: string, impact: string,
 *   type: 'boolean', defaultValue: boolean,
 *   envVar?: string, warnIfEnabled?: boolean, warnIfDisabled?: boolean,
 *   docsUrl?: string,
 *   runtimeKey?: string  // when set, the flag is also mirrored into
 *                        // config/runtimeSettings under this key (live toggle);
 *                        // resolveFlag()/PATCH keep the two in sync.
 * }>} */
const FLAG_REGISTRY = [
  // ── Auth Error Handling ───────────────────────────────────────────────────
  {
    id:           'ff_error_classification_enabled',
    name:         'Comprehensive Auth Error Handling',
    category:     'Auth Error Handling',
    description:
      'Enable comprehensive error classification and intelligent error handling. ' +
      'Classifies all auth errors into 4 categories (TRANSIENT, USER, CONFIG, UNKNOWN) for appropriate handling. ' +
      'Frontend auto-retries transient errors with exponential backoff; shows category-specific UI with user guidance. ' +
      'Hides sensitive config details (JWKS URIs, env IDs) from error responses for CONFIG errors.',
    impact:
      'OFF (default, legacy) = basic error responses without classification. ' +
      'ON = errors classified, transient retried automatically, config details scrubbed, support contact info included. ' +
      'Production impact: CONFIG error rate should be zero if configuration is correct; monitor via error telemetry.',
    type:         'boolean',
    defaultValue: true,
    runtimeKey:   'errorClassificationEnabled',
  },

  // ── PingOne Authorize (ALWAYS ON — no toggle) ──────────────────────────────
  // Authorization is mandatory for security. See transactionAuthorizationService.js for details.
  {
    id:           'ff_authorize_simulated',
    name:         'Simulated Authorize (education)',
    category:     'PingOne Authorize',
    description:
      'When **Transaction authorization** is ON, evaluate with an in-process policy that mimics PingOne Authorize outcomes (PERMIT, DENY, policy step-up → 428). No worker token or PingOne API call. ' +
      'Turn **OFF** to use real PingOne Authorize (requires decision endpoint or policy ID + worker credentials).',
    impact:
      'ON = education mode: deny above $50k (configurable via SIMULATED_AUTHORIZE_DENY_AMOUNT); policy step-up for large transfers/withdrawals without strong ACR (see simulatedAuthorizeService.js). OFF (default) = live PingOne only.',
    type:         'boolean',
    defaultValue: false,
    warnIfEnabled: true,
  },
  {
    id:           'ff_authorize_fail_open',
    name:         'Authorize — Fail Open',
    category:     'PingOne Authorize',
    description:  'When the Authorize API call fails (network timeout, misconfiguration), allow the transaction to proceed.',
    impact:       'ON = fail open (warn + allow). OFF = fail closed (deny transaction on any Authorize error). Recommended: ON during initial testing.',
    type:         'boolean',
    defaultValue: false,
    warnIfDisabled: true, // warn in UI that OFF = hard fail
  },
  {
    id:           'ff_authorize_deposits',
    name:         'Authorize — Apply to Deposits',
    category:     'PingOne Authorize',
    description:  'Evaluate deposit transactions through the Authorize policy (in addition to transfers and withdrawals).',
    impact:       'OFF = only transfers + withdrawals go through Authorize. ON = deposits also require PERMIT.',
    type:         'boolean',
    defaultValue: false,
  },
  {
    id:           'ff_authorize_mcp_first_tool',
    name:         'Authorize — First MCP tool (BankingAgent)',
    category:     'PingOne Authorize',
    description:
      'On the **first** MCP tool call per signed-in session (POST /api/mcp/tool with a delegated MCP access token), ' +
      'evaluate **PingOne Authorize** using Trust Framework **DecisionContext=McpFirstTool** — or **Simulated Authorize** when that flag is on. ' +
      'Requires **MCP decision endpoint ID** in Application Configuration for live PingOne. Skips admins and local MCP fallback (no bearer).',
    impact:
      'OFF = no extra Authorize round-trip for MCP (MCP server still introspects tokens). ON = first tool may return 403/428 from policy.',
    type:         'boolean',
    defaultValue: false,
    docsUrl:      'https://docs.pingidentity.com/pingone/authorization_using_pingone_authorize/p1az_overview.html',
  },

  // ── Step-Up Auth ───────────────────────────────────────────────────────────
  {
    id:           'step_up_enabled',
    name:         'Step-Up MFA',
    category:     'Step-Up Auth',
    description:  'Require MFA step-up authentication for high-value transactions (transfers / withdrawals above the configured threshold).',
    impact:       'OFF = step-up challenges are skipped for all transactions. ON = users are challenged for transactions over the threshold.',
    type:         'boolean',
    defaultValue: true,
    runtimeKey:   'stepUpEnabled', // maps to runtimeSettings for live toggle
  },

  // ── HITL / Agent Consent ───────────────────────────────────────────────────
  {
    id:           'ff_hitl_enabled',
    name:         'HITL — Agent Consent Gate',
    category:     'HITL / Agent Consent',
    description:  'Require explicit human approval before the AI agent can execute high-value transactions.',
    impact:       'ON = agent-initiated transactions trigger a consent dialog. OFF = agent transactions bypass the approval gate (use only in development).',
    type:         'boolean',
    defaultValue: true,
    warnIfDisabled: true,
  },
  {
    id:           'hitl_consent_mfa_mode',
    name:         'HITL — Consent MFA mode',
    category:     'HITL / Agent Consent',
    description:
      'Controls how the one-time verification code is delivered after the user approves the consent challenge. ' +
      '**onetime** (default) — PingOne sends the OTP directly to the user\'s registered email or phone; no device enrollment required. ' +
      '**device_picker** — full PingOne MFA with device selection (requires enrolled devices + MFA policy). ' +
      '**homegrown** — BFF-generated OTP delivered via the app\'s own email service (no PingOne MFA). ' +
      '**recognize** — PingOne Recognize biometric / device-intelligence verification (requires RECOGNIZE_API_KEY + RECOGNIZE_TENANT_NAME on the Feature Flags page).',
    impact:
      'onetime (default) = PingOne one-time OTP, works for any user with an email or phone on record. ' +
      'device_picker = enrolled-device flow with amount step-up threshold (confirm_stepup_threshold_usd). ' +
      'homegrown = legacy BFF email OTP. ' +
      'recognize = PingOne Recognize biometric challenge; set credentials in the Recognize Configuration section below.',
    type:         'enum',
    options:      ['onetime', 'device_picker', 'homegrown', 'recognize'],
    defaultValue: 'onetime',
  },

  // ── MCP Server ─────────────────────────────────────────────────────────────
  {
    id:           'mcp_use_legacy_protocol',
    name:         'MCP — Use 2024-11-05 Protocol (legacy)',
    category:     'MCP Server',
    description:
      'When **ON**, the BFF announces `protocolVersion: 2024-11-05` in the MCP `initialize` handshake. ' +
      'Default (**OFF**) uses `2025-11-25` (current spec, recommended). ' +
      'This is useful when connecting to an older MCP server that only supports the previous protocol version. ' +
      'Change takes effect on the **next** agent MCP tool call (each call opens a fresh WebSocket).',
    impact:
      'OFF (default) = 2025-11-25 handshake (full spec compliance). ' +
      'ON = 2024-11-05 handshake — only enable if your MCP server rejects 2025-11-25.',
    type:         'boolean',
    defaultValue: false,
  },

  {
    id:           'mcp_use_pingone_server',
    name:         'MCP — Use PingOne MCP Server (hosted HTTP)',
    category:     'MCP Server',
    description:
      'When **ON**, the BFF routes PingOne admin tool calls to the hosted PingOne MCP server over ' +
      'HTTP (`https://api.pingone.{region}/v1/environments/{envId}/mcp`), authenticated with a ' +
      'worker `client_credentials` token, bypassing the custom MCP gateway. The hosted MCP feature ' +
      'must be enabled on the environment and worker credentials configured. ' +
      'When **OFF** (default), the existing custom MCP gateway continues to handle all tool calls.',
    impact:
      'OFF (default) = custom MCP gateway active (all Phase 243 auth, RFC 9728, PingOne Authorize). ' +
      'ON = hosted PingOne MCP server mode; custom gateway bypassed. Requires valid PingOne worker ' +
      'credentials. The MCP Gateway Config panel shows active mode chip.',
    type:         'boolean',
    defaultValue: false,
    warnIfEnabled: true,
  },

  {
    id:           'mcp_inspector_pingone_live',
    name:         'MCP — PingOne MCP Inspector live query',
    category:     'MCP Server',
    description:
      'When **ON** (default), the PingOne MCP Inspector page (`/pingone-mcp-inspector`) queries the ' +
      'hosted PingOne MCP server over HTTP to answer its `tools/list` query live. ' +
      'This is **page-only**: it does NOT reroute agent tool calls — that is `mcp_use_pingone_server`. ' +
      'When **OFF**, the page shows the request with a disabled state instead of querying.',
    impact:
      'ON (default) = inspector page queries the PingOne MCP server live. ' +
      'OFF = inspector page renders a disabled state. Agent routing is unaffected either way.',
    type:         'boolean',
    defaultValue: true,
  },

  {
    id:           'ff_vertical_tools_via_mcp',
    name:         'MCP — Route vertical tools through the full pipeline',
    category:     'MCP Server',
    description:
      'When **ON**, non-banking vertical action chips (e.g. workforce "My benefits") run through the ' +
      'same delegated pipeline banking uses — RFC 8693 token exchange → MCP gateway → MCP server → ' +
      'PingAuthorize → HITL — instead of executing in-process via verticalDispatch. ' +
      'Rolling out per-slice; Slice 1 covers read-only `view_benefits` (workforce). ' +
      'When **OFF** (default), vertical chips execute in-process (current behavior).',
    impact:
      'OFF (default) = vertical action tools run in-process (no token exchange / gateway / Authorize). ' +
      'ON = vertical tools traverse the full MCP pipeline; Token Chain shows the RFC 8693 act claim and ' +
      'app-events show mcp + authorize legs. Requires the MCP server build to include the vertical tools.',
    type:         'boolean',
    defaultValue: true,
  },

  // ── Agent Security ──────────────────────────────────────────────────────────
  {
    id:           'ff_require_act_for_agent_tools',
    name:         'Require agent act claim (UC16 — impersonation block)',
    category:     'Agent Security',
    description:
      'When **ON**, tool calls to agent-mediated operations (write/sensitive tools flagged ' +
      '`requiresAgentMediation` in scope-topology.json) are **denied** if the bearer token ' +
      'carries no `act` claim. An `act`-less token is an impersonation token — the agent ' +
      'identity is erased. Only RFC 8693 on-behalf-of tokens (sub=user, act={agent}) are ' +
      'accepted. This is UC16 enforcement. ' +
      '**Note:** also requires gateway env var REQUIRE_ACT_FOR_AGENT_TOOLS=true to enforce at the gateway.',
    impact:
      'OFF (default) = act claim is optional; existing delegated flows unaffected. ' +
      'ON = no-act tokens are DENIED for agent-mediated tools; ff_skip_token_exchange=true will also break (intended).',
    type:         'boolean',
    defaultValue: false,
    warnIfEnabled: false,
  },

  // ── A2A Delegation ──────────────────────────────────────────────────────────
  {
    id:           'ff_a2a_delegation',
    name:         'A2A — Agent-to-Agent specialist delegation (RFC 8693 nested-act)',
    category:     'A2A Delegation',
    description:
      'Enables chained RFC 8693 token exchange for specialist delegation. When a heuristic tool is ' +
      'flagged `a2aDelegated: true` in scope-topology.json, the generalist agent (Agent 1) delegates ' +
      'to a per-vertical specialist (Agent 2) via a nested `act` chain instead of the standard BFF preflight. ' +
      'Exchange #1: user token → Agent 1 delegated token (aud: a2a-intermediate). ' +
      'Exchange #2: Exchange #1 token + specialist actor → nested-act token (aud: mcpgateway).',
    impact:
      'ON = heuristic A2A tools (e.g. sensitive_patient_records) route through executeA2aDelegation, producing a ' +
      '"Delegation complete" response with act-chain depth. ' +
      'OFF (default) = A2A tools fall through to the standard BFF preflight.',
    type:         'boolean',
    defaultValue: false,
  },

  // ── PingOne Authorize — Group Policy ──────────────────────────────────────
  {
    id:           'ff_authorize_group_policy',
    name:         'Authorize — Group / Entitlement Check',
    category:     'PingOne Authorize',
    description:
      'Enables group-membership enforcement in the PingOne Authorize decision. ' +
      'When ON, `groupPolicy.isEnabled()` returns true and the simulated/real Authorize ' +
      'engine checks the user\'s PingOne group and returns DENY when the user is not ' +
      'entitled. Simulated-only on PingOne SaaS; real cloud requires a group-membership ' +
      'policy configured in PingOne Authorize.',
    impact:
      'OFF (default) = group check is a no-op; all users may access group-restricted tools. ' +
      'ON = DENY returned for users not in the required group (simulated: always; real: requires P1AZ policy).',
    type:         'boolean',
    defaultValue: false,
  },

  // ── Token Exchange ──────────────────────────────────────────────────────────
  {
    id:           'ff_inject_may_act',
    name:         'Token Exchange — Auto-inject may_act (BFF synthetic)',
    category:     'Token Exchange',
    description:
      'When the user access token is missing a `may_act` claim, the BFF **synthesises** one ' +
      '(`{ client_id: <bff-client-id> }`) before attempting RFC 8693 token exchange. ' +
      'This lets you demo a successful exchange without modifying PingOne token policies. ' +
      '**Educational only** — PingOne still validates the real token; the synthetic claim only affects what the ' +
      'BFF passes as `subject_token`. Disable in production once PingOne is configured to add `may_act` natively.',
    impact:
      'OFF (default) = missing may_act shows a warning and exchange may fail per PingOne policy. ' +
      'ON = BFF adds synthetic may_act before exchange; Token Chain shows an "injected" badge.',
    type:         'boolean',
    defaultValue: false,
    warnIfEnabled: true,
  },
  {
    id:           'ff_inject_audience',
    name:         'Token Exchange — Auto-inject audience (BFF synthetic)',
    category:     'Token Exchange',
    description:
      'When the user access token\'s `aud` claim does not include `mcp_resource_uri`, the BFF **adds it** ' +
      'to the local claim snapshot before validation. This mirrors the behaviour when PingOne is configured to ' +
      'include the resource URI in issued access tokens (RFC 8707 resource indicators). ' +
      '**Educational only** — the JWT itself is unchanged; only the BFF\'s internal claim snapshot is updated for ' +
      'Token Chain display. Disable in production once PingOne is configured to issue tokens with the correct audience.',
    impact:
      'OFF (default) = missing resource URI in aud is shown as-is; exchange may fail with audience mismatch. ' +
      'ON = BFF adds mcp_resource_uri to the aud snapshot; Token Chain shows an "injected" badge.',
    type:         'boolean',
    defaultValue: false,
    warnIfEnabled: true,
  },
  {
    id:           'ff_dpop',
    name:         'DPoP — Sender-constrained tokens (RFC 9449)',
    category:     'Token Exchange',
    description:
      'Binds the delegated MCP token to a per-session ephemeral key (cnf.jkt) and sends a signed ' +
      'DPoP proof on each hop, so a stolen bearer is useless without the private key. ' +
      '**Simulated mode** (PingOne SaaS): the key thumbprint rides the trusted TraT envelope since ' +
      'PingOne does not yet issue cnf in the token; the proof crypto is real either way. ' +
      'Flip to native when running against PingOne AIC / PingFederate 11.2+. ' +
      'Enforcement at the gateway/MCP server is hard only when REQUIRE_DPOP_PROOF=true; otherwise it observes + displays.',
    impact:
      'OFF (default) = bearer tokens only. ON = cnf.jkt binding + DPoP proof generated and shown in the Token Chain.',
    type:         'boolean',
    defaultValue: false,
  },
  {
    id:           'ff_rar',
    name:         'RAR — Intent-bound authorization (RFC 9396)',
    category:     'Token Exchange',
    description:
      'Builds `authorization_details` from the tool name + parameters (action, amount, payee) and carries them ' +
      'as the TraT `azd` field and the PingAuthorize decision context, so the agent is authorized for THIS specific ' +
      'action rather than a broad scope. The gateway enforces that actual tool-call params are a subset of the grant. ' +
      '**Simulated mode** (PingOne SaaS): the BFF builds the details since PingOne SaaS does not process ' +
      'authorization_details; flip to native on PingOne AIC / PingFederate 11.2+. ' +
      'Enforcement is hard only when REQUIRE_RAR_INTENT=true; otherwise it observes + displays.',
    impact:
      'OFF (default) = flat scopes only. ON = authorization_details built, shown in the Token Chain, and evaluated by Authorize.',
    type:         'boolean',
    defaultValue: false,
  },
  {
    id:           'ff_inject_scopes',
    name:         'Inject Banking Scopes (Demo Mode)',
    category:     'OAuth Scopes',
    description:
      'When enabled and the user access token lacks banking scopes (most common when PingOne custom resource server is not configured), ' +
      'the BFF injects `read write` scopes into the token claims before attempting MCP exchange. ' +
      'Injected scopes are marked with INJECTED labels in the Token Chain panel. This is **demo mode only** — not for production. ' +
      'In production, scopes come directly from PingOne via a properly configured resource server.',
    impact:
      'OFF (default) = no injection (real scopes only, empty if resource server missing). ' +
      'ON = scopes injected to allow demo to function without resource server setup. Marked as INJECTED in UI.',
    type:         'boolean',
    defaultValue: false,
    warnIfEnabled: true,
  },
  {
    id:           'ff_skip_token_exchange',
    name:         'Token Exchange — Skip RFC 8693 (direct user token)',
    category:     'Token Exchange',
    description:
      'When ON, the BFF **skips RFC 8693 token exchange** and passes the user\'s access token directly to the MCP server. ' +
      'The alternative (**OFF**, default) is full on-behalf-of exchange: the BFF mints a dedicated agent client-credentials ' +
      'token and performs RFC 8693 to produce a narrower, audience-scoped token with an `act` claim identifying the agent. ' +
      'Enable this flag when PingOne is not yet configured for token exchange — it lets you verify the rest of the MCP flow without needing a token exchange policy.',
    impact:
      'OFF (default) = RFC 8693 exchange — MCP server receives a scoped delegated token with act claim. ' +
      'ON = user\'s raw access token forwarded to MCP — no exchange, no act claim, potentially wider audience.',
    type:         'boolean',
    defaultValue: false,
    warnIfEnabled: true,
  },
  {
    id:           'ff_oidc_only_authorize',
    name:         'Login — OIDC-only authorize (no banking scopes)',
    category:     'Token Exchange',
    description:
      'When ON, the user login authorize request sends **only** `openid profile email offline_access` scopes. ' +
      'This fixes the PingOne **"May not request scopes for multiple resources"** error that occurs when ' +
      '`*` scopes are registered on a separate PingOne API Resource Server. ' +
      'Banking routes relax to session-based authorization (identity gates only). ' +
      'Best used together with **ff_skip_token_exchange** ON so the agent forwards the OIDC token directly to MCP.',
    impact:
      'OFF (default) = full scope list (OIDC + *) in authorize — works when banking scopes are plain app custom scopes. ' +
      'ON = OIDC-only authorize → no "multiple resources" error; banking scope gates on API routes relax to authenticated-session.',
    type:         'boolean',
    defaultValue: false,
    warnIfEnabled: false,
  },
  {
    id:           'introspectionProvider',
    name:         'Token Introspection Provider',
    category:     'MCP Server',
    description:
      'Controls which component performs RFC 7662 token introspection in the MCP authorization pipeline. ' +
      '**pinggateway** (default) = PingGateway (ForgeRock IG) introspects tokens against PingOne. ' +
      '**p1az** = PingOne Authorize receives the introspection result and evaluates policy based on token status.',
    impact:
      'pinggateway (default) = realistic production flow; PingGateway is the token issuer and introspects. ' +
      'p1az = optional; P1AZ receives introspection result as policy context. Both call PingOne SSO for token validation.',
    type:         'enum',
    options:      ['pinggateway', 'p1az'],
    defaultValue: 'pinggateway',
  },
  {
    id:           'ff_id_token_exchange',
    name:         'ID Token Exchange Mode',
    category:     'Token Exchange',
    description:  'When ON, the agent receives only the user\'s ID token (not the access token). The BFF performs RFC 8693 token exchange using the ID token as subject_token (subject_token_type: urn:ietf:params:oauth:token-type:id_token). Agent never holds broad user access token — scoped delegation only.',
    impact:       'OFF (default) = standard access token flows unchanged. ON = ID token used as exchange subject; set subject_token_type to id_token in exchange request.',
    type:         'boolean',
    defaultValue: false,
    warnIfEnabled: false,
  },
  {
    id:           'ff_token_auth_private_key_jwt',
    name:         'Client Auth — Private Key JWT (JWKS)',
    category:     'PingOne OAuth',
    description:
      'When **ON**, the BFF authenticates to the PingOne token endpoint with a signed JWT assertion ' +
      '(**private_key_jwt**, RFC 7521/7523) instead of a client secret. PingOne verifies the assertion against ' +
      'the public JWK registered on the application — no secret crosses the wire. Requires a configured ' +
      'private key (Application Configuration: PingOne Client JWT Private Key + Kid) and the matching public JWK ' +
      'registered on the BFF/admin app (tokenEndpointAuthMethod = PRIVATE_KEY_JWT).',
    impact:
      'OFF (default) = client_secret_basic / client_secret_post unchanged. ON = the admin client\'s token-endpoint ' +
      'calls (authorization_code, refresh, revoke, RFC 8693 exchanges) send client_assertion. Falls back to client_secret ' +
      'if no private key is configured.',
    type:         'boolean',
    defaultValue: false,
    docsUrl:      'https://docs.pingidentity.com/pingone/applications/p1_edit_application_oidc_connection.html',
  },
  {
    id:           'ff_private_key_jwt_token_exchange',
    name:         'Token Exchange — Use Dedicated Private Key JWT App',
    category:     'PingOne OAuth',
    description:
      'When **ON**, RFC 8693 token exchange uses a dedicated private_key_jwt application instead of the main admin app. ' +
      'The dedicated app authenticates via signed JWT assertion (RFC 7521/7523) — no client secret crosses the wire. ' +
      'Requires a configured dedicated exchanger app (Application Configuration: PingOne Private Key JWT Exchanger Client ID + Private Key + Kid) ' +
      'with PRIVATE_KEY_JWT tokenEndpointAuthMethod and token-exchange grant enabled.',
    impact:
      'OFF (default) = token exchange uses the main admin app with configured auth method (basic/post). ' +
      'ON = token exchange uses the dedicated app with private_key_jwt. Falls back to admin app if dedicated app is not provisioned.',
    type:         'boolean',
    defaultValue: true,
  },

  // ── LLM Chips ──────────────────────────────────────────────────────────────
  {
    id:           'ff_heuristic_enabled',
    name:         'LLM Chips — Use Heuristic Fast-Path',
    category:     'LLM Chips',
    description:
      'When **ON** (default), the agent uses fast heuristic queries for balance, accounts, and transactions (~200-300ms). ' +
      'When **OFF**, all queries go through the LLM for advanced analysis (~1-3s). Both modes show chips, but heuristics take a fast dedicated code path.',
    impact:
      'ON (default) = quick responses for balance/accounts/transactions via heuristic NL parser; LLM for analysis/insights. ' +
      'OFF = all queries routed through LLM (slower but more conversational/analytical).',
    type:         'boolean',
    defaultValue: true,
  },

  // ── UI / Dashboard ─────────────────────────────────────────────────────────
  {
    id:           'ff_show_agent_in_middle',
    name:         'Dashboard — Show Banking Column With Centered Agent',
    category:     'UI / Dashboard',
    description:
      'Controls the customer dashboard layout **only when the AI agent is placed in the center column**. ' +
      'When **OFF** (default), the banking-info column is hidden so the dashboard stays clean — ' +
      'balances and account details come from the agent response or its pop-out instead. ' +
      'When **ON**, the banking-info column is shown alongside the centered agent (legacy layout). ' +
      'The floating (corner FAB) and bottom-dock agent placements always show the banking column and are not affected by this flag.',
    impact:
      'OFF (default) = cleaner dashboard; with a centered agent only the Token Chain and the agent are shown, banking info via the agent / pop-out. ' +
      'ON = banking column also shown next to the centered agent.',
    type:         'boolean',
    defaultValue: false,
  },

  // ── UI / Dashboard (continued) ──────────────────────────────────────────────
  {
    id:           'ff_agent_results_panel',
    name:         'Banking Agent — Floating Results Panel',
    category:     'UI / Dashboard',
    description:
      'When **ON**, tool results (accounts, balance, transactions) open in a floating panel ' +
      'positioned to the left of the agent. When **OFF** (default), results appear inline ' +
      'in the chat thread only — no floating panel.',
    impact:
      'OFF (default) = results shown inline in chat; floating panel never rendered. ' +
      'ON = floating panel appears alongside the agent, resizable and positioned dynamically.',
    type:         'boolean',
    defaultValue: false,
  },
  {
    id:           'ff_agui_enabled',
    name:         'AG-UI Streaming Agent',
    category:     'UI / Dashboard',
    description:
      'When **ON**, the Banking Agent uses the AG-UI protocol (POST /api/agent/run, HTTP+SSE) ' +
      'instead of the legacy /api/banking-agent/message endpoint. Real-time STATE_DELTA events ' +
      'drive the Token Chain panel, MCP Traffic panel, Authorize Decision panel, and the ' +
      '"What\'s happening" activity narration live. ' +
      'When **OFF**, the legacy polling path is used.',
    impact:
      'ON (default) = AG-UI event stream; Token Chain, MCP, AuthZ, and activity-narration panels update in real time. ' +
      'OFF = legacy sendAgentMessage path.',
    type:         'boolean',
    defaultValue: true,
  },
  {
    id:           'ff_activity_narration',
    name:         "What's Happening Activity Panel",
    category:     'UI / Dashboard',
    description:
      'When **ON**, the "What\'s happening" panel displays real-time activity narration ' +
      '(confirming identity, delegation, tool steps, security decisions, the answer) during agent execution. ' +
      'The panel is always visible when enabled — no toggle to close it.',
    impact:
      'ON (default) = activity narration panel always shows and updates live during agent runs. ' +
      'OFF = panel hidden entirely.',
    type:         'boolean',
    defaultValue: true,
  },
  {
    id:           'ff_use_cases_launcher',
    name:         'Use-Case Launcher',
    category:     'UI / Dashboard',
    description:
      'Enables the /use-cases catalog page that groups all 22 AI-agent security use cases by track ' +
      '(foundations / controls / attacks) with run buttons and "what to say" captions.',
    impact:
      'ON (default) = /use-cases page accessible to any logged-in user; attack buttons are disabled ' +
      'until the attack simulator (A6) ships. OFF = page redirects to home.',
    type:         'boolean',
    defaultValue: true,
  },
  {
    id:           'ff_agent_clinical_split',
    name:         'Agent Clinical Split (2B refined)',
    category:     'UI / Dashboard',
    description:
      'When **ON**, /dashboard renders the 2B-refined clinical split layout ' +
      '(chat-left, audit-timeline-right) with a Talk · Inspect · Configure tab rail. ' +
      'Replaces the legacy split3 + token-display chrome. ' +
      'When **OFF** (default), the existing dashboard layout is unchanged.',
    impact:
      'OFF (default) = legacy dashboard chrome unchanged. ' +
      'ON = clinical split host renders; Theme/Middle-Float/Always-float toggle is hidden.',
    type:         'boolean',
    defaultValue: false,
  },
  {
    id:           'llm_framework',
    name:         'LLM Agent Framework',
    category:     'UI / Dashboard',
    description:
      'Selects which agent framework handles POST /api/agent/run requests. ' +
      '**langchain** (default) — LangChain agent on port 8889. ' +
      '**openai_agents** — OpenAI Agents SDK on port 8891. ' +
      '**mastra** — Mastra agent on port 8892. ' +
      '**pydantic_ai** — Pydantic AI agent on port 8893.',
    impact:
      'Changes take effect immediately — no restart required. ' +
      'Only switch to a framework whose service is running.',
    type:         'enum',
    options:      ['langchain', 'openai_agents', 'mastra', 'pydantic_ai'],
    defaultValue: 'langchain',
  },
  {
    id:           'ff_authorize_rules_panel',
    name:         'Authorize Rules Panel',
    category:     'UI / Dashboard',
    description:
      'When **ON**, an Authorize Rules Panel is shown on the customer dashboard, ' +
      'letting users browse active authorization policy rules and test transactions ' +
      'against the engine. Always visible in /configure (Authorize tab) regardless of this flag.',
    impact:
      'OFF = panel hidden on /dashboard. ON (default) = panel appears on the dashboard below the main content area.',
    type:         'boolean',
    defaultValue: true,
  },
  {
    id:           'ff_admin_skin_ping2026',
    name:         'Admin UI — New Ping Console Skin',
    category:     'UI / Dashboard',
    description:
      'When **ON** (default), the admin sidebar and admin page chrome use the redesigned ' +
      'PingOne console look — light sidebar, Ping wordmark, light-gray content background. ' +
      'When **OFF**, the classic dark sidebar is shown. Visual skin only: nav items, routes, ' +
      'and behavior are identical in both skins. Takes effect on next page load.',
    impact:
      'ON (default) = new Ping console skin. OFF = classic dark admin sidebar (instant revert, no redeploy).',
    type:         'boolean',
    defaultValue: true,
  },
  {
    id:           'ff_customer_skin_ping2026',
    name:         'Customer UI — New Ping2026 Skin',
    category:     'UI / Dashboard',
    description:
      'When **ON**, the customer dashboard renders the redesigned `UserDashboardPing2026` component ' +
      '(new layout, vertical switcher, live optimistic data, inline token chain). ' +
      'When **OFF** (default), the classic `UserDashboard` component is shown. ' +
      'The old component is frozen; flag OFF is a total revert with no redeploy required.',
    impact:
      'OFF (default) = classic customer dashboard, no change. ' +
      'ON = new Ping2026 customer dashboard component; requires B2 behaviors to be built before enabling in production.',
    type:         'boolean',
    defaultValue: false,
  },
  {
    id:           'ff_mcp_gateway_pinggateway',
    name:         'Use PingOne Agent Gateway',
    category:     'MCP / Agent',
    description:
      'When **ON**, the BFF routes MCP traffic through the **PingOne Agent Gateway** (Ping Identity ' +
      'Gateway / IG) instead of the **Demo Agent Gateway** (the homegrown Node gateway). The PingOne ' +
      'Agent Gateway performs inbound token introspection via McpProtectionFilter, mirrors the Demo ' +
      'Agent Gateway PingOneAuthorizeClient decision, and performs an IG-native RFC 8693 token exchange ' +
      'to the backend MCP servers. Its authorize backend is live-switchable (mock demo_authz_server vs ' +
      'real PingOne Authorize) and follows the same **Simulated Authorize** (ff_authorize_simulated) ' +
      'toggle, carried via the X-Authz-Simulated request header. When **OFF**, traffic goes ' +
      'through the Demo Agent Gateway as normal.',
    impact:
      'OFF = Demo Agent Gateway path unchanged. ' +
      'ON (default) = the PingOne Agent Gateway is the MCP enforcement point; the Demo Agent Gateway P1AZ flag should be OFF to avoid double-evaluation.',
    type:         'boolean',
    defaultValue: false,
  },
  {
    id:           'ff_mcp_rate_limit',
    name:         'UC18 Gateway Rate Limiting',
    category:     'MCP / Agent',
    description:
      'When **ON**, enables per-agent/per-tool sliding-window rate limiting at the Demo Agent Gateway. ' +
      'Requests that exceed the burst limit receive a 429 response with `code: "rate_limited"` and a ' +
      '`retryAfterMs` value. The limiter runs before PingOne Authorize is called, so throttled requests ' +
      'do not consume P1AZ quota. The gateway process must also have `GATEWAY_RATE_LIMIT_ENABLED=true` ' +
      'in its environment — the BFF flag and gateway env var are intentionally independent (the gateway ' +
      'has no configStore). When **OFF** (default), no rate-limiting occurs.',
    impact:
      'OFF (default) = no rate-limiting at the gateway; all tool calls proceed normally. ' +
      'ON = bursts exceeding GATEWAY_RATE_LIMIT_MAX_REQUESTS per GATEWAY_RATE_LIMIT_WINDOW_MS ' +
      'per (agentSub, toolName) key return 429. Enable for UC18 resource-overload defense demos.',
    type:         'boolean',
    defaultValue: false,
  },

  // ── CIBA ───────────────────────────────────────────────────────────────────
  {
    id:           'ciba_enabled',
    name:         'CIBA — Out-of-Band Approval (UC22)',
    category:     'CIBA',
    description:
      'Enables the CIBA (Client-Initiated Backchannel Authentication) out-of-band ' +
      'approval flow. When ON, the BFF\'s CIBA service is active and the `/api/ciba/*` ' +
      'routes accept requests. Corresponds to the CIBA_ENABLED env var and the ' +
      '`ciba_enabled` configStore key. Required for UC22 (CIBA out-of-band approval) ' +
      'to run.',
    impact:
      'OFF (default) = CIBA routes disabled; UC22 cannot run. ' +
      'ON = CIBA service active; UC22 launcher enabled.',
    type:         'boolean',
    defaultValue: false,
  },

];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Resolve current value of a flag from configStore.
 * Falls back to the registry's defaultValue if not set.
 */
function resolveFlag(flag) {
  // Flags with a runtimeKey are mirrored into runtimeSettings (in-memory, the
  // source consumers actually read — e.g. mcpInspector / mcpLocalTools read
  // runtimeSettings.get('stepUpEnabled')). Report the live runtime value so the
  // GET response, the UI toggle, and the enforcement path never disagree.
  if (flag.runtimeKey) {
    const live = runtimeSettings.get(flag.runtimeKey);
    if (live !== undefined) {
      return flag.type === 'boolean' ? (live === true || live === 'true') : live;
    }
  }
  const raw = configStore.get(flag.id);
  if (raw === null || raw === undefined) return flag.defaultValue;
  if (flag.type === 'boolean') return raw === true || raw === 'true';
  return raw;
}

/** Serialize a flag + its current value for the API response. */
function serializeFlag(flag) {
  return {
    id:             flag.id,
    name:           flag.name,
    category:       flag.category,
    description:    flag.description,
    impact:         flag.impact,
    type:           flag.type,
    defaultValue:   flag.defaultValue,
    value:          resolveFlag(flag),
    ...(flag.options      && { options:      flag.options }),
    ...(flag.docsUrl      && { docsUrl:      flag.docsUrl }),
    ...(flag.warnIfDisabled && { warnIfDisabled: flag.warnIfDisabled }),
    ...(flag.warnIfEnabled  && { warnIfEnabled:  flag.warnIfEnabled }),
  };
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

/** GET /api/admin/feature-flags — returns all flags with current values */
router.get('/', async (req, res) => {
  try {
    const flags = FLAG_REGISTRY.map(serializeFlag);
    const categories = [...new Set(FLAG_REGISTRY.map(f => f.category))];
    res.json({ flags, categories });
  } catch (err) {
    console.error('[featureFlags] GET error:', err.message);
    res.status(500).json({ error: 'Failed to read feature flags', message: err.message });
  }
});

/** PATCH /api/admin/feature-flags — update one or more flag values */
router.patch('/', async (req, res) => {
  const { updates } = req.body;
  if (!updates || typeof updates !== 'object') {
    return res.status(400).json({ error: 'Body must be { updates: { flagId: value } }' });
  }

  const flagsById  = new Map(FLAG_REGISTRY.map(f => [f.id, f]));
  const toSave     = {};
  const runtimeUpdates = {};

  for (const [id, value] of Object.entries(updates)) {
    const flag = flagsById.get(id);
    if (!flag) continue;
    // Validate the value against the flag's type before persisting. Without this,
    // a caller can poison a flag (e.g. an enum value outside its options, or a
    // non-boolean for a boolean flag) — this route is intentionally unauthenticated.
    if (flag.type === 'enum') {
      if (!Array.isArray(flag.options) || !flag.options.includes(value)) {
        return res.status(400).json({
          error: `Invalid value for "${id}"`,
          allowed: flag.options || [],
        });
      }
    } else if (flag.type === 'boolean') {
      if (value !== true && value !== false && value !== 'true' && value !== 'false') {
        return res.status(400).json({
          error: `Invalid value for "${id}" — expected a boolean`,
        });
      }
    }
    // Normalise booleans to strings for configStore
    toSave[id] = typeof value === 'boolean' ? String(value) : value;
    // Flags with a runtimeKey ALSO mirror into runtimeSettings so the toggle
    // takes effect on the live process immediately (consumers read
    // runtimeSettings, not configStore). configStore persists it across
    // restarts; the boot seed in server.js re-applies it on next start.
    if (flag.runtimeKey) {
      runtimeUpdates[flag.runtimeKey] =
        flag.type === 'boolean' ? (value === true || value === 'true') : value;
    }
  }

  if (Object.keys(toSave).length === 0) {
    return res.status(400).json({ error: 'No valid flag IDs provided', allowed: [...flagsById.keys()] });
  }

  try {
    await configStore.setRaw(toSave);
    if (Object.keys(runtimeUpdates).length > 0) {
      runtimeSettings.update(runtimeUpdates, 'feature-flags-api');
    }
    const updatedFlags = FLAG_REGISTRY.filter(f => f.id in toSave).map(serializeFlag);
    res.json({ updated: true, flags: updatedFlags });
  } catch (err) {
    console.error('[featureFlags] PATCH error:', err.message);
    res.status(500).json({ error: 'Failed to save feature flags', message: err.message });
  }
});

module.exports = { router, FLAG_REGISTRY };
