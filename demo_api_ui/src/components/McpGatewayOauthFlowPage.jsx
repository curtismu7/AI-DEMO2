// McpGatewayOauthFlowPage.jsx — the reference MCP OAuth handshake sequence
// (401 challenge -> protected-resource metadata -> initialize -> list_tools)
// redrawn against demo_mcp_gateway + demo_mcp_server's actual code path.
// Follows the mermaid.initialize/render pattern used by
// AgentOnboardingMermaidPage.jsx.
import React, { useEffect, useRef, useState } from "react";
import mermaid from "mermaid";
import DiagramExportBar from "./DiagramExportBar";
import "./McpGatewayOauthFlowPage.css";
import "./PrivilegeMcpDiagramPage.css";

export const ARCHITECTURE_SOURCE = `graph TB
    subgraph client["Client"]
        A["Agent<br/>(OAuth Client)"]
    end

    subgraph gw["demo_mcp_gateway — OAuth Resource Server"]
        G["Agent Gateway<br/>local JWT pre-filter (10)<br/>RFC 7662 introspection (11-12)<br/>PingOne Authorize PDP check (13)<br/>RFC 8693 token exchange (14-15)"]
    end

    subgraph mcp["demo_mcp_server — MCP Server (Banking, Mock)"]
        M["MCP Server<br/>independently re-verifies the<br/>exchanged token's signature via JWKS (17)"]
    end

    subgraph pingone["PingOne — Authorization Server"]
        P["auth.pingone.com<br/>issues, introspects,<br/>and exchanges tokens"]
    end

    A -->|"1-2) connect, initialize<br/>no token"| G
    G -->|"3) 401 + WWW-Authenticate"| A
    A -->|"4) GET .well-known/<br/>oauth-protected-resource"| G
    A -->|"6) OAuth2 authorization request"| P
    P -->|"7) access token"| A
    A -->|"9) initialize, Bearer token"| G
    G <-->|"11-12) introspect, RFC 7662"| P
    G <-->|"14-15) token exchange, RFC 8693"| P
    G -->|"16) forward initialize,<br/>exchanged token"| M
    M -->|"18) capabilities"| G
    G -->|"19) forward capabilities"| A

    classDef gwNode stroke-width:3px
    class G gwNode`;

const MERMAID_SOURCE = `sequenceDiagram
    participant U as User
    participant A as Agent (OAuth Client)
    participant G as Agent Gateway (OAuth RS)
    participant M as MCP Server (Banking, Mock)
    participant P as PingOne (Authorization Server)

    rect rgb(27,42,31)
    Note over U,P: Initialization - 401 challenge and resource discovery
    U->>A: 1) Connect
    A->>G: 2) POST /mcp initialize - no token
    G-->>A: 3) 401 Unauthorized + WWW-Authenticate (resource_metadata URI)
    A->>G: 4) GET /.well-known/oauth-protected-resource
    G-->>A: 5) 200 OK - authorization_servers, scopes, resource
    A->>P: 6) OAuth2 authorization request
    end

    rect rgb(36,26,6)
    Note over U,P: User authentication and consent (PingOne)
    P-->>A: 7) Return access token
    A->>A: 8) Store access token
    end

    rect rgb(27,42,31)
    Note over U,P: Session init - validate, authorize, exchange
    A->>G: 9) POST /mcp initialize - Bearer token
    G->>G: 10) Validate token (local JWT + aud pre-filter)
    G->>P: 11) Introspect token - RFC 7662
    P-->>G: 12) active: true, scopes
    G->>G: 13) Authorize - PingOne Authorize (PDP) policy check
    G->>P: 14) Exchange token for backend audience - RFC 8693
    P-->>G: 15) Exchanged token
    G->>M: 16) Forward initialize (exchanged token)
    M->>M: 17) Verify token signature - JWKS
    M-->>G: 18) protocolVersion, capabilities, serverInfo
    G-->>A: 19) Forward capabilities
    end

    rect rgb(36,26,6)
    Note over U,P: Tool discovery
    A->>G: 20) POST /mcp tools/list - Bearer token
    G->>G: 21) Validate + authorize + exchange (cached, 5-30s TTL)
    G->>M: 22) Forward tools/list (exchanged token)
    M-->>G: 23) Tool definitions - unfiltered, scope check deferred
    G-->>A: 24) Forward tool list
    end`;

const NOTES = [
  {
    title: "Initialization",
    items: [
      {
        text: "Steps 1-6 match the reference diagram exactly, on the HTTP transport.",
        cite: "GatewayServer.ts:479-503, 726-740, 294-322",
      },
      {
        mark: "delta",
        text: "WebSocket transport skips steps 2-5 entirely - a missing token just closes the socket (close code 4001), no 401 or WWW-Authenticate.",
        cite: "index.ts:1037-1040",
      },
    ],
  },
  {
    title: "Session init",
    items: [
      { text: "Step 10 is a cheap local pre-filter (decode + audience check), not the authoritative gate." },
      {
        text: "Steps 11-12 are the real check: remote RFC 7662 introspection against PingOne.",
        cite: "GatewayIntrospectionClient.ts:62-90",
      },
      {
        mark: "plus",
        text: "Step 13, a PingOne Authorize (PDP) policy check per call, has no equivalent in the reference diagram.",
        cite: "authorizeMcpRequest.ts:738-901",
      },
      {
        mark: "plus",
        text: "Steps 14-15, RFC 8693 token exchange before forwarding, are also absent from the reference - the backend never sees the client's original token.",
        cite: "index.ts:824-841",
      },
      {
        text: "Step 17: the backend independently re-verifies the (exchanged) token's signature via JWKS rather than trusting the gateway's decision outright.",
        cite: "TokenIntrospector.ts:104-165",
      },
      {
        text: "Step 18 serverInfo reports “AI Demo MCP Server” - the one backend drawn here; demo_mcp_resource_server and demo_mcp_jwt_verifier sit behind the same gateway in the real topology and are omitted per scope.",
        cite: "MCPMessageHandler.ts:41-55, 152-213",
      },
    ],
  },
  {
    title: "Tool discovery",
    items: [
      {
        text: "Step 21 re-runs validate/authorize/exchange on every call - no session-scoped trust, only a 5-30s introspection cache.",
        cite: "GatewayIntrospectionClient.ts:26-32",
      },
      {
        text: "Step 23 returns the full catalog (~40 static + ~193 generated) unfiltered; scope filtering is deferred to the gateway/PDP, not enforced by the MCP server itself.",
        cite: "MCPMessageHandler.ts:218-256, 220-226",
      },
    ],
  },
];

