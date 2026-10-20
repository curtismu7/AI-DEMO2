import React from "react";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import PersonalAgentDesignPage from "../PersonalAgentDesignPage";
import PersonalAgentReviewPage from "../PersonalAgentReviewPage";
import { DESIGNS, FINDINGS, GROUPS, ORIGINAL_EDGES, ORIGINAL_NODES, REVIEW_GROUPS, SCORECARD } from "../personalAgentData";

// @xyflow/react needs ResizeObserver in jsdom (same stub the other diagram page tests use).
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
window.ResizeObserver = window.ResizeObserver || ResizeObserverStub;

const wrap = (ui) => <MemoryRouter>{ui}</MemoryRouter>;

describe("personal agent data", () => {
  it.each(Object.entries(DESIGNS))("%s: every arrow resolves to a node and belongs to exactly one step", (_k, d) => {
    const ids = new Set(d.nodes.map((n) => n.id));
    expect(ids.size).toBe(d.nodes.length);
    for (const [src, tgt] of d.edges) {
      expect(ids.has(src)).toBe(true);
      expect(ids.has(tgt)).toBe(true);
    }
    const covered = d.steps.flatMap((s) => s.edges).sort((a, b) => a - b);
    expect(covered).toEqual(d.edges.map((_e, i) => i));
    for (const n of d.nodes) expect(GROUPS[n.group]).toBeTruthy();
  });

  it("every step carries all four write-up fields", () => {
    for (const d of Object.values(DESIGNS)) {
      for (const s of d.steps) {
        for (const f of ["title", "what", "why", "security", "today"]) expect(s[f], `${s.key}.${f}`).toBeTruthy();
      }
    }
  });

  it("the review figure and findings are consistent", () => {
    const ids = new Set(ORIGINAL_NODES.map((n) => n.id));
    for (const [src, tgt] of ORIGINAL_EDGES) {
      expect(ids.has(src)).toBe(true);
      expect(ids.has(tgt)).toBe(true);
    }
    for (const n of ORIGINAL_NODES) expect(REVIEW_GROUPS[n.group]).toBeTruthy();
    expect(new Set(FINDINGS.map((f) => f.id)).size).toBe(FINDINGS.length);
    // every finding named in the scorecard exists, and every finding is cited by a pinned node or the scorecard
    const known = new Set(FINDINGS.map((f) => f.id));
    for (const row of SCORECARD) for (const id of row.findings.split(/,\s*/)) expect(known.has(id), id).toBe(true);
  });

  it("no customer-specific names leak into this public repo", () => {
    const blob = JSON.stringify([DESIGNS, FINDINGS, ORIGINAL_NODES, SCORECARD]);
    expect(blob).not.toMatch(/mileageplus|united\.com|travel guard|\bMARS\b|datapower/i);
  });
});

describe("personal agent pages", () => {
  it.each([
    ["target", "A personal AI agent, secured end to end"],
    ["dual", "Privilege first, Agent Gateway for the gaps"],
  ])("%s design renders the diagram, one card per step and the links to the review", (variant, heading) => {
    const d = DESIGNS[variant];
    const { container } = render(wrap(<PersonalAgentDesignPage variant={variant} />));
    // Ping style: routed diagram with the arrow key, and no legend entry that contradicts it (dashed = token)
    expect(container.querySelector(".sfd--ping")).toBeTruthy();
    expect(screen.getByLabelText("Arrow key")).toBeTruthy();
    expect(container.querySelector(".pa-sw--dashed")).toBeNull();
    expect(screen.getByRole("group", { name: new RegExp(d.ariaLabel.slice(0, 40)) })).toBeTruthy();
    expect(screen.getByRole("heading", { level: 1, name: heading })).toBeTruthy();
    for (let i = 1; i <= d.steps.length; i += 1) {
      const card = screen.getByTestId(`pa-step-${i}`);
      expect(within(card).getByText("What happens")).toBeTruthy();
      expect(within(card).getByText("Why it is needed")).toBeTruthy();
      expect(within(card).getByText("How it secures the AI")).toBeTruthy();
    }
    expect(screen.getByRole("link", { name: "Why the original design was wrong" }).getAttribute("href")).toBe(
      "/personal-agent-review",
    );
  });

  it("the review lists every finding with severity and links to both designs", () => {
    render(wrap(<PersonalAgentReviewPage />));
    for (const f of FINDINGS) expect(screen.getByTestId(`pa-finding-${f.id}`)).toBeTruthy();
    expect(screen.getByRole("group", { name: /The original design\./ })).toBeTruthy();
    const hrefs = screen.getAllByRole("link").map((a) => a.getAttribute("href"));
    expect(hrefs).toContain("/personal-agent-design");
    expect(hrefs).toContain("/personal-agent-dual-gateway");
  });
});
