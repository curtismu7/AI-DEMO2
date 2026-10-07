import React, { useState } from "react";
import DiagramExportBar from "./DiagramExportBar";
import SequenceFlowDiagram from "./SequenceFlowDiagram";
import "./McpGatewayOauthFlowPage.css";

const MERMAID_SOURCE = `sequenceDiagram
    autonumber
    box rgb(240,240,255) Normal Flow (MCP RS)
    participant Agent
    participant GW as Agent Gateway
    participant P1 as PingOne AS
    participant RS as Invest Service<br/>:8081 WebSocket
    end

    Agent->>GW: tools/call get_investment_balance<br/>(Bearer: user token)
    GW->>P1: RFC 8693 Token Exchange<br/>(audience=mcp-invest.ping.demo)
    P1-->>GW: Scoped access_token (aud=RS)
    GW->>RS: WebSocket MCP message<br/>(Bearer: exchanged token)
    RS->>RS: Verify JWT signature (JWKS)<br/>Check aud + scope + exp
    RS-->>GW: MCP result (portfolio data)
    GW-->>Agent: tools/call result

    Note over Agent,RS: Same service, different credential path

    box rgb(255,245,235) API-Key Flow (Backend App)
    participant Agent2 as Agent
    participant GW2 as Agent Gateway
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

// Short detail for each participant, shown in the movie reel's details row.
const PARTICIPANT_DETAILS = {
  Agent: "The AI agent acting for the signed-in user. It holds the user's token and asks the gateway to call a tool.",
  GW: "The Agent Gateway. Authorizes the call, then either exchanges the token for the invest audience (left flow) or swaps in a vault-held API key (right flow).",
  P1: "PingOne's authorization server. Performs the RFC 8693 token exchange and returns a token scoped to the invest service.",
  RS: "The invest service over WebSocket MCP. Verifies the token's signature, audience, scope and expiry before it answers.",
  Agent2: "The same agent, this time calling a tool that reaches the invest service through the backend-app path.",
  GW2: "The same gateway. For this tool it drops the user's OAuth bearer instead of forwarding it.",
  Vault: "Holds the invest service's API key. The gateway fetches it per call, so the key never reaches the agent.",
  App: "The invest service over plain HTTP. It checks the shared key with a constant-time comparison and reports which mechanism it used.",
};

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
  const [source, setSource] = useState(MERMAID_SOURCE);
  return (
    <div className="mgof-page">
      <div className="mgof-hero">
        <span className="mgof-eyebrow">demo_mcp_resource_server — dual auth</span>
        <h1>Invest Service: Bearer Token vs API Key</h1>
        <p className="mgof-sub">
          Two credential paths to the same backend. The left flow uses OAuth token
          exchange and WebSocket MCP (Resource Server pattern). The right flow uses a
          vault-managed API key over HTTP REST (Backend App pattern).
        </p>
      </div>

      <DiagramExportBar
        source={source}
        sourceFilename="invest-dual-auth.mmd"
        onSourceChange={setSource}
      />

      <div className="mgof-panel">
        <SequenceFlowDiagram source={source} label="Invest dual-auth sequence diagram" details={PARTICIPANT_DETAILS} />
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
