// education/ServerCapabilitiesPanel.js — plain-English guide to every server in this project
import React from "react";
import EducationDrawer from "../shared/EducationDrawer";

function Section({ title, role, children }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 6 }}>
        <h3 style={{ margin: 0, fontSize: "0.97rem", fontWeight: 700 }}>{title}</h3>
        <span style={{
          fontSize: "0.68rem", fontWeight: 600, color: "#6366f1",
          background: "#eef2ff", border: "1px solid #c7d2fe",
          borderRadius: 99, padding: "1px 8px", whiteSpace: "nowrap",
        }}>{role}</span>
      </div>
      <div style={{ fontSize: "0.83rem", color: "#374151", lineHeight: 1.65 }}>{children}</div>
    </div>
  );
}

function Row({ label, children }) {
  return (
    <div style={{ display: "flex", gap: 8, marginBottom: 4, fontSize: "0.82rem" }}>
      <span style={{ fontWeight: 700, color: "#1e3a5f", minWidth: 90, flexShrink: 0 }}>{label}</span>
      <span style={{ color: "#374151", lineHeight: 1.55 }}>{children}</span>
    </div>
  );
}

function Card({ children }) {
  return (
    <div style={{
      background: "#f8fafc", border: "1px solid #e2e8f0",
      borderRadius: 8, padding: "12px 14px", marginBottom: 12,
    }}>{children}</div>
  );
}

// ── System Map tab ────────────────────────────────────────────────────────────

function SystemMapTab() {
  return (
    <>
      <p style={{ marginTop: 0 }}>
        This project is a multi-vertical AI agent security demo. Every server has a single,
        well-defined job. The map below shows how they connect.
      </p>
      <pre style={{
        background: "#0f172a", color: "#e2e8f0", borderRadius: 8,
        padding: "14px 16px", fontSize: "0.73rem", lineHeight: 1.7,
        overflowX: "auto", marginBottom: 16,
      }}>{`Browser (demo_api_ui)
    └── demo_api_server  ←──── OAuth / session / banking data
            └── demo_agent_service  ← internal reasoning (no user token custody)
                    ↓
AI Agents (langchain / mastra / openai / pydantic)
    └── demo_mcp_gateway  ← token validation + policy enforcement + HITL gating
            ├── demo_authz_server      ← PERMIT / DENY decisions
            ├── demo_hitl_service      ← human approval challenges
            ├── demo_mcp_server        ← banking tools  → demo_api_server
            ├── demo_mcp_resource_server        ← investment tools → demo_api_server
            └── demo_api_resource_server  ← API-key-gated vertical records

jwt-verifier-mcp-server  ← standalone debug / teaching tool
ping-gateway             ← production-grade equivalent of demo_mcp_gateway`}</pre>
      <p style={{ fontSize: "0.81rem", color: "#64748b" }}>
        Every server is described in detail in the tabs above. The MCP gateway is the
        single enforcer — no agent ever calls a backend directly.
      </p>
    </>
  );
}

// ── MCP Layer tab ─────────────────────────────────────────────────────────────

function McpLayerTab() {
  return (
    <>
      <Section title="demo_mcp_gateway" role="Token-enforcing routing sidecar">
        <p style={{ marginTop: 4 }}>
          Sits between AI agents and all downstream MCP servers. Every tool call passes through
          here first. It validates the agent's inbound bearer token, asks the authorization
          service whether the operation is permitted, blocks for human approval on sensitive
          operations, then proxies the call to the right backend.
        </p>
        <Card>
          <Row label="Takes in">Agent WebSocket connections with bearer tokens, JSON-RPC tool-call messages</Row>
          <Row label="Gives back">Tool results, HITL challenge status, auth errors</Row>
          <Row label="Calls">demo_authz_server (policy), demo_hitl_service (HITL), demo_mcp_server, demo_mcp_resource_server, demo_api_resource_server</Row>
          <Row label="RFC">Publishes RFC 9728 metadata at <code>/.well-known/oauth-protected-resource</code></Row>
        </Card>
      </Section>

      <Section title="demo_mcp_server" role="Banking operations MCP server">
        <p style={{ marginTop: 4 }}>
          Exposes the core banking toolset. Tools split into two tiers — read-only and
          write/restricted. Validates the agent token, checks the <code>act</code> claim for
          delegation, and calls the BFF to execute the operation.
        </p>
        <Card>
          <Row label="Read tools">get_my_accounts, get_account_balance, get_my_transactions, sequential_think</Row>
          <Row label="Write tools">get_sensitive_account_details, create_deposit, create_withdrawal, create_transfer, query_user_by_email</Row>
          <Row label="Takes in">MCP tool-call requests from the gateway with user-bearing tokens</Row>
          <Row label="Gives back">Account balances, transaction history, transfer confirmations, error details</Row>
          <Row label="Calls">demo_api_server for data and mutations</Row>
        </Card>
      </Section>

      <Section title="demo_mcp_resource_server" role="Investment vertical MCP server">
        <p style={{ marginTop: 4 }}>
          Lightweight counterpart to demo_mcp_server for investment accounts. Validates tokens
          against the <code>mcp-invest.ping.demo</code> audience and filters the toolset by scope.
        </p>
        <Card>
          <Row label="Tools">get_investment_accounts, get_investment_balance, get_investment_portfolio, place_investment_order</Row>
          <Row label="Takes in">MCP requests from the gateway with scoped bearer tokens</Row>
          <Row label="Gives back">Portfolio data, account balances, order confirmations</Row>
          <Row label="Calls">demo_api_server's investment endpoints</Row>
        </Card>
      </Section>
    </>
  );
}

