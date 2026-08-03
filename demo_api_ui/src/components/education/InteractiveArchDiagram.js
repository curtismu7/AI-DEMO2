/**
 * InteractiveArchDiagram — simplified live diagram driven by TokenChainContext.
 *
 * NOTE: This component is intentionally a SIMPLIFICATION. It renders the core
 * default path (User, PingOne, BFF/Agent, LLM, MCP Gateway, OLB, Invest,
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
import React, { useState } from "react";
import { useTokenChainOptional } from "../../context/TokenChainContext";
import RfcLink from "../shared/RfcLink";
import "./InteractiveArchDiagram.css";

// Real architecture nodes. Corrected 2026-05-16: the prior 5-node model
// (User, BFF, PingOne, LLM, MCP) implied a false BFF->MCP-direct edge and
// omitted the MCP Gateway + backend MCP servers. The real default path is
// User -> BFF/Agent -> MCP Gateway -> backend MCP servers (OLB / Invest)
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
    label: "MCP Gateway",
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

const ARROWS = [
  {
    id: "login",
    label: "PKCE Login + RFC 8693",
    claims: {
      grant: "authorization_code + PKCE",
      exchange: "RFC 8693 token exchange",
    },
    rfc: "RFC_7636",
  },
  {
    id: "agent_to_gw",
    label: "tools/list + tools/call",
    claims: {
      transport: "JSON-RPC (HTTP /mcp or WS)",
      token: "RFC 8693 exchanged access token",
    },
    rfc: "MCP_SPEC",
  },
  {
    id: "gw_to_backends",
    label: "Routed per credential disposition",
    claims: {
      oauth_bearer: "Bearer (new aud) -> OLB / Invest",
      api_key: "X-API-Key + X-User-Sub -> Mortgage",
    },
    rfc: "RFC_8693",
  },
  {
    id: "delegate",
    label: "A2A: delegate (RFC 8693 nested act)",
    claims: {
      flow: "BFF -> A2A Orchestrator (decide / coordinate / authorize)",
      exchange: "nested RFC 8693 act -> Specialist Agent (PingOne approves)",
    },
    rfc: "RFC_8693",
  },
  {
    id: "specialist_tool",
    label: "Narrow tool call",
    claims: {
      transport: "Specialist -> MCP Gateway (JSON-RPC tools/call)",
      token: "narrowed access token (least privilege)",
    },
    rfc: "MCP_SPEC",
  },
];

function Node({ nodeKey, isActive, onClick }) {
  const n = NODES[nodeKey];
  if (!n) return null;
  return (
    <div
      className={`iad-node iad-node--${n.type}`}
      onClick={() => onClick(nodeKey)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === "Enter" && onClick(nodeKey)}
      title={`${n.label} — ${n.sub}`}
      style={
        isActive
          ? { boxShadow: "0 0 0 3px #2563eb44", borderColor: "#2563eb" }
          : undefined
      }
    >
      <div className="iad-node-icon">{n.icon}</div>
      <div className="iad-node-label">{n.label}</div>
      <div className="iad-node-sublabel">{n.sub}</div>
    </div>
  );
}

function Arrow({ arrow, isActive }) {
  const claimLines = arrow.claims
    ? Object.entries(arrow.claims)
        .map(([k, v]) => `${k}: ${v}`)
        .join("\n")
    : null;

  return (
    <div className="iad-arrow-wrapper">
      <div className={`iad-arrow${isActive ? " iad-arrow--active" : ""}`}>
        <div className="iad-arrow-line" />
        <div className="iad-arrow-head">→</div>
        <div className="iad-arrow-label">
          <span>{arrow.label}</span>
          {arrow.claims &&
            Object.entries(arrow.claims)
              .slice(0, 2)
              .map(([k, v]) => (
                <span key={k} className="iad-arrow-claim">
                  <strong>{k}:</strong> {String(v).slice(0, 28)}
                  {String(v).length > 28 ? "…" : ""}
                </span>
              ))}
        </div>
      </div>
      {claimLines && <div className="iad-claim-popup">{claimLines}</div>}
    </div>
  );
}

export default function InteractiveArchDiagram() {
  const ctx = useTokenChainOptional();
  const events = ctx?.events || [];
  const [, setSelectedNode] = useState(null);

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
        Hover arrows for token claim details · Live token state reflected from
        Token Chain · <RfcLink rfc="RFC_8693" />
      </div>

      <div className="iad-canvas">
        {/* Col 1: User + PingOne */}
        <div className="iad-col">
          <Node
            nodeKey="user"
            isActive={activeNodes.has("user")}
            onClick={setSelectedNode}
          />
          <Node
            nodeKey="idp"
            isActive={activeNodes.has("idp")}
            onClick={setSelectedNode}
          />
        </div>

        <Arrow arrow={ARROWS[0]} isActive={activeNodes.has("bff")} />

        {/* Col 2: BFF (demo_api_server :3001, delegates to demo_agent_service :3006) + LLM */}
        <div className="iad-col">
          <Node
            nodeKey="bff"
            isActive={activeNodes.has("bff")}
            onClick={setSelectedNode}
          />
          <Node nodeKey="llm" isActive={false} onClick={setSelectedNode} />
          <Node
            nodeKey="a2aOrch"
            isActive={activeNodes.has("a2aOrch")}
            onClick={setSelectedNode}
          />
        </div>

        {/* A2A delegation: BFF -> A2A Orchestrator -> Specialist Agent (nested RFC 8693) */}
        <Arrow arrow={ARROWS[3]} isActive={activeNodes.has("a2aOrch")} />

        <Arrow arrow={ARROWS[1]} isActive={activeNodes.has("gateway")} />

        {/* Col 3: MCP Gateway — central router (env-conditional default) */}
        <div className="iad-col">
          <Node
            nodeKey="gateway"
            isActive={activeNodes.has("gateway")}
            onClick={setSelectedNode}
          />
          <Node
            nodeKey="specialist"
            isActive={activeNodes.has("specialist")}
            onClick={setSelectedNode}
          />
        </div>

        {/* Specialist Agent issues narrow tool calls back through the MCP Gateway */}
        <Arrow arrow={ARROWS[4]} isActive={activeNodes.has("specialist")} />

        <Arrow arrow={ARROWS[2]} isActive={activeNodes.has("mcp")} />

        {/* Col 4: Backend MCP servers + api_key mortgage service */}
        <div className="iad-col">
          <Node
            nodeKey="mcp"
            isActive={activeNodes.has("mcp")}
            onClick={setSelectedNode}
          />
          <Node
            nodeKey="invest"
            isActive={activeNodes.has("invest")}
            onClick={setSelectedNode}
          />
          <Node
            nodeKey="mortgage"
            isActive={activeNodes.has("mortgage")}
            onClick={setSelectedNode}
          />
        </div>
      </div>

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
        {[
          ["#60a5fa", "User / Browser"],
          ["#34d399", "BFF / AI Agent"],
          ["#f59e0b", "PingOne (OAuth AS)"],
          ["#f472b6", "LLM Provider"],
          ["#a78bfa", "MCP Gateway"],
          ["#2dd4bf", "MCP servers (OLB / Invest)"],
          ["#94a3b8", "Mortgage svc (api_key)"],
        ].map(([color, label]) => (
          <div key={label} className="iad-legend-item">
            <div className="iad-legend-dot" style={{ background: color }} />
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
