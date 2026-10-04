import { chainHopToTokenEvent, startPrivilegeA2aChainRun } from "../privilegeA2aChainRun";
import { buildLiveTokenChainSteps, buildPrivilegeA2aChainSteps } from "../../components/TokenChainTraceRail";
import { deriveLifelineParticipants, deriveLifelineSteps } from "../../services/tokenChainTrace/deriveLifelineSteps";
import { buildTraceSteps, laneLabel } from "../../services/tokenChainTrace/buildTraceSteps";
import { buildObservedTopology } from "../../components/TokenTopologyPanel";
import { buildDiagramSource } from "../../components/TokenExchangeDiagram";
import mermaid from "mermaid";

vi.mock("../../context/TokenChainContext", () => ({ useTokenChainOptional: () => null }));

const sse = (frames) => new Response(
  frames.map(([event, payload]) => `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`).join(""),
  { status: 200, headers: { "Content-Type": "text/event-stream" } },
);

function fakeStore() {
  const calls = [];
  const events = [];
  return {
    calls,
    events,
    beginTrace: (arg) => calls.push(["beginTrace", arg]),
    ingestTokenEvent: (event) => { events.push(event); calls.push(["ingestTokenEvent", event.id]); },
    ingestLlmReply: (text) => calls.push(["ingestLlmReply", text]),
    completeTrace: (ok, _id, detail) => calls.push(["completeTrace", ok, detail]),
  };
}

const FULL_CHAIN = [
  ["trace", { kind: "delegate", from: "main", to: "langchainagent", text: "main → langchainagent" }],
  ["trace", { kind: "delegate", from: "langchainagent", to: "refunds", text: "langchainagent → refunds", elapsedMs: 42 }],
  ["trace", { kind: "result", from: "refunds", to: "langchainagent", text: "refunds returned" }],
  ["trace", { kind: "result", from: "langchainagent", to: "main", text: "langchainagent returned" }],
  ["token", { text: "Refund approved" }],
  ["done", {}],
];

test("a hop without both ends is not a token event", () => {
  expect(chainHopToTokenEvent({ kind: "session", text: "chain started" }, 0)).toBeNull();
});

test("a full chain feeds one event per hop and settles the run as ok", async () => {
  const store = fakeStore();
  const fetchImpl = vi.fn().mockResolvedValue(sse(FULL_CHAIN));

  const result = await startPrivilegeA2aChainRun({ message: "Refund order 7", specialist: "refunds", store, fetchImpl });

  expect(result).toEqual({ ok: true, answer: "Refund approved" });
  expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual({ message: "Refund order 7", specialist: "refunds" });
  expect(store.events.map((event) => `${event.id}:${event.from}>${event.to}`)).toEqual([
    "pa2a-0:main>langchainagent",
    "pa2a-1:langchainagent>refunds",
    "pa2a-2:refunds>langchainagent",
    "pa2a-3:langchainagent>main",
  ]);
  expect(store.calls[0][0]).toBe("beginTrace");
  expect(store.calls.at(-1)).toEqual(["completeTrace", true, undefined]);
});

test("a refused hop is kept as an error event and the run settles as failed", async () => {
  const store = fakeStore();
  const fetchImpl = vi.fn().mockResolvedValue(sse([
    ["trace", { kind: "delegate", from: "main", to: "langchainagent" }],
    ["trace", { kind: "error", from: "langchainagent", to: "refunds", detail: "refunds refused (403): Forbidden" }],
    ["error", { error: "Delegation failed: refunds refused (403): Forbidden" }],
  ]));

  const result = await startPrivilegeA2aChainRun({ message: "Refund order 7", specialist: "refunds", store, fetchImpl });

  expect(result.ok).toBe(false);
  expect(store.events[1]).toMatchObject({ status: "error", from: "langchainagent", to: "refunds" });
  expect(store.calls.at(-1)).toEqual(["completeTrace", false, "Delegation failed: refunds refused (403): Forbidden"]);
});

test("an unavailable service settles the run as failed with the API's reason", async () => {
  const store = fakeStore();
  const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "A2A service unavailable" }), { status: 502 }));

  const result = await startPrivilegeA2aChainRun({ message: "hi", specialist: "refunds", store, fetchImpl });

  expect(result).toEqual({ ok: false, error: "A2A service unavailable" });
  expect(store.events).toEqual([]);
});

