import { describe, expect, it } from "vitest";
import { INITIAL_EDGES, INITIAL_NODES, diagramSignature, parseDiagram } from "../digitalWorkerDiagram";

describe("digital worker diagram data", () => {
  it("has unique node ids and every arrow joins two existing nodes on a real handle", () => {
    const ids = INITIAL_NODES.map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const e of INITIAL_EDGES) {
      expect(ids, e.id).toContain(e.source);
      expect(ids, e.id).toContain(e.target);
      expect("trbl", e.id).toContain(e.sourceHandle);
      expect("trbl", e.id).toContain(e.targetHandle);
    }
  });
});

describe("parseDiagram (Load JSON)", () => {
  const file = (nodes, edges) => JSON.stringify({ nodes, edges });

  it("round-trips what Download JSON writes", () => {
    const d = parseDiagram(file(INITIAL_NODES, INITIAL_EDGES));
    expect(d.nodes).toHaveLength(INITIAL_NODES.length);
    expect(d.edges).toHaveLength(INITIAL_EDGES.length);
  });

  it("rejects bad files with a readable message", () => {
    expect(() => parseDiagram("nope")).toThrow(/not valid JSON/);
    expect(() => parseDiagram("{}")).toThrow(/nodes and edges/);
    expect(() => parseDiagram(file([{ id: "a", type: "box" }], []))).toThrow(/missing an id, position or type/);
    const a = { id: "a", type: "box", position: { x: 0, y: 0 } };
    expect(() => parseDiagram(file([a], [{ id: "e", source: "a", target: "ghost" }]))).toThrow(/not in the file/);
  });
});

describe("diagramSignature (Undo)", () => {
  it("changes on a move, rename or arrow label, but not on selection", () => {
    const base = diagramSignature(INITIAL_NODES, INITIAL_EDGES);
    const [first, ...rest] = INITIAL_NODES;
    const moved = [{ ...first, position: { x: first.position.x + 1, y: first.position.y } }, ...rest];
    const renamed = [{ ...first, data: { ...first.data, label: "x" } }, ...rest];
    const relabelled = [{ ...INITIAL_EDGES[0], label: "x" }, ...INITIAL_EDGES.slice(1)];
    expect(diagramSignature(moved, INITIAL_EDGES)).not.toBe(base);
    expect(diagramSignature(renamed, INITIAL_EDGES)).not.toBe(base);
    expect(diagramSignature(INITIAL_NODES, relabelled)).not.toBe(base);
    expect(diagramSignature([{ ...first, selected: true, dragging: true }, ...rest], INITIAL_EDGES)).toBe(base);
  });
});
