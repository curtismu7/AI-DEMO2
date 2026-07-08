// Agent action/chip catalog, role-aware suggested prompts, education topic copy,
// and NL chip-prompt maps — extracted from AIAgent.js. Pure data + one pure helper.
// ACTIONS is the flattened ACTION_GROUPS; getStepSkipExplanation reads
// CHIP_APPLICABLE_STEPS; TOPIC_MESSAGES is keyed by EDU topic ids.
import { EDU } from "./education/educationIds";

export const ACTION_GROUPS = {
  account: [
    {
      id: "accounts",
      label: "My Accounts",
      desc: "List all your accounts",
      rfcs: ["8693", "7515", "7662"],
    },
    {
      id: "balance",
      label: "Check Balance",
      desc: "Balance for an account",
      rfcs: ["8693", "7515"],
    },
    {
      id: "sensitive-account-details",
      label: "View Sensitive Account Details",
      desc: "View full account number and routing number (requires consent)",
      rfcs: ["8693", "7515", "9470"],
      hitlTrigger: true,
    },
    {
      id: "sequential_think",
      label: "Think Through a Question",
      desc: "Reason step-by-step through a banking question or decision",
      rfcs: [],
    },
    {
      id: "logout",
      label: "Sign Out",
      desc: "Sign out of your account",
      rfcs: [],
    },
  ],
  transaction: [
    {
      id: "transactions",
      label: "Recent Transactions",
      desc: "View recent activity",
      rfcs: ["8693", "7515"],
    },
    {
      id: "deposit",
      label: "Deposit",
      desc: "Deposit into an account",
      rfcs: ["8693", "7515", "6749"],
    },
    {
      id: "withdraw",
      label: "Withdraw",
      desc: "Withdraw from an account",
      rfcs: ["8693", "7515", "6749"],
    },
    {
      id: "transfer",
      label: "Transfer",
      desc: "Transfer between accounts",
      rfcs: ["8693", "7515", "6749", "9470"],
      hitlTrigger: true,
    },
  ],
  admin: [
    {
      id: "mcp_tools",
      label: "MCP Tools",
      desc: "List all available MCP tools",
      rfcs: [],
    },
    {
      id: "query_user",
      label: "Query User by Email",
      desc: "Check if a user exists by email address",
      rfcs: [],
    },
  ],
  ai: [
    {
      id: "ai_ask",
      label: "Ask AI Anything",
      desc: "Free-form question routed to active LLM (Helix or LM Studio)",
      rfcs: [],
    },
    {
      id: "ai_helix_demo",
      label: "LLM Demo: Ask Helix",
      desc: "Ask Helix LLM a financial question (if configured)",
      rfcs: [],
    },
    {
      id: "ai_explain",
      label: "Explain a Concept",
      desc: "Ask the LLM to explain an OAuth or banking concept",
      rfcs: [],
    },
    {
      id: "ai_helix_explain",
      label: "LLM Demo: Explain w/ Helix",
      desc: "Explain an OAuth or banking concept using Helix LLM",
      rfcs: [],
    },
    {
      id: "ai_analyze",
      label: "Summarize How MCP Works",
      desc: "Ask the LLM to summarize the MCP tool flow in this demo",
      rfcs: [],
    },
    {
      id: "ai_advice",
      label: "Financial Advice",
      desc: "Ask the LLM for generic financial advice or tips",
      rfcs: [],
    },
    {
      id: "ai_helix_advice",
      label: "LLM Demo: Helix Financial Advice",
      desc: "Get financial tips from Helix LLM",
      rfcs: [],
    },
  ],
  testing: [
    {
      id: "demo_guide",
      label: " Demo Guide",
      desc: "Interactive guide: learn how to demo the agent, what prompts to use, what to watch for",
      rfcs: [],
    },
    {
      id: "test_full_compliance_flow",
      label: "Full Compliance (12 Steps)",
      desc: "High-value sensitive account transfer with MFA + HITL — exercises ALL 12 compliance steps end-to-end",
      rfcs: ["8693", "7515", "7662", "9470", "6749"],
    },
    {
      id: "test_wrong_scope",
      label: "Test Wrong Scope",
      desc: "Send request with unauthorized scope (auth rejection)",
      rfcs: ["6749"],
    },
    {
      id: "test_wrong_audience",
      label: "Test Wrong Audience",
      desc: "Send request with wrong audience (auth rejection)",
      rfcs: ["8693", "8707"],
    },
    {
      id: "test_hitl_required",
      label: "Test HITL Transfer",
      desc: "Attempt high-value transfer (requires consent)",
      rfcs: ["8693", "9470"],
    },
    {
      id: "transfer_600_test",
      label: "Transfer $600",
      desc: "Test HITL consent + MFA flow with $600 transfer",
      rfcs: ["8693", "7515", "7662", "9470"],
    },
    {
      id: "test_otp_required",
      label: "Test OTP Challenge",
      desc: "Trigger OTP/MFA step-up authentication",
      rfcs: ["9470"],
    },
    {
      id: "demo_intent_delegation",
      label: "Intent-Bound Transfer",
      desc: "High-value transfer with intent-bound delegation: RFC 8693 constraint enforcement + HITL consent",
      rfcs: ["8693", "8707", "9470"],
    },
    {
      id: "demo_nl_routing",
      label: "NL: Ask the Agent",
      desc: "Natural language query routed through LLM — exercises step 1a (LLM routing) in compliance checklist",
      rfcs: [],
    },
    {
      id: "api_key_demo",
      label: "API-Key Path Demo",
      desc: "Exercise gateway API-key credential swap (Path A) — tool 'special_offers' via Phase 266 gateway router",
      rfcs: ["8693"],
    },
    {
      id: "dual_token_demo",
      label: "Access + ID-Token Path Demo",
      desc: "Exercise gateway dual-token path (Path B) — tool 'user_profile_card' via Phase 266 gateway router",
      rfcs: ["8693", "8707"],
    },
  ],
};

