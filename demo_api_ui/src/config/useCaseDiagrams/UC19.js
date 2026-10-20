/**
 * UC19 — Non-human (agent) identity lifecycle. The agent app is a first-class
 * identity in PingOne: the live exchange succeeds, and retiring or rotating
 * that credential cuts off every later exchange — no tool is reachable.
 */
import { PARTICIPANT_GROUPS as G } from "./palette";

const NODES = [
  { id: "user", group: "user", label: "Alice (user)", sub: ["show my balance"], x: 40, y: 150, detail: "The same chip as always — but the identity under test is the agent's own." },
  { id: "agent", group: "agent", label: "Agent app", sub: ["first-class identity"], x: 340, y: 150, detail: "A non-human identity in PingOne with its own credential lifecycle." },
  { id: "p1", group: "pingone", label: "PingOne", sub: ["credential lifecycle"], x: 940, y: 150, detail: "Retiring or rotating the agent app's credential cuts off every later token exchange." },
];

const EDGES = [
  ["user", "agent", "asks for balance", { detail: "The request runs under the agent's own identity, not just the user's session." }],
  ["agent", "p1", "exchange (live credential)", { detail: "The agent app is enabled with a valid credential — the exchange is the test." }],
  ["p1", "agent", "token minted — PERMIT", { dashed: true, detail: "The live credential proves out; the tool is reachable and the chain shows the exchange." }],
  ["agent", "p1", "re-run after retire/rotate", { detail: "The denial half is manual: retire or rotate the agent app in the console, then run the chip again." }],
  ["p1", "agent", "exchange fails", { dashed: true, detail: "No valid credential, no delegated token — no tool can be reached. Instant and complete." }],
];

const walk = [
  {
    title: "Agent identity", label: "The exchange is the test",
    nodes: ["user", "agent"], edges: [0],
    lines: [{ who: "Agent", text: "'show my balance' runs as the live agent identity." }],
    tech: [{ t: "API", c: "tool call under agent app identity (its own client credential)" }],
  },
  {
    title: "Exchange succeeds", label: "Live credential",
    nodes: ["agent", "p1"], edges: [1, 2],
    lines: [{ who: "PingOne", text: "The agent app is enabled with a valid credential, so the exchange mints the delegated token." }],
    tech: [{ t: "TOKEN", c: "RFC 8693 exchange OK: agent app credential valid -> delegated AT" }],
  },
  {
    title: "Retire or rotate", label: "Console edit",
    nodes: ["agent", "p1"], edges: [3],
    lines: [{ who: "Presenter", text: "Retire or rotate the agent app in the PingOne console, then run the same chip again." }],
    tech: [{ t: "POLICY", c: "console: agent app retired/rotated -> credential lifecycle cuts off exchange" }],
  },
  {
    title: "Nothing reachable", label: "No per-tool cleanup",
    nodes: ["p1", "agent"], edges: [4],
    lines: [{ who: "PingOne", text: "Every later token exchange fails — instant and complete, same rigor as a human identity." }],
    tech: [{ t: "TOKEN", c: "exchange fails: retired credential -> no tool can be reached" }],
  },
];

export default {
  id: "UC19",
  result: { label: "PERMIT", tone: "ok" },
  GROUPS: G,
  NODES,
  EDGES,
  walk,
};
