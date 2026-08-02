// PrivilegeMcpDiagramPage.jsx — Architecture and sequence diagrams from
// docs/PRIVILEGE-MCP.md rendered via Mermaid. Two tabs: Architecture (graph TB)
// and Sign-in + Tool Call (sequenceDiagram).
import React, { useEffect, useRef, useState } from "react";
import mermaid from "mermaid";
import DiagramExportBar from "./DiagramExportBar";
import "./PrivilegeMcpDiagramPage.css";

const ARCHITECTURE_SOURCE = `graph TB
    subgraph browser["Browser"]
        UI["/privilege-mcp-client<br/>React page"]
    end

    subgraph demo["Demo stack (Docker Compose)"]
        BFF["demo-api-server<br/>/api/privilege-mcp/*"]
        GW["ping-mcpgw :8680<br/>cyonproxy"]
        MCP["mcp-server :8080<br/>Privilege-unaware"]
    end

    subgraph ping["PingOne (cloud)"]
        AS["Authorization server<br/>auth.pingone.com/{envId}/as"]
        CP["Privilege control plane<br/>grpc.privilege.pingone.com:443"]
        API["Privilege cloud API<br/>privilege.pingone.com/api/mcp"]
    end

    UI -->|"HTTPS + session cookie"| BFF
    BFF -.->|"SSE: live relay events"| UI
    BFF -->|"OAuth 2.0 code + PKCE"| AS
    BFF -->|"MCP JSON-RPC over HTTP"| GW
    GW -->|"MCP JSON-RPC"| MCP
    GW <-->|"outbound gRPC<br/>enrollment JWT"| CP
    BFF -.->|"currently configured here<br/>instead of the gateway"| API

    classDef broken stroke-dasharray: 5 5
    class API broken`;

const SEQUENCE_SOURCE = `sequenceDiagram
    autonumber
    participant U as Operator
    participant P as Client page
    participant B as BFF relay
    participant A as PingOne AS
    participant G as MCP Gateway
    participant M as MCP server

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

const TABS = [
  { id: "arch", label: "Architecture", source: ARCHITECTURE_SOURCE, filename: "privilege-mcp-architecture.mmd" },
  { id: "seq", label: "Sign-in + Tool Call", source: SEQUENCE_SOURCE, filename: "privilege-mcp-sequence.mmd" },
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
        <span className="pmd-eyebrow">Privilege MCP Gateway</span>
        <h1>Privilege MCP Diagrams</h1>
        <p className="pmd-sub">
          Architecture and protocol flow for the PingOne Privilege MCP Gateway integration.
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
        Source: <a href="https://github.com" className="pmd-link">docs/PRIVILEGE-MCP.md</a>.
        Dashed lines indicate the currently broken path (gateway not yet serving).
      </p>
    </div>
  );
}
