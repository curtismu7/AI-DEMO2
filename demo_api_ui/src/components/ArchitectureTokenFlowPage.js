/**
 * ArchitectureTokenFlowPage.js — /architecture/token-flow
 *
 * 15-step simulation showing every token hop in the banking demo flow.
 * Each step shows:
 *   - Highlighted regions on the PNG diagram
 *   - Token side card (white bg, readable text, RFC badges)
 *   - Dual tokens where applicable (ID token + Access token at login)
 *   - RFC 8693 stacked Request/Issued for both exchange steps
 *   - Aud trail strip above diagram
 *   - ← Prev / Pause / Resume / Next → / Stop controls
 */
import React, { useState, useEffect, useRef, useCallback } from "react";
import apiClient from "../services/apiClient";
import ArchitectureDiagramPage from "./ArchitectureDiagramPage";
import TokenStepIndicator from "./TokenStepIndicator";
import { STEP_TIME_OPTIONS, DEFAULT_STEP_MS } from "./diagram";
import { TOKEN_FLOW_REGIONS } from "../config/diagram-token-flow-regions";

const TOKEN_FLOW_EVENT_MAP = [
  {
    category: "agent_prompt",
    tags: ["agent_prompt/llm_invoke"],
    regionIds: ["agent1", "llm"],
    colorClass: "active",
  },
  {
    category: "agent_prompt",
    tags: ["agent_prompt/llm_complete"],
    regionIds: ["agent1"],
    colorClass: "active",
  },
  {
    category: "agent_prompt",
    tags: ["agent_prompt/heuristic_tool"],
    regionIds: ["agent1"],
    colorClass: "active",
  },
  {
    category: "token_exchange",
    tags: ["token_exchange/rfc8693-success"],
    regionIds: ["pingone-aic", "token-exchange-box", "mcp-gateway-tf"],
    colorClass: "active",
  },
  {
    category: "token_exchange",
    tags: ["token_exchange/rfc8693-error"],
    regionIds: ["pingone-aic", "token-exchange-box", "mcp-gateway-tf"],
    colorClass: "active-error",
  },
  {
    category: "authorize",
    tags: ["authorize/bypass"],
    regionIds: ["pingauthorize-tf"],
    colorClass: "active",
  },
  {
    category: "authorize",
    tags: ["authorize/permit"],
    regionIds: ["pingauthorize-tf"],
    colorClass: "active-permit",
  },
  {
    category: "authorize",
    tags: ["authorize/deny"],
    regionIds: ["pingauthorize-tf"],
    colorClass: "active-error",
  },
  {
    category: "oauth",
    tags: ["oauth/user/callback"],
    regionIds: ["olb-application", "pingone-aic"],
    colorClass: "active",
  },
  {
    category: "oauth",
    tags: [],
    regionIds: ["olb-application", "pingone-aic"],
    colorClass: "active",
  },
  {
    category: "mcp",
    tags: [],
    regionIds: ["mcp-gateway-tf"],
    colorClass: "active",
  },
  {
    category: "agent",
    tags: ["agent/message"],
    regionIds: ["chatbot"],
    colorClass: "active",
  },
];

// ─── Simulation steps ─────────────────────────────────────────────────────────
// token  = primary card   token2 = secondary card (dual display)
// isTokenExchange = true  → stacked Request / ↓ Issued layout
// _type controls accent border color: oauth | exchange | permit | hitl | idtoken | mcp
// _rfcs = RFC badge pills shown in card header

