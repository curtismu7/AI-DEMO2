/**
 * ArchitectureFlowPage.js — /architecture/flow
 *
 * Interactive React Flow diagram matching the real banking demo code flow:
 *   Agent → Ping Agent Gateway → PingOne Authorization Server (McpRequest + McpToolCall)
 *   → RFC 8693 Exchange #3 (backend-scoped) → MCP Server → Banking API
 *
 * Pause / Resume / Next-Step controls let you read each token card.
 * Token badges on nodes show aud / act with changed claims highlighted.
 */
import React, { useState, useEffect, useRef, useCallback } from "react";
import HistoryModal from "./HistoryModal";
import { DEFAULT_STEP_MS, DiagramControls, STEP_TIME_OPTIONS } from "./diagram";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  Panel,
  Handle,
  Position,
  useNodesState,
  useEdgesState,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import apiClient from "../services/apiClient";
import { agentFlowDiagram } from "../services/agentFlowDiagramService";
import { useAppEventsSSE } from "../hooks/useAppEventsSSE";
import "./ArchitectureFlowPage.css";

// ─── Colors ───────────────────────────────────────────────────────────────────

const COLOR = {
  active: { bg: "rgba(0,70,135,0.18)", border: "#004687", text: "#003366" },
  "active-prev": {
    bg: "rgba(100,116,139,0.08)",
    border: "#94a3b8",
    text: "#64748b",
  },
  "active-error": {
    bg: "rgba(239,68,68,0.15)",
    border: "#ef4444",
    text: "#b91c1c",
  },
  "active-permit": {
    bg: "rgba(76,175,80,0.15)",
    border: "#4CAF50",
    text: "#166534",
  },
  "active-hitl": {
    bg: "rgba(234,179,8,0.18)",
    border: "#ca8a04",
    text: "#713f12",
  },
  // The idle state is a plain surface (THEMING.md rule 3's "how far from the
  // page ground" branch), unlike the five states above which are semantic
  // status accents ("what is this thing") and stay literal on purpose. It's
  // the only entry read through CSS vars — everything else in COLOR is a
  // fixed hex/rgba string.
  default: { bg: "var(--th-bg-card)", border: "var(--th-border)", text: "var(--th-text)" },
};

// ─── Architecture node ────────────────────────────────────────────────────────

function ArchNode({ data }) {
  const c = COLOR[data.colorClass] || COLOR.default;
  const pulse = data.colorClass && data.colorClass !== "active-prev";
  const b = data.badge;
  // Aspirational nodes (e.g. the planned API-key backend) render with a
  // dashed border and a small "planned" badge so viewers see they're
  // reference architecture, not live code.
  const isAspirational = !!data.aspirational;
  return (
    <div
      className="afp-node"
      style={{
        // background/border-color/color are declared in ArchitectureFlowPage.css
        // (.afp-node) and only READ these as custom properties — keeps the
        // actual themeable CSS properties out of inline style (THEMING.md
        // §8.3) while c.bg/c.border/c.text stay whatever this state needs
        // (a fixed hex/rgba for the five status accents, --th-* for default).
        "--afp-bg": c.bg,
        "--afp-border": c.border,
        "--afp-text": c.text,
        borderStyle: isAspirational ? "dashed" : "solid",
        borderWidth: 2,
        borderRadius: 8,
        padding: "6px 10px",
        minWidth: 85,
        maxWidth: 135,
        textAlign: "center",
        boxShadow: pulse
          ? `0 0 14px ${c.border}55`
          : "0 2px 6px rgba(0,0,0,0.07)",
        transition: "background 0.3s, border-color 0.3s",
        animation: pulse ? "arch-node-pulse 1.2s ease-in-out infinite" : "none",
        opacity: isAspirational ? 0.85 : 1,
      }}
    >
      {isAspirational && (
        <div
          style={{
            fontSize: "0.5rem",
            fontWeight: 700,
            color: "#854d0e",
            background: "#fef9c3",
            borderRadius: 3,
            padding: "1px 4px",
            marginBottom: 3,
            textTransform: "uppercase",
            letterSpacing: 0.4,
          }}
        >
          planned
        </div>
      )}
      {data.icon && (
        <div style={{ fontSize: "1.1rem", marginBottom: 2 }}>{data.icon}</div>
      )}
      <div
        style={{
          fontWeight: 700,
          fontSize: "0.68rem",
          lineHeight: 1.2,
          marginBottom: data.label2 ? 0.5 : 0,
        }}
      >
        {data.label}
      </div>
      {data.label2 && (
        <div style={{ fontSize: "0.58rem", opacity: 0.7, lineHeight: 1.1 }}>
          {data.label2}
        </div>
      )}
      {data.stepLabel && (
        <div
          className="afp-node-steplabel"
          style={{
            marginTop: 5,
            fontSize: "0.62rem",
            fontWeight: 600,
            borderRadius: 3,
            padding: "2px 4px",
            lineHeight: 1.3,
          }}
        >
          {data.stepLabel}
        </div>
      )}
      {/* Token badge — shows aud/act with changed claims highlighted */}
      {b && (
        <div
          className="afp-node-badge"
          style={{
            marginTop: 5,
            padding: "4px 5px",
            background: "rgba(0,0,0,0.06)",
            borderRadius: 4,
            textAlign: "left",
            borderLeftStyle: "solid",
            borderLeftWidth: 2,
          }}
        >
          {b.aud && (
            <div
              style={{
                fontSize: "0.58rem",
                fontFamily: "inherit",
                lineHeight: 1.4,
                color: b._changed?.includes("aud") ? "#1d4ed8" : "#475569",
                fontWeight: b._changed?.includes("aud") ? 800 : 400,
              }}
            >
              aud: {b.aud}
            </div>
          )}
          {b.act && (
            <div
              style={{
                fontSize: "0.56rem",
                fontFamily: "inherit",
                lineHeight: 1.4,
                color: b._changed?.includes("act") ? "#15803d" : "#475569",
                fontWeight: b._changed?.includes("act") ? 800 : 400,
              }}
            >
              act: {b.act}
            </div>
          )}
        </div>
      )}
      <Handle type="source" position={Position.Right} style={{ opacity: 0 }} />
      <Handle type="target" position={Position.Left} style={{ opacity: 0 }} />
      <Handle type="source" position={Position.Bottom} style={{ opacity: 0 }} />
      <Handle type="target" position={Position.Top} style={{ opacity: 0 }} />
    </div>
  );
}

const NODE_TYPES = { arch: ArchNode };

// ─── Nodes ────────────────────────────────────────────────────────────────────

// Positions use a uniform grid — columns 190px apart (> node maxWidth 135) and
// rows 180px apart (> expanded node height with step label + token badge) so
// boxes never overlap, even when a step expands a node during simulation.
const INITIAL_NODES = [
  {
    id: "user",
    type: "arch",
    position: { x: 20, y: 200 },
    data: { label: "User", icon: "👤", colorClass: "" },
  },
  {
    id: "chatbot",
    type: "arch",
    position: { x: 210, y: 200 },
    data: { label: "Chatbot", label2: "UI", icon: "💬", colorClass: "" },
  },
  {
    id: "agent",
    type: "arch",
    position: { x: 400, y: 200 },
    data: {
      label: "Agent",
      label2: "BFF LangGraph (default)",
      icon: "🤖",
      colorClass: "",
    },
  },
  {
    id: "llm",
    type: "arch",
    position: { x: 400, y: 380 },
    data: { label: "LLM", label2: "Claude", icon: "🧠", colorClass: "" },
  },
  {
    id: "idp-oauth-as",
    type: "arch",
    position: { x: 590, y: 20 },
    data: {
      label: "Your IdP",
      label2: "OAuth AS / SSO",
      icon: "🏦",
      colorClass: "",
    },
  },
  {
    id: "pingauthorize",
    type: "arch",
    position: { x: 780, y: 20 },
    data: {
      label: "PingOne Authorization Server",
      label2: "Fine-grained AZ",
      icon: "⚖️",
      colorClass: "",
    },
  },
  {
    id: "mcp-gw",
    type: "arch",
    position: { x: 780, y: 200 },
    data: {
      label: "Agent Gw",
      label2: "banking_mcp_gateway :3005",
      icon: "🔀",
      colorClass: "",
    },
  },
  {
    id: "mcp-server",
    type: "arch",
    position: { x: 780, y: 380 },
    data: {
      label: "MCP Server",
      label2: "banking_mcp_server :8080",
      icon: "🛠️",
      colorClass: "",
    },
  },
  {
    id: "mcp-resource-server",
    type: "arch",
    position: { x: 780, y: 560 },
    data: {
      label: "MCP Resource Server",
      label2: "banking_mcp_resource_server :8081",
      icon: "🛠️",
      colorClass: "",
    },
  },
  {
    id: "banking-api",
    type: "arch",
    position: { x: 970, y: 110 },
    data: {
      label: "Banking API",
      label2: "OAuth bearer",
      icon: "🏦",
      colorClass: "",
    },
  },
  // Phase 267 (LIVE): banking_api_resource_server — a legacy/3rd-party-style
  // backend that takes an API key instead of an OAuth bearer. The Gateway
  // drops the user bearer and injects X-API-Key + X-User-Sub when forwarding;
  // the backend never sees a user token. Drawn solid (aspirational:false):
  // this path is wired end-to-end today.
  {
    id: "api-key-backend",
    type: "arch",
    position: { x: 970, y: 290 },
    data: {
      label: "banking_api_resource_server",
      label2: "X-API-Key + X-User-Sub",
      colorClass: "",
      aspirational: false,
    },
  },
  // Phase 266 R2: banking_resource_server (live) — handles Path B (/identity) and Path C (/accounts /transactions).
  // Both paths B and C terminate here; Path C reads from LMDB.
  {
    id: "banking-resource-server",
    type: "arch",
    position: { x: 970, y: 470 },
    data: {
      label: "banking_resource_server",
      label2: "/identity · /accounts · /transactions",
      icon: null,
      colorClass: "",
      aspirational: false,
    },
  },
  {
    id: "lmdb-banking-db",
    type: "arch",
    position: { x: 1160, y: 470 },
    data: {
      label: "LMDB",
      label2: "banking-resource-server (lmdb)",
      icon: null,
      colorClass: "",
      aspirational: false,
      shape: "cylinder",
    },
  },
  {
    id: "hitl",
    type: "arch",
    position: { x: 210, y: 380 },
    data: {
      label: "HITL Service",
      label2: "banking_hitl_service :3009",
      icon: "🧑‍⚖️",
      colorClass: "",
    },
  },
  // A2A (agent-to-agent delegation): the Agent can delegate a narrow sensitive
  // task to the A2A Orchestrator (CrewAI crew), which gets PingOne Authorize
  // approval, then nested RFC 8693 token-exchanges to a Specialist Agent that
  // calls narrow tools via the Agent Gateway.
  {
    id: "a2a-orch",
    type: "arch",
    position: { x: 270, y: 440 },
    data: {
      label: "A2A Orchestrator",
      label2: "CrewAI: decide·coordinate·authorize",
      icon: "🧠",
      colorClass: "",
    },
  },
  {
    id: "a2a-specialist",
    type: "arch",
    position: { x: 460, y: 440 },
    data: {
      label: "Specialist Agent",
      label2: "Investment / Records / Purchase",
      icon: "",
      colorClass: "",
    },
  },
];

const B = { stroke: "#cbd5e1", strokeWidth: 1 };
const A = { stroke: "#004687", strokeWidth: 2.5 };
const H = { stroke: "#ca8a04", strokeWidth: 2.5 };
const P = { stroke: "#4CAF50", strokeWidth: 2.5 };

