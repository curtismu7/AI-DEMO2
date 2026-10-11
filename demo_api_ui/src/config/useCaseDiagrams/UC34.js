/**
 * UC34 — Spot unusual patterns. The agent reasons freely over recent activity;
 * every tool call it issues still rides the same RFC 8693 -> gateway ->
 * Authorize legs as a deterministic chip. Free-form LLM reasoning is not a
 * shortcut around the policy chain: it changes what runs, never whether it is
 * governed.
 */
import { PARTICIPANT_GROUPS as G } from "./palette";

const NODES = [
  { id: "user", group: "user", label: "Alice (user)", sub: ["open-ended ask"], x: 40, y: 150, detail: "\"Check for unusual patterns in my recent activity\" — no fixed tool behind it, the agent decides what to run." },
  { id: "agent", group: "agent", label: "Banking agent", sub: ["free-form reasoning"], x: 340, y: 150, detail: "Reasons freely and issues whatever calls it needs — each one attributed and authorized independently." },
  { id: "gw", group: "gateway", label: "Agent gateway", sub: ["per-call policy"], x: 640, y: 150, detail: "No reasoning mode changes the path: every call gets token exchange, gateway validation and Authorize like any chip." },
  { id: "p1", group: "pingone", label: "PingOne", sub: ["same pipeline"], x: 940, y: 150, detail: "Authorize decides per call — LLM-chosen or deterministic makes no difference to the policy chain." },
  { id: "res", group: "resource", label: "Activity data", sub: ["reasoned analysis"], x: 1240, y: 150, detail: "Serves what the agent's reasoning asked for — with the same proof on every call that fetched it." },
];

const EDGES = [
  ["user", "agent", "open-ended ask", { detail: "Free-form reasoning picks the path; the governance stays fixed." }],
  ["agent", "gw", "tool calls", { detail: "Whatever the LLM issues, each call enters the same pipeline as a deterministic chip." }],
  ["gw", "p1", "authorize per call", { detail: "Attribution and authorization are per-call — nothing rides on the reasoning being clever." }],
  ["p1", "res", "PERMIT · dispatched", { detail: "The analysis runs on data fetched through governed calls end to end." }],
];

const walk = [
  {
    title: "The open-ended chip", label: "No fixed tool",
    nodes: ["user", "agent"], edges: [0],
    lines: [{ who: "Alice", text: "Unlike a balance chip, there is no single tool here — the agent must reason and choose." }],
    tech: [{ t: "API", c: "chat chip: \"Check for unusual patterns in my recent activity\" (LLM mode)" }],
  },
  {
    title: "Agent issues calls", label: "Its choice, not a script",
    nodes: ["agent", "gw"], edges: [1],
    lines: [{ who: "Agent", text: "Free-form reasoning decides what to fetch — and every call lands at the same gateway." }],
    tech: [{ t: "TOKEN", c: "RFC 8693 exchange per call -> agent AT: act={sub:agent, sub:alice}" }],
  },
  {
    title: "Same legs as a chip", label: "No reasoning shortcut",
    nodes: ["gw", "p1"], edges: [2],
    lines: [{ who: "Gateway", text: "Exchange, validation, Authorize — the deterministic path, call after call." }],
    tech: [{ t: "POLICY", c: "authorize-decision per tool call -> PERMIT (attributed, independent of LLM routing)" }],
  },
  {
    title: "Analysis delivered", label: "Governed end to end",
    nodes: ["p1", "res"], edges: [3],
    lines: [{ who: "PingOne", text: "Free-form reasoning changed what ran — never whether it was governed." }],
    tech: [{ t: "API", c: "tool dispatch -> 200; token chain shows exchange + authorize legs per call" }],
  },
];

export default {
  id: "UC34",
  result: { label: "PERMIT", tone: "ok" },
  GROUPS: G,
  NODES,
  EDGES,
  walk,
};
