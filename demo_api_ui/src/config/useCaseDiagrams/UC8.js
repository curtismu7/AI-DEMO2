/**
 * UC8 — MCP App transfer approval (HITL). The consent shape: a $300 transfer
 * draws a human-in-the-loop obligation, the call pauses, a consent modal opens,
 * and a single-use approval receipt re-evaluates the same call to PERMIT.
 */
import { PARTICIPANT_GROUPS as G } from "./palette";

const NODES = [
  { id: "user", group: "user", label: "Alice (user)", sub: ["Approves in modal"], x: 340, y: 330, detail: "Sees the consent modal and approves the $300 transfer — the transfer does not run until she does." },
  { id: "agent", group: "agent", label: "Banking agent", sub: ["transfer $300"], x: 340, y: -40, detail: "Attempts the transfer with the delegated token. Nothing is unusual yet." },
  { id: "gw", group: "gateway", label: "Agent gateway", sub: ["pauses the call"], x: 340, y: 150, detail: "Holds the tool call while the obligation is unsatisfied — nothing runs." },
  { id: "p1", group: "pingone", label: "PingOne Authorize", sub: ["HITL obligation"], x: 640, y: 150, detail: "The amount falls in the consent band: the answer is an obligation, not PERMIT or DENY." },
];

const EDGES = [
  ["agent", "gw", "create_transfer $300", { detail: "A normal governed call — until policy answers.", vertical: true }],
  ["gw", "p1", "evaluate", { detail: "The gateway always asks before dispatching." }],
  ["p1", "gw", "obligation: HITL", { detail: "Consent band: human approval required before this action." }],
  ["gw", "user", "consent modal", { detail: "The BFF surfaces the challenge; the transfer waits.", vertical: true }],
  ["user", "gw", "approval receipt", { detail: "A verified receipt bound to user, agent and tool.", lane: -60 }],
  ["gw", "agent", "re-run -> PERMIT", { detail: "The same call re-runs carrying the receipt; Authorize sees the obligation satisfied.", lane: -60 }],
];

const walk = [
  {
    title: "Agent attempts the transfer", label: "Nothing unusual yet",
    nodes: ["agent", "gw"], edges: [0],
    lines: [{ who: "Agent", text: "create_transfer for $300 goes out with the delegated token." }],
    tech: [{ t: "API", c: "POST /gateway/mcp tools/call create_transfer amount=300" }],
  },
  {
    title: "Authorize answers HITL", label: "Consent band, not PERMIT",
    nodes: ["gw", "p1"], edges: [1],
    lines: [{ who: "PingOne", text: "This amount needs a human. The answer is an obligation." }],
    tech: [{ t: "POLICY", c: "amount in consent band -> obligation: HITL (not PERMIT, not DENY)" }],
  },
  {
    title: "Gateway pauses", label: "No tool runs",
    nodes: ["p1", "gw"], edges: [2],
    lines: [{ who: "Gateway", text: "The call holds: -32002 / hitl_required." }],
    tech: [{ t: "API", c: "gateway returns -32002 hitl_required; tool dispatch withheld" }],
  },
  {
    title: "Consent modal opens", label: "Human sees the ask",
    nodes: ["gw", "user"], edges: [3],
    lines: [{ who: "Alice", text: "The modal names exactly what is being requested — approve $300 to savings." }],
    tech: [{ t: "API", c: "BFF renders consent modal (user, agent, tool bound)" }],
  },
  {
    title: "User approves", label: "Single-use receipt",
    nodes: ["user", "gw"], edges: [4],
    lines: [{ who: "Gateway", text: "A verified approval receipt is recorded — one use, this call only." }],
    tech: [{ t: "TOKEN", c: "approval receipt: sub=alice, act=agent, tool=create_transfer (single-use)" }],
  },
  {
    title: "Re-evaluated to PERMIT", label: "Same call, obligation met",
    nodes: ["gw", "agent"], edges: [5],
    lines: [{ who: "Agent", text: "The transfer executes — with the approval on the record." }],
    tech: [{ t: "POLICY", c: "Authorize re-evaluates with receipt: obligation satisfied -> PERMIT" }],
  },
];

