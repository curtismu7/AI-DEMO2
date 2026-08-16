// banking_api_ui/src/components/__tests__/SessionExpiryTimer.educationalPaths.test.js
//
// Regression guard for the 2026-05-12 fix: SessionExpiryTimer's mount-time
// fetch (for /api/tokens/session-preview and /api/auth/oauth/user/status)
// must NOT fire on documentation-only pages. Those pages can be viewed
// without a session, and the status endpoint returns 401 to anon callers,
// producing console noise.
//
// Sibling test: useAgentCCTokenPrefetch.test.js covers the same rule for
// the agent-cc-preview prefetch hook.
//
// See banking_api_ui/src/utils/educationalPages.js for the path list.

import React from "react";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import bffAxios from "../../services/bffAxios";
import SessionExpiryTimer from "../SessionExpiryTimer";

vi.mock("../../services/bffAxios", () => ({
  __esModule: true,
  default: {
    get: jest.fn(() => Promise.resolve({ data: { tokenEvents: [] } })),
    post: jest.fn(() => Promise.resolve({ data: {} })),
  },
}));

describe("SessionExpiryTimer — educational path silence", () => {
  beforeEach(() => {
    bffAxios.get.mockClear();
    bffAxios.post.mockClear();
  });

  it.each([
    "/sequence-diagram",
    "/architecture",
    "/architecture/system",
    "/architecture/flow",
    "/architecture/token-flow",
    "/architecture/overview",
  ])("does NOT call BFF auth endpoints when mounted on %s", (path) => {
    render(
      <MemoryRouter initialEntries={[path]}>
        <SessionExpiryTimer />
      </MemoryRouter>,
    );

    const calledPaths = bffAxios.get.mock.calls.map((args) => args[0]);
    expect(calledPaths).not.toContain("/api/tokens/session-preview");
    expect(calledPaths).not.toContain("/api/auth/oauth/user/status");
  });

  it.each([
    "/dashboard",
    "/admin",
    "/agent",
  ])("DOES call /api/tokens/session-preview when mounted on %s", (path) => {
    render(
      <MemoryRouter initialEntries={[path]}>
        <SessionExpiryTimer />
      </MemoryRouter>,
    );

    const calledPaths = bffAxios.get.mock.calls.map((args) => args[0]);
    expect(calledPaths).toContain("/api/tokens/session-preview");
  });

  it.each([
    "/",
    "/setup",
    "/logout",
  ])("does NOT call BFF auth endpoints on hidden path %s", (path) => {
    render(
      <MemoryRouter initialEntries={[path]}>
        <SessionExpiryTimer />
      </MemoryRouter>,
    );

    const calledPaths = bffAxios.get.mock.calls.map((args) => args[0]);
    expect(calledPaths).not.toContain("/api/tokens/session-preview");
    expect(calledPaths).not.toContain("/api/auth/oauth/user/status");
  });
});
