/**
 * UC38 — Workload Agent: MFA-gated protected action. The BFF demands an
 * MFA-satisfied token, verifies the pre-registered workload agent, then runs
 * the action through the gateway and Authorize with a delegated token
 * (sub=user, act=agent on every call).
 */
import { PARTICIPANT_GROUPS as G } from "./palette";
import { RFC, SPEC } from "../pingStyleStandards";

const NODES = [
  { id: "user", group: "user", label: "Alice (user)", sub: ["picks the action"], x: 40, y: 150, detail: "Chooses a protected action in the digital assistant — transfer $600 from checking to savings." },
  { id: "agent", group: "agent", label: "Workload agent", sub: ["pre-registered"], x: 340, y: 150, detail: "Verified as pre-registered — delegation is not implied by session context." },
  { id: "bff", group: "gateway", label: "BFF", sub: ["MFA token demanded"], x: 640, y: 150, detail: "Identity step-up comes before delegation: no MFA proof, no agent action." },
  { id: "p1", group: "pingone", label: "PingOne", sub: ["exchange + policy"], x: 940, y: 150, detail: "Mints the delegated token (sub=alice, act=agent) and evaluates the action." },
];

const EDGES = [
  ["user", "agent", "request protected action", { detail: "The assistant offers the transfer; the customer confirms." }],
  ["agent", "bff", "act for Alice", { detail: "The workload agent presents itself for verification." }],
  ["bff", "p1", "MFA-satisfied token", { detail: "The BFF demands proof of step-up before anything delegations." }],
  ["p1", "bff", "delegated token", { dashed: true, detail: "RFC 8693: sub=alice, act=workload agent — stamped on every tool call." }],
  ["bff", "user", "action done", { detail: "Gateway + Authorize PERMIT; the result lands in the assistant." }],
];

const walk = [
  {
    title: "Protected action picked", label: "$600 transfer",
    nodes: ["user", "agent"], edges: [0],
    lines: [{ who: "Alice", text: "The digital assistant offers the transfer; she confirms it." }],
    tech: [{ t: "API", c: "workload agent requests transfer $600 (checking -> savings)" }],
  },
  {
    title: "Agent verified", label: "Pre-registered",
    nodes: ["agent", "bff"], edges: [1],
    lines: [{ who: "BFF", text: "Delegation requires a registered agent, not just an authenticated session." }],
    tech: [{ t: "POLICY", c: "workload agent lookup: registered (personal-agent-lookup)" }],
  },
  {
    title: "MFA demanded", label: "Step-up before delegation",
    nodes: ["bff", "p1"], edges: [2],
    lines: [{ who: "BFF", text: "No MFA-satisfied token, no agent action — identity proof is the gate." }],
    tech: [{ t: "POLICY", c: "BFF requires MFA-satisfied AT (acr step-up)" }],
  },
  {
    title: "Delegated token minted", label: "RFC 8693",
    nodes: ["p1", "bff"], edges: [3],
    lines: [{ who: "PingOne", text: "sub=alice, act=agent — visible in every subsequent tool call." }],
    tech: [{ t: "TOKEN", c: "RFC 8693 -> AT: sub=alice, act={sub:workload-agent}" }],
  },
  {
    title: "PERMIT", label: "Action runs",
    nodes: ["bff", "user"], edges: [4],
    lines: [{ who: "Presenter", text: "Customers get the assistant; the bank gets identity proof on the record." }],
    tech: [{ t: "POLICY", c: "authorize-decision: PERMIT -> tool-dispatched" }],
  },
];

// Per-step detail: request forms use placeholders, tokens are decoded MOCK values, refs are published RFCs/specs or marked emerging drafts.
const steps = [
  {
    beats: [0],
    detail: {
      form: "POST /api/agent/run\nContent-Type: application/json\nCookie: <session cookie>\n\n{ \"messages\": [{ \"role\": \"user\", \"content\": \"transfer $600 from checking to savings\" }] }",
      tokens: [],
      refs: [SPEC("OIDC Core 1.0", "The signed-in session the request rides on")],
    },
  },
  {
    beats: [1],
    detail: {
      form: "Personal-agent lookup (inside the BFF, no outbound request)\n\ninput:  user alice-0001, workload agent id\nresult: registered, enabled, client_credentials grant\nmissing registration -> agent_not_registered, run stops",
      tokens: [],
      refs: [RFC(6749, "Client credentials grant (the workload agent's own identity, section 4.4)")],
    },
  },
  {
    beats: [2],
    detail: {
      form: "BFF check on the user access token before any delegation\n\nrequired: acr / amr show MFA satisfied\nmissing   -> step-up challenge, nothing is exchanged",
      tokens: [{
        note: "MFA-satisfied user access token (decoded mock)",
        header: { alg: "RS256", typ: "at+jwt" },
        claims: { iss: "https://auth.pingone.com/ENV_ID/as", sub: "alice-0001", aud: "https://bff.ping.demo", acr: "<MFA policy name>", amr: ["pwd", "mfa"], exp: 1790000000 },
      }],
      refs: [RFC(9470, "Step-up authentication challenge"), RFC(8176, "Authentication Method Reference values (amr)"), SPEC("OIDC Core 1.0", "acr and amr claims")],
    },
  },
  {
    beats: [3],
    detail: {
      form: "POST /as/token   (PingOne)\nContent-Type: application/x-www-form-urlencoded\n\ngrant_type=urn:ietf:params:oauth:grant-type:token-exchange\n&subject_token=<MFA-satisfied user access token>\n&subject_token_type=urn:ietf:params:oauth:token-type:access_token\n&actor_token=<workload agent token>\n&actor_token_type=urn:ietf:params:oauth:token-type:access_token\n&audience=<MCP resource>",
      tokens: [
        { note: "Input 1 · subject_token (MFA-satisfied user token, decoded mock)", header: { alg: "RS256", typ: "at+jwt" }, claims: { iss: "https://auth.pingone.com/ENV_ID/as", sub: "alice-0001", amr: ["pwd", "mfa"] } },
        { note: "Input 2 · actor_token (workload agent token, decoded mock)", header: { alg: "RS256", typ: "at+jwt" }, claims: { iss: "https://auth.pingone.com/ENV_ID/as", sub: "workload-agent-client", scope: "agent:invoke" } },
        { note: "Output · delegated token (decoded mock)", header: { alg: "RS256", typ: "at+jwt" }, claims: { iss: "https://auth.pingone.com/ENV_ID/as", sub: "alice-0001", aud: "<MCP resource>", act: { sub: "workload-agent-client" }, exp: 1790000300 } },
      ],
      refs: [RFC(8693, "Token Exchange and the act claim"), RFC(8707, "Resource Indicators")],
    },
  },
  {
    beats: [4],
    detail: {
      form: "POST /mcp\nAuthorization: Bearer <delegated token>\nContent-Type: application/json\n\n{ \"jsonrpc\": \"2.0\", \"id\": 1, \"method\": \"tools/call\",\n  \"params\": { \"name\": \"create_transfer\", \"arguments\": { \"amount\": 600, \"fromAccountId\": \"{fromAccountId}\", \"toAccountId\": \"{toAccountId}\" } } }\n\nPingOne Authorize: subject alice-0001, actor workload-agent-client -> PERMIT",
      tokens: [],
      refs: [SPEC("OpenID AuthZEN", "Standard PEP to PDP authorization API"), RFC(6750, "Bearer token usage")],
    },
  },
];

export default {
  id: "UC38",
  result: { label: "PERMIT", tone: "ok" },
  pingStyle: true,
  GROUPS: G,
  NODES,
  EDGES,
  walk,
  steps,
};