test("each call is caller, gateway, callee; a refused call stops at the gateway", () => {
  const tokenEvents = [
    { id: "user-token", status: "acquired" },
    { id: "pa2a-0", kind: "delegate", from: "main", to: "langchainagent", status: "ok" },
    { id: "pa2a-1", kind: "error", from: "langchainagent", to: "refunds", status: "error", detail: "403: Forbidden" },
  ];
  const bankingSkeleton = [{ id: "user-token", title: "Sign-in", status: "done" }, { id: "llm", title: "LLM", status: "pending" }];

  const steps = buildLiveTokenChainSteps(bankingSkeleton, { tokenEvents, startedAt: 1 });

  expect(steps.map((step) => [step.num, step.id, step.lane, step.status])).toEqual([
    [1, "pa2a-0-call", "MAIN-AGENT", "done"],
    [2, "pa2a-0-gateway", "GATEWAY", "done"],
    [3, "pa2a-0-forward", "LANGCHAIN-AGENT", "done"],
    [4, "pa2a-1-call", "LANGCHAIN-AGENT", "done"],
    [5, "pa2a-1-gateway", "GATEWAY", "error"],
  ]);
  expect(steps[4].detail.narrative).toContain("403: Forbidden");
  expect(buildPrivilegeA2aChainSteps([{ id: "a2a-exchange1" }])).toEqual([]);
});

test("the sequence view gets one lifeline per agent with the gateway between them", () => {
  const steps = buildPrivilegeA2aChainSteps([
    { id: "pa2a-0", kind: "delegate", from: "main", to: "langchainagent", status: "ok" },
    { id: "pa2a-1", kind: "result", from: "langchainagent", to: "main", status: "ok" },
  ]);
  const lifeline = deriveLifelineSteps(steps);

  expect(lifeline.map((step) => (step.type === "arrow" ? `${step.from}>${step.to}` : step.lane))).toEqual([
    "MAIN-AGENT",
    "MAIN-AGENT>GATEWAY",
    "GATEWAY>LANGCHAIN-AGENT",
    "LANGCHAIN-AGENT>MAIN-AGENT",
  ]);
  expect(deriveLifelineParticipants(lifeline)).toEqual(["MAIN-AGENT", "GATEWAY", "LANGCHAIN-AGENT"]);
  expect(laneLabel("MAIN-AGENT")).toBe("MAIN AGENT");
});

test("every view that reads the store's steps gets the chain, not an empty banking pipeline", async () => {
  const trace = {
    startedAt: 1,
    tokenEvents: [
      { id: "pa2a-0", kind: "delegate", from: "main", to: "langchainagent", status: "ok" },
      { id: "pa2a-1", kind: "error", from: "langchainagent", to: "restricted", status: "error", detail: "403: Forbidden" },
    ],
  };

  const steps = buildTraceSteps(trace);
  expect(steps.map((step) => step.id)).toEqual(["pa2a-0-call", "pa2a-0-gateway", "pa2a-0-forward", "pa2a-1-call", "pa2a-1-gateway"]);

  // Token topology panel: one node per step, on the agent and gateway lanes.
  expect(buildObservedTopology(steps).map((node) => node.lane)).toEqual(["MAIN-AGENT", "GATEWAY", "LANGCHAIN-AGENT", "LANGCHAIN-AGENT", "GATEWAY"]);

  // Token-exchange diagram: the actors and numbered hops, with the refusal marked.
  if (!window.CSS.supports) window.CSS.supports = () => true;
  const source = buildDiagramSource(trace, steps, false);
  expect(source).toContain('A0["MAIN AGENT"]');
  expect(source).toContain('"5 refused"');
  await expect(mermaid.parse(source)).resolves.toBeTruthy();

  // A banking trace is untouched.
  expect(buildTraceSteps({ tokenEvents: [{ id: "user-token", status: "acquired" }], phases: [] })[0].id).toBe("website");
});

test("each hop is also published on the token-chain bus the Simple Stepper reads", async () => {
  const published = [];
  const onInject = (event) => published.push(event.detail.events.map((hop) => `${hop.id}:${hop.status}`));
  window.addEventListener("token-chain-inject", onInject);
  const frames = [
    'event: trace\ndata: {"kind":"delegate","from":"main","to":"langchainagent","text":"main → langchainagent"}\n\n',
    'event: trace\ndata: {"kind":"error","from":"langchainagent","to":"restricted","text":"refused","detail":"403"}\n\n',
    'event: error\ndata: {"error":"Delegation failed"}\n\n',
  ];
  const body = new ReadableStream({ start(controller) { frames.forEach((frame) => controller.enqueue(new TextEncoder().encode(frame))); controller.close(); } });
  const store = { beginTrace() {}, ingestTokenEvent() {}, ingestLlmReply() {}, completeTrace() {} };

  await startPrivilegeA2aChainRun({ message: "hi", specialist: "restricted", store, fetchImpl: async () => ({ ok: true, body }) });
  window.removeEventListener("token-chain-inject", onInject);

  expect(published).toEqual([["pa2a-0:ok"], ["pa2a-0:ok", "pa2a-1:error"]]);
});
