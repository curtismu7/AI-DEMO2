/**
 * UC-PRIVD — Expiry subtracts silently (Privilege, measured 2026-10-10).
 * Policy #1's time window is set to expired; the client count drops 3 → 2,
 * identical to deletion. Nothing client-side distinguishes expired vs deleted
 * vs never-covered — the time window is a silent kill switch. Check the
 * window before assuming an edit didn't take.
 */
import { PARTICIPANT_GROUPS as G } from "./palette";

const NODES = [
  { id: "client", group: "agent", label: "MCP client", sub: ["3 -> 2, no reason shown"], x: 40, y: 150, detail: "Re-lists and sees 2 tools where there were 3 — the page shows no hint whether the change was an expiry, an edit or a deletion." },
  { id: "gw", group: "gateway", label: "Agent Privilege gateway", sub: ["union recomputed"], x: 340, y: 150, detail: "The union is the non-expired policies only: an expired policy stops contributing entirely, leaving the others untouched." },
  { id: "p1", group: "pingone", label: "Policy #1", sub: ["window expired"], x: 640, y: 150, detail: "Its time window was set to expired in the console — policy #2 untouched. The window is a live kill switch that fires silently." },
  { id: "p2", group: "pingone", label: "Policy #2", sub: ["still live"], x: 940, y: 150, detail: "Still valid: its 2 tools are the entire remaining grant — exactly what a deletion of #1 would have left." },
];

const EDGES = [
  ["client", "gw", "tools/list (again)", { detail: "The same discovery call as before — only time has moved." }],
  ["p1", "gw", "expired — contributes nothing", { detail: "The expired policy stops contributing entirely. Nothing announces it; the union just shrinks." }],
  ["p2", "gw", "still contributes {2 tools}", { detail: "Policy #2's grant survives untouched — expiry subtracts only the expired policy's contribution." }],
  ["gw", "client", "2 tools, no reason", { detail: "Client count 3 → 2, identical to deletion: nothing client-side distinguishes expired vs deleted vs never-covered." }],
];

const walk = [
  {
    title: "Where we were", label: "Union of two: 3 tools",
    nodes: ["client", "gw"], edges: [0],
    lines: [{ who: "Presenter", text: "After step C the client sees the 3-tool union {A, B, C}. Now policy #1's window is set to expired." }],
    tech: [{ t: "POLICY", c: "console: policy #1 time window -> expired (policy #2 untouched)" }],
  },
  {
    title: "Expiry fires", label: "A silent kill switch",
    nodes: ["p1", "gw"], edges: [1],
    lines: [{ who: "Policy #1", text: "The window passes and the policy drops out of the union — no event, no message, no client-visible trace." }],
    tech: [{ t: "POLICY", c: "union = non-expired policies only -> #1 stops contributing" }],
  },
  {
    title: "The union shrinks", label: "#2 survives",
    nodes: ["p2", "gw"], edges: [2],
    lines: [{ who: "Gateway", text: "Policy #2's 2 tools are the entire remaining grant — exactly what deleting #1 would have left." }],
    tech: [{ t: "POLICY", c: "effective grant = {policy #2} = 2 tools" }],
  },
  {
    title: "Client sees 2, no why", label: "3 → 2",
    nodes: ["gw", "client"], edges: [3],
    lines: [{ who: "Presenter", text: "Identical to deletion. Check the window before assuming an edit didn't take — all three causes render as the smaller catalog." }],
    tech: [{ t: "API", c: "tools/list -> 2 tools (client count 3 -> 2; no reason surfaced)" }],
  },
];

export default {
  id: "UC-PRIVD",
  result: { label: "3 → 2", tone: "warn" },
  GROUPS: G,
  NODES,
  EDGES,
  walk,
};