// Steps each chip exercises — used to highlight applicable rows in the compliance panel
export const CHIP_APPLICABLE_STEPS = {
  accounts: [
    "agent-llm-reasoning",
    "agent-token-init",
    "gw-scope-map",
    "agent-scope-aware-cache",
    "olb-resource-token",
    "claim-diagnostics",
  ],
  transactions: [
    "agent-llm-reasoning",
    "agent-token-init",
    "gw-scope-map",
    "agent-scope-aware-cache",
    "olb-resource-token",
    "claim-diagnostics",
  ],
  mcp_tools: [
    "agent-llm-reasoning",
    "agent-token-init",
    "gw-scope-map",
    "agent-scope-aware-cache",
    "olb-resource-token",
    "claim-diagnostics",
  ],
  balance: [
    "agent-llm-reasoning",
    "agent-token-init",
    "gw-scope-map",
    "agent-scope-aware-cache",
    "olb-resource-token",
    "claim-diagnostics",
  ],
  deposit: [
    "agent-llm-reasoning",
    "agent-token-init",
    "gw-scope-map",
    "agent-scope-aware-cache",
    "olb-resource-token",
    "claim-diagnostics",
  ],
  withdraw: [
    "agent-llm-reasoning",
    "agent-token-init",
    "gw-scope-map",
    "agent-scope-aware-cache",
    "olb-resource-token",
    "claim-diagnostics",
  ],
  transfer: [
    "agent-llm-reasoning",
    "agent-token-init",
    "gw-scope-map",
    "agent-scope-aware-cache",
    "olb-resource-token",
    "claim-diagnostics",
  ],
  sequential_think: [
    "agent-llm-reasoning",
    "agent-token-init",
    "gw-scope-map",
    "agent-scope-aware-cache",
    "olb-resource-token",
    "claim-diagnostics",
  ],
  query_user: [
    "agent-llm-reasoning",
    "agent-token-init",
    "gw-scope-map",
    "agent-scope-aware-cache",
    "olb-resource-token",
    "claim-diagnostics",
  ],
  "sensitive-account-details": [
    "agent-llm-reasoning",
    "agent-token-init",
    "gw-scope-map",
    "gw-hitl-challenge-type",
    "agent-error-propagation",
    "agent-recovery-branch",
    "ui-gateway-consent",
    "agent-scope-aware-cache",
    "olb-resource-token",
    "claim-diagnostics",
  ],
  test_full_compliance_flow: [
    "agent-llm-reasoning",
    "agent-token-init",
    "gw-scope-map",
    "agent-scope-aware-cache",
    "olb-resource-token",
    "gw-denial-metadata",
    "gw-hitl-challenge-type",
    "bff-response-shape",
    "ui-gateway-consent",
    "ui-auto-refire",
    "agent-error-propagation",
    "claim-diagnostics",
  ],
  test_wrong_scope: [
    "agent-llm-reasoning",
    "agent-token-init",
    "agent-scope-aware-cache",
  ],
  test_wrong_audience: [
    "agent-llm-reasoning",
    "agent-token-init",
    "agent-scope-aware-cache",
    "bff-login-resume",
  ],
  test_hitl_required: [
    "agent-llm-reasoning",
    "agent-token-init",
    "agent-scope-aware-cache",
    "olb-resource-token",
    "gw-scope-map",
    "gw-denial-metadata",
    "bff-response-shape",
    "gw-hitl-challenge-type",
    "ui-gateway-consent",
    "ui-auto-refire",
  ],
  transfer_600_test: [
    "agent-llm-reasoning",
    "agent-token-init",
    "agent-scope-aware-cache",
    "olb-resource-token",
    "gw-scope-map",
    "gw-denial-metadata",
    "bff-response-shape",
    "gw-hitl-challenge-type",
    "ui-gateway-consent",
    "ui-auto-refire",
  ],
  test_otp_required: [
    "agent-llm-reasoning",
    "agent-token-init",
    "agent-scope-aware-cache",
    "olb-resource-token",
    "gw-scope-map",
    "gw-denial-metadata",
    "gw-hitl-challenge-type",
  ],
  demo_intent_delegation: [
    "agent-llm-reasoning",
    "agent-token-init",
    "agent-scope-aware-cache",
    "olb-resource-token",
    "gw-scope-map",
    "gw-denial-metadata",
    "bff-response-shape",
    "gw-hitl-challenge-type",
    "ui-gateway-consent",
    "ui-auto-refire",
  ],
  demo_nl_routing: [
    "agent-llm-reasoning",
    "agent-token-init",
    "gw-scope-map",
    "agent-scope-aware-cache",
    "olb-resource-token",
    "claim-diagnostics",
  ],
  ai_ask: [
    "agent-llm-reasoning",
    "agent-token-init",
    "gw-scope-map",
    "agent-scope-aware-cache",
    "olb-resource-token",
    "claim-diagnostics",
  ],
  ai_helix_demo: [
    "agent-llm-reasoning",
    "agent-token-init",
    "gw-scope-map",
    "agent-scope-aware-cache",
    "olb-resource-token",
    "claim-diagnostics",
  ],
  ai_explain: [
    "agent-llm-reasoning",
    "agent-token-init",
    "gw-scope-map",
    "agent-scope-aware-cache",
    "olb-resource-token",
    "claim-diagnostics",
  ],
  ai_helix_explain: [
    "agent-llm-reasoning",
    "agent-token-init",
    "gw-scope-map",
    "agent-scope-aware-cache",
    "olb-resource-token",
    "claim-diagnostics",
  ],
  ai_analyze: [
    "agent-llm-reasoning",
    "agent-token-init",
    "gw-scope-map",
    "agent-scope-aware-cache",
    "olb-resource-token",
    "claim-diagnostics",
  ],
  ai_advice: [
    "agent-llm-reasoning",
    "agent-token-init",
    "gw-scope-map",
    "agent-scope-aware-cache",
    "olb-resource-token",
    "claim-diagnostics",
  ],
  ai_helix_advice: [
    "agent-llm-reasoning",
    "agent-token-init",
    "gw-scope-map",
    "agent-scope-aware-cache",
    "olb-resource-token",
    "claim-diagnostics",
  ],
};

