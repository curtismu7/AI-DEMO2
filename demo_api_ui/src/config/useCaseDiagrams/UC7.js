/**
 * UC7 — MFA step-up (HITL). Pilot diagram: the step-up shape. Read-only is
 * fine; a $600 transfer clears the step-up threshold and PingOne runs MFA
 * before the policy re-evaluates to PERMIT.
 */
import { PARTICIPANT_GROUPS as G } from "./palette";

const NODES = [
  { id: "user", group: "user", label: "Alice (user)", sub: ["Completes MFA"], x: 40, y: 150, detail: "Answers the MFA challenge — push or OTP — on her enrolled device." },
  { id: "agent", group: "agent", label: "Banking agent", sub: ["Requests transfer"], x: 340, y: 150, detail: "Requests the $600 transfer. Read-only was fine; moving money is not." },
  { id: "gw", group: "gateway", label: "Agent gateway", sub: ["ACR check"], x: 640, y: 150, detail: "Checks the session's assurance level; not high enough for payments." },
  { id: "p1", group: "pingone", label: "PingOne", sub: ["MFA", "re-evaluate"], x: 940, y: 150, detail: "Challenges with MFA, upgrades the session, re-evaluates policy." },
];

const EDGES = [
  ["user", "agent", "move $600", { detail: "A sensitive action — step-up is required by policy." }],
  ["agent", "gw", "tool call", { detail: "Session ACR too low for payments; the gateway holds the call." }],
  ["gw", "p1", "step-up challenge", { detail: "PingOne challenges: push notification or OTP." }],
  ["p1", "user", "MFA prompt", { detail: "Alice approves on her enrolled device — out of the agent's hands.", vertical: true }],
  ["p1", "gw", "acr upgraded", { detail: "Session assurance level rises; the retry carries the new ACR claim." }],
  ["gw", "agent", "PERMIT", { detail: "Re-evaluation passes with the upgraded session — transfer executes." }],
];

const walk = [
  {
    title: "Agent asks to move $600", label: "Above the step-up threshold",
    nodes: ["user", "agent"], edges: [0],
    lines: [{ who: "Agent", text: "$600 clears the step-up threshold but not the hard deny ceiling." }],
    tech: [{ t: "API", c: "POST /gateway/mcp tools/call transfer_funds amount=600" }],
  },
  {
    title: "Session not strong enough", label: "ACR below policy floor",
    nodes: ["agent", "gw"], edges: [1],
    lines: [{ who: "Gateway", text: "Read-only session — payments need a higher assurance level." }],
    tech: [{ t: "POLICY", c: "ACR check: session acr=1 < required acr=2 -> step-up obligation" }],
  },
  {
    title: "PingOne challenges", label: "MFA out of band",
    nodes: ["gw", "p1"], edges: [2],
    lines: [{ who: "PingOne", text: "The challenge goes straight to Alice's device — the agent just waits." }],
    tech: [{ t: "API", c: "PingOne MFA: POST /mfa/challenges -> push/OTP" }],
  },
  {
    title: "Alice approves", label: "Human in the loop",
    nodes: ["p1", "user"], edges: [3],
    lines: [{ who: "Alice", text: "The approval is hers alone; the agent cannot answer for her." }],
    tech: [{ t: "POLICY", c: "MFA success receipt bound to this request" }],
  },
  {
    title: "Session upgraded", label: "Retry carries new ACR",
    nodes: ["p1", "gw"], edges: [4],
    lines: [{ who: "Gateway", text: "The same call now arrives with a session policy accepts." }],
    tech: [{ t: "TOKEN", c: "session acr=2 stamped; re-evaluation inputs refreshed" }],
  },
  {
    title: "PERMIT", label: "Transfer executes",
    nodes: ["gw", "agent"], edges: [5],
    lines: [{ who: "Agent", text: "The transfer runs — with MFA on the record." }],
    tech: [{ t: "POLICY", c: "Authorize re-evaluates: PERMIT (step-up satisfied)" }],
  },
];

export default {
  id: "UC7",
  result: { label: "STEP-UP", tone: "warn" },
  GROUPS: G,
  NODES,
  EDGES,
  walk,
};
