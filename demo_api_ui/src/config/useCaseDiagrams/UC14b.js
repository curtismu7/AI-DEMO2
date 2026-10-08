/**
 * UC14b — PAR + RAR intent verified (PERMIT). The learning scenario and happy
 * path: RFC 9126 PAR pushes the intent, RFC 9396 authorization_details caps
 * the amount, and the live request is checked against the pushed grant.
 */
import { PARTICIPANT_GROUPS as G } from "./palette";

const NODES = [
  { id: "agent", group: "agent", label: "Banking agent", sub: ["transfer $400"], x: 40, y: 150, detail: "Asks for a within-cap transfer — the intent it pushed is the intent it runs." },
  { id: "bff", group: "agent", label: "BFF", sub: ["pushes the intent"], x: 340, y: 150, detail: "Sends amount and payee to the PAR endpoint instead of a plain authorize URL." },
  { id: "par", group: "pingone", label: "PAR endpoint", sub: ["RFC 9126"], x: 640, y: 150, detail: "Stores the authorization_details grant and returns a single-use request_uri." },
  { id: "tok", group: "pingone", label: "Delegated token", sub: ["carries RAR grant"], x: 940, y: 150, detail: "The redeemed token embeds the bound details: cap $500, payee bound." },
  { id: "gw", group: "gateway", label: "Agent gateway", sub: ["cap check"], x: 1240, y: 150, detail: "At call time compares the live transfer against the pushed cap." },
];

const EDGES = [
  ["agent", "bff", "intent: $400 to savings", { detail: "The ask that becomes the pushed contract." }],
  ["bff", "par", "PAR push", { detail: "The intent now lives at PingOne, not in the agent." }],
  ["par", "tok", "request_uri -> token", { detail: "The token carries the RAR grant it was redeemed against." }],
  ["tok", "gw", "live cap check", { detail: "The gateway hands the actual transfer to the policy with the grant in hand." }],
  ["gw", "agent", "PERMIT", { detail: "Within cap -> the chain records Intent Verified." }],
];

const walk = [
  {
    title: "Intent is pushed", label: "PAR instead of a URL",
    nodes: ["agent", "bff"], edges: [0],
    lines: [{ who: "Agent", text: "The ask is $400 to savings — small enough to demonstrate, real enough to bind." }],
    tech: [{ t: "API", c: "POST /par  authorization_details={type:banking_transaction, amount<=500}" }],
  },
  {
    title: "Grant stored", label: "request_uri back",
    nodes: ["bff", "par"], edges: [1],
    lines: [{ who: "PAR", text: "A single-use request_uri references the stored intent." }],
    tech: [{ t: "TOKEN", c: "PAR grant stored: cap $500, payee bound (RFC 9396 details)" }],
  },
  {
    title: "Token carries the details", label: "The grant rides along",
    nodes: ["par", "tok"], edges: [2],
    lines: [{ who: "Token", text: "Redeemed token embeds authorization_details — the cap travels with the call." }],
    tech: [{ t: "TOKEN", c: "agent AT: authorization_details={amount<=500, payee=savings}" }],
  },
  {
    title: "Live vs pushed", label: "Checked at call time",
    nodes: ["tok", "gw"], edges: [3],
    lines: [{ who: "Gateway", text: "The actual transfer is compared against the pushed cap, not the scopes." }],
    tech: [{ t: "POLICY", c: "Authorize: live amount 400 <= pushed cap 500 -> within intent" }],
  },
  {
    title: "PERMIT", label: "Intent Verified",
    nodes: ["gw", "agent"], edges: [4],
    lines: [{ who: "Gateway", text: "The chain records Intent Verified — the happy-path counterpart to UC14." }],
    tech: [{ t: "POLICY", c: "authorize-decision: PERMIT (intent-binding-verified)" }],
  },
];

export default {
  id: "UC14b",
  result: { label: "PERMIT", tone: "ok" },
  GROUPS: G,
  NODES,
  EDGES,
  walk,
};
