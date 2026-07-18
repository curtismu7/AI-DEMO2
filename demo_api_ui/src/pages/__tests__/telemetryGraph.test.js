import { describe, expect, it } from "vitest";
import {
  NODE_RADIUS,
  autoLayout,
  edgeGeometry,
  mergePositions,
  wrapLabel,
} from "../telemetryGraph";

const GRAPH = {
  nodes: [
    { id: "a", label: "A" },
    { id: "b", label: "B" },
    { id: "c", label: "C" },
  ],
  edges: [
    { source: "a", target: "b", label: "ab" },
    { source: "b", target: "c", label: "bc" },
  ],
};

describe("autoLayout", () => {
  it("places nodes left-to-right by depth", () => {
    const pos = autoLayout(GRAPH, 900, 400);
    expect(pos.get("a").x).toBeLessThan(pos.get("b").x);
    expect(pos.get("b").x).toBeLessThan(pos.get("c").x);
  });

  it("spreads same-depth nodes vertically without overlap", () => {
    const g = {
      nodes: [{ id: "r" }, { id: "x" }, { id: "y" }],
      edges: [
        { source: "r", target: "x", label: "" },
        { source: "r", target: "y", label: "" },
      ],
    };
    const pos = autoLayout(g, 900, 400);
    expect(pos.get("x").x).toBe(pos.get("y").x);
    expect(Math.abs(pos.get("x").y - pos.get("y").y)).toBeGreaterThanOrEqual(2 * NODE_RADIUS);
  });

  it("handles cycles without hanging and places every node", () => {
    const g = {
      nodes: [{ id: "a" }, { id: "b" }],
      edges: [
        { source: "a", target: "b", label: "" },
        { source: "b", target: "a", label: "" },
      ],
    };
    const pos = autoLayout(g, 900, 400);
    expect(pos.size).toBe(2);
  });
});

describe("mergePositions", () => {
  it("keeps dragged positions for surviving nodes and lays out new ones", () => {
    const prev = new Map([["a", { x: 123, y: 321 }]]);
    const pos = mergePositions(prev, GRAPH, 900, 400);
    expect(pos.get("a")).toEqual({ x: 123, y: 321 });
    expect(pos.get("b")).toBeDefined();
    expect(pos.get("c")).toBeDefined();
  });

  it("drops positions of removed nodes", () => {
    const prev = new Map([["gone", { x: 1, y: 2 }]]);
    const pos = mergePositions(prev, GRAPH, 900, 400);
    expect(pos.has("gone")).toBe(false);
  });
});

describe("edgeGeometry", () => {
  it("trims endpoints to the circle borders", () => {
    const g = edgeGeometry({ x: 0, y: 0 }, { x: 100, y: 0 }, 40);
    expect(g.x1).toBeCloseTo(42, 0);
    expect(g.x2).toBeCloseTo(100 - 46, 0);
    expect(g.y1).toBeCloseTo(0, 5);
  });
});

describe("wrapLabel", () => {
  it("returns one line for short labels, two lines for long ones", () => {
    expect(wrapLabel("BFF")).toEqual(["BFF"]);
    const lines = wrapLabel("demo-api-server: POST /api/agent/run");
    expect(lines).toHaveLength(2);
  });
});
