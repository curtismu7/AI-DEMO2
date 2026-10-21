/**
 * UC37 — Verified Trust — signed agent assertion on A2A delegation. The same A2A
 * specialist handoff as UC2, but the chain also carries a signed SD-JWT verifiable
 * credential asserting which agent acts for which user — additive, not a replacement.
 */
import { PARTICIPANT_GROUPS as G } from "./palette";
import { RFC, SPEC, DRAFT } from "../pingStyleStandards";

const NODES = [
  { id: "user", group: "user", label: "Alice (user)", sub: ["asks for the handoff"], x: 40, y: 150, detail: "Signs in and asks for the handoff; her token is the subject the whole chain must preserve." },
  { id: "gen", group: "agent", label: "Generalist agent", sub: ["Agent 1"], x: 340, y: 150, detail: "The banking agent holds Alice's token; not expert in the job, so it delegates to a specialist." },
  { id: "spec", group: "external", label: "Specialist agent", sub: ["Agent 2", "other org"], x: 640, y: 150, detail: "The other organization's specialist: its Agent Card advertises the required bearer scheme plus the signed credential it will accept." },
  { id: "p1", group: "pingone", label: "PingOne", sub: ["RFC 8693 x2", "Credentials / DaVinci"], x: 940, y: 150, detail: "Mints the nested act chain across two exchanges and issues the signed SD-JWT assertion through a DaVinci flow." },
  { id: "gw", group: "gateway", label: "MCP gateway", sub: ["Authorize", "tool dispatch"], x: 1240, y: 150, detail: "Dispatches the specialist's tool call; PingOne Authorize evaluates the whole nested act chain before it executes." },
];

const EDGES = [
  ["user", "gen", "delegation subject", { detail: "Alice's sign-in consent authorizes the handoff; her token is the subject of both exchanges." }],
  ["gen", "spec", "Agent Card", { detail: "Agent Card discovery first: the specialist requires a PingOne bearer token and additionally advertises the signed credential scheme." }],
  ["spec", "p1", "RFC 8693 x2", { detail: "Two exchanges: the user token goes in, a token with act nested inside act comes out — the subject stays Alice throughout." }],
  ["spec", "p1", "SD-JWT VC", { dashed: true, detail: "A DaVinci flow issues the credential asserting agent_id, acting_for, scope and chain_id — fail-open: if issuance fails, the bearer delegation completes untouched." }],
  ["spec", "gw", "PERMIT", { dashed: true, detail: "Authorize PERMITs over the act chain and the tool dispatches — and the receiving org proved the assertion from its signature alone, no issuer callback." }],
];

