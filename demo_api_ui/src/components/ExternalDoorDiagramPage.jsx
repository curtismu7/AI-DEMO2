// ExternalDoorDiagramPage.jsx — two diagrams for the external-door MCP flow
// (docs/EXTERNAL_DOOR_MCP_FLOW.md): an architecture graph on React Flow
// (StaticFlowDiagram) and a dual-credential-path sequence diagram (Mermaid,
// a true sequence shape) with notes.
import React, { useState } from "react";
import DiagramExportBar from "./DiagramExportBar";
import StaticFlowDiagram from "./StaticFlowDiagram";
import FlowDiagram from "./FlowDiagram";
import "./PrivilegeMcpDiagramPage.css";
import "./McpGatewayOauthFlowPage.css";

export const EXT_DOOR_GROUPS = {
  client: { label: "External client — never talked to this system before", bg: "#1e40af" },
  ingress: { label: "Ingress — cmuir-mcp.ping-devops.com", bg: "#b45309" },
  k8s: { label: "K8s cluster (SE)", bg: "#047857" },
  pingone: { label: "PingOne (cloud) — tenant 01d89b06", bg: "#9d174d" },
  bff: { label: "demo_api_server — Banking API (BFF)", bg: "#475569" },
};

export const EXT_DOOR_NODES = [
  { id: "ext", group: "client", label: "LM Studio / MCP Inspector / Claude Desktop", x: 0, y: 40 },
  { id: "ing", group: "ingress", label: "mcp-public-door-ingress", sub: ["2 routing rules, split by path"], x: 300, y: 40 },
  {
    id: "gw", group: "k8s", label: "ping-gateway :8080",
    sub: ["PingOne Agent Gateway / ForgeRock IG", "enforces /mcp only", "OAuth AS paths pass through unfiltered"],
    x: 600, y: 40,
  },
  {
    id: "mcp", group: "k8s", label: "mcp-server :8080 (oauth-mcp) — dual role",
    sub: ["MCP tool server AND", "embedded OAuth 2.1 AS", "(DCR, /authorize, /token, /jwks, /introspect)"],
    x: 900, y: 40,
  },
  { id: "as", group: "pingone", label: "auth.pingone.com/{envId}/as", sub: ["real IdP — actual login"], x: 600, y: 300 },
  { id: "p1az", group: "pingone", label: "PingOne Authorize", sub: ["decision endpoint", "PERMIT / DENY per MCP call"], x: 900, y: 300 },
  { id: "api", group: "bff", label: "Same REST API browser sessions use", sub: ["reached here over Bearer", "aud = enduser.ping.demo"], x: 1200, y: 40 },
];

export const EXT_DOOR_EDGES = [
  ["ext", "ing", "well-known discovery, DCR, OAuth (everything except oauth-protected-resource)"],
  ["ing", "mcp", ".well-known/oauth-protected-resource — direct, bypasses gateway", { dashed: true }],
  ["ing", "gw", "everything else: /register /authorize /token /jwks /mcp …"],
  ["gw", "mcp", "^/mcp only: introspect → P1AZ decision → tools-filter → reverse proxy"],
  ["gw", "mcp", "OAuth AS endpoints: passthrough, unfiltered, NOT P1AZ-gated", { dashed: true }],
  ["gw", "p1az", "P1AZ decision per MCP request", { dashed: true }],
  ["mcp", "as", "federated OAuth: own /authorize redirects here, own /token exchanges PingOne's code", { dashed: true }],
  ["mcp", "api", "Bearer: real federated PingOne token or self-issued JWT (fallback)"],
];

const EXT_DOOR_DETAILS = {
  ext: "A self-registering external client — DCR creates its client credentials on first contact.",
  ing: "The public door. Two routing rules: the well-known resource metadata goes straight to mcp-server; everything else goes through ping-gateway.",
  gw: "PingOne Agent Gateway / ForgeRock IG. Enforces ^/mcp only — introspection, P1AZ decision, tool filtering — and passes OAuth AS endpoints through unfiltered (a client can't hold a token yet at DCR/authorize time).",
  mcp: "One process, two hats: MCP tool server AND its own embedded OAuth 2.1 Authorization Server with federated PingOne login.",
  as: "The real IdP. oauth-mcp's federated OAuth completes actual logins here.",
  p1az: "PERMIT/DENY per MCP call, attributed to the real PingOne sub (or client_id when no user federated).",
  api: "The Banking API the browser uses — reached externally over Bearer with aud = enduser.ping.demo.",
};

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
    P1-->>OM: real PingOne access_token<br/>(verified via JWKS)
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
      { text: "PingOne's real access token is verified against PingOne's JWKS and stashed server-side, keyed by the minted JWT's jti — never handed to the client." },
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
  const [selectedNode, setSelectedNode] = useState(null);
  const [seqSource, setSeqSource] = useState(SEQUENCE_SOURCE);

  const nodeDetail = selectedNode
    ? EXT_DOOR_DETAILS[selectedNode.id] ||
      `${selectedNode.data.label} — participant in the external-door flow.`
    : null;

  return (
    <>
      <div className="pmd-page">
        <div className="pmd-hero">
          <span className="pmd-eyebrow">External Door</span>
          <h1>External Door MCP Flow — Architecture</h1>
          <p className="pmd-sub">
            Network topology for the public MCP door: how a self-registering external
            client (LM Studio, MCP Inspector, Claude Desktop) reaches oauth-mcp — a
            single process wearing two hats, MCP tool server and its own embedded
            OAuth 2.1 Authorization Server — through ping-gateway's per-request P1AZ
            enforcement, out to the real PingOne login, and on to the Banking API.
            Click any node for its role.
          </p>
        </div>

        <div className="pmd-panel">
          <StaticFlowDiagram
            NODES={EXT_DOOR_NODES}
            EDGES={EXT_DOOR_EDGES}
            GROUPS={EXT_DOOR_GROUPS}
            onNodeClick={(node) => setSelectedNode(selectedNode?.id === node.id ? null : node)}
            testId="ext-door-flow-diagram"
            height={560}
          />
        </div>

        {nodeDetail && (
          <div className="pmd-node-detail" role="status">
            <strong>{selectedNode.data.label}</strong>
            <p>{nodeDetail}</p>
          </div>
        )}

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

      <div className="mgof-page">
        <div className="mgof-hero">
          <span className="mgof-eyebrow">oauth-mcp — TokenResolver</span>
          <h1>External Door: Federated Token vs Self-Issued JWT</h1>
          <p className="mgof-sub">
            Two credential paths to the same Banking API call, decided by how the
            external client obtained its bearer. The left flow completed a real
            PingOne login through oauth-mcp's federated authorization_code grant.
            The right flow authenticated with client_credentials — no user ever
            signed in, so there is no PingOne token to hand downstream.
          </p>
        </div>

        <DiagramExportBar
          source={seqSource}
          sourceFilename="external-door-dual-path.mmd"
          onSourceChange={setSeqSource}
        />

        <div className="mgof-panel">
          <FlowDiagram source={seqSource} label="External door dual credential path sequence diagram" />
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
