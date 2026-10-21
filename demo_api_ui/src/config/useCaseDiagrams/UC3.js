/**
 * UC3 — act gate. "show my balance" runs a delegated balance lookup whose token
 * carries an act claim; the authorization server checks act.sub against the
 * authorized actor before the tool call is permitted. The chain shows the
 * user-token, token-exchange and authorize-decision legs.
 */
import { PARTICIPANT_GROUPS as G } from "./palette";
import { RFC, SPEC, AUTHZ } from "../pingStyleStandards";

const NODES = [
  { id: "user", group: "user", label: "Alice (user)", sub: ["consent grant on file"], x: 40, y: 150, detail: "Signed in; her consent (this agent may act for her) is a server-side grant record. Her token carries sub only." },
  { id: "agent", group: "agent", label: "Banking agent", sub: ["holds Alice's token"], x: 420, y: 150, detail: "Calls get_account_balance for Alice; on the exchanged token its client_id becomes act.sub — the identity the gate checks." },
  { id: "gw", group: "gateway", label: "Agent gateway", sub: ["RFC 8693 exchange"], x: 800, y: 150, detail: "Exchanges Alice's user token (subject_token) plus the agent's client-credentials token (actor_token) for the act-carrying MCP token." },
  { id: "p1", group: "pingone", label: "PingOne", sub: ["mints act", "evaluates act.sub + grant"], x: 1180, y: 150, detail: "Mints act at exchange from the actor token (the agent's own client credential), then the decision endpoint checks the consent grant and compares ActClientId on every tool call." },
  { id: "acct", group: "resource", label: "Accounts API", sub: ["read-only"], x: 1560, y: 150, detail: "Serves the balance only after the decision PERMITs the act-validated token; scope validated per call." },
];

const EDGES = [
  ["user", "agent", "consent grant", { detail: "Her consent is a server-side grant record naming the AI Agent client; PingOne Authorize checks it on every call (revoke = next call denied, no re-login)." }],
  ["agent", "gw", "tool call", { detail: "'show my balance' becomes a tools/call for get_account_balance, made with the exchanged agent token; the BFF keeps Alice's own token." }],
  ["gw", "p1", "actor token → act", { detail: "RFC 8693 exchange: user token as subject_token, agent's client-credentials token as actor_token — PingOne mints act from the actor token onto the minted MCP token." }],
  ["p1", "acct", "every call", { detail: "The decision endpoint checks act.sub against the authorized actor — no act ⇒ DENY missing_act. PERMIT, then the balance read goes out." }],
  ["acct", "user", "back to Alice", { detail: "The answer returns through the agent, and the panels show the three-leg proof: user-token, token-exchange, authorize-decision." }],
];

const walk = [
  {
    title: "Consent grant on file", label: "consent grant checked per call",
    nodes: ["user", "agent"], edges: [0],
    lines: [{ who: "Alice", text: "Alice's consent is a server-side grant record naming the AI Agent client; it is checked per call, not carried in her token." }],
    tech: [
      { t: "TOKEN", c: "user AT: sub=alice (no may_act); grant record: alice -> <AI Agent client_id>" },
      { t: "POLICY", c: "PingOne Authorize: consent grant checked on every tool call" },
    ],
  },
  {
    title: "Agent asks for the balance", label: "tool call",
    nodes: ["agent", "gw"], edges: [1],
    lines: [{ who: "Agent", text: "'show my balance' becomes a tools/call for get_account_balance, made with the exchanged agent token; the BFF keeps Alice's own token." }],
    tech: [
      { t: "API", c: "POST /gateway/mcp  tools/call get_account_balance" },
      { t: "TOKEN", c: "BFF holds <user AT> (never forwarded raw); gateway call carries Bearer <exchanged agent AT>" },
    ],
  },
  {
    title: "Exchange mints act", label: "actor token → act",
    nodes: ["gw", "p1"], edges: [2],
    lines: [{ who: "Gateway", text: "RFC 8693 exchange: user token as subject_token, the agent's client-credentials token as actor_token — PingOne mints act from the actor token onto the minted MCP token." }],
    tech: [
      { t: "TOKEN", c: "subject_token=<user AT> + actor_token=<agent CC> -> agent AT: act={sub:<AI Agent client_id>}" },
      { t: "POLICY", c: "PingOne mints act from the actor token; consent grant must match" },
    ],
  },
  {
    title: "The act gate", label: "every call",
    nodes: ["p1", "acct"], edges: [3],
    lines: [{ who: "PingOne Authorize", text: "The decision endpoint checks act.sub against the authorized actor — Rule 2 on the match, Rule 2.5 denies any agent-mediated tool whose act claim is missing. PERMIT, then the balance read goes out." }],
    tech: [
      { t: "POLICY", c: "POST /governance/pap/alpha/policy/:workerId/decision — ActClientId == authorized actor; no act ⇒ DENY missing_act" },
      { t: "API", c: "PERMIT -> GET /api/accounts, Authorization: Bearer <agent AT> -> 200" },
    ],
  },
  {
    title: "Balance, with proof", label: "back to Alice",
    nodes: ["acct", "user"], edges: [4],
    lines: [{ who: "Presenter", text: "The answer returns through the agent, and the panels show the three-leg proof: user-token, token-exchange, authorize-decision." }],
    tech: [{ t: "API", c: "chat reply: balance + evidence legs user-token / token-exchange / authorize-decision" }],
  },
];

