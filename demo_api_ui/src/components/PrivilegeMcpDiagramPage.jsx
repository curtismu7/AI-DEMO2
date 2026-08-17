// PrivilegeMcpDiagramPage.jsx — Architecture and sequence diagrams from
// privilege/PRIVILEGE-MCP.md rendered via Mermaid. Three tabs: Architecture
// (graph TB) and Sign-in + Tool Call (sequenceDiagram) mirror the doc's
// current diagrams verbatim; Auth Flow is this page's own more detailed
// breakdown of the OAuth/PKCE handshake, not sourced from the doc.
import React, { useEffect, useRef, useState } from "react";
import mermaid from "mermaid";
import DiagramExportBar from "./DiagramExportBar";
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

const TABS = [
  { id: "arch", label: "Architecture", source: ARCHITECTURE_SOURCE, filename: "privilege-mcp-architecture.mmd" },
  { id: "seq", label: "Sign-in + Tool Call", source: SEQUENCE_SOURCE, filename: "privilege-mcp-sequence.mmd" },
  { id: "flow", label: "Auth Flow", source: AUTH_FLOW_SOURCE, filename: "privilege-mcp-auth-flow.mmd" },
];

export default function PrivilegeMcpDiagramPage() {
  const containerRef = useRef(null);
  const [activeTab, setActiveTab] = useState("arch");
  const [source, setSource] = useState(ARCHITECTURE_SOURCE);
  const [renderError, setRenderError] = useState(null);
  const renderIdRef = useRef(0);

  // Sync source when tab changes
  useEffect(() => {
    const tab = TABS.find((t) => t.id === activeTab);
    if (tab) setSource(tab.source);
  }, [activeTab]);

  useEffect(() => {
    let cancelled = false;
    setRenderError(null);
    mermaid.initialize({
      startOnLoad: false,
      theme: "dark",
      securityLevel: "loose",
      sequence: { useMaxWidth: true, wrap: true },
      flowchart: { useMaxWidth: true },
    });

    async function render() {
      try {
        const id = `privilege-mcp-diagram-${++renderIdRef.current}`;
        const { svg } = await mermaid.render(id, source);
        if (!cancelled && containerRef.current) {
          containerRef.current.innerHTML = svg;
        }
      } catch (err) {
        if (!cancelled) {
          setRenderError(err?.message || "Mermaid render failed");
        }
      }
    }
    render();
    return () => { cancelled = true; };
  }, [source]);

  const activeTabMeta = TABS.find((t) => t.id === activeTab);

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
        source={source}
        sourceFilename={activeTabMeta?.filename || "privilege-mcp.mmd"}
        onSourceChange={setSource}
      />

      <div className="pmd-panel">
        {renderError ? (
          <p className="pmd-error">Diagram failed to render: {renderError}</p>
        ) : (
          <div className="pmd-diagram" ref={containerRef} aria-label="Privilege MCP diagram" />
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
