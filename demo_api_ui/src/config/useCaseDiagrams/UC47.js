/**
 * UC47 — Privilege A2A three-deep agent chain. Main agent -> LangChain agent
 * -> specialist, each hop an A2A message through the PingOne Privilege AI
 * Gateway. Variants prove the control: the allowed run completes; the
 * prompt-injection run and the ungranted-agent run are refused with a reason.
 */
import { PARTICIPANT_GROUPS as G } from "./palette";
import { RFC, SPEC, AUTHZ } from "../pingStyleStandards";

const NODES = [
  { id: "main", group: "agent", label: "Main agent", sub: ["starts the reel"], x: 40, y: 150, detail: "Starts the chain on /dashboard; every hop streams into the movie reel." },
  { id: "lc", group: "agent", label: "LangChain agent", sub: ["hop 1"], x: 440, y: 150, detail: "Receives the first handoff through the gateway, presenting its own key." },
  { id: "spec", group: "agent", label: "Specialist", sub: ["hop 2"], x: 840, y: 150, detail: "Receives the second handoff; the gateway checked who may call whom first." },
  { id: "pgw", group: "gateway", label: "Agent Privilege", sub: ["per-hop checks"], x: 1240, y: 150, detail: "Each hop: the key's a2a scope, the policy for the remote agent, the guardrail." },
  ];

const EDGES = [
  ["main", "lc", "A2A hop 1", { detail: "The LangChain agent presents its own key at the gateway." }],
  ["lc", "spec", "A2A hop 2", { detail: "The second delegation crosses the same governed path." }],
  ["spec", "pgw", "variants run", { detail: "Allowed, prompt-injection and ungranted variants are each checked per hop." }],
  ["pgw", "main", "reel shows the run", { detail: "Every hop streams into the movie reel with its decision." }],
];

const walk = [
  {
    title: "Hop 1", label: "LangChain agent",
    nodes: ["main", "lc"], edges: [0],
    lines: [{ who: "Gateway", text: "The LangChain agent presents its own key — never the caller's." }],
    tech: [{ t: "POLICY", c: "Agent Access key (lc) + a2a scope checked" }],
  },
  {
    title: "Hop 2", label: "Specialist",
    nodes: ["lc", "spec"], edges: [1],
    lines: [{ who: "Gateway", text: "Same checks again: key, remote-agent policy, guardrail." }],
    tech: [{ t: "POLICY", c: "key (spec) + remote-agent policy + guardrail per hop" }],
  },
  {
    title: "Variants decide", label: "The control, proven",
    nodes: ["spec", "pgw"], edges: [2],
    lines: [{ who: "Gateway", text: "Allowed completes; prompt injection and the ungranted agent are refused with the reason." }],
    tech: [{ t: "POLICY", c: "variants: allowed | injection refused | ungranted refused" }],
  },
  {
    title: "Governed hop by hop", label: "Before the next agent",
    nodes: ["pgw", "main"], edges: [3],
    lines: [{ who: "Presenter", text: "Who calls whom and what crosses each hand-off is controlled up front." }],
    tech: [{ t: "A2A", c: "reel renders each hop; MITRE ATLAS / NIST / OWASP mapping on gateway records" }],
  },
];

// Per-step detail. Agent Access keys are opaque, so no JWT is decoded here (tokens: [] with the reason in the form).
const A2A = SPEC("A2A protocol", "Agent2Agent message/send, JSON-RPC over HTTP");
const steps = [
  {
    beats: [0],
    detail: {
      form: `POST {gateway A2A door for the LangChain agent}
A2A-Version: 1.0
Authorization: Bearer <LangChain agent key>
Content-Type: application/json

{ "jsonrpc": "2.0", "id": 1, "method": "message/send",
  "params": { "message": { "role": "user", "parts": [{ "kind": "text", "text": "<task>" }] } } }

The key is the LangChain agent's own, never the caller's. Opaque credential: no JWT to decode.`,
      tokens: [],
      refs: [A2A, RFC(6750, "Bearer token usage")],
    },
  },
  {
    beats: [1],
    detail: {
      form: `POST {gateway A2A door for the specialist}
A2A-Version: 1.0
Authorization: Bearer <Specialist agent key>
Content-Type: application/json

{ "jsonrpc": "2.0", "id": 2, "method": "message/send", "params": { "message": { ... } } }

Same checks again: key, remote-agent policy, guardrail. Opaque key: no JWT to decode.`,
      tokens: [],
      refs: [A2A, AUTHZ[0]],
    },
  },
  {
    beats: [2],
    detail: {
      form: `Variants of the same chain, each decided at the gateway per hop:

allowed         -> hop completes, result returned
injection       -> refused, reason: prompt injection detected by the guardrail
ungranted agent -> refused, reason: caller not granted to the remote agent

The refusal carries a reason that the reel displays.`,
      tokens: [],
      refs: [AUTHZ[0]],
    },
  },
  {
    beats: [3],
    detail: {
      form: `Every hop streams into the movie reel with its decision (allow or refuse + reason).
Gateway records carry the MITRE ATLAS / NIST / OWASP mapping for each event.

No request leaves the page on this step; it renders what the gateway recorded.`,
      tokens: [],
    },
  },
];

export default {
  pingStyle: true,
  id: "UC47",
  result: { label: "CHAIN", tone: "info" },
  GROUPS: G,
  NODES,
  EDGES,
  walk,
  steps,
};
