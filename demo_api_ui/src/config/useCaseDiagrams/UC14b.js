/**
 * UC14b — PAR + RAR intent verified (PERMIT). The learning scenario and happy
 * path: RFC 9126 PAR pushes the intent, RFC 9396 authorization_details caps
 * the amount, and the live request is checked against the pushed grant.
 */
import { PARTICIPANT_GROUPS as G } from "./palette";
import { RFC, SPEC } from "../pingStyleStandards";

const NODES = [
  { id: "agent", group: "agent", label: "Banking agent", sub: ["transfer $400"], x: 40, y: 150, detail: "Asks for a within-cap transfer — the intent it pushed is the intent it runs." },
  { id: "bff", group: "agent", label: "BFF", sub: ["pushes the intent"], x: 340, y: 150, detail: "Sends amount and payee to the PAR endpoint instead of a plain authorize URL." },
  { id: "par", group: "pingone", label: "PAR endpoint", sub: ["RFC 9126"], x: 640, y: 150, detail: "Stores the authorization_details grant and returns a single-use request_uri." },
  { id: "tok", group: "pingone", label: "Delegated token", sub: ["carries RAR grant"], x: 940, y: 150, detail: "The redeemed token embeds the bound details: cap $500, payee bound." },
  { id: "gw", group: "gateway", label: "Agent gateway", sub: ["cap check"], x: 1240, y: 150, detail: "At call time compares the live transfer against the pushed cap." },
];

const EDGES = [
  ["agent", "bff", "intent: $400 to savings", { detail: "The ask that becomes the pushed contract." }],
  ["bff", "par", "PAR push", { detail: "The intent now lives at PingOne, not in the agent." }],
  ["par", "tok", "request_uri -> token", { dashed: true, detail: "The token carries the RAR grant it was redeemed against." }],
  ["tok", "gw", "live cap check", { detail: "The gateway hands the actual transfer to the policy with the grant in hand." }],
  ["gw", "agent", "PERMIT", { dashed: true, detail: "Within cap -> the chain records Intent Verified." }],
];

const walk = [
  {
    title: "Intent is pushed", label: "PAR instead of a URL",
    nodes: ["agent", "bff"], edges: [0],
    lines: [{ who: "Agent", text: "The ask is $400 to savings — small enough to demonstrate, real enough to bind." }],
    tech: [{ t: "API", c: "POST /par  authorization_details={type:banking_transaction, amount<=500}" }],
  },
  {
    title: "Grant stored", label: "request_uri back",
    nodes: ["bff", "par"], edges: [1],
    lines: [{ who: "PAR", text: "A single-use request_uri references the stored intent." }],
    tech: [{ t: "TOKEN", c: "PAR grant stored: cap $500, payee bound (RFC 9396 details)" }],
  },
  {
    title: "Token carries the details", label: "The grant rides along",
    nodes: ["par", "tok"], edges: [2],
    lines: [{ who: "Token", text: "Redeemed token embeds authorization_details — the cap travels with the call." }],
    tech: [{ t: "TOKEN", c: "agent AT: authorization_details={amount<=500, payee=savings}" }],
  },
  {
    title: "Live vs pushed", label: "Checked at call time",
    nodes: ["tok", "gw"], edges: [3],
    lines: [{ who: "Gateway", text: "The actual transfer is compared against the pushed cap, not the scopes." }],
    tech: [{ t: "POLICY", c: "Authorize: live amount 400 <= pushed cap 500 -> within intent" }],
  },
  {
    title: "PERMIT", label: "Intent Verified",
    nodes: ["gw", "agent"], edges: [4],
    lines: [{ who: "Gateway", text: "The chain records Intent Verified — the happy-path counterpart to UC14." }],
    tech: [{ t: "POLICY", c: "authorize-decision: PERMIT (intent-binding-verified)" }],
  },
];

