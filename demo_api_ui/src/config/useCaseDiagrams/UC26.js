/**
 * UC26 — Proof of enforcement. A meta page, not a token flow: a link card to
 * /use-cases, then any use case runs, and a client-side proof engine compares
 * the real trace to that use case's declared evidence. Verdicts — verified,
 * denied-as-expected, mismatch or incomplete — surface live instead of asking
 * the audience to trust the demo.
 */
import { PARTICIPANT_GROUPS as G } from "./palette";
import { RFC } from "../pingStyleStandards";

const NODES = [
  { id: "user", group: "user", label: "Presenter / Alice", sub: ["runs any use case"], x: 40, y: 150, detail: "Clicks the link card and triggers whatever scenario she wants — this use case runs no chip of its own." },
  { id: "launch", group: "agent", label: "Use-case launcher", sub: ["/use-cases link card"], x: 440, y: 150, detail: "A link card, not a chat chip: it opens the use-case list where any other scenario is triggered." },
  { id: "run", group: "gateway", label: "Any governed run", sub: ["whatever you triggered"], x: 840, y: 150, detail: "Each tool call is tagged with the use-case id and vertical across the token chain, the Authorize decision and the activity log." },
  { id: "verdict", group: "resource", label: "Verdict + evidence", sub: ["proof strip", "Verified banner"], x: 1240, y: 150, detail: "A client-side engine compares the real trace to the use case's declared evidence: verified, denied-as-expected, mismatch or incomplete." },
];

const EDGES = [
  ["user", "launch", "open the link card", { detail: "The card points at /use-cases — no chip, no special setup." }],
  ["launch", "run", "trigger any use case", { detail: "The chosen scenario runs under its own governed chain, unchanged." }],
  ["run", "verdict", "trace vs declared evidence", { detail: "The client-side engine checks what actually happened against what the use case declares." }],
  ["verdict", "user", "watch the proof", { dashed: true, detail: "Inline strip, Token Chain checklist and Verified banner — enforcement you can see, not assert." }],
];

const walk = [
  {
    title: "Open the card", label: "No chip of its own",
    nodes: ["user", "launch"], edges: [0],
    lines: [{ who: "Presenter", text: "This use case is the proof layer — pick any scenario below and watch it." }],
    tech: [{ t: "API", c: "link card -> /use-cases (trigger any use case below and watch the verdict appear)" }],
  },
  {
    title: "Any use case runs", label: "Unchanged chain",
    nodes: ["launch", "run"], edges: [1],
    lines: [{ who: "Gateway", text: "Whatever runs, its calls stay on the same governed path as always." }],
    tech: [{ t: "POLICY", c: "run proceeds under its own use case's chain: exchange, Authorize, dispatch" }],
  },
  {
    title: "Trace is tagged", label: "Use-case id + vertical",
    nodes: ["run", "verdict"], edges: [2],
    lines: [{ who: "Verifier", text: "Token chain, Authorize decision and activity log all carry the tag." }],
    tech: [{ t: "API", c: "trace events tagged use-case id + vertical across token chain, authorize-decision, activity log" }],
  },
  {
    title: "Verdict appears", label: "Live, not asserted",
    nodes: ["verdict", "user"], edges: [3],
    lines: [{ who: "Panel", text: "Verified, denied-as-expected, mismatch or incomplete — under the reply, in the checklist, on the banner." }],
    tech: [{ t: "POLICY", c: "proof engine: real trace vs declared evidence -> verified | denied-as-expected | mismatch | incomplete" }],
  },
];

// Per-step detail. UC26 is a meta page: it adds no token of its own, so every step states that and shows what the proof layer reads.
const steps = [
  {
    beats: [0],
    detail: {
      form: "Navigate (SPA route): /use-cases\n\nA link card, not a chat chip: it opens the use-case list. No API call, no credential, no token.",
      tokens: [],
    },
  },
  {
    beats: [1],
    detail: {
      form: "Whichever use case you trigger runs its own chain, unchanged:\n\nPOST /api/agent/invoke -> RFC 8693 exchange -> PingOne Authorize decision -> POST /gateway/mcp tools/call\n\nThis use case mints no token; the tokens in play are the triggered use case's.",
      tokens: [],
      refs: [RFC(8693, "OAuth 2.0 Token Exchange (the chain every governed run replays)")],
    },
  },
  {
    beats: [2],
    detail: {
      form: "Trace events (token chain, authorize-decision, activity log), each tagged:\n\n{ \"useCaseId\": \"<use case id>\", \"vertical\": \"<vertical id>\", \"type\": \"<event type>\" }\n\n(shape shown for orientation; the tag is what lets the engine pair a real trace with its declared evidence)",
      tokens: [],
    },
  },
  {
    beats: [3],
    detail: {
      form: "Client-side proof engine (no network call)\n\nreal trace  vs  declared evidence of the use case\n  -> verified | denied-as-expected | mismatch | incomplete\n\nShown inline under the reply, in the Token Chain checklist and on the Verified banner.",
      tokens: [],
    },
  },
];

export default {
  id: "UC26",
  result: { label: "GUIDED DEMO", tone: "info" },
  pingStyle: true,
  GROUPS: G,
  NODES,
  EDGES,
  walk,
  steps,
};
