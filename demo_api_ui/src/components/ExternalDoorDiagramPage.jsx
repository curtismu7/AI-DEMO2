// ExternalDoorDiagramPage.jsx — two diagrams for the external-door MCP flow
// (docs/EXTERNAL_DOOR_MCP_FLOW.md): the topology and the dual-credential-path sequence, both drawn in the Ping style by
// EmbeddedFlowDiagram (pingStyle), with notes. Data: config/externalDoorDiagrams.js and externalDoorStandards.js.
// The Mermaid source below is kept for "Download .mmd" / "Upload .mmd": an uploaded .mmd is drawn by FlowDiagram
// until "Back to the Ping-style diagram".
import React, { useState } from "react";
import DiagramExportBar from "./DiagramExportBar";
import EmbeddedFlowDiagram from "./EmbeddedFlowDiagram";
import FlowDiagram from "./FlowDiagram";
import { EXT_DOOR_TOPO_DIAGRAM, EXT_DOOR_SEQ_DIAGRAM } from "../config/externalDoorDiagrams";
import "./PrivilegeMcpDiagramPage.css";
import "./McpGatewayOauthFlowPage.css";
import "./ExternalDoorDiagramPage.css";
import PageHeader from './common/PageHeader';

const SEQUENCE_SOURCE = `sequenceDiagram
    autonumber
    box rgb(240,240,255) authorization_code — real user federated
    participant Client
    participant OM as oauth-mcp (mcp-server)
    participant P1 as PingOne AS
    participant API as Banking API
    end

    Client->>OM: GET /authorize (client's own PKCE)
    OM->>P1: 302 redirect (oauth-mcp's own separate<br/>PKCE + relayState)
    Note over P1: real PingOne login —<br/>username/password
    P1-->>OM: GET /authorize/callback<br/>?code&state=relayState
    OM->>P1: POST /token (PingOne code + verifier)
    P1-->>OM: real PingOne tokens<br/>(ID token verified via JWKS)
    OM->>OM: mint self-signed JWT (jti)<br/>stash real PingOne token keyed by jti
    OM-->>Client: self-signed JWT<br/>(Bearer for every MCP call)
    Client->>OM: POST /mcp tools/call<br/>(Bearer self-signed JWT)
    OM->>OM: TokenResolver: jti found →<br/>use stashed real PingOne token
    OM->>API: Authorization: Bearer <real PingOne token><br/>aud=enduser.ping.demo
    API-->>OM: account data (audience-gated)
    OM-->>Client: tools/call result

    Note over Client,API: source: agent-federated-passthrough

    box rgb(255,245,235) client_credentials — no user federated
    participant Client2 as Client
    participant OM2 as oauth-mcp (mcp-server)
    participant API2 as Banking API
    end

    Client2->>OM2: POST /token<br/>(grant_type=client_credentials)
    OM2->>OM2: mint self-signed JWT<br/>nothing to stash — no PingOne login happened
    OM2-->>Client2: self-signed JWT
    Client2->>OM2: POST /mcp tools/call<br/>(Bearer self-signed JWT)
    OM2->>OM2: TokenResolver: jti not found →<br/>forward raw self-issued JWT
    OM2->>API2: Authorization: Bearer <self-issued JWT><br/>iss=cmuir-mcp.ping-devops.com
    API2-->>OM2: response (whatever the raw<br/>self-issued JWT is entitled to)
    OM2-->>Client2: tools/call result

    Note over Client2,API2: source: agent-passthrough`;

const NOTES = [
  {
    title: "authorization_code — real user federated",
    items: [
      { text: "The client's PKCE and oauth-mcp's own PKCE against PingOne are two entirely separate pairs — the client never sees the PingOne hop." },
      { text: "PingOne's ID token (the access token only if no ID token comes back) is verified against PingOne's JWKS, and the real access token is stashed server-side, keyed by the minted JWT's jti — never handed to the client." },
      { text: "TokenResolver finds the stash and forwards the real PingOne token to the Banking API — this is source: 'agent-federated-passthrough'." },
      { text: "P1AZ's UserId parameter is the real PingOne sub — the demo can attribute every tool call to an actual person." },
    ],
  },
  {
    title: "client_credentials — no user federated",
    items: [
      { text: "No browser redirect, no PingOne login — the client authenticates with its own client_id/client_secret from DCR directly at /token." },
      { text: "Nothing was ever stashed against this JWT's jti, so TokenResolver falls back to forwarding the raw self-issued JWT — source: 'agent-passthrough'." },
      { text: "That JWT's iss is oauth-mcp itself (cmuir-mcp.ping-devops.com), not PingOne — a different credential shape than the federated path presents downstream." },
      { text: "P1AZ's UserId parameter is the client_id, not a real user — there is no person to attribute the call to." },
    ],
  },
  {
    title: "Key difference",
    items: [
      { text: "Same server, same /mcp tools/call method, same TokenResolver.resolve() — the branch is decided entirely by whether a real PingOne token was ever federated and stashed for this JWT's jti, not by anything the client requests." },
      { text: "isSelfIssuedToken() short-circuits Step 9 (RFC 8693 exchange) for every external-door token by construction — PingOne's real exchange endpoint can't parse a foreign-issuer JWT as a subject_token." },
    ],
  },
];

