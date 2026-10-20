/**
 * UC1 — Delegated access (consent only). Pilot diagram: happy-path delegation
 * with RFC 8693 token exchange. Participants left-to-right in call order.
 * Story beats live in `walk`; title/what/businessValue import from demoStepGuides.
 */
import { PARTICIPANT_GROUPS as G } from "./palette";
import { RFC, DRAFT, SPEC } from "../pingStyleStandards";

const NODES = [
  { id: "user", group: "user", label: "Alice (user)", sub: ["Signs in once"], x: 40, y: 150, detail: "Signed in; her agent acts for her under her consent." },
  { id: "agent", group: "agent", label: "Banking agent", sub: ["Holds Alice's token"], x: 420, y: 150, detail: "Holds Alice's token and needs her account data; never sees her password." },
  { id: "gw", group: "gateway", label: "Agent gateway", sub: ["CIMD check", "downscope"], x: 800, y: 150, detail: "Validates the client, asks policy, then exchanges the token downscoped." },
  { id: "p1", group: "pingone", label: "PingOne", sub: ["Authorize", "token exchange"], x: 1180, y: 150, detail: "Evaluates the request and mints the delegated token with the act claim." },
  { id: "acct", group: "resource", label: "Accounts API", sub: ["read-only"], x: 1560, y: 150, detail: "Serves account data to the downscoped caller; validates scope on every call." },
];

const EDGES = [
  ["user", "agent", "acts for Alice", { detail: "Delegated consent — Alice's authority, explicitly granted at sign-in." }],
  ["agent", "gw", "user token", { detail: "Gateway validates the client (CIMD) before any policy check." }],
  ["gw", "p1", "RFC 8693 exchange", { detail: "User token in, downscoped agent token out with act={sub: agent, sub: alice}." }],
  ["p1", "acct", "agent token · accounts:read", { detail: "Narrowed: read-only, one user, one API." }],
];

const walk = [
  {
    title: "Consent at sign-in", label: "Alice's authority, explicitly granted",
    nodes: ["user", "agent"], edges: [0],
    lines: [{ who: "Alice", text: "Sign-in consent is what authorizes everything that follows." }],
    tech: [{ t: "TOKEN", c: "user AT: sub=alice, scp=accounts:read, act=absent" }],
  },
  {
    title: "Gateway checks the client", label: "CIMD before policy",
    nodes: ["agent", "gw"], edges: [1],
    lines: [{ who: "Gateway", text: "Registered client? Then policy. Not the reverse." }],
    tech: [
      { t: "API", c: "POST /gateway/mcp  Authorization: Bearer <user AT>" },
      { t: "POLICY", c: "CIMD document resolves for the calling client" },
    ],
  },
  {
    title: "Token exchange", label: "RFC 8693 downscope",
    nodes: ["gw", "p1"], edges: [2],
    lines: [{ who: "PingOne", text: "The delegated token carries act — who the agent is acting for." }],
    tech: [
      { t: "TOKEN", c: "RFC 8693 exchange -> agent AT: act={sub:agent, sub:alice}, scp=accounts:read" },
      { t: "POLICY", c: "Authorize evaluates the exchange: PERMIT" },
    ],
  },
  {
    title: "Read with the delegated token", label: "Narrowed to one API",
    nodes: ["p1", "acct"], edges: [3],
    lines: [{ who: "Accounts", text: "Scope validated per call; read-only, this user only." }],
    tech: [{ t: "API", c: "GET /api/accounts  Authorization: Bearer <agent AT> -> 200 accounts[]" }],
  },
];