// Backwards compatibility: flat ACTIONS array from ACTION_GROUPS
export const ACTIONS = Object.values(ACTION_GROUPS).flat();

/**
 * Explains why a specific compliance step is skipped (not applicable) for a given action.
 * Maps step ID → human-readable explanation for that action type.
 */
export function getStepSkipExplanation(actionId, stepId) {
  const explanations = {
    // Test Wrong Audience: only auth init, no scope/gateway/consent flow
    test_wrong_audience: {
      "gw-scope-map":
        "Audience error caught at token init, no scope mapping needed",
      "gw-denial-metadata":
        "Auth error returned directly, no gateway denial structure",
      "bff-response-shape":
        "Audience mismatch returns error before denial formatting",
      "gw-hitl-challenge-type": "No HITL flow for auth errors",
      "agent-error-propagation":
        "Agent never receives tool list; init fails first",
      "agent-recovery-branch": "No login/HITL branch for audience mismatch",
      "agent-scope-aware-cache": "Already attempted at token init; fails there",
      "olb-resource-token": "Token exchange not required for auth failures",
      "ui-gateway-consent": "No consent dialog for authentication errors",
      "ui-auto-refire": "No re-fire after login for wrong audience",
      "claim-diagnostics": "Basic auth error, no claim inspection needed",
    },
    // Test Wrong Scope: auth succeeds but scope check fails at agent level
    test_wrong_scope: {
      "gw-scope-map":
        "Agent doesn't request tool list (tests scope rejection directly)",
      "gw-denial-metadata": "No gateway denial for simple scope mismatch",
      "bff-response-shape": "BFF error bypasses denial formatting",
      "gw-hitl-challenge-type": "No HITL flow for scope errors",
      "agent-error-propagation":
        "Agent detects scope missing before calling tools",
      "agent-recovery-branch":
        "Scope error is terminal, no login/HITL recovery",
      "olb-resource-token": "Token exchange fails at agent validation",
      "ui-gateway-consent": "No consent dialog for scope errors",
      "ui-auto-refire": "No re-fire after scope rejection",
      "claim-diagnostics": "Scope error detected before claim inspection",
    },
    // Simple read operations: no HITL, no gateway denial, just MCP call
    accounts: {
      "gw-denial-metadata": "Read-only operation, no gateway denial needed",
      "bff-response-shape": "No 401/403 JSON-RPC error response",
      "gw-hitl-challenge-type": "No HITL (Human-In-The-Loop) required",
      "agent-error-propagation": "No error branch for successful auth",
      "agent-recovery-branch": "No error recovery needed",
      "bff-login-resume": "No pending intent storage for simple reads",
      "ui-gateway-consent": "No HITL consent dialog needed",
      "ui-auto-refire": "No re-fire after successful auth",
    },
    transactions: {
      "gw-denial-metadata": "Read-only operation, no gateway denial needed",
      "bff-response-shape": "No 401/403 JSON-RPC error response",
      "gw-hitl-challenge-type": "No HITL required",
      "agent-error-propagation": "No error branch",
      "agent-recovery-branch": "No error recovery",
      "bff-login-resume": "No pending intent storage",
      "ui-gateway-consent": "No HITL consent dialog",
      "ui-auto-refire": "No re-fire needed",
    },
    balance: {
      "gw-denial-metadata": "Read-only, no gateway denial",
      "bff-response-shape": "No error response",
      "gw-hitl-challenge-type": "No HITL required",
      "agent-error-propagation": "No error branch",
      "agent-recovery-branch": "No recovery needed",
      "bff-login-resume": "No pending intent",
      "ui-gateway-consent": "No HITL consent",
      "ui-auto-refire": "No re-fire",
    },
    // Write operations (no HITL threshold) follow same pattern
    deposit: {
      "gw-denial-metadata": "Transaction below HITL threshold, no denial",
      "bff-response-shape": "No 401/403 response",
      "gw-hitl-challenge-type": "Amount below HITL minimum",
      "agent-error-propagation": "No error for successful transaction",
      "agent-recovery-branch": "No error recovery",
      "bff-login-resume": "No pending intent for approved transaction",
      "ui-gateway-consent": "No HITL consent (below threshold)",
      "ui-auto-refire": "No re-fire after approval",
    },
    withdraw: {
      "gw-denial-metadata": "Transaction below HITL threshold",
      "bff-response-shape": "No error response",
      "gw-hitl-challenge-type": "Amount below HITL minimum",
      "agent-error-propagation": "No error branch",
      "agent-recovery-branch": "No recovery needed",
      "bff-login-resume": "No pending intent",
      "ui-gateway-consent": "No HITL consent (below threshold)",
      "ui-auto-refire": "No re-fire",
    },
    transfer: {
      "gw-denial-metadata": "Transaction below HITL threshold",
      "bff-response-shape": "No error response",
      "gw-hitl-challenge-type": "Amount below HITL minimum",
      "agent-error-propagation": "No error branch",
      "agent-recovery-branch": "No recovery needed",
      "bff-login-resume": "No pending intent",
      "ui-gateway-consent": "No HITL consent (below threshold)",
      "ui-auto-refire": "No re-fire",
    },
    // HITL: all steps apply or most apply
    test_hitl_required: {
      "agent-scope-aware-cache":
        "Omitted: HITL test doesn't use full token exchange",
      "olb-resource-token": "Omitted: test uses simplified flow",
      "claim-diagnostics": "Omitted: test skips claim diagnostics",
    },
    transfer_600_test: {
      "agent-scope-aware-cache":
        "Omitted: HITL test doesn't use full token exchange",
      "olb-resource-token": "Omitted: test uses simplified flow",
      "claim-diagnostics": "Omitted: test skips claim diagnostics",
    },
  };

  const actionExplanations = explanations[actionId] || {};
  return actionExplanations[stepId] || "Not applicable to this action type";
}

