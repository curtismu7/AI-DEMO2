import React from "react";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import CimdPrivilegePage from "../CimdPrivilegePage";
import {
  CAP_EDGES,
  CAP_GROUPS,
  CAP_NODES,
  CAP_STEPS,
  FLOW_EDGES,
  FLOW_GROUPS,
  FLOW_NODES,
  FLOW_STEPS,
  STATUS,
} from "../cimdPrivilegeData";

// @xyflow/react needs ResizeObserver in jsdom (same stub the other diagram page tests use).
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
window.ResizeObserver = window.ResizeObserver || ResizeObserverStub;

const FIGURES = {
  flow: { nodes: FLOW_NODES, edges: FLOW_EDGES, groups: FLOW_GROUPS, steps: FLOW_STEPS },
  capabilities: { nodes: CAP_NODES, edges: CAP_EDGES, groups: CAP_GROUPS, steps: CAP_STEPS },
};

describe("CIMD in Privilege data", () => {
  it.each(Object.entries(FIGURES))("%s: every arrow resolves to a node and belongs to exactly one step", (_k, f) => {
    const ids = new Set(f.nodes.map((n) => n.id));
    expect(ids.size).toBe(f.nodes.length);
    for (const [src, tgt] of f.edges) {
      expect(ids.has(src)).toBe(true);
      expect(ids.has(tgt)).toBe(true);
    }
    const covered = f.steps.flatMap((s) => s.edges).sort((a, b) => a - b);
    expect(covered).toEqual(f.edges.map((_e, i) => i));
    for (const n of f.nodes) expect(f.groups[n.group], n.id).toBeTruthy();
  });

  it.each(Object.entries(FIGURES))("%s: every step has an honest status and the evidence to back it", (_k, f) => {
    for (const s of f.steps) {
      for (const field of ["title", "what", "why", "evidence"]) expect(s[field], `${s.key}.${field}`).toBeTruthy();
      expect(Object.keys(STATUS)).toContain(s.status);
    }
  });

  it("the page mixes observed and expected steps, so it cannot read as all proven or all hypothetical", () => {
    // No sign-in with a document URL has completed yet, so an all-observed page would overclaim.
    const observed = [...FLOW_STEPS, ...CAP_STEPS].filter((s) => s.status === "observed");
    const expected = [...FLOW_STEPS, ...CAP_STEPS].filter((s) => s.status === "expected");
    expect(observed.length).toBeGreaterThan(0);
    expect(expected.length).toBeGreaterThan(0);
  });
});

describe("CimdPrivilegePage", () => {
  it("renders both figures with one card per step", () => {
    render(<CimdPrivilegePage />);
    expect(screen.getByTestId("cimd-privilege-page")).toBeTruthy();
    for (const [id, f] of Object.entries(FIGURES)) {
      const section = screen.getByTestId(`cimd-${id}`);
      expect(within(section).getByTestId(`cimd-diagram-${id}`)).toBeTruthy();
      expect(within(section).getByTestId(`cimd-steps-${id}`)).toBeTruthy();
      for (let i = 1; i <= f.steps.length; i += 1) {
        expect(within(section).getByTestId(`cimd-${id}-step-${i}`)).toBeTruthy();
      }
    }
  });

  it("labels each card Observed or Expected", () => {
    render(<CimdPrivilegePage />);
    const first = screen.getByTestId("cimd-flow-step-1");
    expect(within(first).getByText(STATUS[FLOW_STEPS[0].status])).toBeTruthy();
    const second = screen.getByTestId("cimd-flow-step-2");
    expect(within(second).getByText(STATUS[FLOW_STEPS[1].status])).toBeTruthy();
  });
});
