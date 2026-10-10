/**
 * UC29 — Token-validation outage, fail closed (503). The gateway verifies every
 * inbound token's signature against the issuer's JWKS (its validation backend;
 * introspection cannot cover a multi-issuer gateway). When that backend is
 * unreachable the gateway REJECTS the call instead of letting it through —
 * an outage becomes a blocked request, not an open door.
 */
import { PARTICIPANT_GROUPS as G } from "./palette";

const NODES = [
  { id: "agent", group: "external", label: "Agent", sub: ["one tool call"], x: 40, y: 150, detail: "Calls the gateway with a perfectly valid token — the failure is elsewhere." },
  { id: "gw", group: "gateway", label: "Token validation", sub: ["JWKS signature check"], x: 340, y: 150, detail: "Every inbound token's signature is verified against the issuer's JWKS before any policy runs. This is the gateway's validation backend." },
  { id: "as", group: "external", label: "Issuer JWKS", sub: ["unreachable (sim)"], x: 640, y: 150, detail: "The key source every signature is checked against. The sim arms its outage (jwksSimDown via /admin/config) — same fail-closed shape as a real outage." },
];

const EDGES = [
  ["agent", "gw", "tools/call (valid token)", { detail: "Nothing is wrong with the credential — the token, scopes and aud are all fine." }],
  ["gw", "as", "fetch verification keys", { detail: "Validation starts by reaching the issuer's key set." }],
  ["as", "gw", "unreachable", { detail: "The key source does not answer (simulated outage). This is the moment the control is tested." }],
  ["gw", "agent", "503 — fail closed", { detail: "The gateway refuses the call rather than validating nothing. 503, not 401: an outage is not a rejected credential." }],
];

const walk = [
  {
    title: "Call arrives", label: "Valid token, healthy scopes",
    nodes: ["agent", "gw"], edges: [0],
    lines: [{ who: "Agent", text: "An ordinary tool call — the credential is fine. The outage is behind the gateway." }],
    tech: [{ t: "API", c: "POST /mcp tools/call with Bearer token" }],
  },
  {
    title: "Validation starts", label: "Signature check first",
    nodes: ["gw"], edges: [1],
    lines: [{ who: "Gateway", text: "Before any policy runs, the token's signature must verify against the issuer's keys." }],
    tech: [{ t: "POLICY", c: "validateInboundToken → JWKS signature verification (validation backend)" }],
  },
  {
    title: "Backend unreachable", label: "Keys unavailable",
    nodes: ["gw", "as"], edges: [2],
    lines: [{ who: "Issuer", text: "The key source is down (simulated with jwksSimDown). Validation cannot complete." }],
    tech: [{ t: "API", c: "JWKS fetch fails — TokenValidationError('jwks_fetch_failed')" }],
  },
  {
    title: "Fail closed", label: "503, not 401",
    nodes: ["gw", "agent"], edges: [3],
    lines: [{ who: "Gateway", text: "An outage must become a blocked request, not an open door. Many systems degrade to allow; this one refuses." }],
    tech: [{ t: "API", c: "gateway → 503 jwks_fetch_failed (no policy evaluation, no forward)" }],
  },
  {
    title: "Why it matters", label: "At the edge",
    nodes: ["gw"], edges: [],
    lines: [{ who: "Presenter", text: "If the control degraded to allow, an attacker who could take validation offline would own the perimeter. Fail-closed makes that attack a denial of service — not a bypass." }],
    tech: [{ t: "POLICY", c: "protection point: gateway token-validation backend (fail closed)" }],
  },
];

export default {
  id: "UC29",
  result: { label: "FAIL CLOSED", tone: "err" },
  GROUPS: G,
  NODES,
  EDGES,
  walk,
};