// ─── Suggested prompts — role-aware ──────────────────────────────────────────

export const SUGGESTIONS_CUSTOMER = [
  "Show me my accounts",
  "Show me my full account details",
  "Transfer $100 from checking to savings",
  "Deposit $50 into checking",
];

export const SUGGESTIONS_ADMIN = [
  "Show all customer accounts",
  "Show me last 5 errors",
  "What is step-up auth?",
];

export const SUGGESTIONS_CONFIG_CUSTOMER = [
  "How do I change industry branding (e.g. FunnyBank) on the config page?",
  "How do Agent MCP scopes limit transfers vs read-only?",
  "What PingOne or OAuth environment variables does this app need?",
  "How should I set redirect URIs for local development?",
  "What OAuth scopes does the BFF use?",
  "What is PKCE and why does this app use it?",
  "List MCP tools",
  "How do I fix invalid_redirect_uri?",
];

export const SUGGESTIONS_CONFIG_ADMIN = [
  "How do I add a new industry preset (colors, logo) to this demo?",
  "What is agent_mcp_allowed_scopes and how does token exchange use it?",
  "What worker app credentials does the API server need in production?",
  "What redirect URIs should I register in PingOne for this demo?",
  "Show me last 5 errors",
  "List MCP tools",
  "How does token exchange work for the MCP server?",
  "What is CIBA?",
];

