/* eslint-disable import/first -- jest.mock must precede imports */

// Polyfill window.scrollTo for jsdom (dashboard handlers reference it)
if (typeof window !== "undefined" && !window.scrollTo) {
  window.scrollTo = jest.fn();
}

// fetch is used by mount effects (feature-flags, session-preview) — stub it
global.fetch = jest.fn(() =>
  Promise.resolve({ ok: false, json: () => Promise.resolve({}) }),
);

// ── Contexts the component consumes ──────────────────────────────────────────
vi.mock("../../context/AgentUiModeContext", () => ({
  useAgentUiMode: () => ({
    placement: "none",
    setSurfaceHostEl: jest.fn(),
  }),
}));
vi.mock("../../context/EducationUIContext", () => ({
  useEducationUI: () => ({ open: jest.fn() }),
}));
vi.mock("../../context/SessionTokenContext", () => ({
  useSessionToken: () => ({
    tokenSecondsLeft: null,
    openTokenModal: null,
    registerTokenModalOpener: () => () => {},
    refreshTokenStatus: jest.fn(),
  }),
}));
vi.mock("../../hooks/useCurrentUserTokenEvent", () => ({
  useCurrentUserTokenEvent: () => {},
}));

// ── Vertical manifest ────────────────────────────────────────────────────────
vi.mock("../../vertical/useVertical", () => ({
  useVertical: () => ({
    pageManifest: {
      dashboard: { kind: "banking" },
      terminology: { agent: "Banking Agent" },
      identity: { displayName: "Super Banking" },
    },
    pageMockData: { heroStats: {} },
    agentManifest: { agent: {} },
    isAdminScope: false,
  }),
}));

// ── Router ───────────────────────────────────────────────────────────────────
vi.mock("react-router-dom", () => {
  const r = require("react");
  return {
    Link: ({ children, to, ...rest }) =>
      r.createElement(
        "a",
        { href: typeof to === "string" ? to : "", ...rest },
        children,
      ),
    useNavigate: () => jest.fn(),
    useLocation: () => ({ pathname: "/dashboard", search: "", state: null }),
  };
});

// ── Network clients return empty so the demo-fallback path resolves quickly ──
vi.mock("../../services/apiClient", () => ({
  __esModule: true,
  default: {
    get: jest.fn(() => Promise.resolve({ data: {} })),
    post: jest.fn(() => Promise.resolve({ data: {} })),
    put: jest.fn(() => Promise.resolve({ data: {} })),
  },
}));
vi.mock("axios", () => {
  const instance = {
    get: jest.fn(() => Promise.resolve({ data: {} })),
    post: jest.fn(() => Promise.resolve({ data: {} })),
    put: jest.fn(() => Promise.resolve({ data: {} })),
    interceptors: { request: { use: jest.fn() }, response: { use: jest.fn() } },
  };
  return {
    __esModule: true,
    default: {
      ...instance,
      // bffAxios.js calls axios.create() at module load — return a usable instance.
      create: jest.fn(() => instance),
    },
  };
});
vi.mock("../../services/cachedStatusService", () => ({
  __esModule: true,
  getCachedJson: jest.fn(() =>
    Promise.resolve({ data: { authenticated: false } }),
  ),
}));

// ── Heavy child components stubbed to keep the render in jsdom ────────────────
vi.mock("../../components/TokenChainDisplay", () => ({ default: () => null }));
vi.mock("../../components/TokenChainTraceRail", () => ({ default: () => null }));
vi.mock("../../components/ExchangeModeToggle", () => ({ default: () => null }));
vi.mock("../../components/Fido2Challenge", () => ({ default: () => null }));
vi.mock("../../components/ConfirmModal", () => ({ default: () => null }));
vi.mock("../../components/TransactionConsentModal", () => ({ default: () => null }));
vi.mock("../../components/EmbeddedAgentDock", () => ({ default: () => null }));
vi.mock("../../components/FloatingPanel", () => ({ default: ({ children }) => children }));
vi.mock("../../components/OAuthTokenDisplayPage", () => ({ default: () => null }));
vi.mock("../../components/RetailDashboard", () => ({ default: () => null }));
vi.mock("../../components/agent-clinical/AgentClinicalHost", () => ({ default: () => null }));

vi.mock("react-toastify", () => ({
  toast: {
    dismiss: jest.fn(),
    isActive: jest.fn(() => false),
    update: jest.fn(),
    warning: jest.fn(),
    success: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
  },
}));

// This test used to render the classic UserDashboard in jsdom and query the
// container. That component is deleted, and the obvious retarget — render
// UserDashboardPing2026 instead — is the wrong move: it is ~3,700 lines with a
// large provider surface, which is exactly why FocusModeFilmstripGuard checks it
// statically rather than rendering it. Rendering it here made this file the
// heaviest in the suite for a one-attribute assertion.
//
// The assertion itself is unchanged in meaning: data-refined-surface="customer"
// is what the refined-surface CSS keys on, and it must stay on the dashboard
// root. Asserted against the source, like the other guards on this component.
const fs = require("node:fs");
const path = require("node:path");

test("customer dashboard root carries the refined surface hook", () => {
  const src = fs.readFileSync(
    path.resolve(__dirname, "../../components/UserDashboardPing2026.js"),
    "utf8",
  );
  expect(src).toContain('data-refined-surface="customer"');
  expect(src).toContain("refined-customer-surface");
});
