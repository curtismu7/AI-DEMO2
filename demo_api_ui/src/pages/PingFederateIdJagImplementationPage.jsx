import React, { useEffect, useMemo, useState } from "react";
import { ReactFlow, ReactFlowProvider, useReactFlow, useNodesState, NodeResizer, BaseEdge, EdgeLabelRenderer, getSmoothStepPath, Background, Controls, Handle, Position, ConnectionMode, MarkerType } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import "./PingFederateIdJagImplementationPage.css";

// ── Nodes ─────────────────────────────────────────────────────────────────
// kind drives the accent colour. x/y are a 5-column grid (360 apart), 3 rows.
const NODES = [
  { id: "browser", kind: "user", x: 0, y: 260, title: "Browser", sub: "SPA · session cookie only",
    lines: ["Never holds a PF / ID-JAG / MCP token", "Starts the live run (explicit action)"] },
  { id: "bff", kind: "bff", x: 560, y: 260, title: "BFF · demo_api_server", sub: "token custodian",
    lines: ["agentMcpTokenService → resolvePingFederateIdJagToken", "oauthService.performIdJagExchange / redeemIdJag", "Holds PF refresh token server-side"] },
  { id: "pf", kind: "pf", x: 1120, y: 0, title: "PingFederate 13.1", sub: "IdP · issues the ID-JAG",
    lines: ["OIDC login (demouser)", "Token Exchange processor policy + SP connection", "Signs ID-JAG: typ oauth-id-jag+jwt, RS256", "Publishes JWKS (x5t-keyed)"] },
  { id: "mcpas", kind: "as", x: 1120, y: 520, title: "oauth-mcp · MCP Authorization Server", sub: "redeems the ID-JAG",
    lines: ["IdJagGrantHandler.verifyIdJag()", "jwt-bearer grant only if native ID-JAG enabled", "Mints its OWN access token (own key + issuer)"] },
  { id: "gw", kind: "gw", x: 1680, y: 260, title: "MCP Gateway", sub: "demo_mcp_gateway",
    lines: ["tokenValidator: JWKS chosen by iss", "GatewayTokenPolicy: sub, act, D-05 anti-bypass", "Step 3.7 forward  ·  Step 4 RFC 8693 exchange"] },
  { id: "rs", kind: "rs", x: 2240, y: 260, title: "MCP Resource Server", sub: "demo_mcp_resource_server (invest)",
    lines: ["Verifies signature (PF JWKS or PingOne JWKS)", "aud ∈ MCP_RESOURCE_SERVER_RESOURCE_URI", "Tool scopes enforced by caller"] },
];

const NOTES = [
  { id: "n-bff", x: 0, y: 520, text: "BFF-only custody: refresh token, ID-JAG and every access token stay server-side. Fail-closed: no mock or PingOne fallback in PF mode." },
  { id: "n-jti", x: 1120, y: 760, text: "jti replay cache is in-memory, per oauth-mcp process (not shared across replicas/restarts)." },
  { id: "n-gap", x: 2240, y: 520, text: "KNOWN GAP: jwtVerify() has no expected-issuer option — iss only selects the JWKS. No iat policy either. Treat as unhardened." },
];

// Handles: every side has 3 slots (1,2,3) so edges can leave/enter without overlapping.
const SIDES = [["T", Position.Top], ["B", Position.Bottom], ["L", Position.Left], ["R", Position.Right]];
function Card({ data, selected }) {
  return (
    <div className={`card k-${data.kind} ${data.dim ? "dim" : ""} ${data.on ? "on" : ""}`}>
      <NodeResizer isVisible={selected} minWidth={220} minHeight={90} />
      {SIDES.flatMap(([s, pos]) => [1, 2, 3].map((i) => (
        <Handle key={s + i} id={s + i} type="source" position={pos}
          style={{ [pos === Position.Top || pos === Position.Bottom ? "left" : "top"]: `${i * 25}%`, opacity: 0 }} />
      )))}
      <div className="ct">{data.title}</div>
      <div className="cs">{data.sub}</div>
      <ul>{data.lines.map((l) => <li key={l}>{l}</li>)}</ul>
    </div>
  );
}
function Note({ data, selected }) {
  return (
    <div className={`note ${data.dim ? "dim" : ""}`}>
      <NodeResizer isVisible={selected} minWidth={160} minHeight={50} />
      {data.text}
    </div>
  );
}
// Edge with a token dot travelling along the path while the simulation runs it.
function FlowEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, label, markerEnd, style, data }) {
  const [path, lx, ly] = getSmoothStepPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition });
  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={markerEnd} style={style} />
      {data.pulse && (
        <circle r="7" className="pkt" key={data.pulse}>
          <animateMotion dur={`${data.dur}s`} repeatCount="1" fill="freeze" path={path} />
        </circle>
      )}
      <EdgeLabelRenderer>
        <div className="elabel" style={{ transform: `translate(-50%,-50%) translate(${lx}px,${ly}px)`, opacity: data.on ? 1 : 0.15 }}>{label}</div>
      </EdgeLabelRenderer>
    </>
  );
}
const nodeTypes = { card: Card, note: Note };
const edgeTypes = { flow: FlowEdge };

