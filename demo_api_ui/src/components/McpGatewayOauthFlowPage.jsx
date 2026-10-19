// McpGatewayOauthFlowPage.jsx — the reference MCP OAuth handshake sequence
// (401 challenge -> protected-resource metadata -> initialize -> list_tools)
// redrawn against demo_mcp_gateway + demo_mcp_server's actual code path.
// Both figures (architecture, OAuth sequence) are drawn in the Ping style by EmbeddedFlowDiagram (pingStyle): numbered
// arrows, a step reel with the request on the wire, MOCK tokens and the standards behind each step. Their data is
// src/config/mcpGatewayOauthDiagrams.js and mcpGatewayOauthStandards.js. The Mermaid sources below are kept so
// "Download .mmd" still produces the same interop file; an uploaded .mmd is drawn by FlowDiagram (the plain renderer,
// as before the Ping style) until "Back to the Ping-style diagram".
import React, { useState } from "react";
import DiagramExportBar from "./DiagramExportBar";
import EmbeddedFlowDiagram from "./EmbeddedFlowDiagram";
import FlowDiagram from "./FlowDiagram";
import { MGOF_ARCH_DIAGRAM, MGOF_SEQ_DIAGRAM } from "../config/mcpGatewayOauthDiagrams";
import "./McpGatewayOauthFlowPage.css";
import "./PrivilegeMcpDiagramPage.css";
import PageHeader from './common/PageHeader';

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

export const MERMAID_SOURCE = `sequenceDiagram
    participant U as User
    participant A as Agent (OAuth Client)
    participant G as Agent Gateway (OAuth RS)
    participant M as MCP Server (Banking, Mock)
    participant P as PingOne (Authorization Server)

    Note over A,G: Variant: with ff_mcp_gateway_privilege_first ON, the PingOne<br/>Agent Privilege sits AHEAD of the Agent Gateway and terminates<br/>this client OAuth itself. The Agent Gateway then receives Privilege's<br/>static bridge credential, with the user token in tx-token.<br/>See the Privilege-First Gateway page for that topology.

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
        text: "Steps 5-7: the metadata names the gateway's own OAuth broker as the authorization server (RFC 8414, RFC 7591 registration, PKCE), which relays PingOne's access token. The figures draw PingOne as the authorization server and leave that relay out.",
        cite: "GatewayServer.ts:546-577, OAuthBrokerRouter.ts:117-153",
      },
      {
        mark: "delta",
        text: "Steps 6-7 run through the gateway's own OAuth broker: RFC 8414 metadata, open dynamic registration for loopback redirect URIs, PKCE S256. It relays the sign-in to PingOne and returns PingOne's own access token, which the figure draws as one hop to PingOne. The broker has no Client ID Metadata Document support.",
        cite: "OAuthBrokerRouter.ts",
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

// One figure: its Ping-style diagram, or the plain rendering of an uploaded .mmd.
function Figure({ source, uploaded, setUploaded, filename, config, title, lede, ariaLabel, diagramLabel, testId, height }) {
  return (
    <>
      <DiagramExportBar source={uploaded ?? source} sourceFilename={filename} onSourceChange={setUploaded} />
      <div className="pmd-panel">
        {uploaded != null ? (
          <>
            <button type="button" className="pmd-tab" onClick={() => setUploaded(null)}>
              Back to the Ping-style diagram
            </button>
            <FlowDiagram source={uploaded} label={diagramLabel} height={height} />
          </>
        ) : (
          <EmbeddedFlowDiagram config={config} title={title} lede={lede} ariaLabel={ariaLabel} diagramLabel={diagramLabel} testId={testId} pingStyle />
        )}
      </div>
    </>
  );
}

export default function McpGatewayOauthFlowPage() {
  const [uploadedSeq, setUploadedSeq] = useState(null);
  const [uploadedArch, setUploadedArch] = useState(null);
  return (
    <>
    <div className="pmd-page pmd-page--ping">
      <PageHeader className="pmd-hero" eyebrow={<>demo_mcp_gateway &rarr; demo_mcp_server</>} title="Agent Gateway OAuth Flow — Architecture" summary={<>Topology behind the sequence diagram below: the gateway sits between the
          agent and the MCP server as an OAuth Resource Server, introspecting and
          exchanging the token with PingOne before ever forwarding a request downstream.</>} />

      <Figure
        source={ARCHITECTURE_SOURCE}
        uploaded={uploadedArch}
        setUploaded={setUploadedArch}
        filename="mcp-gateway-oauth-flow-architecture.mmd"
        config={MGOF_ARCH_DIAGRAM}
        title="Who talks to whom"
        lede="Follow the numbered arrows. The agent finds the gateway's OAuth broker from a 401, signs in at PingOne, and the gateway introspects and exchanges the token before the MCP server sees a request. Click a box or a card for the request on the wire, the mock tokens and the standards."
        ariaLabel="Agent Gateway OAuth flow architecture"
        diagramLabel="Agent Gateway OAuth flow architecture diagram"
        testId="mgof-arch"
        height={560}
      />

      <p className="pmd-footer">
        The architecture arrows are numbered in their own order; each card names the sequence
        steps it covers. In the sequence below, the gateway's own local JWT pre-filter (step 10) is
        a cheap check, not the authoritative gate; steps 11-12 (RFC 7662 introspection) are the real one.
      </p>
    </div>

    <div className="mgof-page mgof-page--ping">
      <PageHeader className="mgof-hero" eyebrow={<>demo_mcp_gateway &rarr; demo_mcp_server</>} title="Agent Gateway OAuth Flow, As Built" summary={<>The reference MCP OAuth handshake redrawn against the actual code path: HTTP
          transport, one backend (demo_mcp_server, the mock AI Demo MCP Server), token
          introspection over local JWT checks, and the RFC 8693 exchange the reference
          diagram doesn't show.</>} />

      <div className="mgof-legend-key">
        <span className="mgof-key-entry mgof-key-delta">&Delta; diverges from the reference diagram</span>
        <span className="mgof-key-entry mgof-key-plus">+ step the reference diagram doesn't have</span>
      </div>

      <Figure
        source={MERMAID_SOURCE}
        uploaded={uploadedSeq}
        setUploaded={setUploadedSeq}
        filename="mcp-gateway-oauth-flow.mmd"
        config={MGOF_SEQ_DIAGRAM}
        title="The OAuth handshake, step by step"
        lede="Agent, gateway, MCP server and PingOne in order; arrow n is step n. Steps that happen inside one component (store the token, the local pre-filter, the signature check, the cached re-check) are the grey boxes below their owner. Click a card for the exact request, the mock tokens in play and the standards behind it."
        ariaLabel="Agent Gateway OAuth flow sequence"
        diagramLabel="Agent Gateway OAuth flow sequence diagram"
        testId="mgof-seq"
      />

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
