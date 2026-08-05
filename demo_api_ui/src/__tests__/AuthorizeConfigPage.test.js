/**
 * @file AuthorizeConfigPage.test.js
 * Unit tests for the AuthorizeConfigPage component.
 *
 * Covers:
 *   - Shows loading state while fetching
 *   - Shows error state with Retry button when fetch fails
 *   - Retry button re-fetches config
 *   - Renders the page title and all five tabs after successful load
 *   - Clicking a tab switches to that tab's panel
 *   - StatusBadge reflects activeEngine from API response
 *   - Refresh button re-fetches config
 */

import "@testing-library/jest-dom";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import AuthorizeConfigPage from "../components/AuthorizeConfigPage";

// ── Stub out the CSS import ───────────────────────────────────────────────────
vi.mock("../components/AuthorizeConfigPage.css", () => ({}), {
  virtual: true,
});

// ── Minimal config API response ───────────────────────────────────────────────
const MOCK_CONFIG = {
  status: { activeEngine: "simulated" },
  simulated: {
    confirmAmount: 250,
    denyAmount: 2000,
    stepUpAmount: 500,
    mcpDenyTools: ["transfer"],
    mcpHitlTools: ["withdraw"],
  },
  pingone: {},
  mcp: {},
  scopes: {},
  env: {},
};

function mockFetchSuccess(body = MOCK_CONFIG) {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => body,
  });
}

function mockFetchError() {
  global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 500 });
}

beforeEach(() => {
  jest.clearAllMocks();
});

// ── Loading state ─────────────────────────────────────────────────────────────

describe("AuthorizeConfigPage — loading state", () => {
  it("shows loading indicator while fetch is pending", async () => {
    // Keep the fetch promise unresolved for this test
    global.fetch = jest.fn(() => new Promise(() => {}));
    render(<AuthorizeConfigPage />);
    expect(screen.getByText(/loading authorize config/i)).toBeInTheDocument();
  });
});

// ── Error state ───────────────────────────────────────────────────────────────

describe("AuthorizeConfigPage — error state", () => {
  it("shows error message when fetch returns non-OK", async () => {
    mockFetchError();
    render(<AuthorizeConfigPage />);
    expect(await screen.findByText(/error/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });

  it("Retry button re-issues the fetch", async () => {
    // Component makes an extra prefetch (MCP tools) before the config fetch.
    // (1) MCP tools prefetch → error (swallowed internally)
    // (2) Config fetch → error → shows Retry button
    // (3) Retry → success → shows page title
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 500 })
      .mockResolvedValueOnce({ ok: false, status: 500 })
      .mockResolvedValueOnce({ ok: true, json: async () => MOCK_CONFIG });

    render(<AuthorizeConfigPage />);
    await screen.findByRole("button", { name: /retry/i });

    fireEvent.click(screen.getByRole("button", { name: /retry/i }));

    expect(
      await screen.findByText("Authorize Configuration"),
    ).toBeInTheDocument();
    expect(global.fetch).toHaveBeenCalledTimes(3);
  });
});

// ── Successful load ───────────────────────────────────────────────────────────

describe("AuthorizeConfigPage — loaded state", () => {
  beforeEach(() => mockFetchSuccess());

  it("renders the page title after successful load", async () => {
    render(<AuthorizeConfigPage />);
    expect(
      await screen.findByText("Authorize Configuration"),
    ).toBeInTheDocument();
  });

  it("renders all five tabs", async () => {
    render(<AuthorizeConfigPage />);
    await screen.findByText("Authorize Configuration");
    expect(
      screen.getByRole("button", { name: /mock rules/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /pingone authorize/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /mcp tool gate/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /scopes/i })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /env vars/i }),
    ).toBeInTheDocument();
  });

  it("shows Simulated Authorize Rules panel by default (Mock tab active)", async () => {
    render(<AuthorizeConfigPage />);
    await screen.findByText("Authorize Configuration");
    expect(screen.getByText(/simulated authorize rules/i)).toBeInTheDocument();
    expect(screen.getByText(/ff_authorize_real=false/i)).toBeInTheDocument();
  });

  it("clicking PingOne Authorize tab switches to that panel", async () => {
    render(<AuthorizeConfigPage />);
    await screen.findByText("Authorize Configuration");
    fireEvent.click(screen.getByRole("button", { name: /pingone authorize/i }));
    expect(
      screen.queryByText(/simulated authorize rules/i),
    ).not.toBeInTheDocument();
  });

  it("StatusBadge reflects the activeEngine from the API", async () => {
    render(<AuthorizeConfigPage />);
    await screen.findByText("Authorize Configuration");
    // MOCK_CONFIG has activeEngine: 'simulated' → StatusBadge shows "Simulated (Mock)"
    expect(screen.getByText("Simulated (Mock)")).toBeInTheDocument();
  });

  it('StatusBadge shows "PingOne Authorize" for pingone engine', async () => {
    mockFetchSuccess({ ...MOCK_CONFIG, status: { activeEngine: "pingone" } });
    render(<AuthorizeConfigPage />);
    // Both the badge span and the tab button contain this text; target the badge specifically
    await screen.findByText("PingOne Authorize", { selector: ".azc-badge" });
  });

  it('StatusBadge shows "Authorization Off" for off engine', async () => {
    mockFetchSuccess({ ...MOCK_CONFIG, status: { activeEngine: "off" } });
    render(<AuthorizeConfigPage />);
    await screen.findByText("Authorization Off");
  });

  it("Refresh button re-issues the fetch", async () => {
    render(<AuthorizeConfigPage />);
    await screen.findByText("Authorize Configuration");
    const callsBefore = global.fetch.mock.calls.length;

    fireEvent.click(screen.getByRole("button", { name: /refresh/i }));

    await waitFor(() =>
      expect(global.fetch.mock.calls.length).toBeGreaterThan(callsBefore),
    );
  });
});
