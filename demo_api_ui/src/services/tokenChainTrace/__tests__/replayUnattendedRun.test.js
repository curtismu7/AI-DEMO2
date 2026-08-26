import { replayUnattendedRun, describeRun } from "../replayUnattendedRun";
import { tokenChainTraceStore } from "../tokenChainTraceStore";
import { deriveAgentClass } from "../deriveAgentClass";

const UNATTENDED_RUN = {
  runId: "aur-1",
  job: "fraud-watch",
  trigger: "cron 0 2 * * *",
  status: "completed",
  scanned: 12,
  findings: [{ transactionId: "t1", amount: 5000 }],
  tokenEvents: [
    {
      id: "agent-actor-token",
      label: "Agent Token (unattended)",
      claims: { sub: "agent:fraud-watch", aud: "banking.ping.demo", scope: "read" },
    },
  ],
};

// subscribe() fires synchronously with the current state, so this reads it
// without leaving a listener behind. getState() returns { trace, steps }.
const state = () => {
  let s;
  const unsub = tokenChainTraceStore.subscribe((next) => { s = next; });
  unsub();
  return s.trace;
};

beforeEach(() => tokenChainTraceStore.reset());

test("replays the stored run into the rail", () => {
  expect(replayUnattendedRun(UNATTENDED_RUN)).toBe(true);
  const ids = state().tokenEvents.map((e) => e.id);
  expect(ids).toContain("agent-actor-token");
});

// The regression that matters. beginTrace/ingestTokenEvents carry
// SESSION_EVENT_IDS forward, so a signed-in viewer's user-token would other-
// wise be spliced into an unattended run and the rail would call it a Worker.
test("does not inherit a signed-in viewer's user token", () => {
  tokenChainTraceStore.beginTrace({ prompt: "a live run" });
  tokenChainTraceStore.ingestTokenEvents([
    { id: "user-token", claims: { sub: "demoUser" } },
    { id: "agent-actor-token", claims: { sub: "agent", act: { sub: "agent" } } },
  ]);
  expect(deriveAgentClass(state().tokenEvents)).toBe("worker");

  replayUnattendedRun(UNATTENDED_RUN);

  const events = state().tokenEvents;
  expect(events.some((e) => e.id === "user-token")).toBe(false);
  expect(deriveAgentClass(events)).toBe("autonomous");
});

test("a run with no token events is not replayable", () => {
  expect(replayUnattendedRun({ ...UNATTENDED_RUN, tokenEvents: [] })).toBe(false);
  expect(replayUnattendedRun(null)).toBe(false);
});

test("describes findings and failures for a run row", () => {
  expect(describeRun(UNATTENDED_RUN)).toBe("1 finding across 12 transactions");
  expect(describeRun({ ...UNATTENDED_RUN, findings: [], scanned: 1 }))
    .toBe("no findings across 1 transaction");
  expect(describeRun({ status: "failed", error: "agent_not_configured" }))
    .toBe("failed — agent_not_configured");
});
