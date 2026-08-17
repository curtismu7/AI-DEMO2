// ResourceServerPlacementPage.jsx — where the Kong-mock resource server sits
// in the agent flow, and which token it validates (only the step-9 token,
// delegated to PingOne Authorize over the AAM sideband). Follows the
// mermaid.initialize/render pattern used by McpGatewayOauthFlowPage.jsx.
import React, { useEffect, useRef, useState } from "react";
import mermaid from "mermaid";
import DiagramExportBar from "./DiagramExportBar";
import "./ResourceServerPlacementPage.css";

const MERMAID_SOURCE = `flowchart TD
    U["USER + AI AGENT<br/>UI :4000 · local.ping-devops.com · chat / chips"]
    B["BFF — demo_api_server :3001<br/>session ✓ · P1AZ pre-flight gate<br/>RFC 8693 exchange #1/#2 ⇒ MCP token"]
    G["GATEWAY — IG :3036 or Node MCP-GW :3005<br/>✓ token validation (JWKS / introspection) — their job<br/>P1AZ decision · schema checks · exchange #3"]
    M["MCP SERVER — oauth-mcp :8080<br/>✓ JWKS + last-hop authz (D-05) — their job<br/>tool scope narrowing · STEP-9 exchange"]
    RS["RESOURCE SERVER — the Kong mock<br/>/api/accounts · /api/transactions<br/>validates ONLY the step-9 token addressed to it<br/>never re-validates upstream tokens"]
    P["PingOne Authorize — AAM<br/>mock authz :9001 / real PingOne sideband"]
    D[("Banking data<br/>data/store.js")]

    U -->|session cookie| B
    B -->|MCP token · aud = mcp resource| G
    G -->|gateway token · aud = mcpserver.ping.demo| M
    M ==>|"STEP-9 token · aud = banking RS · scopes narrowed · act chain + X-Agent-Sub / X-MCP-Tool"| RS
    RS -.->|"1. /sideband/request — ctx + raw Authorization"| P
    P -.->|"decision — deny = complete direct response"| RS
    RS -.->|"2. /sideband/response — real body"| P
    P -.->|"redacted / modified body"| RS
    RS -->|only after PERMIT| D

    classDef upstream fill:#161a21,stroke:#2a313c,color:#e9ecf3
    classDef hot fill:#2d1416,stroke:#e0575c,color:#ffe2e3,stroke-width:2.5px
    classDef pdp fill:#161a21,stroke:#e0575c,stroke-dasharray:5 3,color:#e9ecf3
    class U,B,G,M,D upstream
    class RS hot
    class P pdp`;

const HOP_ROWS = [
  {
    hop: "BFF :3001",
    tokenIn: "session cookie",
    work: "session check · P1AZ pre-flight tool gate",
    handsOff: "MCP token (exchange #1/#2)",
  },
  {
    hop: "Gateway :3036 / :3005",
    tokenIn: "MCP token",
    work: "JWKS / introspection · P1AZ decision · schema checks",
    handsOff: "gateway token (exchange #3)",
  },
  {
    hop: "MCP server :8080",
    tokenIn: "gateway token",
    work: "JWKS · last-hop authz · per-tool scope narrowing",
    handsOff: "step-9 banking RS token",
  },
  {
    hop: "Resource server (Kong mock)",
    tokenIn: "step-9 token",
    work: "ONLY this token — forwarded in sideband; P1AZ validates + decides + redacts",
    handsOff: "data, or P1AZ's deny response",
    hot: true,
  },
  {
    hop: "Data store",
    tokenIn: "—",
    work: "none — reached only on PERMIT",
    handsOff: "—",
  },
];

const RULES = [
  {
    title: "No duplicate validation.",
    text: "IG / Node gateway and the MCP server already validate their own tokens. The resource server trusts the chain and inspects nothing upstream.",
  },
  {
    title: "One token, delegated check.",
    text: "The step-9 token (aud = banking RS) is the only credential the resource server cares about — and in the Kong pattern it does not even need local JWKS: it ships the raw Authorization header in the sideband request and PingOne Authorize does active/audience validation itself.",
  },
  {
    title: "Deny is policy-authored.",
    text: "On DENY, PingOne Authorize returns a complete direct response; the resource server relays it verbatim up the chain, and the agent surfaces it as a tool error card.",
  },
  {
    title: "Two touch points.",
    text: "Sideband fires inbound (before any handler runs) and outbound (response redaction before data leaves) — the same two phases Kong's ping-auth plugin hooks.",
  },
];

export default function ResourceServerPlacementPage() {
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
      flowchart: { htmlLabels: true, useMaxWidth: true, curve: "linear" },
    });
    (async () => {
      try {
        const id = `resource-server-placement-svg-${++renderIdRef.current}`;
        const { svg } = await mermaid.render(id, source);
        if (!cancelled && containerRef.current) containerRef.current.innerHTML = svg;
      } catch (err) {
        if (!cancelled) setRenderError(err?.message || "Mermaid render failed");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [source]);

  return (
    <div className="rsp-page">
      <div className="rsp-hero">
        <span className="rsp-eyebrow">Last hop · Kong pattern · PingOne Authorize AAM</span>
        <h1>Resource Server Placement</h1>
        <p className="rsp-sub">
          Where the Kong-mock checkpoint sits in the agent flow. Every upstream hop keeps its
          own token work — the resource server validates exactly one thing: the step-9 token
          addressed to it, and it does that the Kong way, by handing it to PingOne Authorize
          over the AAM sideband. The store is only reachable on PERMIT.
        </p>
      </div>

      <DiagramExportBar
        source={source}
        sourceFilename="resource-server-placement.mmd"
        onSourceChange={setSource}
      />

      <div className="rsp-panel">
        {renderError ? (
          <p className="rsp-error">Diagram failed to render: {renderError}</p>
        ) : (
          <div
            className="rsp-diagram"
            ref={containerRef}
            aria-label="Resource server placement flow diagram"
          />
        )}
      </div>

      <h2>Token work per hop</h2>
      <div className="rsp-tablewrap">
        <table>
          <thead>
            <tr>
              <th>Hop</th>
              <th>Token arriving</th>
              <th>Token work done there</th>
              <th>Hands off</th>
            </tr>
          </thead>
          <tbody>
            {HOP_ROWS.map((r) => (
              <tr key={r.hop} className={r.hot ? "rsp-row--hot" : undefined}>
                <td>{r.hop}</td>
                <td>{r.tokenIn}</td>
                <td>{r.work}</td>
                <td>{r.handsOff}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>Placement rules this locks in</h2>
      <ul className="rsp-rules">
        {RULES.map((r) => (
          <li key={r.title}>
            <strong>{r.title}</strong> {r.text}
          </li>
        ))}
      </ul>

      <p className="rsp-footer">
        The dashed hop pair is the AAM sideband contract already mocked at authz-server :9001
        (request leg = decision, response leg only runs on ALLOW). Companion teaching page:
        Authorize → Resource Server Checkpoint.
      </p>
    </div>
  );
}