// ── Core Backend tab ──────────────────────────────────────────────────────────

function CoreBackendTab() {
  return (
    <>
      <Section title="demo_api_server" role="Central BFF and banking data API">
        <p style={{ marginTop: 4 }}>
          The single backend that both the human UI and AI agents depend on. Handles OAuth
          login/callback/logout, session management, all banking CRUD, admin dashboards, and
          the agent-specific routes that MCP servers call to move money. Integrates with PingOne
          for auth, token introspection, CIBA, and MFA.
        </p>
        <Card>
          <Row label="/api/auth/*">OAuth flow, CIBA, MFA, session status</Row>
          <Row label="/api/accounts/*">/api/transactions/* — banking data and mutations</Row>
          <Row label="/api/admin/*">Stats, activity feed, bootstrap data</Row>
          <Row label="/api/mcp/*">Exchange mode config, gateway config, decision polling</Row>
          <Row label="/api/agent/*">Delegation info, agent identity, agent authorization</Row>
          <Row label="/api/tokens/*">Session token preview and validation</Row>
          <Row label="Calls">PingOne for identity and token introspection</Row>
        </Card>
      </Section>

      <Section title="demo_authz_server" role="Mock PingOne Authorize — authorization policy engine">
        <p style={{ marginTop: 4 }}>
          Mirrors the PingOne Authorize API so the MCP gateway can get policy decisions without
          hitting the real cloud service. Rules are editable at runtime via a <code>/rules</code>{" "}
          API for live demo tuning. Must stay in sync with real PingOne Authorize — any change
          to the gateway's decision params must be mirrored here.
        </p>
        <Card>
          <Row label="POST /as/introspect">Validates a JWT — returns active/inactive + claims</Row>
          <Row label="POST /governance/…/decision">Returns PERMIT, DENY, or INDETERMINATE</Row>
          <Row label="GET|PUT /rules">Live rule editor for demo tuning</Row>
          <Row label="Takes in">Token strings and authorization context from the gateway</Row>
          <Row label="Gives back">Policy decisions, token claims</Row>
        </Card>
      </Section>

      <Section title="demo_hitl_service" role="Human-in-the-Loop approval workflow engine">
        <p style={{ marginTop: 4 }}>
          Manages the approval lifecycle for sensitive AI operations. The gateway creates a
          challenge here when a tool call exceeds a risk threshold. A human approves or denies
          via the dashboard. The gateway polls until it gets a decision.
        </p>
        <Card>
          <Row label="Step 1">Gateway → POST /challenges (creates challenge)</Row>
          <Row label="Step 2">Dashboard → GET /challenges (lists pending)</Row>
          <Row label="Step 3">Human → POST /challenges/:id/respond (approve or deny)</Row>
          <Row label="Step 4">Gateway → GET /challenges/:id (poll for final status)</Row>
        </Card>
      </Section>

      <Section title="demo_api_resource_server" role="API-key-gated vertical record service">
        <p style={{ marginTop: 4 }}>
          Demonstrates the "gateway swaps bearer token for an API key" pattern. Each vertical
          path returns demo records. Uses timing-safe key comparison — never touches OAuth.
        </p>
        <Card>
          <Row label="Paths">/mortgage, /retail, /healthcare, /gear, /expense</Row>
          <Row label="Auth">X-API-Key header — no OAuth required</Row>
          <Row label="Purpose">Shows that a backend doesn't need to understand OAuth; the gateway handles the swap</Row>
        </Card>
      </Section>
    </>
  );
}

// ── Agents tab ────────────────────────────────────────────────────────────────

function AgentsTab() {
  return (
    <>
      <Section title="demo_agent_service" role="Internal AI reasoning microservice">
        <p style={{ marginTop: 4 }}>
          Runs LangChain-powered reasoning loops on behalf of the BFF. Never holds a user token
          — the BFF looks up the stored token from the session and passes it back to the gateway
          for tool execution. Gated by a shared internal secret, not exposed to clients.
        </p>
        <Card>
          <Row label="Endpoint">POST /api/agent/reason (internal only)</Row>
          <Row label="Auth">x-internal-gateway-secret shared secret</Row>
          <Row label="LLM backends">Helix, LM Studio, OpenAI</Row>
          <Row label="Gives back">Multi-step reasoning outputs, tool selection decisions</Row>
        </Card>
      </Section>

      <Section title="demo_api_ui" role="React dashboard for human users and admins">
        <p style={{ marginTop: 4 }}>
          The user-facing web application. Customers log in via PingOne OAuth, view accounts,
          review transactions, and initiate transfers. Admins inspect activity logs, manage MCP
          configuration, edit authz rules, and respond to HITL approval challenges.
        </p>
        <Card>
          <Row label="Banking">Account balances, transaction history, transfer flows</Row>
          <Row label="Agent">Active agent sessions and their tool calls</Row>
          <Row label="HITL">Challenge queue with approve/deny buttons</Row>
          <Row label="Admin">User management, activity log, MCP/authz config, token inspector</Row>
        </Card>
      </Section>

      <p style={{ fontSize: "0.81rem", color: "#64748b", borderTop: "1px solid #e5e7eb", paddingTop: 12 }}>
        The four AI agent runtimes (LangChain, Mastra, OpenAI Agents, Pydantic AI) are
        compared in detail in the <strong>Agent Tech Comparison</strong> panel — see Learn menu.
      </p>
    </>
  );
}

// ── Tools & Gateway tab ───────────────────────────────────────────────────────

function ToolsTab() {
  return (
    <>
      <Section title="jwt-verifier-mcp-server" role="JWT inspection and debugging tool via MCP">
        <p style={{ marginTop: 4 }}>
          MCP server that exposes JWT analysis as tools. Any agent or developer connected to it
          can decode a raw JWT, verify its signature against a JWKS endpoint, validate claims,
          or inspect a key set. Primarily a diagnostic and teaching tool for debugging OAuth
          token chains.
        </p>
        <Card>
          <Row label="jwt_decode">Decode a raw JWT and show all claims</Row>
          <Row label="jwt_verify_signature">Verify signature against a JWKS URL</Row>
          <Row label="jwt_validate_claims">Check expiry, audience, issuer</Row>
          <Row label="jwt_fetch_jwks">Fetch and inspect a JWKS endpoint</Row>
          <Row label="jwt_inspect_key">Explain a key's fields (kty, use, alg, kid)</Row>
        </Card>
      </Section>

      <Section title="ping-gateway" role="Agent Gateway config — production gateway alternative">
        <p style={{ marginTop: 4 }}>
          Configuration and deployment scripts for Agent Gateway, the real PingOne product.
          Configured to do the same job as demo_mcp_gateway — validate tokens against PingOne
          introspection, perform RFC 8693 token exchange, and forward to backend MCP servers.
          Exists as a "what this looks like in production" counterpart to the Node.js gateway.
        </p>
        <Card>
          <Row label="Token exchange">RFC 8693 exchange at the gateway layer</Row>
          <Row label="Introspection">PingOne token introspection (not mock)</Row>
          <Row label="Routing">Same backends as demo_mcp_gateway</Row>
          <Row label="vs Node.js">Production-grade, Java-based, PingOne-native</Row>
        </Card>
      </Section>
    </>
  );
}

// ── Panel export ──────────────────────────────────────────────────────────────

export default function ServerCapabilitiesPanel({ isOpen, onClose, initialTabId }) {
  const tabs = [
    { id: "map", label: "System Map", content: <SystemMapTab /> },
    { id: "mcp", label: "MCP Layer", content: <McpLayerTab /> },
    { id: "backend", label: "Core Backend", content: <CoreBackendTab /> },
    { id: "agents", label: "Agents & UI", content: <AgentsTab /> },
    { id: "tools", label: "Tools & Gateway", content: <ToolsTab /> },
  ];

  return (
    <EducationDrawer
      isOpen={isOpen}
      onClose={onClose}
      title="Server Capabilities"
      tabs={tabs}
      initialTabId={initialTabId || "map"}
    />
  );
}