const INITIAL_EDGES = [
  {
    id: "user-chatbot",
    source: "user",
    target: "chatbot",
    style: B,
    label: "Chat",
  },
  { id: "chatbot-agent", source: "chatbot", target: "agent", style: B },
  {
    id: "chatbot-idp",
    source: "chatbot",
    target: "idp-oauth-as",
    style: B,
    label: "PKCE login",
  },
  {
    id: "idp-agent",
    source: "idp-oauth-as",
    target: "agent",
    style: B,
    label: "Token",
  },
  {
    id: "agent-idp",
    source: "agent",
    target: "idp-oauth-as",
    style: B,
    label: "RFC 8693",
  },
  { id: "agent-llm", source: "agent", target: "llm", style: B },
  {
    id: "agent-mcp",
    source: "agent",
    target: "mcp-gw",
    style: B,
    label:
      "MCP call (via gateway when MCP_GATEWAY_HTTP_URL set; else direct WS to :8080)",
  },
  {
    id: "mcp-authz",
    source: "mcp-gw",
    target: "pingauthorize",
    style: B,
    label: "Authz check",
  },
  {
    id: "authz-idp",
    source: "pingauthorize",
    target: "idp-oauth-as",
    style: B,
    label: "Introspect",
  },
  {
    id: "mcp-gw-idp",
    source: "mcp-gw",
    target: "idp-oauth-as",
    style: B,
    label: "RFC 8693",
  },
  {
    id: "mcp-gw-server",
    source: "mcp-gw",
    target: "mcp-server",
    style: B,
    label: "Proxy (OLB tools)",
  },
  {
    id: "mcp-gw-invest",
    source: "mcp-gw",
    target: "mcp-resource-server",
    style: { stroke: "#cbd5e1", strokeWidth: 1, strokeDasharray: "5 3" },
    label: "Proxy (investment tools)",
  },
  {
    id: "mcp-server-api",
    source: "mcp-server",
    target: "banking-api",
    style: B,
    label: "REST call",
  },
  {
    id: "rs-idp",
    source: "banking-api",
    target: "idp-oauth-as",
    style: B,
    label: "Introspect",
  },
  // Phase 267 (LIVE): Gateway forwards show_mortgage to banking_api_resource_server
  // by dropping the user bearer and injecting a service API key + X-User-Sub.
  {
    id: "gw-apikey",
    source: "mcp-gw",
    target: "api-key-backend",
    style: { stroke: "#ca8a04", strokeWidth: 2.5 },
    label: "X-API-Key + X-User-Sub (api_key)",
  },
  // Phase 266 R2: Path B (dual_token) and Path C (oauth_bearer) both reach banking_resource_server.
  {
    id: "gw-rs-identity",
    source: "mcp-gw",
    target: "banking-resource-server",
    style: { stroke: "#0d9488", strokeWidth: 2.5 },
    label: "Bearer + id_token → /identity (dual_token)",
  },
  {
    id: "gw-rs-bankingdata",
    source: "mcp-gw",
    target: "banking-resource-server",
    style: { stroke: "#004687", strokeWidth: 2.5 },
    label: "Bearer → /accounts /transactions (oauth_bearer)",
  },
  {
    id: "rs-lmdb",
    source: "banking-resource-server",
    target: "lmdb-banking-db",
    style: { stroke: "#374151", strokeWidth: 2, strokeDasharray: "4 2" },
    label: "reads accounts + transactions",
  },
  {
    id: "agent-hitl",
    source: "agent",
    target: "hitl",
    style: B,
    label: "Request consent",
  },
  {
    id: "hitl-chatbot",
    source: "hitl",
    target: "chatbot",
    style: B,
    label: "Notify",
  },
  {
    id: "hitl-agent",
    source: "hitl",
    target: "agent",
    style: B,
    label: "Approved ✓",
  },
  // A2A delegation flow (drawn with the prominent blue "active path" style A
  // to distinguish agent-to-agent delegation from the default grey edges).
  {
    id: "agent-a2a-orch",
    source: "agent",
    target: "a2a-orch",
    style: A,
    label: "Delegate? (A2A)",
  },
  {
    id: "a2a-orch-authz",
    source: "a2a-orch",
    target: "pingauthorize",
    style: A,
    label: "Approve act-chain",
  },
  {
    id: "a2a-orch-specialist",
    source: "a2a-orch",
    target: "a2a-specialist",
    style: A,
    label: "RFC 8693 (nested act)",
  },
  {
    id: "a2a-specialist-mcp-gw",
    source: "a2a-specialist",
    target: "mcp-gw",
    style: A,
    label: "Narrow tool call",
  },
];

// ─── Auto-layout (ELK) — positions computed over only the currently-visible
// subgraph, so the layout stays uncrossed as nodes/edges reveal progressively
// instead of using the full ~18-node topology's fixed grid up front. ────────
// Loaded on demand (not at module scope) — elkjs is ~1.4MB and this page
// isn't code-split, so a static import would ship it on every route.
let elkInstancePromise = null;
function getElk() {
  if (!elkInstancePromise) {
    elkInstancePromise = import("elkjs/lib/elk.bundled.js").then(
      (mod) => new mod.default(),
    );
  }
  return elkInstancePromise;
}

const ELK_LAYOUT_OPTIONS = {
  "elk.algorithm": "layered",
  "elk.direction": "RIGHT",
  "elk.spacing.nodeNode": "40",
  "elk.layered.spacing.nodeNodeBetweenLayers": "90",
  "elk.layered.spacing.edgeNodeBetweenLayers": "40",
};
const ELK_NODE_SIZE = { width: 150, height: 90 };

// Diagram starts showing only the natural entry point — everything else
// reveals as a step (canned simulation or a live event) first touches it.
const START_NODES = INITIAL_NODES.filter((n) => n.id === "user");

async function layoutWithElk(nodeList, edgeList) {
  if (nodeList.length === 0) return {};
  const elk = await getElk();
  const nodeIds = new Set(nodeList.map((n) => n.id));
  const graph = {
    id: "root",
    layoutOptions: ELK_LAYOUT_OPTIONS,
    children: nodeList.map((n) => ({ id: n.id, ...ELK_NODE_SIZE })),
    edges: edgeList
      .filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target))
      .map((e) => ({ id: e.id, sources: [e.source], targets: [e.target] })),
  };
  const result = await elk.layout(graph);
  const positions = {};
  (result.children || []).forEach((c) => {
    positions[c.id] = { x: c.x ?? 0, y: c.y ?? 0 };
  });
  return positions;
}

// Pure — which nodes/edges are visible through step index `i`, and their
// accumulated colorClass/stepLabel/badge. A node/edge only appears once some
// step 0..i has touched it (progressive reveal); badges carry forward from
// the most recent step that set them. `baseNodeIds` seeds the always-visible
// starting nodes (the ones shown at rest before Simulate runs) at idle style,
// so a scenario whose early steps don't happen to mention them (e.g. an
// agent-only opening before any user prompt) doesn't make them vanish and
// then pop back — once revealed, a node stays revealed. Exported for
// unit testing.
export function computeStepsThroughIndex(steps, i, baseNodeIds = ["user"]) {
  const nodeMeta = {};
  baseNodeIds.forEach((id) => {
    nodeMeta[id] = { colorClass: "", stepLabel: "" };
  });
  const edgeIdsSoFar = new Set();
  for (let j = 0; j <= i; j++) {
    const s = steps[j];
    const isCurrent = j === i;
    s.nodeIds.forEach((id) => {
      nodeMeta[id] = {
        ...(nodeMeta[id] || {}),
        colorClass: isCurrent ? s.colorClass : "active-prev",
        stepLabel: s.stepLabel,
      };
    });
    Object.entries(s.nodeBadges || {}).forEach(([id, badge]) => {
      nodeMeta[id] = { ...(nodeMeta[id] || {}), badge };
    });
    s.activeEdgeIds.forEach((id) => edgeIdsSoFar.add(id));
  }
  return { nodeMeta, edgeIdsSoFar };
}

// ─── Simulation steps (real code flow) ───────────────────────────────────────
// i4ai reference architecture: Agent CC token → tools/list (denied) → user context → RFC 8693 ① (agent+subject) → tools/call → RFC 8693 ② (gateway) → RFC 8693 ③ (mcp) → RS

