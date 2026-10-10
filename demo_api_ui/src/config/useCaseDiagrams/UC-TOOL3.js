/**
 * UC-TOOL3 — LLM Gateway. Every prompt rides one POST through the demo BFF to
 * PingOne Agent Privilege's virtual key; Privilege classifies the outcome
 * (policy deny / provider refusal / answer) before the provider is ever
 * contacted. The ungoverned counterpart (/llm-test) shows the same call
 * without the gateway.
 */
import { PARTICIPANT_GROUPS as G } from "./palette";

const NODES = [
  { id: "user", group: "user", label: "Alice (user)", sub: ["signed in", "types a prompt"], x: 40, y: 150, detail: "Sends a prompt from the AI Guard chat console — the attack payloads load prefilled from the guardrail catalog." },
  { id: "agent", group: "agent", label: "AI Guard console", sub: ["/llm-gateway"], x: 340, y: 150, detail: "The chat console forwards the prompt as one POST; it never holds a provider credential." },
  { id: "gw", group: "gateway", label: "Demo BFF · /llm/call", sub: ["owns the provider key"], x: 640, y: 150, detail: "POST /api/privilege-mcp/llm/call — the browser never sees the provider key; the BFF attaches the lane's Privilege virtual key." },
  { id: "p1", group: "pingone", label: "Agent Privilege", sub: ["virtual key", "policy scan"], x: 940, y: 150, detail: "Scans the prompt for injection, PII, and malicious content and returns a policy verdict beside the provider response." },
  { id: "llm", group: "resource", label: "LLM provider", sub: ["OpenAI-compatible"], x: 1240, y: 150, detail: "The configured model provider behind the virtual key — reached only when Privilege permits the call." },
];

const EDGES = [
  ["user", "agent", "prompt", { detail: "The prompt (or prefilled attack payload) enters the console." }],
  ["agent", "gw", "one POST", { detail: "POST /api/privilege-mcp/llm/call — no provider credential in the browser." }],
  ["gw", "p1", "virtual key", { detail: "The BFF attaches the lane's Privilege virtual key; the provider key never leaves the server." }],
  ["p1", "llm", "verdict + call", { detail: "Permit: Privilege forwards to the provider. Deny: the request stops here and the verdict says why." }],
  ["llm", "user", "classified answer", { detail: "The console shows the outcome class — policy deny, provider refusal, or model answer — with evidence." }],
];

const walk = [
  {
    title: "Prompt in", label: "chat console",
    nodes: ["user", "agent"], edges: [0],
    lines: [{ who: "Alice", text: "Every prompt — benign or from the attack library — enters through the same console." }],
    tech: [{ t: "API", c: "/llm-gateway console  payload from guardrailAttackCatalog" }],
  },
  {
    title: "Through the BFF", label: "key custody",
    nodes: ["agent", "gw"], edges: [1],
    lines: [{ who: "BFF", text: "The browser never holds a provider credential; the BFF owns the key and the lane." }],
    tech: [{ t: "API", c: "POST /api/privilege-mcp/llm/call" }],
  },
  {
    title: "Privilege evaluates", label: "virtual key",
    nodes: ["gw", "p1"], edges: [2],
    lines: [{ who: "Privilege", text: "One virtual key per lane; the scan happens before the provider is contacted." }],
    tech: [
      { t: "POLICY", c: "prompt-injection scan · PII scan · malicious-content scan" },
      { t: "TOKEN", c: "virtual key — provider credential stays server-side" },
    ],
  },
  {
    title: "Permit reaches the model", label: "or deny stops here",
    nodes: ["p1", "llm"], edges: [3],
    lines: [{ who: "Agent Privilege", text: "A policy deny ends the call here — the provider never sees the prompt." }],
    tech: [{ t: "POLICY", c: "verdict: PERMIT -> forward | DENY -> 403, provider unreached" }],
  },
  {
    title: "Classified outcome", label: "answer + verdict",
    nodes: ["llm", "user"], edges: [4],
    lines: [{ who: "Console", text: "The outcome is classified: denied by policy, refused by provider, or answered — each with evidence." }],
    tech: [{ t: "API", c: "response: model text + policy verdict + decision class" }],
  },
];

export default {
  id: "UC-TOOL3",
  result: { label: "GATEWAY_VERDICT", tone: "info" },
  GROUPS: G,
  NODES,
  EDGES,
  walk,
};