const TOKEN_FLOW_SIMULATE_STEPS = [
  {
    regionIds: ["olb-application"],
    colorClass: "active",
    label: "User sends request",
    // U → CB  (i6, y=407)
    stepArrow: { yPct: 8.2, xMinPct: 3.7, xMaxPct: 19.5 },
    token: null,
  },
  {
    regionIds: ["olb-application", "chatbot"],
    colorClass: "active",
    label: "Chatbot receives message",
    // CB → A  (i7, y=451)
    stepArrow: { yPct: 9.0, xMinPct: 19.7, xMaxPct: 28.0 },
    token: null,
  },
  {
    regionIds: ["olb-application", "pingone-aic"],
    colorClass: "active",
    label: "OAuth 2.0 PKCE login",
    // WA → PID  (i39, y=1997)
    stepArrow: { yPct: 39.3, xMinPct: 12.2, xMaxPct: 40.4 },
    token: {
      type: "Authorization Code Request",
      _type: "oauth",
      _rfcs: ["RFC 6749", "RFC 7636"],
      response_type: "code",
      scope: "openid profile read write",
      code_challenge_method: "S256",
      note: "PKCE: code_verifier stored client-side; only code_challenge sent — prevents auth-code interception",
    },
  },
  {
    regionIds: ["pingone-aic", "chatbot"],
    colorClass: "active",
    label: "IdP issues ID Token + Access Token (scoped for delegation)",
    // PID → WA  (i40, y=2041)
    stepArrow: { yPct: 40.2, xMinPct: 12.1, xMaxPct: 40.6 },
    token: {
      type: "ID Token (OIDC)",
      _type: "idtoken",
      _rfcs: ["RFC 7519", "OIDC Core"],
      iss: "https://your-idp.example.com",
      sub: "alice@bank.com",
      aud: "banking-app-client",
      email: "alice@bank.com",
      name: "Alice Smith",
      note: "ID token is for the UI only — never sent to APIs or MCP tools",
    },
    token2: {
      type: "Access Token",
      _type: "oauth",
      _rfcs: ["RFC 6749", "RFC 8693"],
      aud: "banking-app-client",
      sub: "alice@bank.com",
      scope: "openid profile read write",
      note: "Platform-level authorization (PingOne app grants) controls which agents can exchange this token via RFC 8693",
    },
  },
  {
    regionIds: ["chatbot", "agent1"],
    colorClass: "active",
    label: "Agent takes over — BFF holds access token",
    // CB → A  (i42, y=2129)
    stepArrow: { yPct: 41.9, xMinPct: 19.7, xMaxPct: 28.0 },
    token: {
      type: "Access Token (held by BFF)",
      _type: "oauth",
      _rfcs: ["RFC 8693"],
      aud: "banking-app-client",
      sub: "alice@bank.com",
      scope: "openid profile read write",
      note: "BFF holds the user access token; platform-level grants authorize the BFF to perform RFC 8693 delegation exchange",
    },
  },
  {
    regionIds: ["agent1", "llm"],
    colorClass: "active",
    label: "LLM processes intent → selects tool",
    // A → LLM  (i28, y=1441)
    stepArrow: { yPct: 28.4, xMinPct: 28.2, xMaxPct: 35.6 },
    token: {
      type: "LLM Reasoning",
      _type: "mcp",
      model: "claude-3-5-sonnet",
      intent: '"show me my accounts"',
      action: "tools/call: get_my_accounts",
      note: "LangGraph heuristic fallback routes to MCP tool node",
    },
  },
  {
    regionIds: ["agent1", "pingone-aic"],
    colorClass: "active",
    label: "RFC 8693 Exchange #1: user token → delegation token",
    isTokenExchange: true,
    // A → PID  (i44, y=2222)
    stepArrow: { yPct: 43.7, xMinPct: 28.2, xMaxPct: 40.4 },
    token: {
      type: "User Access Token (subject)",
      _type: "oauth",
      _rfcs: ["RFC 8693"],
      aud: "banking-app-client",
      sub: "alice@bank.com",
      scope: "openid profile read write",
      note: "BFF sends this to IdP for exchange → platform-level grants authorize the exchange",
    },
    tokenOut: {
      type: "Delegated Token (issued)",
      _type: "exchange",
      _rfcs: ["RFC 8693"],
      aud: "mcp-gateway",
      sub: "alice@bank.com",
      scope: "read write",
      act: '{ "sub": "agent-client-id" }',
      note: "act chain added — identifies the acting agent throughout the delegation path",
    },
  },
  {
    regionIds: ["pingone-aic", "token-exchange-box"],
    colorClass: "active",
    label: "Delegation token in transit",
    // PID → A  (i45, y=2266)
    stepArrow: { yPct: 44.6, xMinPct: 28.1, xMaxPct: 40.6 },
    token: {
      type: "Delegated Token (active)",
      _type: "oauth",
      _rfcs: ["RFC 8693", "RFC 6750"],
      aud: "mcp-gateway",
      sub: "alice@bank.com",
      scope: "read write",
      act: '{ "sub": "agent-client-id" }',
      note: "act claim chains delegation — carried through all subsequent MCP calls",
    },
  },
  {
    regionIds: ["token-exchange-box", "mcp-gateway-tf"],
    colorClass: "active",
    label: "Delegated token arrives at Ping Agent Gateway",
    // A → AG  (i48, y=2427)
    stepArrow: { yPct: 47.8, xMinPct: 28.2, xMaxPct: 54.1 },
    token: {
      type: "Delegated Token (inbound at gateway)",
      _type: "oauth",
      _rfcs: ["RFC 8693"],
      aud: "mcp-gateway",
      sub: "alice@bank.com",
      scope: "read write",
      act: '{ "sub": "agent-client-id" }',
      note: "Gateway validates: aud=mcp-gateway ✓  sub≠∅ ✓  act.sub≠∅ ✓  D-05 anti-bypass ✓",
    },
  },
  {
    regionIds: ["mcp-gateway-tf", "pingauthorize-tf"],
    colorClass: "active",
    label: "PingOne Authorization Server: McpToolsList + McpToolCall checks",
    // AG → PA  (i50, y=2520)
    stepArrow: { yPct: 49.6, xMinPct: 54.3, xMaxPct: 66.7 },
    token: {
      type: "PingOne Authorization Server Request",
      _type: "mcp",
      DecisionContext: "McpToolCall",
      ClientId: "alice@bank.com",
      ActClientId: "agent-client-id",
      ToolName: "get_my_accounts",
      TokenScopes: "read",
      TokenAudience: "mcp-gateway",
      note: "Two calls: McpToolsList first (can agent discover?), McpToolCall second (can agent call this tool?)",
    },
  },
  {
    regionIds: ["pingauthorize-tf"],
    colorClass: "active-permit",
    label: "PERMIT — tool call allowed",
    // PA → AG  (i61, y=3030)
    stepArrow: { yPct: 59.6, xMinPct: 54.3, xMaxPct: 66.8 },
    token: {
      type: "Authorization Decision",
      _type: "permit",
      decision: "✅ PERMIT",
      DecisionContext: "McpToolCall",
      ToolName: "get_my_accounts",
      policy: "mcp-tool-call-v2",
    },
  },
  {
    regionIds: ["mcp-gateway-tf", "mcp-olb"],
    colorClass: "active",
    label: "Ping Agent Gateway forwards token unchanged → MCP Server",
    // AG → MCP  (i82, y=3934)
    stepArrow: { yPct: 77.3, xMinPct: 40.6, xMaxPct: 54.3 },
    token: {
      type: "Delegated Token (forwarded unchanged)",
      _type: "oauth",
      _rfcs: ["RFC 8693"],
      aud: "mcp-gateway",
      sub: "alice@bank.com",
      scope: "read write",
      act: '{ "sub": "agent-client-id" }',
      note: "Gateway is a passthrough after PERMIT — no second RFC 8693 exchange. Token aud=mcp-gateway accepted directly by MCP Server.",
    },
  },
  {
    regionIds: ["mcp-olb", "oauth-rs"],
    colorClass: "active",
    label: "MCP Server executes tool → calls Banking API",
    // MCP → RS  (i85, y=4090)
    stepArrow: { yPct: 80.3, xMinPct: 54.3, xMaxPct: 77.0 },
    token: {
      type: "Delegated Token (Banking API call)",
      _type: "oauth",
      _rfcs: ["RFC 6750"],
      aud: "mcp-gateway",
      scope: "read",
      sub: "alice@bank.com",
      endpoint: "GET /accounts",
      note: "MCP Server validates: aud=mcp-gateway ✓  act.sub ✓  scope ✓  before calling API",
    },
  },
  {
    regionIds: ["mcp-resource-server", "oauth-rs"],
    colorClass: "active",
    label: "Investments API called (same token)",
    // MCP → RS  (i89, y=4271)
    stepArrow: { yPct: 83.9, xMinPct: 77.3, xMaxPct: 91.9 },
    token: {
      type: "Delegated Token (Investments API call)",
      _type: "oauth",
      _rfcs: ["RFC 6750"],
      aud: "mcp-gateway",
      scope: "read",
      sub: "alice@bank.com",
      endpoint: "GET /investments",
      note: "Same token reused — MCP Server holds it for the duration of the tool call",
    },
  },
  {
    regionIds: ["chatbot"],
    colorClass: "active",
    label: "Results returned to user",
    // A → CB  (i98, y=4691)
    stepArrow: { yPct: 92.1, xMinPct: 19.7, xMaxPct: 28.1 },
    token: {
      type: "API Response",
      _type: "mcp",
      status: "200 OK",
      data: '[{ "accountId":"ACC-001","balance":12450.00 },...]',
      route: "Banking API → MCP Server → Ping Agent Gateway → Agent → Chatbot → User",
    },
  },
];

