/**
 * UserDashboardPing2026.frame.test.js — the Ping UI Standard frame of the customer dashboard (/dashboard).
 * Same hermetic mocks as UserDashboardPing2026.test.js (this file's header is a copy of it). Asserts the frame:
 * the banner is first and is a note, one h1, no second <main>, text chips, collapsed explainers, and that the one
 * primary (Send, in the shared agent) is styled from the fixed --btn-accent tokens.
 *
 * Original header:
 * UserDashboardPing2026.test.js — Smoke-test for the full customer dashboard.
 *
 * The component is a ~3000-line customer-dashboard implementation that uses
 * Router, several React contexts, and makes network calls on mount.  We mock
 * every external seam so the render is hermetic, then assert the one durable
 * structural fact: the top-level wrapper carries the `customer-skin-p1` class.
 */
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, waitFor, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { MemoryRouter } from "react-router-dom";
import UserDashboardPing2026 from "./UserDashboardPing2026";

// ── Context hooks ────────────────────────────────────────────────────────────

const agentMode = vi.hoisted(() => ({ placement: "middle" }));

vi.mock("../context/AgentUiModeContext", () => ({
  useAgentUiMode: () => ({
    placement: agentMode.placement,
    setSurfaceHostEl: vi.fn(),
    // The dashboard registers a toolbar host too; omitting this makes every
    // case in this file die on "setToolbarHostEl is not a function".
    setToolbarHostEl: vi.fn(),
  }),
}));

vi.mock("../context/SessionTokenContext", () => ({
  useSessionToken: () => ({
    registerTokenModalOpener: vi.fn(() => vi.fn()),
    sessionToken: null,
    sessionTokenExpiry: null,
  }),
}));

vi.mock("../hooks/useCurrentUserTokenEvent", () => ({
  useCurrentUserTokenEvent: () => {},
}));

// ── Network ──────────────────────────────────────────────────────────────────

vi.mock("../services/apiClient", () => ({
  default: {
    get: vi.fn().mockResolvedValue({ data: [] }),
    post: vi.fn().mockResolvedValue({ data: {} }),
  },
}));

vi.mock("axios", () => ({
  default: {
    get: vi.fn().mockResolvedValue({ data: [] }),
    post: vi.fn().mockResolvedValue({ data: {} }),
    create: vi.fn(() => ({
      get: vi.fn().mockResolvedValue({ data: [] }),
      post: vi.fn().mockResolvedValue({ data: {} }),
      interceptors: { request: { use: vi.fn() }, response: { use: vi.fn() } },
    })),
  },
}));

// Stub out fetch so feature-flag useEffects don't throw
global.fetch = vi.fn().mockResolvedValue({
  ok: false,
  json: () => Promise.resolve(null),
});

// ── Service layer ────────────────────────────────────────────────────────────

vi.mock("../services/cachedStatusService", () => ({
  getCachedJson: vi.fn().mockResolvedValue(null),
}));

// ── Utility / toast ──────────────────────────────────────────────────────────

vi.mock("../utils/appToast", () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), warn: vi.fn(), dismiss: vi.fn() },
  notifyError: vi.fn(),
  notifyInfo: vi.fn(),
  notifySuccess: vi.fn(),
  notifyWarning: vi.fn(),
}));

vi.mock("../utils/authUi", () => ({
  navigateToCustomerOAuthLogin: vi.fn(),
  SESSION_REAUTH_EVENT: "session-reauth",
}));

vi.mock("../utils/dashboardLayout", () => ({
  getDashboardLayout: vi.fn(() => "split2"),
  setDashboardLayout: vi.fn(),
  splitGridClass: vi.fn(() => "split-grid-2"),
}));

vi.mock("../utils/dashboardToast", () => ({
  toastCustomerError: vi.fn(),
}));

// ── CSS imports ──────────────────────────────────────────────────────────────

vi.mock("./UserDashboard.css", () => ({}), { virtual: true });
vi.mock("./customerSkinPing2026.css", () => ({}), { virtual: true });

// ── Heavy child components → lightweight stubs ───────────────────────────────

vi.mock("./ExchangeModeToggle", () => ({ default: () => null }));
vi.mock("./Fido2Challenge", () => ({ default: () => null }));
vi.mock("./TokenChainTraceRail", () => ({ default: () => null }));
// Filmstrip renders by default (movie reel default ON) and imports named
// helpers from the mocked TokenChainTraceRail — stub it like the other
// heavy children so the default-mocked rail can't crash the mount.
vi.mock("./TokenChainFilmstrip", () => ({ default: () => null }));
vi.mock("./ConfirmModal", () => ({ default: () => null }));
vi.mock("./TransactionConsentModal", () => ({ default: () => null }));
vi.mock("./EmbeddedAgentDock", () => ({ default: () => null }));
vi.mock("./WebMcpPanel", () => ({ default: () => null }));
vi.mock("./FloatingPanel", () => ({ default: () => null }));
vi.mock("./OAuthTokenDisplayPage", () => ({ default: () => null }));
vi.mock("./RetailDashboard", () => ({ default: () => null }));
vi.mock("./agent-clinical/AgentClinicalHost", () => ({ default: () => null }));
vi.mock("./AgentIdentityCard", () => ({ default: () => null }));
vi.mock("./SequenceReelDiagram", () => ({ default: () => <div className="srd-empty">Run an agent request to populate the sequence diagram.</div> }));
vi.mock("./DelegatedAccessPanel", () => ({ default: () => null }));
vi.mock("./SignInBrand", () => ({ default: () => null }));


