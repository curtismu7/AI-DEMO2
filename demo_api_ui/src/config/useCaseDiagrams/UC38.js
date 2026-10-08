/**
 * UC38 — Workload Agent: MFA-gated protected action. The BFF demands an
 * MFA-satisfied token, verifies the pre-registered workload agent, then runs
 * the action through the gateway and Authorize with a delegated token
 * (sub=user, act=agent on every call).
 */
import { PARTICIPANT_GROUPS as G } from "./palette";

const NODES = [
  { id: "user", group: "user", label: "Alice (user)", sub: ["picks the action"], x: 40, y: 150, detail: "Chooses a protected action in the digital assistant — transfer $600 from checking to savings." },
  { id: "agent", group: "agent", label: "Workload agent", sub: ["pre-registered"], x: 340, y: 150, detail: "Verified as pre-registered — delegation is not implied by session context." },
  { id: "bff", group: "gateway", label: "BFF", sub: ["MFA token demanded"], x: 640, y: 150, detail: "Identity step-up comes before delegation: no MFA proof, no agent action." },
  { id: "p1", group: "pingone", label: "PingOne", sub: ["exchange + policy"], x: 940, y: 150, detail: "Mints the delegated token (sub=alice, act=agent) and evaluates the action." },
];

const EDGES = [
  ["user", "agent", "request protected action", { detail: "The assistant offers the transfer; the customer confirms." }],
  ["agent", "bff", "act for Alice", { detail: "The workload agent presents itself for verification." }],
  ["bff", "p1", "MFA-satisfied token", { detail: "The BFF demands proof of step-up before anything delegations." }],
  ["p1", "bff", "delegated token", { detail: "RFC 8693: sub=alice, act=workload agent — stamped on every tool call." }],
  ["bff", "user", "action done", { detail: "Gateway + Authorize PERMIT; the result lands in the assistant." }],
];

const walk = [
  {
    title: "Protected action picked", label: "$600 transfer",
    nodes: ["user", "agent"], edges: [0],
    lines: [{ who: "Alice", text: "The digital assistant offers the transfer; she confirms it." }],
    tech: [{ t: "API", c: "workload agent requests transfer $600 (checking -> savings)" }],
  },
  {
    title: "Agent verified", label: "Pre-registered",
    nodes: ["agent", "bff"], edges: [1],
    lines: [{ who: "BFF", text: "Delegation requires a registered agent, not just an authenticated session." }],
    tech: [{ t: "POLICY", c: "workload agent lookup: registered (personal-agent-lookup)" }],
  },
  {
    title: "MFA demanded", label: "Step-up before delegation",
    nodes: ["bff", "p1"], edges: [2],
    lines: [{ who: "BFF", text: "No MFA-satisfied token, no agent action — identity proof is the gate." }],
    tech: [{ t: "POLICY", c: "BFF requires MFA-satisfied AT (acr step-up)" }],
  },
  {
    title: "Delegated token minted", label: "RFC 8693",
    nodes: ["p1", "bff"], edges: [3],
    lines: [{ who: "PingOne", text: "sub=alice, act=agent — visible in every subsequent tool call." }],
    tech: [{ t: "TOKEN", c: "RFC 8693 -> AT: sub=alice, act={sub:workload-agent}" }],
  },
  {
    title: "PERMIT", label: "Action runs",
    nodes: ["bff", "user"], edges: [4],
    lines: [{ who: "Presenter", text: "Customers get the assistant; the bank gets identity proof on the record." }],
    tech: [{ t: "POLICY", c: "authorize-decision: PERMIT -> tool-dispatched" }],
  },
];

export default {
  id: "UC38",
  result: { label: "PERMIT", tone: "ok" },
  GROUPS: G,
  NODES,
  EDGES,
  walk,
};
