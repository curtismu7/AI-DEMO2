/**
 * UC-PRIVC — Policies add up — the union (Privilege, measured 2026-10-10).
 * Two policies on the same identity, {A,B} and {B,C}: the effective grant is
 * the union {A,B,C}, delivered deduplicated — 3 tools, not 4. The cap header
 * echoes the per-policy contributions upstream, so the duplicates live in the
 * REQUEST header, never in the client-visible list.
 */
import { PARTICIPANT_GROUPS as G } from "./palette";

const NODES = [
  { id: "client", group: "agent", label: "MCP client", sub: ["sees the union"], x: 40, y: 150, detail: "Its tools/list shows 3 tools — the deduplicated union, with the shared tool appearing once." },
  { id: "gw", group: "gateway", label: "Agent Privilege gateway", sub: ["union + dedup"], x: 340, y: 150, detail: "Policies add; delivery dedupes — the gateway computes the union at discovery and echoes per-policy contributions upstream." },
  { id: "policy1", group: "pingone", label: "Policy #1", sub: ["grants A, B"], x: 640, y: 150, detail: "The first policy on the app: tools A and B." },
  { id: "policy2", group: "pingone", label: "Policy #2", sub: ["grants B, C"], x: 940, y: 150, detail: "A second, new policy on the same identity — deliberately overlapping on B. Creating it adds to the effective grant." },
  { id: "backend", group: "resource", label: "MCP backend", sub: ["source catalog"], x: 1240, y: 150, detail: "Serves the tool catalog both policies cut from." },
];

const EDGES = [
  ["policy1", "gw", "grant {A, B}", { detail: "Policy #1 contributes A and B." }],
  ["policy2", "gw", "grant {B, C}", { detail: "Policy #2 contributes B and C — the same identity, a second policy." }],
  ["gw", "gw", "union = {A, B, C}", { detail: "The effective grant is the union of all non-expired policies applying to the identity — a set, applied at discovery." }],
  ["gw", "backend", "cap header echoes both", { detail: "The X-Procyon-Mcp-Cap REQUEST header carries the per-policy contributions upstream — duplicates live there, not in the client list." }],
  ["gw", "client", "3 tools, deduplicated", { detail: "The client-visible tools/list is the deduplicated union: 3 entries, the shared tool once." }],
];

const walk = [
  {
    title: "Two policies, one identity", label: "{A,B} + {B,C}",
    nodes: ["policy1", "gw"], edges: [0],
    lines: [{ who: "Presenter", text: "Policy #1 grants A and B. A second policy is created for the same user — deliberately sharing tool B." }],
    tech: [{ t: "POLICY", c: "policy1 = {A, B} on opensearch22 (same identity as policy2)" }],
  },
  {
    title: "The second policy adds", label: "{B, C} joins",
    nodes: ["policy2", "gw"], edges: [1],
    lines: [{ who: "Gateway", text: "The console's policy list is additive, not declarative — creating a policy adds to the effective grant." }],
    tech: [{ t: "POLICY", c: "policy2 = {B, C} (one shared tool, deliberately)" }],
  },
  {
    title: "Union computed", label: "3, not 4",
    nodes: ["gw"], edges: [2],
    lines: [{ who: "Gateway", text: "The union is a set: {A, B, C}. Two policies naming the same tool do not double it." }],
    tech: [{ t: "POLICY", c: "effective grant = union of non-expired policies, deduplicated at discovery" }],
  },
  {
    title: "Echo upstream, dedup downstream", label: "Two sides of the gateway",
    nodes: ["gw", "backend"], edges: [3],
    lines: [{ who: "Gateway", text: "The cap header echoes per-policy contributions upstream — the duplicates are real, they just live on the request side." }],
    tech: [{ t: "API", c: "X-Procyon-Mcp-Cap request header: per-policy contributions (duplicates upstream)" }],
  },
  {
    title: "Client sees 3", label: "Deduplicated delivery",
    nodes: ["gw", "client"], edges: [4],
    lines: [{ who: "Presenter", text: "3 tools delivered. The fix for an over-broad grant is deleting the extra policy — no edit can shrink a union." }],
    tech: [{ t: "API", c: "tools/list -> 3 tools (client count 3, no duplicated entries)" }],
  },
];

export default {
  id: "UC-PRIVC",
  result: { label: "UNION", tone: "ok" },
  GROUPS: G,
  NODES,
  EDGES,
  walk,
};
