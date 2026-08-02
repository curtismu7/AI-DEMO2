import React, { useEffect, useRef, useState } from "react";
import mermaid from "mermaid";
import DiagramExportBar from "./DiagramExportBar";
import "./McpGatewayOauthFlowPage.css";

const MERMAID_SOURCE = `sequenceDiagram
    autonumber
    box rgb(240,240,255) Normal Flow (MCP RS)
    participant Agent
    participant GW as MCP Gateway
    participant P1 as PingOne AS
    participant RS as Invest Service<br/>:8081 WebSocket
    end

    Agent->>GW: tools/call get_investment_balance<br/>(Bearer: user token)
    GW->>P1: RFC 8693 Token Exchange<br/>(audience=mcp-resource-server.ping.demo)
    P1-->>GW: Scoped access_token (aud=RS)
    GW->>RS: WebSocket MCP message<br/>(Bearer: exchanged token)
    RS->>RS: Verify JWT signature (JWKS)<br/>Check aud + scope + exp
    RS-->>GW: MCP result (portfolio data)
    GW-->>Agent: tools/call result

    Note over Agent,RS: Same service, different credential path

    box rgb(255,245,235) API-Key Flow (Backend App)
    participant Agent2 as Agent
    participant GW2 as MCP Gateway
    participant Vault as Vault
    participant App as Invest Service<br/>:8081/invest HTTP
    end

    Agent2->>GW2: tools/call show_investment<br/>(Bearer: user token)
    GW2->>GW2: Drop OAuth bearer
    GW2->>Vault: Fetch DEMO_MCP_RESOURCE_SERVER_KEY
    Vault-->>GW2: API key (shared secret)
    GW2->>App: GET /invest<br/>(X-API-Key + X-User-Sub)
    App->>App: Constant-time key compare
    App-->>GW2: JSON {invest: {...},<br/>authMechanism: "X-API-Key"}
    GW2-->>Agent2: tools/call result + _meta`;

const NOTES = [
  {
    title: "Normal Flow — MCP Resource Server",
    items: [
      { text: "The gateway performs RFC 8693 token exchange to scope the token to the invest service audience." },
      { text: "The invest service validates the JWT signature against PingOne's JWKS, checks audience and scope claims, and verifies expiration." },
      { text: "Tools: get_investment_balance, get_investment_accounts, get_portfolio_summary, get_investment_transactions — all require invest:read scope." },
      { text: "Transport: WebSocket (MCP protocol), persistent connection, per-message auth." },
    ],
  },
  {
    title: "API-Key Flow — Backend App",
    items: [
      { text: "The gateway drops the user's OAuth bearer entirely — no token forwarding." },
      { text: "Instead, the gateway fetches the service API key from the vault and attaches it as X-API-Key." },
      { text: "The invest service validates the key using constant-time comparison (SHA-256 digest + timingSafeEqual)." },
      { text: "Tool: show_investment — same invest:read scope gate at the gateway, but the downstream hop is a shared secret, not an OAuth token." },
      { text: "Response includes authMechanism: 'X-API-Key (shared secret)' to make the credential path visible." },
    ],
  },
  {
    title: "Key Difference",
    items: [
      { text: "Same service (demo_mcp_resource_server on :8081), two auth models, two transports." },
      { text: "The RS path proves OAuth token exchange and audience-scoped delegation. The API-key path proves vault-managed shared secrets and credential swapping." },
    ],
  },
];

export default function InvestDualAuthDiagramPage() {
  const containerRef = useRef(null);
  const [source, setSource] = useState(MERMAID_SOURCE);
  const [renderError, setRenderError] = useState(null);
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
        const id = `invest-dual-auth-svg-${++renderIdRef.current}`;
        const { svg } = await mermaid.render(id, source);
        if (!cancelled && containerRef.current) {
          containerRef.current.innerHTML = svg;
        }
      } catch (err) {
        if (!cancelled) setRenderError(err?.message || "Mermaid render failed");
      }
    }
    render();
    return () => { cancelled = true; };
  }, [source]);

  return (
    <div className="mgof-page">
      <div className="mgof-hero">
        <span className="mgof-eyebrow">demo_mcp_resource_server — dual auth</span>
        <h1>Invest Service: Bearer Token vs API Key</h1>
        <p className="mgof-sub">
          Two credential paths to the same backend. The top flow uses OAuth token
          exchange and WebSocket MCP (Resource Server pattern). The bottom flow uses a
          vault-managed API key over HTTP REST (Backend App pattern).
        </p>
      </div>

      <DiagramExportBar
        source={source}
        sourceFilename="invest-dual-auth.mmd"
        onSourceChange={setSource}
      />

      <div className="mgof-panel">
        {renderError ? (
          <p className="mgof-error">Diagram failed to render: {renderError}</p>
        ) : (
          <div className="mgof-diagram" ref={containerRef} aria-label="Invest dual-auth sequence diagram" />
        )}
      </div>

      <div className="mgof-notes">
        {NOTES.map((group) => (
          <div className="mgof-note-group" key={group.title}>
            <h2>{group.title}</h2>
            <ul>
              {group.items.map((item, idx) => (
                <li key={idx}>{item.text}</li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
