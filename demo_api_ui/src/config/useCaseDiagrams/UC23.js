/**
 * UC23 — Progressive trust demo — presenter guide. A link card to /use-cases
 * framing a five-act presenter journey — public catalog, delegated access,
 * human consent, MFA step-up, optional CIBA, policy deny — then handing off to
 * the dashboard with Token Chain and Activity panels open. The card is a guide
 * and runs no tool itself.
 */
import { PARTICIPANT_GROUPS as G } from "./palette";

const NODES = [
  { id: "user", group: "user", label: "Presenter + Alice", sub: ["runs Acts 1-5", "plays Alice"], x: 40, y: 150, detail: "Clicks the guide card, then plays Alice: browses anonymously, signs in when value is clear, and approves out-of-band when policy demands a human." },
  { id: "agent", group: "agent", label: "Personal agent", sub: ["LLM-routed", "never holds tokens"], x: 340, y: 150, detail: "Routes each natural-language ask to a tool via Helix, llama.cpp, or Google — it presents tokens the BFF mints but never owns credentials of its own." },
  { id: "gw", group: "gateway", label: "Agent gateway / BFF", sub: ["Authorize check", "RFC 8693"], x: 640, y: 150, detail: "Enforces PingOne Authorize on every protected tool call and re-exchanges the user token downscoped to the MCP audience." },
  { id: "p1", group: "pingone", label: "PingOne", sub: ["graded decisions", "CIBA"], x: 940, y: 150, detail: "Returns the graded verdict — PERMIT, HITL obligation, MFA step-up, CIBA requirement, or DENY — from tool sensitivity and transaction context." },
  { id: "tool", group: "resource", label: "Banking tools", sub: ["public + protected", "scope per call"], x: 1240, y: 150, detail: "Public catalog tools serve anonymous asks with no gateway in path; protected tools run only for downscoped, obligation-cleared tokens." },
];

const EDGES = [
  ["user", "agent", "asks anonymously", { detail: "Public catalog answers with no Authorization header — trust starts at zero." }],
  ["agent", "gw", "user token", { detail: "Value proven, Alice signs in; the protected ask rides her token and the gateway validates the client before policy." }],
  ["gw", "p1", "Authorize grades", { detail: "Authorize grades each ask before any tool runs — HITL, MFA step-up, CIBA, or hard DENY." }],
  ["p1", "tool", "re-eval -> PERMIT", { detail: "Once the human approves — in-session MFA or out-of-band — policy re-evaluates to PERMIT and the downscoped call dispatches." }],
  ["tool", "user", "verdict on screen", { detail: "The $2,500 ask stops at the ceiling, and the whole run stays visible in Token Chain and Activity." }],
];

