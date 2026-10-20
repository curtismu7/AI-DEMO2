/**
 * UC2.5 — A2A Orchestrator. The generalist picks the specialist at runtime
 * (CrewAI, heuristic fallback) instead of a fixed task map, then the same
 * narrowed two-hop delegation runs. Routing is dynamic; governance is not.
 */
import { PARTICIPANT_GROUPS as G } from "./palette";

const NODES = [
  { id: "orch", group: "agent", label: "Orchestrator", sub: ["analyzes request"], x: 40, y: 150, detail: "The generalist agent: not expert in the request, so it must route it." },
  { id: "pick", group: "agent", label: "Specialist pick", sub: ["runtime decision"], x: 340, y: 150, detail: "Chooses the best specialist dynamically (CrewAI, heuristic fallback) — no hard-coded task map." },
  { id: "p1", group: "pingone", label: "PingOne", sub: ["RFC 8693 x2"], x: 640, y: 150, detail: "Mints both delegated tokens; act nests at each hop." },
  { id: "spec", group: "agent", label: "Specialist", sub: ["narrowed token"], x: 1240, y: 150, detail: "Runs with only the scopes the handoff granted — decided by policy, not preference." },
];

const EDGES = [
  ["orch", "orch", "analyze request", { detail: "The orchestrator is not expert in the request — routing is its job." }],
  ["orch", "pick", "analyze + choose", { detail: "The pick happens at runtime; the demo shows it on the activity panel." }],
  ["pick", "p1", "delegate hop 1", { detail: "First RFC 8693 exchange mints the generalist token." }],
  ["p1", "spec", "delegated token", { dashed: true, detail: "Second exchange mints the specialist token with act nesting." }],
  ["spec", "p1", "authorize", { detail: "The nested chain is evaluated like any other call." }],
];

const walk = [
  {
    title: "Request lands", label: "Not my expertise",
    nodes: ["orch"], edges: [0],
    lines: [{ who: "Orchestrator", text: "It analyzes the request and must route — that is the orchestrator's whole job." }],
    tech: [{ t: "A2A", c: "orchestrator analyzes request; no hard-coded task map" }],
  },
  {
    title: "Specialist chosen", label: "Dynamic pick",
    nodes: ["orch", "pick"], edges: [1],
    lines: [{ who: "Orchestrator", text: "CrewAI picks when available; a heuristic covers the fallback." }],
    tech: [{ t: "A2A", c: "specialist selected at runtime (CrewAI / heuristic)" }],
  },
  {
    title: "Two-hop delegation", label: "Act nests twice",
    nodes: ["pick", "p1"], edges: [2],
    lines: [{ who: "PingOne", text: "Same machinery as UC2 — the routing changed, the governance did not." }],
    tech: [{ t: "TOKEN", c: "RFC 8693 #1 -> gen AT: sub=alice, act={sub:orchestrator}" }],
  },
  {
    title: "Narrowed at the edge", label: "Policy-decided scopes",
    nodes: ["p1", "spec"], edges: [3],
    lines: [{ who: "Specialist", text: "Only the scopes the handoff granted — visible in the token." }],
    tech: [{ t: "TOKEN", c: "RFC 8693 #2 -> spec AT: act nested, scopes narrowed" }],
  },
  {
    title: "Chain + activity update", label: "Everything on the record",
    nodes: ["spec", "p1"], edges: [4],
    lines: [{ who: "Gateway", text: "The pick, the hops and the PERMIT land in the token chain and activity panel." }],
    tech: [{ t: "POLICY", c: "authorize-decision: PERMIT over the nested chain" }],
  },
];

export default {
  id: "UC2.5",
  result: { label: "PERMIT", tone: "ok" },
  GROUPS: G,
  NODES,
  EDGES,
  walk,
};
