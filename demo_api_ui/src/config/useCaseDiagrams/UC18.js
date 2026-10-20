/**
 * UC18 — Rate-limit / resource-overload defense (429). A burst of rapid
 * sequential tool calls meets per-agent, per-tool rate limiting at the
 * gateway: throttled with 429 before further dispatch, protecting upstream
 * services and LLM budgets.
 */
import { PARTICIPANT_GROUPS as G } from "./palette";

const NODES = [
  { id: "atk", group: "external", label: "Flooding agent", sub: ["burst of calls"], x: 40, y: 150, detail: "Fires rapid sequential tool calls — probing thresholds, running up cost, or plain flooding." },
  { id: "gw", group: "gateway", label: "Rate limiter", sub: ["per agent+tool"], x: 340, y: 150, detail: "The limiter's window is per agent and per tool: 3 calls per 10 seconds in the sim." },
  { id: "tool", group: "resource", label: "Banking MCP", sub: ["sees the flood end"], x: 640, y: 150, detail: "Upstream services and LLM budgets never see the flood past the limiter." },
];

const EDGES = [
  ["atk", "gw", "burst", { detail: "Calls 1, 2, 3 within the window." }],
  ["gw", "gw", "window counted", { detail: "The limiter counts per agent and per tool." }],
  ["atk", "gw", "calls 4, 5, 6…", { detail: "The burst continues past the allowed rate." }],
  ["gw", "atk", "429", { dashed: true, detail: "Throttled — not errored — before further tool dispatch." }],
  ["gw", "tool", "upstream untouched", { detail: "The flood stops at the limiter; the tool and LLM budget never see it." }],
];

const walk = [
  {
    title: "Burst begins", label: "Rapid sequential calls",
    nodes: ["atk", "gw"], edges: [0],
    lines: [{ who: "Attacker", text: "The flood pattern: as many tool calls as the wire allows." }],
    tech: [{ t: "API", c: "N sequential tools/call requests, same agent + tool" }],
  },
  {
    title: "Limiter counts", label: "Per agent, per tool",
    nodes: ["gw"], edges: [1],
    lines: [{ who: "Gateway", text: "The window is scoped so one noisy agent cannot exhaust a shared budget." }],
    tech: [{ t: "POLICY", c: "rate window: 3 calls / 10 s per (agent, tool)" }],
  },
  {
    title: "Limit crossed", label: "Mid-burst",
    nodes: ["atk", "gw"], edges: [2],
    lines: [{ who: "Gateway", text: "The burst keeps firing past the allowed rate." }],
    tech: [{ t: "POLICY", c: "call 4 exceeds the window -> throttle" }],
  },
  {
    title: "429 throttled", label: "Before more dispatch",
    nodes: ["gw", "atk"], edges: [3],
    lines: [{ who: "Gateway", text: "429 Too Many Requests — if the sim reports no 429, the limiter is not active." }],
    tech: [{ t: "API", c: "gateway -> 429 Too Many Requests (no further dispatch)" }],
  },
  {
    title: "Budgets protected", label: "At the edge",
    nodes: ["gw", "tool"], edges: [4],
    lines: [{ who: "Presenter", text: "Upstream services and LLM budgets never see the flood — no app change required." }],
    tech: [{ t: "POLICY", c: "protection point: gateway perimeter (upstream untouched)" }],
  },
];

export default {
  id: "UC18",
  result: { label: "THROTTLED", tone: "warn" },
  GROUPS: G,
  NODES,
  EDGES,
  walk,
};