const SIMULATE_STEPS = [
  {
    // 1
    nodeIds: ["agent", "idp-oauth-as"],
    colorClass: "active",
    stepLabel: "Agent starts — requests client credentials token",
    description:
      "The AI agent initializes and requests a client credentials (CC) token from PingOne to authenticate itself. This CC token is issued to the agent as a service principal with its own identity (sub=agent1).",
    activeEdgeIds: ["agent-idp"],
    edgeStyle: A,
    nodeBadges: {},
    token: {
      type: "CC Token Request",
      grant_type: "client_credentials",
      client_id: "agent1",
      note: "Agent obtains its own identity token (not user login)",
    },
  },
  {
    // 2
    nodeIds: ["idp-oauth-as"],
    colorClass: "active",
    stepLabel: "PingOne issues CC token to agent",
    description:
      "PingOne issues the client credentials token with aud=agent1 and scope=mcp:invoke. This allows the agent to discover and list available banking tools.",
    activeEdgeIds: [],
    edgeStyle: A,
    nodeBadges: { agent: { aud: "agent1", _changed: ["aud"] } },
    token: {
      type: "CC Token (issued)",
      aud: "agent1",
      scope: "mcp:invoke",
      note: "Agent now has its own identity to call tools",
    },
  },
  {
    // 3
    nodeIds: ["agent", "mcp-gw"],
    colorClass: "active",
    stepLabel:
      "Agent → Agent Gateway: tools/list (agent context only — no user)",
    description:
      "The agent calls the Ping Agent Gateway with tools/list to discover which banking tools are available. At this stage, there is NO user context yet—only the agent's own identity.",
    activeEdgeIds: ["agent-mcp"],
    edgeStyle: A,
    nodeBadges: { "mcp-gw": { aud: "agent1", _changed: ["aud"] } },
    token: {
      type: "Agent Token (tools/list)",
      aud: "agent1",
      scope: "mcp:invoke",
      note: "Tool discovery with ONLY agent context — no user subject token yet",
    },
  },
  {
    // 4
    nodeIds: ["mcp-gw", "pingauthorize"],
    colorClass: "active",
    stepLabel: "Ping Agent Gateway → PingOne Authorization Server: introspect agent token (RFC 7662)",
    description:
      "Before evaluating policy, the Ping Agent Gateway introspects the agent's CC token with PingOne Authorization Server to verify it is active and carries the required scope (mcp:invoke). Introspection happens first — policy decision comes next.",
    activeEdgeIds: ["mcp-authz"],
    edgeStyle: A,
    nodeBadges: {},
    token: {
      type: "Introspection Request",
      token: "agent-cc-token",
      note: "Verify token claims: active ✓  aud ✓  scope ✓",
    },
  },
  {
    // 5
    nodeIds: ["mcp-gw", "pingauthorize"],
    colorClass: "active",
    stepLabel: "Ping Agent Gateway → PingOne Authorization Server: McpRequest policy decision",
    description:
      "With the token confirmed active, the gateway sends the authorization request to PingOne Authorization Server to check if the agent is permitted to discover tools.",
    activeEdgeIds: ["mcp-authz"],
    edgeStyle: A,
    nodeBadges: {},
    token: {
      type: "Authorization Check",
      DecisionContext: "McpRequest",
      ClientId: "agent1",
      note: "Gateway asks: can this agent discover tools?",
    },
  },
  {
    // 6
    nodeIds: ["pingauthorize"],
    colorClass: "active-permit",
    stepLabel: "PingOne Authorization Server: PERMIT — tools list granted for agent",
    description:
      "PingOne Authorization Server validates the agent's token and issues a PERMIT decision. The agent is authorized to discover all available banking tools (get_my_accounts, create_transfer, etc.).",
    activeEdgeIds: [],
    edgeStyle: P,
    nodeBadges: {},
    token: {
      type: "Authorization Decision",
      decision: "✅ PERMIT",
      DecisionContext: "McpRequest",
      ToolListAvailable: "get_my_accounts, create_transfer, ...",
      note: "Agent may discover available tools",
    },
  },
  {
    // 7
    nodeIds: ["user", "agent"],
    colorClass: "active",
    stepLabel: 'User (via chatbot): "Check my balance"',
    description:
      'The user types a natural language request into the chatbot: "Check my balance". The chatbot forwards this to the agent.',
    activeEdgeIds: ["user-agent"],
    edgeStyle: A,
    nodeBadges: {},
    token: null,
  },
  {
    // 8
    nodeIds: ["agent", "llm"],
    colorClass: "active",
    stepLabel: "LLM selects tool: get_my_accounts",
    description:
      "The LLM processes the user's request and selects the appropriate tool to fulfill it: get_my_accounts. The agent now prepares to call this tool.",
    activeEdgeIds: ["agent-llm"],
    edgeStyle: A,
    nodeBadges: {},
    token: null,
  },
  {
    // 9
    nodeIds: ["agent", "mcp-gw"],
    colorClass: "active",
    stepLabel:
      "Agent → Gateway: tools/call get_my_accounts (agent context only)",
    description:
      "The agent calls the Ping Agent Gateway with tools/call to invoke get_my_accounts. However, the call still uses ONLY the agent's CC token (aud=agent1)—there is no user context yet.",
    activeEdgeIds: ["agent-mcp"],
    edgeStyle: A,
    nodeBadges: {},
    token: {
      type: "Tool Call (agent-only)",
      aud: "agent1",
      tool: "get_my_accounts",
      note: "Tool invocation — STILL agent context only (no user subject token)",
    },
  },
  {
    // 10
    nodeIds: ["mcp-gw", "pingauthorize"],
    colorClass: "active",
    stepLabel: "Agent Gateway → PingOne Authorization Server: McpToolCall authorization",
    description:
      "The Ping Agent Gateway sends the tool call request to PingAuthorize to check if the agent is authorized to invoke get_my_accounts.",
    activeEdgeIds: ["mcp-authz"],
    edgeStyle: A,
    nodeBadges: {},
    token: {
      type: "Authorization Check",
      DecisionContext: "McpToolCall",
      ToolName: "get_my_accounts",
      ClientId: "agent1",
      note: "Gateway: can agent call this tool?",
    },
  },
  {
    // 11
    nodeIds: ["pingauthorize"],
    colorClass: "active-error",
    stepLabel: "PingOne Authorization Server: DENY — no subject token, insufficient_scope",
    description:
      'PingOne Authorization Server rejects the tool call. The reason: get_my_accounts requires a user subject token (sub claim) with the "balance" scope. An agent-only token is insufficient—we need proof that the user authorized this action.',
    activeEdgeIds: [],
    edgeStyle: { stroke: "#ef4444", strokeWidth: 2.5 },
    nodeBadges: {},
    token: {
      type: "Authorization Decision",
      decision: "❌ DENY",
      reason: "insufficient_scope: balance, no subject token",
      note: "get_my_accounts requires user subject token (sub claim) — agent-only context is not enough",
    },
  },
  {
    // 12
    nodeIds: ["mcp-gw", "agent"],
    colorClass: "active-error",
    stepLabel: "Agent Gateway → Agent: 403 Forbidden",
    description:
      'The Ping Agent Gateway returns HTTP 403 Forbidden to the agent with the error: "insufficient_scope: balance, no subject token". The agent must now get user consent before proceeding.',
    activeEdgeIds: ["agent-mcp"],
    edgeStyle: { stroke: "#ef4444", strokeWidth: 2.5 },
    nodeBadges: {},
    token: {
      type: "HTTP 403 Forbidden",
      error: "insufficient_scope: balance, no subject token",
      challenge_type: "scope_denied",
    },
  },
  {
    // 13
    nodeIds: ["agent", "user"],
    colorClass: "active",
    stepLabel: "Agent → User (via chatbot): user context required",
    description:
      "The agent informs the user via the chatbot that access to the balance information requires the user's consent. The user will need to authenticate or grant the required scope.",
    activeEdgeIds: ["user-agent"],
    edgeStyle: A,
    nodeBadges: {},
    token: {
      type: "User Context Required",
      resource: "agent1",
      required_scope: "balance",
      note: "Agent informs chatbot: get user to grant scope for the tool",
    },
  },
  {
    // 14
    nodeIds: ["user", "idp-oauth-as"],
    colorClass: "active",
    stepLabel: "Web App → PingOne: request subject token (resource + scope)",
    description:
      'The web application requests a subject token from PingOne for the user (alice@bank.com) scoped to the agent (resource=agent1) with the "balance" scope. This is an RFC 8707 resource-scoped token request.',
    activeEdgeIds: ["user-idp"],
    edgeStyle: A,
    nodeBadges: {},
    token: {
      type: "Token Request",
      grant_type: "authorization_code",
      resource: "agent1",
      scope: "balance",
      note: "RFC 8707: request token scoped to agent resource with specific scope",
    },
  },
  {
    // 15
    nodeIds: ["idp-oauth-as"],
    colorClass: "active",
    stepLabel: "PingOne issues subject token scoped to agent",
    description:
      "PingOne issues a subject token with sub=alice@bank.com, aud=agent1 (the agent is the audience). Platform-level authorization (PingOne app grants) controls which agents can perform token exchange on behalf of this user.",
    activeEdgeIds: [],
    edgeStyle: A,
    nodeBadges: {
      user: {
        aud: "agent1",
        _changed: ["aud"],
      },
    },
    token: {
      type: "Subject Token (issued)",
      sub: "alice@bank.com",
      aud: "agent1",
      scope: "balance",
      note: "Platform-level grants control which agents can exchange this token via RFC 8693",
    },
  },
  {
    // 16
    nodeIds: ["user", "agent"],
    colorClass: "active",
    stepLabel: "Chatbot → Agent: subject token delivered",
    description:
      "The subject token is delivered from the web application to the agent via the chatbot. The agent now has both the subject (user) token and can pair it with its own CC token to create a delegated context.",
    activeEdgeIds: ["user-agent"],
    edgeStyle: A,
    nodeBadges: {
      agent: { aud: "agent1", _changed: [] },
    },
    token: {
      type: "Subject Token (delivered)",
      sub: "alice@bank.com",
      aud: "agent1",
      scope: "balance",
    },
  },
  {
    // 17
    nodeIds: ["agent", "idp-oauth-as"],
    colorClass: "active",
    stepLabel: "Agent → PingOne: RFC 8693 token exchange (actor + subject)",
    description:
      "The agent performs an RFC 8693 token exchange with PingOne. It exchanges the subject token (user) + actor token (agent CC) to obtain a single delegated token (TX token) for the Ping Agent Gateway. The TX token has sub=alice (user), act=agent1 (agent), and aud=mcp-gw (audience).",
    activeEdgeIds: ["agent-idp"],
    edgeStyle: A,
    nodeBadges: {},
    isTokenExchange: true,
    token: {
      type: "Token Exchange Request",
      _type: "exchange",
      _rfcs: ["RFC 8693"],
      grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
      subject_token: "subject-token",
      subject_token_type: "urn:ietf:params:oauth:token-type:access_token",
      actor_token: "agent-cc-token",
      actor_token_type: "urn:ietf:params:oauth:token-type:access_token",
      resource: "agent1",
      note: "Agent exchanges subject (user) + actor (agent CC) → TX token for mcp-gw",
    },
    tokenOut: {
      type: "TX Token (issued)",
      _type: "oauth",
      _rfcs: ["RFC 8693"],
      sub: "alice@bank.com",
      act: "{sub: agent1}",
      aud: "mcp-gw",
      scope: "balance",
      note: "Delegated token: sub=user, act=agent, narrowed to mcp-gw audience",
    },
  },
  {
    // 18
    nodeIds: ["agent", "mcp-gw"],
    colorClass: "active",
    stepLabel: "Agent → Gateway: tools/call with TX token",
    description:
      "The agent retries the tools/call request, but this time with the TX token. The TX token proves both user identity (sub=alice) and agent delegation (act=agent1), scoped to the Ping Agent Gateway (aud=mcp-gw).",
    activeEdgeIds: ["agent-mcp"],
    edgeStyle: A,
    nodeBadges: {
      "mcp-gw": {
        sub: "alice@bank.com",
        act: "{sub: agent1}",
        aud: "mcp-gw",
        _changed: ["sub", "act", "aud"],
      },
    },
    token: {
      type: "TX Token (inbound)",
      sub: "alice@bank.com",
      act: "{sub: agent1}",
      aud: "mcp-gw",
      scope: "balance",
      tool: "get_my_accounts",
    },
  },
  {
    // 19
    nodeIds: ["mcp-gw", "pingauthorize"],
    colorClass: "active",
    stepLabel: "Gateway → PingOne Authorization Server: introspect TX token (RFC 7662)",
    description:
      "Before evaluating policy, the Ping Agent Gateway calls PingOne Authorization Server to introspect the TX token — verifying it is active, not expired, and carries the expected claims (sub, act, aud, scope). Introspection result is cached for 5s in production.",
    activeEdgeIds: ["mcp-authz"],
    edgeStyle: A,
    nodeBadges: {},
    token: {
      type: "Introspection Request",
      token: "tx-token",
      note: "Verify: active ✓  sub=alice ✓  act=agent1 ✓  aud=mcp-gw ✓  scope=balance ✓",
    },
  },
  {
    // 20
    nodeIds: ["mcp-gw", "pingauthorize"],
    colorClass: "active",
    stepLabel: "Gateway → PingOne Authorization Server: McpToolCall policy decision",
    description:
      "With the token confirmed active, the gateway sends the authorization request to PingOne Authorization Server. The decision context includes: sub=alice (the user), act=agent1 (delegated authority), and the tool name (get_my_accounts).",
    activeEdgeIds: ["mcp-authz"],
    edgeStyle: A,
    nodeBadges: {},
    token: {
      type: "Authorization Check",
      DecisionContext: "McpToolCall",
      ClientId: "alice@bank.com",
      ActClientId: "agent1",
      ToolName: "get_my_accounts",
      TokenAudience: "mcp-gw",
      TokenScopes: "balance",
    },
  },
  {
    // 21
    nodeIds: ["pingauthorize"],
    colorClass: "active-permit",
    stepLabel: "PingOne Authorization Server validates TX token → PERMIT",
    description:
      "This time, PingOne Authorization Server approves the request. All conditions are met: the user (alice) has authorized the scope (balance), the agent (agent1) is a trusted delegated caller, and the scope matches the tool requirements. The PERMIT is issued.",
    activeEdgeIds: [],
    edgeStyle: P,
    nodeBadges: {},
    token: {
      type: "Authorization Decision",
      decision: "✅ PERMIT",
      DecisionContext: "McpToolCall",
      ToolName: "get_my_accounts",
      note: "Token valid: sub=user ✓  act=agent ✓  aud=mcp-gw ✓  scope=balance ✓",
    },
  },
  {
    // 22
    nodeIds: ["mcp-gw", "idp-oauth-as"],
    colorClass: "active",
    stepLabel:
      "Ping Agent Gateway → PingOne: RFC 8693 Exchange #3 — narrow to backend audience",
    description:
      "Before forwarding to the MCP Server, the gateway performs its own RFC 8693 exchange — it trades the mcp-gw-audienced TX token for a new token scoped to the MCP Server's real resource URI (mcpserver.ping.demo). This is a real third exchange hop, not a passthrough.",
    activeEdgeIds: ["mcp-gw-idp"],
    edgeStyle: A,
    nodeBadges: {},
    isTokenExchange: true,
    token: {
      type: "Token Exchange Request",
      _type: "exchange",
      _rfcs: ["RFC 8693"],
      subject_token_aud: "mcp-gw",
      requested_aud: "mcpserver.ping.demo",
      sub: "alice@bank.com",
      act: "{sub: agent1}",
      note: "Gateway is the client of this exchange — narrows audience before forwarding",
    },
    tokenOut: {
      type: "Backend-Scoped Token (issued)",
      _type: "exchange",
      _rfcs: ["RFC 8693"],
      aud: "mcpserver.ping.demo",
      sub: "alice@bank.com",
      act: "{sub: agent1}",
      scope: "balance",
      note: "New token narrowed to the MCP Server's real resource URI",
    },
  },
  {
    // 23
    nodeIds: ["mcp-gw", "mcp-server"],
    colorClass: "active",
    stepLabel: "Ping Agent Gateway → MCP Server: forward backend-scoped token",
    description:
      "The gateway forwards the newly-exchanged token (aud=mcpserver.ping.demo) to the MCP Server.",
    activeEdgeIds: ["mcp-gw-server"],
    edgeStyle: A,
    nodeBadges: {
      "mcp-server": {
        sub: "alice@bank.com",
        act: "{sub: agent1}",
        aud: "mcpserver.ping.demo",
        _changed: ["aud"],
      },
    },
    token: {
      type: "Backend-Scoped Token",
      _type: "oauth",
      _rfcs: ["RFC 8693"],
      sub: "alice@bank.com",
      act: "{sub: agent1}",
      aud: "mcpserver.ping.demo",
      scope: "balance",
      note: "MCP Server validates aud=mcpserver.ping.demo — this token would be rejected at the gateway itself",
    },
  },
  {
    // 24
    nodeIds: ["mcp-server", "banking-api"],
    colorClass: "active",
    stepLabel: "MCP Server executes tool → calls Banking API",
    description:
      "The MCP Server executes get_my_accounts. It calls the Banking API using the exchanged token (aud=mcpserver.ping.demo, sub=alice, act=agent1). The delegation chain is preserved end-to-end.",
    activeEdgeIds: ["mcp-server-api"],
    edgeStyle: A,
    nodeBadges: {
      "banking-api": {
        sub: "alice@bank.com",
        act: "{sub: agent1}",
        aud: "mcpserver.ping.demo",
        _changed: [],
      },
    },
    token: {
      type: "TX Token (Banking API call)",
      sub: "alice@bank.com",
      act: "{sub: agent1}",
      aud: "mcpserver.ping.demo",
      scope: "balance",
      endpoint: "GET /accounts",
    },
  },
  {
    // 25
    nodeIds: ["banking-api"],
    colorClass: "active-permit",
    stepLabel: "Banking API validates token, returns account data",
    description:
      "The Banking API validates the token (sub=alice, act=agent1, aud=mcpserver.ping.demo, scope=balance) and returns the account data. The entire delegation chain has been verified: the user (alice) authorized the access, the agent (agent1) is a trusted delegated caller.",
    activeEdgeIds: [],
    edgeStyle: P,
    nodeBadges: {},
    token: {
      type: "API Response",
      status: "200 OK",
      data: '{ accountId: "CHK-001", balance: 12450.00 }',
      note: "Token valid: user identity (sub) ✓  agent delegation (act) ✓  audience (aud) ✓  scope ✓",
    },
  },
  {
    // 25
    nodeIds: ["banking-api", "mcp-server", "agent", "user"],
    colorClass: "active",
    stepLabel: "Results flow back: Banking API → MCP → Gateway → Agent → Chatbot → User",
    description:
      'The account data flows back through the chain: Banking API → MCP Server → Ping Agent Gateway → Agent → Chatbot, and finally to the user. The chatbot displays the results in natural language: "Your checking account balance is $12,450.00."',
    activeEdgeIds: [],
    edgeStyle: A,
    nodeBadges: {},
    token: null,
  },
];

