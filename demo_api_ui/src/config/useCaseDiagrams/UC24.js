/**
 * UC24 — Act 1: public catalog access. Progressive trust opener: a public
 * question is served with no sign-in, no token exchange, no gateway hop.
 * What did NOT happen is the diagram's point.
 */
import { PARTICIPANT_GROUPS as G } from "./palette";

const NODES = [
  { id: "user", group: "user", label: "Visitor", sub: ["no session cookie"], x: 40, y: 150, detail: "Asks a public question without signing in — no cookie, no token, no consent." },
  { id: "agent", group: "agent", label: "Banking agent", sub: ["classifies: public"], x: 340, y: 150, detail: "Classifies the question as public catalog data and serves it directly — no privilege escalation." },
  { id: "tool", group: "resource", label: "Branch lookup", sub: ["public catalog"], x: 640, y: 150, detail: "Answers with branch locations; nothing user-specific is read, so nothing is authorized." },
];

const EDGES = [
  ["user", "agent", "ask: branches near me?", { detail: "The chip question needs no sign-in — it names no user data." }],
  ["agent", "tool", "direct call, no token", { detail: "The agent calls the public tool directly — no exchange, no gateway hop." }],
  ["tool", "agent", "branch list", { detail: "Public data returns; the trace shows no auth machinery." }],
  ["agent", "tool", "no auth hop on record", { detail: "The trace is the lesson: nothing authorized, nothing delegated." }],
];

const walk = [
  {
    title: "Public question", label: "No session, no consent",
    nodes: ["user", "agent"], edges: [0],
    lines: [{ who: "Visitor", text: "Asks before ever signing in — and gets an answer." }],
    tech: [{ t: "API", c: "agent receives chip 'What branches are near me?' (no session)" }],
  },
  {
    title: "Classify: public", label: "No escalation needed",
    nodes: ["agent"], edges: [1],
    lines: [{ who: "Agent", text: "Public data is served directly. Escalation is for when the value is clear." }],
    tech: [{ t: "POLICY", c: "no token exchange, no gateway hop, no Authorize call" }],
  },
  {
    title: "Tool answers", label: "No credentials involved",
    nodes: ["agent", "tool"], edges: [2],
    lines: [{ who: "Tool", text: "Branches listed. Nothing about a user was read, so nothing had to be authorized." }],
    tech: [{ t: "API", c: "branch lookup -> Austin, Dallas, Houston, Miami, Denver" }],
  },
  {
    title: "Contrast with step 2", label: "Where privilege starts",
    nodes: ["agent", "tool"], edges: [3],
    lines: [{ who: "Agent", text: "Everything after this signs in, delegates, and asks Authorize." }],
    tech: [{ t: "TOKEN", c: "absent by design: trace shows no exchange step (progressive trust)" }],
  },
];


export default {
  id: "UC24",
  result: { label: "PERMIT", tone: "ok" },
  GROUPS: G,
  NODES,
  EDGES,
  walk,
};
