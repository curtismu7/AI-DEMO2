/**
 * UC15 — Intent-token tampering. An attack sim alters the amount or payee in
 * an otherwise valid intent token; the signature check at the gateway catches
 * the tampering cryptographically, and the gateway rejects it (403 intent_token_invalid) before any tool runs.
 */
import { PARTICIPANT_GROUPS as G } from "./palette";
import { RFC } from "../pingStyleStandards";

const NODES = [
  { id: "user", group: "user", label: "Alice (user)", sub: ["approved intent"], x: 40, y: 150, detail: "The approved intent is a signed token — amount, payee, expiry — not a flag." },
  { id: "sim", group: "agent", label: "Attack sim", sub: ["tampered-intent-token"], x: 340, y: 150, detail: "Alters the amount or payee in flight — the signature no longer matches." },
  { id: "gw", group: "gateway", label: "Agent gateway", sub: ["validates signature"], x: 940, y: 150, detail: "Checks signature and expiry on the request path, before anything else." },
  { id: "bff", group: "gateway", label: "BFF", sub: ["mints + signs intent token"], x: 1240, y: 150, detail: "Minted the intent token and signed it (HS256, shared secret); the gateway holds the same secret to check it." },
];

const EDGES = [
  ["user", "sim", "intent token in play", { dashed: true, detail: "The token was valid when minted — that is what makes the tamper interesting." }],
  ["sim", "gw", "presents tampered token", { detail: "An altered amount or payee breaks the signature — the whole trick, and the whole tell." }],
  ["gw", "bff", "validate signature", { detail: "Validation runs on every call; no application code verifies intent integrity." }],
  ["gw", "sim", "403 — tamper detected", { dashed: true, detail: "The cryptographic check caught the alteration; no tool ever ran." }],
];

const walk = [
  {
    title: "Intent token minted", label: "Signed, not a flag",
    nodes: ["user", "sim"], edges: [0],
    lines: [{ who: "BFF", text: "Amount, payee, expiry — all bound into the signature." }],
    tech: [{ t: "TOKEN", c: "intent AT minted: amount, payee, exp; signed by the BFF (HS256, shared secret)" }],
  },
  {
    title: "Tampered in flight", label: "Signature breaks",
    nodes: ["sim", "gw"], edges: [1],
    lines: [{ who: "Attack sim", text: "An otherwise valid token with a corrupted signature — the alteration is the attack." }],
    tech: [{ t: "API", c: "attack sim tampered-intent-token: amount/payee altered, signature mismatch" }],
  },
  {
    title: "Signature check", label: "On the request path",
    nodes: ["gw", "bff"], edges: [2],
    lines: [{ who: "Gateway", text: "Signature and expiry are validated before any tool is considered." }],
    tech: [{ t: "POLICY", c: "gateway verifies the HMAC signature+expiry with the shared intent secret -> invalid" }],
  },
  {
    title: "403 — nothing ran", label: "Detected cryptographically",
    nodes: ["gw", "sim"], edges: [3],
    lines: [{ who: "Gateway", text: "In-flight modification of an approved transaction is detectable, with no app code verifying intent." }],
    tech: [{ t: "API", c: "gateway returns 403 intent_token_invalid; no tool dispatch, no data touched" }],
  },
];

// Per-step detail. Tokens are decoded MOCK values. The intent token is minted by the BFF (demo_api_server/services/
// intentTokenService.js): an HS256 JWT signed with a shared secret, sent to the gateway as X-Intent-Token, validated there
// when intentTokenRequired is on. The attack sim flips the last signature character.
const steps = [
  {
    beats: [0],
    detail: {
      form: "BFF mints the intent token when the user's ask is classified:\n  header { alg: HS256, typ: JWT }, signed with the shared intent secret\n  sent on each gateway call as  X-Intent-Token: <intent token>",
      tokens: [{
        note: "Intent token (MOCK, decoded) - minted by the BFF, not by PingOne",
        header: { alg: "HS256", typ: "JWT" },
        claims: { jti: "<uuid>", iss: "bff:intent-token", sub: "<user id>", sid: "<session id>", iat: "<unix time>", exp: "<unix time>", prompt_hash: "<sha-256 of the prompt>", intent: "view_accounts", confidence: 0.95, permitted_tools: ["get_my_accounts"], vertical: "banking" },
      }],
      refs: [RFC(7519, "JSON Web Token"), RFC(7515, "JSON Web Signature (HMAC signature over header.payload)")],
    },
  },
  {
    beats: [1],
    detail: {
      form: "POST /gateway/mcp\nAuthorization: Bearer <delegated access token>\nX-Intent-Token: <header>.<payload>.<signature with its last character flipped>\nContent-Type: application/json\n\n{ \"jsonrpc\": \"2.0\", \"id\": 1, \"method\": \"tools/call\",\n  \"params\": { \"name\": \"get_my_accounts\", \"arguments\": {} } }",
      tokens: [{
        note: "Tampered intent token (MOCK) - same decoded claims, signature no longer matches",
        header: { alg: "HS256", typ: "JWT" },
        claims: { iss: "bff:intent-token", sub: "<user id>", intent: "view_accounts", permitted_tools: ["get_my_accounts"], signature: "INVALID" },
      }],
      refs: [RFC(7515, "JWS: any change to the signed bytes invalidates the signature"), RFC(6750, "Bearer token usage")],
    },
  },
  {
    beats: [2],
    detail: {
      form: "(no network call: the gateway holds the same intent secret)\nrecompute HMAC-SHA-256 over header.payload with the shared secret\n  compare with the presented signature (constant time) -> mismatch\nalso checks exp and that the tool is in permitted_tools\nruns before PingOne Authorize",
      tokens: [],
      refs: [RFC(7515, "JWS HMAC verification (HS256)"), RFC(7519, "JWT validation: exp, claims")],
    },
  },
  {
    beats: [3],
    detail: {
      form: "HTTP/1.1 403 Forbidden  (gateway, intentTokenRequired on)\n{ \"error\": \"intent_token_invalid\", \"message\": \"invalid_signature\", \"login_required\": false }\n\nno tool dispatch, no data touched; the attack sim reports the denial as errorCode intent_token_invalid",
      tokens: [],
      refs: [RFC(9110, "HTTP Semantics: 403 Forbidden")],
    },
  },
];

export default {
  id: "UC15",
  result: { label: "DENY", tone: "err" },
  pingStyle: true,
  GROUPS: G,
  NODES,
  EDGES,
  walk,
  steps,
};
