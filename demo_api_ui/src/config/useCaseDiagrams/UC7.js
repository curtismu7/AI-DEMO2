/**
 * UC7 — MFA step-up (HITL). Pilot diagram: the step-up shape. Read-only is
 * fine; a $600 transfer clears the step-up threshold and PingOne runs MFA
 * before the policy re-evaluates to PERMIT.
 */
import { PARTICIPANT_GROUPS as G } from "./palette";
import { RFC, STEPUP, AUTHZ } from "../pingStyleStandards";

const NODES = [
  { id: "user", group: "user", label: "Alice (user)", sub: ["Completes MFA"], x: 40, y: 150, detail: "Answers the MFA challenge — push or OTP — on her enrolled device." },
  { id: "agent", group: "agent", label: "Banking agent", sub: ["Requests transfer"], x: 460, y: 150, detail: "Requests the $600 transfer. Read-only was fine; moving money is not." },
  { id: "gw", group: "gateway", label: "Agent gateway", sub: ["ACR check"], x: 880, y: 150, detail: "Checks the session's assurance level; not high enough for payments." },
  { id: "p1", group: "pingone", label: "PingOne", sub: ["MFA", "re-evaluate"], x: 1300, y: 150, detail: "Challenges with MFA, upgrades the session, re-evaluates policy." },
];

const EDGES = [
  ["user", "agent", "move $600", { detail: "A sensitive action — step-up is required by policy." }],
  ["agent", "gw", "tool call", { detail: "Session ACR too low for payments; the gateway holds the call." }],
  ["gw", "p1", "step-up challenge", { detail: "PingOne challenges: push notification or OTP." }],
  ["p1", "user", "MFA prompt", { detail: "Alice approves on her enrolled device — out of the agent's hands.", vertical: true }],
  ["p1", "gw", "acr upgraded", { detail: "Session assurance level rises; the retry carries the new ACR claim." }],
  ["gw", "agent", "PERMIT", { detail: "Re-evaluation passes with the upgraded session — transfer executes." }],
];

const walk = [
  {
    title: "Agent asks to move $600", label: "Above the step-up threshold",
    nodes: ["user", "agent"], edges: [0],
    lines: [{ who: "Agent", text: "$600 clears the step-up threshold but not the hard deny ceiling." }],
    tech: [{ t: "API", c: "POST /gateway/mcp tools/call transfer_funds amount=600" }],
  },
  {
    title: "Session not strong enough", label: "ACR below policy floor",
    nodes: ["agent", "gw"], edges: [1],
    lines: [{ who: "Gateway", text: "Read-only session — payments need a higher assurance level." }],
    tech: [{ t: "POLICY", c: "ACR check: session acr (single-factor policy) does not meet the required MFA policy -> step-up obligation" }],
  },
  {
    title: "PingOne challenges", label: "MFA out of band",
    nodes: ["gw", "p1"], edges: [2],
    lines: [{ who: "PingOne", text: "The challenge goes straight to Alice's device — the agent just waits." }],
    tech: [{ t: "API", c: "PingOne MFA: POST /mfa/challenges -> push/OTP" }],
  },
  {
    title: "Alice approves", label: "Human in the loop",
    nodes: ["p1", "user"], edges: [3],
    lines: [{ who: "Alice", text: "The approval is hers alone; the agent cannot answer for her." }],
    tech: [{ t: "POLICY", c: "MFA success receipt bound to this request" }],
  },
  {
    title: "Session upgraded", label: "Retry carries new ACR",
    nodes: ["p1", "gw"], edges: [4],
    lines: [{ who: "Gateway", text: "The same call now arrives with a session policy accepts." }],
    tech: [{ t: "TOKEN", c: "session acr now the MFA policy; re-evaluation inputs refreshed" }],
  },
  {
    title: "PERMIT", label: "Transfer executes",
    nodes: ["gw", "agent"], edges: [5],
    lines: [{ who: "Agent", text: "The transfer runs — with MFA on the record." }],
    tech: [{ t: "POLICY", c: "Authorize re-evaluates: PERMIT (step-up satisfied)" }],
  },
];

