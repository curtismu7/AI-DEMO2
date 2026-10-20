/**
 * UC39 — Centralized MCP revocation. The presenter runs 'show my balance'
 * (PERMIT — the baseline), then removes the user from the allowed PingOne
 * group and runs it again: the enterprise IdP refuses to mint the ID-JAG and
 * any MCP token the session holds is revoked. One console edit, gone
 * everywhere at once.
 */
import { PARTICIPANT_GROUPS as G } from "./palette";

const NODES = [
  { id: "user", group: "user", label: "Alice (employee)", sub: ["in allowed group"], x: 40, y: 300, detail: "Starts entitled — the baseline run is real access, not a staged pass. Her group membership is the whole story." },
  { id: "agent", group: "agent", label: "Banking agent", sub: ["same chip, twice"], x: 640, y: 300, detail: "Runs 'show my balance' before and after the console edit — the only thing that changes is the group membership." },
  { id: "gw", group: "gateway", label: "Agent gateway / BFF", sub: ["ID-JAG stand-in"], x: 640, y: 150, detail: "Mints the MCP token through RFC 8693, labeled as an ID-JAG stand-in. Nothing downstream can succeed if the IdP refuses to mint." },
  { id: "p1", group: "pingone", label: "PingOne (enterprise IdP)", sub: ["group gate", "revokes tokens"], x: 940, y: 150, detail: "Policy is evaluated at the IdP before an ID-JAG is issued — removal denies the next mint there and revokes any MCP token the session still holds." },
];

const EDGES = [
  ["agent", "gw", "show my balance — run 1", { lane: 60, detail: "The baseline run while entitled: a normal governed call." }],
  ["gw", "p1", "mint under the group gate", { detail: "The BFF mints the MCP token via RFC 8693; the IdP evaluates group policy first." }],
  ["p1", "gw", "issued — PERMIT", { detail: "In the allowed group: the IdP mints and dispatch proceeds." }],
  ["p1", "p1", "user removed from group", { detail: "One console edit in PingOne. Lower enterprise_mcp_policy_cache_ttl_ms for a live demo — the default 5-minute policy cache delays the effect." }],
  ["p1", "gw", "re-run refused", { detail: "The IdP refuses to issue an ID-JAG: enterprise_mcp_policy_denied. The refusal is at the IdP, not downstream at the resource server." }],
  ["gw", "agent", "no token, no tool", { vertical: true, detail: "Any MCP token the session held is revoked — access is gone everywhere at once, no per-tool cleanup." }],
];

const walk = [
  {
    title: "Run 1 — entitled", label: "The baseline PERMIT",
    nodes: ["agent", "gw"], edges: [0],
    lines: [{ who: "Agent", text: "'show my balance' while Alice is in the allowed group — a normal enterprise-managed run." }],
    tech: [{ t: "TOKEN", c: "chain: user-token -> enterprise-managed-mode (baseline PERMIT)" }],
  },
  {
    title: "Minted under the group gate", label: "Policy at the IdP",
    nodes: ["gw", "p1"], edges: [1, 2],
    lines: [{ who: "PingOne", text: "The group gate passes, so the ID-JAG stand-in exchange mints the MCP token." }],
    tech: [
      { t: "TOKEN", c: "RFC 8693 (ID-JAG stand-in) -> MCP AT for allowed group" },
      { t: "POLICY", c: "policy evaluated at the IdP BEFORE the ID-JAG is issued" },
    ],
  },
  {
    title: "Offboarding — one console edit", label: "Remove from the group",
    nodes: ["p1"], edges: [3],
    lines: [{ who: "Presenter", text: "Remove the demo user from the allowed PingOne group in the console, then run the same chip again." }],
    tech: [{ t: "POLICY", c: "console: user removed from allowed PingOne group" }],
  },
  {
    title: "Run 2 — refused at the IdP", label: "No mint, no tool",
    nodes: ["p1", "gw"], edges: [4],
    lines: [{ who: "PingOne", text: "Policy denies at issuance: no ID-JAG exists for the BFF to redeem." }],
    tech: [{ t: "POLICY", c: "user ∉ allowed group -> enterprise_mcp_policy_denied (no ID-JAG minted)" }],
  },
  {
    title: "Gone everywhere at once", label: "The offboarding story",
    nodes: ["gw", "agent"], edges: [5],
    lines: [{ who: "Presenter", text: "One console controls MCP access for every employee and every server — the story enterprises ask about first." }],
    tech: [{ t: "TOKEN", c: "session's MCP access token revoked — cannot outlive the decision" }],
  },
];

// Per-step detail. Forms mirror the real routes (POST /api/agent/run, POST /api/enterprise-idp/token and its 403 body);
// the ID-JAG is a decoded MOCK of the claims routes/enterpriseIdp.js signs. The console edit (beat 2) has no BFF request, so it has no step.
const steps = [
  {
    beats: [0],
    detail: {
      form: "POST /api/agent/run\nContent-Type: application/json\nCookie: <session cookie>\n\n{ \"messages\": [{ \"role\": \"user\", \"content\": \"show my balance\" }] }",
    },
  },
  {
    beats: [1],
    detail: {
      form: "POST /api/enterprise-idp/token\nContent-Type: application/x-www-form-urlencoded\nCookie: <session cookie>\n\ngrant_type=urn:ietf:params:oauth:grant-type:token-exchange\n&requested_token_type=urn:ietf:params:oauth:token-type:id-jag\n&audience=<MCP authorization server issuer>\n&resource=<MCP server URI>\n&scope=<requested scopes>",
      tokens: [{
        note: "ID-JAG (stand-in) · issued only after the group gate passes",
        header: { alg: "RS256", typ: "oauth-id-jag+jwt", kid: "<enterprise idp key id>" },
        claims: { jti: "00000000-0000-4000-8000-000000000000", iss: "https://enterprise-idp.example", sub: "user-0001", aud: "<MCP authorization server issuer>", resource: "<MCP server URI>", client_id: "demo-bff-mcp-client", scope: "banking:read", iat: 1790000000, exp: 1790000120 },
      }],
      refs: [{ id: "RFC 8693", title: "OAuth 2.0 Token Exchange", kind: "rfc" }],
    },
  },
  {
    beats: [3],
    detail: {
      form: "POST /api/enterprise-idp/token   (same request as run 1)\n\n-> 403 Forbidden\n{ \"error\": \"access_denied\",\n  \"error_description\": \"Your account is not authorized for enterprise-managed MCP access. Contact IT to request access (for example, membership in the banking-agents group).\",\n  \"code\": \"enterprise_mcp_policy_denied\" }",
    },
  },
  {
    beats: [4],
    detail: {
      refs: [{ id: "RFC 7009", title: "OAuth 2.0 Token Revocation", kind: "rfc" }],
    },
  },
];

export default {
  id: "UC39",
  result: { label: "PERMIT", tone: "ok" },
  pingStyle: true,
  GROUPS: G,
  NODES,
  EDGES,
  walk,
  steps,
};
