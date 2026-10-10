/**
 * UC8 — MCP App transfer approval (HITL). The consent shape: a $300 transfer
 * draws a human-in-the-loop obligation, the call pauses, a consent modal opens,
 * and a single-use approval receipt re-evaluates the same call to PERMIT.
 */
import { PARTICIPANT_GROUPS as G } from "./palette";

const NODES = [
  { id: "user", group: "user", label: "Alice (user)", sub: ["Approves in modal"], x: 40, y: 150, detail: "Sees the consent modal and approves the $300 transfer — the transfer does not run until she does." },
  { id: "agent", group: "agent", label: "Banking agent", sub: ["transfer $300"], x: 340, y: 150, detail: "Attempts the transfer with the delegated token. Nothing is unusual yet." },
  { id: "gw", group: "gateway", label: "Agent gateway", sub: ["pauses the call"], x: 640, y: 150, detail: "Holds the tool call while the obligation is unsatisfied — nothing runs." },
  { id: "p1", group: "pingone", label: "PingOne Authorize", sub: ["HITL obligation"], x: 940, y: 150, detail: "The amount falls in the consent band: the answer is an obligation, not PERMIT or DENY." },
];

const EDGES = [
  ["agent", "gw", "create_transfer $300", { detail: "A normal governed call — until policy answers." }],
  ["gw", "p1", "evaluate", { detail: "The gateway always asks before dispatching." }],
  ["p1", "gw", "obligation: HITL", { detail: "Consent band: human approval required before this action." }],
  ["gw", "user", "consent modal", { detail: "The BFF surfaces the challenge; the transfer waits.", vertical: true }],
  ["user", "gw", "approval receipt", { detail: "A verified receipt bound to user, agent and tool.", vertical: true }],
  ["gw", "agent", "re-run -> PERMIT", { detail: "The same call re-runs carrying the receipt; Authorize sees the obligation satisfied." }],
];

const walk = [
  {
    title: "Agent attempts the transfer", label: "Nothing unusual yet",
    nodes: ["agent", "gw"], edges: [0],
    lines: [{ who: "Agent", text: "create_transfer for $300 goes out with the delegated token." }],
    tech: [{ t: "API", c: "POST /gateway/mcp tools/call create_transfer amount=300" }],
  },
  {
    title: "Authorize answers HITL", label: "Consent band, not PERMIT",
    nodes: ["gw", "p1"], edges: [1],
    lines: [{ who: "PingOne", text: "This amount needs a human. The answer is an obligation." }],
    tech: [{ t: "POLICY", c: "amount in consent band -> obligation: HITL (not PERMIT, not DENY)" }],
  },
  {
    title: "Gateway pauses", label: "No tool runs",
    nodes: ["p1", "gw"], edges: [2],
    lines: [{ who: "Gateway", text: "The call holds: -32002 / hitl_required." }],
    tech: [{ t: "API", c: "gateway returns -32002 hitl_required; tool dispatch withheld" }],
  },
  {
    title: "Consent modal opens", label: "Human sees the ask",
    nodes: ["gw", "user"], edges: [3],
    lines: [{ who: "Alice", text: "The modal names exactly what is being requested — approve $300 to savings." }],
    tech: [{ t: "API", c: "BFF renders consent modal (user, agent, tool bound)" }],
  },
  {
    title: "User approves", label: "Single-use receipt",
    nodes: ["user", "gw"], edges: [4],
    lines: [{ who: "Gateway", text: "A verified approval receipt is recorded — one use, this call only." }],
    tech: [{ t: "TOKEN", c: "approval receipt: sub=alice, act=agent, tool=create_transfer (single-use)" }],
  },
  {
    title: "Re-evaluated to PERMIT", label: "Same call, obligation met",
    nodes: ["gw", "agent"], edges: [5],
    lines: [{ who: "Agent", text: "The transfer executes — with the approval on the record." }],
    tech: [{ t: "POLICY", c: "Authorize re-evaluates with receipt: obligation satisfied -> PERMIT" }],
  },
];

export default {
  id: "UC8",
  slug: "hitl-consent",
  hopHints: {
    signin: ["user"], prompt: ["user"], agent: ["agent"], llm: ["agent"],
    "agent-token": ["agent"], exchange: ["gw", "p1"], authorize: ["gw", "p1"],
    stepup: ["gw", "user"], gateway: ["gw"], "tools-list": ["agent", "gw"],
    "tools-list-challenge": ["agent", "gw"], "tools-call-challenge": ["agent", "gw"],
    mcp: ["gw"], api: ["gw"], reply: ["agent", "user"],
  },
  result: { label: "CONSENT", tone: "warn" },
  GROUPS: G,
  NODES,
  EDGES,
  walk,
};
