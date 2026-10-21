/**
 * UC22 — CIBA out-of-band approval. The agent moves a deliberately small $150
 * (below the MFA threshold to show the trigger is sensitivity, not amount):
 * the approval is pushed to the user's phone and the agent polls until it is
 * granted. A compromised browser cannot self-approve.
 */
import { PARTICIPANT_GROUPS as G } from "./palette";
import { RFC, SPEC } from "../pingStyleStandards";

const NODES = [
  { id: "agent", group: "agent", label: "Banking agent", sub: ["transfer $150"], x: 40, y: 40, detail: "Has no browser to prompt — it can only ask and poll." },
  { id: "p1", group: "pingone", label: "PingOne CIBA", sub: ["auth_req_id"], x: 440, y: 40, detail: "Accepts the backchannel request and pushes the approval to the user's device." },
  { id: "user", group: "user", label: "Alice (user)", sub: ["own phone"], x: 840, y: 40, detail: "Approves off-session. A compromised browser or rogue agent cannot answer for her." },
  { id: "tool", group: "resource", label: "Banking MCP", sub: ["dispatched last"], x: 40, y: 260, detail: "Runs only after the poll returns a token — the chain shows the full order." },
];

const EDGES = [
  ["agent", "p1", "CIBA request", { detail: "Backchannel auth request: the agent asks PingOne, not the browser." }],
  ["p1", "user", "push to phone", { detail: "The approval request lands on the enrolled device." }],
  ["agent", "p1", "poll (pending)", { detail: "The agent cannot self-approve; it polls the token endpoint with auth_req_id." }],
  ["user", "p1", "approve", { dashed: true, detail: "Her decision happens off-session, out of the agent's reach." }],
  ["p1", "agent", "token", { dashed: true, detail: "The poll completes: ciba-poll done, token issued." }],
  ["agent", "tool", "dispatch", { detail: "Chain order on the record: authorize-decision -> ciba-poll -> tool-dispatched.", vertical: true }],
];

const walk = [
  {
    title: "Agent asks for $150", label: "Sensitivity, not amount",
    nodes: ["agent", "p1"], edges: [0],
    lines: [{ who: "Agent", text: "$150 is deliberately below the MFA threshold — CIBA here is about the action class." }],
    tech: [{ t: "API", c: "POST /bc-authorize login_hint + scope + binding_message -> auth_req_id" }],
  },
  {
    title: "Push to the phone", label: "Out of band",
    nodes: ["p1", "user"], edges: [1],
    lines: [{ who: "PingOne", text: "The approval request goes to the user's own device — the agent has no browser." }],
    tech: [{ t: "POLICY", c: "CIBA push delivered to enrolled device" }],
  },
  {
    title: "Agent polls", label: "Cannot self-approve",
    nodes: ["agent", "p1"], edges: [2],
    lines: [{ who: "Agent", text: "authorization_pending — it waits. That is the whole point." }],
    tech: [{ t: "TOKEN", c: "POST /token grant=urn:openid:params:grant-type:ciba -> authorization_pending" }],
  },
  {
    title: "User approves", label: "Off the session",
    nodes: ["user", "p1"], edges: [3],
    lines: [{ who: "Alice", text: "The decision is hers and happens off-session — a rogue agent cannot answer." }],
    tech: [{ t: "POLICY", c: "out-of-band approval recorded against auth_req_id" }],
  },
  {
    title: "Poll returns the token", label: "ciba-poll completes",
    nodes: ["p1", "agent"], edges: [4],
    lines: [{ who: "PingOne", text: "Now the poll succeeds and the delegated token is issued." }],
    tech: [{ t: "TOKEN", c: "poll -> 200 access_token (consent confirmed)" }],
  },
  {
    title: "Tool dispatched", label: "Chain in order",
    nodes: ["agent", "tool"], edges: [5],
    lines: [{ who: "Gateway", text: "The transfer executes with the full order visible: authorize, poll, dispatch." }],
    tech: [{ t: "API", c: "token chain: authorize-decision -> ciba-poll -> tool-dispatched" }],
  },
];