const walk = [
  {
    title: "Alice asks for the handoff", label: "delegation subject",
    nodes: ["user", "gen"], edges: [0],
    lines: [{ who: "Alice", text: "Sign-in consent is what authorizes everything that follows — her token is the subject of both exchanges." }],
    tech: [{ t: "TOKEN", c: "user AT: sub=alice — subject presented to Exchange #1, preserved through the chain" }],
  },
  {
    title: "Handoff, two schemes advertised", label: "Agent Card",
    nodes: ["gen", "spec"], edges: [1],
    lines: [{ who: "Generalist", text: "Agent Card discovery first: the specialist requires a PingOne bearer token and additionally advertises the signed credential scheme." }],
    tech: [
      { t: "A2A", c: "GET /a2a/specialists/{vertical}/.well-known/agent-card.json" },
      { t: "POLICY", c: "securitySchemes: pingoneBearer (required) + verifiedTrustCredential (VC-SD-JWT, additive)" },
    ],
  },
  {
    title: "Nested act chain minted", label: "RFC 8693 x2",
    nodes: ["spec", "p1"], edges: [2],
    lines: [{ who: "PingOne", text: "Two exchanges: the user token goes in, a token with act nested inside act comes out — the subject stays Alice throughout." }],
    tech: [
      { t: "TOKEN", c: "grant_type=urn:ietf:params:oauth:grant-type:token-exchange -> T_invest: sub=alice, act={sub:specialist, act:{sub:generalist}}" },
      { t: "POLICY", c: "audience = the specialist's own A2A Intermediate resource; scope narrows to its a2aDelegatedScope" },
    ],
  },
  {
    title: "Signed assertion alongside the chain", label: "SD-JWT VC",
    nodes: ["spec", "p1"], edges: [3],
    lines: [{ who: "PingOne Credentials", text: "A DaVinci flow issues the credential asserting agent_id, acting_for, scope and chain_id — fail-open: if issuance fails, the bearer delegation completes untouched." }],
    tech: [
      { t: "TOKEN", c: "POST orchestrate-api.pingone.com/v1/company/{id}/policy/{flowId}/start {agent_id, acting_for, scope, chain_id} -> {credential, credentialId, expiresAt}" },
      { t: "POLICY", c: "additive, not a replacement — the nested-act chain still governs authorization" },
    ],
  },
  {
    title: "Dispatched, verified offline", label: "PERMIT",
    nodes: ["spec", "gw"], edges: [4],
    lines: [{ who: "Gateway", text: "Authorize PERMITs over the act chain and the tool dispatches — and the receiving org proved the assertion from its signature alone, no issuer callback." }],
    tech: [
      { t: "POLICY", c: "Authorize evaluates act={specialist -> generalist} -> PERMIT; tool-dispatched" },
      { t: "TOKEN", c: "SD-JWT signature verified offline at the receiving org — no live connection to the issuer" },
    ],
  },
];

