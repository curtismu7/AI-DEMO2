import { describe, expect, it } from "vitest";
import {
  CARD_W,
  CARD_H,
  autoLayout,
  edgePath,
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
    expect(Math.abs(pos.get("x").y - pos.get("y").y)).toBeGreaterThanOrEqual(CARD_H);
  });

  it("keeps at least CARD_H separation even with many same-depth nodes", () => {
    const g = {
      nodes: [{ id: "r" }, { id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }, { id: "e" }],
      edges: ["a", "b", "c", "d", "e"].map((id) => ({ source: "r", target: id, label: "" })),
    };
    const pos = autoLayout(g, 900, 400);
    const ys = ["a", "b", "c", "d", "e"].map((id) => pos.get(id).y).sort((m, n) => m - n);
    for (let i = 1; i < ys.length; i++) {
      expect(ys[i] - ys[i - 1]).toBeGreaterThanOrEqual(CARD_H);
    }
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

describe("edgePath", () => {
  it("connects the source card's right edge to the target card's left edge", () => {
    const g = edgePath({ x: 0, y: 0 }, { x: 400, y: 100 });
    const x1 = CARD_W / 2;
    const x2 = 400 - CARD_W / 2;
    const mx = (x1 + x2) / 2;
    expect(g.d).toBe(`M ${x1} 0 C ${mx} 0, ${mx} 100, ${x2} 100`);
    expect(g.labelX).toBe(mx);
    expect(g.labelY).toBe(50 - 10);
  });
});

describe("wrapLabel", () => {
  it("returns one line for short labels, two lines for long ones", () => {
    expect(wrapLabel("BFF")).toEqual(["BFF"]);
    const lines = wrapLabel("demo-api-server: POST /api/agent/run with extras");
    expect(lines).toHaveLength(2);
  });
});