// Per-step detail. Tokens are decoded MOCK values. The -32002 error mirrors demo_mcp_gateway/src/index.ts (HITL branch);
// the consent-challenge routes are in routes/transactions.js.
const steps = [
  {
    beats: [0],
    detail: {
      form: "POST /gateway/mcp\nAuthorization: Bearer <delegated access token>\nContent-Type: application/json\n\n{ \"jsonrpc\": \"2.0\", \"id\": 1, \"method\": \"tools/call\",\n  \"params\": { \"name\": \"create_transfer\", \"arguments\": { \"amount\": 300, \"fromAccountId\": \"{fromAccountId}\", \"toAccountId\": \"{toAccountId}\" } } }",
      tokens: [{
        note: "Delegated agent token · user subject, agent in act",
        header: { alg: "RS256", typ: "at+jwt" },
        claims: { iss: "https://auth.pingone.com/ENV_ID/as", sub: "alice-0001", aud: "https://mcp.ping.demo", scope: "banking:transactions:write", act: { sub: "agent-0001" }, exp: 1790000000 },
      }],
      refs: [{ id: "RFC 8693", title: "OAuth 2.0 Token Exchange (the act claim carries the agent)", kind: "rfc" }],
    },
  },
  {
    beats: [1],
    detail: {
      form: "PingOne Authorize decision request\n\nsubject: alice-0001, actor: agent-0001\nresource: tool create_transfer\nattributes: { amount: 300 }\n\nadvice: HITL consent band (not PERMIT, not DENY)",
    },
  },
  {
    beats: [2],
    detail: {
      form: "{ \"jsonrpc\": \"2.0\", \"id\": 1,\n  \"error\": { \"code\": -32002, \"message\": \"Human approval required\",\n    \"data\": { \"hitl\": true, \"tool\": \"create_transfer\", \"challengeId\": \"{challengeId}\",\n              \"expiresAt\": \"<ISO time>\", \"challenge_type\": \"<type>\",\n              \"instructions\": \"Approve at dashboard, then retry with _hitl_challenge_id in arguments\" } } }",
    },
  },
  {
    beats: [3],
    detail: {
      form: "POST /api/transactions/consent-challenge\nCookie: <BFF session cookie>\nContent-Type: application/json\n\n{ \"type\": \"transfer\", \"amount\": 300, \"fromAccountId\": \"{fromAccountId}\", \"toAccountId\": \"{toAccountId}\" }\n\n-> 201 { \"challengeId\": \"{challengeId}\", \"expiresAt\": \"<ISO time>\", \"snapshot\": { ... } }",
    },
  },
  {
    beats: [4],
    detail: {
      form: "POST /api/transactions/consent-challenge/{challengeId}/confirm\nCookie: <BFF session cookie>\n\n-> 200 { \"challengeId\": \"{challengeId}\", \"consentOnly\": true, \"confirmExpiresAt\": \"<ISO time>\" }",
      tokens: [{
        note: "Approval receipt (decoded mock) · bound to user, agent and tool; single use",
        claims: { sub: "alice-0001", act: { sub: "agent-0001" }, tool: "create_transfer", amount: 300, challengeId: "{challengeId}", singleUse: true },
      }],
    },
  },
  {
    beats: [5],
    detail: {
      form: "POST /gateway/mcp\nAuthorization: Bearer <delegated access token>\nContent-Type: application/json\n\n{ \"jsonrpc\": \"2.0\", \"id\": 2, \"method\": \"tools/call\",\n  \"params\": { \"name\": \"create_transfer\", \"arguments\": { \"amount\": 300, \"fromAccountId\": \"{fromAccountId}\", \"toAccountId\": \"{toAccountId}\", \"_hitl_challenge_id\": \"{challengeId}\" } } }",
    },
  },
];

export default {
  id: "UC8",
  slug: "hitl-consent",
  hopHints: {
    signin: ["user"], prompt: ["user"], agent: ["agent"], llm: ["agent"],
    "agent-token": ["agent"], exchange: ["gw", "p1"], authorize: ["gw", "p1"],
    stepup: ["gw", "user"], gateway: ["gw"], "tools-list": ["agent", "gw"],
    "tools-list-challenge": ["agent", "gw"], "tools-call-challenge": ["agent", "gw"],
    mcp: ["gw"], api: ["gw"], reply: ["agent", "user"],
  },
  result: { label: "CONSENT", tone: "warn" },
  pingStyle: true,
  GROUPS: G,
  NODES,
  EDGES,
  walk,
  steps,
};
