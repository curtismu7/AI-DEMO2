/**
 * UC4 — Overscoped agent. The agent asked for write when the job is read-only:
 * least-privilege narrows the token at the exchange, before any tool runs, and
 * the lookup completes on a read-only scope.
 */
import { PARTICIPANT_GROUPS as G } from "./palette";
import { RFC, SPEC } from "../pingStyleStandards";

const NODES = [
  { id: "user", group: "user", label: "Alice (user)", sub: ["show my balance"], x: 40, y: 150, detail: "An ordinary read. The scopes on her token are not the interesting part." },
  { id: "agent", group: "agent", label: "Banking agent", sub: ["asks for write too"], x: 340, y: 150, detail: "Requests more scope than the task needs — scope bloat is a standing escalation risk." },
  { id: "p1", group: "pingone", label: "PingOne", sub: ["least privilege"], x: 640, y: 150, detail: "Narrows the token at the exchange and checks scope against the tool in policy." },
];

const EDGES = [
  ["user", "agent", "signs in, asks balance", { detail: "Sign-in mints the user token; what the agent requests next is the test." }],
  ["agent", "p1", "RFC 8693 exchange", { detail: "The agent asked for write when it only needed read." }],
  ["p1", "agent", "narrowed token — read only", { dashed: true, detail: "Least privilege drops the write scope before any tool runs." }],
  ["agent", "p1", "authorize", { detail: "Policy compares the token's scope to what the tool requires — nothing more." }],
  ["p1", "agent", "PERMIT", { dashed: true, detail: "The read-only lookup completes; the token chain shows the narrowed scope." }],
];

const walk = [
  {
    title: "User signs in", label: "Ordinary read",
    nodes: ["user", "agent"], edges: [0],
    lines: [{ who: "Agent", text: "The session token is fine. The question is what the agent asks for next." }],
    tech: [{ t: "TOKEN", c: "sign-in AT: sub=alice, scopes incl. balance:read (write present but unneeded)" }],
  },
  {
    title: "Agent exchanges", label: "Scope narrows here",
    nodes: ["agent", "p1"], edges: [1, 2],
    lines: [{ who: "PingOne", text: "It asked for write when the job is read-only — the exchange is where that gets fixed." }],
    tech: [{ t: "TOKEN", c: "RFC 8693 -> agent AT: scope narrowed to balance:read (write dropped)" }],
  },
  {
    title: "Authorize checks scope", label: "Scope vs tool",
    nodes: ["p1", "agent"], edges: [3],
    lines: [{ who: "PingOne", text: "The topology surfaces any mismatch between effective scope and what the tools require." }],
    tech: [{ t: "POLICY", c: "Authorize: scope balance:read satisfies get_balance -> PERMIT" }],
  },
  {
    title: "Read-only lookup", label: "Least privilege on the record",
    nodes: ["agent", "p1"], edges: [4],
    lines: [{ who: "PingOne", text: "PERMIT — and the token chain shows the narrowed scope, auditable per agent." }],
    tech: [{ t: "API", c: "gateway dispatches get_balance; token chain shows narrowed scope" }],
  },
];

// Per-step detail: request forms use placeholders, tokens are decoded MOCK values, refs are published RFCs/specs or marked emerging drafts.
const steps = [
  {
    beats: [0],
    detail: {
      form: "POST /api/agent/run\nContent-Type: application/json\nCookie: <session cookie>\n\n{ \"messages\": [{ \"role\": \"user\", \"content\": \"show my balance\" }] }",
      tokens: [{
        note: "Sign-in access token (decoded mock) · write is present but not needed",
        header: { alg: "RS256", typ: "at+jwt" },
        claims: { iss: "https://auth.pingone.com/ENV_ID/as", sub: "alice-0001", aud: "https://bff.ping.demo", scope: "balance:read balance:write", exp: 1790000000 },
      }],
      refs: [RFC(6749, "Scope (section 3.3): what the token is allowed to do")],
    },
  },
  {
    beats: [1],
    detail: {
      form: "POST /as/token   (PingOne)\nContent-Type: application/x-www-form-urlencoded\n\ngrant_type=urn:ietf:params:oauth:grant-type:token-exchange\n&subject_token=<user access token>\n&subject_token_type=urn:ietf:params:oauth:token-type:access_token\n&actor_token=<agent token>\n&actor_token_type=urn:ietf:params:oauth:token-type:access_token\n&scope=balance:read balance:write\n\n-> 200 access token with scope=balance:read (write dropped by least privilege)",
      tokens: [
        { note: "Input · subject_token (user access token, decoded mock)", header: { alg: "RS256", typ: "at+jwt" }, claims: { iss: "https://auth.pingone.com/ENV_ID/as", sub: "alice-0001", scope: "balance:read balance:write" } },
        { note: "Output · narrowed agent token (decoded mock)", header: { alg: "RS256", typ: "at+jwt" }, claims: { iss: "https://auth.pingone.com/ENV_ID/as", sub: "alice-0001", scope: "balance:read", act: { sub: "banking-agent-client" }, exp: 1790000300 } },
      ],
      refs: [RFC(8693, "Token Exchange: the issued scope may be narrower than requested"), RFC(6749, "Scope (section 3.3)")],
    },
  },
  {
    beats: [2],
    detail: {
      form: "PingOne Authorize decision request\n\nsubject: alice-0001, actor: banking-agent-client\nresource: tool get_balance (requires balance:read)\ntoken scope: balance:read\n\n-> PERMIT",
      tokens: [],
      refs: [SPEC("OpenID AuthZEN", "Standard PEP to PDP authorization API")],
    },
  },
  {
    beats: [3],
    detail: {
      form: "POST /mcp\nAuthorization: Bearer <narrowed agent token>\nContent-Type: application/json\n\n{ \"jsonrpc\": \"2.0\", \"id\": 1, \"method\": \"tools/call\",\n  \"params\": { \"name\": \"get_balance\", \"arguments\": {} } }",
      tokens: [],
      refs: [RFC(6750, "Bearer token usage"), RFC(9068, "JWT profile for access tokens (scope checked at the resource)")],
    },
  },
];

export default {
  id: "UC4",
  result: { label: "PERMIT", tone: "ok" },
  pingStyle: true,
  GROUPS: G,
  NODES,
  EDGES,
  walk,
  steps,
};
