/**
 * UC37 — Verified Trust — signed agent assertion on A2A delegation. The same A2A
 * specialist handoff as UC2, but the chain also carries a signed SD-JWT verifiable
 * credential asserting which agent acts for which user — additive, not a replacement.
 */
import { PARTICIPANT_GROUPS as G } from "./palette";

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
  ["spec", "p1", "SD-JWT VC", { detail: "A DaVinci flow issues the credential asserting agent_id, acting_for, scope and chain_id — fail-open: if issuance fails, the bearer delegation completes untouched." }],
  ["spec", "gw", "PERMIT", { detail: "Authorize PERMITs over the act chain and the tool dispatches — and the receiving org proved the assertion from its signature alone, no issuer callback." }],
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
    nodes: ["spec", "p1", "gw"], edges: [3],
    lines: [{ who: "PingOne Credentials", text: "A DaVinci flow issues the credential asserting agent_id, acting_for, scope and chain_id — fail-open: if issuance fails, the bearer delegation completes untouched." }],
    tech: [
      { t: "TOKEN", c: "POST orchestrate-api.pingone.com/v1/company/{id}/policy/{flowId}/start {agent_id, acting_for, scope, chain_id} -> {credential, credentialId, expiresAt}" },
      { t: "POLICY", c: "additive, not a replacement — the nested-act chain still governs authorization" },
    ],
  },
  {
    title: "Dispatched, verified offline", label: "PERMIT",
    nodes: ["spec", "gw", "user"], edges: [4],
    lines: [{ who: "Gateway", text: "Authorize PERMITs over the act chain and the tool dispatches — and the receiving org proved the assertion from its signature alone, no issuer callback." }],
    tech: [
      { t: "POLICY", c: "Authorize evaluates act={specialist -> generalist} -> PERMIT; tool-dispatched" },
      { t: "TOKEN", c: "SD-JWT signature verified offline at the receiving org — no live connection to the issuer" },
    ],
  },
];

export default {
  id: "UC37",
  result: { label: "PERMIT", tone: "ok" },
  GROUPS: G,
  NODES,
  EDGES,
  walk,
};
