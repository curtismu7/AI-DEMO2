// banking_api_ui/src/components/education/ArchitectureDiagramPanel.js
import React from "react";
import EducationDrawer from "../shared/EducationDrawer";
import StaticFlowDiagram from "../StaticFlowDiagram";

const C4_GROUPS = {
  person: { label: "Person", bg: "var(--th-bg-emphasis)" },
  system: { label: "This system", bg: "var(--th-status-info)" },
  external: { label: "External system", bg: "var(--th-status-success)" },
  store: { label: "Data store", bg: "var(--th-status-warning)" },
};

const CONTEXT_NODES = [
  { id: "user", group: "person", label: "Banking User", sub: ["Customer / Admin"], x: 250, y: 0 },
  { id: "demo", group: "system", label: "AI Demo", sub: ["AI-powered banking", "RFC 8693 delegation"], x: 250, y: 150 },
  { id: "pingone", group: "external", label: "PingOne", sub: ["OAuth 2.0", "OIDC · MFA", "Mgmt API"], x: 50, y: 320 },
  { id: "llm", group: "external", label: "LLM Provider", sub: ["OpenAI · Anthropic", "Groq · Gemini · Helix"], x: 450, y: 320 },
];
const CONTEXT_EDGES = [
  ["user", "demo", "uses", { vertical: true }],
  ["demo", "pingone", "OAuth+OIDC · RFC 8693", { vertical: true }],
  ["demo", "llm", "AI inference", { vertical: true }],
];

const CONTAINER_NODES = [
  { id: "ui", group: "system", label: "banking_api_ui (React 18 SPA)", sub: ["Vercel Platform", "• Session cookie", "• No raw tokens", "• Education UI"], x: 0, y: 0 },
  { id: "server", group: "system", label: "banking_api_server (Express BFF)", sub: ["Vercel Platform", "• OAuth routes", "• RFC 8693 exchange", "• CIBA / MFA", "• LangGraph AI agent"], x: 320, y: 0 },
  { id: "redis", group: "store", label: "Upstash Redis", sub: ["Session store (Vercel KV)"], x: 0, y: 230 },
  { id: "mcp", group: "system", label: "banking_mcp_server (TypeScript)", sub: ["ws://:8080", "MCP tool server"], x: 320, y: 230 },
  { id: "pingone", group: "external", label: "PingOne", sub: ["auth.pingone", "api.pingone"], x: 640, y: 230 },
  { id: "lmdb", group: "store", label: "LMDB (local dev only)", sub: ["Config + session fallback"], x: 0, y: 400 },
];
const CONTAINER_EDGES = [
  ["ui", "server", "session cookie"],
  ["server", "redis", "sessions", { vertical: true }],
  ["server", "mcp", "MCP tool calls", { vertical: true }],
  ["server", "pingone", "OAuth · token exchange", { vertical: true }],
  ["lmdb", "mcp", "config + session fallback"],
];

const COMPONENT_NODES = [
  { id: "oauth", group: "system", label: "OAuth Routes", sub: ["login · callback", "logout · refresh"], x: 0, y: 0 },
  { id: "tex", group: "system", label: "Token Exchange", sub: ["RFC 8693", "1-exchange · 2-exchange"], x: 300, y: 0 },
  { id: "ciba", group: "system", label: "CIBA Service", sub: ["backchannel auth + poll"], x: 600, y: 0 },
  { id: "mfa", group: "system", label: "MFA Service", sub: ["OTP, TOTP, FIDO2, push"], x: 0, y: 150 },
  { id: "agent", group: "system", label: "AI Agent", sub: ["LangGraph", "heuristic + MCP client"], x: 300, y: 150 },
  { id: "config", group: "store", label: "ConfigStore", sub: ["LMDB / KV persistence"], x: 600, y: 150 },
  { id: "data", group: "store", label: "DataStore", sub: ["accounts, transactions"], x: 0, y: 300 },
  { id: "session", group: "store", label: "Session MW", sub: ["Upstash Redis", "PKCE cookies"], x: 300, y: 300 },
  { id: "delegation", group: "system", label: "Delegation", sub: ["act/may_act", "audit trail"], x: 600, y: 300 },
];
// No arrows inside the BFF box: the walk visits each component in turn.
const COMPONENT_WALK = COMPONENT_NODES.map((n) => ({ title: n.label, label: n.sub.join(" · "), nodes: [n.id], edges: [] }));