// ─── Aud trail ────────────────────────────────────────────────────────────────

const AUD_HOPS = [
  { icon: "", label: "CC Token", aud: "agent1", activeFrom: 0, activeTo: 5 },
  {
    icon: "",
    label: "Subject Token",
    aud: "agent1",
    activeFrom: 13,
    activeTo: 15,
  },
  {
    icon: "",
    label: "RFC 8693 ①",
    aud: "(exchange)",
    isExchange: true,
    activeFrom: 16,
    activeTo: 16,
  },
  {
    icon: "",
    label: "TX Token",
    aud: "mcp-gw",
    act: "agent1",
    activeFrom: 17,
    activeTo: 25,
  },
];

const SCENARIO_STEPS_FLOW = {
  "id-token": [
    {
      nodeIds: ["user", "idp-oauth-as"],
      colorClass: "active",
      stepLabel: "OAuth 2.0 PKCE — code request",
      activeEdgeIds: ["user-idp"],
      edgeStyle: A,
      nodeBadges: {},
      token: {
        type: "Authorization Code Request",
        _type: "oauth",
        _rfcs: ["RFC 6749", "RFC 7636"],
        response_type: "code",
        scope: "openid profile read write",
        code_challenge_method: "S256",
        note: "PKCE: code_verifier stored client-side; code_challenge sent — prevents auth-code interception",
      },
    },
    {
      nodeIds: ["idp-oauth-as", "agent"],
      colorClass: "active",
      stepLabel: "ID Token issued — UI only, never sent to APIs",
      activeEdgeIds: ["idp-agent"],
      edgeStyle: A,
      nodeBadges: { agent: { aud: "banking-app-client", _changed: ["aud"] } },
      token: {
        type: "ID Token (OIDC)",
        _type: "idtoken",
        _rfcs: ["RFC 7519", "OIDC Core"],
        iss: "https://your-idp.example.com",
        sub: "alice@bank.com",
        aud: "banking-app-client",
        email: "alice@bank.com",
        name: "Alice Smith",
        note: "ID token aud is ONLY the client — never sent to APIs, MCP tools, or backend services",
      },
    },
    {
      nodeIds: ["idp-oauth-as", "agent"],
      colorClass: "active",
      stepLabel: "Access Token issued — scoped for delegation",
      activeEdgeIds: ["idp-agent"],
      edgeStyle: A,
      nodeBadges: {
        agent: {
          aud: "banking-app-client",
          _changed: ["aud"],
        },
      },
      token: {
        type: "Access Token",
        _type: "oauth",
        _rfcs: ["RFC 6749", "RFC 7519", "RFC 9068"],
        aud: "banking-app-client",
        sub: "alice@bank.com",
        scope: "openid profile read write",
        note: "Platform-level grants authorize the BFF to perform RFC 8693 exchange on behalf of this user",
      },
    },
    {
      nodeIds: ["agent"],
      colorClass: "active",
      stepLabel: "BFF stores token — ID token stays in browser",
      activeEdgeIds: [],
      edgeStyle: A,
      nodeBadges: {},
      token: {
        type: "Token Storage",
        _type: "mcp",
        id_token_location: "Browser memory only",
        access_token_location: "BFF server-side session",
        note: "ID token: never leaves browser. Access token: BFF holds it — never exposed to frontend",
      },
    },
  ],
  "user-token": [
    {
      nodeIds: ["agent", "idp-oauth-as"],
      colorClass: "active",
      stepLabel: "RFC 8693 Exchange #1 — user token IN",
      activeEdgeIds: ["agent-idp"],
      edgeStyle: A,
      nodeBadges: {},
      isTokenExchange: true,
      token: {
        type: "User Access Token (subject)",
        _type: "oauth",
        _rfcs: ["RFC 8693"],
        aud: "banking-app-client",
        sub: "alice@bank.com",
        scope: "openid profile read write",
        may_act: '{ "client_id": "bff-client-id" }',
        note: "BFF sends this as subject_token → IdP validates may_act before issuing delegation token",
      },
      tokenOut: {
        type: "Delegated Token (issued)",
        _type: "exchange",
        _rfcs: ["RFC 8693"],
        aud: "mcp-gateway",
        sub: "alice@bank.com",
        scope: "read write",
        act: '{ "sub": "agent-client-id" }',
        note: "aud narrowed to mcp-gateway — act chain added identifying the acting agent",
      },
    },
    {
      nodeIds: ["agent", "mcp-gw"],
      colorClass: "active",
      stepLabel: "Delegation token arrives at Ping Agent Gateway",
      activeEdgeIds: ["agent-mcp"],
      edgeStyle: A,
      nodeBadges: {
        "mcp-gw": {
          aud: "mcp-gateway",
          act: '{"sub":"agent-client-id"}',
          _changed: ["aud", "act"],
        },
      },
      token: {
        type: "Delegated Token (inbound)",
        _type: "oauth",
        _rfcs: ["RFC 8693", "RFC 6750"],
        aud: "mcp-gateway",
        sub: "alice@bank.com",
        scope: "read write",
        act: '{ "sub": "agent-client-id" }',
        note: "Gateway validates: aud=mcp-gateway ✓  sub≠∅ ✓  act.sub≠∅ ✓  D-05 anti-bypass ✓",
      },
    },
    {
      nodeIds: ["mcp-gw", "idp-oauth-as"],
      colorClass: "active",
      stepLabel: "RFC 8693 Exchange #3 — gateway narrows to backend audience",
      activeEdgeIds: ["mcp-gw-idp"],
      edgeStyle: A,
      nodeBadges: {},
      isTokenExchange: true,
      token: {
        type: "Token Exchange Request",
        _type: "exchange",
        _rfcs: ["RFC 8693"],
        subject_token_aud: "mcp-gateway",
        requested_aud: "mcpserver.ping.demo",
        sub: "alice@bank.com",
        act: '{ "sub": "agent-client-id" }',
        note: "Gateway is the client of this exchange — this is a real third exchange, not a passthrough",
      },
      tokenOut: {
        type: "Backend-Scoped Token (issued)",
        _type: "exchange",
        _rfcs: ["RFC 8693"],
        aud: "mcpserver.ping.demo",
        sub: "alice@bank.com",
        act: '{ "sub": "agent-client-id" }',
        scope: "read",
        note: "New token narrowed to the MCP Server's real resource URI",
      },
    },
    {
      nodeIds: ["mcp-gw", "mcp-server"],
      colorClass: "active",
      stepLabel: "Ping Agent Gateway forwards backend-scoped token → MCP Server",
      activeEdgeIds: ["mcp-gw-server"],
      edgeStyle: A,
      nodeBadges: {
        "mcp-server": {
          aud: "mcpserver.ping.demo",
          act: '{"sub":"agent-client-id"}',
          _changed: ["aud"],
        },
      },
      token: {
        type: "Backend-Scoped Token",
        _type: "oauth",
        _rfcs: ["RFC 8693"],
        aud: "mcpserver.ping.demo",
        scope: "read",
        sub: "alice@bank.com",
        act: '{ "sub": "agent-client-id" }',
        note: "MCP Server validates aud=mcpserver.ping.demo — this token would be rejected at the gateway itself",
      },
    },
  ],
  "get-accounts": [
    {
      nodeIds: ["agent", "llm"],
      colorClass: "active",
      stepLabel: "LLM decides: get_my_accounts",
      activeEdgeIds: ["agent-llm"],
      edgeStyle: A,
      nodeBadges: {},
      token: null,
    },
    {
      nodeIds: ["mcp-gw", "pingauthorize"],
      colorClass: "active",
      stepLabel: "PingOne Authorization Server: McpRequest",
      activeEdgeIds: ["mcp-authz"],
      edgeStyle: A,
      nodeBadges: {},
      token: {
        type: "PingOne Authorization Server Request",
        _type: "mcp",
        DecisionContext: "McpRequest",
        ClientId: "alice@bank.com",
        ActClientId: "agent-client-id",
        TokenScopes: "read write",
        TokenAudience: "mcp-gateway",
      },
    },
    {
      nodeIds: ["pingauthorize"],
      colorClass: "active-permit",
      stepLabel: "PERMIT — tools discovery allowed",
      activeEdgeIds: [],
      edgeStyle: P,
      nodeBadges: {},
      token: {
        type: "Authorization Decision",
        _type: "permit",
        decision: "✅ PERMIT",
        DecisionContext: "McpRequest",
      },
    },
    {
      nodeIds: ["mcp-gw", "pingauthorize"],
      colorClass: "active",
      stepLabel: "PingOne Authorization Server: McpToolCall — get_my_accounts",
      activeEdgeIds: ["mcp-authz"],
      edgeStyle: A,
      nodeBadges: {},
      token: {
        type: "PingOne Authorization Server Request",
        _type: "mcp",
        DecisionContext: "McpToolCall",
        ClientId: "alice@bank.com",
        ActClientId: "agent-client-id",
        ToolName: "get_my_accounts",
        TokenScopes: "read",
        TokenAudience: "mcp-gateway",
      },
    },
    {
      nodeIds: ["pingauthorize"],
      colorClass: "active-permit",
      stepLabel: "PERMIT — read sufficient",
      activeEdgeIds: [],
      edgeStyle: P,
      nodeBadges: {},
      token: {
        type: "Authorization Decision",
        _type: "permit",
        decision: "✅ PERMIT",
        DecisionContext: "McpToolCall",
        ToolName: "get_my_accounts",
      },
    },
    {
      nodeIds: ["mcp-gw", "idp-oauth-as"],
      colorClass: "active",
      stepLabel: "RFC 8693 Exchange #3 — gateway narrows to backend audience",
      activeEdgeIds: ["mcp-gw-idp"],
      edgeStyle: A,
      nodeBadges: {},
      isTokenExchange: true,
      token: {
        type: "Token Exchange Request",
        _type: "exchange",
        _rfcs: ["RFC 8693"],
        subject_token_aud: "mcp-gateway",
        requested_aud: "mcpserver.ping.demo",
        note: "Gateway is the client of this exchange — this is a real third exchange, not a passthrough",
      },
      tokenOut: {
        type: "Backend-Scoped Token (issued)",
        _type: "exchange",
        _rfcs: ["RFC 8693"],
        aud: "mcpserver.ping.demo",
        scope: "read",
        note: "New token narrowed to the MCP Server's real resource URI",
      },
    },
    {
      nodeIds: ["mcp-server", "banking-api"],
      colorClass: "active",
      stepLabel: "Banking API returns accounts — 200 OK",
      activeEdgeIds: ["mcp-server-api"],
      edgeStyle: A,
      nodeBadges: {
        "banking-api": { aud: "mcpserver.ping.demo", _changed: ["aud"] },
      },
      token: {
        type: "API Response",
        _type: "mcp",
        status: "200 OK",
        data: '[{ "accountId":"ACC-001","balance":12450.00 },...]',
        scope_used: "read",
      },
    },
  ],
  withdrawal: [
    {
      nodeIds: ["agent", "llm"],
      colorClass: "active",
      stepLabel: "LLM decides: create_transfer",
      activeEdgeIds: ["agent-llm"],
      edgeStyle: A,
      nodeBadges: {},
      token: null,
    },
    {
      nodeIds: ["mcp-gw", "pingauthorize"],
      colorClass: "active",
      stepLabel: "PingOne Authorization Server: create_transfer — high-risk",
      activeEdgeIds: ["mcp-authz"],
      edgeStyle: A,
      nodeBadges: {},
      token: {
        type: "PingOne Authorization Server Request",
        _type: "mcp",
        DecisionContext: "McpToolCall",
        ClientId: "alice@bank.com",
        ActClientId: "agent-client-id",
        ToolName: "create_transfer",
        TokenScopes: "write",
        TokenAudience: "mcp-gateway",
        note: "Write operation triggers high-risk policy evaluation",
      },
    },
    {
      nodeIds: ["pingauthorize"],
      colorClass: "active-hitl",
      stepLabel: "PERMIT + HITL_CONSENT obligation",
      isHitl: true,
      activeEdgeIds: [],
      edgeStyle: H,
      nodeBadges: {},
      token: {
        type: "Authorization Decision",
        _type: "hitl",
        decision: "✅ PERMIT (obligation: HITL_CONSENT)",
        DecisionContext: "McpToolCall",
        ToolName: "create_transfer",
        note: "PingOne Authorization Server returns PERMIT with an HITL_CONSENT obligation — not a bare INDETERMINATE (that now means fail-closed DENY). The obligation is what routes this to human approval before execution.",
      },
    },
    {
      nodeIds: ["agent", "hitl"],
      colorClass: "active-hitl",
      stepLabel: "HITL — awaiting human approval",
      isHitl: true,
      activeEdgeIds: ["agent-hitl"],
      edgeStyle: H,
      nodeBadges: {},
      token: {
        type: "HITL Approval Request",
        _type: "hitl",
        trigger: "PingOne Authorization Server obligation: HITL_CONSENT",
        action: "create_transfer $750 → savings",
        risk_score: "HIGH",
        status: "⏳ Awaiting user approval…",
      },
    },
    {
      nodeIds: ["hitl", "agent"],
      colorClass: "active-permit",
      stepLabel: "User approved ✓ — agent continues",
      isHitl: true,
      activeEdgeIds: ["hitl-agent"],
      edgeStyle: P,
      nodeBadges: {},
      token: {
        type: "HITL Response",
        _type: "permit",
        decision: "✅ APPROVED",
        approved_by: "alice@bank.com",
        action: "create_transfer $750 → savings",
      },
    },
    {
      nodeIds: ["mcp-server", "banking-api"],
      colorClass: "active",
      stepLabel: "Banking API executes transfer — 200 OK",
      activeEdgeIds: ["mcp-server-api"],
      edgeStyle: A,
      nodeBadges: { "banking-api": { aud: "banking-api", _changed: ["aud"] } },
      token: {
        type: "API Response",
        _type: "mcp",
        status: "200 OK",
        transfer_id: "TXN-2024-001",
        amount: "$750",
        from: "CHK-001",
        to: "SAV-002",
        scope_used: "write",
      },
    },
  ],
  "bad-scope": [
    {
      nodeIds: ["agent", "mcp-gw"],
      colorClass: "active",
      stepLabel: "Agent attempts write with read-only token",
      activeEdgeIds: ["agent-mcp"],
      edgeStyle: A,
      nodeBadges: {
        "mcp-gw": { aud: "mcp-gateway", act: '{"sub":"agent-client-id"}' },
      },
      token: {
        type: "Agent Token (read-only)",
        _type: "oauth",
        _rfcs: ["RFC 6750"],
        aud: "mcp-gateway",
        sub: "alice@bank.com",
        scope: "read",
        act: '{ "sub": "agent-client-id" }',
        note: "⚠️ Token scope is read only — create_transfer requires write",
      },
    },
    {
      nodeIds: ["mcp-gw", "pingauthorize"],
      colorClass: "active",
      stepLabel: "PingOne Authorization Server: create_transfer — insufficient scope",
      activeEdgeIds: ["mcp-authz"],
      edgeStyle: A,
      nodeBadges: {},
      token: {
        type: "PingOne Authorization Server Request",
        _type: "mcp",
        DecisionContext: "McpToolCall",
        ClientId: "alice@bank.com",
        ActClientId: "agent-client-id",
        ToolName: "create_transfer",
        TokenScopes: "read",
        TokenAudience: "mcp-gateway",
        note: "❌ write required — policy will DENY this request",
      },
    },
    {
      nodeIds: ["pingauthorize"],
      colorClass: "active-error",
      stepLabel: "DENY — insufficient scope",
      activeEdgeIds: [],
      edgeStyle: { stroke: "#ef4444", strokeWidth: 2.5 },
      nodeBadges: {},
      token: {
        type: "Authorization Decision",
        _type: "error",
        decision: "❌ DENY",
        DecisionContext: "McpToolCall",
        ToolName: "create_transfer",
        reason: "insufficient_scope: write required",
      },
    },
    {
      nodeIds: ["mcp-gw", "agent"],
      colorClass: "active-error",
      stepLabel: "403 Forbidden — propagated to agent",
      activeEdgeIds: ["agent-mcp"],
      edgeStyle: { stroke: "#ef4444", strokeWidth: 2.5 },
      nodeBadges: {},
      token: {
        type: "HTTP 403 Forbidden",
        _type: "error",
        status: "403 Forbidden",
        error: "insufficient_scope",
        error_description: "write scope required for create_transfer",
        "WWW-Authenticate": 'Bearer scope="write"',
        note: "Ping Agent Gateway converts DENY to 403 — agent must NOT retry with same token",
      },
    },
    {
      nodeIds: ["agent"],
      colorClass: "active-error",
      stepLabel: "Agent gracefully handles 403",
      activeEdgeIds: [],
      edgeStyle: A,
      nodeBadges: {},
      token: {
        type: "Agent Error Response",
        _type: "error",
        http_status: "403",
        user_message: "Unable to complete transfer — insufficient permissions",
        recovery:
          "Re-authenticate with write scope to enable transfers",
        note: "Graceful degradation: surface clear message, request scope upgrade, never silent-fail",
      },
    },
  ],
  "no-subject-token": [
    {
      nodeIds: ["agent", "mcp-gw"],
      colorClass: "active",
      stepLabel:
        "Agent attempts tools/call (agent context only — no subject token)",
      activeEdgeIds: ["agent-mcp"],
      edgeStyle: A,
      nodeBadges: { "mcp-gw": { aud: "agent1", _changed: ["aud"] } },
      token: {
        type: "Tool Call (agent-only)",
        aud: "agent1",
        tool: "get_my_accounts",
        note: "Agent context only — subject token not yet available",
      },
    },
    {
      nodeIds: ["mcp-gw", "pingauthorize"],
      colorClass: "active",
      stepLabel: "Gateway → PingOne Authorization Server: authorization check",
      activeEdgeIds: ["mcp-authz"],
      edgeStyle: A,
      nodeBadges: {},
      token: {
        type: "Authorization Check",
        DecisionContext: "McpToolCall",
        ToolName: "get_my_accounts",
        ClientId: "agent1",
        note: "Can agent call this tool?",
      },
    },
    {
      nodeIds: ["pingauthorize"],
      colorClass: "active-error",
      stepLabel: "PingOne Authorization Server: DENY — no subject token required",
      activeEdgeIds: [],
      edgeStyle: { stroke: "#ef4444", strokeWidth: 2.5 },
      nodeBadges: {},
      token: {
        type: "Authorization Decision",
        decision: "❌ DENY",
        reason: "insufficient_scope: balance, no subject token",
        challenge_type: "scope_denied",
        note: "Tool requires user identity (sub) — agent-only not permitted",
      },
    },
    {
      nodeIds: ["mcp-gw", "agent"],
      colorClass: "active-error",
      stepLabel: "Agent Gateway → Agent: 403 Forbidden",
      activeEdgeIds: ["agent-mcp"],
      edgeStyle: { stroke: "#ef4444", strokeWidth: 2.5 },
      nodeBadges: {},
      token: {
        type: "HTTP 403 Forbidden",
        error: "insufficient_scope: balance, no subject token",
        challenge_type: "scope_denied",
      },
    },
    {
      nodeIds: ["agent", "user"],
      colorClass: "active",
      stepLabel: "Agent → User: user context required (scope: balance)",
      activeEdgeIds: ["user-agent"],
      edgeStyle: A,
      nodeBadges: {},
      token: {
        type: "User Context Required",
        resource: "agent1",
        required_scope: "balance",
        note: "Agent tells UI: request user to grant scope for tool",
      },
    },
    {
      nodeIds: ["user", "idp-oauth-as"],
      colorClass: "active",
      stepLabel: "Web App → PingOne: request subject token (resource + scope)",
      activeEdgeIds: ["user-idp"],
      edgeStyle: A,
      nodeBadges: {},
      token: {
        type: "Token Request",
        grant_type: "authorization_code",
        resource: "agent1",
        scope: "balance",
        note: "RFC 8707: narrow token to agent resource + balance scope",
      },
    },
    {
      nodeIds: ["idp-oauth-as"],
      colorClass: "active",
      stepLabel: "PingOne issues subject token with may_act",
      activeEdgeIds: [],
      edgeStyle: A,
      nodeBadges: {
        user: {
          aud: "agent1",
          may_act: "{sub: agent1}",
          _changed: ["aud", "may_act"],
        },
      },
      token: {
        type: "Subject Token (issued)",
        sub: "alice@bank.com",
        aud: "agent1",
        may_act: "{sub: agent1}",
        scope: "balance",
        note: "may_act pre-authorizes agent to act on behalf of user",
      },
    },
  ],

  // ─── Phase 266 R2: 3 credential-path scenarios ──────────────────────────────

  "api-key-path": [
    {
      nodeIds: ["user", "chatbot"],
      colorClass: "active",
      stepLabel: 'User sends prompt: "show mortgage data"',
      description:
        "User triggers the API-key demo prompt. The chat agent routes this to the gateway tool show_mortgage (api_key disposition).",
      activeEdgeIds: ["user-chatbot"],
      edgeStyle: A,
      nodeBadges: {},
      token: {
        type: "NL prompt",
        text: "show mortgage data",
        note: "Routes to api_key disposition at the gateway",
      },
    },
    {
      nodeIds: ["agent", "mcp-gw"],
      colorClass: "active",
      stepLabel:
        "Agent → Gateway: tools/call show_mortgage (with user OAuth bearer)",
      description:
        "The agent forwards the tool call to the MCP gateway carrying the user OAuth bearer.",
      activeEdgeIds: ["agent-mcp"],
      edgeStyle: A,
      nodeBadges: {
        "mcp-gw": {
          credentialPath: "oauth_bearer (incoming)",
          _changed: ["credentialPath"],
        },
      },
      token: {
        type: "OAuth Bearer (inbound)",
        credentialPath: "oauth_bearer",
        tool: "show_mortgage",
      },
    },
    {
      nodeIds: ["mcp-gw", "api-key-backend"],
      colorClass: "active-permit",
      stepLabel:
        "Gateway enforces mortgage:read, then swaps the OAuth bearer for the service API key and calls banking_api_resource_server",
      description:
        "API-KEY PATH: the gateway first verifies the user bearer carries mortgage:read (local scope gate — consent before the swap). It then drops the OAuth bearer and attaches the service API key + X-User-Sub, and calls banking_api_resource_server :8082 GET /mortgage. The backend never sees a user token.",
      activeEdgeIds: ["gw-apikey"],
      edgeStyle: { stroke: "#ca8a04", strokeWidth: 2.5 },
      nodeBadges: {
        "api-key-backend": {
          credentialPath: "api_key",
          _changed: ["credentialPath"],
        },
      },
      token: {
        type: "API Key (X-API-Key + X-User-Sub)",
        credentialPath: "api_key",
        note: "banking_api_resource_server returns the mortgage record",
      },
    },
    {
      nodeIds: ["chatbot"],
      colorClass: "active",
      stepLabel: "SPA navigates to /path/mortgage with the mortgage payload",
      description:
        "The gateway returned the mortgage record plus _meta.maskedApiKey (last-4 only). The SPA routes the user to the Mortgage page and renders the data + the credential-swap explanation.",
      activeEdgeIds: ["hitl-chatbot"],
      edgeStyle: A,
      nodeBadges: {},
      token: {
        type: "SPA route",
        destination: "/path/mortgage",
        credentialPath: "api_key",
      },
    },
  ],

  "dual-token-path": [
    {
      nodeIds: ["user", "chatbot"],
      colorClass: "active",
      stepLabel: 'User sends prompt: "show my profile card"',
      description:
        "User triggers the dual-token demo prompt. The chat agent will route this to the gateway tool user_profile_card.",
      activeEdgeIds: ["user-chatbot"],
      edgeStyle: A,
      nodeBadges: {},
      token: {
        type: "NL prompt",
        text: "show my profile card",
        note: "Routes to dual_token disposition",
      },
    },
    {
      nodeIds: ["agent", "mcp-gw"],
      colorClass: "active",
      stepLabel: "Agent → Gateway: tools/call user_profile_card",
      description:
        "The agent forwards the tool call with the user OAuth bearer. The gateway will fetch the id_token from the BFF session and forward BOTH to banking_resource_server /identity.",
      activeEdgeIds: ["agent-mcp"],
      edgeStyle: A,
      nodeBadges: {
        "mcp-gw": {
          credentialPath: "oauth_bearer (incoming)",
          _changed: ["credentialPath"],
        },
      },
      token: {
        type: "OAuth Bearer (inbound)",
        credentialPath: "oauth_bearer",
        tool: "user_profile_card",
      },
    },
    {
      nodeIds: ["mcp-gw", "banking-resource-server"],
      colorClass: "active-permit",
      stepLabel:
        "Gateway POSTs bearer + id_token to banking_resource_server /identity",
      description:
        "DUAL-TOKEN PATH: /api/resource-server/identity. Gateway sends an HTTP POST carrying a JSON-RPC envelope: bearer in Authorization header, id_token in params.idToken (body). banking_resource_server validates the bearer via authenticateToken; verifies the id_token sub matches the bearer sub; decodes both tokens server-side; returns sanitized claims only.",
      activeEdgeIds: ["gw-rs-identity"],
      edgeStyle: { stroke: "#0d9488", strokeWidth: 2.5 },
      nodeBadges: {
        "banking-resource-server": {
          credentialPath: "dual_token",
          route: "/identity",
          _changed: ["credentialPath", "route"],
        },
      },
      token: {
        type: "Bearer + id_token",
        credentialPath: "dual_token",
        route: "/identity",
        note: "Claims only returned; no raw JWT crosses any boundary",
      },
    },
    {
      nodeIds: ["chatbot"],
      colorClass: "active",
      stepLabel: "SPA navigates to /path/dualtoken-info (teal info page)",
      description:
        "AccessIdTokenPathPage fetches /api/resource-server/identity directly via bffAxios; renders decoded access-token + id-token claims side-by-side.",
      activeEdgeIds: ["hitl-chatbot"],
      edgeStyle: A,
      nodeBadges: {},
      token: {
        type: "SPA route",
        destination: "/path/dualtoken-info",
        credentialPath: "dual_token",
      },
    },
  ],

  "oauth-bearer-path": [
    {
      nodeIds: ["user", "chatbot"],
      colorClass: "active",
      stepLabel: 'User sends prompt: "show my accounts"',
      description:
        "User triggers the standard banking-data prompt; routed to gateway tool demo_show_accounts.",
      activeEdgeIds: ["user-chatbot"],
      edgeStyle: A,
      nodeBadges: {},
      token: {
        type: "NL prompt",
        text: "show my accounts",
        note: "Routes to oauth_bearer disposition",
      },
    },
    {
      nodeIds: ["mcp-gw"],
      colorClass: "active",
      stepLabel: "Gateway: forward inbound bearer unchanged — no RFC 8693 exchange",
      description:
        "OAuth Bearer Path does no token exchange at all: the gateway forwards the original inbound TX bearer unchanged to banking_resource_server. No id_token, no re-exchange — the simplest of the three credential paths.",
      activeEdgeIds: [],
      edgeStyle: A,
      nodeBadges: {
        "mcp-gw": {
          credentialPath: "oauth_bearer",
          _changed: ["credentialPath"],
        },
      },
      token: {
        type: "Inbound Bearer (unchanged)",
        credentialPath: "oauth_bearer",
      },
    },
    {
      nodeIds: ["mcp-gw", "banking-resource-server"],
      colorClass: "active-permit",
      stepLabel:
        "Gateway → banking_resource_server /accounts (or /transactions)",
      description:
        "OAUTH BEARER PATH: /api/resource-server/accounts | /transactions. Gateway forwards the exchanged bearer to the LMDB-backed account/transaction route. authenticateToken validates the bearer; route queries LMDB via bankingDb.getAccountsByUserId.",
      activeEdgeIds: ["gw-rs-bankingdata", "rs-lmdb"],
      edgeStyle: { stroke: "#004687", strokeWidth: 2.5 },
      nodeBadges: {
        "banking-resource-server": {
          credentialPath: "oauth_bearer",
          route: "/accounts",
          _changed: ["route"],
        },
      },
      token: {
        type: "Bearer",
        credentialPath: "oauth_bearer",
        route: "/accounts",
      },
    },
  ],
};

