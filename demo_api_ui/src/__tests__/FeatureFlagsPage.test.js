/**
 * @file FeatureFlagsPage.test.js
 * Unit tests for the FeatureFlagsPage component.
 *
 * Covers:
 *   - Loading state while fetch is pending
 *   - Error state with dismiss button
 *   - Loaded state: page title, category sections, flag names, enabled/disabled counts
 *   - Refresh button re-fetches
 *   - Flag toggle: optimistic update → server confirm via PATCH
 *   - Toggle rollback + error banner when PATCH fails
 *   - lastSaved toast appears after successful toggle
 *   - lastSaved toast auto-dismisses after 2.5 s
 */

import React from "react";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from "@testing-library/react";
import "@testing-library/jest-dom";

import FeatureFlagsPage from "../components/FeatureFlagsPage";

vi.mock("../styles/appShellPages.css", () => ({}), { virtual: true });
vi.mock("../components/FeatureFlagsPage.css", () => ({}), { virtual: true });

// ── Fixtures ──────────────────────────────────────────────────────────────────

const MOCK_FLAGS = [
  {
    id: "ff_hitl_enabled",
    name: "HITL Consent",
    value: true,
    description: "Enable human-in-the-loop consent flow",
    category: "Security",
  },
  {
    id: "ff_authorize_real",
    name: "Real PingOne Authorize",
    value: false,
    description: "Use real PingOne Authorize",
    category: "Security",
  },
];

const MOCK_RESPONSE = { flags: MOCK_FLAGS, categories: ["Security"] };

function mockFetchSuccess(body = MOCK_RESPONSE) {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => body,
  });
}

