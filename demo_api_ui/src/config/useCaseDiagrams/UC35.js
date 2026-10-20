/**
 * UC35 — Why was that blocked? After something gets denied (UC5 or UC6), the
 * chip has the agent read the real token-chain events from the run and explain
 * in plain language why a control fired. The explanation comes from the live
 * evidence PingOne produced — the LLM narrates the decision and does not make
 * one.
 */
import { PARTICIPANT_GROUPS as G } from "./palette";
import { AUTHZ } from "../pingStyleStandards";

const NODES = [
  { id: "user", group: "user", label: "Alice (user)", sub: ["asks why"], x: 40, y: 150, detail: "After a blocked action, she asks for the reason — the same evidence an auditor would pull, in plain language." },
  { id: "agent", group: "agent", label: "Banking agent", sub: ["narrates, never decides"], x: 440, y: 150, detail: "Reads the real token-chain events from the run and explains them. It narrates the decision; it does not make one." },
  { id: "gw", group: "gateway", label: "Agent gateway", sub: ["not called"], x: 840, y: 150, detail: "No gateway call here: the BFF agent service reads the session's recent token-chain events itself and hands them to the LLM." },
  { id: "p1", group: "pingone", label: "PingOne", sub: ["live evidence"], x: 1240, y: 150, detail: "Produced the original decision being explained: the token chain and authorize decisions are the script, not a canned answer." },
];

const EDGES = [
  ["user", "agent", "why was that blocked?", { detail: "The chip asks for an explanation of the last denied action, walked through the token chain." }],
  ["agent", "gw", "events handed over", { detail: "The BFF agent service reads the session's recent blocked or denied decisions and passes them to the LLM; there is no MCP tool call for this." }],
  ["gw", "p1", "no new decision", { detail: "No gateway call and no new Authorize decision on this step; the events already on the record are the evidence." }],
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
    title: "BFF reads the events", label: "No gateway call",
    nodes: ["agent", "gw"], edges: [1],
    lines: [{ who: "Gateway", text: "The BFF agent service reads the session's recent token-chain events and hands them to the LLM; no gateway call is made." }],
    tech: [{ t: "TOKEN", c: "no exchange and no gateway call; BFF reads recent token-chain events (the original agent AT was sub=alice, act={sub:agent})" }],
  },
  {
    title: "No new decision", label: "Evidence, not script",
    nodes: ["gw", "p1"], edges: [2],
    lines: [{ who: "PingOne", text: "No new Authorize decision on this step — the events from the denied run are already on the record." }],
    tech: [{ t: "POLICY", c: "no new authorize-decision on this step; the earlier DENY is read from the record" }],
  },
  {
    title: "Plain-language answer", label: "The LLM narrates only",
    nodes: ["p1", "agent"], edges: [3],
    lines: [{ who: "Agent", text: "It explains why the control fired from the record — useful for teaching, sourced from what an auditor would pull." }],
    tech: [{ t: "POLICY", c: "reply grounded in live token-chain events; LLM narrates the decision, makes none" }],
  },
];

// Per-step detail. The agent narrates recorded token-chain events; it never makes the decision.
const steps = [
  {
    beats: [0],
    detail: {
      form: "POST /api/agent/invoke\nCookie: <BFF session cookie>\nContent-Type: application/json\n\n{ \"prompt\": \"Explain why my last blocked action was denied and walk me through the token chain.\", \"vertical\": \"banking\" }\n\nPrior run on record: authorize-decision DENY (from UC5 or UC6).",
      tokens: [],
      refs: [],
    },
  },
  {
    beats: [1],
    detail: {
      form: "BFF agent service (in-process, no HTTP request, no gateway call):\n\nreads the session's most recent blocked or denied decisions from the token-chain events\nand passes them to the LLM as already-retrieved context.\n\nNo MCP tool exists for this read and no new Authorize decision is made on this step.",
      tokens: [],
      refs: [],
    },
  },
  {
    beats: [2],
    detail: {
      form: "No new PingOne Authorize decision on this step.\n\nThe decision being explained is already on the record:\n  authorize-decision { decision: \"DENY\", reason: \"<policy reason>\" }\n\nThe BFF only reads that record; it does not ask Authorize again.",
      tokens: [],
      refs: [...AUTHZ.filter((r) => r.id === "OpenID AuthZEN")],
    },
  },
  {
    beats: [3],
    detail: {
      form: "Live token-chain events returned to the agent (shape for orientation):\n\n[ user-token, token-exchange, authorize-decision { decision: \"DENY\", reason: \"<policy reason>\" } ]\n\nThe reply cites these events. The LLM narrates the decision; it did not make it.",
      tokens: [],
    },
  },
];

export default {
  id: "UC35",
  result: { label: "PERMIT", tone: "ok" },
  pingStyle: true,
  GROUPS: G,
  NODES,
  EDGES,
  walk,
  steps,
};
