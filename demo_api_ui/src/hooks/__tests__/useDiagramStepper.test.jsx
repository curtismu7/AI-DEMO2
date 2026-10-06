import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { edgeCaptions, stepEdges, useDiagramStepper } from "../useDiagramStepper";

describe("useDiagramStepper", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("is off until Simulate, then auto-advances and pauses on the last step", () => {
    const { result } = renderHook(() => useDiagramStepper(3));
    expect(result.current.step).toBe(-1);
    act(() => result.current.simulate());
    expect(result.current.step).toBe(0);
    act(() => vi.advanceTimersByTime(result.current.stepMs));
    expect(result.current.step).toBe(1);
    act(() => vi.advanceTimersByTime(result.current.stepMs));
    expect(result.current.step).toBe(2);
    act(() => vi.advanceTimersByTime(result.current.stepMs));
    expect(result.current.step).toBe(2);
    expect(result.current.paused).toBe(true);
  });

  it("steps manually while paused and Stop returns to off", () => {
    const { result } = renderHook(() => useDiagramStepper(3));
    act(() => result.current.simulate());
    act(() => result.current.pause());
    act(() => result.current.next());
    expect(result.current.step).toBe(1);
    act(() => result.current.prev());
    act(() => result.current.prev());
    expect(result.current.step).toBe(0);
    act(() => result.current.stop());
    expect(result.current.step).toBe(-1);
  });
});

describe("stepEdges / edgeCaptions", () => {
  const edges = [{ id: "a" }, { id: "b" }, { id: "c" }];

  it("leaves edges alone when off, accents the current one and fades later ones", () => {
    expect(stepEdges(edges, -1)).toBe(edges);
    const out = stepEdges(edges, 1);
    expect(out[0]).toBe(edges[0]);
    expect(out[1].animated).toBe(true);
    expect(out[2].style.opacity).toBe(0.3);
  });

  it("captions tuple and object edges with node names", () => {
    expect(edgeCaptions([["x", "y", "go"], { source: "y", target: "x" }], { x: "X", y: "Y" })).toEqual([
      "X → Y: go",
      "Y → X",
    ]);
  });
});
