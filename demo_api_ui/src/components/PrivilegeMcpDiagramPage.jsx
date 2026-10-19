// PrivilegeMcpDiagramPage.jsx — Architecture and protocol-flow diagrams for
// the AI Agent Gateway integration (privilege/PRIVILEGE-MCP.md).
//
// All three figures (Architecture, Sign-in + Tool Call, Auth Flow) are drawn in the Ping style by the shared
// EmbeddedFlowDiagram/StaticFlowDiagram (pingStyle): numbered arrows, a step reel with the request on the wire,
// MOCK tokens and the standards behind each step. Their data is src/config/privilegeMcpDiagrams.js and
// privilegeMcpStandards.js. The original Mermaid sources below are kept only so "Download .mmd" still produces
// the same interop file (Lucidchart/draw.io/mermaid.live) documented in docs/diagrams/DIAGRAMS.md.
import React, { useState } from "react";
import DiagramExportBar from "./DiagramExportBar";
import EmbeddedFlowDiagram from "./EmbeddedFlowDiagram";
import { PMD_ARCH_DIAGRAM, PMD_SEQ_DIAGRAM, PMD_FLOW_DIAGRAM } from "../config/privilegeMcpDiagrams";
import "./PrivilegeMcpDiagramPage.css";
import PageHeader from './common/PageHeader';

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

const TABS = [
  {
    id: "arch", label: "Architecture", config: PMD_ARCH_DIAGRAM, source: ARCHITECTURE_SOURCE, filename: "privilege-mcp-architecture.mmd",
    title: "Architecture: who talks to whom",
    lede: "Follow the numbered arrows. The browser never speaks MCP; the BFF is the MCP client, the gateway applies policy between two MCP sessions, and PingOne is identity and policy, not MCP. Click a box or a card for the request on the wire, the mock tokens and the standards.",
    ariaLabel: "Privilege MCP architecture", diagramLabel: "Privilege MCP architecture diagram",
  },
  {
    id: "seq", label: "Sign-in + Tool Call", config: PMD_SEQ_DIAGRAM, source: SEQUENCE_SOURCE, filename: "privilege-mcp-sequence.mmd",
    title: "Sign-in, load tools, run a tool",
    lede: "Operator, page, BFF, PingOne, gateway and mcp-server in order. A request and its answer share one arrow; the orange number is the step. Click a card for the exact request and the standards behind it.",
    ariaLabel: "Privilege MCP sign-in and tool call", diagramLabel: "Privilege MCP sequence diagram",
  },
  {
    id: "flow", label: "Auth Flow", config: PMD_FLOW_DIAGRAM, source: AUTH_FLOW_SOURCE, filename: "privilege-mcp-auth-flow.mmd",
    title: "Auth flow: from page load to tools returned",
    lede: "Every branch the BFF takes: token already in the session or not, WWW-Authenticate header or the PingOne fallback, a good or a failed token exchange, and a refresh when the token is about to expire.",
    ariaLabel: "Privilege MCP auth flow", diagramLabel: "Privilege MCP auth flow diagram",
  },
];

export default function PrivilegeMcpDiagramPage() {
  const [activeTab, setActiveTab] = useState("arch");
  const tab = TABS.find((t) => t.id === activeTab);

  return (
    <div className="pmd-page pmd-page--ping">
      <PageHeader className="pmd-hero" eyebrow="AI Agent Gateway" title="AI Agent Gateway Diagrams" summary={<>Architecture and protocol flow for the AI Agent Gateway integration.
          The gateway applies JIT least-privilege authorization to every MCP tool call.</>} />

      <div className="pmd-tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`pmd-tab${activeTab === t.id ? " pmd-tab--active" : ""}`}
            onClick={() => setActiveTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <DiagramExportBar source={tab.source} sourceFilename={tab.filename} />

      <div className="pmd-panel">
        <EmbeddedFlowDiagram
          key={tab.id}
          config={tab.config}
          title={tab.title}
          lede={tab.lede}
          ariaLabel={tab.ariaLabel}
          diagramLabel={tab.diagramLabel}
          testId={`pmd-${tab.id}`}
          pingStyle
        />
      </div>

      <p className="pmd-footer">
        Source:{" "}
        <a
          href="https://github.com/cmuir_pingcorp/AI-DEMO2/blob/main/privilege/PRIVILEGE-MCP.md"
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
