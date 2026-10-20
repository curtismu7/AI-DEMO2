/**
 * UC17 — JIT / ephemeral credentials. Same balance read as UC1, but the story
 * is the token's lifetime: the delegated token carries a tight TTL and the
 * gateway introspects on every call, so a token captured after expiry is dead
 * even though its signature would still verify.
 */
import { PARTICIPANT_GROUPS as G } from "./palette";

const NODES = [
  { id: "user", group: "user", label: "Alice (user)", sub: ["signed in once"], x: 40, y: 150, detail: "Her consent started the chain; everything after is short-lived delegated authority." },
  { id: "agent", group: "agent", label: "Banking agent", sub: ["holds a TTL'd token"], x: 340, y: 150, detail: "Holds a delegated token that expires in minutes — the refresh loop keeps it current, never long-lived." },
  { id: "gw", group: "gateway", label: "Agent gateway", sub: ["introspects every call"], x: 640, y: 150, detail: "Introspects the token on every request: a token past its TTL is rejected 401 even though the signature still verifies." },
  { id: "p1", group: "pingone", label: "PingOne", sub: ["TTL on the exchange"], x: 940, y: 150, detail: "Issues the delegated token with a configurable short TTL at the RFC 8693 exchange — the only control needed." },
  { id: "acct", group: "resource", label: "Accounts API", sub: ["balance read"], x: 1240, y: 150, detail: "Serves the balance to the still-valid delegated token; expiry is enforced upstream of here." },
];

const EDGES = [
  ["user", "agent", "delegated ask", { detail: "Alice's standing consent; the agent never holds a long-lived secret." }],
  ["agent", "gw", "balance call", { detail: "The agent presents its delegated token — minutes old, by design." }],
  ["gw", "p1", "introspect", { detail: "Signature alone is not enough: the gateway checks the token is still inside its TTL." }],
  ["p1", "acct", "forward with live token", { dashed: true, detail: "Only a token inside its window reaches the API; a captured-and-expired one dies here." }],
  ["acct", "agent", "balance", { detail: "The answer returns on the same short-lived grant." }],
];

const walk = [
  {
    title: "Short-lived by construction", label: "TTL at mint",
    nodes: ["user", "agent"], edges: [0],
    lines: [{ who: "PingOne", text: "The RFC 8693 exchange stamps a tight TTL on the delegated token — configuration, not custom rotation code." }],
    tech: [{ t: "TOKEN", c: "agent AT: act={sub:agent, sub:alice}, exp = now + minutes" }],
  },
  {
    title: "Present the token", label: "call inside the window",
    nodes: ["agent", "gw"], edges: [1],
    lines: [{ who: "Agent", text: "The refresh loop keeps the credential fresh; the token in hand is always young." }],
    tech: [{ t: "API", c: "POST /gateway/mcp tools/call get_account_balance  Bearer <agent AT>" }],
  },
  {
    title: "Introspection gate", label: "TTL beats signature",
    nodes: ["gw", "p1"], edges: [2],
    lines: [{ who: "Gateway", text: "A stolen token is rejected the moment its TTL passes — no standing credential to abuse." }],
    tech: [
      { t: "POLICY", c: "introspection: active=true only while now < exp; past-TTL -> 401" },
      { t: "TOKEN", c: "expired token: signature valid, active=false -> rejected" },
    ],
  },
  {
    title: "Live token reaches the API", label: "balance served",
    nodes: ["p1", "acct"], edges: [3],
    lines: [{ who: "Accounts", text: "The API sees only calls whose token passed the TTL check upstream." }],
    tech: [{ t: "API", c: "GET /api/accounts -> 200 accounts[]" }],
  },
  {
    title: "Answer", label: "and the clock keeps running",
    nodes: ["acct", "agent"], edges: [4],
    lines: [{ who: "Presenter", text: "A credential captured after this run is already dead — the risk window is minutes, not days." }],
    tech: [{ t: "API", c: "balance -> agent -> Alice's chat" }],
  },
];

export default {
  id: "UC17",
  result: { label: "PERMIT", tone: "ok" },
  GROUPS: G,
  NODES,
  EDGES,
  walk,
};