function mockFetchError(status = 500, error = "server_error") {
  global.fetch = jest.fn().mockResolvedValue({
    ok: false,
    status,
    json: async () => ({ error }),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
});

// ── Loading state ─────────────────────────────────────────────────────────────

describe("FeatureFlagsPage — loading state", () => {
  it("shows loading indicator while fetch is pending", () => {
    global.fetch = jest.fn(() => new Promise(() => {}));
    render(<FeatureFlagsPage />);
    expect(screen.getByText(/loading feature flags/i)).toBeInTheDocument();
  });
});

// ── Error state ───────────────────────────────────────────────────────────────

describe("FeatureFlagsPage — error state", () => {
  it("shows error banner when fetch returns non-OK", async () => {
    mockFetchError();
    render(<FeatureFlagsPage />);
    await screen.findByRole("alert");
    expect(screen.getByRole("alert")).toHaveTextContent("server_error");
  });

  it("dismiss button hides the error banner", async () => {
    mockFetchError();
    render(<FeatureFlagsPage />);
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: /✕/ }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

// ── Loaded state ──────────────────────────────────────────────────────────────

describe("FeatureFlagsPage — loaded state", () => {
  beforeEach(() => mockFetchSuccess());

  it("renders the page title", async () => {
    render(<FeatureFlagsPage />);
    await screen.findByText("Feature Flags");
  });

  it("renders category sections", async () => {
    render(<FeatureFlagsPage />);
    await screen.findByText("Security");
    expect(screen.getByText("Security")).toBeInTheDocument();
  });

  it("renders flag names", async () => {
    render(<FeatureFlagsPage />);
    await screen.findByText("HITL Consent");
    expect(screen.getByText("HITL Consent")).toBeInTheDocument();
    expect(screen.getByText("Real PingOne Authorize")).toBeInTheDocument();
  });

  it("shows correct enabled/disabled counts", async () => {
    render(<FeatureFlagsPage />);
    await screen.findByText("1 enabled");
    expect(screen.getByText("1 enabled")).toBeInTheDocument();
    expect(screen.getByText("1 disabled")).toBeInTheDocument();
  });

  it("Refresh button re-issues the fetch", async () => {
    render(<FeatureFlagsPage />);
    // "HITL Consent" only appears after loading; ensures button is enabled
    await screen.findByText("HITL Consent");
    const callsBefore = global.fetch.mock.calls.length;

    fireEvent.click(screen.getByTitle(/refresh flags from server/i));

    await waitFor(() =>
      expect(global.fetch.mock.calls.length).toBeGreaterThan(callsBefore),
    );
  });
});

// ── Toggle: optimistic update + confirm ───────────────────────────────────────

describe("FeatureFlagsPage — flag toggle", () => {
  it("sends PATCH with correct body when toggled", async () => {
    const confirmedFlags = MOCK_FLAGS.map((f) =>
      f.id === "ff_authorize_real" ? { ...f, value: true } : f,
    );
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ apiKeySet: false, tenantNameSet: false, tenantName: null }) })
      .mockResolvedValueOnce({ ok: true, json: async () => MOCK_RESPONSE })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ flags: confirmedFlags }),
      });

    render(<FeatureFlagsPage />);
    await screen.findByText("Real PingOne Authorize");

    fireEvent.click(
      screen.getByRole("button", { name: /enable real pingone authorize/i }),
    );

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(3));

    const [patchUrl, patchInit] = global.fetch.mock.calls[2];
    expect(patchInit.method).toBe("PATCH");
    expect(JSON.parse(patchInit.body)).toEqual({
      updates: { ff_authorize_real: true },
    });
    void patchUrl; // path tested by method alone
  });

  it("rolls back flag and shows error when PATCH fails", async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ apiKeySet: false, tenantNameSet: false, tenantName: null }) })
      .mockResolvedValueOnce({ ok: true, json: async () => MOCK_RESPONSE })
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({ error: "save_error" }),
      });

    render(<FeatureFlagsPage />);
    await screen.findByText("Real PingOne Authorize");

    fireEvent.click(
      screen.getByRole("button", { name: /enable real pingone authorize/i }),
    );

    // After rollback the flag reverts to false → button label returns to "Enable"
    await screen.findByRole("alert");
    expect(screen.getByRole("alert")).toHaveTextContent(
      "ff_authorize_real",
    );
    expect(
      screen.getByRole("button", { name: /enable real pingone authorize/i }),
    ).toBeInTheDocument();
  });

  it("shows lastSaved toast after successful toggle", async () => {
    const confirmedFlags = MOCK_FLAGS.map((f) =>
      f.id === "ff_authorize_real" ? { ...f, value: true } : f,
    );
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ apiKeySet: false, tenantNameSet: false, tenantName: null }) })
      .mockResolvedValueOnce({ ok: true, json: async () => MOCK_RESPONSE })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ flags: confirmedFlags }),
      });

    render(<FeatureFlagsPage />);
    await screen.findByText("Real PingOne Authorize");

    fireEvent.click(
      screen.getByRole("button", { name: /enable real pingone authorize/i }),
    );

    await screen.findByText(/ff_authorize_real/);
    expect(screen.getAllByText(/ff_authorize_real/).length).toBeGreaterThan(0);
  });

  it("auto-dismisses lastSaved toast after 2.5 s", async () => {
    jest.useFakeTimers();
    const confirmedFlags = MOCK_FLAGS.map((f) =>
      f.id === "ff_authorize_real" ? { ...f, value: true } : f,
    );
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ apiKeySet: false, tenantNameSet: false, tenantName: null }) })
      .mockResolvedValueOnce({ ok: true, json: async () => MOCK_RESPONSE })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ flags: confirmedFlags }),
      });

    render(<FeatureFlagsPage />);

    // MutationObserver still works with fake timers — waitFor resolves via DOM mutations
    await screen.findByText("Real PingOne Authorize");

    fireEvent.click(
      screen.getByRole("button", { name: /enable real pingone authorize/i }),
    );

    await screen.findByText(/ff_authorize_real/);

    // Fire the 2500ms auto-dismiss timer
    act(() => {
      jest.advanceTimersByTime(2600);
    });

    expect(screen.queryByText(/saved/)).not.toBeInTheDocument();

    jest.useRealTimers();
  });
});