// ── Edges: [id, from, fromHandle, to, toHandle, label, dashed] ────────────
const EDGES = [
  ["e1a", "browser", "T2", "pf", "L1", "① authorize (prompt=login) → code"],
  ["e1b", "pf", "L3", "bff", "T3", "① callback: code → id/access/refresh tokens (BFF-held)"],
  ["e2", "browser", "R2", "bff", "L2", "② POST /api/agent/run · useCaseId=UC40"],
  ["e3", "bff", "T1", "pf", "B1", "③ RFC 8693 · refresh_token → ID-JAG"],
  ["e4", "bff", "B2", "mcpas", "L2", "④ RFC 7523 jwt-bearer · assertion=ID-JAG"],
  ["e5", "mcpas", "T2", "pf", "B3", "④ JWKS fetch (x5t match)", true],
  ["e6", "bff", "R2", "gw", "L2", "⑤ tools/call · Bearer <oauth-mcp token>"],
  ["e7", "gw", "B2", "mcpas", "R2", "⑤ verify sig vs oauth-mcp JWKS", true],
  ["e8", "gw", "R2", "rs", "L2", "⑥a aud == backend → forward unchanged"],
  ["e9", "gw", "T2", "pf", "R1", "⑥b aud ≠ backend → RFC 8693 exchange (PF-issued token)", true],
  ["e10", "rs", "T2", "pf", "R3", "⑦ JWKS when iss == PF_ISSUER", true],
];