const CODE_NODES = [
  { id: "builder", group: "system", label: "agentBuilder.js", sub: ["LLM selection", "OpenAI · Anthropic · Groq · Gemini · Helix"], x: 560, y: 0 },
  { id: "oauth", group: "system", label: "oauthService.js", sub: ["PKCE, token mgmt"], x: 0, y: 160 },
  { id: "graph", group: "system", label: "bankingAgentLangGraphService.js", sub: ["LangGraph + heuristic parser"], x: 560, y: 160 },
  { id: "mcptoken", group: "system", label: "agentMcpTokenService.js", sub: ["RFC 8693 orchestration", "1-exchange or 2-exchange"], x: 280, y: 320 },
  { id: "ws", group: "system", label: "mcpWebSocketClient.js", sub: ["ws://banking_mcp_server"], x: 840, y: 320 },
  { id: "p1", group: "external", label: "pingOneClientService.js", sub: ["Management API", "Worker token"], x: 0, y: 480 },
  { id: "chain", group: "system", label: "tokenChainService.js", sub: ["Token event tracking", "sub, act, aud chain"], x: 560, y: 480 },
  { id: "mfa", group: "system", label: "mfaService.js", sub: ["OTP/TOTP/FIDO2"], x: 0, y: 640 },
  { id: "config", group: "store", label: "configStore.js", sub: ["LMDB / Vercel KV", "Persistent config"], x: 280, y: 640 },
  { id: "store", group: "store", label: "data/store.js", sub: ["Accounts, txns", "In-memory + backup"], x: 560, y: 640 },
];
const CODE_EDGES = [
  ["builder", "graph", "LLM for the agent", { vertical: true }],
  ["oauth", "graph", "user tokens"],
  ["graph", "mcptoken", "needs MCP token", { vertical: true }],
  ["graph", "ws", "tool calls", { vertical: true }],
  ["mcptoken", "p1", "exchange via PingOne", { vertical: true }],
  ["mcptoken", "chain", "record token events", { vertical: true }],
  ["p1", "config", "config", { vertical: true }],
  ["mfa", "config", "config"],
];

function ContextTab() {
  return (
    <div>
      <h3 style={{ marginTop: 0 }}>C4 Level 1 — System Context</h3>
      <p>
        The highest-level view: who uses the system and what external systems it
        depends on.
      </p>

      <StaticFlowDiagram NODES={CONTEXT_NODES} EDGES={CONTEXT_EDGES} GROUPS={C4_GROUPS} testId="c4-context-diagram" ariaLabel="C4 system context: user, AI Demo, PingOne and LLM provider" />

      <h4>Key relationships</h4>
      <ul>
        <li>
          <strong>Banking User</strong>: Authenticates via PingOne, manages
          accounts, interacts with AI agent
        </li>
        <li>
          <strong>PingOne</strong>: OAuth 2.0 + OIDC for login, CIBA for
          backchannel auth, Management API for user/app config, RFC 8693 token
          exchange for agent delegation
        </li>
        <li>
          <strong>LLM Provider</strong>: Pluggable — OpenAI, Anthropic (Claude),
          Groq, Google Gemini, or Helix (PingOne AI platform)
        </li>
      </ul>
    </div>
  );
}

