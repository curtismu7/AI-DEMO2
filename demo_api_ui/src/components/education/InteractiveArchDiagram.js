/**
 * InteractiveArchDiagram — simplified live diagram driven by TokenChainContext.
 *
 * NOTE: This component is intentionally a SIMPLIFICATION. It renders the core
 * default path (User, PingOne, BFF/Agent, LLM, Agent Gateway, OLB, Invest,
 * Mortgage) so the inline "live highlighting" stays compact when token-chain
 * events fire. It is NOT the authoritative architecture view. The 2026-05-16
 * §4 fix corrected this from a false pre-gateway 5-node model to the real
 * BFF -> Gateway -> backends topology; that topology is pinned by
 * ArchitectureDiagram.completeness.test.js (anti-drift guard).
 *
 * For the COMPLETE system picture, see:
 *   - Mermaid source:  architecture-simple.mmd  (repo root)
 *   - Rendered PNG:    banking_api_ui/public/architecture/overview.png
 *   - Detailed view:   architecture.mmd → overview2.png
 *
 * The Jest sync test
 *   banking_api_ui/src/components/__tests__/ArchitectureDiagram.completeness.test.js
 * enforces "every service in run-demo.sh SVC_LIST appears in at least one .mmd source"
 * — DO NOT add nodes here to satisfy that test; add them to the .mmd sources instead.
 *
 * Why this component was retained (Phase 270 user decision): it drives off
 * TokenChainContext to highlight which boxes have been touched during the current
 * agent flow. That live behaviour is not replicated by a static PNG. If you find
 * yourself maintaining two parallel diagrams, prefer the PNG and remove this
 * component in a future phase.
 */
// banking_api_ui/src/components/education/InteractiveArchDiagram.js
import React from "react";
import StaticFlowDiagram from "../StaticFlowDiagram";
import { useTokenChainOptional } from "../../context/TokenChainContext";
import RfcLink from "../shared/RfcLink";
import "./InteractiveArchDiagram.css";

// Real architecture nodes. Corrected 2026-05-16: the prior 5-node model
// (User, BFF, PingOne, LLM, MCP) implied a false BFF->MCP-direct edge and
// omitted the Agent Gateway + backend MCP servers. The real default path is
// User -> BFF/Agent -> Agent Gateway -> backend MCP servers (OLB / Invest)
// and the api_key-disposition mortgage service, with PingOne issuing the
// RFC 8693 token and the external agent service (demo_agent_service :3006) doing
// tool selection. The Gateway hop is env-conditional (MCP_GATEWAY_HTTP_URL)
// but is the documented default in the architecture sources, so we depict it.
// Topology is pinned by ArchitectureDiagram.completeness.test.js (anti-drift)
// — do not revert to the pre-gateway 5-node model without updating that guard.
const NODES = {
  user: {
    icon: "USR",
    label: "User / Browser",
    sub: "SPA, cookie session",
    type: "user",
  },
  bff: {
    icon: "BFF",
    label: "BFF / AI Agent",
    sub: "Express :3001 → agent_svc :3006",
    type: "bff",
  },
  idp: {
    icon: "IDP",
    label: "PingOne",
    sub: "OAuth 2.0 AS / OIDC",
    type: "idp",
  },
  llm: {
    icon: "LLM",
    label: "LLM Provider",
    sub: "OpenAI / Anthropic / Groq / Gemini / Helix",
    type: "llm",
  },
  gateway: {
    icon: "GW",
    label: "Agent Gateway",
    sub: "demo_mcp_gateway :3005",
    type: "agent",
  },
  mcp: {
    icon: "OLB",
    label: "MCP OLB",
    sub: "demo_mcp_server :8080",
    type: "mcp",
  },
  invest: {
    icon: "INV",
    label: "MCP Resource Server",
    sub: "demo_mcp_resource_server :8081",
    type: "mcp",
  },
  mortgage: {
    icon: "API",
    label: "API Resource Server",
    sub: "api_key disposition :8082",
    type: "api",
  },
  a2aOrch: {
    icon: "A2A",
    label: "A2A Orchestrator",
    sub: "CrewAI crew: decide / authorize",
    type: "agent",
  },
  specialist: {
    icon: "SPC",
    label: "Specialist Agent",
    sub: "Investment / Records / Purchase",
    type: "agent",
  },
};