// ── Walkthrough ───────────────────────────────────────────────────────────
const STEPS = [
  { t: "Overview", nodes: [], edges: [],
    text: "UC40 / Enterprise-Managed MCP Authorization on the PingFederate lane. PF is the IdP that issues a single-use ID-JAG; oauth-mcp (the MCP authorization server) redeems it for its own access token; the gateway then forwards or exchanges that token to the resource server. Click a step, or drag nodes to rearrange.",
    wire: "chain on the token rail:\nuser-token → pf-id-jag-issued → pf-id-jag-redeemed → gateway hops → tool",
    src: ["demo_api_server/services/agentMcpTokenService.js  (resolvePingFederateIdJagToken, ~L1263)", "docs/superpowers/specs/2026-09-24-pingfederate-id-jag-run-mode-design.md"] },
  { t: "1 · PF login", nodes: ["browser", "pf", "bff"], edges: ["e1a", "e1b"],
    text: "Live run silently logs out, then does a PingFederate login with a server-bound one-shot run intent (mode live-id-jag). The BFF exchanges the code and keeps the id/access/refresh tokens in its session; the browser only gets a cookie.",
    wire: "GET /as/authorization.oauth2  (prompt=login)\n302 → BFF callback?code=…\nPOST /as/token.oauth2 grant_type=authorization_code\nsession.idJagRunIntent = { mode:'live-id-jag', useCaseId }",
    src: ["UC40-PF-IDJAG-SESSION-HANDOFF.md §3 (verified-green login chain)", "docs/superpowers/specs/2026-09-24-pingfederate-id-jag-run-mode-design.md"] },
  { t: "2 · Run + gate", nodes: ["browser", "bff"], edges: ["e2"],
    text: "Only the catalog use case enterprise-managed-mcp-authorization can select the ID-JAG lane, and only with a PF session + valid run intent + pf_id_jag_enabled. Anything else uses the ordinary PF two-exchange path. Missing prerequisites return id_jag_provider_required / _mismatch / _login_required — never a silent fallback.",
    wire: "POST /api/agent/run\n{ messages:[…], useCaseId:'enterprise-managed-mcp-authorization' }\n\nassertPfIdJagRunAllowed(req, useCaseId)\nshouldUsePfIdJagForRun(provider,useCaseId) → 'id-jag' | 'standard'",
    src: ["agentMcpTokenService.js L116–160 (assertPfIdJagRunAllowed)", "docs/superpowers/specs/2026-09-23-pf-id-jag-per-run-design.md"] },
  { t: "3 · PF issues ID-JAG", nodes: ["bff", "pf"], edges: ["e3"],
    text: "RFC 8693 token exchange asking PF for an ID-JAG. Subject is the BFF-held refresh token (configurable via pf_id_jag_subject_token_type). PF’s processor policy validates it, the OAuth Token Exchange SP connection maps the contract, and PF returns a ~300s JWT. The BFF validates typ, sub, iss, aud and exp before using it.",
    wire: "POST {PF}/as/token.oauth2\ngrant_type=urn:ietf:params:oauth:grant-type:token-exchange\nrequested_token_type=urn:ietf:params:oauth:token-type:id-jag\nsubject_token=<refresh token>   subject_token_type=…:refresh_token\naudience=<pf_id_jag_audience>  resource=<pf_id_jag_resource>  scope=…\n\n← { access_token:<ID-JAG>, issued_token_type:…:id-jag,\n    token_type:'N_A', expires_in:300 }\nheader typ = oauth-id-jag+jwt",
    src: ["demo_api_server/services/oauthService.js performIdJagExchange (~L370–470)", ".claude/skills/pingfederate-id-jag/SKILL.md", "UC40 handoff §4a.5 (client needs TOKEN_EXCHANGE grant)"] },
  { t: "4 · Redeem at oauth-mcp", nodes: ["bff", "mcpas", "pf"], edges: ["e4", "e5"],
    text: "The ID-JAG is an assertion, never a resource bearer. oauth-mcp verifies it fail-closed, then mints a NEW access token with its own signing key — PF’s key does not sign it. Scope = assertion ∩ client scope.",
    wire: "POST {pf_id_jag_redemption_token_endpoint}\ngrant_type=urn:ietf:params:oauth:grant-type:jwt-bearer\nassertion=<ID-JAG>  client_id=…  resource=…  scope=…\n\nverifyIdJag():\n  alg pinned RS256 · iss == ENTERPRISE_IDP_ISSUER\n  aud == oauth-mcp issuer · typ == oauth-id-jag+jwt\n  exp/nbf (5s skew) · resource ∈ accepted · jti single-use\n  JWKS = ENTERPRISE_IDP_JWKS_URL (PF x5t → unique key)",
    src: ["oauth-mcp/src/oauth/IdJagGrantHandler.ts", "oauth-mcp/src/oauth/OAuthRouter.ts redeemIdJag (~L573)", "creating-pingfederate-id-jag-resource-server/references/id-jag-redemption.md"] },
  { t: "5 · Gateway validates", nodes: ["bff", "gw", "mcpas"], edges: ["e6", "e7"],
    text: "The BFF calls the gateway with the oauth-mcp-issued token. The gateway uses the unverified iss ONLY to pick a JWKS (oauth-mcp’s here), then verifies the signature, expiry, nbf/iat, audience and scopes. GatewayTokenPolicy requires sub, validates act, and its narrow D-05 exemption lets an oauth-mcp token through anti-bypass.",
    wire: "iss == OAUTH_MCP_ID_JAG_ISSUER → OAUTH_MCP_ID_JAG_JWKS_URL\niss == PF_ISSUER_URI           → PF_JWKS_URI\nelse                           → PINGONE_JWKS_*\nunknown kid → refresh JWKS once → fail closed",
    src: ["demo_mcp_gateway/src/tokenValidator.ts", "demo_mcp_gateway/src/auth/GatewayTokenPolicy.ts", "downstream-validation.md (table)"] },
  { t: "6 · Forward or exchange", nodes: ["gw", "rs", "pf"], edges: ["e8", "e9"],
    text: "Per-route. Step 3.7: if the token’s aud already equals the resolved backend resource URI, forward unchanged (exchanged:false). Otherwise Step 4 does an RFC 8693 exchange for the backend audience (may be PF-issued) and fails closed if it fails. PingOne cannot parse an oauth-mcp-signed subject, which is why the aud match matters.",
    wire: "if isIdJagIssuedToken(decoded) && aud ∋ backendResourceUri(backend)\n   → forward(bearer)            # audit.backend.exchanged = false\nelse\n   → doExchange(bearer, tool)   # RFC 8693; nothing forwarded on failure\nbackends: olb | invest | jwtverifier  (routeTool)",
    src: ["demo_mcp_gateway/src/middleware/authorizeMcpRequest.ts Step 3.7 (~L1288) / Step 4", "UC40 handoff §4a.10 (Exchange #3 follows subject issuer)"] },
  { t: "7 · Resource server", nodes: ["rs", "pf"], edges: ["e10"],
    text: "The resource server verifies the token it actually receives. Its accepted-audience list comes from MCP_RESOURCE_SERVER_RESOURCE_URI — deliberately separate from the banking MCP server’s MCP_SERVER_RESOURCE_URI. It never accepts a raw ID-JAG. Known gap: no explicit expected-issuer check and no iat policy.",
    wire: "pre-decode iss == PF_ISSUER → verify vs PF_JWKS_URI\notherwise               → verify vs PingOne JWKS\naud ∈ MCP_RESOURCE_SERVER_RESOURCE_URI (comma list)\nscope: PF array or PingOne space string\njwtVerify(token, jwks)   # NO issuer option (gap)",
    src: ["demo_mcp_resource_server/src/server/tokenValidator.ts", "demo_mcp_resource_server/src/server/acceptedAudiences.ts", "downstream-validation.md §Resource-server checks"] },
];


