/**
 * UC12 — Token theft / replay defense. DPoP binding plus the gateway jti
 * replay cache: a captured proof works exactly once, and audience binding
 * underneath stops the token being spent at another service.
 */
import { PARTICIPANT_GROUPS as G } from "./palette";

const NODES = [
  { id: "atk", group: "external", label: "Attacker", sub: ["stolen proof"], x: 40, y: 150, detail: "Captured a DPoP-bound token and its proof. The token is valid and unexpired." },
  { id: "gw", group: "gateway", label: "Agent gateway", sub: ["DPoP + jti cache"], x: 340, y: 150, detail: "Verifies the proof (holder of the private key, htm/htu/iat) and records each jti." },
  { id: "p1", group: "pingone", label: "PingOne", sub: ["aud binding"], x: 640, y: 150, detail: "Audience binding underneath: the token only works at this service." },
  { id: "tool", group: "resource", label: "Banking MCP", sub: ["never sees replay"], x: 940, y: 150, detail: "The first use reaches it; the replay dies at the gateway." },
];

const EDGES = [
  ["atk", "gw", "use 1 (accepted)", { detail: "A real proof from the stolen capture verifies on first presentation." }],
  ["gw", "tool", "forwarded", { detail: "First use is legitimate-looking and passes the perimeter." }],
  ["atk", "gw", "replay", { detail: "The identical proof is re-sent — the attack's whole move." }],
  ["gw", "atk", "401 invalid_dpop_proof", { detail: "The jti cache has seen this proof; the second use is refused." }],
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

export default {
  id: "UC12",
  result: { label: "DENY", tone: "err" },
  GROUPS: G,
  NODES,
  EDGES,
  walk,
};
