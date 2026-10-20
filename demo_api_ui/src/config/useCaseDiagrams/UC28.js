/**
 * UC28 — Tool set as the authorization boundary (Air Canada pattern). Asked
 * to waive a fee, the agent can only call request_fee_waiver, which logs a
 * request for human review and cannot grant a waiver. No tool can promise one,
 * so the LLM cannot hallucinate one — the catalog itself is the boundary,
 * modeled on the 2024 Air Canada chatbot case.
 */
import { PARTICIPANT_GROUPS as G } from "./palette";
import { RFC, MCP } from "../pingStyleStandards";

const NODES = [
  { id: "user", group: "user", label: "Alice (user)", sub: ["asks for a waiver"], x: 40, y: 150, detail: "\"Can you waive the fee on my checking account?\" — whatever the agent replies, it is backed by a real audited tool call." },
  { id: "agent", group: "agent", label: "Banking agent", sub: ["LLM promise-maker"], x: 440, y: 150, detail: "Can only call request_fee_waiver: it logs a request for human review. No tool in its catalog grants a waiver, so none can be promised." },
  { id: "gw", group: "gateway", label: "Agent gateway", sub: ["tool catalog"], x: 840, y: 150, detail: "The catalog is the authorization boundary — the agent cannot invent a tool, and the gateway dispatches only what exists." },
  { id: "res", group: "resource", label: "Fee-waiver request", sub: ["request-only tool"], x: 1240, y: 150, detail: "request_fee_waiver records the ask for human review. It cannot grant anything — a human decides later." },
];

const EDGES = [
  ["user", "agent", "waive my fee", { detail: "The ask invites the LLM to promise something — the tool set is what answers." }],
  ["agent", "gw", "request_fee_waiver", { detail: "The only callable option: a request, not a grant. The LLM's wording cannot widen it." }],
  ["gw", "res", "dispatch the request", { detail: "A real audited tool call — the reply is grounded in what actually ran." }],
  ["res", "user", "logged for human review", { detail: "The agent's answer reports a logged request; the waiver itself needs a human." }],
];

const walk = [
  {
    title: "The inviting ask", label: "Prompt-engineering bait",
    nodes: ["user", "agent"], edges: [0],
    lines: [{ who: "Alice", text: "The question is exactly the shape that got the Air Canada chatbot in trouble: can you promise this?" }],
    tech: [{ t: "API", c: "chat: \"Can you waive the fee on my checking account?\"" }],
  },
  {
    title: "Agent picks its tool", label: "Request-only option",
    nodes: ["agent", "gw"], edges: [1],
    lines: [{ who: "Agent", text: "There is no grant-waiver tool to call — request_fee_waiver is the whole menu." }],
    tech: [{ t: "POLICY", c: "tool catalog: no tool grants a waiver; request_fee_waiver logs a request for human review" }],
  },
  {
    title: "Gateway dispatches", label: "Real, audited call",
    nodes: ["gw", "res"], edges: [2],
    lines: [{ who: "Gateway", text: "Only tools that exist run; the reply is backed by this dispatch, not by the model's confidence." }],
    tech: [{ t: "API", c: "POST /gateway/mcp tools/call request_fee_waiver -> 200 (logged, human review pending)" }],
  },
  {
    title: "Honest answer", label: "Grounded in the trace",
    nodes: ["res", "user"], edges: [3],
    lines: [{ who: "Agent", text: "It can say a request was filed for human review — and nothing more, whatever the prompt says." }],
    tech: [{ t: "POLICY", c: "reply grounded in tool call: request logged; agent structurally cannot promise the waiver" }],
  },
];

// Per-step detail. request_fee_waiver is a real gateway tool (ping-gateway/config/mcp-tool-schemas.json): inputs account_id + reason, required scope write.
const steps = [
  {
    beats: [0],
    detail: {
      form: "POST /api/agent/invoke\nCookie: <BFF session cookie>\nContent-Type: application/json\n\n{ \"prompt\": \"Can you waive the fee on my checking account?\", \"vertical\": \"banking\" }",
      tokens: [],
      refs: [],
    },
  },
  {
    beats: [1],
    detail: {
      form: "tools/list (what the agent can call)\n\n{ \"name\": \"request_fee_waiver\",\n  \"inputSchema\": { \"properties\": { \"account_id\": { \"type\": \"string\" }, \"reason\": { \"type\": \"string\" } } } }\n\nNo tool in the catalog grants a waiver. The agent cannot invent a tool, so it cannot promise one.",
      tokens: [],
      refs: [...MCP.filter((r) => r.id === "MCP authorization 2025-11-25")],
    },
  },
  {
    beats: [2],
    detail: {
      form: "POST /gateway/mcp\nAuthorization: Bearer <delegated access token>\nContent-Type: application/json\n\n{ \"jsonrpc\": \"2.0\", \"id\": 1, \"method\": \"tools/call\",\n  \"params\": { \"name\": \"request_fee_waiver\", \"arguments\": { \"account_id\": \"{accountId}\", \"reason\": \"<reason>\" } } }\n\n-> 200: request logged, human review pending",
      tokens: [{
        note: "MOCK decoded delegated token · the tool's required scope is write",
        header: { alg: "RS256", typ: "at+jwt" },
        claims: { iss: "https://auth.pingone.com/ENV_ID/as", sub: "alice-0001", aud: "https://mcp.ping.demo", scope: "write", act: { sub: "agent-0001" }, exp: 1790000000 },
      }],
      refs: [RFC(6750, "Bearer token usage"), RFC(8693, "act claim: the agent acting for Alice")],
    },
  },
  {
    beats: [3],
    detail: {
      form: "Agent reply (grounded in the tool result)\n\n\"I have filed a fee-waiver request for human review. I cannot grant a waiver.\"\n\nNo wire credential here: the reply is chat text generated from the audited call above.",
      tokens: [],
    },
  },
];

export default {
  id: "UC28",
  result: { label: "PERMIT", tone: "ok" },
  pingStyle: true,
  GROUPS: G,
  NODES,
  EDGES,
  walk,
  steps,
};
