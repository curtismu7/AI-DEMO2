/**
 * UC48 — Consumer Agent — governed flight booking. SFO to Paris, $346 under
 * the user's $800 cap: the price hits the transaction policy, a HITL consent
 * obligation pauses the run, and only the human's verified approval receipt
 * lets the booking write through — then 'show my reservations' lists the trip
 * it booked. The agent cannot bypass the pause; the receipt is bound to this
 * user, agent and tool.
 */
import { PARTICIPANT_GROUPS as G } from "./palette";

const NODES = [
  { id: "user", group: "user", label: "Alice (traveler)", sub: ["$800 cap"], x: 40, y: 150, detail: "Asks for a flight under $800. The $346 fare is hers to approve — the pause exists so the human decides, not the agent." },
  { id: "agent", group: "agent", label: "Consumer agent", sub: ["book_airline_flight", "$346 fare"], x: 340, y: 150, detail: "Searches, picks a $346 fare under the cap, and proposes the booking — but cannot complete a consequential write on its own." },
  { id: "gw", group: "gateway", label: "Agent gateway / BFF", sub: ["holds the write"], x: 640, y: 150, detail: "Holds the booking while the obligation is unsatisfied — nothing reaches the reservations database until a verified receipt arrives." },
  { id: "p1", group: "pingone", label: "PingOne Authorize", sub: ["transaction policy", "HITL obligation"], x: 940, y: 150, detail: "Evaluates the booking price against the transaction policy; $346 lands in the HITL consent band and the answer is an obligation." },
  { id: "db", group: "resource", label: "Reservations DB", sub: ["the real write"], x: 1240, y: 150, detail: "The booking write lands here only after the receipt discharges the gate — 'show my reservations' then lists the trip it booked." },
];

const EDGES = [
  ["user", "agent", "book under $800", { detail: "'Book a flight from San Francisco to Paris for me under $800' — the cap is hers; the search is the agent's." }],
  ["agent", "gw", "book_airline_flight $346", { detail: "The delegated token rides along (RFC 8693); the write is a normal governed call — until policy answers." }],
  ["gw", "p1", "evaluate the price", { detail: "The booking price is policy-evaluated on the tool call, not trusted to the agent's phrasing." }],
  ["p1", "gw", "obligation: HITL", { detail: "$346 sits in the HITL consent band (>= $250, < $500): the run pauses — not PERMIT, not DENY." }],
  ["gw", "user", "consent modal", { detail: "The pause surfaces as a consent modal; the agent found the flight, the human decides the booking." }],
  ["gw", "db", "receipt verified -> write", { detail: "Only the human's approval receipt — verified, bound to this user, agent and tool — lets the booking write through." }],
];

const walk = [
  {
    title: "Book me a flight", label: "Under $800",
    nodes: ["user", "agent"], edges: [0],
    lines: [{ who: "Alice", text: "The agent searched and proposed SFO to Paris at $346 — inside her cap, but the cap is not the policy." }],
    tech: [{ t: "API", c: "chip: 'book a flight from San Francisco to Paris for me under $800' (airlines vertical)" }],
  },
  {
    title: "Delegated booking call", label: "Exchange first",
    nodes: ["agent", "gw"], edges: [1],
    lines: [{ who: "Agent", text: "The agent's authority comes from the exchange — then the booking goes out as a governed tool call." }],
    tech: [
      { t: "TOKEN", c: "chain: user-token -> token-exchange (RFC 8693, act=agent)" },
      { t: "API", c: "tools/call book_airline_flight fare=346" },
    ],
  },
  {
    title: "Price hits transaction policy", label: "Authorize decides",
    nodes: ["gw", "p1"], edges: [2, 3],
    lines: [{ who: "PingOne", text: "$346 is in the HITL consent band: the answer is an obligation, and the agent cannot bypass the pause." }],
    tech: [
      { t: "POLICY", c: "authorize-decision: fare $346 in consent band (>=250, <500) -> obligation HITL" },
      { t: "TOKEN", c: "hitl-receipt: required before dispatch (bound user+agent+tool)" },
    ],
  },
  {
    title: "The human approves", label: "Consent modal",
    nodes: ["gw", "user"], edges: [4],
    lines: [{ who: "Alice", text: "She approves the $346 booking — the pause is the product: real transactions without losing human control." }],
    tech: [{ t: "API", c: "BFF renders consent modal; verified approval receipt recorded" }],
  },
  {
    title: "The booking is real", label: "Write lands",
    nodes: ["gw", "db"], edges: [5],
    lines: [{ who: "Presenter", text: "The receipt discharges the gate, the write lands, and 'show my reservations' lists the trip — auditable end to end." }],
    tech: [
      { t: "POLICY", c: "receipt verified (user+agent+tool bound) -> re-evaluate -> PERMIT -> dispatch" },
      { t: "API", c: "reservations DB write lands; 'show my reservations' lists it" },
    ],
  },
];

export default {
  id: "UC48",
  result: { label: "HITL REQUIRED", tone: "warn" },
  GROUPS: G,
  NODES,
  EDGES,
  walk,
};
