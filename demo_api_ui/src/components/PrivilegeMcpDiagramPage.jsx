// PrivilegeMcpDiagramPage.jsx — Architecture and protocol-flow diagrams for
// the AI Agent Gateway integration (privilege/PRIVILEGE-MCP.md).
//
// Architecture and Auth Flow are node/edge graphs, so they render on React
// Flow (pan/zoom/minimap — the Auth Flow graph has 23 nodes and benefits from
// it). Sign-in + Tool Call is a UML-style sequence diagram — React Flow has
// no lifeline/actor primitive, so it stays on Mermaid, which renders that
// shape natively. The original Mermaid sources are kept for the two
// React-Flow tabs too, purely so "Download .mmd" still produces the same
// interop file (Lucidchart/draw.io/mermaid.live) documented in
// docs/diagrams/DIAGRAMS.md; there's no live source to re-upload for those
// tabs anymore, so DiagramExportBar's upload button is omitted for them.
import React, { useEffect, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  Handle,
  Position,
  MarkerType,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import DiagramExportBar from "./DiagramExportBar";
import { useMermaidRender } from "../hooks/useMermaidRender";
import "./PrivilegeMcpDiagramPage.css";

const ARCHITECTURE_SOURCE = `graph TB
    subgraph browser["Browser — no MCP here"]
        UI["/privilege-mcp-client<br/>React page (UI only)"]
    end

    subgraph demo["Demo stack (Docker Compose)"]
        BFF["demo-api-server<br/><b>MCP CLIENT</b><br/>/api/privilege-mcp/* (user)<br/>/api/privilege-mcp-simple/* (machine)"]
        GW["ping-mcpgw — cyonproxy<br/>binds no public port<br/><b>MCP CLIENT</b> to mcp-server"]
        MCP["mcp-server :8080<br/><b>MCP SERVER</b> — owns the tools<br/>aud mcpserver.ping.demo"]
    end

    subgraph ping["PingOne (cloud) — identity and policy, not MCP"]
        AS["Authorization server<br/>auth.pingone.com/{envId}/as"]
        CP["Privilege control plane<br/>grpc.privilege.pingone.com:443"]
        API["Privilege cloud API<br/>privilege.pingone.com/api/mcp"]
    end

    UI -->|"HTTPS + session cookie<br/>(not MCP)"| BFF
    BFF -.->|"SSE: live relay events"| UI
    BFF -->|"OAuth 2.0 code + PKCE (user)<br/>client_credentials (machine)"| AS
    BFF -->|"MCP session 1<br/>JSON-RPC over HTTP"| GW
    GW -->|"MCP session 2<br/>policy applied between them"| MCP
    BFF -->|"MCP direct — simple route,<br/>works today"| MCP
    GW <-->|"outbound gRPC<br/>enrollment JWT"| CP
    API -.->|"NOT the gateway frontend"| GW

    classDef mcpserver stroke-width:3px
    classDef broken stroke-dasharray: 5 5
    class MCP,GW mcpserver
    class API broken`;

const SEQUENCE_SOURCE = `sequenceDiagram
    autonumber
    participant U as Operator
    participant P as Client page (UI)
    participant B as BFF — MCP CLIENT
    participant A as PingOne AS
    participant G as Gateway — MCP server+client
    participant M as mcp-server — MCP SERVER

    U->>P: Sign In with Privilege
    P->>B: POST /auth/start
    B->>G: GET mcpUrl (discover auth metadata)
    G-->>B: authorization_uri + token_uri<br/>(or 401 → PingOne OIDC fallback)
    B-->>P: authUrl (PKCE S256, state, login_hint)
    U->>A: hosted sign-on
    A-->>B: GET /auth/callback?code&state
    B->>A: POST token (code + verifier + client_secret)
    A-->>B: access_token (+ refresh_token)
    B-->>P: redirect ?auth=success

    U->>P: Load Tools
    P->>B: POST /tools/list
    B->>G: initialize
    G-->>B: protocolVersion + MCP-Session-Id
    B->>G: notifications/initialized
    B->>G: tools/list (Bearer + session headers)
    G->>M: tools/list
    M-->>G: tools
    G-->>B: tools (JSON or SSE frames)
    B-->>P: { tools }

    U->>P: Run a tool
    P->>B: POST /tools/call
    B->>G: tools/call
    Note over G: Privilege decides:<br/>JIT least-privilege policy<br/>+ session recording
    alt permitted
        G->>M: tools/call
        M-->>G: result
        G-->>B: result
    else denied by policy
        G-->>B: 4xx — relayed with its own status
    end
    B-->>P: result or error`;

const AUTH_FLOW_SOURCE = `flowchart LR
    A([Browser /privilege-mcp-client]) --> B[GET /api/privilege-mcp/state]
    B --> C{oauth.accessToken\\nin session?}

    C -- No --> D[User clicks Sign In]
    D --> E[POST /api/privilege-mcp/auth/start]
    E --> F{MCP URL responds\\nwith WWW-Authenticate?}
    F -- Yes --> G[Use authorization_uri\\n+ token_uri from header]
    F -- No --> H[PingOne OIDC fallback\\nauth.pingone.com/PRIVILEGE_SSO_ENV_ID/as\\n.well-known/openid-configuration]
    G --> I[Generate PKCE\\nverifier SHA-256 challenge S256\\n+ random state]
    H --> I
    I --> J[Redirect browser to\\nauthorize?client_id=PRIVILEGE_SSO_CLIENT_ID\\n&code_challenge=...&state=...]
    J --> K[User signs in at PingOne]
    K --> L[PingOne redirects to\\n/api/privilege-mcp/auth/callback\\n?code=...&state=...]
    L --> M[BFF verifies state\\nPOST token_uri\\ngrant_type=authorization_code\\nclient_id + client_secret POST\\ncode + code_verifier]
    M --> N{200?}
    N -- 401 invalid_client --> O[❌ Wrong secret or\\nclient not SECRET_POST]
    N -- 200 --> P[Store access_token\\nrefresh_token + expiresAt\\nin clientSessions map]
    P --> Q[Redirect to\\n/privilege-mcp-client?auth=success]

    C -- Yes --> R
    Q --> R[POST /api/privilege-mcp/tools/list]
    R --> S{Token expiring\\nwithin 60s?}
    S -- Yes --> T[POST token_uri\\ngrant_type=refresh_token\\nclient_id + client_secret]
    T --> R
    S -- No --> U[POST PRIVILEGE_MCPGW_URL\\nAuthorization: Bearer access_token\\nmcp-protocol-version header\\nMCP-Session-Id header if set]
    U --> V[initialize handshake\\nif not yet done]
    V --> W[tools/list]
    W --> X[mcp-server:8080\\nMCP_AUTH_DISABLED=true\\nreturns stub token\\nskips all auth checks]
    X --> Y[✅ Tools returned to UI]

    style O fill:#c0392b,color:#fff
    style P fill:#1e8449,color:#fff
    style X fill:#1a5276,color:#fff
    style Y fill:#1e8449,color:#fff`;

// ─── React Flow — shared node renderer ────────────────────────────────────────
// One flexible node type instead of five, keyed by data.variant. Colors are
// literal (not --th-*): this page is a deliberately fixed-dark diagram page
// (PrivilegeMcpDiagramPage.css's own --pmd-* palette, unaffected by the app's
// light/dark toggle), and the variant colors are semantic status accents
// (error/success/highlight), which THEMING.md §1.3 keeps literal regardless.
const VARIANT_STYLE = {
  default: { border: "var(--pmd-border)", bg: "var(--pmd-panel)", text: "var(--pmd-ink)" },
  emphasis: { border: "var(--pmd-accent)", bg: "var(--pmd-panel)", text: "var(--pmd-ink)", borderWidth: 3 },
  broken: { border: "var(--pmd-border)", bg: "var(--pmd-panel)", text: "var(--pmd-ink)", dashed: true },
  decision: { border: "var(--pmd-accent)", bg: "var(--pmd-panel)", text: "var(--pmd-ink)", dashed: true },
  error: { border: "#c0392b", bg: "rgba(192,57,43,0.18)", text: "#f87171" },
  success: { border: "#1e8449", bg: "rgba(30,132,73,0.18)", text: "#4ade80" },
  highlight: { border: "#1a5276", bg: "rgba(26,82,118,0.22)", text: "#7dd3fc" },
};

function PmdNode({ data }) {
  const v = VARIANT_STYLE[data.variant] || VARIANT_STYLE.default;
  return (
    <div
      style={{
        borderStyle: v.dashed ? "dashed" : "solid",
        borderWidth: v.borderWidth || 1.5,
        borderColor: v.border,
        background: v.bg,
        color: v.text,
        borderRadius: data.pill ? 999 : 8,
        padding: "8px 12px",
        minWidth: 150,
        maxWidth: 210,
        fontSize: "0.68rem",
        lineHeight: 1.35,
        textAlign: "center",
        boxShadow: "0 2px 6px rgba(0,0,0,0.25)",
      }}
    >
      <div style={{ fontWeight: 700 }}>{data.title}</div>
      {data.sub && <div style={{ opacity: 0.8, marginTop: 2 }}>{data.sub}</div>}
      <Handle type="source" position={Position.Right} style={{ opacity: 0 }} />
      <Handle type="target" position={Position.Left} style={{ opacity: 0 }} />
      <Handle type="source" position={Position.Bottom} style={{ opacity: 0 }} />
      <Handle type="target" position={Position.Top} style={{ opacity: 0 }} />
    </div>
  );
}

const NODE_TYPES = { pmd: PmdNode };

const EDGE_DEFAULTS = { style: { stroke: "var(--pmd-ink-2)", strokeWidth: 1.4 } };

// ─── Architecture tab — React Flow data ───────────────────────────────────────
// Columns: browser (no MCP) · demo stack (Docker Compose) · PingOne (cloud).
// GW/MCP get the "emphasis" variant for Mermaid's `mcpserver` class (thicker
// border — these two own the actual MCP protocol); API gets "broken" for
// Mermaid's dashed `broken` class (it's the control-plane API, not the
// gateway frontend a client would talk MCP to).
const ARCH_GROUP_LABEL = [
  { label: "Browser — no MCP here", x: 20 },
  { label: "Demo stack (Docker Compose)", x: 300 },
  { label: "PingOne (cloud) — identity and policy, not MCP", x: 580 },
];

const ARCH_NODES = [
  { id: "ui", type: "pmd", position: { x: 20, y: 150 }, data: { title: "UI", sub: "/privilege-mcp-client (React, UI only)", variant: "default" } },
  { id: "bff", type: "pmd", position: { x: 300, y: 20 }, data: { title: "BFF", sub: "demo-api-server — MCP CLIENT", variant: "default" } },
  { id: "gw", type: "pmd", position: { x: 300, y: 150 }, data: { title: "Gateway", sub: "ping-mcpgw (cyonproxy) — MCP CLIENT to mcp-server", variant: "emphasis" } },
  { id: "mcp", type: "pmd", position: { x: 300, y: 300 }, data: { title: "mcp-server :8080", sub: "MCP SERVER — owns the tools (aud mcpserver.ping.demo)", variant: "emphasis" } },
  { id: "as", type: "pmd", position: { x: 580, y: 20 }, data: { title: "Authorization server", sub: "auth.pingone.com/{envId}/as", variant: "default" } },
  { id: "cp", type: "pmd", position: { x: 580, y: 150 }, data: { title: "Privilege control plane", sub: "grpc.privilege.pingone.com:443", variant: "default" } },
  { id: "api", type: "pmd", position: { x: 580, y: 300 }, data: { title: "Privilege cloud API", sub: "privilege.pingone.com/api/mcp", variant: "broken" } },
];

const ARCH_EDGES = [
  { id: "ui-bff", source: "ui", target: "bff", label: "HTTPS + session cookie (not MCP)", ...EDGE_DEFAULTS },
  { id: "bff-ui", source: "bff", target: "ui", label: "SSE: live relay events", style: { ...EDGE_DEFAULTS.style, strokeDasharray: "5 4" } },
  { id: "bff-as", source: "bff", target: "as", label: "OAuth 2.0 code+PKCE (user) / client_credentials (machine)", ...EDGE_DEFAULTS },
  { id: "bff-gw", source: "bff", target: "gw", label: "MCP session 1 (JSON-RPC/HTTP)", ...EDGE_DEFAULTS },
  { id: "gw-mcp", source: "gw", target: "mcp", label: "MCP session 2 — policy applied between them", style: { stroke: "var(--pmd-accent)", strokeWidth: 2.5 } },
  { id: "bff-mcp", source: "bff", target: "mcp", label: "MCP direct — simple route, works today", ...EDGE_DEFAULTS },
  { id: "gw-cp", source: "gw", target: "cp", label: "outbound gRPC · enrollment JWT", markerStart: { type: MarkerType.ArrowClosed }, ...EDGE_DEFAULTS },
  { id: "api-gw", source: "api", target: "gw", label: "NOT the gateway frontend", style: { ...EDGE_DEFAULTS.style, strokeDasharray: "5 4" } },
];

// ─── Auth Flow tab — React Flow data ──────────────────────────────────────────
// A 23-node flowchart is exactly the case a static Mermaid SVG (shrunk to fit
// the panel width) renders too small to read — React Flow's pan/zoom is a
// real improvement here, not just a like-for-like swap. Grid-positioned by
// hand (col/row → x/y), same convention as ArchitectureCanvasPage's
// useCanvasLayout and ArchitectureFlowPage's INITIAL_NODES.
const COL = 250;
const ROW = 130;
const grid = (col, row) => ({ x: 20 + col * COL, y: 20 + row * ROW });

const AUTH_NODES = [
  { id: "A", position: grid(0, 1), data: { title: "Browser", sub: "/privilege-mcp-client", variant: "default", pill: true } },
  { id: "B", position: grid(1, 1), data: { title: "GET /api/privilege-mcp/state", variant: "default" } },
  { id: "C", position: grid(2, 1), data: { title: "Token in session?", variant: "decision" } },
  { id: "D", position: grid(2, 2), data: { title: "User clicks Sign In", variant: "default" } },
  { id: "E", position: grid(3, 2), data: { title: "POST /auth/start", variant: "default" } },
  { id: "F", position: grid(4, 2), data: { title: "WWW-Authenticate present?", variant: "decision" } },
  { id: "G", position: grid(5, 1), data: { title: "Use header's authorization_uri + token_uri", variant: "default" } },
  { id: "H", position: grid(5, 3), data: { title: "PingOne OIDC fallback", sub: ".well-known/openid-configuration", variant: "default" } },
  { id: "I", position: grid(6, 2), data: { title: "Generate PKCE", sub: "S256 verifier + state", variant: "default" } },
  { id: "J", position: grid(7, 2), data: { title: "Redirect to /authorize", variant: "default" } },
  { id: "K", position: grid(8, 2), data: { title: "User signs in at PingOne", variant: "default" } },
  { id: "L", position: grid(9, 2), data: { title: "Redirect to /auth/callback", sub: "?code&state", variant: "default" } },
  { id: "M", position: grid(10, 2), data: { title: "BFF verifies state", sub: "POST token_uri", variant: "default" } },
  { id: "N", position: grid(11, 2), data: { title: "200?", variant: "decision" } },
  { id: "O", position: grid(12, 1), data: { title: "Wrong secret / not SECRET_POST", variant: "error" } },
  { id: "P", position: grid(12, 2), data: { title: "Store tokens", sub: "clientSessions map", variant: "success" } },
  { id: "Q", position: grid(13, 2), data: { title: "Redirect ?auth=success", variant: "default" } },
  { id: "R", position: grid(2, 4), data: { title: "POST /tools/list", variant: "default" } },
  { id: "S", position: grid(3, 4), data: { title: "Token expiring <60s?", variant: "decision" } },
  { id: "T", position: grid(3, 5), data: { title: "Refresh token", sub: "grant_type=refresh_token", variant: "default" } },
  { id: "U", position: grid(4, 4), data: { title: "POST gateway URL", sub: "Bearer + MCP-Session-Id", variant: "default" } },
  { id: "V", position: grid(5, 4), data: { title: "initialize handshake", variant: "default" } },
  { id: "W", position: grid(6, 4), data: { title: "tools/list", variant: "default" } },
  { id: "X", position: grid(7, 4), data: { title: "mcp-server:8080", sub: "MCP_AUTH_DISABLED=true", variant: "highlight" } },
  { id: "Y", position: grid(8, 4), data: { title: "Tools returned to UI", variant: "success" } },
].map((n) => ({ ...n, type: "pmd" }));

const AUTH_EDGES = [
  ["A", "B"], ["B", "C"],
  ["C", "D", "No"], ["D", "E"], ["E", "F"],
  ["F", "G", "Yes"], ["F", "H", "No"],
  ["G", "I"], ["H", "I"],
  ["I", "J"], ["J", "K"], ["K", "L"], ["L", "M"], ["M", "N"],
  ["N", "O", "401 invalid_client"], ["N", "P", "200"],
  ["P", "Q"],
  ["C", "R", "Yes"], ["Q", "R"],
  ["R", "S"],
  ["S", "T", "Yes"], ["T", "R", "retry"],
  ["S", "U", "No"],
  ["U", "V"], ["V", "W"], ["W", "X"], ["X", "Y"],
].map(([source, target, label]) => ({
  id: `${source}-${target}`,
  source,
  target,
  label,
  ...EDGE_DEFAULTS,
}));

const TABS = [
  { id: "arch", label: "Architecture", kind: "reactflow", nodes: ARCH_NODES, edges: ARCH_EDGES, source: ARCHITECTURE_SOURCE, filename: "privilege-mcp-architecture.mmd" },
  { id: "seq", label: "Sign-in + Tool Call", kind: "mermaid", source: SEQUENCE_SOURCE, filename: "privilege-mcp-sequence.mmd" },
  { id: "flow", label: "Auth Flow", kind: "reactflow", nodes: AUTH_NODES, edges: AUTH_EDGES, source: AUTH_FLOW_SOURCE, filename: "privilege-mcp-auth-flow.mmd" },
];

const SEQUENCE_OPTS = { useMaxWidth: true, wrap: true };
const FLOWCHART_OPTS = { useMaxWidth: true };

export default function PrivilegeMcpDiagramPage() {
  const [activeTab, setActiveTab] = useState("arch");
  const [source, setSource] = useState(TABS[0].source);

  useEffect(() => {
    const tab = TABS.find((t) => t.id === activeTab);
    if (tab) setSource(tab.source);
  }, [activeTab]);

  const { containerRef, error: renderError } = useMermaidRender(source, {
    sequence: SEQUENCE_OPTS,
    flowchart: FLOWCHART_OPTS,
  });

  const activeTabMeta = TABS.find((t) => t.id === activeTab);
  const isMermaid = activeTabMeta?.kind === "mermaid";

  return (
    <div className="pmd-page">
      <div className="pmd-hero">
        <span className="pmd-eyebrow">AI Agent Gateway</span>
        <h1>AI Agent Gateway Diagrams</h1>
        <p className="pmd-sub">
          Architecture and protocol flow for the AI Agent Gateway integration.
          The gateway applies JIT least-privilege authorization to every MCP tool call.
        </p>
      </div>

      <div className="pmd-tabs">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            className={`pmd-tab${activeTab === tab.id ? " pmd-tab--active" : ""}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <DiagramExportBar
        source={activeTabMeta?.source}
        sourceFilename={activeTabMeta?.filename || "privilege-mcp.mmd"}
        onSourceChange={isMermaid ? setSource : undefined}
      />

      <div className="pmd-panel">
        {isMermaid ? (
          renderError ? (
            <p className="pmd-error">Diagram failed to render: {renderError}</p>
          ) : (
            <div className="pmd-diagram" ref={containerRef} aria-label="Privilege MCP diagram" />
          )
        ) : (
          <>
            {activeTab === "arch" && (
              <div className="pmd-rf-legend" aria-hidden="true">
                {ARCH_GROUP_LABEL.map((g) => (
                  <span key={g.label} className="pmd-rf-legend-item">{g.label}</span>
                ))}
              </div>
            )}
            <div className="pmd-rf-canvas" aria-label="Privilege MCP diagram">
              <ReactFlow
                nodes={activeTabMeta.nodes}
                edges={activeTabMeta.edges}
                nodeTypes={NODE_TYPES}
                fitView
                proOptions={{ hideAttribution: true }}
              >
                <Background color="var(--pmd-border)" gap={24} />
                <Controls showInteractive={false} />
                <MiniMap pannable zoomable style={{ background: "var(--pmd-panel)" }} />
              </ReactFlow>
            </div>
          </>
        )}
      </div>

      <p className="pmd-footer">
        Source:{" "}
        <a
          href="https://github.com/curtismu7/AI-DEMO2/blob/main/privilege/PRIVILEGE-MCP.md"
          className="pmd-link"
        >
          privilege/PRIVILEGE-MCP.md
        </a>
        . The dashed line marks the Privilege cloud API as NOT the gateway frontend — it's a
        separate control-plane endpoint, not an alternate route for MCP traffic. The BFF also
        talks to mcp-server directly via <code>/api/privilege-mcp-simple/*</code> (no human,
        no Privilege policy) alongside the gateway-mediated path shown here.
      </p>
    </div>
  );
}