function AudTrail({ stepIndex }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        flexWrap: "wrap",
        background: "#f1f5f9",
        border: "1px solid #cbd5e1",
        borderRadius: 10,
        padding: "12px 16px",
        marginBottom: 10,
      }}
    >
      <span
        style={{
          fontSize: "0.82rem",
          fontWeight: 700,
          color: "#475569",
          marginRight: 8,
          flexShrink: 0,
        }}
      >
        aud trail:
      </span>
      {AUD_HOPS.map((hop, i) => {
        const on = stepIndex >= hop.activeFrom && stepIndex <= hop.activeTo;
        const past = stepIndex > hop.activeTo;
        return (
          <React.Fragment key={i}>
            {i > 0 && (
              <span
                style={{
                  color: past ? "#2563eb" : "#cbd5e1",
                  fontSize: "0.95rem",
                  fontWeight: 700,
                }}
              >
                →
              </span>
            )}
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                background: on ? "#004687" : past ? "#dbeafe" : "#fff",
                border: `1.5px solid ${on ? "#004687" : past ? "#93c5fd" : "#cbd5e1"}`,
                borderRadius: 8,
                padding: "6px 12px",
                transition: "all 0.3s",
                minWidth: 110,
              }}
            >
              <span style={{ fontSize: "0.9rem" }}>{hop.icon}</span>
              <span
                style={{
                  fontSize: "0.75rem",
                  fontWeight: 700,
                  color: on ? "#fff" : past ? "#1d4ed8" : "#475569",
                  lineHeight: 1.3,
                }}
              >
                {hop.label}
              </span>
              <span
                style={{
                  fontSize: "0.7rem",
                  fontFamily: "inherit",
                  color: on ? "#bfdbfe" : past ? "#3b82f6" : "#64748b",
                  lineHeight: 1.3,
                }}
              >
                {hop.isExchange ? hop.aud : `aud: ${hop.aud}`}
              </span>
              {hop.act && (
                <span
                  style={{
                    fontSize: "0.68rem",
                    fontFamily: "inherit",
                    color: on ? "#86efac" : "#64748b",
                  }}
                >
                  act: {hop.act}
                </span>
              )}
              {hop.may_act && (
                <span
                  style={{
                    fontSize: "0.68rem",
                    fontFamily: "inherit",
                    color: on ? "#fde68a" : "#64748b",
                  }}
                >
                  may_act: {hop.may_act}
                </span>
              )}
            </div>
          </React.Fragment>
        );
      })}
    </div>
  );
}

