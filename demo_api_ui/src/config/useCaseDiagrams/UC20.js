/**
 * UC20 — Agent observability and traceability. The same flow as UC1, watched
 * through the evidence lens: the Token Chain and Activity panels reconstruct
 * who the agent was, who it acted for and what the policy decided — with no
 * application-layer instrumentation.
 */
import { PARTICIPANT_GROUPS as G } from "./palette";

const NODES = [
  { id: "user", group: "user", label: "Alice (user)", sub: ["same ask as UC1"], x: 40, y: 150, detail: "Sends 'show my balance' — the identical flow, watched for its evidence this time." },
  { id: "agent", group: "agent", label: "Banking agent", sub: ["acts for Alice"], x: 340, y: 150, detail: "The same delegated call; the point now is what the platform recorded." },
  { id: "chain", group: "gateway", label: "Token Chain panel", sub: ["hop by hop"], x: 640, y: 150, detail: "user-token -> token-exchange -> authorize-decision -> tool-dispatched, on the rail." },
  { id: "act", group: "resource", label: "Activity panel", sub: ["stamped events"], x: 940, y: 310, detail: "The use-case id and act chain are stamped on every token event and activity log." },
  ];

const EDGES = [
  ["user", "agent", "show my balance", { detail: "The flow runs exactly as in UC1." }],
  ["agent", "chain", "every hop recorded", { detail: "The rail reconstructs the whole token journey." }],
  ["agent", "act", "events stamped", { detail: "Attribution rides on the platform, not on log statements." }],
  ["chain", "act", "correlated", { vertical: true, detail: "The rail and the events tell one reconstructed story." }],
  ["act", "act", "platform-emitted", { detail: "The audit trail exists because the platform emitted it." }],
];

const walk = [
  {
    title: "Run the flow again", label: "Same as UC1",
    nodes: ["user", "agent"], edges: [0],
    lines: [{ who: "Alice", text: "The same balance question — this time we watch the record, not the reply." }],
    tech: [{ t: "API", c: "POST /gateway/mcp get_account_balance (as UC1)" }],
  },
  {
    title: "Token Chain", label: "The rail, hop by hop",
    nodes: ["agent", "chain"], edges: [1],
    lines: [{ who: "Presenter", text: "user-token, token-exchange, authorize-decision, tool-dispatched — all four on screen." }],
    tech: [{ t: "TOKEN", c: "chain: user-token -> token-exchange -> authorize-decision -> tool-dispatched" }],
  },
  {
    title: "Activity panel", label: "Stamped, not logged",
    nodes: ["agent", "act"], edges: [2],
    lines: [{ who: "Gateway", text: "The useCaseId and act chain are on every token event and activity log." }],
    tech: [{ t: "POLICY", c: "events carry useCaseId + act chain (platform-stamped)" }],
  },
  {
    title: "Attributable end to end", label: "Who · acting-for · decision",
    nodes: ["chain", "act"], edges: [3],
    lines: [{ who: "Presenter", text: "Compliance and incident response depend on exactly this reconstruction." }],
    tech: [{ t: "TOKEN", c: "act chain reconstructable after the fact" }],
  },
  {
    title: "No instrumentation", label: "Platform-emitted",
    nodes: ["act"], edges: [4],
    lines: [{ who: "Presenter", text: "The audit trail exists because the platform emitted it, not because the app remembered to log." }],
    tech: [{ t: "POLICY", c: "zero application-layer instrumentation" }],
  },
];

export default {
  id: "UC20",
  result: { label: "PERMIT", tone: "ok" },
  GROUPS: G,
  NODES,
  EDGES,
  walk,
};
