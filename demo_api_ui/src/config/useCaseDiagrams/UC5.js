/**
 * UC5 — Wrong / insufficient scope (DENY 403). Scope is a hard ceiling at the
 * gateway, checked before Authorize is even consulted. The agent cannot grant
 * itself more.
 */
import { PARTICIPANT_GROUPS as G } from "./palette";

const NODES = [
  { id: "atk", group: "external", label: "Attack agent", sub: ["missing scope"], x: 40, y: 150, detail: "Presents a valid token — right issuer, right audience — but it lacks the scope this tool demands." },
  { id: "gw", group: "gateway", label: "Agent gateway", sub: ["scope ceiling"], x: 340, y: 150, detail: "Checks the declared tool scope against the token's set before anything else." },
  { id: "p1", group: "pingone", label: "PingOne Authorize", sub: ["not consulted"], x: 640, y: 150, detail: "Never sees the call — scope fails before the policy question is asked." },
  ];

const EDGES = [
  ["atk", "gw", "call with narrow token", { detail: "The token is fine by every check except the scope set." }],
  ["gw", "gw", "scope check fails", { detail: "Required scope absent from the token — the agent cannot widen it." }],
  ["gw", "atk", "403", { detail: "Refused at the perimeter; no tool ran, no policy call was spent." }],
  ["gw", "gw", "centralized ceiling", { detail: "One enforcement point covers every tool." }],
];

const walk = [
  {
    title: "Attack presents token", label: "Valid but narrow",
    nodes: ["atk", "gw"], edges: [0],
    lines: [{ who: "Attacker", text: "Every envelope check passes — the scope set is the missing piece." }],
    tech: [{ t: "TOKEN", c: "AT: iss ok, aud ok, exp ok, scp=lacks tool scope" }],
  },
  {
    title: "Gateway checks scope", label: "Before policy",
    nodes: ["gw"], edges: [1],
    lines: [{ who: "Gateway", text: "The tool declares its required scope; the token carries a narrower set." }],
    tech: [{ t: "POLICY", c: "declared tool scope not in token scp -> hard fail" }],
  },
  {
    title: "403 at the perimeter", label: "Nothing downstream ran",
    nodes: ["gw", "atk"], edges: [2],
    lines: [{ who: "Gateway", text: "No tool dispatch, no Authorize decision — the ceiling held." }],
    tech: [{ t: "API", c: "gateway -> 403 insufficient_scope; Authorize not consulted" }],
  },
  {
    title: "Centralized by design", label: "No per-tool code",
    nodes: ["gw"], edges: [3],
    lines: [{ who: "Presenter", text: "No tool re-validates scopes in application code — one point covers all." }],
    tech: [{ t: "POLICY", c: "enforcement point: gateway perimeter (all tools)" }],
  },
];

export default {
  id: "UC5",
  result: { label: "DENY", tone: "err" },
  GROUPS: G,
  NODES,
  EDGES,
  walk,
};