const TOKEN_FLOW_AUD_HOPS = [
  {
    icon: "👤",
    label: "User Token",
    aud: "banking-app-client",
    activeFrom: 3,
    activeTo: 5,
  },
  {
    icon: "",
    label: "RFC 8693 #1",
    aud: "(exchange)",
    isExchange: true,
    activeFrom: 6,
    activeTo: 6,
  },
  {
    icon: "",
    label: "Gateway Token",
    aud: "mcp-gateway",
    act: "agent-client-id",
    activeFrom: 7,
    activeTo: 16,
  },
];

const SCENARIO_STEPS_TF = {
  "id-token": [
    {
      regionIds: ["olb-application", "pingone-aic"],
      colorClass: "active",
      label: "OAuth 2.0 PKCE — code request",
      token: {
        type: "Authorization Code Request",
        _type: "oauth",
        _rfcs: ["RFC 6749", "RFC 7636"],
        response_type: "code",
        scope: "openid profile read write",
        code_challenge_method: "S256",
        note: "PKCE: code_verifier stored client-side; code_challenge sent — prevents auth-code interception",
      },
    },
    {
      regionIds: ["pingone-aic"],
      colorClass: "active",
      label: "Code exchange → token issuance",
      token: {
        type: "Token Request",
        _type: "oauth",
        _rfcs: ["RFC 6749", "RFC 7636"],
        grant_type: "authorization_code",
        note: "IdP verifies code_verifier matches stored code_challenge (S256 hash)",
      },
    },
    {
      regionIds: ["pingone-aic", "chatbot"],
      colorClass: "active",
      label: "ID Token issued — UI only",
      token: {
        type: "ID Token (OIDC)",
        _type: "idtoken",
        _rfcs: ["RFC 7519", "OIDC Core"],
        iss: "https://your-idp.example.com",
        sub: "alice@bank.com",
        aud: "banking-app-client",
        email: "alice@bank.com",
        name: "Alice Smith",
        note: "ID token aud is ONLY the client — never sent to APIs, MCP tools, or backend services",
      },
    },
    {
      regionIds: ["pingone-aic", "chatbot"],
      colorClass: "active",
      label: "Access Token issued — scoped for delegation",
      token: {
        type: "Access Token",
        _type: "oauth",
        _rfcs: ["RFC 6749", "RFC 8693"],
        aud: "banking-app-client",
        sub: "alice@bank.com",
        scope: "openid profile read write",
        note: "Platform-level grants authorize the BFF to perform RFC 8693 exchange on behalf of this user",
      },
    },
    {
      regionIds: ["chatbot"],
      colorClass: "active",
      label: "BFF stores access token — ID token stays in browser",
      token: {
        type: "Token Storage",
        _type: "mcp",
        id_token_location: "Browser memory only",
        access_token_location: "BFF server-side session",
        note: "ID token: never leaves browser. Access token: BFF holds it — never exposed to frontend",
      },
    },
  ],

  "user-token": [
    {
      regionIds: ["chatbot", "agent1"],
      colorClass: "active",
      label: "BFF holds user access token",
      token: {
        type: "User Access Token (held by BFF)",
        _type: "oauth",
        _rfcs: ["RFC 8693"],
        aud: "banking-app-client",
        sub: "alice@bank.com",
        scope: "openid profile read write",
        note: "BFF holds user token; platform-level grants authorize delegation exchange (RFC 8693 §4.2)",
      },
    },
    {
      regionIds: ["agent1", "pingone-aic"],
      colorClass: "active",
      label: "RFC 8693 Exchange #1 — user token IN, delegation OUT",
      isTokenExchange: true,
      token: {
        type: "User Access Token (subject)",
        _type: "oauth",
        _rfcs: ["RFC 8693"],
        aud: "banking-app-client",
        sub: "alice@bank.com",
        scope: "openid profile read write",
        may_act: '{ "client_id": "bff-client-id" }',
        note: "BFF sends this as subject_token → IdP validates may_act before issuing delegation token",
      },
      tokenOut: {
        type: "Delegated Token (issued)",
        _type: "exchange",
        _rfcs: ["RFC 8693"],
        aud: "mcp-gateway",
        sub: "alice@bank.com",
        scope: "read write",
        act: '{ "sub": "agent-client-id" }',
        note: "aud narrowed to mcp-gateway — act chain added identifying the acting agent",
      },
    },
    {
      regionIds: ["token-exchange-box", "mcp-gateway-tf"],
      colorClass: "active",
      label: "Delegation token arrives at Ping Agent Gateway",
      token: {
        type: "Delegated Token (inbound)",
        _type: "oauth",
        _rfcs: ["RFC 8693", "RFC 6750"],
        aud: "mcp-gateway",
        sub: "alice@bank.com",
        scope: "read write",
        act: '{ "sub": "agent-client-id" }',
        note: "Gateway validates: aud=mcp-gateway ✓  sub≠∅ ✓  act.sub≠∅ ✓  D-05 anti-bypass ✓",
      },
    },
    {
      regionIds: ["mcp-gateway-tf", "mcp-olb"],
      colorClass: "active",
      label: "Ping Agent Gateway forwards token unchanged → MCP Server",
      token: {
        type: "Delegated Token (forwarded unchanged)",
        _type: "oauth",
        _rfcs: ["RFC 8693"],
        aud: "mcp-gateway",
        sub: "alice@bank.com",
        scope: "read write",
        act: '{ "sub": "agent-client-id" }',
        note: "No second RFC 8693 exchange — gateway forwards BFF-issued token as-is after PERMIT decision",
      },
    },
    {
      regionIds: ["mcp-olb", "oauth-rs"],
      colorClass: "active",
      label: "MCP Server executes tool → calls Banking API",
      token: {
        type: "Delegated Token (Banking API call)",
        _type: "oauth",
        _rfcs: ["RFC 6750"],
        aud: "mcp-gateway",
        scope: "read",
        sub: "alice@bank.com",
        act: '{ "sub": "agent-client-id" }',
        note: "MCP Server validates aud=mcp-gateway ✓  act.sub ✓  scope ✓  before calling API",
      },
    },
  ],

  "get-accounts": [
    {
      regionIds: ["agent1", "llm"],
      colorClass: "active",
      label: "LLM decides: get_my_accounts (read)",
      token: {
        type: "LLM Reasoning",
        _type: "mcp",
        model: "claude-3-5-sonnet",
        intent: '"show me my accounts"',
        action: "tools/call: get_my_accounts",
        note: "LangGraph routes to MCP tool node — read-only, no HITL needed",
      },
    },
    {
      regionIds: ["mcp-gateway-tf", "pingauthorize-tf"],
      colorClass: "active",
      label: "PingOne Authorization Server: McpToolsList",
      token: {
        type: "PingOne Authorization Server Request",
        _type: "mcp",
        DecisionContext: "McpToolsList",
        ClientId: "alice@bank.com",
        ActClientId: "agent-client-id",
        TokenScopes: "read write",
        TokenAudience: "mcp-gateway",
      },
    },
    {
      regionIds: ["pingauthorize-tf"],
      colorClass: "active-permit",
      label: "PERMIT — tools discovery allowed",
      token: {
        type: "Authorization Decision",
        _type: "permit",
        decision: "✅ PERMIT",
        DecisionContext: "McpToolsList",
        policy: "mcp-tools-access-v2",
      },
    },
    {
      regionIds: ["mcp-gateway-tf", "pingauthorize-tf"],
      colorClass: "active",
      label: "PingOne Authorization Server: McpToolCall — get_my_accounts",
      token: {
        type: "PingOne Authorization Server Request",
        _type: "mcp",
        DecisionContext: "McpToolCall",
        ClientId: "alice@bank.com",
        ActClientId: "agent-client-id",
        ToolName: "get_my_accounts",
        TokenScopes: "read",
        TokenAudience: "mcp-gateway",
      },
    },
    {
      regionIds: ["pingauthorize-tf"],
      colorClass: "active-permit",
      label: "PERMIT — read sufficient",
      token: {
        type: "Authorization Decision",
        _type: "permit",
        decision: "✅ PERMIT",
        DecisionContext: "McpToolCall",
        ToolName: "get_my_accounts",
        policy: "mcp-tool-call-v2",
      },
    },
    {
      regionIds: ["mcp-olb", "oauth-rs"],
      colorClass: "active",
      label: "Banking API returns accounts — 200 OK",
      token: {
        type: "API Response",
        _type: "mcp",
        status: "200 OK",
        data: '[{ "accountId":"ACC-001","balance":12450.00 },...]',
        scope_used: "read",
      },
    },
  ],

  withdrawal: [
    {
      regionIds: ["agent1", "llm"],
      colorClass: "active",
      label: "LLM decides: create_transfer (write)",
      token: {
        type: "LLM Reasoning",
        _type: "mcp",
        model: "claude-3-5-sonnet",
        intent: '"transfer $5,000 to savings"',
        action: "tools/call: create_transfer",
        scope_needed: "write",
        note: "Write operation — higher risk, likely triggers HITL approval",
      },
    },
    {
      regionIds: ["mcp-gateway-tf", "pingauthorize-tf"],
      colorClass: "active",
      label: "PingOne Authorization Server: create_transfer — high-risk",
      token: {
        type: "PingOne Authorization Server Request",
        _type: "mcp",
        DecisionContext: "McpToolCall",
        ClientId: "alice@bank.com",
        ActClientId: "agent-client-id",
        ToolName: "create_transfer",
        TokenScopes: "write",
        TokenAudience: "mcp-gateway",
        note: "Write operation triggers high-risk policy evaluation",
      },
    },
    {
      regionIds: ["pingauthorize-tf"],
      colorClass: "active-hitl",
      label: "INDETERMINATE — human consent required",
      isHitl: true,
      token: {
        type: "Authorization Decision",
        _type: "hitl",
        decision: "⚠️ INDETERMINATE",
        DecisionContext: "McpToolCall",
        ToolName: "create_transfer",
        note: "PingOne Authorization Server cannot auto-approve — HITL required before execution",
      },
    },
    {
      regionIds: ["chatbot"],
      colorClass: "active-hitl",
      label: "Agent awaits human approval via HITL",
      isHitl: true,
      token: {
        type: "HITL Approval Request",
        _type: "hitl",
        trigger: "PingOne Authorization Server INDETERMINATE",
        action: "create_transfer $5,000 → savings",
        risk_score: "HIGH",
        status: "⏳ Awaiting user approval…",
      },
    },
    {
      regionIds: ["chatbot"],
      colorClass: "active-permit",
      label: "User approved ✓ — execution proceeds",
      isHitl: true,
      token: {
        type: "HITL Response",
        _type: "permit",
        decision: "✅ APPROVED",
        approved_by: "alice@bank.com",
        action: "create_transfer $5,000 → savings",
      },
    },
    {
      regionIds: ["mcp-olb", "oauth-rs"],
      colorClass: "active",
      label: "Banking API executes transfer — 200 OK",
      token: {
        type: "API Response",
        _type: "mcp",
        status: "200 OK",
        transfer_id: "TXN-2024-001",
        amount: "$5,000",
        from: "CHK-001",
        to: "SAV-002",
        scope_used: "write",
      },
    },
  ],

  "bad-scope": [
    {
      regionIds: ["chatbot", "agent1"],
      colorClass: "active",
      label: "Agent holds read-only token — attempts write",
      token: {
        type: "Agent Token (read-only)",
        _type: "oauth",
        _rfcs: ["RFC 6750"],
        aud: "mcp-gateway",
        sub: "alice@bank.com",
        scope: "read",
        act: '{ "sub": "agent-client-id" }',
        note: "⚠️ Token scope is read only — create_transfer requires write",
      },
    },
    {
      regionIds: ["mcp-gateway-tf", "pingauthorize-tf"],
      colorClass: "active",
      label: "PingOne Authorization Server: create_transfer — insufficient scope",
      token: {
        type: "PingOne Authorization Server Request",
        _type: "mcp",
        DecisionContext: "McpToolCall",
        ClientId: "alice@bank.com",
        ActClientId: "agent-client-id",
        ToolName: "create_transfer",
        TokenScopes: "read",
        TokenAudience: "mcp-gateway",
        note: "❌ write required — policy will DENY this request",
      },
    },
    {
      regionIds: ["pingauthorize-tf"],
      colorClass: "active-error",
      label: "DENY — insufficient scope",
      token: {
        type: "Authorization Decision",
        _type: "error",
        decision: "❌ DENY",
        DecisionContext: "McpToolCall",
        ToolName: "create_transfer",
        reason: "insufficient_scope: write required",
        policy: "mcp-tool-call-v2",
      },
    },
    {
      regionIds: ["mcp-gateway-tf", "chatbot"],
      colorClass: "active-error",
      label: "403 Forbidden — propagated to agent",
      token: {
        type: "HTTP 403 Forbidden",
        _type: "error",
        status: "403 Forbidden",
        error: "insufficient_scope",
        error_description: "write scope required for create_transfer",
        "WWW-Authenticate": 'Bearer scope="write"',
        note: "Ping Agent Gateway converts DENY to 403 — agent must NOT retry with same token",
      },
    },
    {
      regionIds: ["chatbot"],
      colorClass: "active-error",
      label: "Agent gracefully handles 403 — informs user",
      token: {
        type: "Agent Error Response",
        _type: "error",
        http_status: "403",
        user_message: "Unable to complete transfer — insufficient permissions",
        recovery:
          "Re-authenticate with write scope to enable transfers",
        note: "Graceful degradation: surface clear message, request scope upgrade, never silent-fail",
      },
    },
  ],

  // ─── Phase 266 R2: 3 credential-path scenarios ──────────────────────────────

  "api-key-path": [
    {
      regionIds: ["chatbot", "agent1"],
      colorClass: "active",
      label: "API-KEY PATH: user bearer arrives at gateway",
      token: {
        type: "OAuth Bearer (inbound)",
        _type: "oauth",
        _rfcs: ["RFC 6750"],
        credentialPath: "oauth_bearer (inbound)",
        tool: "show_mortgage",
        note: "Gateway receives bearer — will enforce mortgage:read, then swap for api_key disposition. No RFC 8693 exchange on this path.",
      },
    },
    {
      regionIds: ["mcp-gateway-tf"],
      colorClass: "active-permit",
      label:
        "API-KEY PATH: scope gate, then swap + call banking_api_resource_server",
      token: {
        type: "API Key Swap",
        _type: "mcp",
        credentialPath: "api_key",
        swap: "mortgage:read verified; OAuth bearer dropped; X-API-Key + X-User-Sub attached",
        backend: "banking_api_resource_server :8082 GET /mortgage (Phase 267)",
        note: "The service API key (last4: ****) is injected. The user bearer is NOT forwarded — the mortgage service only sees X-API-Key + X-User-Sub.",
      },
    },
    {
      regionIds: ["chatbot"],
      colorClass: "active",
      label: "API-KEY PATH: SPA routed to /path/mortgage with payload",
      token: {
        type: "SPA route",
        _type: "mcp",
        credentialPath: "api_key",
        destination: "/path/mortgage",
        note: "Amber mortgage page: renders the mortgage record + masked API key last-4 + credential-swap explanation.",
      },
    },
  ],

  "dual-token-path": [
    {
      regionIds: ["chatbot", "agent1"],
      colorClass: "active",
      label: "DUAL-TOKEN PATH: user bearer arrives at gateway",
      token: {
        type: "OAuth Bearer (inbound)",
        _type: "oauth",
        _rfcs: ["RFC 6750"],
        credentialPath: "oauth_bearer (inbound)",
        tool: "user_profile_card",
        note: "Gateway receives bearer — will fetch id_token from BFF session and forward BOTH.",
      },
    },
    {
      regionIds: ["mcp-gateway-tf"],
      colorClass: "active",
      label: "DUAL-TOKEN PATH: /api/resource-server/identity",
      token: {
        type: "Bearer + id_token forward",
        _type: "oauth",
        _rfcs: ["RFC 6750", "OIDC Core"],
        credentialPath: "dual_token",
        route: "/api/resource-server/identity",
        id_token_source: "BFF session (req.session.oauthTokens.idToken)",
        note: "Gateway POSTs JSON-RPC envelope: bearer in Authorization header, id_token in params.idToken.",
      },
    },
    {
      regionIds: ["oauth-rs"],
      colorClass: "active-permit",
      label: "DUAL-TOKEN PATH: banking_resource_server validates + decodes",
      token: {
        type: "Claims Response (identity)",
        _type: "oauth",
        _rfcs: ["RFC 6750", "OIDC Core"],
        credentialPath: "dual_token",
        route: "/identity",
        bearer_validated: "authenticateToken middleware (signature/exp/aud)",
        id_token_decoded: "server-side only — claims only returned, no raw JWT",
        note: "banking_resource_server returns sanitized claims. No raw JWT crosses any boundary.",
      },
    },
    {
      regionIds: ["chatbot"],
      colorClass: "active",
      label: "DUAL-TOKEN PATH: SPA routed to /path/dualtoken-info",
      token: {
        type: "SPA route",
        _type: "mcp",
        credentialPath: "dual_token",
        destination: "/path/dualtoken-info",
        note: "Teal info page: access-token + id-token claims rendered side-by-side.",
      },
    },
  ],

  "oauth-bearer-path": [
    {
      regionIds: ["chatbot", "agent1"],
      colorClass: "active",
      label: "OAUTH BEARER PATH: user bearer arrives at gateway",
      token: {
        type: "OAuth Bearer (inbound)",
        _type: "oauth",
        _rfcs: ["RFC 6750"],
        credentialPath: "oauth_bearer",
        tool: "demo_show_accounts",
        note: "Standard bearer token — gateway will exchange via RFC 8693 before forwarding.",
      },
    },
    {
      regionIds: ["mcp-gateway-tf", "pingone-aic"],
      colorClass: "active",
      label: "OAUTH BEARER PATH: RFC 8693 exchange → backend-scoped bearer",
      isTokenExchange: true,
      token: {
        type: "RFC 8693 Exchange (subject)",
        _type: "exchange",
        _rfcs: ["RFC 8693", "RFC 8707"],
        credentialPath: "oauth_bearer",
        note: "Gateway exchanges user bearer for a new bearer scoped to banking_resource_server.",
      },
      tokenOut: {
        type: "Backend-scoped Bearer",
        _type: "oauth",
        _rfcs: ["RFC 8693"],
        aud: "banking_resource_server",
        credentialPath: "oauth_bearer",
        note: "New aud matches banking_resource_server resource URI (RFC 8707 audience binding).",
      },
    },
    {
      regionIds: ["oauth-rs"],
      colorClass: "active-permit",
      label: "OAUTH BEARER PATH: /accounts or /transactions (LMDB-backed)",
      token: {
        type: "Banking Data Response",
        _type: "oauth",
        _rfcs: ["RFC 6750"],
        credentialPath: "oauth_bearer",
        route: "/api/resource-server/accounts",
        data_source:
          "banking-resource-server (LMDB, seeded from data/store.js)",
        note: "authenticateToken validates bearer; bankingDb.getAccountsByUserId queries LMDB.",
      },
    },
  ],
};