// Per-step detail: request forms use placeholders, tokens are decoded MOCK values, refs are published RFCs/specs or marked emerging drafts.
const steps = [
  {
    beats: [0],
    detail: {
      form: "POST /api/agent/run\nContent-Type: application/json\nCookie: <session cookie>\n\n{ \"messages\": [{ \"role\": \"user\", \"content\": \"hand this to the investment specialist\" }] }",
      tokens: [{
        note: "User access token (decoded mock) · the subject both exchanges must preserve",
        header: { alg: "RS256", typ: "at+jwt" },
        claims: { iss: "https://auth.pingone.com/ENV_ID/as", sub: "alice-0001", aud: "https://bff.ping.demo", scope: "banking:read", exp: 1790000000 },
      }],
      refs: [SPEC("OIDC Core 1.0", "OpenID Connect sign-in that mints the user token"), RFC(9068, "JWT profile for access tokens")],
    },
  },
  {
    beats: [1],
    detail: {
      form: "GET /a2a/specialists/{vertical}/.well-known/agent-card.json\n\n-> 200\n{ \"name\": \"<specialist agent>\",\n  \"securitySchemes\": {\n    \"pingoneBearer\": { \"httpAuthSecurityScheme\": { \"scheme\": \"Bearer\", \"bearerFormat\": \"JWT\" } },\n    \"verifiedTrustCredential\": { \"httpAuthSecurityScheme\": { \"scheme\": \"VC-SD-JWT\", \"bearerFormat\": \"SD-JWT\" } } },\n  \"securityRequirements\": [{ \"schemes\": { \"pingoneBearer\": { \"list\": [] } } }] }",
      tokens: [],
      refs: [SPEC("A2A Agent Card", "Agent capability and security-scheme description"), RFC(6750, "Bearer token usage (the required scheme)"), DRAFT("draft-ietf-oauth-sd-jwt-vc", "SD-JWT-based Verifiable Credentials (the additive scheme)")],
    },
  },
  {
    beats: [2],
    detail: {
      form: "POST /as/token   (PingOne, called twice in a row)\nContent-Type: application/x-www-form-urlencoded\n\ngrant_type=urn:ietf:params:oauth:grant-type:token-exchange\n&subject_token=<user access token>\n&subject_token_type=urn:ietf:params:oauth:token-type:access_token\n&actor_token=<agent access token>\n&actor_token_type=urn:ietf:params:oauth:token-type:access_token\n&audience=<specialist A2A Intermediate resource>\n&scope=<a2aDelegatedScope>",
      tokens: [
        { note: "Input 1 · subject_token (user access token, decoded mock)", header: { alg: "RS256", typ: "at+jwt" }, claims: { iss: "https://auth.pingone.com/ENV_ID/as", sub: "alice-0001", aud: "https://bff.ping.demo", scope: "banking:read" } },
        { note: "Input 2 · actor_token (generalist agent token, decoded mock)", header: { alg: "RS256", typ: "at+jwt" }, claims: { iss: "https://auth.pingone.com/ENV_ID/as", sub: "generalist-agent-client", aud: "https://bff.ping.demo", scope: "agent:invoke" } },
        { note: "Output · T_invest (decoded mock), act nested inside act", header: { alg: "RS256", typ: "at+jwt" }, claims: { iss: "https://auth.pingone.com/ENV_ID/as", sub: "alice-0001", aud: "<specialist A2A Intermediate resource>", scope: "<a2aDelegatedScope>", act: { sub: "specialist-agent-client", act: { sub: "generalist-agent-client" } }, exp: 1790000300 } },
      ],
      refs: [RFC(8693, "Token Exchange: subject_token, actor_token and the nested act claim; audience parameter per hop (section 2.1)")],
    },
  },
  {
    beats: [3],
    detail: {
      form: "POST https://orchestrate-api.pingone.com/v1/company/{COMPANY_ID}/policy/{FLOW_ID}/start\nContent-Type: application/json\n<API key header>: <API key>\n\n{ \"agent_id\": \"<specialist agent id>\", \"acting_for\": \"alice-0001\",\n  \"scope\": \"<a2aDelegatedScope>\", \"chain_id\": \"<chain id>\" }\n\n-> 200 { \"credential\": \"<compact SD-JWT VC>\", \"credentialId\": \"<id>\", \"expiresAt\": \"<ISO time>\" }",
      tokens: [{
        note: "Verifiable credential (decoded mock) · signed assertion alongside the chain, never a replacement",
        header: { alg: "ES256", typ: "<SD-JWT VC typ, draft-dependent>" },
        claims: { iss: "<issuer URL>", vct: "<agent assertion type>", agent_id: "<specialist agent id>", acting_for: "alice-0001", scope: "<a2aDelegatedScope>", chain_id: "<chain id>", iat: 1790000000, exp: 1790000600 },
      }],
      refs: [DRAFT("draft-ietf-oauth-sd-jwt-vc", "SD-JWT-based Verifiable Credentials; the typ header value is draft-dependent")],
    },
  },
  {
    beats: [4],
    detail: {
      form: "POST /mcp\nAuthorization: Bearer <T_invest>\nContent-Type: application/json\n\n{ \"jsonrpc\": \"2.0\", \"id\": 1, \"method\": \"tools/call\",\n  \"params\": { \"name\": \"<tool>\", \"arguments\": {} } }\n\nPingOne Authorize: subject alice-0001, actor chain specialist -> generalist -> PERMIT\nReceiving org: SD-JWT signature checked offline, no issuer callback",
      tokens: [{
        note: "T_invest as the gateway sees it (decoded mock)",
        header: { alg: "RS256", typ: "at+jwt" },
        claims: { iss: "https://auth.pingone.com/ENV_ID/as", sub: "alice-0001", act: { sub: "specialist-agent-client", act: { sub: "generalist-agent-client" } } },
      }],
      refs: [RFC(8693, "act claim: who is acting for whom, nested per hop"), SPEC("OpenID AuthZEN", "Standard PEP to PDP authorization API"), RFC(6750, "Bearer token usage")],
    },
  },
];

export default {
  id: "UC37",
  result: { label: "PERMIT", tone: "ok" },
  pingStyle: true,
  GROUPS: G,
  NODES,
  EDGES,
  walk,
  steps,
};
