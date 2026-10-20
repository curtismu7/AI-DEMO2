/**
 * UC46A — Privilege A2A access review in the agent. The same review UC46
 * diagrams, seen from inside the agent: the analyst asks the MainAgent in
 * chat, its LLM loop delegates to the WorkerAgent over A2A, and the worker's
 * evidence comes from MCP calls through PingOne Privilege Gateway.
 */
import { PARTICIPANT_GROUPS as G } from "./palette";
import { RFC, SPEC, MCP, AUTHZ } from "../pingStyleStandards";

const NODES = [
  { id: "analyst", group: "user", label: "Analyst", sub: ["asks in chat"], x: 40, y: 150, detail: "Types the access-review question to the agent — no console clicks; the agent does the gathering." },
  { id: "main", group: "agent", label: "MainAgent", sub: ["LLM loop"], x: 440, y: 150, detail: "Its LLM loop decides to delegate the review to a specialist rather than answer from its own context." },
  { id: "worker", group: "agent", label: "WorkerAgent", sub: ["A2A specialist"], x: 840, y: 150, detail: "Receives the A2A task and gathers the evidence itself, presenting its own Agent Access key." },
  { id: "pgw", group: "gateway", label: "Privilege Gateway", sub: ["key + policy"], x: 1240, y: 150, detail: "Validates the worker's key and applies policy to each LLM, A2A and MCP call it makes." },
  { id: "mcp", group: "resource", label: "MCP evidence", sub: ["guardrailed"], x: 1640, y: 150, detail: "Tool results pass the guardrail: personal data redacted, a poisoned result blocked." },
];

const EDGES = [
  ["analyst", "main", "review question", { detail: "Plain-language ask in the agent chat; the run executes without further prompting." }],
  ["main", "worker", "A2A: delegate", { detail: "The question travels as an A2A message — no browser token rides along." }],
  ["worker", "pgw", "key checked", { detail: "Each agent presents its own Agent Access key at the gateway." }],
  ["pgw", "mcp", "governed MCP calls", { detail: "Policy and the guardrail apply to each evidence-gathering call." }],
  ["main", "analyst", "evidence-backed answer", { detail: "The reply returns over A2A to MainAgent, then to the analyst with the evidence attached." }],
];

const walk = [
  {
    title: "Analyst asks", label: "in the agent",
    nodes: ["analyst", "main"], edges: [0],
    lines: [{ who: "Analyst", text: "Asks the agent to review access — the point is that the agent, not a console, drives the review." }],
    tech: [{ t: "API", c: "agent chat: access-review question" }],
  },
  {
    title: "Delegation", label: "A2A message",
    nodes: ["main", "worker"], edges: [1],
    lines: [{ who: "MainAgent", text: "Its LLM loop hands the task to the worker specialist; identity travels as agent keys, not a user session." }],
    tech: [{ t: "A2A", c: "task delegated MainAgent -> WorkerAgent (no browser token)" }],
  },
  {
    title: "Key checked", label: "at the gateway",
    nodes: ["worker", "pgw"], edges: [2],
    lines: [{ who: "Gateway", text: "The worker's Agent Access key and scope are validated before any tool call." }],
    tech: [{ t: "POLICY", c: "Agent Access key + a2a scope validated" }],
  },
  {
    title: "Evidence gathered", label: "guardrailed MCP",
    nodes: ["pgw", "mcp"], edges: [3],
    lines: [{ who: "MCP tools", text: "Every call passes policy and the guardrail — poisoned results are blocked, personal data redacted." }],
    tech: [{ t: "API", c: "MCP tools/call through Privilege Gateway -> guardrailed results" }],
  },
  {
    title: "Answer with evidence", label: "back to the analyst",
    nodes: ["main", "analyst"], edges: [4],
    lines: [{ who: "MainAgent", text: "The answer returns over A2A with the evidence attached — reviewable, not asserted." }],
    tech: [{ t: "A2A", c: "WorkerAgent -> MainAgent -> analyst (evidence attached)" }],
  },
];

// Per-step detail. Agent Access keys are opaque, so no JWT is decoded on these hops (tokens: [] with the reason in the form).
const A2A = SPEC("A2A protocol", "Agent2Agent message/send, JSON-RPC over HTTP");
const steps = [
  {
    beats: [0],
    detail: {
      form: `Agent chat message (BFF session cookie; no token reaches the browser)

{ "prompt": "Review who has access to the payments tools and show the evidence" }

No OAuth token is minted on this hop, so there is nothing to decode.`,
      tokens: [],
    },
  },
  {
    beats: [1],
    detail: {
      form: `POST {worker A2A endpoint}
A2A-Version: 1.0
Authorization: Bearer <MainAgent Agent Access key>
Content-Type: application/json

{ "jsonrpc": "2.0", "id": 1, "method": "message/send",
  "params": { "message": { "role": "user", "parts": [{ "kind": "text", "text": "<review task>" }] } } }

Agent keys are opaque, so there is no JWT to decode here.`,
      tokens: [],
      refs: [A2A, RFC(6750, "Bearer token usage")],
    },
  },
  {
    beats: [2],
    detail: {
      form: `{Privilege Gateway} receives the worker's first call
Authorization: Bearer <WorkerAgent Agent Access key>

Checks in order: key valid -> a2a scope present -> policy for this agent.
An out-of-scope key is refused here, before any tool call.`,
      tokens: [],
      refs: [AUTHZ[0], RFC(6750, "Bearer token usage")],
    },
  },
  {
    beats: [3],
    detail: {
      form: `POST {Privilege Gateway}/mcp
Authorization: Bearer <WorkerAgent Agent Access key>
Content-Type: application/json

{ "jsonrpc": "2.0", "id": 2, "method": "tools/call",
  "params": { "name": "<evidence tool>", "arguments": { } } }

The result passes the guardrail: personal data redacted, a poisoned result blocked.`,
      tokens: [],
      refs: [MCP[0]],
    },
  },
  {
    beats: [4],
    detail: {
      form: `{ "jsonrpc": "2.0", "id": 1,
  "result": { "kind": "message", "role": "agent", "parts": [{ "kind": "text", "text": "<findings with evidence>" }] } }`,
      tokens: [],
      refs: [A2A],
    },
  },
];

export default {
  pingStyle: true,
  id: "UC46A",
  result: { label: "A2A_ACCESS_REVIEW", tone: "info" },
  GROUPS: G,
  NODES,
  EDGES,
  walk,
  steps,
};
