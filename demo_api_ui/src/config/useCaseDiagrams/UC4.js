/**
 * UC4 — Overscoped agent. The agent asked for write when the job is read-only:
 * least-privilege narrows the token at the exchange, before any tool runs, and
 * the lookup completes on a read-only scope.
 */
import { PARTICIPANT_GROUPS as G } from "./palette";

const NODES = [
  { id: "user", group: "user", label: "Alice (user)", sub: ["show my balance"], x: 40, y: 150, detail: "An ordinary read. The scopes on her token are not the interesting part." },
  { id: "agent", group: "agent", label: "Banking agent", sub: ["asks for write too"], x: 340, y: 150, detail: "Requests more scope than the task needs — scope bloat is a standing escalation risk." },
  { id: "p1", group: "pingone", label: "PingOne", sub: ["least privilege"], x: 640, y: 150, detail: "Narrows the token at the exchange and checks scope against the tool in policy." },
];

const EDGES = [
  ["user", "agent", "signs in, asks balance", { detail: "Sign-in mints the user token; what the agent requests next is the test." }],
  ["agent", "p1", "RFC 8693 exchange", { detail: "The agent asked for write when it only needed read." }],
  ["p1", "agent", "narrowed token — read only", { detail: "Least privilege drops the write scope before any tool runs." }],
  ["agent", "p1", "authorize", { detail: "Policy compares the token's scope to what the tool requires — nothing more." }],
  ["p1", "agent", "PERMIT", { detail: "The read-only lookup completes; the token chain shows the narrowed scope." }],
];

const walk = [
  {
    title: "User signs in", label: "Ordinary read",
    nodes: ["user", "agent"], edges: [0],
    lines: [{ who: "Agent", text: "The session token is fine. The question is what the agent asks for next." }],
    tech: [{ t: "TOKEN", c: "sign-in AT: sub=alice, scopes incl. balance:read (write present but unneeded)" }],
  },
  {
    title: "Agent exchanges", label: "Scope narrows here",
    nodes: ["agent", "p1"], edges: [1, 2],
    lines: [{ who: "PingOne", text: "It asked for write when the job is read-only — the exchange is where that gets fixed." }],
    tech: [{ t: "TOKEN", c: "RFC 8693 -> agent AT: scope narrowed to balance:read (write dropped)" }],
  },
  {
    title: "Authorize checks scope", label: "Scope vs tool",
    nodes: ["p1", "agent"], edges: [3],
    lines: [{ who: "PingOne", text: "The topology surfaces any mismatch between effective scope and what the tools require." }],
    tech: [{ t: "POLICY", c: "Authorize: scope balance:read satisfies get_balance -> PERMIT" }],
  },
  {
    title: "Read-only lookup", label: "Least privilege on the record",
    nodes: ["agent", "p1"], edges: [4],
    lines: [{ who: "PingOne", text: "PERMIT — and the token chain shows the narrowed scope, auditable per agent." }],
    tech: [{ t: "API", c: "gateway dispatches get_balance; token chain shows narrowed scope" }],
  },
];

export default {
  id: "UC4",
  result: { label: "PERMIT", tone: "ok" },
  GROUPS: G,
  NODES,
  EDGES,
  walk,
};