const USER_AT = {
  note: "MOCK decoded user access token · sub only, no act and no may_act",
  header: { alg: "RS256", typ: "at+jwt" },
  claims: { iss: "https://auth.pingone.com/ENV_ID/as", sub: "alice-0001", aud: "<BFF client>", scope: "openid profile", exp: 1790000000 },
};
const AGENT_AT = {
  note: "MOCK decoded exchanged token · act minted from the actor token",
  header: { alg: "RS256", typ: "at+jwt" },
  claims: { iss: "https://auth.pingone.com/ENV_ID/as", sub: "alice-0001", aud: "https://mcp.ping.demo", scope: "read", act: { sub: "<AI Agent client_id>" }, exp: 1790000000 },
};

// Per-step detail. Exchange shape per RFC 8693 (subject_token + actor_token); decision endpoint per the walk's tech line.
const steps = [
  {
    beats: [0],
    detail: {
      form: "Server-side consent grant record (not a token claim)\n\n{ \"user\": \"alice-0001\", \"agentClientId\": \"<AI Agent client_id>\", \"granted\": true }\n\nChecked by PingOne Authorize on every tool call. Revoke it and the next call is denied, with no re-login.",
      tokens: [USER_AT],
      refs: [RFC(8693, "act and may_act claims: who may act for whom")],
    },
  },
  {
    beats: [1],
    detail: {
      form: "Agent asks for a tool call: get_account_balance. The BFF holds Alice's token and never forwards it raw; it exchanges first (next step), then calls the gateway with the exchanged token:\n\nPOST /gateway/mcp\nAuthorization: Bearer <exchanged agent token>\nContent-Type: application/json\n\n{ \"jsonrpc\": \"2.0\", \"id\": 1, \"method\": \"tools/call\",\n  \"params\": { \"name\": \"get_account_balance\", \"arguments\": {} } }",
      tokens: [USER_AT],
      refs: [RFC(6750, "Bearer token usage"), SPEC("MCP authorization 2025-11-25", "Model Context Protocol authorization")],
    },
  },
  {
    beats: [2],
    detail: {
      form: "POST https://auth.pingone.com/{envId}/as/token\nContent-Type: application/x-www-form-urlencoded\n\ngrant_type=urn:ietf:params:oauth:grant-type:token-exchange\n&subject_token=<user access token>\n&subject_token_type=urn:ietf:params:oauth:token-type:access_token\n&actor_token=<agent client-credentials token>\n&actor_token_type=urn:ietf:params:oauth:token-type:access_token\n&audience=<MCP resource>\n&scope=read\n\n-> 200 { \"access_token\": \"<exchanged token>\", \"issued_token_type\": \"urn:ietf:params:oauth:token-type:access_token\" }",
      tokens: [
        USER_AT,
        {
          note: "MOCK decoded actor_token · the agent's own client-credentials token",
          header: { alg: "RS256", typ: "at+jwt" },
          claims: { iss: "https://auth.pingone.com/ENV_ID/as", sub: "<AI Agent client_id>", aud: "<token exchanger>", scope: "agent:invoke", exp: 1790000000 },
        },
        AGENT_AT,
      ],
      refs: [RFC(8693, "Token Exchange: subject_token + actor_token produce the act claim"), RFC(8693, "Token Exchange: audience and resource parameters (section 2.1)"), RFC(6749, "Client credentials grant for the actor token")],
    },
  },
  {
    beats: [3],
    detail: {
      form: "POST /governance/pap/alpha/policy/{workerId}/decision\n\nparameters: { \"ActClientId\": \"<AI Agent client_id>\", \"ToolName\": \"get_account_balance\" }\n\nRule 2: ActClientId equals the authorized actor and the grant exists -> PERMIT\nRule 2.5: agent-mediated tool with no act claim -> DENY missing_act\n\nPERMIT -> GET /api/accounts with Authorization: Bearer <exchanged token> -> 200",
      tokens: [AGENT_AT],
      refs: [...AUTHZ.filter((r) => r.id === "OpenID AuthZEN" || r.id === "RFC 8693")],
    },
  },
  {
    beats: [4],
    detail: {
      form: "Agent reply to Alice: the balance, plus the evidence legs the panels show\n\nuser-token  ->  token-exchange  ->  authorize-decision\n\nReturned over the existing session; no new credential is issued in this step.",
      tokens: [],
    },
  },
];

export default {
  id: "UC3",
  result: { label: "PERMIT", tone: "ok" },
  pingStyle: true,
  GROUPS: G,
  NODES,
  EDGES,
  walk,
  steps,
};