export default function ExternalDoorDiagramPage() {
  // Uploaded Mermaid for the sequence figure; null = the Ping-style diagram.
  const [uploadedSeq, setUploadedSeq] = useState(null);

  return (
    <>
      <div className="pmd-page pmd-page--ping">
        <PageHeader className="pmd-hero" eyebrow="External Door" title="External Door MCP Flow — Architecture" summary={<>Network topology for the public MCP door: how a self-registering external
            client (LM Studio, MCP Inspector, Claude Desktop) reaches oauth-mcp — a
            single process wearing two hats, MCP tool server and its own embedded
            OAuth 2.1 Authorization Server — through ping-gateway's per-request P1AZ
            enforcement, out to the real PingOne login, and on to the Banking API.
            Click any box for its role, the request on the wire, the mock tokens and the standards.</>} />

        <div className="pmd-panel">
          <EmbeddedFlowDiagram
            config={EXT_DOOR_TOPO_DIAGRAM}
            title="Topology: who answers which path"
            lede="Follow the numbered arrows. The ingress splits the paths: the resource metadata goes straight to oauth-mcp, everything else passes ping-gateway, which enforces /mcp only. Click a box or a card for the request on the wire, the mock tokens and the standards behind each step."
            ariaLabel="External door topology"
            diagramLabel="External door topology diagram"
            testId="ext-door-flow-diagram"
            pingStyle
          />
        </div>

        <p className="pmd-footer">
          Source:{" "}
          <a href="https://github.com/cmuir_pingcorp/AI-DEMO2/blob/main/docs/EXTERNAL_DOOR_MCP_FLOW.md" className="pmd-link">
            docs/EXTERNAL_DOOR_MCP_FLOW.md
          </a>
          , Phase 0. The dashed line marks the OAuth AS endpoints as reaching mcp-server
          through ping-gateway unfiltered and un-audited — by design, since a client
          can't hold a token yet at DCR/authorize time.
        </p>
      </div>

      <div className="mgof-page mgof-page--ping">
        <PageHeader className="mgof-hero" eyebrow="oauth-mcp — TokenResolver" title="External Door: Federated Token vs Self-Issued JWT" summary={<>Two credential paths to the same Banking API call, decided by how the
            external client obtained its bearer. The top flow completed a real
            PingOne login through oauth-mcp's federated authorization_code grant.
            The bottom flow authenticated with client_credentials — no user ever
            signed in, so there is no PingOne token to hand downstream.</>} />

        <DiagramExportBar
          source={uploadedSeq ?? SEQUENCE_SOURCE}
          sourceFilename="external-door-dual-path.mmd"
          onSourceChange={setUploadedSeq}
        />

        <div className="mgof-panel">
          {uploadedSeq != null ? (
            <>
              <button type="button" className="pmd-tab" onClick={() => setUploadedSeq(null)}>
                Back to the Ping-style diagram
              </button>
              <FlowDiagram source={uploadedSeq} label="External door dual credential path sequence diagram" />
            </>
          ) : (
            <EmbeddedFlowDiagram
              config={EXT_DOOR_SEQ_DIAGRAM}
              title="Two credential paths, one tools/call"
              lede="The authorization_code path (arrows 1 to 8) and the client_credentials path (arrows 9 to 13) end in the same Banking API call. A request and its plain reply share one arrow; the orange number is the step. Click a card for the exact request, the mock tokens and the standards."
              ariaLabel="External door dual credential path sequence diagram"
              diagramLabel="External door dual credential path diagram"
              testId="ext-door-seq"
              pingStyle
            />
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

        <p className="mgof-footer">
          Source:{" "}
          <a href="https://github.com/cmuir_pingcorp/AI-DEMO2/blob/main/docs/EXTERNAL_DOOR_MCP_FLOW.md" className="pmd-link">
            docs/EXTERNAL_DOOR_MCP_FLOW.md
          </a>
          , Phase 7b (<code>TokenResolver.resolve()</code>,{" "}
          <code>oauth-mcp/src/tools/TokenResolver.ts</code>).
        </p>
      </div>
    </>
  );
}
