/**
 * UC33 — My mortgage. "show my mortgage" runs the same RFC 8693 delegated
 * chain as UC1 — user token, act claim, gateway validation, Authorize decision
 * — against a different tool. One token exchange with act={agent} authorizes
 * the whole tool surface, so attribution coverage does not shrink as new tools
 * appear: every tool already carries the same proof.
 */
import { PARTICIPANT_GROUPS as G } from "./palette";

const NODES = [
  { id: "user", group: "user", label: "Alice (user)", sub: ["show my mortgage"], x: 40, y: 150, detail: "A less-common product ask — and the delegation machinery does not care which tool it is." },
  { id: "agent", group: "agent", label: "Banking agent", sub: ["second product"], x: 340, y: 150, detail: "Calls show_mortgage with the same delegated token it used for a balance — nothing new is minted." },
  { id: "gw", group: "gateway", label: "Agent gateway", sub: ["same validation"], x: 640, y: 150, detail: "Validates the client and checks policy exactly as for every other tool — no special case per product." },
  { id: "p1", group: "pingone", label: "PingOne", sub: ["act={agent}", "Authorize"], x: 940, y: 150, detail: "One token exchange with act={agent} covers the whole tool surface — mortgage included — and Authorize permits it." },
  { id: "res", group: "resource", label: "Mortgage API", sub: ["show_mortgage"], x: 1240, y: 150, detail: "Serves the mortgage lookup to the same downscoped caller — the proof arrived with the token, not with the tool." },
];

const EDGES = [
  ["user", "agent", "asks for mortgage", { detail: "The chip proves attribution holds beyond the flagship balance chip." }],
  ["agent", "gw", "show_mortgage", { detail: "Same delegated token as UC1 — the tool changed, the credential did not." }],
  ["gw", "p1", "validate + Authorize", { detail: "The full delegated chain replays: gateway validation, then the policy question." }],
  ["p1", "res", "PERMIT · act={agent}", { detail: "The act claim proves the agent all the way to a mortgage lookup, not just a balance." }],
];

const walk = [
  {
    title: "Alice asks for her mortgage", label: "Not the usual chip",
    nodes: ["user", "agent"], edges: [0],
    lines: [{ who: "Alice", text: "A different product on purpose: if attribution were special-cased per tool, this is where it would break." }],
    tech: [{ t: "API", c: "chat chip: \"show my mortgage\" -> agent routes to show_mortgage" }],
  },
  {
    title: "Same delegated token", label: "Nothing re-minted",
    nodes: ["agent", "gw"], edges: [1],
    lines: [{ who: "Agent", text: "The RFC 8693 exchange already happened — the token carries act={agent} whatever the tool." }],
    tech: [{ t: "TOKEN", c: "agent AT: act={sub:agent, sub:alice} (same exchange as UC1)" }],
  },
  {
    title: "Gateway + Authorize", label: "Same legs, different tool",
    nodes: ["gw", "p1"], edges: [2],
    lines: [{ who: "Gateway", text: "User token, act claim, gateway validation, Authorize decision — the UC1 chain against a new target." }],
    tech: [{ t: "POLICY", c: "authorize-decision over act={agent} for show_mortgage -> PERMIT" }],
  },
  {
    title: "Mortgage lookup dispatches", label: "Coverage holds",
    nodes: ["p1", "res"], edges: [3],
    lines: [{ who: "Mortgage API", text: "PERMIT: every new tool the surface grows already carries the same proof." }],
    tech: [{ t: "API", c: "POST /gateway/mcp tools/call show_mortgage -> 200 (delegated, attributed)" }],
  },
];

export default {
  id: "UC33",
  result: { label: "PERMIT", tone: "ok" },
  GROUPS: G,
  NODES,
  EDGES,
  walk,
};