const HIGHLIGHT_MS = 4000;
const HISTORICAL_MS = 15000;

function mapEventToRegions(event) {
  for (const rule of TOKEN_FLOW_EVENT_MAP) {
    if (event.category !== rule.category) continue;
    if (rule.tags.length > 0 && !rule.tags.includes(event.tag)) continue;
    return rule.regionIds.map((id) => ({
      regionId: id,
      colorClass: rule.colorClass,
    }));
  }
  return [];
}

function scanKeywords(text) {
  if (!text || typeof text !== "string") return [];
  const lower = text.toLowerCase();
  return TOKEN_FLOW_REGIONS.filter((r) =>
    r.keywords?.some((kw) => lower.includes(kw)),
  ).map((r) => ({ regionId: r.id, colorClass: "active" }));
}

function buildLiveHistoryEntry(evt) {
  const m = evt.metadata || {};
  const ts = new Date(evt.timestamp || Date.now()).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  if (evt.tag === "token_exchange/rfc8693-success") {
    const audRaw = m.response?.aud;
    return {
      isLive: true,
      label: `RFC 8693 Exchange → ${(m.request?.audience || m.mcpResourceUri || "MCP").split("/").pop()} [${ts}]`,
      isTokenExchange: true,
      token: {
        type: "Token Exchange Request",
        _type: "exchange",
        _rfcs: ["RFC 8693"],
        grant_type: "token-exchange",
        audience: m.request?.audience || m.mcpResourceUri || "—",
        scope: m.request?.scope || "—",
        actor_token: m.request?.hasActorToken ? "yes" : "no",
      },
      tokenOut: {
        type: "Issued Token",
        _type: "oauth",
        _rfcs: ["RFC 8693"],
        aud: Array.isArray(audRaw) ? audRaw.join(", ") : audRaw || "—",
        scope: m.response?.scope || "—",
        act_claim: m.response?.hasActClaim ? "yes (chain preserved)" : "no",
        duration: `${m.durationMs || "?"}ms`,
      },
    };
  }
  if (evt.tag === "token_exchange/rfc8693-error") {
    return {
      isLive: true,
      label: `RFC 8693 Exchange FAILED [${ts}]`,
      token: {
        type: "Token Exchange Error",
        _type: "error",
        audience: m.mcpResourceUri || "—",
        error: m.errorMessage || "Exchange failed",
        duration: `${m.durationMs || "?"}ms`,
      },
    };
  }
  if (evt.tag === "authorize/permit") {
    return {
      isLive: true,
      label: `PingOne Authorization Server: PERMIT — ${m.type || "txn"} $${m.amount || "?"} [${ts}]`,
      token: {
        type: "Authorization Decision",
        _type: "permit",
        decision: "✅ PERMIT",
        engine: m.engine || "—",
        TransactionType: m.type || "—",
        Amount: String(m.amount || "—"),
        path: m.path || "—",
      },
    };
  }
  if (evt.tag === "authorize/deny") {
    return {
      isLive: true,
      label: `PingOne Authorization Server: DENY — ${m.type || "txn"} $${m.amount || "?"} [${ts}]`,
      token: {
        type: "Authorization Decision",
        _type: "error",
        decision: "❌ DENY",
        engine: m.engine || "—",
        TransactionType: m.type || "—",
        Amount: String(m.amount || "—"),
        path: m.path || "—",
      },
    };
  }
  if (evt.tag === "authorize/bypass") {
    return {
      isLive: true,
      label: `PingOne Authorization Server: BYPASS [${ts}]`,
      token: {
        type: "Authorization Bypass",
        _type: "mcp",
        engine: "off",
        note: "Authorization disabled — all requests permitted without evaluation",
      },
    };
  }
  if (evt.tag === "mcp/tool") {
    if (m.durationMs != null) {
      return {
        isLive: true,
        label: `MCP Tool Done: ${m.tool || "?"} (${m.durationMs}ms) [${ts}]`,
        token: {
          type: "MCP Tool Result",
          _type: "mcp",
          tool: m.tool || "—",
          via: m.via || "—",
          duration: `${m.durationMs}ms`,
          status: "success",
        },
      };
    }
    return {
      isLive: true,
      label: `MCP Tool Call: ${m.tool || "?"} [${ts}]`,
      token: {
        type: "MCP Tool Call",
        _type: "mcp",
        tool: m.tool || "—",
        via: m.via || "—",
        status: "calling…",
      },
    };
  }
  if (evt.tag === "oauth/user/callback") {
    return {
      isLive: true,
      label: `OAuth: User authenticated [${ts}]`,
      token: {
        type: "OAuth Callback",
        _type: "oauth",
        _rfcs: ["RFC 6749"],
        status: "✅ authenticated",
        note: "PingOne issued ID Token + Access Token to BFF",
      },
    };
  }
  return null;
}