// Per-step detail. CIBA poll mode against the PingOne token endpoint (tech lines of the walk); tokens are decoded MOCK values.
const steps = [
  {
    beats: [0],
    detail: {
      form: "POST https://auth.pingone.com/{envId}/as/bc-authorize\nContent-Type: application/x-www-form-urlencoded\nAuthorization: Basic <client credentials>\n\nlogin_hint=<alice login hint>\n&scope=<transfer scope>\n&binding_message=<at most 8 chars: 2-char vertical code + 6 hex>\n\n-> 200 { \"auth_req_id\": \"<auth_req_id>\", \"expires_in\": 300, \"interval\": 5 }\n\nNo token yet: the amount (150) is below the MFA threshold; the trigger is the action class.",
      tokens: [],
      refs: [SPEC("OpenID CIBA Core 1.0", "Backchannel authentication request (poll mode)"), RFC(6749, "Client authentication at the AS endpoint")],
    },
  },
  {
    beats: [1],
    detail: {
      form: "PingOne -> Alice's enrolled device (push notification, out of band)\n\n\"Approve transfer? <binding message>\"\n\nThe agent has no browser and no way to answer for her. No HTTP request reaches the agent in this step, so there is no token in play.",
      tokens: [],
      refs: [SPEC("OpenID CIBA Core 1.0", "The OP authenticates and obtains consent out of band")],
    },
  },
  {
    beats: [2],
    detail: {
      form: "POST https://auth.pingone.com/{envId}/as/token\nContent-Type: application/x-www-form-urlencoded\nAuthorization: Basic <client credentials>\n\ngrant_type=urn:openid:params:grant-type:ciba\n&auth_req_id=<auth_req_id>\n\n-> 400 { \"error\": \"authorization_pending\" }   (keep polling at the interval; slow_down if too fast)",
      tokens: [],
      refs: [SPEC("OpenID CIBA Core 1.0", "Token request with the CIBA grant type"), RFC(6749, "Token endpoint error responses")],
    },
  },
  {
    beats: [3],
    detail: {
      form: "Alice taps Approve on her phone.\n\nPingOne records the decision against <auth_req_id>. The decision is made off-session: nothing the agent or a compromised browser sends can answer for her.",
      tokens: [],
      refs: [SPEC("OpenID CIBA Core 1.0", "End-user approval at the authentication device")],
    },
  },
  {
    beats: [4],
    detail: {
      form: "POST https://auth.pingone.com/{envId}/as/token\nAuthorization: Basic <client credentials>\n\ngrant_type=urn:openid:params:grant-type:ciba&auth_req_id=<auth_req_id>\n\n-> 200 { \"access_token\": \"<access token>\", \"token_type\": \"Bearer\", \"expires_in\": 3600, \"scope\": \"<transfer scope>\" }",
      tokens: [{
        note: "MOCK decoded access token issued after the approval",
        header: { alg: "RS256", typ: "at+jwt" },
        claims: { iss: "https://auth.pingone.com/ENV_ID/as", sub: "alice-0001", aud: "https://mcp.ping.demo", scope: "banking:transactions:write", client_id: "agent-client-0001", exp: 1790000000 },
      }],
      refs: [SPEC("OpenID CIBA Core 1.0", "Successful token response after approval"), RFC(9068, "JWT profile for OAuth 2.0 access tokens")],
    },
  },
  {
    beats: [5],
    detail: {
      form: "POST /gateway/mcp\nAuthorization: Bearer <access token>\nContent-Type: application/json\n\n{ \"jsonrpc\": \"2.0\", \"id\": 1, \"method\": \"tools/call\",\n  \"params\": { \"name\": \"create_transfer\", \"arguments\": { \"amount\": 150, \"from_account_id\": \"{fromAccountId}\", \"to_account_id\": \"{toAccountId}\" } } }\n\nToken chain order: authorize-decision -> ciba-poll -> tool-dispatched.",
      tokens: [{
        note: "MOCK decoded access token presented to the gateway (the one the poll returned)",
        header: { alg: "RS256", typ: "at+jwt" },
        claims: { iss: "https://auth.pingone.com/ENV_ID/as", sub: "alice-0001", aud: "https://mcp.ping.demo", scope: "banking:transactions:write", exp: 1790000000 },
      }],
      refs: [RFC(6750, "Bearer token usage"), SPEC("MCP authorization 2025-11-25", "Model Context Protocol authorization")],
    },
  },
];

export default {
  id: "UC22",
  result: { label: "PERMIT", tone: "ok" },
  pingStyle: true,
  GROUPS: G,
  NODES,
  EDGES,
  walk,
  steps,
};
