/**
 * UC40 — Enterprise-Managed MCP Authorization (native ID-JAG). Group policy at
 * the IdP issues a single-use ID-JAG; the agent redeems it at the MCP
 * authorization server for a scoped access token. No consent screen per MCP
 * server, no shared static credential. PingFederate lane (PingOne N/A).
 */
import { PARTICIPANT_GROUPS as G } from "./palette";
import { RFC, DRAFT } from "../pingStyleStandards";

const NODES = [
  { id: "it", group: "user", label: "IT (group policy)", sub: ["per emp · per server"], x: 40, y: 150, detail: "Grants MCP access as group policy at the IdP — the decision lives where IT already controls it." },
  { id: "pf", group: "pingone", label: "PingFederate", sub: ["issues ID-JAG"], x: 340, y: 150, detail: "Asserts the grant as a single-use, short-lived ID-JAG — no browser consent screen." },
  { id: "agent", group: "agent", label: "Agent framework", sub: ["no shared secret"], x: 640, y: 150, detail: "Holds no shared static credential; it redeems the ID-JAG at the MCP AS." },
  { id: "mcp", group: "resource", label: "MCP auth server", sub: ["redeem -> token"], x: 940, y: 150, detail: "Validates the ID-JAG and issues a scoped access token, visible on the live token chain." },
  ];

const EDGES = [
  ["it", "pf", "group policy", { detail: "Per-employee, per-server access decided centrally." }],
  ["pf", "agent", "ID-JAG issued", { dashed: true, detail: "Single-use, short-lived assertion of the grant." }],
  ["agent", "mcp", "redeem ID-JAG", { detail: "The redemption is the agent's whole credential story." }],
  ["mcp", "agent", "scoped token", { dashed: true, detail: "The access token calls the tool; every hop is on the chain." }],
  ["it", "it", "grant + revocation", { detail: "Decision, issuance and revocation stay in one place IT controls." }],
];

const walk = [
  {
    title: "Group policy", label: "IT decides",
    nodes: ["it", "pf"], edges: [0],
    lines: [{ who: "IT", text: "Per-employee, per-server MCP access — granted where grants belong." }],
    tech: [{ t: "POLICY", c: "IdP group policy: employee E, server S -> allowed" }],
  },
  {
    title: "ID-JAG issued", label: "Single-use assertion",
    nodes: ["pf", "agent"], edges: [1],
    lines: [{ who: "PingFederate", text: "No consent screen per MCP server — the IdP asserts the grant directly." }],
    tech: [{ t: "TOKEN", c: "ID-JAG: single-use, short-lived (oauth-id-jag+jwt)" }],
  },
  {
    title: "Redeemed at the MCP AS", label: "No shared credential",
    nodes: ["agent", "mcp"], edges: [2],
    lines: [{ who: "Agent", text: "The framework never holds a static secret — the ID-JAG is the proof." }],
    tech: [{ t: "TOKEN", c: "ID-JAG redeemed at MCP authorization server" }],
  },
  {
    title: "Scoped token", label: "Tool called",
    nodes: ["mcp", "agent"], edges: [3],
    lines: [{ who: "MCP AS", text: "The access token is scoped and visible on the live token chain." }],
    tech: [{ t: "TOKEN", c: "chain: user-token -> id-jag-issued -> id-jag-redeemed -> tool" }],
  },
  {
    title: "IT owns it all", label: "Grant + revocation",
    nodes: ["it"], edges: [4],
    lines: [{ who: "Presenter", text: "Decision, issuance, revocation — one place IT already controls." }],
    tech: [{ t: "POLICY", c: "central grant/revocation at the IdP (no per-server screens)" }],
  },
];

