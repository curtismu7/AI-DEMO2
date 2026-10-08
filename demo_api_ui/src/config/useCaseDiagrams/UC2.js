/**
 * UC2 — A2A delegation. The nested act chain: generalist hands off to a
 * specialist, a second RFC 8693 exchange nests act inside act, and scope
 * narrows at each hop. The whole handoff is provable.
 */
import { PARTICIPANT_GROUPS as G } from "./palette";

const NODES = [
  { id: "user", group: "user", label: "Alice (user)", sub: ["delegates once"], x: 40, y: 150, detail: "Consented at sign-in; she never sees the handoff between the agents." },
  { id: "gen", group: "agent", label: "Generalist agent", sub: ["Banking Agent"], x: 340, y: 150, detail: "Holds sub=alice, act=generalist. It is not expert in the job, so it hands off." },
  { id: "spec", group: "agent", label: "Specialist agent", sub: ["receives handoff"], x: 640, y: 150, detail: "Exchanges again: act nests the generalist inside the specialist." },
  { id: "p1", group: "pingone", label: "PingOne", sub: ["RFC 8693 x2"], x: 940, y: 150, detail: "Mints both delegated tokens; each hop carries less scope, not more." },
];

const EDGES = [
  ["user", "gen", "consent at sign-in", { detail: "One exchange mints the generalist token: sub=alice, act=generalist." }],
  ["gen", "spec", "handoff", { detail: "The specialist sends its own exchange; the user never sees this hop." }],
  ["spec", "p1", "second RFC 8693", { detail: "act nests: specialist acts for generalist acting for alice." }],
  ["p1", "spec", "narrowed token", { detail: "Only what the handoff granted — scope narrows at every hop." }],
  ["spec", "p1", "authorize", { detail: "The policy decides over the whole nested act chain." }],
];

const walk = [
  {
    title: "User delegates", label: "First exchange",
    nodes: ["user", "gen"], edges: [0],
    lines: [{ who: "PingOne", text: "sub=alice, act=generalist. One hop of the chain on the record." }],
    tech: [{ t: "TOKEN", c: "RFC 8693 #1 -> gen AT: sub=alice, act={sub:generalist}" }],
  },
  {
    title: "Generalist hands off", label: "The invisible hop",
    nodes: ["gen", "spec"], edges: [1],
    lines: [{ who: "Generalist", text: "The specialist tool varies by vertical; the handoff is agent-to-agent." }],
    tech: [{ t: "A2A", c: "generalist -> specialist: task handoff (A2A message)" }],
  },
  {
    title: "Nested act chain", label: "Second exchange",
    nodes: ["spec", "p1"], edges: [2],
    lines: [{ who: "PingOne", text: "act nests — the chain is provable end to end." }],
    tech: [{ t: "TOKEN", c: "RFC 8693 #2 -> spec AT: act={sub:spec, act:{sub:generalist}}, sub=alice" }],
  },
  {
    title: "Scope narrows", label: "Never grows",
    nodes: ["p1", "spec"], edges: [3],
    lines: [{ who: "PingOne", text: "Each hop holds less scope than the one before it." }],
    tech: [{ t: "POLICY", c: "narrowed to the scopes the handoff explicitly granted" }],
  },
  {
    title: "PERMIT on the chain", label: "Authorize decides",
    nodes: ["spec", "p1"], edges: [4],
    lines: [{ who: "Gateway", text: "The specialist tool call returns PERMIT; the token chain shows all hops." }],
    tech: [{ t: "POLICY", c: "Authorize evaluates nested act chain -> PERMIT" }],
  },
];

export default {
  id: "UC2",
  result: { label: "PERMIT", tone: "ok" },
  GROUPS: G,
  NODES,
  EDGES,
  walk,
};
