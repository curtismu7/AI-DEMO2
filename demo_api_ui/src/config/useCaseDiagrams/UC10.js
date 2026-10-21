/**
 * UC10 — Resource-ownership / account takeover (DENY). A valid, scoped,
 * properly delegated token aimed at someone else's account: Authorize matches
 * the resource owner to the token subject and denies. Ownership lives in
 * policy, not app code.
 */
import { PARTICIPANT_GROUPS as G } from "./palette";
import { RFC, SPEC } from "../pingStyleStandards";

const NODES = [
  { id: "atk", group: "external", label: "Attack agent", sub: ["other user's acct"], x: 40, y: 150, detail: "Holds a real delegated token — scopes fine, delegation fine — and aims it at another user's account." },
  { id: "gw", group: "gateway", label: "Agent gateway", sub: ["asks the PDP"], x: 420, y: 150, detail: "Ownership is not checked in application code; the gateway asks the policy decision point." },
  { id: "p1", group: "pingone", label: "PingOne Authorize", sub: ["owner vs subject"], x: 800, y: 150, detail: "Binds the resource to the token subject: this account belongs to someone else." },
];

const EDGES = [
  ["atk", "gw", "read other account", { detail: "The call looks perfectly legitimate on every axis but ownership." }],
  ["gw", "p1", "authorize", { detail: "The policy compares resource owner against token subject." }],
  ["p1", "gw", "DENY", { detail: "Owner mismatch: no data returns." }],
  ["gw", "atk", "stopped", { detail: "The gateway halts the call before anything crosses back." }],
];

const walk = [
  {
    title: "Valid token, wrong target", label: "Everything fine but one thing",
    nodes: ["atk", "gw"], edges: [0],
    lines: [{ who: "Attacker", text: "Delegated, scoped, unexpired — aimed at account it does not own." }],
    tech: [{ t: "TOKEN", c: "AT: sub=alice (delegated), target account owner=bob" }],
  },
  {
    title: "Gateway asks policy", label: "Not an app-code check",
    nodes: ["gw", "p1"], edges: [1],
    lines: [{ who: "Gateway", text: "Ownership binds in policy; applications never wrote an owner check." }],
    tech: [{ t: "POLICY", c: "Authorize: resource.owner vs token.sub" }],
  },
  {
    title: "DENY", label: "Owner mismatch",
    nodes: ["p1", "gw"], edges: [2],
    lines: [{ who: "PingOne", text: "Even a valid, scoped, properly delegated token is denied on the mismatch." }],
    tech: [{ t: "POLICY", c: "owner(bob) != sub(alice) -> DENY" }],
  },
  {
    title: "No data returned", label: "Stopped at the gateway",
    nodes: ["gw", "atk"], edges: [3],
    lines: [{ who: "Gateway", text: "No record, no balance — nothing crossed back over the wire." }],
    tech: [{ t: "API", c: "gateway halts call; authorize-decision DENY recorded" }],
  },
];

// Per-step detail. Tokens are decoded MOCK values. The sim calls get_account_balance on a foreign account id through the
// full BFF pipeline (exchange -> Authorize -> gateway); see demo_api_server/services/attackSimulatorService.js (cross-owner-account).
const ISS = "https://auth.pingone.com/<env id>/as";
const steps = [
  {
    beats: [0],
    detail: {
      form: "POST /gateway/mcp\nAuthorization: Bearer <delegated access token>\nContent-Type: application/json\n\n{ \"jsonrpc\": \"2.0\", \"id\": 1, \"method\": \"tools/call\",\n  \"params\": { \"name\": \"get_account_balance\", \"arguments\": { \"account_id\": \"{otherUsersAccountId}\" } } }",
      tokens: [{
        note: "Delegated token (MOCK) - valid, scoped, unexpired; the subject is not the account's owner",
        header: { alg: "RS256", typ: "at+jwt" },
        claims: { iss: ISS, sub: "<alice user id>", aud: "<banking resource>", scope: "accounts:read", act: { sub: "<agent client id>" }, exp: "<unix time>" },
      }],
      refs: [RFC(6750, "Bearer token usage"), RFC(8693, "act claim: the agent acts for Alice, not for the account owner")],
    },
  },
  {
    beats: [1],
    detail: {
      form: "PingOne Authorize decision request\n\nsubject: <alice user id>, actor: <agent client id>\nresource: tool get_account_balance\nattributes: { ResourceOwnerId: \"<account owner id>\", account_id: \"{otherUsersAccountId}\" }\n\npolicy rule: ResourceOwnerId must equal the token subject",
      tokens: [],
      refs: [SPEC("PingOne Authorize decision API", "Gateway (PEP) asks the PingOne Authorize policy engine (PDP)"), SPEC("XACML 3.0", "Policy decision model: subject, resource, action, attributes")],
    },
  },
  {
    beats: [2],
    detail: {
      form: "Authorize decision: DENY\nreason: ResourceOwnerId (<account owner id>) != token subject (<alice user id>)\n\nGateway receives the DENY and does not dispatch the tool.",
      tokens: [],
      refs: [SPEC("XACML 3.0", "Decision values PERMIT / DENY")],
    },
  },
  {
    beats: [3],
    detail: {
      form: "HTTP/1.1 403 Forbidden  (or a JSON-RPC error result carrying the policy denial)\n\nno account record, no balance returned\nauthorize-decision DENY recorded on the token chain",
      tokens: [],
      refs: [SPEC("XACML 3.0", "The enforcement point honours the DENY decision")],
    },
  },
];

export default {
  id: "UC10",
  result: { label: "DENY", tone: "err" },
  pingStyle: true,
  GROUPS: G,
  NODES,
  EDGES,
  walk,
  steps,
};