// Per-step detail. Tokens are decoded MOCK values. The step_up_required error mirrors demo_mcp_gateway/src/index.ts.
const LOW_ACR = {
  note: "MOCK delegated token · session below the payments assurance floor",
  header: { alg: "RS256", typ: "at+jwt" },
  claims: { iss: "https://auth.pingone.com/ENV_ID/as", sub: "alice-0001", aud: "https://mcp.ping.demo", scope: "banking:transactions:write", acr: "<single-factor policy name>", act: { sub: "agent-0001" }, exp: 1790000000 },
};
const HIGH_ACR = {
  note: "MOCK delegated token · after MFA, session upgraded",
  header: { alg: "RS256", typ: "at+jwt" },
  claims: { iss: "https://auth.pingone.com/ENV_ID/as", sub: "alice-0001", aud: "https://mcp.ping.demo", scope: "banking:transactions:write", acr: "<MFA policy name>", amr: ["pwd", "mfa"], act: { sub: "agent-0001" }, exp: 1790000000 },
};
const steps = [
  {
    beats: [0],
    detail: {
      form: `Agent chat

{ "prompt": "Move $600 from checking to savings" }

POST /gateway/mcp
Authorization: Bearer <delegated access token>

{ "jsonrpc": "2.0", "id": 1, "method": "tools/call",
  "params": { "name": "transfer_funds", "arguments": { "amount": 600, "fromAccountId": "{fromAccountId}", "toAccountId": "{toAccountId}" } } }`,
      tokens: [LOW_ACR],
      refs: [RFC(6750, "Bearer token usage"), RFC(8693, "act claim: who is acting for whom")],
    },
  },
  {
    beats: [1],
    detail: {
      form: `Policy evaluation: session acr (single-factor policy) does not meet the required MFA policy -> step-up obligation (not a deny).

{ "jsonrpc": "2.0", "id": 1,
  "error": { "code": -32403, "message": "Step-up authentication required",
    "data": { "error": "step_up_required", "tool": "transfer_funds", "required_scopes": ["<scope>"], "login_required": false } } }

HTTP-transport form: 403, WWW-Authenticate: Bearer realm="PingOne", error="insufficient_scope", scope="<scopes>", resource_metadata=<protected resource metadata URL>
body { "error": "step_up_required", "message": "Step-up authentication required", ... }`,
      tokens: [LOW_ACR],
      refs: [STEPUP[1], AUTHZ[0]],
    },
  },
  {
    beats: [2],
    detail: {
      form: `PingOne MFA challenge for alice-0001 (push or one-time passcode)

The challenge is created by the BFF/PingOne MFA service and delivered to the user's enrolled device; the agent only waits.`,
      tokens: [],
      refs: [STEPUP[1]],
    },
  },
  {
    beats: [3],
    detail: {
      form: `On the user's enrolled device:
  approve the push, or enter the one-time passcode.

PingOne records an MFA success bound to this request. The agent cannot answer for Alice.`,
      tokens: [],
    },
  },
  {
    beats: [4],
    detail: {
      form: `Session upgraded: acr is the MFA policy, amr includes mfa.
The retry carries a token minted from the upgraded session.

POST /gateway/mcp
Authorization: Bearer <delegated access token, acr=<MFA policy name>>`,
      tokens: [HIGH_ACR],
      refs: [STEPUP[1], RFC(8176, "Authentication Method Reference values (amr)")],
    },
  },
  {
    beats: [5],
    detail: {
      form: `PingOne Authorize re-evaluates: the MFA acr satisfies the step-up floor -> PERMIT

{ "jsonrpc": "2.0", "id": 2, "result": { "content": [{ "type": "text", "text": "<transfer receipt>" }] } }`,
      tokens: [HIGH_ACR],
      refs: [AUTHZ[0], AUTHZ[1]],
    },
  },
];

export default {
  pingStyle: true,
  id: "UC7",
  result: { label: "STEP-UP", tone: "warn" },
  GROUPS: G,
  NODES,
  EDGES,
  walk,
  steps,
};