// ─── Token card (light-background, readable) — Panel overlay inside React Flow ─

const URN_SHORT = {
  "urn:ietf:params:oauth:grant-type:token-exchange": "token-exchange",
  "urn:ietf:params:oauth:token-type:access_token": "access_token",
  "urn:ietf:params:oauth:token-type:id_token": "id_token",
  "urn:ietf:params:oauth:token-type:refresh_token": "refresh_token",
};
const FLOW_ACCENT = {
  oauth: "#2563eb",
  exchange: "#7c3aed",
  permit: "#16a34a",
  hitl: "#d97706",
  idtoken: "#0891b2",
  mcp: "#475569",
  error: "#dc2626",
};

function FlowClaimRow({ k, v }) {
  const isAud = k === "aud" || k === "audience" || k === "TokenAudience";
  const isAct = k === "act" || k === "may_act" || k === "ActClientId";
  const isDecide = k === "decision" || k === "DecisionContext";
  if (k === "note" || k === "_type" || k === "_rfcs" || k === "_title")
    return null;
  const val = URN_SHORT[v] !== undefined ? URN_SHORT[v] : String(v);
  return (
    <div
      style={{
        display: "flex",
        gap: 8,
        marginBottom: 4,
        alignItems: "flex-start",
      }}
    >
      <span
        style={{
          fontSize: "0.73rem",
          color: "#374151",
          minWidth: 100,
          flexShrink: 0,
          lineHeight: 1.5,
          fontFamily: "inherit",
        }}
      >
        {k}
      </span>
      <span
        style={{
          fontSize: "0.8rem",
          fontFamily: "inherit",
          lineHeight: 1.5,
          wordBreak: "break-word",
          color: isAud
            ? "#1d4ed8"
            : isAct
              ? "#15803d"
              : isDecide
                ? "#15803d"
                : "#0f172a",
          fontWeight: isAud || isAct || isDecide ? 700 : 500,
        }}
      >
        {val}
      </span>
    </div>
  );
}

function OneFlowCard({ token, isHitl }) {
  if (!token) return null;
  const accentType =
    token._type ||
    (isHitl
      ? "hitl"
      : token.decision?.includes("PERMIT") ||
          token.decision?.includes("APPROVED")
        ? "permit"
        : "oauth");
  const accent = FLOW_ACCENT[accentType] || FLOW_ACCENT.oauth;
  const rfcs = token._rfcs || [];
  const title = token.type || "Token";
  const note = token.note;
  const claimEntries = Object.entries(token).filter(
    ([k]) =>
      k !== "type" &&
      k !== "_type" &&
      k !== "_title" &&
      k !== "_rfcs" &&
      k !== "note",
  );
  return (
    <div
      style={{
        background: "#fff",
        borderRadius: 10,
        padding: "12px 14px",
        minWidth: 270,
        maxWidth: 340,
        boxShadow: "0 4px 20px rgba(0,0,0,0.14)",
        border: "1px solid #e2e8f0",
        borderLeft: `4px solid ${accent}`,
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 5,
          marginBottom: 9,
        }}
      >
        <span
          style={{
            fontSize: "0.86rem",
            fontWeight: 700,
            color: "#0f172a",
            flex: "1 1 auto",
          }}
        >
          {title}
        </span>
        {rfcs.map((r) => (
          <span
            key={r}
            style={{
              fontSize: "0.65rem",
              fontWeight: 700,
              background: "#eff6ff",
              color: "#1d4ed8",
              border: "1px solid #bfdbfe",
              borderRadius: 4,
              padding: "1px 5px",
              whiteSpace: "nowrap",
            }}
          >
            {r}
          </span>
        ))}
      </div>
      {claimEntries.map(([k, v]) => (
        <FlowClaimRow key={k} k={k} v={v} />
      ))}
      {note && (
        <div
          style={{
            marginTop: 8,
            paddingTop: 6,
            borderTop: "1px solid #f1f5f9",
            fontSize: "0.73rem",
            color: "#374151",
            fontStyle: "italic",
            lineHeight: 1.4,
            fontFamily: "system-ui,sans-serif",
          }}
        >
          ℹ {note}
        </div>
      )}
    </div>
  );
}

function TokenCard({ token, tokenOut, isTokenExchange, isHitl }) {
  if (!token) return null;
  if (isTokenExchange && tokenOut) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <OneFlowCard token={token} />
        <OneFlowCard token={tokenOut} />
      </div>
    );
  }
  return <OneFlowCard token={token} isHitl={isHitl} />;
}

// ─── Event → node mapping ─────────────────────────────────────────────────────

