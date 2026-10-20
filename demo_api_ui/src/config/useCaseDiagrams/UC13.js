/**
 * UC13 — Confused-deputy actor injection (DENY). A rogue agent injects itself
 * as the acting party. Actor identity comes from the native act claim PingOne
 * stamped at a real token exchange — never a request header — so the forgery
 * dies at the actor check.
 */
import { PARTICIPANT_GROUPS as G } from "./palette";
import { RFC, SPEC } from "../pingStyleStandards";

const NODES = [
  { id: "rogue", group: "external", label: "Rogue agent", sub: ["forges act header"], x: 40, y: 150, detail: "Tries to become the acting party by injecting itself into the delegation chain — headers are easy to forge." },
  { id: "pipe", group: "gateway", label: "Full pipeline", sub: ["runs anyway"], x: 340, y: 150, detail: "Token exchange, Authorize, Agent Gateway — the system treats it like any other call." },
  { id: "p1", group: "pingone", label: "PingOne Authorize", sub: ["actor check"], x: 640, y: 150, detail: "The native act claim was stamped at exchange time; a header cannot rewrite what the AS signed." },
  { id: "claim", group: "pingone", label: "act claim", sub: ["signed by PingOne"], x: 940, y: 150, detail: "The acting party in the exchanged token. It is part of the signed JWT, so a request header cannot rewrite it." },
];

const EDGES = [
  ["rogue", "pipe", "forged call", { detail: "The claimed actor is injected in a header." }],
  ["pipe", "p1", "evaluate", { detail: "The full pipeline runs; nothing is shortcut." }],
  ["p1", "claim", "native claim", { detail: "The act claim was stamped by PingOne at a real exchange — not request-supplied." }],
  ["p1", "pipe", "DENY", { dashed: true, detail: "act in the token does not match the claimed actor." }],
  ["pipe", "rogue", "refused", { dashed: true, detail: "The audience sees the Authorize DENY end to end." }],
];

const walk = [
  {
    title: "Forgery attempted", label: "Header injection",
    nodes: ["rogue", "pipe"], edges: [0],
    lines: [{ who: "Rogue agent", text: "Claims the acting-party role in a header — the confused-deputy move." }],
    tech: [{ t: "API", c: "request carries forged act/actor header" }],
  },
  {
    title: "Pipeline runs", label: "No shortcut",
    nodes: ["pipe", "p1"], edges: [1],
    lines: [{ who: "Gateway", text: "The call goes through the whole governed path — which is where it dies." }],
    tech: [{ t: "POLICY", c: "token exchange + authorize evaluation proceed normally" }],
  },
  {
    title: "Native claim wins", label: "Stamped at exchange",
    nodes: ["p1", "claim"], edges: [2],
    lines: [{ who: "PingOne", text: "The real actor was set by PingOne at exchange time. Headers lie; claims do not." }],
    tech: [{ t: "TOKEN", c: "act={...} minted by PingOne at RFC 8693 exchange (not request-supplied)" }],
  },
  {
    title: "DENY", label: "Actor check fails",
    nodes: ["p1", "pipe"], edges: [3],
    lines: [{ who: "PingOne", text: "The acting party in the token is not the claimed one." }],
    tech: [{ t: "POLICY", c: "Authorize actor check: token act != claimed actor -> DENY" }],
  },
  {
    title: "Cannot be spoofed", label: "What the audience sees",
    nodes: ["pipe", "rogue"], edges: [4],
    lines: [{ who: "Presenter", text: "Even a compromised internal service that can forge headers cannot forge the claim." }],
    tech: [{ t: "POLICY", c: "authorize-decision: DENY visible in chat + chain" }],
  },
];

// Per-step detail. Tokens are decoded MOCK values. The sim injects X-Act-Client-Id = a non-allowlisted rogue client id and
// runs the full BFF pipeline (exchange -> Authorize -> gateway); see attackSimulatorService.js (rogue-actor).
const ISS = "https://auth.pingone.com/<env id>/as";
const steps = [
  {
    beats: [0],
    detail: {
      form: "POST /gateway/mcp\nAuthorization: Bearer <delegated access token>\nX-Act-Client-Id: rogue-agent-9f2a-not-allowlisted\nContent-Type: application/json\n\n{ \"jsonrpc\": \"2.0\", \"id\": 1, \"method\": \"tools/call\",\n  \"params\": { \"name\": \"get_my_accounts\", \"arguments\": {} } }",
      tokens: [],
      refs: [RFC(8693, "Token Exchange: the acting party is carried in the act claim, not in a header")],
    },
  },
  {
    beats: [1],
    detail: {
      form: "1. POST /<env id>/as/token  grant_type=urn:ietf:params:oauth:grant-type:token-exchange\n     subject_token=<user access token>  actor_token=<agent token>\n2. BFF preflight: PingOne Authorize decision request (ActClientId attribute)\n3. POST /gateway/mcp with the exchanged token\nNothing is short-cut - the forgery travels the whole governed path.",
      tokens: [],
      refs: [RFC(8693, "OAuth 2.0 Token Exchange"), SPEC("OpenID AuthZEN", "Policy enforcement point asks the decision point")],
    },
  },
  {
    beats: [2],
    detail: {
      form: "The act claim was written by PingOne when it signed the exchanged token.\nA request header cannot change a signed claim.",
      tokens: [{
        note: "Exchanged token (MOCK) - the real actor, stamped by PingOne at the exchange",
        header: { alg: "RS256", typ: "at+jwt" },
        claims: { iss: ISS, sub: "<user id>", aud: "<banking resource>", scope: "accounts:read", act: { sub: "<real agent client id>" }, exp: "<unix time>" },
      }],
      refs: [RFC(8693, "Section 4.1: the act claim identifies the acting party"), RFC(7519, "JSON Web Token: signed claims"), RFC(9068, "JWT profile for access tokens")],
    },
  },
  {
    beats: [3],
    detail: {
      form: "PingOne Authorize decision: DENY\nreason: claimed actor (rogue-agent-9f2a-not-allowlisted) is not an authorized actor, and\n        does not match act.sub in the token\n\nGateway receives the DENY; the tool is not dispatched.",
      tokens: [{
        note: "Comparison (MOCK) - the two values the actor check sets side by side",
        claims: { claimed_actor: "rogue-agent-9f2a-not-allowlisted", token_act_sub: "<real agent client id>", allowlisted: false },
      }],
      refs: [SPEC("XACML 3.0", "Attribute-based decision: PERMIT / DENY"), RFC(8693, "act claim as the trusted source of the actor")],
    },
  },
  {
    beats: [4],
    detail: {
      form: "chat: \"Denied by policy\" with the Authorize DENY\ntoken chain: exchange -> authorize-decision DENY (visible end to end)\nHTTP 403 from the gateway path; no data returned",
      tokens: [],
      refs: [RFC(8693, "Delegation is provable from the signed token, not from request metadata")],
    },
  },
];

export default {
  id: "UC13",
  result: { label: "DENY", tone: "err" },
  pingStyle: true,
  GROUPS: G,
  NODES,
  EDGES,
  walk,
  steps,
};
