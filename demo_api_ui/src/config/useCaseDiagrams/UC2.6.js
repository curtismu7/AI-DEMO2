/**
 * UC2.6 — A2A generalist mismatch. The same governed delegation as UC2 runs to
 * a real PERMIT — then the same Authorize decision is probed with a fabricated,
 * unregistered generalist identity and answers invalid_a2a_generalist. Policy
 * checks ActChainDepth and NestedActClientId: authorization keys on WHO is
 * acting, not only on the user and the delegation shape. A stolen or rogue
 * agent credential cannot ride on a legitimate user's delegation.
 */
import { PARTICIPANT_GROUPS as G } from "./palette";

const NODES = [
  { id: "user", group: "user", label: "Alice (user)", sub: ["same delegation"], x: 40, y: 150, detail: "Same user, same consent, same mayAct delegation — nothing about her changes between PERMIT and DENY." },
  { id: "gen", group: "agent", label: "Registered generalist", sub: ["UC2 handoff -> PERMIT"], x: 340, y: 150, detail: "The registered client id: the UC2 handoff runs exactly as always and Authorize permits it." },
  { id: "rogue", group: "external", label: "Fabricated generalist", sub: ["unregistered identity"], x: 640, y: 150, detail: "A fabricated, unregistered generalist identity probes the same decision — subject and chain depth look right; the actor is not." },
  { id: "p1", group: "pingone", label: "PingOne Authorize", sub: ["ActChainDepth", "NestedActClientId"], x: 940, y: 150, detail: "Checks ActChainDepth and NestedActClientId in the nested act chain — a rogue actor id is denied even when the shape is legitimate." },
];

const EDGES = [
  ["user", "gen", "governed handoff", { detail: "The UC2 chain: user, then generalist, then specialist — and a real PERMIT." }],
  ["gen", "p1", "authorize -> PERMIT", { detail: "Nested act chain checks out for the registered actor." }],
  ["rogue", "p1", "same-shape probe", { detail: "Same user, same delegation shape — but the acting agent is fabricated and unregistered." }],
  ["p1", "rogue", "invalid_a2a_generalist", { detail: "DENY on actor identity: who is acting decides, not just who is being acted for." }],
];

const walk = [
  {
    title: "Governed delegation", label: "UC2 replays to PERMIT",
    nodes: ["user", "gen"], edges: [0],
    lines: [{ who: "PingOne", text: "The nested RFC 8693 chain mints as usual — the baseline is a genuine PERMIT." }],
    tech: [{ t: "TOKEN", c: "RFC 8693 x2 -> nested act: specialist acts for generalist (registered) acting for alice" }],
  },
  {
    title: "Registered actor permitted", label: "Baseline holds",
    nodes: ["gen", "p1"], edges: [1],
    lines: [{ who: "Gateway", text: "Authorize evaluates the chain: registered client id, right depth — PERMIT." }],
    tech: [{ t: "POLICY", c: "Authorize: ActChainDepth ok, NestedActClientId = registered generalist -> PERMIT" }],
  },
  {
    title: "Mismatch probe", label: "Same shape, wrong actor",
    nodes: ["rogue", "p1"], edges: [2],
    lines: [{ who: "Probe", text: "An unregistered generalist identity re-asks the same decision — everything matches but WHO is acting." }],
    tech: [{ t: "A2A", c: "probe: simulated actor-mismatch generalist (unregistered client id) vs same Authorize decision" }],
  },
  {
    title: "invalid_a2a_generalist", label: "DENY on actor identity",
    nodes: ["p1", "rogue"], edges: [3],
    lines: [{ who: "PingOne", text: "The deny is genuine: a rogue or stolen agent credential cannot ride a legitimate user's delegation." }],
    tech: [{ t: "POLICY", c: "Authorize: NestedActClientId != registered generalist -> DENY invalid_a2a_generalist" }],
  },
];

export default {
  id: "UC2.6",
  result: { label: "PERMIT → DENY", tone: "err" },
  GROUPS: G,
  NODES,
  EDGES,
  walk,
};
