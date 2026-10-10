/**
 * UC1 — Delegated access (consent only). Pilot diagram: happy-path delegation
 * with RFC 8693 token exchange. Participants left-to-right in call order.
 * Story beats live in `walk`; title/what/businessValue import from demoStepGuides.
 */
import { PARTICIPANT_GROUPS as G } from "./palette";

const NODES = [
  { id: "user", group: "user", label: "Alice (user)", sub: ["Signs in once"], x: 40, y: 150, detail: "Signed in; her agent acts for her under her consent." },
  { id: "agent", group: "agent", label: "Banking agent", sub: ["Holds Alice's token"], x: 340, y: 150, detail: "Holds Alice's token and needs her account data; never sees her password." },
  { id: "gw", group: "gateway", label: "Agent gateway", sub: ["CIMD check", "downscope"], x: 640, y: 150, detail: "Validates the client, asks policy, then exchanges the token downscoped." },
  { id: "p1", group: "pingone", label: "PingOne", sub: ["Authorize", "token exchange"], x: 940, y: 150, detail: "Evaluates the request and mints the delegated token with the act claim." },
  { id: "acct", group: "resource", label: "Accounts API", sub: ["read-only"], x: 1240, y: 150, detail: "Serves account data to the downscoped caller; validates scope on every call." },
];

const EDGES = [
  ["user", "agent", "acts for Alice", { detail: "Delegated consent — Alice's authority, explicitly granted at sign-in." }],
  ["agent", "gw", "user token", { detail: "Gateway validates the client (CIMD) before any policy check." }],
  ["gw", "p1", "RFC 8693 exchange", { detail: "User token in, downscoped agent token out with act={sub: agent, sub: alice}." }],
  ["p1", "acct", "agent token · accounts:read", { detail: "Narrowed: read-only, one user, one API." }],
];

const walk = [
  {
    title: "Consent at sign-in", label: "Alice's authority, explicitly granted",
    nodes: ["user", "agent"], edges: [0],
    lines: [{ who: "Alice", text: "Sign-in consent is what authorizes everything that follows." }],
    tech: [{ t: "TOKEN", c: "user AT: sub=alice, scp=accounts:read, act=absent" }],
  },
  {
    title: "Gateway checks the client", label: "CIMD before policy",
    nodes: ["agent", "gw"], edges: [1],
    lines: [{ who: "Gateway", text: "Registered client? Then policy. Not the reverse." }],
    tech: [
      { t: "API", c: "POST /gateway/mcp  Authorization: Bearer <user AT>" },
      { t: "POLICY", c: "CIMD document resolves for the calling client" },
    ],
  },
  {
    title: "Token exchange", label: "RFC 8693 downscope",
    nodes: ["gw", "p1"], edges: [2],
    lines: [{ who: "PingOne", text: "The delegated token carries act — who the agent is acting for." }],
    tech: [
      { t: "TOKEN", c: "RFC 8693 exchange -> agent AT: act={sub:agent, sub:alice}, scp=accounts:read" },
      { t: "POLICY", c: "Authorize evaluates the exchange: PERMIT" },
    ],
  },
  {
    title: "Read with the delegated token", label: "Narrowed to one API",
    nodes: ["p1", "acct"], edges: [3],
    lines: [{ who: "Accounts", text: "Scope validated per call; read-only, this user only." }],
    tech: [{ t: "API", c: "GET /api/accounts  Authorization: Bearer <agent AT> -> 200 accounts[]" }],
  },
];

export default {
  id: "UC1",
  // Backend catalog useCaseId (config/useCases.js). Live overlay matching keys
  // off this slug — shared across verticals by design.
  slug: "delegated-access-with-proof",
  // buildTraceSteps baseId -> this diagram's node ids. A live hop renders on
  // the nodes it actually touched; hops without a hint stay off the overlay.
  hopHints: {
    signin: ["user"], prompt: ["user"], agent: ["agent"], llm: ["agent"],
    "agent-token": ["agent"], exchange: ["gw", "p1"], "exchange-1": ["gw", "p1"],
    authorize: ["gw", "p1"], gateway: ["gw"], "tools-list": ["agent", "gw"],
    "tools-list-challenge": ["agent", "gw"], "tools-call-challenge": ["agent", "gw"],
    mcp: ["gw", "acct"], api: ["acct"], reply: ["agent", "user"],
  },
  result: { label: "PERMIT", tone: "ok" },
  GROUPS: G,
  NODES,
  EDGES,
  walk,
};
