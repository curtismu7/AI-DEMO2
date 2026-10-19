import { describe, it, expect } from "vitest";
import { GROUPS, GATEWAY_NODES, GATEWAY_EDGES, GATEWAY_STEPS, FORK_NODES, FORK_EDGES, FORK_STEPS } from "../privilegeFirstGatewayDiagram";

const figures = [
  ["gateway", GATEWAY_NODES, GATEWAY_EDGES, GATEWAY_STEPS],
  ["fork", FORK_NODES, FORK_EDGES, FORK_STEPS],
];

describe.each(figures)("privilege-first-gateway %s figure", (_name, NODES, EDGES, STEPS) => {
  it("every edge is covered by exactly one step with a request form and standards", () => {
    const covered = STEPS.flatMap((s) => s.edges).sort((a, b) => a - b);
    expect(covered).toEqual(EDGES.map((_, i) => i));
    STEPS.forEach((s) => {
      expect(s.detail.form).toBeTruthy();
      expect(s.detail.refs.length).toBeGreaterThan(0);
      s.detail.refs.forEach((r) => expect(["rfc", "spec", "emerging"]).toContain(r.kind));
    });
  });

  it("edges reference real nodes and nodes use declared groups", () => {
    const ids = new Set(NODES.map((n) => n.id));
    EDGES.forEach(([a, b]) => {
      expect(ids.has(a)).toBe(true);
      expect(ids.has(b)).toBe(true);
    });
    NODES.forEach((n) => expect(GROUPS[n.group]).toBeTruthy());
  });

  it("tokens are decoded MOCK claims and carry no real secrets", () => {
    const text = JSON.stringify(STEPS);
    expect(text).not.toMatch(/sk-[A-Za-z0-9]{8}|eyJ[A-Za-z0-9]{10}/);
    STEPS.forEach((s) => (s.detail.tokens || []).forEach((t) => expect(typeof t.claims).toBe("object")));
  });
});