// ─── Education topic inline messages (module-level for performance) ───────────

export const TOPIC_MESSAGES = {
  [EDU.LOGIN_FLOW]: `Authorization Code + PKCE Flow:\n\n1. App generates code_verifier (random 64 bytes) + code_challenge (SHA-256 hash)\n2. Browser redirects to PingOne /as/authorize with challenge\n3. User authenticates → PingOne redirects back with code\n4. Backend-for-Frontend (BFF) exchanges code + verifier for tokens (server-side only)\n5. Browser never sees the token — only a session cookie\n\nPKCE prevents interception: even if code is stolen, attacker can't exchange it without the verifier.`,
  [EDU.TOKEN_EXCHANGE]: `RFC 8693 Token Exchange (User token → MCP token):\n\nWhy: The user token has broad scope. The MCP server needs a narrowly-scoped MCP token for least-privilege.\n\nHow:\n• Backend-for-Frontend (BFF) holds the User token (session access token)\n• Backend-for-Frontend (BFF) calls PingOne /as/token with grant_type=urn:ietf:params:oauth:grant-type:token-exchange\n• User token is subject_token; agent client credentials are actor_token\n• PingOne validates may_act on the User token and issues an MCP token\n• MCP token has: sub=user, act={client_id=agent}, narrow scope, MCP audience\n\nmay_act on the User token → act on the MCP token — proving delegation chain.`,
  [EDU.MAY_ACT]: `may_act / act Claims (RFC 8693 §4.1):\n\nmay_act on the User token: "this client is allowed to act on my behalf"\n  { "sub": "user-uuid", "may_act": { "client_id": "bff-admin-client" } }\n\nact on the MCP token (exchanged token): "this action was delegated"\n  { "sub": "user-uuid", "act": { "client_id": "bff-admin-client" } }\n\nThe MCP server validates act to confirm the Backend-for-Frontend (BFF) is the authorized actor — not just any client that got a token.`,
  [EDU.MCP_PROTOCOL]: `Model Context Protocol (MCP):\n\nMCP is a JSON-RPC 2.0 protocol over WebSocket (or stdio/SSE) for AI tools.\n\nHandshake:\n  initialize → { protocolVersion, capabilities, serverInfo }\n  → notifications/initialized (client notification)\n\nDiscovery:\n  tools/list → [{ name, description, inputSchema }]\n\nExecution:\n  tools/call { name, arguments } → { content: [{ type, text }] }\n\nIn this demo:\n  Browser → Backend-for-Frontend (BFF) (/api/mcp/tool) → MCP Server (WebSocket) → Demo API\n\nToken flow: Backend-for-Frontend (BFF) performs RFC 8693 exchange before forwarding tool calls.`,
  [EDU.INTROSPECTION]: `RFC 7662 Token Introspection (BFF → PingOne):\n\nThe BFF (not the MCP server) calls PingOne introspection in two places:\n  1. At login — immediately after the OAuth callback to confirm the session is live\n  2. Before every MCP tool call — to catch revoked/expired sessions before token exchange\n\n  POST /as/introspect\n  { token: "...", token_type_hint: "access_token" }\n  → { active: true, sub, scope, exp, aud, client_id }\n\nWhy introspection for the user token specifically?\n• Catches revoked sessions in real time (JWKS cannot detect revocation)\n• The result is shown in the Token Chain as "user-token-introspection"\n\nAll other tokens (agent CC token, exchanged MCP tokens) use RFC 7515 JWKS\nsignature verification instead — local, fast, and tamper-evident.`,
  [EDU.STEP_UP]: `Step-Up Authentication (RFC 9470):\n\nTriggered when a high-value action requires stronger auth:\n• Transfer amount ≥ threshold (set in Security Settings) → require MFA\n• BFF returns HTTP 428 with WWW-Authenticate: Bearer scope="step_up"\n\nTwo methods:\n1. OTP / CIBA: PingOne sends code to registered device (out-of-band)\n2. Redirect: Browser → /api/auth/oauth/user/stepup?acr_values=Multi_Factor → PingOne MFA\n\nAfter the user completes MFA — PingOne (the AS) authorizes based on:\n  • Scope: confirms transfer is allowed under this policy\n  • ACR: confirms MFA assurance level was achieved\n  • Threshold: token issued only after identity verification at required level\n\nPingOne issues a new elevated token:\n  { acr: "Multi_Factor", scope: "transfer", sub: user }\nBFF receives it → introspects it (RFC 7662) to confirm active + acr claims\nBFF exchanges it for a delegated MCP token (RFC 8693): subject_token=elevated user AT + actor_token=agent AT → token with acr=Multi_Factor, aud=mcp-gw, act.sub=agent\nPing Agent Gateway forwards that token unchanged to the MCP Server\nToken JWKS-verified (RFC 7515) before any tool call\nOriginal transaction retried automatically.`,
  [EDU.AGENT_GATEWAY]: `Agent Gateway / Resource Indicators (RFC 8707):\n\nRFC 8707: client specifies the resource URI when requesting a token\n  /as/token?resource=https://mcp.example.com\n  → token aud = "https://mcp.example.com"\n\nRFC 9728: Protected Resource Metadata\n  GET https://mcp.example.com/.well-known/oauth-protected-resource\n  → { resource, authorization_servers, scopes_supported }\n\nThis lets a dynamic AI agent discover what auth is needed before attempting a tool call — no hardcoded configuration.`,
  [EDU.PINGONE_AUTHORIZE]: `PingOne Authorize (DaVinci):\n\nPingOne Authorize evaluates access policies at runtime using DaVinci flows.\n\nIn this demo it drives:\n• Step-up MFA triggers (ACR values like "Multi_factor")\n• CIBA push notifications to the user's device\n• Dynamic consent for high-value transactions\n\nThe acr_values parameter in /as/authorize tells PingOne which DaVinci policy to run.`,
  [EDU.CIMD]: `Client ID Metadata Document (CIMD / RFC 7591):\n\nTraditional OAuth: client_id is an opaque string, pre-registered in the AS.\nCIMD: client_id is a URL you control — it hosts the client's metadata.\n\nThe AS fetches the URL to discover:\n  { redirect_uris, grant_types, scope, client_name, logo_uri, … }\n\nBenefits:\n• No pre-registration — client registers itself\n• Client controls updates (change the hosted document)\n• Works across AS instances that support DCR/RFC 7591\n\nIn this demo: click "Simulate" in the CIMD panel to see PingOne dynamic client registration.`,
  [EDU.LANGCHAIN]: `LangChain (LCEL + Helix):\n\nLangChain 0.3.x modernises AI agent composition:\n• LCEL (LangChain Expression Language): chain = prompt | llm.bind_tools(tools)\n• Helix LLM by default; LM Studio supported for local inference\n• Security: token custody stays BFF-side — tokens never reach the browser\n\nDeep dive: open /langchain or click the badge → Learn more`,
  [EDU.HUMAN_IN_LOOP]: `Human-in-the-loop (HITL) for the AI agent:\n\n• Over $500 the server issues a consent challenge in your session; after you confirm in the consent popup, POST /transactions must include matching consentChallengeId (one-time use).\n• The agent cannot complete that path without your browser session.\n• If you decline, this demo disables the assistant until you sign out and sign in again.\n• HITL differs from MITM (attack). Open the drawer: What is HITL · Patterns & best practices · This app and the agent · Declining and lockout.`,
};

