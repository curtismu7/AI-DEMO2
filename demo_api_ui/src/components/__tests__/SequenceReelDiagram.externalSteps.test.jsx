// The reel is a playback surface: fed `externalSteps` (the recorded-trace
// embed pages), it must draw the hops it is handed even though those pages
// never touch the token-chain store — the store's EMPTY_TRACE has no activity,
// and the shared visibility policy gates on it. Regression: the public
// /transaction-trace/embed reel went blank for anyone landing there without
// first running something on the dashboard.
const store = vi.hoisted(() => ({ state: null, listeners: new Set() }));
vi.mock("../../services/tokenChainTrace/tokenChainTraceStore", () => ({
  tokenChainTraceStore: {
    getState: () => store.state,
    subscribe: (fn) => {
      store.listeners.add(fn);
      return () => store.listeners.delete(fn);
    },
  },
}));

import { render } from "@testing-library/react";
import SequenceReelDiagram from "../SequenceReelDiagram";
import { VerticalContext } from "../../vertical/VerticalProvider";

const noop = () => {};

const EXTERNAL_STEPS = [
  { id: "user-token", num: 1, status: "done", title: "User token — session", lane: "USER", laneLabel: "USER" },
  { id: "exchange", num: 2, status: "done", title: "Token exchange — delegation", lane: "BFF", laneLabel: "BFF" },
];

function verticalOf(v) {
  return {
    pageManifest: { vertical: v, gates: {} },
    agentManifest: { vertical: v, gates: {} },
    activeId: v,
    verticalStatus: "ready",
    setActiveVertical: noop,
  };
}

describe("SequenceReelDiagram externalSteps (recorded-trace embed)", () => {
  beforeEach(() => {
    // The embed pages never write the store: a fresh EMPTY_TRACE.
    store.state = { steps: [], trace: { runId: null } };
    store.listeners.clear();
  });

  it("draws handed-in done steps even with an activity-less store trace", () => {
    const { container } = render(
      <VerticalContext.Provider value={verticalOf("banking")}>
        <SequenceReelDiagram externalSteps={EXTERNAL_STEPS} onToggleSlowMode={noop} />
      </VerticalContext.Provider>,
    );
    const labels = [...container.querySelectorAll("text")].map((t) => t.textContent);
    expect(labels.some((t) => /Token exchange/i.test(t || ""))).toBe(true);
    expect(labels.some((t) => /User token/i.test(t || ""))).toBe(true);
  });
});
