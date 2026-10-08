/**
 * UC47 — Privilege A2A three-deep agent chain. Main agent -> LangChain agent
 * -> specialist, each hop an A2A message through the PingOne Privilege AI
 * Gateway. Variants prove the control: the allowed run completes; the
 * prompt-injection run and the ungranted-agent run are refused with a reason.
 */
import { PARTICIPANT_GROUPS as G } from "./palette";

const NODES = [
  { id: "main", group: "agent", label: "Main agent", sub: ["starts the reel"], x: 40, y: 150, detail: "Starts the chain on /dashboard; every hop streams into the movie reel." },
  { id: "lc", group: "agent", label: "LangChain agent", sub: ["hop 1"], x: 340, y: 150, detail: "Receives the first handoff through the gateway, presenting its own key." },
  { id: "spec", group: "agent", label: "Specialist", sub: ["hop 2"], x: 640, y: 150, detail: "Receives the second handoff; the gateway checked who may call whom first." },
  { id: "pgw", group: "gateway", label: "Privilege AI Gateway", sub: ["per-hop checks"], x: 940, y: 150, detail: "Each hop: the key's a2a scope, the policy for the remote agent, the guardrail." },
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

export default {
  id: "UC47",
  result: { label: "CHAIN", tone: "info" },
  GROUPS: G,
  NODES,
  EDGES,
  walk,
};
