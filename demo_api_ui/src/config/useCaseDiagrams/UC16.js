/**
 * UC16 — Impersonation blocked (OBO required). A token with the user as
 * subject but no act claim carries no attribution: the call is refused (403 missing_act from PingOne Authorize)
 * before any tool runs, because agent-mediated calls must be on-behalf-of.
 */
import { PARTICIPANT_GROUPS as G } from "./palette";
import { UC_BATCH3_STEPS } from "./pingBatch3Uc3Steps";

const NODES = [
  { id: "user", group: "user", label: "Alice (user)", sub: ["subject, not principal"], x: 40, y: 150, detail: "The sim's token says she is the subject — with no act claim, nobody acts for her on the record." },
  { id: "sim", group: "agent", label: "Attack sim", sub: ["impersonation-no-act"], x: 340, y: 150, detail: "Presents a token with sub=alice and no act claim — pure impersonation shape." },
  { id: "gw", group: "gateway", label: "Agent gateway", sub: ["requires act"], x: 940, y: 150, detail: "Agent-mediated calls must carry an act claim; a bare user subject is rejected." },
  { id: "p1", group: "pingone", label: "PingOne", sub: ["attribution policy"], x: 1240, y: 150, detail: "An RFC 8693 exchange would mint act={sub:agent} — the sim skipped it." },
];

const EDGES = [
  ["user", "sim", "sub=alice (no act)", { detail: "The subject is the user; what is missing is who acts for them." }],
  ["sim", "gw", "tool call, no act claim", { detail: "Agent-mediated calls must be on-behalf-of delegation." }],
  ["gw", "p1", "attribution check", { detail: "No act claim, no attribution — a verifiable chain of custody is the rule." }],
  ["gw", "sim", "403 missing_act", { dashed: true, detail: "Authorize refuses the act-less token (it is a valid bearer, so it clears the perimeter); no tool runs, no silent impersonation." }],
];

const walk = [
  {
    title: "Token with no act", label: "Impersonation shape",
    nodes: ["user", "sim"], edges: [0],
    lines: [{ who: "Attack sim", text: "sub=alice, act ABSENT — the user is named, the agent is not." }],
    tech: [{ t: "TOKEN", c: "sim AT: sub=alice, act ABSENT (RFC 8693 exchange with no actor_token)" }],
  },
  {
    title: "Presented at gateway", label: "The missing hop",
    nodes: ["sim", "gw"], edges: [1],
    lines: [{ who: "Attack sim", text: "A valid-looking token with no act claim, offered for a create_transfer tool call." }],
    tech: [{ t: "API", c: "POST /gateway/mcp tools/call create_transfer with sub=alice token (no act)" }],
  },
  {
    title: "Attribution required", label: "OBO or nothing",
    nodes: ["gw", "p1"], edges: [2],
    lines: [{ who: "Gateway", text: "Delegation is the rule: the exchange would have minted act={sub:agent}." }],
    tech: [{ t: "POLICY", c: "authorize-decision: agent-mediated call without act claim -> reject" }],
  },
  {
    title: "403 — nothing ran", label: "Chain of custody intact",
    nodes: ["gw", "sim"], edges: [3],
    lines: [{ who: "Gateway", text: "Every agent action stays attributable — impersonation never reaches a tool." }],
    tech: [{ t: "API", c: "403 missing_act; no tool dispatch" }],
  },
];

export default {
  id: "UC16",
  result: { label: "DENY", tone: "err" },
  pingStyle: true,
  GROUPS: G,
  NODES,
  EDGES,
  walk,
  steps: UC_BATCH3_STEPS["UC16"],
};