export default function McpGatewayOauthFlowPage() {
  const containerRef = useRef(null);
  const archRef = useRef(null);
  const [source, setSource] = useState(MERMAID_SOURCE);
  const [archSource, setArchSource] = useState(ARCHITECTURE_SOURCE);
  const [renderError, setRenderError] = useState(null);
  const [archRenderError, setArchRenderError] = useState(null);
  const renderIdRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    setRenderError(null);
    mermaid.initialize({
      startOnLoad: false,
      theme: "dark",
      securityLevel: "loose",
      sequence: { useMaxWidth: true, wrap: true },
    });

    async function render() {
      try {
        const id = `mcp-gateway-oauth-flow-svg-${++renderIdRef.current}`;
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
    return () => {
      cancelled = true;
    };
  }, [source]);

  useEffect(() => {
    let cancelled = false;
    setArchRenderError(null);
    mermaid.initialize({
      startOnLoad: false,
      theme: "dark",
      securityLevel: "loose",
      flowchart: { useMaxWidth: true },
    });

    async function renderArch() {
      try {
        const id = `mcp-gateway-oauth-flow-arch-${++renderIdRef.current}`;
        const { svg } = await mermaid.render(id, archSource);
        if (!cancelled && archRef.current) {
          archRef.current.innerHTML = svg;
        }
      } catch (err) {
        if (!cancelled) {
          setArchRenderError(err?.message || "Mermaid render failed");
        }
      }
    }
    renderArch();
    return () => {
      cancelled = true;
    };
  }, [archSource]);

  return (
    <>
    <div className="pmd-page">
      <div className="pmd-hero">
        <span className="pmd-eyebrow">demo_mcp_gateway &rarr; demo_mcp_server</span>
        <h1>Agent Gateway OAuth Flow — Architecture</h1>
        <p className="pmd-sub">
          Topology behind the sequence diagram below: the gateway sits between the
          agent and the MCP server as an OAuth Resource Server, introspecting and
          exchanging the token with PingOne before ever forwarding a request downstream.
        </p>
      </div>

      <DiagramExportBar
        source={archSource}
        sourceFilename="mcp-gateway-oauth-flow-architecture.mmd"
        onSourceChange={setArchSource}
      />

      <div className="pmd-panel">
        {archRenderError ? (
          <p className="pmd-error">Diagram failed to render: {archRenderError}</p>
        ) : (
          <div className="pmd-diagram" ref={archRef} aria-label="Agent Gateway OAuth flow architecture diagram" />
        )}
      </div>

      <p className="pmd-footer">
        Step numbers match the sequence diagram below — the gateway's own local JWT
        pre-filter (step 10) is a cheap check, not the authoritative gate; steps
        11-12 (RFC 7662 introspection) are the real one.
      </p>
    </div>

    <div className="mgof-page">
      <div className="mgof-hero">
        <span className="mgof-eyebrow">demo_mcp_gateway &rarr; demo_mcp_server</span>
        <h1>Agent Gateway OAuth Flow, As Built</h1>
        <p className="mgof-sub">
          The reference MCP OAuth handshake redrawn against the actual code path: HTTP
          transport, one backend (demo_mcp_server, the mock AI Demo MCP Server), token
          introspection over local JWT checks, and the RFC 8693 exchange the reference
          diagram doesn't show.
        </p>
      </div>

      <div className="mgof-legend-key">
        <span className="mgof-key-entry mgof-key-delta">&Delta; diverges from the reference diagram</span>
        <span className="mgof-key-entry mgof-key-plus">+ step the reference diagram doesn't have</span>
      </div>

      <DiagramExportBar
        source={source}
        sourceFilename="mcp-gateway-oauth-flow.mmd"
        onSourceChange={setSource}
      />

      <div className="mgof-panel">
        {renderError ? (
          <p className="mgof-error">Diagram failed to render: {renderError}</p>
        ) : (
          <div className="mgof-diagram" ref={containerRef} aria-label="Agent Gateway OAuth flow sequence diagram" />
        )}
      </div>

      <div className="mgof-notes">
        {NOTES.map((group) => (
          <div className="mgof-note-group" key={group.title}>
            <h2>{group.title}</h2>
            <ul>
              {group.items.map((item, idx) => (
                <li key={idx} className={item.mark ? `mgof-note--${item.mark}` : undefined}>
                  {item.text}
                  {item.cite ? <span className="mgof-cite"> {item.cite}</span> : null}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <p className="mgof-footer">
        Reflects the HTTP transport only - see &Delta; notes above for where WebSocket diverges.
        Real topology has three backends behind the gateway (banking, invest, jwt-verifier);
        this diagram collapses to the one banking backend.
      </p>
    </div>
    </>
  );
}
