/**
 * UC11 — Bad client → agent gateway (DENY 401). Wrong audience, malformed,
 * expired or badly signed: the gateway validates the envelope before routing
 * and before Authorize is consulted. No tool is ever touched.
 */
import { PARTICIPANT_GROUPS as G } from "./palette";

const NODES = [
  { id: "atk", group: "external", label: "Attack agent", sub: ["aud: elsewhere"], x: 40, y: 150, detail: "Presents a well-formed token whose audience names another service — or it is expired, malformed or badly signed." },
  { id: "gw", group: "gateway", label: "Agent gateway", sub: ["perimeter validation"], x: 340, y: 150, detail: "Checks aud, exp, iss and nbf before any routing happens." },
  { id: "p1", group: "pingone", label: "PingOne Authorize", sub: ["not consulted"], x: 640, y: 150, detail: "No decision appears — the call died before the policy engine." },
];

const EDGES = [
  ["atk", "gw", "present token", { detail: "The envelope is what fails, not the policy." }],
  ["gw", "gw", "aud mismatch", { detail: "The audience does not name this gateway." }],
  ["gw", "atk", "401", { detail: "Refused on the spot; no tool touched, no Authorize call spent." }],
  ["gw", "gw", "one shield for all", { detail: "The same perimeter validation covers every tool and service." }],
];

const walk = [
  {
    title: "Wrong-audience token", label: "Aimed at another service",
    nodes: ["atk", "gw"], edges: [0],
    lines: [{ who: "Attacker", text: "The token is well-formed — that is what makes the audience check interesting." }],
    tech: [{ t: "TOKEN", c: "AT: aud=other-service (gateway expects mcpgateway.ping.demo)" }],
  },
  {
    title: "Envelope validated", label: "Before routing",
    nodes: ["gw"], edges: [1],
    lines: [{ who: "Gateway", text: "aud, exp, iss, nbf — all before anything downstream happens." }],
    tech: [{ t: "POLICY", c: "perimeter validation: aud mismatch -> fail" }],
  },
  {
    title: "401 at the perimeter", label: "No tool, no decision",
    nodes: ["gw", "atk"], edges: [2],
    lines: [{ who: "Gateway", text: "One enforcement point shields every downstream service from bad credentials." }],
    tech: [{ t: "API", c: "gateway -> 401; no tool dispatch, no Authorize row in the chain" }],
  },
  {
    title: "One perimeter", label: "All tools covered",
    nodes: ["gw"], edges: [3],
    lines: [{ who: "Presenter", text: "The bad token never reaches the tools — the shield is the gateway, not the apps." }],
    tech: [{ t: "POLICY", c: "enforcement point: gateway perimeter (all tools)" }],
  },
];

export default {
  id: "UC11",
  result: { label: "DENY", tone: "err" },
  GROUPS: G,
  NODES,
  EDGES,
  walk,
};
