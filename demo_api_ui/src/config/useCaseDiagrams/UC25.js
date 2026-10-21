/**
 * UC25 — Enterprise-managed MCP access. One SSO sign-in gates it all: PingOne
 * group policy passes at the IdP, the BFF mints the MCP token via RFC 8693
 * (ID-JAG stand-in), and the agent connects with no consent click.
 */
import { PARTICIPANT_GROUPS as G } from "./palette";
import { RFC, SPEC, EXCHANGE, MCP } from "../pingStyleStandards";

const NODES = [
  { id: "user", group: "user", label: "Alice (employee)", sub: ["in allowed group"], x: 40, y: 150, detail: "Sign-in itself gates access: PingOne group policy decides who gets MCP tokens." },
  { id: "agent", group: "agent", label: "Banking agent", sub: ["no consent click"], x: 440, y: 150, detail: "Connects with no separate Connect-to-MCP consent click — the IdP gate already passed." },
  { id: "gw", group: "gateway", label: "Agent gateway / BFF", sub: ["mints MCP token"], x: 840, y: 150, detail: "The BFF mints the MCP token through RFC 8693, labeled as an ID-JAG stand-in." },
  { id: "p1", group: "pingone", label: "PingOne", sub: ["group gate at IdP"], x: 1240, y: 150, detail: "PingOne holds the group membership the BFF policy gate looks up; users outside the allowed groups get 403 enterprise_mcp_policy_denied from the BFF." },
];

const EDGES = [
  ["user", "p1", "one SSO sign-in", { detail: "One PingOne sign-in; group policy is checked once by the BFF gate (PingOne group lookup), not per click." }],
  ["agent", "gw", "show my balance", { detail: "The agent connects directly — enterprise-managed mode, no per-user MCP consent step." }],
  ["gw", "p1", "ID-JAG stand-in exchange", { detail: "RFC 8693 token exchange mints the MCP token under the group gate." }],
  ["p1", "gw", "token issued", { dashed: true, detail: "Issuance is what the group gate controls — if the BFF gate denies, no exchange is attempted and no MCP token exists." }],
  ["gw", "agent", "tool dispatched", { detail: "The token chain shows enterprise-managed mode end to end." }],
];

const walk = [
  {
    title: "One SSO sign-in", label: "Gate at the IdP",
    nodes: ["user", "p1"], edges: [0],
    lines: [{ who: "PingOne", text: "The IT group gate passes at sign-in — access is centralized in PingOne." }],
    tech: [{ t: "TOKEN", c: "ID token minted; enterprise-managed MCP mode on" }],
  },
  {
    title: "Agent connects", label: "No consent click",
    nodes: ["agent", "gw"], edges: [1],
    lines: [{ who: "Agent", text: "No Connect-to-MCP consent step — the group gate already authorized the session." }],
    tech: [{ t: "API", c: "agent connects to gateway; no per-user MCP consent step" }],
  },
  {
    title: "ID-JAG stand-in", label: "RFC 8693 at the BFF",
    nodes: ["gw", "p1"], edges: [2, 3],
    lines: [{ who: "Gateway", text: "The BFF mints the MCP token through token exchange; outside the group the BFF gate answers 403 enterprise_mcp_policy_denied before any exchange." }],
    tech: [{ t: "TOKEN", c: "RFC 8693 (ID-JAG stand-in) -> MCP AT for allowed group" }],
  },
  {
    title: "Tool dispatched", label: "Enterprise-managed on the chain",
    nodes: ["gw", "agent"], edges: [4],
    lines: [{ who: "Gateway", text: "'show my balance' runs, and the token chain shows enterprise-managed mode end to end." }],
    tech: [{ t: "API", c: "get_account_balance dispatched; token chain shows enterprise-managed mode" }],
  },
];

