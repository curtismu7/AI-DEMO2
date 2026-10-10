/**
 * UC46A — Privilege A2A access review in the agent. The same review UC46
 * diagrams, seen from inside the agent: the analyst asks the MainAgent in
 * chat, its LLM loop delegates to the WorkerAgent over A2A, and the worker's
 * evidence comes from MCP calls through PingOne Privilege Gateway.
 */
import { PARTICIPANT_GROUPS as G } from "./palette";

const NODES = [
  { id: "analyst", group: "user", label: "Analyst", sub: ["asks in chat"], x: 40, y: 150, detail: "Types the access-review question to the agent — no console clicks; the agent does the gathering." },
  { id: "main", group: "agent", label: "MainAgent", sub: ["LLM loop"], x: 340, y: 150, detail: "Its LLM loop decides to delegate the review to a specialist rather than answer from its own context." },
  { id: "worker", group: "agent", label: "WorkerAgent", sub: ["A2A specialist"], x: 640, y: 150, detail: "Receives the A2A task and gathers the evidence itself, presenting its own Agent Access key." },
  { id: "pgw", group: "gateway", label: "Privilege Gateway", sub: ["key + policy"], x: 940, y: 150, detail: "Validates the worker's key and applies policy to each LLM, A2A and MCP call it makes." },
  { id: "mcp", group: "resource", label: "MCP evidence", sub: ["guardrailed"], x: 1240, y: 150, detail: "Tool results pass the guardrail: personal data redacted, a poisoned result blocked." },
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

export default {
  id: "UC46A",
  result: { label: "A2A_ACCESS_REVIEW", tone: "info" },
  GROUPS: G,
  NODES,
  EDGES,
  walk,
};
