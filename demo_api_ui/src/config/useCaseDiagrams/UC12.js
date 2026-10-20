/**
 * UC12 — Token theft / replay defense. DPoP binding plus the gateway jti
 * replay cache: a captured proof works exactly once, and audience binding
 * underneath stops the token being spent at another service.
 */
import { PARTICIPANT_GROUPS as G } from "./palette";
import { RFC } from "../pingStyleStandards";

const NODES = [
  { id: "atk", group: "external", label: "Attacker", sub: ["stolen proof"], x: 40, y: 150, detail: "Captured a DPoP-bound token and its proof. The token is valid and unexpired." },
  { id: "gw", group: "gateway", label: "Agent gateway", sub: ["DPoP + jti cache"], x: 640, y: 150, detail: "Verifies the proof (holder of the private key, htm/htu/iat) and records each jti." },
  { id: "p1", group: "pingone", label: "PingOne", sub: ["aud binding"], x: 940, y: 150, detail: "Audience binding underneath: the token only works at this service." },
  { id: "tool", group: "resource", label: "Banking MCP", sub: ["never sees replay"], x: 1240, y: 150, detail: "The first use reaches it; the replay dies at the gateway." },
];

const EDGES = [
  ["atk", "gw", "use 1 (accepted)", { detail: "A real proof from the stolen capture verifies on first presentation." }],
  ["gw", "tool", "forwarded", { detail: "First use is legitimate-looking and passes the perimeter." }],
  ["atk", "gw", "replay", { detail: "The identical proof is re-sent — the attack's whole move." }],
  ["gw", "atk", "401 invalid_dpop_proof", { dashed: true, detail: "The jti cache has seen this proof; the second use is refused." }],
];

const walk = [
  {
    title: "Proof captured", label: "Valid token, stolen proof",
    nodes: ["atk", "gw"], edges: [0],
    lines: [{ who: "Attacker", text: "Replays the captured proof at the same gateway — not a different service." }],
    tech: [{ t: "TOKEN", c: "DPoP-bound AT + proof(jti=abc, htm, htu, iat) presented" }],
  },
  {
    title: "First use accepted", label: "jti recorded",
    nodes: ["gw", "tool"], edges: [1],
    lines: [{ who: "Gateway", text: "Proof verified: holder of the private key, right htm/htu/iat. Forwarded." }],
    tech: [{ t: "POLICY", c: "jti=abc recorded in the gateway replay cache" }],
  },
  {
    title: "Replay arrives", label: "Same proof again",
    nodes: ["atk", "gw"], edges: [2],
    lines: [{ who: "Gateway", text: "Audience binding already stops another service; the same service is the cache's job." }],
    tech: [{ t: "POLICY", c: "jti replay cache lookup: jti=abc already seen" }],
  },
  {
    title: "Refused", label: "No tool ran on the replay",
    nodes: ["gw", "atk"], edges: [3],
    lines: [{ who: "Gateway", text: "401 invalid_dpop_proof. The rail shows DENY; the chain shows the refused hop." }],
    tech: [{ t: "TOKEN", c: "gateway -> 401 invalid_dpop_proof (replay refused)" }],
  },
];

// Per-step detail. Tokens are decoded MOCK values. Proof checks and reasons follow demo_mcp_gateway/src/dpopVerify.ts
// (typ dpop+jwt, alg ES256, htm/htu/iat window, jti replay cache, ath, jkt binding).
const ISS = "https://auth.pingone.com/<env id>/as";
const PROOF_HEADER = { typ: "dpop+jwt", alg: "ES256", jwk: { kty: "EC", crv: "P-256", x: "<public x>", y: "<public y>" } };
const steps = [
  {
    beats: [0],
    detail: {
      form: "POST /gateway/mcp\nAuthorization: Bearer <DPoP-bound access token>\nDPoP: <DPoP proof JWT>\nContent-Type: application/json\n\n{ \"jsonrpc\": \"2.0\", \"id\": 1, \"method\": \"tools/call\",\n  \"params\": { \"name\": \"get_my_accounts\", \"arguments\": {} } }",
      tokens: [
        {
          note: "DPoP-bound access token (MOCK) - cnf.jkt pins it to the holder's key",
          header: { alg: "RS256", typ: "at+jwt" },
          claims: { iss: ISS, sub: "<user id>", aud: "<gateway resource URI>", scope: "accounts:read", cnf: { jkt: "<key thumbprint>" }, exp: "<unix time>" },
        },
        {
          note: "DPoP proof (MOCK) - captured by the attacker together with the token",
          header: PROOF_HEADER,
          claims: { htm: "POST", htu: "https://<gateway host>/gateway/mcp", iat: "<unix time>", jti: "abc", ath: "<hash of the access token>" },
        },
      ],
      refs: [RFC(9449, "DPoP: sender-constrained access tokens and proofs"), RFC(6750, "Bearer token usage: the token travels in Authorization")],
    },
  },
  {
    beats: [1],
    detail: {
      form: "gateway verifies the proof, in order:\n  typ dpop+jwt, alg ES256, embedded P-256 jwk\n  signature over header.payload with that jwk\n  htm == POST, htu path == this gateway path\n  iat within the allowed window\n  jti unseen -> recorded in the replay cache\n  ath == hash of the presented token, jkt == cnf.jkt\nthen forwards to the Banking MCP server",
      tokens: [{
        note: "Proof claims (MOCK) as the gateway records them",
        claims: { jti: "abc", seen: true, expires_in_window: "<seconds>" },
      }],
      refs: [RFC(9449, "Section 11.1: proof replay and the jti check"), RFC(7519, "JSON Web Token: jti identifier claim")],
    },
  },
  {
    beats: [2],
    detail: {
      form: "POST /gateway/mcp\nAuthorization: Bearer <same DPoP-bound access token>\nDPoP: <same DPoP proof JWT, jti abc>\n\n(the attacker re-sends the capture byte for byte)",
      tokens: [{
        note: "Same proof (MOCK) - nothing about it changed, which is the tell",
        header: PROOF_HEADER,
        claims: { htm: "POST", htu: "https://<gateway host>/gateway/mcp", iat: "<unix time>", jti: "abc" },
      }],
      refs: [RFC(9449, "Servers MAY track jti to reject replays (section 11.1)")],
    },
  },
  {
    beats: [3],
    detail: {
      form: "HTTP/1.1 401 Unauthorized\nWWW-Authenticate: DPoP realm=\"PingOne\", resource_metadata=\"https://<gateway host>/.well-known/oauth-protected-resource\",\n  error=\"invalid_dpop_proof\", error_description=\"jti replay\"\n\n{ \"error\": \"invalid_dpop_proof\", \"message\": \"jti replay\" }\nthe Banking MCP server is never called on the replay",
      tokens: [],
      refs: [RFC(9449, "The invalid_dpop_proof error and the DPoP challenge"), RFC(9728, "resource_metadata in the challenge points at Protected Resource Metadata")],
    },
  },
];

export default {
  id: "UC12",
  result: { label: "DENY", tone: "err" },
  pingStyle: true,
  GROUPS: G,
  NODES,
  EDGES,
  walk,
  steps,
};