export default function ArchitectureTokenFlowPage({ user }) {
  const [activeRegions, setActiveRegions] = useState({});
  const [regionLabels, setRegionLabels] = useState({});
  const [isSimulating, setIsSimulating] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [currentStep, setCurrentStep] = useState(-1);
  const [stepDetail, setStepDetail] = useState(null);
  const [stepDetail2, setStepDetail2] = useState(null);
  const [stepDetailOut, setStepDetailOut] = useState(null);
  const [isTokenExch, setIsTokenExch] = useState(false);
  const [isHitl, setIsHitl] = useState(false);
  const [stepArrow, setStepArrow] = useState(null);
  const [history, setHistory] = useState([]);
  const [selectedScenario, setSelectedScenario] = useState("full-flow");
  const [totalSteps, setTotalSteps] = useState(
    TOKEN_FLOW_SIMULATE_STEPS.length,
  );
  const [stepMs, setStepMs] = useState(DEFAULT_STEP_MS);

  const clearTimers = useRef({});
  const simTimeouts = useRef([]);
  const pausedStep = useRef(-1);
  const lastFetchedAt = useRef(null);
  const pollRef = useRef(null);
  const stepsRef = useRef(TOKEN_FLOW_SIMULATE_STEPS);

  const activateRegion = useCallback(
    (regionId, colorClass = "active", ms = HIGHLIGHT_MS) => {
      if (clearTimers.current[regionId])
        clearTimeout(clearTimers.current[regionId]);
      setActiveRegions((prev) => ({ ...prev, [regionId]: colorClass }));
      clearTimers.current[regionId] = setTimeout(() => {
        setActiveRegions((prev) => {
          const n = { ...prev };
          delete n[regionId];
          return n;
        });
        delete clearTimers.current[regionId];
      }, ms);
    },
    [],
  );

  const processEvents = useCallback(
    (events, historical = false) => {
      const ms = historical ? HISTORICAL_MS : HIGHLIGHT_MS;
      events.forEach((evt) => {
        mapEventToRegions(evt).forEach(({ regionId, colorClass }) =>
          activateRegion(regionId, colorClass, ms),
        );
        if (evt.tag === "agent_prompt/llm_complete" && evt.metadata?.response)
          scanKeywords(evt.metadata.response).forEach(
            ({ regionId, colorClass }) =>
              activateRegion(regionId, colorClass, ms),
          );
        if (!historical) {
          const entry = buildLiveHistoryEntry(evt);
          if (entry) {
            setHistory((prev) => {
              const cutoff = Date.now() - 4000;
              const isDupe = prev.some(
                (e) => e.isLive && e._tag === evt.tag && (e._ts || 0) > cutoff,
              );
              if (isDupe) return prev;
              return [...prev, { ...entry, _tag: evt.tag, _ts: Date.now() }];
            });
          }
        }
      });
    },
    [activateRegion],
  );

  const fetchEvents = useCallback(async () => {
    if (!user) return;
    try {
      const since =
        lastFetchedAt.current ||
        new Date(Date.now() - 5 * 60 * 1000).toISOString();
      const isHistorical = !lastFetchedAt.current;
      const res = await apiClient.get(
        `/api/app-events?limit=50&since=${since}`,
      );
      const events = res.data?.events || [];
      if (events.length > 0) processEvents(events, isHistorical);
      lastFetchedAt.current = new Date().toISOString();
    } catch (_err) {
      if (!lastFetchedAt.current)
        lastFetchedAt.current = new Date().toISOString();
    }
  }, [user, processEvents]);

  const applyStep = useCallback((i) => {
    const steps = stepsRef.current;
    if (i < 0 || i >= steps.length) return;
    const step = steps[i];
    setCurrentStep(i);
    setStepDetail(step.token || null);
    setStepDetail2(step.token2 || null);
    setStepDetailOut(step.tokenOut || null);
    setIsTokenExch(Boolean(step.isTokenExchange));
    setIsHitl(Boolean(step.isHitl));
    setStepArrow(step.stepArrow ? { ...step.stepArrow, colorClass: step.colorClass } : null);

    const regions = {};
    const labels = {};
    for (let j = 0; j < i; j++) {
      steps[j].regionIds.forEach((id) => {
        regions[id] = "active-prev";
        labels[id] = steps[j].label;
      });
    }
    step.regionIds.forEach((id) => {
      regions[id] = step.colorClass;
      labels[id] = step.label;
    });
    setActiveRegions(regions);
    setRegionLabels(labels);

    if (step.token || step.token2) {
      const entry = {
        stepNum: i + 1,
        label: step.label,
        token: step.token || null,
        token2: step.token2 || null,
        tokenOut: step.tokenOut || null,
        isTokenExchange: Boolean(step.isTokenExchange),
        isHitl: Boolean(step.isHitl),
      };
      setHistory((prev) => {
        if (prev.some((e) => e.stepNum === entry.stepNum)) return prev;
        return [...prev, entry].sort((a, b) => a.stepNum - b.stepNum);
      });
    }
  }, []);

  const scheduleFrom = useCallback(
    (startIdx) => {
      const steps = stepsRef.current;
      simTimeouts.current.forEach(clearTimeout);
      simTimeouts.current = [];
      for (let i = startIdx; i < steps.length; i++) {
        const t = setTimeout(
          () => {
            applyStep(i);
            if (i === steps.length - 1) {
              const done = setTimeout(() => {
                setActiveRegions({});
                setRegionLabels({});
                setIsSimulating(false);
                setIsPaused(false);
                setCurrentStep(-1);
                setStepDetail(null);
                setStepDetail2(null);
                setStepDetailOut(null);
                setIsTokenExch(false);
                setIsHitl(false);
                setStepArrow(null);
              }, HIGHLIGHT_MS);
              simTimeouts.current.push(done);
            }
          },
          (i - startIdx) * stepMs,
        );
        simTimeouts.current.push(t);
      }
    },
    [applyStep, stepMs],
  );

  const clearHistory = useCallback(() => setHistory([]), []);

  const runSimulation = useCallback(
    (scenarioKey) => {
      if (isSimulating) return;
      const key = scenarioKey || selectedScenario;
      const steps =
        key === "full-flow"
          ? TOKEN_FLOW_SIMULATE_STEPS
          : SCENARIO_STEPS_TF[key] || TOKEN_FLOW_SIMULATE_STEPS;
      stepsRef.current = steps;
      setTotalSteps(steps.length);
      setHistory([]);
      setIsSimulating(true);
      setIsPaused(false);
      pausedStep.current = -1;
      scheduleFrom(0);
    },
    [isSimulating, scheduleFrom, selectedScenario],
  );

  const pause = useCallback(() => {
    simTimeouts.current.forEach(clearTimeout);
    simTimeouts.current = [];
    pausedStep.current = currentStep;
    setIsPaused(true);
  }, [currentStep]);

  const resume = useCallback(() => {
    setIsPaused(false);
    scheduleFrom(pausedStep.current + 1);
  }, [scheduleFrom]);

  const prevStep = useCallback(() => {
    const prev = pausedStep.current - 1;
    if (prev < 0) return;
    pausedStep.current = prev;
    applyStep(prev);
  }, [applyStep]);

  const nextStep = useCallback(() => {
    const next = pausedStep.current + 1;
    if (next >= stepsRef.current.length) return;
    pausedStep.current = next;
    applyStep(next);
  }, [applyStep]);

  const stop = useCallback(() => {
    simTimeouts.current.forEach(clearTimeout);
    simTimeouts.current = [];
    setActiveRegions({});
    setRegionLabels({});
    setIsSimulating(false);
    setIsPaused(false);
    setCurrentStep(-1);
    setStepDetail(null);
    setStepDetail2(null);
    setStepDetailOut(null);
    setStepArrow(null);
    pausedStep.current = -1;
  }, []);

  // Reset = stop the simulation and clear the token history log.
  const resetSimulation = useCallback(() => {
    stop();
    clearHistory();
  }, [stop, clearHistory]);

  useEffect(() => {
    fetchEvents();
    pollRef.current = setInterval(fetchEvents, 10000);
    return () => {
      clearInterval(pollRef.current);
      Object.values(clearTimers.current).forEach(clearTimeout);
      simTimeouts.current.forEach(clearTimeout);
      clearTimers.current = {};
    };
  }, [fetchEvents]);

  const scenarioSelector = (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <label
        style={{
          fontSize: "0.75rem",
          fontWeight: 600,
          color: "#475569",
          whiteSpace: "nowrap",
        }}
      >
        Scenario:
      </label>
      <select
        value={selectedScenario}
        onChange={(e) => setSelectedScenario(e.target.value)}
        disabled={isSimulating}
        style={{
          fontSize: "0.78rem",
          padding: "4px 8px",
          borderRadius: 6,
          border: "1px solid #cbd5e1",
          background: "#fff",
          color: "#1e293b",
          cursor: isSimulating ? "not-allowed" : "pointer",
        }}
      >
        <option value="full-flow">Full Flow</option>
        <option value="id-token">ID Token Exchange</option>
        <option value="user-token">Token Exchange (Both Hops)</option>
        <option value="get-accounts">Get Accounts (Read Scope)</option>
        <option value="withdrawal">Withdrawal + HITL</option>
        <option value="bad-scope">Bad Scope (401 / 403)</option>
        <option value="api-key-path">API-Key Path (Path A)</option>
        <option value="dual-token-path">Dual-Token Path (Path B)</option>
        <option value="oauth-bearer-path">OAuth Bearer Path (Path C)</option>
      </select>
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      {isSimulating && currentStep >= 0 && currentStep < totalSteps && (
        <div style={{ padding: '0 2rem' }}>
          <TokenStepIndicator
            currentStep={currentStep + 1}
            totalSteps={totalSteps}
            compact={false}
            showLabel={true}
          />
        </div>
      )}
      <ArchitectureDiagramPage
        title="Token Flow Diagram"
        imageSrc="/architecture/token-flow.png"
        imageAlt="Token flow sequence: User, Web App, Chatbot, Agent (BFF in-process LangGraph), LLM, PingOne, Agent Gateway, PingOne Authorization Server, HITL Service, MCP OLB, MCP Resource Server, API Resource Server — RFC 8693 exchanges, Phase 266 credential paths, and HITL consent escalation"
        regions={TOKEN_FLOW_REGIONS}
        activeRegions={activeRegions}
        regionLabels={regionLabels}
        user={user}
        onSimulate={runSimulation}
        isSimulating={isSimulating}
        isPaused={isPaused}
        onPause={pause}
        onResume={resume}
        onPrevStep={prevStep}
        onNextStep={nextStep}
        onStop={stop}
        onReset={resetSimulation}
        stepTimeOptions={STEP_TIME_OPTIONS}
        stepMs={stepMs}
        onSetStepMs={setStepMs}
        currentStep={currentStep}
        totalSteps={totalSteps}
        stepDetail={stepDetail}
        stepDetail2={stepDetail2}
        stepDetailOut={stepDetailOut}
        isTokenExchange={isTokenExch}
        isHitl={isHitl}
        stepArrow={stepArrow}
        audHops={TOKEN_FLOW_AUD_HOPS}
        tokenHistory={history}
        onClearHistory={clearHistory}
        toolbarExtra={scenarioSelector}
      />
    </div>
  );
}
