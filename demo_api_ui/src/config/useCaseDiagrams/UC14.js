/**
 * UC14 — PAR + RAR intent violation (DENY). The attack counterpart to UC14b:
 * same pushed grant, bigger ask. Authorize compares live against pushed and
 * denies even though the scopes would allow it. Intent is a contract.
 */
import { PARTICIPANT_GROUPS as G } from "./palette";

const NODES = [
  { id: "agent", group: "agent", label: "Attack agent", sub: ["asks $2,500"], x: 40, y: 150, detail: "Reuses the PAR grant from UC14b but requests far more than it pushed." },
  { id: "par", group: "pingone", label: "Stored grant", sub: ["cap $500"], x: 340, y: 150, detail: "The bound authorization_details live at PingOne: cap $500, payee bound." },
  { id: "p1", group: "pingone", label: "PingOne Authorize", sub: ["live vs pushed"], x: 640, y: 150, detail: "Compares the actual transfer against the stored grant at call time." },
  { id: "gw", group: "gateway", label: "Agent gateway", sub: ["stops the call"], x: 940, y: 150, detail: "Enforces the DENY — the tool never runs, no money moves." },
];

const EDGES = [
  ["agent", "par", "live ask $2,500", { detail: "The token scopes alone would allow this — that is not what policy checks." }],
  ["par", "p1", "grant says $500", { detail: "The pushed contract is retrieved for the comparison." }],
  ["p1", "gw", "DENY", { detail: "$2,500 > $500: the live ask exceeds the pushed intent." }],
  ["gw", "agent", "no tool ran", { detail: "DENY lands in chat; an authorize-decision DENY lands in the chain." }],
];

const walk = [
  {
    title: "Same grant, bigger ask", label: "Reusing the PAR grant",
    nodes: ["agent", "par"], edges: [0],
    lines: [{ who: "Agent", text: "It pushed $500 and now asks $2,500 — the mismatch is the attack." }],
    tech: [{ t: "API", c: "POST /gateway/mcp tools/call transfer amount=2500 (grant cap=500)" }],
  },
  {
    title: "Grant says $500", label: "The contract at PingOne",
    nodes: ["par", "p1"], edges: [1],
    lines: [{ who: "Authorize", text: "Scopes would allow it; the pushed authorization_details say otherwise." }],
    tech: [{ t: "TOKEN", c: "authorization_details: amount<=500, payee bound (from PAR)" }],
  },
  {
    title: "Live vs pushed", label: "$2,500 > $500",
    nodes: ["p1", "gw"], edges: [2],
    lines: [{ who: "PingOne", text: "Intent is a contract: exceeding it fails even with valid scopes." }],
    tech: [{ t: "POLICY", c: "Authorize: live 2500 > pushed 500 -> DENY (intent-violated)" }],
  },
  {
    title: "Nothing moved", label: "DENY in chat + chain",
    nodes: ["gw", "agent"], edges: [3],
    lines: [{ who: "Gateway", text: "The gateway stops the call; the audience sees DENY everywhere it matters." }],
    tech: [{ t: "POLICY", c: "authorize-decision: DENY recorded on the token chain" }],
  },
];

export default {
  id: "UC14",
  result: { label: "DENY", tone: "err" },
  GROUPS: G,
  NODES,
  EDGES,
  walk,
};
