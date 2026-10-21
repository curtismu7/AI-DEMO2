/**
 * UC11 — Bad client → agent gateway (DENY 401). Wrong audience, malformed,
 * expired or badly signed: the gateway validates the envelope before routing
 * and before Authorize is consulted. No tool is ever touched.
 */
import { PARTICIPANT_GROUPS as G } from "./palette";
import { RFC, SPEC } from "../pingStyleStandards";

const NODES = [
  { id: "atk", group: "external", label: "Attack agent", sub: ["aud: elsewhere"], x: 40, y: 150, detail: "Presents a well-formed token whose audience names another service — or it is expired, malformed or badly signed." },
  { id: "gw", group: "gateway", label: "Agent gateway", sub: ["perimeter validation"], x: 340, y: 150, detail: "Checks aud, exp, iss and nbf before any routing happens." },
  { id: "p1", group: "pingone", label: "PingOne Authorize", sub: ["not consulted"], x: 640, y: 150, detail: "No decision appears — the call died before the policy engine." },
  { id: "tools", group: "resource", label: "Every tool", sub: ["behind the gateway"], x: 940, y: 330, detail: "Each tool and service downstream is shielded by the same perimeter check — none re-validates the audience itself." },
];

const EDGES = [
  ["atk", "gw", "present token", { detail: "The envelope is what fails, not the policy." }],
  ["gw", "gw", "aud mismatch", { detail: "The audience does not name this gateway." }],
  ["gw", "atk", "401", { dashed: true, detail: "Refused on the spot; no tool touched, no Authorize call spent." }],
  ["gw", "tools", "one shield for all", { detail: "The same perimeter validation covers every tool and service." }],
];

const walk = [
  {
    title: "Wrong-audience token", label: "Aimed at another service",
    nodes: ["atk", "gw"], edges: [0],
    lines: [{ who: "Attacker", text: "The token is well-formed — that is what makes the audience check interesting." }],
    tech: [{ t: "TOKEN", c: "AT: aud=other-service (gateway expects mcpgateway.ping.demo)" }],
  },
  {
    title: "Envelope validated", label: "Before routing",
    nodes: ["gw"], edges: [1],
    lines: [{ who: "Gateway", text: "aud, exp, iss, nbf — all before anything downstream happens." }],
    tech: [{ t: "POLICY", c: "perimeter validation: aud mismatch -> fail" }],
  },
  {
    title: "401 at the perimeter", label: "No tool, no decision",
    nodes: ["gw", "atk"], edges: [2],
    lines: [{ who: "Gateway", text: "One enforcement point shields every downstream service from bad credentials." }],
    tech: [{ t: "API", c: "gateway -> 401; no tool dispatch, no Authorize row in the chain" }],
  },
  {
    title: "One perimeter", label: "All tools covered",
    nodes: ["gw", "tools"], edges: [3],
    lines: [{ who: "Presenter", text: "The bad token never reaches the tools — the shield is the gateway, not the apps." }],
    tech: [{ t: "POLICY", c: "enforcement point: gateway perimeter (all tools)" }],
  },
];

// Per-step detail. Tokens are decoded MOCK values. Perimeter checks and the 401 challenge follow the Agent Gateway
// (aud must be MCP_GW_RESOURCE_URI, exp not passed; failure -> WWW-Authenticate Bearer error="invalid_token").
const ISS = "https://auth.pingone.com/<env id>/as";
const steps = [
  {
    beats: [0],
    detail: {
      form: "POST /gateway/mcp\nAuthorization: Bearer <access token for another service>\nContent-Type: application/json\n\n{ \"jsonrpc\": \"2.0\", \"id\": 1, \"method\": \"tools/call\",\n  \"params\": { \"name\": \"get_my_accounts\", \"arguments\": {} } }",
      tokens: [{
        note: "Wrong-audience token (MOCK) - well-formed, but aud names another service",
        header: { alg: "RS256", typ: "at+jwt" },
        claims: { iss: ISS, sub: "<user id>", aud: "<some other service URI>", scope: "accounts:read", exp: "<unix time>" },
      }],
      refs: [RFC(6750, "Bearer token usage"), RFC(8707, "Resource Indicators: a token is minted for one audience")],
    },
  },
  {
    beats: [1],
    detail: {
      form: "(no network call to PingOne here)\nperimeter validation, before any routing:\n  aud must be the gateway resource URI (mcpgateway.ping.demo)  -> FAIL\n  exp not passed, iss and nbf plausible\n  sub non-empty; act.sub non-empty when act is present",
      tokens: [{
        note: "The same token (MOCK) as the gateway reads it",
        claims: { iss: ISS, aud: "<some other service URI>", expected_aud: "<gateway resource URI>" },
      }],
      refs: [RFC(9068, "JWT profile for access tokens: the resource server must check aud"), RFC(7519, "JSON Web Token claims (aud, exp, iss, nbf)"), RFC(9700, "OAuth 2.0 Security BCP: audience-restrict tokens")],
    },
  },
  {
    beats: [2],
    detail: {
      form: "HTTP/1.1 401 Unauthorized\nWWW-Authenticate: Bearer realm=\"PingOne\", resource_metadata=\"https://<gateway host>/.well-known/oauth-protected-resource\", error=\"invalid_token\"\n\nno tool dispatch, no PingOne Authorize call, no decision row in the chain",
      tokens: [],
      refs: [RFC(6750, "Bearer token usage: the invalid_token challenge"), RFC(9728, "Protected Resource Metadata: how a client learns the right audience")],
    },
  },
  {
    beats: [3],
    detail: {
      form: "Same perimeter code for every tool and every service behind the gateway:\n  tools/list, tools/call, third-party MCP servers\nThe backend MCP servers never need to re-check the audience themselves.",
      tokens: [],
      refs: [SPEC("MCP authorization 2025-11-25", "The MCP server (here the gateway) validates tokens issued for it")],
    },
  },
];

export default {
  id: "UC11",
  result: { label: "DENY", tone: "err" },
  pingStyle: true,
  GROUPS: G,
  NODES,
  EDGES,
  walk,
  steps,
};
