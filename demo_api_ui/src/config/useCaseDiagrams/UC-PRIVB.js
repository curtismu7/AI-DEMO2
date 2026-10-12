/**
 * UC-PRIVB — Per-tool grants gate discovery (Privilege, measured 2026-10-10).
 * The client asks the gateway for tools/list; the gateway removes everything
 * outside the policy BEFORE responding, so the client sees exactly the granted
 * 2 of the backend's 9 tools — and zero denied reported, because they are
 * undiscoverable, not denied. The catalog a client sees IS its privilege level.
 */
import { PARTICIPANT_GROUPS as G } from "./palette";

const NODES = [
  { id: "client", group: "agent", label: "MCP client", sub: ["asks tools/list"], x: 40, y: 150, detail: "An ordinary discovery call — the client has no way to ask for tools it cannot see." },
  { id: "gw", group: "gateway", label: "Agent Privilege gateway", sub: ["filters before responding"], x: 340, y: 150, detail: "Removes every tool outside the policy before the response is written — the denied tools are never in the payload at all." },
  { id: "backend", group: "resource", label: "MCP backend", sub: ["9 tools"], x: 640, y: 150, detail: "Exposes all 9 tools; the policy's cut happens above it, at the gateway." },
  { id: "policy", group: "pingone", label: "Policy store", sub: ["policy = 2 tools"], x: 940, y: 150, detail: "The app's policy was edited down to 2 tools — that edit is what the client's catalog reflects." },
];

const EDGES = [
  ["client", "gw", "tools/list", { detail: "The discovery request — where per-tool grants gate, not at call time." }],
  ["gw", "policy", "which tools does this identity hold?", { detail: "The gateway resolves the caller's policy before answering." }],
  ["policy", "gw", "2 granted", { detail: "The policy grants exactly 2 of the backend's 9." }],
  ["gw", "backend", "fetch full catalog", { detail: "The gateway still asks the backend for all 9 — the filter is the gateway's job, not the backend's." }],
  ["gw", "client", "filtered catalog", { detail: "Exactly 2 tools return; zero denied are reported because they are undiscoverable, not denied — _meta.deniedTools exists only on the WS transport." }],
];

const walk = [
  {
    title: "Discovery request", label: "tools/list",
    nodes: ["client", "gw"], edges: [0],
    lines: [{ who: "Client", text: "A plain tools/list — discovery is where per-tool grants bite." }],
    tech: [{ t: "API", c: "GET tools/list over /aggregate-limited/mcp (Agentic App aggregate-limited)" }],
  },
  {
    title: "Policy filter", label: "Grant resolved first",
    nodes: ["gw", "policy"], edges: [1, 2],
    lines: [{ who: "Gateway", text: "The gateway reads the caller's policy — 2 tools — before it writes a single byte of the response." }],
    tech: [{ t: "POLICY", c: "per-tool grant: policy = 2 tools (edited down in the console)" }],
  },
  {
    title: "Backend consulted", label: "9 on the server",
    nodes: ["gw", "backend"], edges: [3],
    lines: [{ who: "Gateway", text: "The backend still holds 9 — the cut is discovery-gating at the gateway (GatewayServer.ts drops them entirely)." }],
    tech: [{ t: "API", c: "GET tools/list -> 2 tools (9 on backend)" }],
  },
  {
    title: "Filtered catalog", label: "2 of 9, zero denied reported",
    nodes: ["gw", "client"], edges: [4],
    lines: [{ who: "Presenter", text: "The client sees exactly its grant. '0 denied reported' is correct, not a bug — undiscoverable, not denied." }],
    tech: [
      { t: "POLICY", c: "per-tool grant filters at discovery — the catalog IS the privilege level" },
      { t: "API", c: "_meta.deniedTools exists only on the WS transport (never on these doors)" },
    ],
  },
];

export default {
  id: "UC-PRIVB",
  result: { label: "2 OF 9", tone: "info" },
  GROUPS: G,
  NODES,
  EDGES,
  walk,
};