// Per-step detail. Tokens are decoded MOCK values. The PAR push mirrors demo_api_server/services/parService.js
// (client_secret_post, S256 PKCE, authorization_details as a JSON string, request_uri back).
const ISS = "https://auth.pingone.com/<env id>/as";
const RAR = { type: "banking_transaction", actions: ["create_transfer"], amount: 500, payee: "{savingsAccountId}" };
const steps = [
  {
    beats: [0],
    detail: {
      form: "chat: \"move $400 to savings\"\n\nBFF turns the ask into the intent it will push:\nauthorization_details = [ { \"type\": \"banking_transaction\", \"actions\": [\"create_transfer\"],\n                            \"amount\": 500, \"payee\": \"{savingsAccountId}\" } ]   (cap $500, ask is $400)",
      tokens: [],
      refs: [RFC(9396, "Rich Authorization Requests: authorization_details carry the transaction")],
    },
  },
  {
    beats: [1],
    detail: {
      form: "POST /<env id>/as/par\nContent-Type: application/x-www-form-urlencoded\n\nclient_id=<agent client id>&client_secret=<client secret>\n&response_type=code&scope=<scopes>\n&redirect_uri=<registered redirect>\n&code_challenge=<S256 challenge>&code_challenge_method=S256\n&authorization_details=[{\"type\":\"banking_transaction\",\"actions\":[\"create_transfer\"],\"amount\":500,\"payee\":\"{savingsAccountId}\"}]\n\n-> 201 { \"request_uri\": \"urn:ietf:params:oauth:request_uri:<opaque>\", \"expires_in\": <seconds> }",
      tokens: [],
      refs: [RFC(9126, "Pushed Authorization Requests (PAR)"), RFC(9396, "authorization_details inside the pushed request"), RFC(7636, "PKCE (S256 required for this client)")],
    },
  },
  {
    beats: [2],
    detail: {
      form: "GET /<env id>/as/authorize?client_id=<agent client id>&request_uri=urn:ietf:params:oauth:request_uri:<opaque>\n  (single use; the browser carries no intent parameters)\n\nPOST /<env id>/as/token  grant_type=authorization_code&code=<code>&code_verifier=<PKCE verifier>\n-> { \"access_token\": \"<agent access token>\", \"authorization_details\": [ ... ] }",
      tokens: [{
        note: "Delegated agent token (MOCK) - the RAR grant it was redeemed against rides in the token",
        header: { alg: "RS256", typ: "at+jwt" },
        claims: { iss: ISS, sub: "<user id>", aud: "<banking resource>", act: { sub: "<agent client id>" }, authorization_details: [RAR], exp: "<unix time>" },
      }],
      refs: [RFC(9126, "request_uri redeemed at the authorization endpoint"), RFC(9396, "authorization_details returned with the token"), RFC(6749, "Authorization code grant")],
    },
  },
  {
    beats: [3],
    detail: {
      form: "POST /gateway/mcp\nAuthorization: Bearer <agent access token>\nContent-Type: application/json\n\n{ \"jsonrpc\": \"2.0\", \"id\": 1, \"method\": \"tools/call\",\n  \"params\": { \"name\": \"create_transfer\", \"arguments\": { \"amount\": 400, \"to_account_id\": \"{savingsAccountId}\", \"from_account_id\": \"{checkingAccountId}\" } } }\n\nPingOne Authorize: live amount 400 <= granted amount 500, payee matches",
      tokens: [{
        note: "Agent token (MOCK) as the gateway reads it - the grant to compare against",
        claims: { sub: "<user id>", aud: "<banking resource>", act: { sub: "<agent client id>" }, authorization_details: [RAR] },
      }],
      refs: [RFC(9396, "The resource server enforces the call is within authorization_details"), SPEC("PingOne Authorize decision API", "Gateway asks the decision point with the grant in context")],
    },
  },
  {
    beats: [4],
    detail: {
      form: "Authorize decision: PERMIT (intent verified)\n\n{ \"jsonrpc\": \"2.0\", \"id\": 1, \"result\": { \"content\": [ { \"type\": \"text\", \"text\": \"<transfer confirmation>\" } ] } }\n\ntoken chain: authorize-decision PERMIT, intent binding verified",
      tokens: [],
      refs: [RFC(9396, "Executed call is a subset of the granted authorization_details")],
    },
  },
];

export default {
  id: "UC14b",
  result: { label: "PERMIT", tone: "ok" },
  pingStyle: true,
  GROUPS: G,
  NODES,
  EDGES,
  walk,
  steps,
};