// Per-step detail. Group gate at PingOne, BFF-side RFC 8693 exchange standing in for ID-JAG. Tokens are decoded MOCK values.
const steps = [
  {
    beats: [0],
    detail: {
      form: "PingOne sign-in, embedded (pi.flow: the BFF drives the flow, no browser redirect)\n\nGET https://auth.pingone.com/{envId}/as/authorize?\n  response_type=code&response_mode=pi.flow&client_id=<client id>\n  &redirect_uri=<callback>&scope=openid profile&code_challenge=<challenge>&code_challenge_method=S256&state=<state>\n-> flow object; the BFF submits the credentials to the flow, then resumes it for the code (PKCE still binds the code to the BFF)\n\nThe group policy is not an ID-token check: the BFF gate looks up the user's PingOne group membership before the exchange; outside the allowed group, no enterprise-managed MCP session.",
      tokens: [{
        note: "MOCK decoded ID token · groups shown for orientation; the BFF gate looks membership up in PingOne",
        header: { alg: "RS256", typ: "JWT" },
        claims: { iss: "https://auth.pingone.com/ENV_ID/as", sub: "alice-0001", aud: "<client id>", groups: ["IT"], exp: 1790000000 },
      }],
      refs: [SPEC("OIDC Core 1.0", "OpenID Connect sign-in and ID token"), RFC(7636, "PKCE"), RFC(6749, "Authorization code grant")],
    },
  },
  {
    beats: [1],
    detail: {
      form: "POST /api/agent/invoke\nCookie: <BFF session cookie>\nContent-Type: application/json\n\n{ \"prompt\": \"show my balance\", \"vertical\": \"banking\" }\n\nNo Connect-to-MCP consent step: the group gate already passed at sign-in. The session cookie is not an OAuth token, so none is shown here.",
      tokens: [],
      refs: [SPEC("MCP authorization 2025-11-25", "Model Context Protocol authorization")],
    },
  },
  {
    beats: [2],
    detail: {
      form: "POST https://auth.pingone.com/{envId}/as/token\nContent-Type: application/x-www-form-urlencoded\n\ngrant_type=urn:ietf:params:oauth:grant-type:token-exchange\n&subject_token=<user token>\n&subject_token_type=urn:ietf:params:oauth:token-type:access_token\n&audience=<MCP resource>\n&scope=<requested scopes>\n\n-> 200 { \"access_token\": \"<MCP access token>\", \"token_type\": \"Bearer\" }\n-> outside the allowed group, the BFF policy gate (PingOne group lookup) runs first and returns 403 enterprise_mcp_policy_denied; /token is never called and no MCP token exists\n\nLabelled an ID-JAG stand-in: the real ID-JAG exchange is the PingFederate path.",
      tokens: [
        {
          note: "MOCK input · subject_token (the signed-in user's token)",
          header: { alg: "RS256", typ: "at+jwt" },
          claims: { iss: "https://auth.pingone.com/ENV_ID/as", sub: "alice-0001", aud: "<client id>", groups: ["IT"], exp: 1790000000 },
        },
        {
          note: "MOCK output · MCP access token minted for the allowed group",
          header: { alg: "RS256", typ: "at+jwt" },
          claims: { iss: "https://auth.pingone.com/ENV_ID/as", sub: "alice-0001", aud: "https://mcp.ping.demo", scope: "banking:read", exp: 1790000000 },
        },
      ],
      refs: [...EXCHANGE.filter((r) => ["RFC 8693", "draft-ietf-oauth-identity-assertion-authz-grant"].includes(r.id)), ...MCP.filter((r) => r.id === "MCP authorization 2025-11-25")],
    },
  },
  {
    beats: [3],
    detail: {
      form: "POST /gateway/mcp\nAuthorization: Bearer <MCP access token>\nContent-Type: application/json\n\n{ \"jsonrpc\": \"2.0\", \"id\": 1, \"method\": \"tools/call\", \"params\": { \"name\": \"get_account_balance\", \"arguments\": {} } }\n\n-> 200; the Token Chain shows enterprise-managed mode end to end.",
      tokens: [{
        note: "MOCK decoded MCP access token presented to the gateway",
        header: { alg: "RS256", typ: "at+jwt" },
        claims: { iss: "https://auth.pingone.com/ENV_ID/as", sub: "alice-0001", aud: "https://mcp.ping.demo", scope: "banking:read", exp: 1790000000 },
      }],
      refs: [RFC(6750, "Bearer token usage"), RFC(9068, "JWT profile for OAuth 2.0 access tokens")],
    },
  },
];

export default {
  id: "UC25",
  result: { label: "PERMIT", tone: "ok" },
  pingStyle: true,
  GROUPS: G,
  NODES,
  EDGES,
  walk,
  steps,
};
