import { beforeEach, describe, expect, it } from "vitest";
import { tokenChainTraceStore } from "../tokenChainTraceStore";
import {
  SPIFFE_BRIDGE_EVENT_IDS,
  SPIFFE_BRIDGE_PROMPT,
  SPIFFE_BRIDGE_TRACE_KIND,
  runSpiffeBridgeSimulation,
} from "../spiffeBridgeSimulation";

describe("SPIFFE → PingOne bridge simulation", () => {
  beforeEach(() => {
    tokenChainTraceStore.reset();
  });

  it("emits the four bridge hops into the shared trace", async () => {
    await runSpiffeBridgeSimulation({ delayMs: 0 });

    const snapshot = tokenChainTraceStore.getState();
    expect(snapshot.trace.prompt.message).toMatch(/SPIFFE.*PingOne bridge simulation/i);
    expect(snapshot.trace.outcome).toBe("ok");
    expect(snapshot.trace.tokenEvents.map((event) => event.id)).toEqual(SPIFFE_BRIDGE_EVENT_IDS);
    expect(snapshot.trace.tokenEvents.every((event) => event.bridge === SPIFFE_BRIDGE_TRACE_KIND)).toBe(true);

    const bridgeSteps = snapshot.steps.filter((step) => SPIFFE_BRIDGE_EVENT_IDS.includes(step.id));
    expect(bridgeSteps).toHaveLength(4);
    expect(bridgeSteps.every((step) => step.status === "done")).toBe(true);
  });

  it("resets the bridge run through the normal trace reset", async () => {
    await runSpiffeBridgeSimulation({ delayMs: 0 });

    tokenChainTraceStore.reset();

    const snapshot = tokenChainTraceStore.getState();
    expect(snapshot.trace.tokenEvents).toEqual([]);
    expect(snapshot.trace.outcome).toBeNull();
    expect(snapshot.steps.some((step) => SPIFFE_BRIDGE_EVENT_IDS.includes(step.id))).toBe(false);
  });

  it("does not let a delayed run write after the trace is reset", async () => {
    const run = runSpiffeBridgeSimulation({ delayMs: 10 });
    tokenChainTraceStore.reset();

    await run;

    expect(tokenChainTraceStore.getState().trace.tokenEvents).toEqual([]);
    expect(tokenChainTraceStore.getState().trace.outcome).toBeNull();
  });

  it("does not add bridge steps to an ordinary trace with the same prompt", () => {
    tokenChainTraceStore.beginTrace({ prompt: SPIFFE_BRIDGE_PROMPT });

    expect(tokenChainTraceStore.getState().steps.some((step) => SPIFFE_BRIDGE_EVENT_IDS.includes(step.id))).toBe(false);
  });
});