function ContainerTab() {
  return (
    <div>
      <h3 style={{ marginTop: 0 }}>C4 Level 2 — Container Diagram</h3>
      <p>The major deployable units and how they communicate.</p>

      <StaticFlowDiagram NODES={CONTAINER_NODES} EDGES={CONTAINER_EDGES} GROUPS={C4_GROUPS} testId="c4-container-diagram" ariaLabel="C4 containers: SPA, BFF, MCP server, Redis, PingOne and LMDB" />

      <h4>Containers</h4>
      <table
        style={{
          width: "100%",
          borderCollapse: "collapse",
          fontSize: "0.85rem",
        }}
      >
        <thead>
          <tr style={{ borderBottom: "2px solid #e5e7eb", textAlign: "left" }}>
            <th style={{ padding: "6px" }}>Container</th>
            <th style={{ padding: "6px" }}>Technology</th>
            <th style={{ padding: "6px" }}>Role</th>
          </tr>
        </thead>
        <tbody>
          {[
            [
              "banking_api_ui",
              "React 18 (CRA)",
              "SPA — session cookies only, never sees raw tokens",
            ],
            [
              "banking_api_server",
              "Express (Node.js CJS)",
              "BFF — holds all tokens server-side, hosts embedded LangGraph AI agent",
            ],
            [
              "banking_mcp_server",
              "TypeScript (strict)",
              "MCP WebSocket server — tool registry, banking API proxy, auth challenges",
            ],
            [
              "Upstash Redis",
              "Redis (managed)",
              "Session store for Vercel serverless cross-instance persistence",
            ],
            [
              "LMDB",
              "lmdb (npm)",
              "Local config persistence in dev (Vercel KV replaces in production)",
            ],
            [
              "PingOne",
              "Cloud service",
              "OAuth 2.0 AS, OIDC, Management API, MFA, RFC 8693 token exchange",
            ],
          ].map(([name, tech, role], i) => (
            <tr
              key={name}
              style={{
                borderBottom: "1px solid #f3f4f6",
                background: i % 2 ? "#f9fafb" : "white",
              }}
            >
              <td
                style={{
                  padding: "6px",
                  fontWeight: 600,
                  fontFamily: "inherit",
                  fontSize: "0.8rem",
                }}
              >
                {name}
              </td>
              <td style={{ padding: "6px" }}>{tech}</td>
              <td style={{ padding: "6px" }}>{role}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ComponentTab() {
  return (
    <div>
      <h3 style={{ marginTop: 0 }}>C4 Level 3 — Component (BFF internals)</h3>
      <p>
        Inside <code>banking_api_server</code> — the major modules and their
        responsibilities.
      </p>

      <StaticFlowDiagram NODES={COMPONENT_NODES} EDGES={[]} GROUPS={C4_GROUPS} walk={COMPONENT_WALK} testId="c4-component-diagram" ariaLabel="C4 components inside banking_api_server" />

      <h4>Component responsibilities</h4>
      <ul>
        <li>
          <strong>OAuth Routes</strong> — PKCE login, callback (code to token),
          logout with revocation, auto-refresh
        </li>
        <li>
          <strong>Token Exchange</strong> — RFC 8693 1-exchange (user to MCP)
          and 2-exchange (user + agent CC to MCP)
        </li>
        <li>
          <strong>CIBA Service</strong> — backchannel authentication initiation
          and polling
        </li>
        <li>
          <strong>MFA Service</strong> — PingOne deviceAuthentications API
          (email OTP, TOTP, FIDO2, push)
        </li>
        <li>
          <strong>AI Agent</strong> — LangGraph agent with heuristic regex
          parser (fast path) + LLM tool calling (slow path) + MCP WebSocket
          client
        </li>
        <li>
          <strong>ConfigStore</strong> — persistent config (LMDB local, Vercel
          KV in production)
        </li>
        <li>
          <strong>DataStore</strong> — in-memory demo accounts and transactions
          with atomic backup/recovery
        </li>
        <li>
          <strong>Session MW</strong> — express-session with Upstash Redis
          store, PKCE state cookies
        </li>
        <li>
          <strong>Delegation</strong> — act/may_act claim validation, delegation
          chain audit logging
        </li>
      </ul>
    </div>
  );
}

function CodeTab() {
  return (
    <div>
      <h3 style={{ marginTop: 0 }}>C4 Level 4 — Code (key services)</h3>
      <p>The critical service files and their call relationships.</p>

      <StaticFlowDiagram NODES={CODE_NODES} EDGES={CODE_EDGES} GROUPS={C4_GROUPS} testId="c4-code-diagram" ariaLabel="C4 code: key service files and their call relationships" />

      <h4>Key service files</h4>
      <table
        style={{
          width: "100%",
          borderCollapse: "collapse",
          fontSize: "0.8rem",
        }}
      >
        <thead>
          <tr style={{ borderBottom: "2px solid #e5e7eb", textAlign: "left" }}>
            <th style={{ padding: "6px" }}>Service</th>
            <th style={{ padding: "6px" }}>Purpose</th>
          </tr>
        </thead>
        <tbody>
          {[
            [
              "oauthService.js",
              "PKCE code generation, token exchange, refresh, revocation",
            ],
            [
              "agentMcpTokenService.js",
              "Orchestrates RFC 8693 1-exchange or 2-exchange for MCP tool calls",
            ],
            [
              "mfaService.js",
              "PingOne MFA — OTP/TOTP/FIDO2/push via deviceAuthentications API",
            ],
            [
              "tokenChainService.js",
              "Tracks token events — sub, act, token types through exchange chain",
            ],
            [
              "bankingAgentLangGraphService.js",
              "LangGraph agent with heuristic parser and MCP tool integration",
            ],
            [
              "agentBuilder.js",
              "LLM provider selection (OpenAI, Anthropic, Groq, Gemini, Helix)",
            ],
            [
              "pingOneClientService.js",
              "Management API client — worker token, user CRUD",
            ],
            [
              "configStore.js",
              "Persistent config — LMDB local, Vercel KV in production",
            ],
            [
              "data/store.js",
              "In-memory demo data — accounts, transactions, users, with backup/recovery",
            ],
          ].map(([svc, purpose], i) => (
            <tr
              key={svc}
              style={{
                borderBottom: "1px solid #f3f4f6",
                background: i % 2 ? "#f9fafb" : "white",
              }}
            >
              <td
                style={{
                  padding: "6px",
                  fontFamily: "inherit",
                  fontSize: "0.75rem",
                  fontWeight: 600,
                }}
              >
                {svc}
              </td>
              <td style={{ padding: "6px" }}>{purpose}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function ArchitectureDiagramPanel({
  isOpen,
  onClose,
  initialTabId,
}) {
  const tabs = [
    { id: "context", label: "1. Context", content: <ContextTab /> },
    { id: "container", label: "2. Container", content: <ContainerTab /> },
    { id: "component", label: "3. Component", content: <ComponentTab /> },
    { id: "code", label: "4. Code", content: <CodeTab /> },
  ];

  return (
    <EducationDrawer
      isOpen={isOpen}
      onClose={onClose}
      title="C4 Architecture — AI Demo"
      tabs={tabs}
      initialTabId={initialTabId}
      width="min(720px, 100vw)"
    />
  );
}
