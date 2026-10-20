/**
 * UC21 — Entitlement-tiered capability. Group membership in PingOne is the
 * tier: the premium-tier user gets the higher-value tool and limit, and a
 * standard-tier agent is never offered those tools at all.
 */
import { PARTICIPANT_GROUPS as G } from "./palette";

const NODES = [
  { id: "user", group: "user", label: "Alice (user)", sub: ["premium-tier group"], x: 40, y: 150, detail: "The demo user is seeded into the vertical's premium-tier group." },
  { id: "agent", group: "agent", label: "Banking agent", sub: ["tier access"], x: 340, y: 150, detail: "Asks for sensitive account details — the tier decides which tools exist for the call." },
  { id: "gw", group: "gateway", label: "Agent gateway", sub: ["per-tier enforcement"], x: 640, y: 150, detail: "Enforces the per-tier decision: tool set and limits come from policy, not code." },
  { id: "p1", group: "pingone", label: "PingOne Authorize", sub: ["tier claim"], x: 1240, y: 150, detail: "Reads group membership as the tier — policy, not the agent's word." },
];

const EDGES = [
  ["user", "agent", "asks tier access", { detail: "Membership in the premium-tier group is what the whole call rides on." }],
  ["gw", "p1", "evaluate tier", { detail: "Group membership drives a per-tier tool set and limits." }],
  ["p1", "gw", "PERMIT — premium tier", { dashed: true, detail: "The tier claim entitles the higher-value tool; standard tier would not be offered it." }],
  ["gw", "agent", "tool dispatched", { detail: "Promoting the user to a higher tier in PingOne changes this with no code change or redeploy." }],
];

const walk = [
  {
    title: "Tier request", label: "Sensitive details",
    nodes: ["user", "agent"], edges: [0],
    lines: [{ who: "Agent", text: "The request itself is ordinary; the tier is what shapes the answer." }],
    tech: [{ t: "API", c: "POST /gateway/mcp tools/call get_sensitive_details (tier access)" }],
  },
  {
    title: "Authorize evaluates tier", label: "Group = tier",
    nodes: ["gw", "p1"], edges: [1],
    lines: [{ who: "PingOne", text: "Group membership in PingOne is the tier; policy reads the claim." }],
    tech: [{ t: "POLICY", c: "Authorize: tier claim from group membership -> premium tier" }],
  },
  {
    title: "Premium tools permitted", label: "Tool set and limit",
    nodes: ["p1", "gw"], edges: [2],
    lines: [{ who: "PingOne", text: "Private Banking tier gets wire tools and a higher limit — a Standard-tier agent is not offered them." }],
    tech: [{ t: "POLICY", c: "PERMIT: premium-tier tool set + higher limit" }],
  },
  {
    title: "Tool dispatched", label: "Policy-driven tiering",
    nodes: ["gw", "agent"], edges: [3],
    lines: [{ who: "Gateway", text: "The chain shows authorize-decision then tool-dispatched — tiering enforced, not suggested." }],
    tech: [{ t: "API", c: "tool dispatched per tier; authorize-decision + tool-dispatched recorded" }],
  },
];

export default {
  id: "UC21",
  result: { label: "PERMIT", tone: "ok" },
  GROUPS: G,
  NODES,
  EDGES,
  walk,
};
