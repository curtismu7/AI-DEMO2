// ResourceServerPlacementPage.jsx — where the Kong-mock resource server sits
// in the agent flow, and which token it validates (only the step-9 token,
// delegated to PingOne Authorize over the AAM sideband). Rendered as an
// interactive React Flow graph via the shared StaticFlowDiagram component.
import React, { useState } from "react";
import StaticFlowDiagram from "./StaticFlowDiagram";
import DiagramStepBar from "./DiagramStepBar";
import { edgeCaptions, useDiagramStepper } from "../hooks/useDiagramStepper";
import "./ResourceServerPlacementPage.css";

export const RSP_NODES = [
  { id: "U", group: "upstream", label: "USER + AI AGENT", sub: ["UI :4000 · local.ping-devops.com", "chat / chips"], x: 0, y: 40 },
  { id: "B", group: "upstream", label: "BFF — demo_api_server :3001", sub: ["session ✓ · P1AZ pre-flight gate", "RFC 8693 exchange #1/#2 ⇒ MCP token"], x: 300, y: 40 },
  { id: "G", group: "upstream", label: "GATEWAY — IG :3036 / MCP-GW :3005", sub: ["✓ token validation (JWKS / introspection)", "P1AZ decision · schema checks · exchange #3"], x: 600, y: 40 },
  { id: "M", group: "upstream", label: "MCP SERVER — oauth-mcp :8080", sub: ["✓ JWKS + last-hop authz (D-05)", "tool scope narrowing · STEP-9 exchange"], x: 900, y: 40 },
  { id: "RS", group: "hot", label: "RESOURCE SERVER — Kong mock", sub: ["/api/accounts · /api/transactions", "validates ONLY the step-9 token", "never re-validates upstream tokens"], x: 1200, y: 40 },
  { id: "P", group: "pdp", label: "PingOne Authorize — AAM", sub: ["mock authz :9001 / real sideband"], x: 1200, y: 280 },
  { id: "D", group: "upstream", label: "Banking data", sub: ["data/store.js"], x: 1500, y: 40 },
];

export const RSP_EDGES = [
  ["U", "B", "session cookie"],
  ["B", "G", "MCP token · aud = mcp resource"],
  ["G", "M", "gateway token · aud = mcpserver.ping.demo"],
  ["M", "RS", "STEP-9 token · aud = banking RS · scopes narrowed · act chain + X-Agent-Sub / X-MCP-Tool", { color: "#e0575c" }],
  ["RS", "P", "1. /sideband/request — ctx + raw Authorization", { dashed: true }],
  ["P", "RS", "decision — deny = complete direct response", { dashed: true }],
  ["RS", "P", "2. /sideband/response — real body", { dashed: true }],
  ["P", "RS", "redacted / modified body", { dashed: true }],
  ["RS", "D", "only after PERMIT"],
];

export const RSP_GROUPS = {
  upstream: { label: "Agent flow — each hop keeps its own token work", bg: "#2a313c" },
  hot: { label: "The Kong-mock checkpoint", bg: "#e0575c" },
  pdp: { label: "P1AZ sideband (AAM)", bg: "#7c3aed" },
};

const RSP_DETAILS = {
  U: "User signs in once; the browser holds only a session cookie.",
  B: "Owns the session, runs the P1AZ pre-flight tool gate, and performs RFC 8693 exchanges #1/#2 to mint the MCP token.",
  G: "Validates the MCP token (JWKS / introspection), asks P1AZ for a decision, schema-checks the call, and performs exchange #3 for the gateway token.",
  M: "Verifies the gateway token, narrows per-tool scopes, and performs the STEP-9 exchange for the banking RS audience.",
  RS: "The Kong-mock checkpoint. Validates exactly one credential — the step-9 token — by handing it to PingOne Authorize over the AAM sideband. Deny is relayed verbatim; the store is reachable only on PERMIT.",
  P: "The PDP. Validates the forwarded token, decides, and redacts the response body on the way back.",
  D: "Banking data. Reached only after a PERMIT decision.",
};

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

const RSP_CAPTIONS = edgeCaptions(RSP_EDGES, Object.fromEntries(RSP_NODES.map((n) => [n.id, n.label])));

export default function ResourceServerPlacementPage() {
  const [selectedNode, setSelectedNode] = useState(null);
  const stepper = useDiagramStepper(RSP_EDGES.length);

  const nodeDetail = selectedNode
    ? RSP_DETAILS[selectedNode.id] ||
      `${selectedNode.data.label} — participant in the resource-server placement flow.`
    : null;

  return (
    <div className="rsp-page">
      <div className="rsp-hero">
        <span className="rsp-eyebrow">Last hop · Kong pattern · PingOne Authorize AAM</span>
        <h1>Resource Server Placement</h1>
        <p className="rsp-sub">
          Where the Kong-mock checkpoint sits in the agent flow. Every upstream hop keeps its
          own token work — the resource server validates exactly one thing: the step-9 token
          addressed to it, and it does that the Kong way, by handing it to PingOne Authorize
          over the AAM sideband. The store is only reachable on PERMIT. Click any node for its role.
        </p>
      </div>

      <div className="rsp-panel">
        <DiagramStepBar stepper={stepper} caption={RSP_CAPTIONS[stepper.step]} />
        <StaticFlowDiagram
          NODES={RSP_NODES}
          EDGES={RSP_EDGES}
          GROUPS={RSP_GROUPS}
          step={stepper.step}
          onNodeClick={(node) => setSelectedNode(selectedNode?.id === node.id ? null : node)}
          testId="rsp-flow-diagram"
          height={560}
        />
      </div>

      {nodeDetail && (
        <div className="rsp-node-detail" role="status">
          <strong>{selectedNode.data.label}</strong>
          <p>{nodeDetail}</p>
        </div>
      )}

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
