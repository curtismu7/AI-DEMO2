/**
 * UC35 — Why was that blocked? After something gets denied (UC5 or UC6), the
 * chip has the agent read the real token-chain events from the run and explain
 * in plain language why a control fired. The explanation comes from the live
 * evidence PingOne produced — the LLM narrates the decision and does not make
 * one.
 */
import { PARTICIPANT_GROUPS as G } from "./palette";

const NODES = [
  { id: "user", group: "user", label: "Alice (user)", sub: ["asks why"], x: 40, y: 150, detail: "After a blocked action, she asks for the reason — the same evidence an auditor would pull, in plain language." },
  { id: "agent", group: "agent", label: "Banking agent", sub: ["narrates, never decides"], x: 340, y: 150, detail: "Reads the real token-chain events from the run and explains them. It narrates the decision; it does not make one." },
  { id: "gw", group: "gateway", label: "Agent gateway", sub: ["same policy chain"], x: 640, y: 150, detail: "Even this explanation runs the full governed path — user token, exchange, Authorize — before the events are read." },
  { id: "p1", group: "pingone", label: "PingOne", sub: ["live evidence"], x: 940, y: 150, detail: "Produced the events being explained: the token chain and authorize decisions are the script, not a canned answer." },
];

const EDGES = [
  ["user", "agent", "why was that blocked?", { detail: "The chip asks for an explanation of the last denied action, walked through the token chain." }],
  ["agent", "gw", "governed read", { detail: "The explanation request itself runs the full RFC 8693 -> gateway -> Authorize chain." }],
  ["gw", "p1", "authorize -> PERMIT", { detail: "Policy permits the read; the agent gets the real events, not a summary of them." }],
  ["p1", "agent", "token-chain events", { detail: "Live evidence from the run — the LLM explains why the control fired, from the record." }],
];

const walk = [
  {
    title: "Explanation chip", label: "After a deny",
    nodes: ["user", "agent"], edges: [0],
    lines: [{ who: "Alice", text: "First a deny happens (UC5 or UC6) — then she asks: \"Explain why my last blocked action was denied and walk me through the token chain.\"" }],
    tech: [
      { t: "API", c: "chat chip: \"Explain why my last blocked action was denied…\"" },
      { t: "POLICY", c: "prior run: authorize-decision DENY recorded in token-chain events" },
    ],
  },
  {
    title: "Governed path", label: "Same chain, no shortcut",
    nodes: ["agent", "gw"], edges: [1],
    lines: [{ who: "Gateway", text: "Reading the evidence is itself a governed call — user token, RFC 8693, Authorize." }],
    tech: [{ t: "TOKEN", c: "RFC 8693 exchange -> agent AT: act={sub:agent, sub:alice}" }],
  },
  {
    title: "Authorize permits the read", label: "Evidence, not script",
    nodes: ["gw", "p1"], edges: [2],
    lines: [{ who: "PingOne", text: "PERMIT — the agent may read the live token-chain events of the denied run." }],
    tech: [{ t: "POLICY", c: "authorize-decision: read of token-chain events -> PERMIT" }],
  },
  {
    title: "Plain-language answer", label: "The LLM narrates only",
    nodes: ["p1", "agent"], edges: [3],
    lines: [{ who: "Agent", text: "It explains why the control fired from the record — useful for teaching, sourced from what an auditor would pull." }],
    tech: [{ t: "POLICY", c: "reply grounded in live token-chain events; LLM narrates the decision, makes none" }],
  },
];

export default {
  id: "UC35",
  result: { label: "PERMIT", tone: "ok" },
  GROUPS: G,
  NODES,
  EDGES,
  walk,
};
