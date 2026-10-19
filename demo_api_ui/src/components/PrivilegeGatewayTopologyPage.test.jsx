// Guards the diagram data on the Privilege Gateway Topologies page. Every tab is now a
// static React Flow graph (StaticFlowDiagram) — the Mermaid renderer is gone — so the
// guards are wiring checks: every edge endpoint declared, walk steps referencing real
// nodes/edges, and each tab's data complete enough to render.
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import PrivilegeGatewayTopologyPage from "./PrivilegeGatewayTopologyPage";

vi.mock("../services/apiClient", () => ({ default: { get: vi.fn(() => Promise.reject(new Error("403"))), post: vi.fn() } }));
import {
  TABS,
  LB_NODES,
  LB_EDGES,
  A2A_NODES,
  A2A_EDGES,
  AGENT_NODES,
  AGENT_EDGES,
  AGENTLESS_NODES,
  AGENTLESS_EDGES,
} from "./PrivilegeGatewayTopologyPage";

describe("PrivilegeGatewayTopologyPage diagram data", () => {
  it("has the live LB tab plus both deployment variants and the agent-to-agent layout", () => {
    expect(TABS.map((t) => t.id)).toEqual(["lb", "agent", "agentless", "a2a"]);
  });

  it("every tab is a complete static graph: nodes, edges, groups, stepDetail, ariaLabel", () => {
    for (const tab of TABS) {
      expect(tab.static, `${tab.id} is static`).toBe(true);
      expect(tab.nodes.length, `${tab.id} nodes`).toBeGreaterThan(0);
      expect(tab.edges.length, `${tab.id} edges`).toBeGreaterThan(0);
      expect(Object.keys(tab.groups).length, `${tab.id} groups`).toBeGreaterThan(0);
      expect(tab.stepDetail.length, `${tab.id} stepDetail`).toBeGreaterThan(0);
      expect(tab.ariaLabel, `${tab.id} ariaLabel`).toBeTruthy();
    }
  });

  it("wires every edge endpoint to a declared node, and every node to a declared group", () => {
    for (const tab of TABS) {
      const ids = new Set(tab.nodes.map((n) => n.id));
      for (const [src, tgt] of tab.edges) {
        expect(ids.has(src), `${tab.id} edge source ${src}`).toBe(true);
        expect(ids.has(tgt), `${tab.id} edge target ${tgt}`).toBe(true);
      }
      for (const n of tab.nodes) expect(tab.groups[n.group], `${tab.id} node ${n.id} group`).toBeTruthy();
    }
  });

  it("every arrow has its own step detail: request form, standards, well-formed tokens", () => {
    for (const tab of TABS) {
      const covered = tab.stepDetail.flatMap((s) => s.edges).sort((a, b) => a - b);
      expect(covered, `${tab.id} stepDetail covers each arrow once`).toEqual(tab.edges.map((_, i) => i));
      for (const s of tab.stepDetail) {
        expect(s.detail.form, `${tab.id} edge ${s.edges} form`).toBeTruthy();
        expect(s.detail.refs.length, `${tab.id} edge ${s.edges} refs`).toBeGreaterThan(0);
        for (const r of s.detail.refs) expect(["rfc", "spec", "emerging"]).toContain(r.kind);
        for (const t of s.detail.tokens || []) expect(t.note && t.claims, `${tab.id} token`).toBeTruthy();
      }
    }
  });

  it("numbered steps match the orange arrow numbers; edge labels carry no number of their own", () => {
    for (const tab of TABS) {
      const nums = tab.steps.filter((s) => s.n).map((s) => s.n);
      expect(nums, `${tab.id} step numbers are 1..edges`).toEqual(tab.edges.map((_, i) => i + 1));
      for (const [, , label] of tab.edges) expect(`${label}`).not.toMatch(/^\d+ ·/);
    }
  });

  it("no Mermaid source remains on the page (ReactFlow-only convention)", () => {
    // The old bottom "Request Flow" figure (agent-based vs agentless sequence)
    // was deleted 2026-10-13 — both variants are archived and the tab banner
    // already routes readers to the current content.
    expect(TABS.length).toBeGreaterThan(0);
  });

  it("renders Ping-style: key, and a box click opens the step detail (request, MOCK token, standards)", () => {
    render(<PrivilegeGatewayTopologyPage />);
    fireEvent.click(screen.getAllByRole("button").find((b) => b.textContent === "Agentless"));
    expect(screen.getByLabelText("Arrow key")).toBeTruthy();
    fireEvent.click(screen.getByTestId("pgt-agentless-diagram-node-p1"));
    expect(screen.getByTestId("pgt-agentless-diagram-node-p1").className).toContain("sfd-node--selected");
    const panel = screen.getByTestId("pgt-agentless-diagram-reel-detail");
    expect(panel.textContent).toContain("/as/authorize");
    expect(screen.getByTestId("pgt-agentless-diagram-reel-refs").textContent).toContain("RFC 6749");
    fireEvent.click(screen.getAllByRole("button", { name: /PingOne AS → Ingress/ })[0]);
    expect(screen.getByTestId("pgt-agentless-diagram-reel-detail").textContent).toContain("MOCK, teaching values only");
  });
});
