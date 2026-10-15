import { describe, expect, it } from "vitest";
import { INITIAL_EDGES, INITIAL_NODES } from "../digitalWorkerDiagram";

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