// Hand-placed positions (StaticFlowDiagram spreads them a little).
const POS = {
  user: [0, 0],
  idp: [0, 240],
  bff: [380, 0],
  llm: [380, 240],
  a2aOrch: [380, 460],
  specialist: [760, 460],
  gateway: [1140, 0],
  mcp: [1520, 0],
  invest: [1520, 200],
  mortgage: [1520, 400],
};

const EDGES = [
  ["user", "bff", "PKCE Login (authorization_code + PKCE)"],
  ["bff", "idp", "RFC 8693 token exchange: user token + agent CC token"],
  ["bff", "gateway", "tools/list + tools/call (JSON-RPC, exchanged token)"],
  ["gateway", "mcp", "oauth_bearer: Bearer (new aud)"],
  ["gateway", "invest", "oauth_bearer / dual_token: Bearer (new aud)"],
  ["gateway", "mortgage", "api_key: X-API-Key + X-User-Sub"],
  ["bff", "a2aOrch", "A2A: delegate (decide / coordinate / authorize)"],
  ["a2aOrch", "specialist", "nested RFC 8693 act (PingOne approves)"],
  ["specialist", "gateway", "Narrow tool call (least-privilege token)"],
];

// Same palette as the old column view; "live" is its old active-box highlight colour.
const GROUPS = {
  live: { label: "Touched by this session's token chain", bg: "#2563eb" },
  user: { label: "User / Browser", bg: "#60a5fa" },
  bff: { label: "BFF / AI Agent", bg: "#34d399" },
  idp: { label: "PingOne (OAuth AS)", bg: "#f59e0b" },
  llm: { label: "LLM Provider", bg: "#f472b6" },
  agent: { label: "Agent Gateway / A2A agents", bg: "#fca5a5" },
  mcp: { label: "MCP servers (OLB / Invest)", bg: "#2dd4bf" },
  api: { label: "Mortgage svc (api_key)", bg: "#94a3b8" },
};

export default function InteractiveArchDiagram() {
  const ctx = useTokenChainOptional();
  const events = ctx?.events || [];

  const activeNodes = new Set();
  if (events.some((ev) => ev.status === "active" || ev.status === "acquired")) {
    activeNodes.add("user");
    activeNodes.add("bff");
  }
  if (events.some((ev) => ev.id?.includes("agent") || ev.id?.includes("cc"))) {
    activeNodes.add("idp");
  }
  // An acquired MCP-scoped token means the request flowed through the
  // Gateway to a backend MCP server — light the gateway + OLB (default tool
  // surface). Invest/Mortgage stay un-highlighted unless a future token
  // event distinguishes them.
  if (events.some((ev) => ev.id?.includes("mcp") && ev.status === "acquired")) {
    activeNodes.add("gateway");
    activeNodes.add("mcp");
  }

  const hasExchange = activeNodes.has("idp");

  return (
    <div className="iad-root">
      <div className="iad-title">RFC 8693 Token Exchange Architecture</div>
      <div className="iad-subtitle">
        Drag the boxes, Simulate to walk the arrows · Live token state reflected from
        Token Chain · <RfcLink rfc="RFC_8693" />
      </div>

      <StaticFlowDiagram
        NODES={Object.entries(NODES).map(([id, n]) => ({
          id,
          group: activeNodes.has(id) ? "live" : n.type,
          label: n.label,
          sub: [n.sub],
          x: POS[id][0],
          y: POS[id][1],
        }))}
        EDGES={EDGES}
        GROUPS={GROUPS}
        testId="iad-flow"
        ariaLabel="RFC 8693 token exchange architecture"
      />

      {hasExchange && (
        <div className="iad-exchange-banner">
          <strong>RFC 8693 Exchange Flow:</strong> BFF sends user token + agent
          CC token to PingOne, which issues a narrowed access token. The MCP
          Gateway routes each tool call per its credential disposition
          (oauth_bearer / dual_token to OLB &amp; Invest; api_key to the
          mortgage service). Subject identity is preserved throughout.{" "}
          <RfcLink rfc="RFC_8693" section="§4" />
        </div>
      )}

      <div className="iad-legend">
        {Object.values(GROUPS).map(({ label, bg }) => (
          <div key={label} className="iad-legend-item">
            <div className="iad-legend-dot" style={{ background: bg }} />
            <span>{label}</span>
          </div>
        ))}
      </div>

      <div className="iad-rfc-row">
        <span>Standards:</span>
        <RfcLink rfc="RFC_8693" /> · <RfcLink rfc="RFC_7636" /> ·{" "}
        <RfcLink rfc="MCP_SPEC" /> · <RfcLink rfc="RFC_9728" />
      </div>
    </div>
  );
}