// ─── Inline HITL consent card (middle / dock surfaces) ─────────────────

/**
 * @param {object} props
 * @param {'float' | 'inline'} [props.mode]
 * @param {boolean} [props.embeddedDockBottom] When inline, stack chat on top and suggestions below (dashboard bottom bar)
 * @param {'banking' | 'config'} [props.embeddedFocus] When `config`, dock on Application Configuration emphasizes setup (not transfers).
 * @param {boolean} [props.distinctFloatingChrome] When floating, stronger card/chrome so it reads as a separate widget vs the page.
 * @param {boolean} [props.splitColumnChrome] Inline mode: compact "assistant" chrome for token | agent | banking columns (navy header, chat bubbles).
 */

// Chips that always call the real API regardless of LLM mode.
// Helix has no account data access and would hallucinate if sent as NL prompts.
export const API_DIRECT_CHIPS = new Set([
  "accounts", "transactions", "balance", "transfer", "deposit", "withdraw", "feature",
  "mcp_tools", "sensitive-account-details",
  "test_wrong_scope", "test_wrong_audience", "test_hitl_required",
  "transfer_600_test", "test_otp_required",
  "demo_intent_delegation", "test_full_compliance_flow",
]);

// NL prompts for conversational chips in Helix (LLM-only) mode.
// API_DIRECT_CHIPS are excluded — they bypass Helix entirely.
export const CHIP_NL_PROMPTS = {
  biggest_purchase: "What is my biggest purchase?",
  spending_summary: "Give me a spending summary",
  unusual_patterns: "Check for unusual patterns",
  afford_check: "Could my savings cover a big upcoming expense?",
  query_user: "Query user by email: ",
  sequential_think: "Think: Should I transfer money from checking to savings?",
  demo_nl_routing: "What is my checking account balance?",
  ai_ask: "What can you help me with?",
  ai_helix_demo: "Tell me about interest rates",
  ai_explain: "Explain how token exchange works",
  ai_helix_explain: "Explain what OAuth scopes are",
  ai_analyze: "Summarize how MCP tool delegation works in this demo",
  ai_advice: "Give me some financial advice",
  ai_helix_advice: "What are some tips for saving money?",
};
