// banking_api_ui/src/components/__tests__/ArchitectureTabsPanel.anon.test.js
//
// Regression guard for the 2026-05-12 fix: the Architecture menu group
// (System Architecture, Overview Diagram, Token Flow Diagram, Interactive
// Flow, Phase 266 — 3 Paths, Sequence Diagram) must not produce any 401/403
// console noise for anonymous visitors. ArchitectureTabsPanel mounts at
// /architecture/system and previously fired bffAxios.get('/api/admin/diagrams/list')
// unconditionally on mount; that route is admin-gated and returns 401/403 to
// anon callers. The fix gates the call behind user?.role === 'admin'.

import React from "react";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import bffAxios from "../../services/bffAxios";
import ArchitectureTabsPanel from "../ArchitectureTabsPanel";

vi.mock("../../services/bffAxios", () => ({
  __esModule: true,
  default: {
    get: jest.fn(() => Promise.resolve({ data: { diagrams: [] } })),
    post: jest.fn(() => Promise.resolve({ data: {} })),
  },
}));

// ArchitectureTabsPanel pulls in heavy diagram children that aren't part of
// what we're testing. Stub them so the test renders without crashing.
vi.mock("../TokenExchangeFlowDiagram", () => ({ default: () => null }));
vi.mock("../education/InteractiveArchDiagram", () => ({ default: () => null }));
vi.mock("../NarrativePanel", () => ({ default: () => null }));

vi.mock("../../context/ExchangeModeContext", () => ({
  useExchangeMode: () => ({ mode: "1-exchange", setMode: jest.fn() }),
}));

describe("ArchitectureTabsPanel — anon gating of /api/admin/diagrams/list", () => {
  beforeEach(() => {
    bffAxios.get.mockClear();
    bffAxios.post.mockClear();
  });

  it("does NOT call /api/admin/diagrams/list when user is undefined (anon)", () => {
    render(
      <MemoryRouter initialEntries={["/architecture/system"]}>
        <ArchitectureTabsPanel />
      </MemoryRouter>,
    );
    const calledPaths = bffAxios.get.mock.calls.map((args) => args[0]);
    expect(calledPaths).not.toContain("/api/admin/diagrams/list");
  });

  it("does NOT call /api/admin/diagrams/list when user is non-admin", () => {
    render(
      <MemoryRouter initialEntries={["/architecture/system"]}>
        <ArchitectureTabsPanel user={{ role: "user" }} />
      </MemoryRouter>,
    );
    const calledPaths = bffAxios.get.mock.calls.map((args) => args[0]);
    expect(calledPaths).not.toContain("/api/admin/diagrams/list");
  });

  it("DOES call /api/admin/diagrams/list when user is admin", () => {
    render(
      <MemoryRouter initialEntries={["/architecture/system"]}>
        <ArchitectureTabsPanel user={{ role: "admin" }} />
      </MemoryRouter>,
    );
    const calledPaths = bffAxios.get.mock.calls.map((args) => args[0]);
    expect(calledPaths).toContain("/api/admin/diagrams/list");
  });
});