// Per-step detail: request forms use placeholders, tokens are decoded MOCK values, refs are published RFCs/specs or marked emerging drafts.
const steps = [
  {
    beats: [0],
    detail: {
      form: "PingFederate admin policy (no wire request in the demo)\n\nemployee E, MCP server S -> allowed\ngranted by group membership, per employee and per server",
      tokens: [],
      refs: [DRAFT("draft-ietf-oauth-identity-assertion-authz-grant", "ID-JAG: enterprise-managed authorization is decided at the IdP")],
    },
  },
  {
    beats: [1],
    detail: {
      form: "POST /as/token.oauth2   (PingFederate)\nContent-Type: application/x-www-form-urlencoded\n\ngrant_type=urn:ietf:params:oauth:grant-type:token-exchange\n&requested_token_type=urn:ietf:params:oauth:token-type:id-jag\n&subject_token=<user ID token>\n&subject_token_type=urn:ietf:params:oauth:token-type:id_token\n&audience=<MCP authorization server issuer>\n&resource=<MCP server URI>",
      tokens: [
        { note: "Input · subject_token (user ID token, decoded mock)", header: { alg: "RS256", typ: "JWT" }, claims: { iss: "https://pf.example", sub: "alice-0001", aud: "<agent client id>" } },
        { note: "Output · ID-JAG (decoded mock) · single use, short lived", header: { alg: "RS256", typ: "oauth-id-jag+jwt" }, claims: { iss: "https://pf.example", sub: "alice-0001", aud: "<MCP authorization server issuer>", resource: "<MCP server URI>", client_id: "<agent client id>", jti: "00000000-0000-4000-8000-000000000000", exp: 1790000120 } },
      ],
      refs: [DRAFT("draft-ietf-oauth-identity-assertion-authz-grant", "ID-JAG: enterprise-managed cross-app access"), RFC(8693, "Token Exchange (the request shape)")],
    },
  },
  {
    beats: [2],
    detail: {
      form: "POST /token   (MCP authorization server)\nContent-Type: application/x-www-form-urlencoded\n\ngrant_type=urn:ietf:params:oauth:grant-type:jwt-bearer\n&assertion=<ID-JAG>\n&scope=<requested scopes>",
      tokens: [{
        note: "Input · the ID-JAG presented as the assertion (decoded mock)",
        header: { alg: "RS256", typ: "oauth-id-jag+jwt" },
        claims: { iss: "https://pf.example", sub: "alice-0001", aud: "<MCP authorization server issuer>", resource: "<MCP server URI>", jti: "00000000-0000-4000-8000-000000000000" },
      }],
      refs: [RFC(7523, "JWT bearer authorization grant (the redeem request)"), DRAFT("draft-ietf-oauth-identity-assertion-authz-grant", "ID-JAG redemption at the resource authorization server")],
    },
  },
  {
    beats: [3],
    detail: {
      form: "-> 200\n{ \"access_token\": \"<access token>\", \"token_type\": \"Bearer\", \"expires_in\": 300, \"scope\": \"<granted scopes>\" }\n\nPOST /mcp\nAuthorization: Bearer <access token>",
      tokens: [{
        note: "MCP access token (decoded mock)",
        header: { alg: "RS256", typ: "at+jwt" },
        claims: { iss: "<MCP authorization server issuer>", sub: "alice-0001", aud: "<MCP server URI>", scope: "<granted scopes>", exp: 1790000300 },
      }],
      refs: [RFC(6750, "Bearer token usage"), RFC(9068, "JWT profile for access tokens"), RFC(8707, "Resource Indicators")],
    },
  },
  {
    beats: [4],
    detail: {
      form: "Revocation and grant stay at the IdP (no wire request in the demo)\n\nremove employee E from the group -> next ID-JAG request refused",
      tokens: [],
      refs: [RFC(7009, "Token Revocation"), DRAFT("draft-ietf-oauth-identity-assertion-authz-grant", "Central grant decision at the IdP")],
    },
  },
];

export default {
  id: "UC40",
  result: { label: "PERMIT", tone: "ok" },
  pingStyle: true,
  GROUPS: G,
  NODES,
  EDGES,
  walk,
  steps,
};
