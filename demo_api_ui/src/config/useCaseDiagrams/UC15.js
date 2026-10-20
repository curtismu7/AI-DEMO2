/**
 * UC15 — Intent-token tampering. An attack sim alters the amount or payee in
 * an otherwise valid intent token; the signature check at the gateway catches
 * the tampering cryptographically, and 401 lands before any tool runs.
 */
import { PARTICIPANT_GROUPS as G } from "./palette";

const NODES = [
  { id: "user", group: "user", label: "Alice (user)", sub: ["approved intent"], x: 40, y: 150, detail: "The approved intent is a signed token — amount, payee, expiry — not a flag." },
  { id: "sim", group: "agent", label: "Attack sim", sub: ["tampered-intent-token"], x: 340, y: 150, detail: "Alters the amount or payee in flight — the signature no longer matches." },
  { id: "gw", group: "gateway", label: "Agent gateway", sub: ["validates signature"], x: 940, y: 150, detail: "Checks signature and expiry on the request path, before anything else." },
  { id: "p1", group: "pingone", label: "PingOne", sub: ["issuer keys"], x: 1240, y: 150, detail: "Signed the intent token; its keys are what the validation checks against." },
];

const EDGES = [
  ["user", "sim", "intent token in play", { dashed: true, detail: "The token was valid when minted — that is what makes the tamper interesting." }],
  ["sim", "gw", "presents tampered token", { detail: "An altered amount or payee breaks the signature — the whole trick, and the whole tell." }],
  ["gw", "p1", "validate signature", { detail: "Validation runs on every call; no application code verifies intent integrity." }],
  ["gw", "sim", "401 — tamper detected", { dashed: true, detail: "The cryptographic check caught the alteration; no tool ever ran." }],
];

const walk = [
  {
    title: "Intent token minted", label: "Signed, not a flag",
    nodes: ["user", "sim"], edges: [0],
    lines: [{ who: "PingOne", text: "Amount, payee, expiry — all bound into the signature." }],
    tech: [{ t: "TOKEN", c: "intent AT minted: amount, payee, exp; signed by PingOne" }],
  },
  {
    title: "Tampered in flight", label: "Signature breaks",
    nodes: ["sim", "gw"], edges: [1],
    lines: [{ who: "Attack sim", text: "An otherwise valid token with a corrupted signature — the alteration is the attack." }],
    tech: [{ t: "API", c: "attack sim tampered-intent-token: amount/payee altered, signature mismatch" }],
  },
  {
    title: "Signature check", label: "On the request path",
    nodes: ["gw", "p1"], edges: [2],
    lines: [{ who: "Gateway", text: "Signature and expiry are validated before any tool is considered." }],
    tech: [{ t: "POLICY", c: "gateway verifies signature+expiry against PingOne keys -> invalid" }],
  },
  {
    title: "401 — nothing ran", label: "Detected cryptographically",
    nodes: ["gw", "sim"], edges: [3],
    lines: [{ who: "Gateway", text: "In-flight modification of an approved transaction is detectable, with no app code verifying intent." }],
    tech: [{ t: "API", c: "gateway returns 401; no tool dispatch, no data touched" }],
  },
];

export default {
  id: "UC15",
  result: { label: "DENY", tone: "err" },
  GROUPS: G,
  NODES,
  EDGES,
  walk,
};