const walk = [
  {
    title: "Act 1 — public catalog", label: "no sign-in yet",
    nodes: ["user", "agent"], edges: [0],
    lines: [{ who: "Agent", text: "\"What branches are near me?\" is answered without authentication — low friction before any trust is granted." }],
    tech: [
      { t: "API", c: "tools/call get_branch_hours — public catalog path, no Authorization header" },
      { t: "POLICY", c: "public path bypasses gateway and PingOne Authorize by design" },
    ],
  },
  {
    title: "Act 2 — delegated access", label: "sign in, then delegate",
    nodes: ["agent", "gw"], edges: [1],
    lines: [{ who: "Agent", text: "Value proven, Alice signs in; the agent calls a protected tool with her token and the gateway validates the client before policy." }],
    tech: [
      { t: "API", c: "POST /gateway/mcp tools/call — Authorization: Bearer <user AT>" },
      { t: "TOKEN", c: "RFC 8693 exchange -> agent AT: act={sub:agent, sub:alice}" },
    ],
  },
  {
    title: "Acts 3-4 — the policy ladder", label: "HITL · step-up · CIBA",
    nodes: ["gw", "p1"], edges: [2],
    lines: [{ who: "Gateway", text: "Authorize grades each ask before any tool runs: $300 -> HITL consent, $600 -> MFA step-up, agent money movement -> CIBA out-of-band, $2,500 -> hard DENY." }],
    tech: [
      { t: "POLICY", c: "Authorize decision by amount + agent context: HITL(300) / STEP_UP(600) / CIBA obligation / DENY(2500)" },
      { t: "TOKEN", c: "re-evaluation requires the obligation receipt: HitlApproved=true, MFA success, or auth_req_id approval" },
    ],
  },
  {
    title: "Obligation cleared — dispatch", label: "re-eval -> PERMIT",
    nodes: ["p1", "tool"], edges: [3],
    lines: [{ who: "PingOne", text: "Once the human approves — in-session MFA or out-of-band on her phone — policy re-evaluates to PERMIT and the downscoped call dispatches." }],
    tech: [
      { t: "TOKEN", c: "agent AT: scp=transfers:write, act={sub:agent, sub:alice}" },
      { t: "API", c: "tool dispatch -> 200 (CIBA: poll token after user approves auth_req_id on her device)" },
    ],
  },
  {
    title: "Act 5 — the story, proven", label: "deny + verdict on screen",
    nodes: ["tool", "user"], edges: [4],
    lines: [{ who: "Presenter", text: "The $2,500 ask hits the ceiling and stops — and the whole run is visible: five acts, one Token Chain, nothing collapsed into one token." }],
    tech: [
      { t: "POLICY", c: "$2,500 over the ceiling -> DENY; the gateway stops the call before any tool runs" },
      { t: "API", c: "Token Chain: authorize-decision -> token-exchange -> tool-dispatched -> ciba-poll" },
    ],
  },
];

// Per-step detail. Forms mirror the real routes (POST /api/agent/invoke, the 428 envelope of
// services/mcpToolPipeline.js, POST /api/ciba-login/*). Tokens are decoded MOCK values.
const steps = [
  {
    beats: [0],
    detail: {
      form: "POST /api/agent/invoke\nContent-Type: application/json\n\n{ \"prompt\": \"What branches are near me?\", \"vertical\": \"super-sports\" }\n\n(no Authorization header, no session: the public catalog answers anonymously)",
    },
  },
  {
    beats: [1],
    detail: {
      form: "POST /api/agent/invoke\nCookie: <BFF session cookie>\nContent-Type: application/json\n\n{ \"prompt\": \"show my balance\", \"vertical\": \"super-sports\" }",
      tokens: [{
        note: "Exchanged agent token · downscoped, delegated on Alice's behalf",
        header: { alg: "RS256", typ: "at+jwt" },
        claims: {
          iss: "https://auth.pingone.com/ENV_ID/as",
          sub: "user-alice-0001",
          aud: "https://mcp.ping.demo",
          scope: "banking:read",
          act: { sub: "agent-client-0001" },
          exp: 1790000000,
        },
      }],
      refs: [
        { id: "RFC 8693", title: "OAuth 2.0 Token Exchange (act claim for delegation)", kind: "rfc" },
        { id: "RFC 8707", title: "Resource Indicators for OAuth 2.0 (audience of the downscoped token)", kind: "rfc" },
      ],
    },
  },
  {
    beats: [2],
    detail: {
      form: "HTTP/1.1 428\n\n{ \"error\": \"mcp_hitl_required\",\n  \"error_description\": \"This transaction requires human approval. Confirm it on the dashboard to continue.\",\n  \"hitl\": { \"type\": \"consent\" },\n  \"authorize_engine\": \"local\" }\n\n(step-up variant: error \"mcp_step_up_required\", with step_up_method / step_up_acr)",
    },
  },
  {
    beats: [3],
    detail: {
      form: "POST /api/ciba-login/start\nContent-Type: application/json\n\n{ \"channel\": \"{channel}\" }\n\nGET /api/ciba-login/poll/{authReqId}   (authReqId is 48 hex chars; 403 { \"status\": \"denied\" }, 410 { \"status\": \"expired\" })",
      refs: [{ id: "OpenID CIBA Core 1.0", title: "Client-Initiated Backchannel Authentication", kind: "spec" }],
    },
  },
];

export default {
  id: "UC23",
  result: { label: "INFO", tone: "info" },
  pingStyle: true,
  GROUPS: G,
  NODES,
  EDGES,
  walk,
  steps,
};