const FLOW_EVENT_MAP = [
  {
    category: "agent_prompt",
    tags: ["agent_prompt/llm_invoke", "agent_prompt/heuristic_tool"],
    nodeIds: ["agent"],
    colorClass: "active",
  },
  {
    category: "agent_prompt",
    tags: ["agent_prompt/llm_complete"],
    nodeIds: ["agent", "llm"],
    colorClass: "active",
  },
  {
    category: "token_exchange",
    tags: ["token_exchange/rfc8693-success"],
    nodeIds: ["idp-oauth-as", "mcp-gw"],
    colorClass: "active",
  },
  {
    category: "token_exchange",
    tags: ["token_exchange/rfc8693-error"],
    nodeIds: ["idp-oauth-as", "mcp-gw"],
    colorClass: "active-error",
  },
  {
    category: "authorize",
    tags: ["authorize/permit"],
    nodeIds: ["pingauthorize"],
    colorClass: "active-permit",
  },
  {
    category: "authorize",
    tags: ["authorize/deny"],
    nodeIds: ["pingauthorize"],
    colorClass: "active-error",
  },
  {
    category: "authorize",
    tags: ["authorize/bypass"],
    nodeIds: ["pingauthorize"],
    colorClass: "active",
  },
  {
    category: "oauth",
    tags: [],
    nodeIds: ["user", "idp-oauth-as"],
    colorClass: "active",
  },
  { category: "mcp", tags: [], nodeIds: ["mcp-gw"], colorClass: "active" },
  {
    category: "agent",
    tags: ["agent/message"],
    nodeIds: ["agent"],
    colorClass: "active",
  },
];

function mapEventToNodes(event) {
  for (const rule of FLOW_EVENT_MAP) {
    if (event.category !== rule.category) continue;
    if (rule.tags.length > 0 && !rule.tags.includes(event.tag)) continue;
    return rule.nodeIds.map((id) => ({ id, colorClass: rule.colorClass }));
  }
  return [];
}

function eventToHistoryEntry(evt) {
  const meta = evt.metadata || {};
  if (evt.category === "token_exchange") {
    const success = evt.tag === "token_exchange/rfc8693-success";
    return {
      label: success
        ? "RFC 8693 Exchange (live)"
        : "RFC 8693 Exchange Failed (live)",
      isTokenExchange: true,
      isHitl: false,
      token: {
        type: "Token Exchange (live)",
        _type: "exchange",
        _rfcs: ["RFC 8693"],
        ...(meta.subject_aud ? { subject_aud: meta.subject_aud } : {}),
        ...(meta.audience ? { requested_aud: meta.audience } : {}),
        ...(meta.scope ? { scope: meta.scope } : {}),
        note: success ? "Exchange succeeded ✓" : "Exchange failed ✗",
      },
      tokenOut: success
        ? {
            type: "Issued Token (live)",
            _type: "oauth",
            ...(meta.issued_aud || meta.audience
              ? { aud: meta.issued_aud || meta.audience }
              : {}),
            ...(meta.issued_scope || meta.scope
              ? { scope: meta.issued_scope || meta.scope }
              : {}),
          }
        : null,
    };
  }
  if (
    evt.category === "authorize" &&
    (evt.tag === "authorize/permit" || evt.tag === "authorize/deny")
  ) {
    const isPermit = evt.tag === "authorize/permit";
    return {
      label: `PingAuthorize ${isPermit ? "PERMIT" : "DENY"} (live)`,
      isTokenExchange: false,
      isHitl: false,
      token: {
        type: "Authorization Decision (live)",
        _type: isPermit ? "permit" : "error",
        decision: isPermit ? "✅ PERMIT" : "❌ DENY",
        ...(meta.DecisionContext
          ? { DecisionContext: meta.DecisionContext }
          : {}),
        ...(meta.ToolName ? { ToolName: meta.ToolName } : {}),
        ...(meta.ClientId ? { ClientId: meta.ClientId } : {}),
      },
    };
  }
  return null;
}

// ─── Page component ───────────────────────────────────────────────────────────

// ─── Live agent phase → diagram node mapping ────────────────────────────────
// Maps agentFlowDiagramService phase values to the node(s) that should light up.
const PHASE_TO_NODES = {
  // Token resolution
  resolving_access_token: [{ id: "idp-oauth-as", colorClass: "active" }],
  access_token_ready: [{ id: "idp-oauth-as", colorClass: "active" }],
  access_token_error: [{ id: "idp-oauth-as", colorClass: "active-error" }],
  // Authorize gate
  authorize_gate_begin: [
    { id: "mcp-gw", colorClass: "active" },
    { id: "pingauthorize", colorClass: "active" },
  ],
  authorize_permitted: [{ id: "pingauthorize", colorClass: "active-permit" }],
  authorize_denied: [{ id: "pingauthorize", colorClass: "active-error" }],
  authorize_simulated_error: [
    { id: "pingauthorize", colorClass: "active-error" },
  ],
  authorize_unavailable: [{ id: "pingauthorize", colorClass: "active-error" }],
  authorize_gate_skipped: [{ id: "pingauthorize", colorClass: "active-prev" }],
  authorize_internal_error: [
    { id: "pingauthorize", colorClass: "active-error" },
  ],
  // MCP
  mcp_remote_begin: [
    { id: "agent", colorClass: "active" },
    { id: "mcp-gw", colorClass: "active" },
  ],
  mcp_remote_done: [
    { id: "mcp-gw", colorClass: "active-permit" },
    { id: "mcp-server", colorClass: "active-permit" },
  ],
  mcp_remote_tool_error: [
    { id: "mcp-gw", colorClass: "active-error" },
    { id: "mcp-server", colorClass: "active-error" },
  ],
  mcp_remote_unreachable: [{ id: "mcp-gw", colorClass: "active-error" }],
  mcp_remote_skipped_vercel: [{ id: "mcp-gw", colorClass: "active-prev" }],
  // Introspection
  introspection_begin: [{ id: "idp-oauth-as", colorClass: "active" }],
  introspection_active_ok: [
    { id: "idp-oauth-as", colorClass: "active-permit" },
  ],
  introspection_inactive: [{ id: "idp-oauth-as", colorClass: "active-error" }],
  introspection_error_degraded: [
    { id: "idp-oauth-as", colorClass: "active-prev" },
  ],
  // Local fallback
  local_tool_start: [{ id: "mcp-server", colorClass: "active" }],
  local_tool_done: [{ id: "mcp-server", colorClass: "active-permit" }],
  local_tool_error: [{ id: "mcp-server", colorClass: "active-error" }],
  local_fallback_blocked_no_user: [
    { id: "mcp-server", colorClass: "active-error" },
  ],
  // HITL — device step-up (mfa_challenge_*, PostHog-tracked) vs. the
  // demo_hitl_service consent-required gate (authorize_denied_hitl /
  // mcp_auth_challenge_intercepted / gateway_step_up_required, both real
  // deps.emit() calls in mcpToolPipeline.js) are two different mechanisms;
  // both light the same "hitl" node since both pause for a human.
  mfa_challenge_initiated: [
    { id: "hitl", colorClass: "active-hitl" },
    { id: "agent", colorClass: "active-hitl" },
  ],
  mfa_challenge_completed: [{ id: "hitl", colorClass: "active-permit" }],
  mfa_challenge_failed: [{ id: "hitl", colorClass: "active-error" }],
  mfa_challenge_skipped: [{ id: "hitl", colorClass: "active-prev" }],
  authorize_denied_hitl: [
    { id: "pingauthorize", colorClass: "active-hitl" },
    { id: "hitl", colorClass: "active-hitl" },
  ],
  gateway_step_up_required: [
    { id: "pingauthorize", colorClass: "active-hitl" },
    { id: "hitl", colorClass: "active-hitl" },
  ],
  mcp_auth_challenge_intercepted: [{ id: "agent", colorClass: "active-hitl" }],
  // General
  request_accepted: [{ id: "agent", colorClass: "active" }],
  no_bearer_token_branch: [{ id: "mcp-gw", colorClass: "active" }],
  no_bearer_no_user: [{ id: "mcp-gw", colorClass: "active-error" }],
};

const HIGHLIGHT_MS = 4000;
const HISTORICAL_MS = 15000;

