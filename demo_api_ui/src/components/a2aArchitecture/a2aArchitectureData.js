// a2aArchitectureData.js — content for /a2a-architecture under Diagrams.
// Source: docs/A2A_ARCHITECTURE.md (the two Mermaid figures, redrawn for StaticFlowDiagram).
// Return legs (tool result, JSON-RPC response) are folded into the forward edge's label.

const N = (id, group, label, sub, x, y) => ({ id, group, label, sub, x, y });
const E = (src, tgt, label, opts) => (opts ? [src, tgt, label, opts] : [src, tgt, label]);
const DOWN = { vertical: true };

// Group keys are the ones PersonalAgent.css already styles.
export const GROUPS = {
  traveller: { label: "Browser", bg: "var(--th-text-muted)" },
  ag: { label: "Agents", bg: "var(--th-status-info)" },
  ping: { label: "PingOne Authorize", bg: "var(--th-status-warning)" },
  team: { label: "MCP gateway", bg: "var(--th-status-success)" },
};

export const DELEGATION_NODES = [
  N("browser", "traveller", "Browser", ["demo_api_ui"], 0, 0),
  N("generalist", "ag", "Generalist Agent 1", ["BFF"], 290, 0),
  N("specialist", "ag", "Specialist Agent 2", ["per-vertical A2A endpoint"], 580, 0),
  N("p1", "ping", "PingOne Authorize", ["RFC 8693 token exchange", "approves the nested act chain"], 290, 200),
  N("mcp", "team", "A2A MCP Gateway", ["sensitive-data tools"], 580, 200),
];

export const DELEGATION_EDGES = [
  E("browser", "generalist", "UC2 request (session cookie)"), // 0
  E("generalist", "p1", "Exchange #1: sub=user, act={generalist}", DOWN), // 1
  E("generalist", "specialist", "SendMessage, Bearer = Exchange #1 token; response returns"), // 2
  E("specialist", "p1", "Exchange #2: act={specialist, act={generalist}}"), // 3
  E("specialist", "mcp", "MCP tool call (nested-act token); result returns", DOWN), // 4
];

export const DISCOVERY_NODES = [
  N("gen", "ag", "Generalist (Agent 1)", [], 0, 0),
  N("card", "ag", "Agent Card", ["capabilities"], 580, 0),
  N("spec", "ag", "Specialist (Agent 2)", [], 0, 200),
];

export const DISCOVERY_EDGES = [
  E("gen", "card", "GET /a2a/specialists/:vertical/.well-known/agent-card.json"), // 0
  E("gen", "spec", "POST /a2a/specialists/:vertical (JSON-RPC SendMessage)", { vertical: true }), // 1
];
