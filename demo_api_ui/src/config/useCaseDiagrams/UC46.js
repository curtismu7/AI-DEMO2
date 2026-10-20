/**
 * UC46 — Privilege A2A access review. A MainAgent delegates an access-review
 * question over A2A to a WorkerAgent, which gathers evidence through MCP
 * behind the PingOne Privilege Gateway. The A2A message carries the question
 * and result — not a browser token, not an RFC 8693 exchange.
 */
import { PARTICIPANT_GROUPS as G } from "./palette";
import { RFC, SPEC } from "../pingStyleStandards";

const NODES = [
  { id: "main", group: "agent", label: "MainAgent", sub: ["receives question"], x: 40, y: 150, detail: "Takes the access-review question on the Privilege MCP client page's A2A tab." },
  { id: "worker", group: "agent", label: "WorkerAgent", sub: ["specialist"], x: 340, y: 150, detail: "Receives the delegated question and gathers the evidence itself." },
  { id: "pgw", group: "gateway", label: "Privilege Gateway", sub: ["Agent Access keys"], x: 640, y: 150, detail: "Validates each agent's key and applies gateway policy to its LLM, A2A and MCP calls." },
  { id: "mcp", group: "resource", label: "MCP evidence", sub: ["guardrailed"], x: 940, y: 150, detail: "Tool results pass the guardrail: personal data redacted, a poisoned result blocked." },
  ];

const EDGES = [
  ["main", "worker", "A2A delegate", { detail: "The question travels as an A2A message — no browser token rides along." }],
  ["pgw", "mcp", "governed MCP calls", { detail: "Policy and the guardrail apply to each evidence-gathering call." }],
  ["worker", "main", "A2A: evidence-backed answer", { detail: "The reply travels back over A2A with the evidence attached." }],
  ["worker", "pgw", "key checked", { detail: "Each agent presents its own Agent Access key at the gateway." }],
];

const walk = [
  {
    title: "Analyst asks", label: "On the A2A tab",
    nodes: ["main"], edges: [],
    lines: [{ who: "Analyst", text: "Types the access-review question; the card opens the tab but never submits for you." }],
    tech: [{ t: "A2A", c: "access-review question submitted to MainAgent" }],
  },
  {
    title: "Delegated over A2A", label: "Message, not token",
    nodes: ["main", "worker"], edges: [0],
    lines: [{ who: "MainAgent", text: "The question travels as an A2A message — not a browser token, not an exchange." }],
    tech: [{ t: "A2A", c: "SendMessage: access-review question -> WorkerAgent" }],
  },
  {
    title: "Keys validated", label: "Who may call whom",
    nodes: ["worker", "pgw"], edges: [3],
    lines: [{ who: "Gateway", text: "Each agent's Agent Access key and its a2a scope are checked at every hop." }],
    tech: [{ t: "POLICY", c: "Agent Access key validated; a2a scope present" }],
  },
  {
    title: "Evidence gathered", label: "Behind the gateway",
    nodes: ["pgw", "mcp"], edges: [1],
    lines: [{ who: "WorkerAgent", text: "MCP calls for evidence — each one policed by policy and the guardrail." }],
    tech: [{ t: "POLICY", c: "guardrail: PII redacted; poisoned tool result blocked" }],
  },
  {
    title: "Evidence-backed answer", label: "Back over A2A",
    nodes: ["worker", "main"], edges: [2],
    lines: [{ who: "Presenter", text: "The analyst gets the evidence, visibly governed the whole way." }],
    tech: [{ t: "A2A", c: "SendMessage: evidence-backed result -> MainAgent" }],
  },
];

// Per-step detail: request forms use placeholders, tokens are decoded MOCK values, refs are published RFCs/specs or marked emerging drafts.
const steps = [
  {
    beats: [0],
    detail: {
      form: "Analyst types the access-review question on the A2A tab of the Privilege MCP client page.\nThe card opens the tab but never submits for you.",
      tokens: [],
      refs: [SPEC("A2A Agent Card", "How agents advertise what they accept")],
    },
  },
  {
    beats: [1],
    detail: {
      form: "POST <WorkerAgent A2A endpoint>   (via the Privilege Gateway)\nA2A-Version: 1.0\nContent-Type: application/json\n\n{ \"jsonrpc\": \"2.0\", \"id\": 1, \"method\": \"SendMessage\",\n  \"params\": { \"message\": { \"messageId\": \"<uuid>\", \"role\": \"ROLE_USER\", \"parts\": [{ \"text\": \"<access-review question>\", \"mediaType\": \"text/plain\" }] } } }\n\nThe message carries the question only: no browser token, no RFC 8693 exchange.",
      tokens: [],
      refs: [SPEC("A2A Protocol 1.0", "SendMessage between agents"), SPEC("JSON-RPC 2.0", "Message envelope")],
    },
  },
  {
    beats: [2],
    detail: {
      form: "Each agent call to the Privilege Gateway carries its own Agent Access key\n\nAuthorization: Bearer <agent access key>\n\ngateway checks: key valid, a2a scope present, policy for this hop",
      tokens: [],
      refs: [RFC(6750, "Bearer credential presentation")],
    },
  },
  {
    beats: [3],
    detail: {
      form: "POST /mcp   (via the Privilege Gateway)\nAuthorization: Bearer <agent access key>\nContent-Type: application/json\n\n{ \"jsonrpc\": \"2.0\", \"id\": 2, \"method\": \"tools/call\",\n  \"params\": { \"name\": \"<evidence tool>\", \"arguments\": {} } }\n\nGuardrail on the result: personal data redacted, a poisoned tool result blocked",
      tokens: [],
      refs: [SPEC("MCP specification 2025-11-25", "Model Context Protocol tools/call")],
    },
  },
  {
    beats: [4],
    detail: {
      form: "-> JSON-RPC result from WorkerAgent\n{ \"jsonrpc\": \"2.0\", \"id\": 1,\n  \"result\": { \"message\": { \"role\": \"ROLE_AGENT\", \"parts\": [{ \"text\": \"<evidence-backed answer>\", \"mediaType\": \"text/plain\" }] } } }",
      tokens: [],
      refs: [SPEC("A2A Protocol 1.0", "SendMessage response")],
    },
  },
];

export default {
  id: "UC46",
  result: { label: "REVIEW", tone: "info" },
  pingStyle: true,
  GROUPS: G,
  NODES,
  EDGES,
  walk,
  steps,
};