export default function ArchitectureFlowPage({ user }) {
  const [nodes, setNodes, onNodesChange] = useNodesState(START_NODES);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const layoutRequestRef = useRef(0);
  const [isSimulating, setIsSimulating] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [currentStep, setCurrentStep] = useState(-1);
  const [stepMs, setStepMs] = useState(DEFAULT_STEP_MS);
  const [history, setHistory] = useState([]);
  const [agentSnap, setAgentSnap] = useState(null);
  const [selectedScenario, setSelectedScenario] = useState("full-flow");
  const pausedStep = useRef(-1);
  const clearTimers = useRef({});
  const simTimeouts = useRef([]);
  const lastFetchedAt = useRef(null);
  const pollRef = useRef(null);
  const stepsRef = useRef(SIMULATE_STEPS);

  // Apply a single step to nodes + edges — progressive reveal: a node/edge
  // only exists once some step up to and including `i` has touched it.
  // Derived purely from (steps, i), not the previous render's state, so
  // badges and visibility stay correct on backward navigation too.
  const applyStep = useCallback(
    (i) => {
      const steps = stepsRef.current;
      const step = steps[i];
      if (!step) return;
      setCurrentStep(i);

      const { nodeMeta, edgeIdsSoFar } = computeStepsThroughIndex(steps, i);

      setNodes((prev) => {
        const prevById = {};
        prev.forEach((n) => {
          prevById[n.id] = n;
        });
        return Object.keys(nodeMeta)
          .map((id) => {
            const base = prevById[id] || INITIAL_NODES.find((n) => n.id === id);
            if (!base) return null;
            const meta = nodeMeta[id];
            return {
              ...base,
              data: {
                ...base.data,
                colorClass: meta.colorClass,
                stepLabel: meta.stepLabel,
                badge: meta.badge ?? base.data?.badge,
              },
            };
          })
          .filter(Boolean);
      });

      setEdges(() =>
        INITIAL_EDGES.filter((ie) => edgeIdsSoFar.has(ie.id)).map((ie) => {
          const active = step.activeEdgeIds.includes(ie.id);
          return {
            ...ie,
            animated: active,
            style: active ? step.edgeStyle : B,
            label: active && step.token ? step.token.type : ie.label,
          };
        }),
      );

      if (step.token) {
        const entry = {
          stepNum: i + 1,
          label: step.stepLabel,
          token: step.token,
          token2: null,
          tokenOut: step.tokenOut || null,
          isTokenExchange: Boolean(step.isTokenExchange),
          isHitl: Boolean(step.isHitl),
        };
        setHistory((prev) => {
          if (prev.some((e) => e.stepNum === entry.stepNum)) return prev;
          return [...prev, entry].sort((a, b) => a.stepNum - b.stepNum);
        });
      }
    },
    [setNodes, setEdges],
  );

  // Re-layout with ELK whenever the visible node/edge SET changes (not on
  // every colorClass-only update) — keyed on a sorted id signature so
  // highlight-only re-renders don't reshuffle positions mid-step.
  const visibleSignature =
    nodes.map((n) => n.id).sort().join(",") +
    "|" +
    edges.map((e) => e.id).sort().join(",");

  useEffect(() => {
    if (nodes.length === 0) return undefined;
    const requestId = ++layoutRequestRef.current;
    let cancelled = false;
    layoutWithElk(nodes, edges).then((positions) => {
      if (cancelled || requestId !== layoutRequestRef.current) return;
      setNodes((prev) =>
        prev.map((n) => (positions[n.id] ? { ...n, position: positions[n.id] } : n)),
      );
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleSignature]);

  const resetDiagram = useCallback(() => {
    setNodes(START_NODES);
    setEdges([]);
    setCurrentStep(-1);
    setIsPaused(false);
    pausedStep.current = -1;
  }, [setNodes, setEdges]);

  // Schedule steps from startIdx onward
  const scheduleFrom = useCallback(
    (startIdx) => {
      const steps = stepsRef.current;
      simTimeouts.current.forEach(clearTimeout);
      simTimeouts.current = [];

      steps.slice(startIdx).forEach((_, offset) => {
        const i = startIdx + offset;
        const t = setTimeout(
          () => {
            applyStep(i);
            if (i === steps.length - 1) {
              const done = setTimeout(() => {
                resetDiagram();
                setIsSimulating(false);
              }, HIGHLIGHT_MS);
              simTimeouts.current.push(done);
            }
          },
          (offset + (startIdx === 0 ? 0 : 1)) * stepMs,
        );
        simTimeouts.current.push(t);
      });
    },
    [applyStep, resetDiagram, stepMs],
  );

  const clearHistory = useCallback(() => setHistory([]), []);

  const runSimulation = useCallback(
    (scenarioKey) => {
      if (isSimulating) return;
      const key = scenarioKey || selectedScenario;
      const steps =
        key === "full-flow"
          ? SIMULATE_STEPS
          : SCENARIO_STEPS_FLOW[key] || SIMULATE_STEPS;
      stepsRef.current = steps;
      setHistory([]);
      setIsSimulating(true);
      setIsPaused(false);
      scheduleFrom(0);
    },
    [isSimulating, scheduleFrom, selectedScenario],
  );

  const pause = useCallback(() => {
    simTimeouts.current.forEach(clearTimeout);
    simTimeouts.current = [];
    pausedStep.current = currentStep;
    setIsPaused(true);
  }, [currentStep]);

  const resume = useCallback(() => {
    if (!isPaused) return;
    setIsPaused(false);
    scheduleFrom(pausedStep.current + 1);
  }, [isPaused, scheduleFrom]);

  const prevStep = useCallback(() => {
    if (!isPaused) return;
    const prev = pausedStep.current - 1;
    if (prev < 0) return;
    applyStep(prev);
    pausedStep.current = prev;
  }, [isPaused, applyStep]);

  const nextStep = useCallback(() => {
    if (!isPaused) return;
    const next = pausedStep.current + 1;
    if (next >= stepsRef.current.length) {
      resetDiagram();
      setIsSimulating(false);
      return;
    }
    applyStep(next);
    pausedStep.current = next;
  }, [isPaused, applyStep, resetDiagram]);

  const stopSim = useCallback(() => {
    simTimeouts.current.forEach(clearTimeout);
    simTimeouts.current = [];
    resetDiagram();
    setIsSimulating(false);
  }, [resetDiagram]);

  // Reset = stop the simulation and clear the token history log.
  const resetFlow = useCallback(() => {
    stopSim();
    clearHistory();
  }, [stopSim, clearHistory]);

  // Live event polling
  // Live events (SSE / agent-phase subscription) can touch a node the
  // canned simulation hasn't reached yet — reveal it the same way a step
  // would, instead of a silent no-op against a hidden node.
  const patchNode = useCallback(
    (id, colorClass, stepLabel = "") =>
      setNodes((prev) => {
        if (prev.some((n) => n.id === id)) {
          return prev.map((n) =>
            n.id === id
              ? { ...n, data: { ...n.data, colorClass, stepLabel } }
              : n,
          );
        }
        const base = INITIAL_NODES.find((n) => n.id === id);
        if (!base) return prev;
        return [...prev, { ...base, data: { ...base.data, colorClass, stepLabel } }];
      }),
    [setNodes],
  );

  const activateNode = useCallback(
    (id, colorClass = "active", ms = HIGHLIGHT_MS) => {
      if (clearTimers.current[id]) clearTimeout(clearTimers.current[id]);
      patchNode(id, colorClass, "");
      clearTimers.current[id] = setTimeout(() => {
        patchNode(id, "", "");
        delete clearTimers.current[id];
      }, ms);
    },
    [patchNode],
  );

  const processEvents = useCallback(
    (events, historical = false) => {
      const ms = historical ? HISTORICAL_MS : HIGHLIGHT_MS;
      events.forEach((evt) => {
        mapEventToNodes(evt).forEach(({ id, colorClass }) =>
          activateNode(id, colorClass, ms),
        );
        if (!historical) {
          const entry = eventToHistoryEntry(evt);
          if (entry) {
            setHistory((prev) => {
              const stepNum = prev.length + 1;
              return [...prev, { ...entry, stepNum }];
            });
          }
        }
      });
    },
    [activateNode],
  );

  const fetchEvents = useCallback(async () => {
    if (!user) return;
    try {
      const since =
        lastFetchedAt.current ||
        new Date(Date.now() - 5 * 60 * 1000).toISOString();
      const historical = !lastFetchedAt.current;
      const res = await apiClient.get(
        `/api/app-events?limit=50&since=${since}`,
      );
      const events = res.data?.events || [];
      if (events.length > 0) processEvents(events, historical);
      lastFetchedAt.current = new Date().toISOString();
    } catch {
      if (!lastFetchedAt.current)
        lastFetchedAt.current = new Date().toISOString();
    }
  }, [user, processEvents]);

  useEffect(() => {
    fetchEvents();
    const poll = pollRef.current;
    return () => {
      clearInterval(poll);
      Object.values(clearTimers.current).forEach(clearTimeout);
      simTimeouts.current.forEach(clearTimeout);
      clearTimers.current = {};
    };
  }, [fetchEvents]);

  // SSE: process new app events in real-time instead of polling every 10s
  useAppEventsSSE(
    (event) => {
      processEvents([event], false);
      lastFetchedAt.current = new Date().toISOString();
    },
    { enabled: !!user },
  );

  // Subscribe to live agent flow service — lights up diagram nodes as agent steps through MCP chain
  useEffect(() => {
    const unsub = agentFlowDiagram.subscribe((snap) => {
      // Always update status banner
      setAgentSnap(snap.phase !== "idle" ? snap : null);
      // Only drive diagram when not in manual simulation mode
      if (isSimulating) return;

      const phase = snap.phase;
      const nodes = PHASE_TO_NODES[phase];
      if (!nodes || nodes.length === 0) return;

      nodes.forEach(({ id, colorClass }) =>
        activateNode(id, colorClass, HIGHLIGHT_MS),
      );

      // If the agent just started a tool call, also light up the agent node
      if (phase === "request_accepted" && snap.toolName) {
        activateNode("agent", "active", HIGHLIGHT_MS);
      }
      // When MCP remote done, also show banking-api briefly
      if (phase === "mcp_remote_done") {
        setTimeout(
          () =>
            activateNode("banking-api", "active-permit", HIGHLIGHT_MS - 500),
          400,
        );
      }
    });
    return unsub;
  }, [isSimulating, activateNode]);

  const activeStep = currentStep >= 0 ? stepsRef.current[currentStep] : null;

  return (
    <div style={{ padding: "0 0.5rem" }}>
      <style>{`
        @keyframes arch-node-pulse {
          0%   { box-shadow: 0 0 0 0 rgba(0,70,135,0.4); }
          50%  { box-shadow: 0 0 20px 8px rgba(0,70,135,0.1); }
          100% { box-shadow: 0 0 0 0 rgba(0,70,135,0.4); }
        }
      `}</style>

      {/* Toolbar */}
      <div
        className="arch-diagram-toolbar"
        style={{ marginBottom: "0.5rem", flexWrap: "wrap", gap: "0.5rem" }}
      >
        <h2 className="afp-title" style={{ margin: 0, fontWeight: 700 }}>
          Interactive Architecture Flow
        </h2>
        <DiagramControls
          currentStep={currentStep + 1}
          totalSteps={stepsRef.current.length}
          isSimulating={isSimulating}
          isPaused={isPaused}
          onSimulate={runSimulation}
          onPrev={prevStep}
          onPause={pause}
          onResume={resume}
          onNext={nextStep}
          onStop={stopSim}
          onReset={resetFlow}
          stepTimeOptions={STEP_TIME_OPTIONS}
          stepMs={stepMs}
          onSetStepMs={setStepMs}
          extra={
            <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <span
                className="afp-scenario-label"
                style={{ fontWeight: 600, whiteSpace: "nowrap" }}
              >
                Scenario:
              </span>
              <select
                value={selectedScenario}
                onChange={(e) => setSelectedScenario(e.target.value)}
                disabled={isSimulating}
                className="afp-scenario-select"
                style={{
                  padding: "4px 8px",
                  borderRadius: 6,
                  cursor: isSimulating ? "not-allowed" : "pointer",
                }}
              >
                <option value="full-flow">Full Flow</option>
                <option value="no-subject-token">
                  No Subject Token (DENY + Context)
                </option>
                <option value="id-token">ID Token Exchange</option>
                <option value="user-token">Token Exchange (Both Hops)</option>
                <option value="get-accounts">Get Accounts (Read Scope)</option>
                <option value="withdrawal">Withdrawal + HITL</option>
                <option value="bad-scope">Bad Scope (401 / 403)</option>
                <option value="api-key-path">API-Key Path (Path A)</option>
                <option value="dual-token-path">Dual-Token Path (Path B)</option>
                <option value="oauth-bearer-path">
                  OAuth Bearer Path (Path C)
                </option>
              </select>
            </label>
          }
        />
        {activeStep && (
          <span
            className={`afp-step-badge${isPaused ? " afp-step-badge--paused" : ""}`}
            style={{ fontWeight: 600, borderRadius: 6, padding: "4px 10px" }}
          >
            {isPaused ? "⏸ PAUSED — " : ""}
            {activeStep.stepLabel}
          </span>
        )}
      </div>

      {/* Aud trail */}
      <AudTrail stepIndex={currentStep} />

      {/* Step description — explains what's happening in the current step */}
      {activeStep && activeStep.description && (
        <div
          className="afp-step-desc"
          style={{
            borderRadius: 8,
            padding: "12px 14px",
            marginBottom: "12px",
            lineHeight: "1.5",
            fontWeight: 500,
          }}
        >
          <strong>Step {currentStep + 1}:</strong>{" "}
          {activeStep.description}
        </div>
      )}

      {/* Live agent banner — shown when agent is actively running a tool */}
      {agentSnap && !isSimulating && (
        <div
          className={`afp-agent-banner afp-agent-banner--${
            agentSnap.phase?.includes("error") || agentSnap.phase?.includes("denied")
              ? "error"
              : agentSnap.phase === "mfa_challenge_initiated"
                ? "warn"
                : "ok"
          }`}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "10px",
            borderRadius: 6,
            padding: "6px 12px",
            marginBottom: 6,
            flexWrap: "wrap",
          }}
        >
          <span className="afp-agent-banner-icon">
            {agentSnap.phase?.includes("error") ||
            agentSnap.phase?.includes("denied")
              ? "❌"
              : agentSnap.phase === "mfa_challenge_initiated"
                ? "⏳"
                : agentSnap.phase?.includes("permit") ||
                    agentSnap.phase?.includes("done")
                  ? "✅"
                  : "⚡"}
          </span>
          <span className="afp-agent-banner-title" style={{ fontWeight: 700 }}>Live agent:</span>
          {agentSnap.toolName && (
            <span
              className="afp-agent-banner-tool"
              style={{ fontFamily: "inherit", borderRadius: 4, padding: "1px 6px", fontWeight: 700 }}
            >
              {agentSnap.toolName}
            </span>
          )}
          {agentSnap.serverEvents?.length > 0 && (
            <span className="afp-agent-banner-detail">
              {agentSnap.serverEvents[agentSnap.serverEvents.length - 1].label}
            </span>
          )}
          <span
            className="afp-agent-banner-phase"
            style={{ marginLeft: "auto", fontFamily: "inherit" }}
          >
            {agentSnap.phase}
          </span>
        </div>
      )}

      {/* Diagram */}
      <div className="afp-canvas-wrap" style={{ height: "70vh", borderRadius: 8, overflow: "hidden" }}>
        <ReactFlow
          className="afp-canvas"
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          nodeTypes={NODE_TYPES}
          fitView
          fitViewOptions={{ padding: 0.14 }}
          attributionPosition="bottom-left"
        >
          <Background gap={20} />
          <Controls />
          <MiniMap
            nodeColor={(n) => {
              const c = COLOR[n.data?.colorClass];
              return c ? c.border : COLOR.default.border;
            }}
          />

          {/* Token card — top-right of canvas */}
          <Panel position="top-right" style={{ padding: 0, margin: 10 }}>
            {activeStep?.token ? (
              <TokenCard
                token={activeStep.token}
                tokenOut={activeStep.tokenOut}
                isTokenExchange={activeStep.isTokenExchange}
                isHitl={activeStep.isHitl}
              />
            ) : !isSimulating ? (
              <div
                className="afp-token-placeholder"
                style={{
                  borderRadius: 8,
                  padding: "10px 14px",
                  maxWidth: 200,
                  textAlign: "center",
                  lineHeight: 1.5,
                }}
              >
                💳 Token details appear here
                <br />
                during simulation
              </div>
            ) : null}
          </Panel>
        </ReactFlow>
      </div>

      <p className="afp-help-text" style={{ marginTop: "0.4rem" }}>
        Hit <strong>▶ Simulate Flow</strong> then <strong>⏸ Pause</strong> at
        any step to read the token card. Node badges show{" "}
        <span style={{ color: "#1d4ed8", fontWeight: 600 }}>aud</span>,{" "}
        <span style={{ color: "#15803d", fontWeight: 600 }}>act</span>,{" "}
        <span style={{ color: "#b45309", fontWeight: 600 }}>may_act</span> —
        highlighted when they change.
      </p>

      {/* Token history — floating draggable modal */}
      <HistoryModal history={history} onClear={clearHistory} />
    </div>
  );
}