// Per-step detail. Tokens are decoded MOCK values (placeholders, no real ids or JWTs).
const ISS = "https://auth.pingone.com/<env id>/as";
const steps = [
  {
    beats: [0],
    detail: {
      form: "POST /<env id>/as/token\nContent-Type: application/x-www-form-urlencoded\n\ngrant_type=authorization_code\n&code=<authorization code>\n&code_verifier=<PKCE verifier>\n&redirect_uri=<registered redirect>\n&client_id=<web app client id>\n\n-> 200 { \"access_token\": \"<user access token>\", \"id_token\": \"<id token>\", \"token_type\": \"Bearer\", \"scope\": \"openid accounts:read\" }",
      tokens: [{
        note: "User access token (MOCK, decoded) - Alice's sign-in consent; no act claim yet",
        header: { alg: "RS256", typ: "at+jwt" },
        claims: { iss: ISS, sub: "<alice user id>", aud: "<banking resource>", scope: "openid accounts:read", client_id: "<web app client id>", exp: "<unix time>" },
      }],
      refs: [RFC(6749, "Authorization code grant"), RFC(7636, "PKCE"), SPEC("OIDC Core 1.0", "OpenID Connect sign-in"), RFC(9068, "JWT profile for access tokens")],
    },
  },
  {
    beats: [1],
    detail: {
      form: "POST /gateway/mcp\nAuthorization: Bearer <user access token>\nContent-Type: application/json\n\n{ \"jsonrpc\": \"2.0\", \"id\": 1, \"method\": \"tools/call\",\n  \"params\": { \"name\": \"get_my_accounts\", \"arguments\": {} } }\n\n(the gateway resolves the calling client's CIMD document before it asks policy)",
      tokens: [{
        note: "Same user access token (MOCK) - the gateway reads aud and exp, then checks the client",
        claims: { iss: ISS, sub: "<alice user id>", aud: "<banking resource>", scope: "openid accounts:read", exp: "<unix time>" },
      }],
      refs: [
        SPEC("MCP authorization 2025-11-25", "Model Context Protocol authorization"),
        RFC(6750, "Bearer token usage"),
        RFC(9728, "Protected Resource Metadata"),
        DRAFT("draft-ietf-oauth-client-id-metadata-document", "Client ID Metadata Documents (client_id is a URL to its metadata)"),
      ],
    },
  },
  {
    beats: [2],
    detail: {
      form: "POST /<env id>/as/token\nContent-Type: application/x-www-form-urlencoded\n\ngrant_type=urn:ietf:params:oauth:grant-type:token-exchange\n&subject_token=<user access token>\n&subject_token_type=urn:ietf:params:oauth:token-type:access_token\n&actor_token=<agent access token>\n&actor_token_type=urn:ietf:params:oauth:token-type:access_token\n&resource=<accounts API URI>\n&scope=accounts:read",
      tokens: [
        {
          note: "INPUT subject_token (MOCK) - Alice's user token",
          claims: { iss: ISS, sub: "<alice user id>", aud: "<banking resource>", scope: "openid accounts:read" },
        },
        {
          note: "INPUT actor_token (MOCK) - the agent's own token",
          claims: { iss: ISS, sub: "<agent client id>", aud: "<token endpoint>", scope: "agent:invoke" },
        },
        {
          note: "OUTPUT delegated agent token (MOCK) - downscoped, act names the agent",
          header: { alg: "RS256", typ: "at+jwt" },
          claims: { iss: ISS, sub: "<alice user id>", aud: "<accounts API URI>", scope: "accounts:read", act: { sub: "<agent client id>" }, exp: "<unix time>" },
        },
      ],
      refs: [RFC(8693, "OAuth 2.0 Token Exchange (subject_token, actor_token, act)"), RFC(8707, "Resource Indicators")],
    },
  },
  {
    beats: [3],
    detail: {
      form: "GET /api/accounts\nAuthorization: Bearer <delegated agent token>\n\n-> 200 { \"accounts\": [ { \"id\": \"{accountId}\", \"type\": \"checking\", \"balance\": <number> } ] }",
      tokens: [{
        note: "Delegated agent token (MOCK) - the Accounts API checks aud and scope on every call",
        claims: { iss: ISS, sub: "<alice user id>", aud: "<accounts API URI>", scope: "accounts:read", act: { sub: "<agent client id>" } },
      }],
      refs: [RFC(6750, "Bearer token usage"), RFC(9068, "JWT profile for access tokens"), RFC(8693, "act claim: who is acting for whom")],
    },
  },
];

export default {
  id: "UC1",
  // Backend catalog useCaseId (config/useCases.js). Live overlay matching keys
  // off this slug — shared across verticals by design.
  slug: "delegated-access-with-proof",
  // buildTraceSteps baseId -> this diagram's node ids. A live hop renders on
  // the nodes it actually touched; hops without a hint stay off the overlay.
  hopHints: {
    signin: ["user"], prompt: ["user"], agent: ["agent"], llm: ["agent"],
    "agent-token": ["agent"], exchange: ["gw", "p1"], "exchange-1": ["gw", "p1"],
    authorize: ["gw", "p1"], gateway: ["gw"], "tools-list": ["agent", "gw"],
    "tools-list-challenge": ["agent", "gw"], "tools-call-challenge": ["agent", "gw"],
    mcp: ["gw", "acct"], api: ["acct"], reply: ["agent", "user"],
  },
  result: { label: "PERMIT", tone: "ok" },
  pingStyle: true,
  GROUPS: G,
  NODES,
  EDGES,
  walk,
  steps,
};
