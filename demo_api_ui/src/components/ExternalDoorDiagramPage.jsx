// ExternalDoorDiagramPage.jsx — two Mermaid diagrams for the external-door MCP
// flow (docs/EXTERNAL_DOOR_MCP_FLOW.md): an architecture graph (styled like
// PrivilegeMcpDiagramPage's Architecture tab) and a dual-credential-path
// sequence diagram with notes (styled like InvestDualAuthDiagramPage).
import React, { useEffect, useRef, useState } from "react";
import mermaid from "mermaid";
import DiagramExportBar from "./DiagramExportBar";
import "./PrivilegeMcpDiagramPage.css";
import "./McpGatewayOauthFlowPage.css";

const ARCHITECTURE_SOURCE = `graph TB
    subgraph client["External client — never talked to this system before"]
        EXT["LM Studio / MCP Inspector /<br/>Claude Desktop"]
    end

    subgraph ingress["Ingress — cmuir-mcp.ping-devops.com"]
        ING["mcp-public-door-ingress<br/>2 routing rules, split by path"]
    end

    subgraph k8s["K8s cluster (SE)"]
        GW["ping-gateway :8080<br/>PingGateway / ForgeRock IG<br/><b>enforces /mcp only</b><br/>OAuth AS paths pass through unfiltered"]
        MCP["mcp-server :8080 (oauth-mcp)<br/><b>dual role, same pod/Service:</b><br/>MCP tool server AND<br/>embedded OAuth 2.1 AS<br/>(DCR, /authorize, /token, /jwks, /introspect)"]
    end

    subgraph pingone["PingOne (cloud) — tenant 01d89b06"]
        AS["auth.pingone.com/{envId}/as<br/>real IdP — actual login"]
        P1AZ["PingOne Authorize<br/>decision endpoint<br/>PERMIT / DENY per MCP call"]
    end

    subgraph bff["demo_api_server — Banking API (BFF)"]
        API["Same REST API browser sessions use<br/>reached here over Bearer<br/>aud = enduser.ping.demo"]
    end

    EXT -->|"well-known discovery, DCR,<br/>OAuth (everything except<br/>oauth-protected-resource)"| ING
    ING -->|".well-known/oauth-protected-resource<br/>direct — bypasses gateway"| MCP
    ING -->|"everything else:<br/>/register /authorize /token<br/>/jwks /mcp ..."| GW
    GW -->|"^/mcp only: introspect →<br/>P1AZ decision → tools-filter →<br/>reverse proxy"| MCP
    GW -.->|"OAuth AS endpoints:<br/>passthrough, unfiltered,<br/>NOT P1AZ-gated"| MCP
    GW -->|"P1AZ decision<br/>per MCP request"| P1AZ
    MCP <-->|"federated OAuth: own /authorize<br/>redirects here, own /token<br/>exchanges PingOne's code"| AS
    MCP -->|"Bearer: real federated PingOne token<br/>or self-issued JWT (fallback)"| API

    classDef dual stroke-width:3px
    class MCP dual`;

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
  const archRef = useRef(null);
  const seqRef = useRef(null);
  const [archSource, setArchSource] = useState(ARCHITECTURE_SOURCE);
  const [seqSource, setSeqSource] = useState(SEQUENCE_SOURCE);
  const [archError, setArchError] = useState(null);
  const [seqError, setSeqError] = useState(null);
  const renderIdRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    setArchError(null);
    setSeqError(null);
    mermaid.initialize({
      startOnLoad: false,
      theme: "dark",
      securityLevel: "loose",
      sequence: { useMaxWidth: true, wrap: true },
      flowchart: { useMaxWidth: true },
    });

    async function renderArch() {
      try {
        const id = `external-door-arch-${++renderIdRef.current}`;
        const { svg } = await mermaid.render(id, archSource);
        if (!cancelled && archRef.current) archRef.current.innerHTML = svg;
      } catch (err) {
        if (!cancelled) setArchError(err?.message || "Mermaid render failed");
      }
    }
    async function renderSeq() {
      try {
        const id = `external-door-seq-${++renderIdRef.current}`;
        const { svg } = await mermaid.render(id, seqSource);
        if (!cancelled && seqRef.current) seqRef.current.innerHTML = svg;
      } catch (err) {
        if (!cancelled) setSeqError(err?.message || "Mermaid render failed");
      }
    }
    renderArch();
    renderSeq();
    return () => { cancelled = true; };
  }, [archSource, seqSource]);

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
          </p>
        </div>

        <DiagramExportBar
          source={archSource}
          sourceFilename="external-door-architecture.mmd"
          onSourceChange={setArchSource}
        />

        <div className="pmd-panel">
          {archError ? (
            <p className="pmd-error">Diagram failed to render: {archError}</p>
          ) : (
            <div className="pmd-diagram" ref={archRef} aria-label="External door architecture diagram" />
          )}
        </div>

        <p className="pmd-footer">
          Source:{" "}
          <a href="https://github.com/curtismu7/AI-DEMO2/blob/main/docs/EXTERNAL_DOOR_MCP_FLOW.md" className="pmd-link">
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
            external client obtained its bearer. The top flow completed a real
            PingOne login through oauth-mcp's federated authorization_code grant.
            The bottom flow authenticated with client_credentials — no user ever
            signed in, so there is no PingOne token to hand downstream.
          </p>
        </div>

        <DiagramExportBar
          source={seqSource}
          sourceFilename="external-door-dual-path.mmd"
          onSourceChange={setSeqSource}
        />

        <div className="mgof-panel">
          {seqError ? (
            <p className="mgof-error">Diagram failed to render: {seqError}</p>
          ) : (
            <div className="mgof-diagram" ref={seqRef} aria-label="External door dual credential path sequence diagram" />
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
          <a href="https://github.com/curtismu7/AI-DEMO2/blob/main/docs/EXTERNAL_DOOR_MCP_FLOW.md" className="pmd-link">
            docs/EXTERNAL_DOOR_MCP_FLOW.md
          </a>
          , Phase 7b (<code>TokenResolver.resolve()</code>,{" "}
          <code>oauth-mcp/src/tools/TokenResolver.ts</code>).
        </p>
      </div>
    </>
  );
}