const mockUser = {
  id: "test-user",
  email: "test@example.com",
  given_name: "Test",
  family_name: "User",
  role: "customer",
};

function renderPage(user = mockUser) {
  return render(
    <MemoryRouter>
      <UserDashboardPing2026 user={user} onLogout={vi.fn()} />
    </MemoryRouter>,
  );
}

async function renderedRoot(user) {
  const { container } = renderPage(user);
  await waitFor(() => expect(container.querySelector(".udp-page")).not.toBeNull());
  return container.querySelector(".udp-page");
}

describe("UserDashboardPing2026 (Ping UI Standard frame)", () => {
  it("renders without crashing, also for a guest", async () => {
    await renderedRoot(mockUser);
    expect(() => renderPage(null)).not.toThrow();
  });

  it("puts the mode banner first, as a note, with wording from the mode in use", async () => {
    const root = await renderedRoot(mockUser);
    const banner = root.firstElementChild;
    expect(banner.querySelector('[role="note"]')).not.toBeNull();
    const note = within(root).getByTestId("dashboard-mode-banner");
    expect(root.firstElementChild.contains(note)).toBe(true);
    // Never hardcoded as live or real: it says what the page can know (session + account source) and what it cannot.
    expect(note.textContent).toMatch(/agent engine in use/i);
    expect(note.textContent).not.toMatch(/\b(live|real)\b/i);
  });

  it("has exactly one h1 and no <main> of its own", async () => {
    const root = await renderedRoot(mockUser);
    expect(root.querySelectorAll("h1")).toHaveLength(1);
    expect(root.querySelector("h1").textContent).toBe("Customer dashboard");
    expect(root.querySelectorAll("main")).toHaveLength(0);
  });

  it("labels the assistant card with a text chip and an h2", async () => {
    const root = await renderedRoot(mockUser);
    const section = root.querySelector('[data-testid="dashboard-agent-column"]');
    expect(section.getAttribute("aria-labelledby")).toBe("udp-chat-h");
    expect(within(section).getByRole("heading", { level: 2, name: "Banking assistant" })).toBeTruthy();
    expect(within(section).getByText(/^(Ready|Starting|Guest: sign in to act)$/)).toBeTruthy();
  });

  it("keeps the CIBA and Client ID Metadata Document explainers collapsed, as cards with an Explainer chip", async () => {
    const root = await renderedRoot(mockUser);
    const details = root.querySelectorAll(".udp-explainer details");
    expect(details).toHaveLength(2);
    details.forEach((d) => expect(d.hasAttribute("open")).toBe(false));
    expect(within(root).getAllByText("Explainer")).toHaveLength(2);
    const ids = ["udp-ciba-h", "udp-cimd-h"];
    ids.forEach((id) => expect(root.querySelector(`section[aria-labelledby="${id}"] h2#${id}`)).not.toBeNull());
  });

  it("renders no primary button of its own: the explainer actions are secondaries", async () => {
    const root = await renderedRoot(mockUser);
    expect(root.querySelectorAll(".pu-btn--primary")).toHaveLength(0);
    const actions = root.querySelectorAll(".udp-explainer .pu-btn");
    expect(actions).toHaveLength(2);
  });

  it("styles the one primary (Send) from the fixed Ping Red tokens, never the vertical", () => {
    const css = readFileSync(resolve(process.cwd(), "src/components/UserDashboardPing2026.pingUi.css"), "utf8");
    const rule = css.match(/\.udp-page \.ba-send-btn \{[^}]*\}/)?.[0] ?? "";
    expect(rule).toContain("var(--btn-accent-gradient)");
    expect(rule).toContain("var(--btn-accent-text)");
    expect(rule).not.toMatch(/--pu-accent|--app-primary|#[0-9a-f]{3,8}\b/i);
    // every selector in the sheet is scoped to the page root, so nothing reaches other pages
    const selectors = css.replace(/\/\*[\s\S]*?\*\//g, "").match(/[^{}@]+(?=\{)/g) ?? [];
    selectors
      .flatMap((s) => s.split(","))
      .map((s) => s.trim())
      .filter((s) => s && !/^\d+%$|^(from|to)$|^media\b/.test(s))
      .forEach((s) => expect(s).toContain(".udp-page"));
  });
  it.each(["middle", "none"])(
    "keeps the frame in %s placement: banner first, one h1, one Send primary, no <main> of its own",
    async (placement) => {
      agentMode.placement = placement;
      try {
        const root = await renderedRoot(mockUser);
        expect(root.firstElementChild.querySelector('[role="note"]')).not.toBeNull();
        expect(root.querySelectorAll("h1")).toHaveLength(1);
        expect(root.querySelectorAll("main")).toHaveLength(0);
        // the dashboard adds no primary button of its own; Send (shared agent, styled in the page sheet) is the one
        expect(root.querySelectorAll(".pu-btn--primary")).toHaveLength(0);
        // the layout hooks the real route relies on are still there
        expect(root.classList.contains("customer-skin-p1")).toBe(true);
        expect(root.classList.contains("user-dashboard--split3")).toBe(placement === "middle");
        expect(root.querySelector("#main-dashboard-content")).not.toBeNull();
      } finally {
        agentMode.placement = "middle";
      }
    },
  );
});