const noteOn = (id, s) => (id === "n-bff" && s.nodes.includes("bff")) || (id === "n-jti" && s.nodes.includes("mcpas")) || (id === "n-gap" && s.nodes.includes("rs"));
const baseNodes = () => [
  ...NODES.map((n) => ({ id: n.id, type: "card", position: { x: n.x, y: n.y }, style: { width: 300 }, data: { ...n } })),
  ...NOTES.map((n) => ({ id: n.id, type: "note", position: { x: n.x, y: n.y }, style: { width: 300 }, data: { ...n } })),
];

function ImplementationFlow() {
  const rf = useReactFlow();
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(3500);
  const [locked, setLocked] = useState(false);
  const [log, setLog] = useState([]);
  const [pulses, setPulses] = useState({});
  const [side, setSide] = useState(400);
  const [panel, setPanel] = useState(true);
  const [nodes, setNodes, onNodesChange] = useNodesState(baseNodes());
  const s = STEPS[step];

  // highlight only: positions/sizes live in node state so drags and resizes survive step changes
  useEffect(() => {
    setNodes((ns) => ns.map((n) => ({
      ...n,
      data: { ...n.data,
        dim: step !== 0 && (n.type === "note" ? !noteOn(n.id, s) : !s.nodes.includes(n.id)),
        on: step !== 0 && n.type === "card" && s.nodes.includes(n.id) },
    })));
    const ids = step === 0 ? undefined : s.nodes.map((id) => ({ id }));
    const t = setTimeout(() => rf.fitView({ nodes: ids, padding: step === 0 ? 0.03 : 0.25, duration: 500, maxZoom: 1 }), 30);
    return () => clearTimeout(t);
  }, [step]);

  // re-fit when the side panel is shown/hidden so the diagram uses the freed width
  useEffect(() => {
    const t = setTimeout(() => rf.fitView({ nodes: step === 0 ? undefined : s.nodes.map((id) => ({ id })), padding: step === 0 ? 0.03 : 0.25, duration: 400, maxZoom: 1 }), 60);
    return () => clearTimeout(t);
  }, [panel]);

  const fullscreen = () => {
    const el = document.querySelector(".ijx");
    if (document.fullscreenElement) document.exitFullscreen();
    else if (el && el.requestFullscreen) el.requestFullscreen();
    setTimeout(() => rf.fitView({ padding: 0.03, duration: 300 }), 250);
  };

  // simulate: fire a token dot down each active edge and append to the event log
  useEffect(() => {
    if (step === 0) return;
    const dur = Math.max(0.8, speed / 1000 - 0.8);
    setPulses(Object.fromEntries(s.edges.map((e) => [e, Date.now() + e])));
    if (playing) setLog((l) => [...l, `${step}. ${s.t} — ${s.wire.split("\n")[0]}`]);
    setPulses((p) => ({ ...p, dur }));
  }, [step, playing]);

  useEffect(() => {
    if (!playing) return;
    const t = setTimeout(() => {
      if (step >= STEPS.length - 1) { setPlaying(false); return; }
      setStep(step + 1);
    }, speed);
    return () => clearTimeout(t);
  }, [playing, step, speed]);

  const play = () => {
    if (step >= STEPS.length - 1 || step === 0) { setLog([]); setStep(1); setPlaying(true); }
    else setPlaying(true);
  };
  const resetLayout = () => { const b = baseNodes(); setNodes((ns) => ns.map((n) => ({ ...n, position: b.find((x) => x.id === n.id).position, style: { width: 300 } }))); setTimeout(() => rf.fitView({ padding: 0.08, duration: 400 }), 30); };

  const edges = EDGES.map(([id, source, sh, target, th, label, dashed]) => {
    const on = step === 0 || s.edges.includes(id);
    return {
      id, source, target, sourceHandle: sh, targetHandle: th, label, type: "flow",
      data: { on, label, pulse: step !== 0 && s.edges.includes(id) ? pulses[id] : 0, dur: pulses.dur || 2 },
      animated: step !== 0 && on,
      markerEnd: { type: MarkerType.ArrowClosed },
      style: { strokeWidth: on ? 2.4 : 1.2, opacity: on ? 1 : 0.15, strokeDasharray: dashed ? "6 4" : undefined },
    };
  });

  const startSplit = (e) => {
    e.preventDefault();
    const mv = (ev) => setSide(Math.min(720, Math.max(260, ev.clientX)));
    const up = () => { window.removeEventListener("pointermove", mv); window.removeEventListener("pointerup", up); };
    window.addEventListener("pointermove", mv); window.addEventListener("pointerup", up);
  };

  return (
    <div className="ijx-app" style={{ gridTemplateColumns: panel ? `${side}px 6px 1fr` : "0 0 1fr" }}>
      <aside style={panel ? undefined : { padding: 0, border: 0, overflow: "hidden", visibility: "hidden" }}>
        <h1>ID-JAG on PingFederate</h1>
        <p className="lede">UC40 · how the BFF, PingFederate, oauth-mcp, the gateway and the resource server are wired</p>
        <div className="sim">
          <button className="pri" onClick={playing ? () => setPlaying(false) : play}>{playing ? "⏸ Pause" : "▶ Simulate"}</button>
          <button onClick={() => { setPlaying(false); setStep(Math.max(0, step - 1)); }} disabled={step === 0}>◀ Back</button>
          <button onClick={() => { setPlaying(false); setStep(Math.min(STEPS.length - 1, step + 1)); }} disabled={step === STEPS.length - 1}>Next ▶</button>
          <button onClick={() => { setPlaying(false); setStep(0); setLog([]); }}>⟲ Reset</button>
          <label>Speed <select value={speed} onChange={(e) => setSpeed(+e.target.value)}>
            <option value={6000}>Slow</option><option value={3500}>Normal</option><option value={2000}>Fast</option></select></label>
        </div>
        <div className="sim">
          <button onClick={() => setLocked(!locked)}>{locked ? "🔒 Nodes locked" : "✋ Nodes movable"}</button>
          <button onClick={resetLayout}>Reset layout</button>
          <span className="hint">Drag to move · click a node to resize</span>
        </div>
        <nav>{STEPS.map((x, i) => (
          <button key={i} className={i === step ? "sel" : ""} onClick={() => { setPlaying(false); setStep(i); }}>{x.t}</button>
        ))}</nav>
        <section>
          <h2>{s.t}</h2>
          <p>{s.text}</p>
          <pre>{s.wire}</pre>
          <h3>Source</h3>
          <ul>{s.src.map((x) => <li key={x}>{x}</li>)}</ul>
          {log.length > 0 && (<><h3>Simulation log</h3><ol className="log">{log.map((l, i) => <li key={i}>{l}</li>)}</ol></>)}
        </section>
        <p className="legend">Solid = request/response on the happy path · dashed = trust lookup or alternate branch</p>
      </aside>
      <div className="split" style={panel ? undefined : { visibility: "hidden" }} onPointerDown={startSplit} title="Drag to resize panel" />
      <main>
        <div className="tools">
          <button onClick={() => setPanel(!panel)}>{panel ? "◀ Hide panel" : "▶ Show panel"}</button>
          <button onClick={fullscreen}>⛶ Fullscreen</button>
        </div>
        <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes}
          onNodesChange={onNodesChange} nodesDraggable={!locked} connectionMode={ConnectionMode.Loose}
          fitView fitViewOptions={{ padding: 0.08 }} minZoom={0.1} nodesConnectable={false} proOptions={{ hideAttribution: true }}>
          <Background gap={24} />
          <Controls showInteractive={false} />
        </ReactFlow>
      </main>
    </div>
  );
}

export default function PingFederateIdJagImplementationPage() {
  return (
    <div className="ijx">
      <ReactFlowProvider>
        <ImplementationFlow />
      </ReactFlowProvider>
    </div>
  );
}
