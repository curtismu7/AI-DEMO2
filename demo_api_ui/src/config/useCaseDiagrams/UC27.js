/**
 * UC27 — HITL consent bypass attempt. The presenter asks for a $600 transfer;
 * no real approval receipt exists, so the call stops at the human-in-the-loop
 * gate. A raw consentGiven flag callers could once set to skip the checks was
 * removed — the BFF requires a verified, server-issued receipt tied to the
 * user, agent and tool. The flag is verified, not trusted.
 */
import { PARTICIPANT_GROUPS as G } from "./palette";

const NODES = [
  { id: "agent", group: "agent", label: "Banking agent", sub: ["$600 transfer"], x: 40, y: 150, detail: "Carries the request — and any claim that consent was already given. The claim changes nothing." },
  { id: "gw", group: "gateway", label: "Agent gateway / BFF", sub: ["receipt required"], x: 340, y: 150, detail: "Requires a real, verifiable receipt from the HITL service; a client-supplied consentGiven flag cannot satisfy it." },
  { id: "p1", group: "pingone", label: "PingOne Authorize", sub: ["HITL boundary"], x: 640, y: 150, detail: "$600 sits above the HITL boundary: without a verified receipt the answer is HITL_REQUIRED, not PERMIT." },
  { id: "user", group: "user", label: "Alice (user)", sub: ["must approve"], x: 940, y: 150, detail: "The only path past the gate is a fresh challenge she actually approves — consent is forged by no one." },
];

const EDGES = [
  ["agent", "gw", "transfer $600", { detail: "A transfer above the HITL boundary — presented as if consent were already given." }],
  ["gw", "p1", "verify consent", { detail: "The BFF checks for a verified receipt bound to user, agent and tool — not a caller-set flag." }],
  ["p1", "gw", "HITL_REQUIRED", { detail: "No real receipt exists: the call stops and a fresh challenge is required." }],
  ["gw", "user", "consent challenge", { detail: "The transfer waits until Alice approves — nothing runs on a claim alone." }],
];

const walk = [
  {
    title: "Agent requests $600", label: "Claiming consent was given",
    nodes: ["agent", "gw"], edges: [0],
    lines: [{ who: "Agent", text: "The transfer goes out above the HITL boundary — however it frames the consent." }],
    tech: [{ t: "API", c: "POST /gateway/mcp tools/call create_transfer amount=600" }],
  },
  {
    title: "BFF demands a receipt", label: "Verified, not trusted",
    nodes: ["gw", "p1"], edges: [1],
    lines: [{ who: "Gateway", text: "The old raw consentGiven flag is gone: only a server-issued receipt tied to user, agent and tool counts." }],
    tech: [{ t: "TOKEN", c: "receipt check: HitlApproved requires verified HITL-service receipt (user+agent+tool bound); consentGiven flag removed" }],
  },
  {
    title: "HITL_REQUIRED", label: "No receipt, no run",
    nodes: ["p1", "gw"], edges: [2],
    lines: [{ who: "PingOne", text: "Nothing was approved, so nothing runs — the gate answers with an obligation, not a pass." }],
    tech: [{ t: "POLICY", c: "amount > HITL boundary, no verified receipt -> HITL_REQUIRED (tool dispatch withheld)" }],
  },
  {
    title: "Fresh challenge", label: "The only way through",
    nodes: ["gw", "user"], edges: [3],
    lines: [{ who: "Alice", text: "Any mismatch falls back to a new consent challenge — the human approves or the transfer never happens." }],
    tech: [{ t: "API", c: "BFF falls back to fresh HITL challenge on receipt mismatch; transfer waits for approval" }],
  },
];

export default {
  id: "UC27",
  result: { label: "HITL REQUIRED", tone: "warn" },
  GROUPS: G,
  NODES,
  EDGES,
  walk,
};
