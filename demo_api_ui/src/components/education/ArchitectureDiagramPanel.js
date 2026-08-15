// banking_api_ui/src/components/education/ArchitectureDiagramPanel.js
import React from "react";
import EducationDrawer from "../shared/EducationDrawer";

function ContextTab() {
  return (
    <div>
      <h3 style={{ marginTop: 0 }}>C4 Level 1 — System Context</h3>
      <p>
        The highest-level view: who uses the system and what external systems it
        depends on.
      </p>

      <pre className="edu-code">{`
                    ┌─────────────────────┐
                    │    Banking User      │
                    │  (Customer / Admin)  │
                    └──────────┬──────────┘
                               │ uses
                               ▼
                    ┌─────────────────────┐
                    │      AI Demo        │
                    │  AI-powered banking │
                    │  RFC 8693 delegation│
                    └───┬──────────┬──────┘
                        │          │
          OAuth+OIDC    │          │ AI inference
          RFC 8693      │          │
                        ▼          ▼
          ┌──────────────┐  ┌───────────────────────┐
          │   PingOne    │  │      LLM Provider      │
          │  OAuth 2.0   │  │  OpenAI · Anthropic    │
          │  OIDC · MFA  │  │  Groq · Gemini · Helix │
          │  Mgmt API    │  └───────────────────────┘
          └──────────────┘`}</pre>

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

      <pre className="edu-code">{`
  ┌──────────────────────────────────────────────────────┐
  │                    Vercel Platform                    │
  │                                                      │
  │  ┌─────────────────┐    ┌──────────────────────┐    │
  │  │  banking_api_ui  │    │  banking_api_server   │    │
  │  │  (React 18 SPA)  │───▶│  (Express BFF)        │    │
  │  │                  │    │                      │    │
  │  │  • Session cookie│    │  • OAuth routes      │    │
  │  │  • No raw tokens │    │  • RFC 8693 exchange │    │
  │  │  • Education UI  │    │  • CIBA / MFA        │    │
  │  │                  │    │  • LangGraph AI agent│    │
  │  └─────────────────┘    └──────┬───────────────┘    │
  │                                │                    │
  └────────────────────────────────┼────────────────────┘
                                   │
          ┌────────────────────────┼────────────────┐
          │                        │                │
          ▼                        ▼                ▼
  ┌──────────────┐   ┌────────────────────┐  ┌──────────────┐
  │ Upstash Redis│   │ banking_mcp_server  │  │   PingOne    │
  │              │   │   (TypeScript)     │  │              │
  │ Session store│   │   ws://:8080       │  │ auth.pingone │
  │ (Vercel KV)  │   │   MCP tool server  │  │ api.pingone  │
  └──────────────┘   └────────────────────┘  └──────────────┘
                               ▲
                     LMDB (local dev only)
                     Config + session fallback`}</pre>

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

      <pre className="edu-code">{`
  ┌──────────────────────────────────────────────────────┐
  │              banking_api_server (BFF)                 │
  │                                                      │
  │  ┌─────────────┐  ┌──────────────┐  ┌────────────┐  │
  │  │ OAuth Routes │  │Token Exchange│  │CIBA Service│  │
  │  │ login        │  │RFC 8693      │  │backchannel │  │
  │  │ callback     │  │1-exchange    │  │auth + poll │  │
  │  │ logout       │  │2-exchange    │  │            │  │
  │  │ refresh      │  └──────────────┘  └────────────┘  │
  │  └─────────────┘                                     │
  │                                                      │
  │  ┌─────────────┐  ┌──────────────┐  ┌────────────┐  │
  │  │ MFA Service  │  │   AI Agent   │  │ ConfigStore│  │
  │  │ OTP, TOTP,   │  │  LangGraph   │  │  LMDB / KV │  │
  │  │ FIDO2, push  │  │  heuristic   │  │ persistence│  │
  │  │              │  │  + MCP client│  │            │  │
  │  └─────────────┘  └──────────────┘  └────────────┘  │
  │                                                      │
  │  ┌─────────────┐  ┌──────────────┐  ┌────────────┐  │
  │  │  DataStore   │  │  Session MW  │  │ Delegation │  │
  │  │  accounts,   │  │ Upstash Redis│  │ act/may_act│  │
  │  │  transactions│  │ PKCE cookies │  │ audit trail│  │
  │  └─────────────┘  └──────────────┘  └────────────┘  │
  └──────────────────────────────────────────────────────┘`}</pre>

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

      <pre className="edu-code">{`
  agentBuilder.js ─────────────────────────────────────┐
    LLM selection                                       │
    OpenAI · Anthropic · Groq · Gemini · Helix          │
                                                        ▼
  oauthService.js ──────────────▶ bankingAgentLangGraphService.js
    PKCE, token mgmt                LangGraph + heuristic parser
                                    │                   │
                                    ▼                   ▼
                          agentMcpTokenService.js  mcpWebSocketClient.js
                            RFC 8693 orchestration   ws://banking_mcp_server
                            1-exchange or 2-exchange
                                    │
                    ┌───────────────┤
                    ▼               ▼
          pingOneClientService.js  tokenChainService.js
            Management API          Token event tracking
            Worker token            sub, act, aud chain
                    │
                    ▼
  mfaService.js ──▶ configStore.js        data/store.js
    OTP/TOTP/FIDO2   LMDB / Vercel KV     Accounts, txns
                     Persistent config     In-memory + backup`}</pre>

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
