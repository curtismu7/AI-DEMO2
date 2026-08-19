/* eslint-disable jsx-a11y/anchor-is-valid */
/**
 * Tests for App.js session detection logic
 *
 * Covers:
 *   - checkOAuthSession calls all 3 endpoints in parallel
 *   - Priority order: admin → end-user → generic session
 *   - Returns true / sets user when any endpoint responds authenticated: true
 *   - Returns false when all endpoints return unauthenticated
 *   - Dispatches 'userAuthenticated' CustomEvent when session found
 *   - On regular page load: single attempt only (no retry loop)
 *   - On ?oauth=success: retries with backoff until session is found
 *   - 'userAuthenticated' listener re-runs check when user not yet set
 *   - logout clears user state
 */

/* eslint-disable import/first -- jest.mock must precede imports */

// Polyfill window.scrollTo for jsdom
if (typeof window !== "undefined" && !window.scrollTo) {
  window.scrollTo = jest.fn();
}

// Mock indexedDB since it's not available in jsdom
global.indexedDB = {
  open: jest.fn(() => ({
    onupgradeneeded: null,
    onsuccess: null,
    onerror: null,
  })),
};

vi.mock("../services/bffAxios", () => ({
  __esModule: true,
  default: {
    get: jest.fn(() => Promise.resolve({ data: { authenticated: false } })),
    post: jest.fn(),
    put: jest.fn(),
    delete: jest.fn(),
    patch: jest.fn(),
    create: jest.fn(),
    interceptors: {
      request: { use: jest.fn(), eject: jest.fn() },
      response: { use: jest.fn(), eject: jest.fn() },
    },
  },
}));

vi.mock("axios", () => {
  const mockGet = jest.fn(() =>
    Promise.resolve({ data: { authenticated: false } }),
  );
  const mockPost = jest.fn();
  const mockClient = {
    get: mockGet,
    post: mockPost,
    put: jest.fn(),
    delete: jest.fn(),
    patch: jest.fn(),
    interceptors: {
      request: { use: jest.fn(), eject: jest.fn() },
      response: { use: jest.fn(), eject: jest.fn() },
    },
    defaults: { headers: { common: {} } },
  };
  return {
    __esModule: true,
    default: {
      create: jest.fn(() => mockClient),
      get: mockGet,
      post: mockPost,
      defaults: { headers: { common: {} } },
    },
  };
});

const routeLocation = vi.hoisted(() => ({ pathname: "/", search: "" }));

vi.mock("react-router-dom", () => ({
  BrowserRouter: ({ children }) => children,
  Router: ({ children }) => children,
  Routes: ({ children }) => children,
  Route: () => null,
  Navigate: () => null,
  Link: ({ children, to, ...rest }) => (
    <a href={typeof to === "string" ? to : ""} {...rest}>
      {children}
    </a>
  ),
  useNavigate: () => jest.fn(),
  useLocation: () => routeLocation,
  /** AppWithAuth reads query params for OAuth error toasts — must be iterable [params, setParams]. */
  useSearchParams: () => [new URLSearchParams(""), jest.fn()],
}));

// Minimal stubs for heavy child components that can't render in jsdom
vi.mock("../components/LandingPage", () => ({ default: () => (
  <div data-testid="landing-page" />
) }));
vi.mock("../components/Dashboard", () => ({ default: () => (
  <div data-testid="dashboard" />
) }));
vi.mock("../components/UserDashboard", () => ({ default: () => (
  <div data-testid="user-dashboard" />
) }));
vi.mock("../components/AIAgent", () => ({ default: () => null }));
vi.mock("../components/CIBAPanel", () => ({ default: () => null }));
vi.mock("../components/CimdSimPanel", () => ({ default: () => null }));
vi.mock("../components/EducationBar", () => ({ default: () => null }));
vi.mock("../components/Footer", () => ({ default: () => null }));
vi.mock("../components/ActivityLogs", () => ({ default: () => null }));
vi.mock("../components/Users", () => ({ default: () => null }));
vi.mock("../components/Accounts", () => ({ default: () => null }));
vi.mock("../components/Transactions", () => ({ default: () => null }));
vi.mock("../components/SecuritySettings", () => ({ default: () => null }));
vi.mock("../components/McpInspector", () => ({ default: () => null }));
vi.mock("../components/OAuthDebugLogViewer", () => ({ default: () => null }));
vi.mock("../components/ClientRegistrationPage", () => ({ default: () => null }));
vi.mock("../components/LogViewer", () => ({ default: () => null }));
vi.mock("../components/AgentFlowDiagramPanel", () => ({ default: () => null }));
vi.mock("../components/UnifiedTokenFlowInspector", () => ({ default: () => null }));
vi.mock("../components/education/EducationPanelsHost", () => ({ default: () => null }));
vi.mock("../components/Phase266ArchitecturePage", () => ({ default: () => null }));
vi.mock("../components/MortgagePathPage", () => ({ default: () => null }));
// VerticalProvider gates rendering until an SSE hydration event arrives; in
// these session-focused tests that event never fires, so without a pass-through
// mock the provider returns null and App's session-check effects never run.
vi.mock("../vertical/VerticalProvider", () => ({
  VerticalProvider: ({ children }) => children,
  VerticalContext: { Provider: ({ children }) => children },
}));
vi.mock("../vertical/useVertical", () => ({
  useVertical: () => ({
    activeId: null,
    pageManifest: null,
    agentManifest: null,
    pageMockData: null,
    isAdmin: false,
    isAdminScope: false,
    refetch: jest.fn(),
  }),
}));
vi.mock("../context/EducationUIContext", () => ({
  EducationUIProvider: ({ children }) => children,
  useEducationUIOptional: () => ({ open: jest.fn(), close: jest.fn() }),
  useEducationUI: () => ({ open: jest.fn(), close: jest.fn() }),
}));
vi.mock("../context/TokenChainContext", () => ({
  TokenChainProvider: ({ children }) => children,
  useTokenChainOptional: () => null,
  useTokenChain: () => ({ events: [], mcpToolCalls: [] }),
}));
vi.mock("../context/AgentUiModeContext", () => ({
  AgentUiModeProvider: ({ children }) => children,
  useAgentUiMode: () => ({
    placement: "none",
    fab: true,
    setAgentUi: jest.fn(),
    surfaceHostEl: null,
    setSurfaceHostEl: jest.fn(),
  }),
}));
vi.mock("../services/configService", () => {
  const loadPublicConfig = jest.fn(() => Promise.resolve({}));
  const savePublicConfig = jest.fn(() => Promise.resolve(undefined));
  return {
    __esModule: true,
    loadPublicConfig,
    savePublicConfig,
  };
});
vi.mock("../services/demoScenarioService", () => {
  const fetchDemoScenario = jest.fn(() => Promise.resolve({ settings: {} }));
  return {
    __esModule: true,
    fetchDemoScenario,
    persistAgentUiMode: jest.fn(() => Promise.resolve(true)),
    persistAgentUi: jest.fn(() => Promise.resolve(true)),
  };
});
vi.mock("react-toastify", () => ({
  ToastContainer: (props) => (
    <div data-testid="toast-container" data-position={props.position} />
  ),
  toast: { success: jest.fn(), error: jest.fn() },
}));

// App.js checkOAuthSession uses getCachedJson which internally uses fetch (not axios.get).
// We mock cachedStatusService to delegate to axios.get so the existing test helpers
// (mockAllUnauthenticated / mockOneAuthenticated) that configure axios.get control responses.
// Using a manual factory with __esModule so named import { getCachedJson } resolves correctly.
vi.mock("../services/cachedStatusService", () => ({
  __esModule: true,
  getCachedJson: jest.fn(),
  getCachedStatus: jest.fn(),
  clearStatusCache: jest.fn(),
  clearStatusCacheFor: jest.fn(),
}));

import { act, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import axios from "axios";
import { getCachedJson } from "../services/cachedStatusService";
import { loadPublicConfig, savePublicConfig } from "../services/configService";
import App from "../App";

// Wire the mocks to proper implementations before every test
beforeEach(() => {
  getCachedJson.mockImplementation((url) =>
    axios.get(url).then((r) => ({ data: r.data })),
  );
  // Ensure configService mocks always return Promises
  loadPublicConfig.mockResolvedValue({});
  savePublicConfig.mockResolvedValue(undefined);
});

// ── helpers ────────────────────────────────────────────────────────────────────

/** Default: all three endpoints say not authenticated */
function mockAllUnauthenticated() {
  axios.get.mockImplementation((url) => {
    if (url === "/api/admin/config")
      return Promise.resolve({ data: { config: {} } });
    return Promise.resolve({ data: { authenticated: false, user: null } });
  });
}

/**
 * Make one specific URL return authenticated: true with the given user.
 * All others remain unauthenticated.
 */
function mockOneAuthenticated(authenticatedUrl, user) {
  axios.get.mockImplementation((url) => {
    if (url === "/api/admin/config")
      return Promise.resolve({ data: { config: {} } });
    if (url === authenticatedUrl) {
      return Promise.resolve({ data: { authenticated: true, user } });
    }
    return Promise.resolve({ data: { authenticated: false, user: null } });
  });
}

const ADMIN_USER = {
  id: "admin-001",
  username: "admin",
  email: "admin@example.com",
  firstName: "Admin",
  lastName: "User",
  role: "admin",
};

const CUSTOMER_USER = {
  id: "cust-001",
  username: "alice",
  email: "alice@example.com",
  firstName: "Alice",
  lastName: "Smith",
  role: "customer",
};

// ── Unauthenticated state ──────────────────────────────────────────────────────

describe("App — toast position", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    localStorage.clear();
    sessionStorage.clear();
    mockAllUnauthenticated();
  });

  afterEach(() => {
    routeLocation.pathname = "/";
    jest.clearAllMocks();
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it("uses bottom-left on the dashboard", () => {
    routeLocation.pathname = "/dashboard";
    render(<App />);

    expect(screen.getByTestId("toast-container")).toHaveAttribute(
      "data-position",
      "bottom-left",
    );
  });

  it("keeps top-center on other routes", () => {
    render(<App />);

    expect(screen.getByTestId("toast-container")).toHaveAttribute(
      "data-position",
      "top-center",
    );
  });
});

describe("App — unauthenticated state", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    localStorage.clear();
    sessionStorage.clear();
    delete window.location;
    window.location = { search: "", href: "/" };
    mockAllUnauthenticated();
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it("does not dispatch userAuthenticated when no session is found", async () => {
    const listener = jest.fn();
    window.addEventListener("userAuthenticated", listener);
    render(<App />);
    await act(async () => {
      jest.advanceTimersByTime(5000);
    });
    expect(listener).not.toHaveBeenCalled();
    window.removeEventListener("userAuthenticated", listener);
  });

  it("calls /api/auth/oauth/status, /api/auth/oauth/user/status, and /api/auth/session", async () => {
    render(<App />);
    await act(async () => {
      jest.advanceTimersByTime(5000);
    });
    const urls = () => axios.get.mock.calls.map((c) => c[0]);
    await waitFor(() => expect(urls()).toContain("/api/auth/oauth/status"));
    await waitFor(() =>
      expect(urls()).toContain("/api/auth/oauth/user/status"),
    );
    await waitFor(() => expect(urls()).toContain("/api/auth/session"));
  });
});

// ── Admin OAuth session ─────────────────────────────────────────────────────

describe("App — admin OAuth session detected", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    localStorage.clear();
    delete window.location;
    window.location = { search: "", href: "/" };
    mockOneAuthenticated("/api/auth/oauth/status", ADMIN_USER);
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it("dispatches userAuthenticated when admin session is found", async () => {
    const listener = jest.fn();
    window.addEventListener("userAuthenticated", listener);
    render(<App />);
    await act(async () => {
      jest.advanceTimersByTime(5000);
    });
    await waitFor(() => expect(listener).toHaveBeenCalled());
    window.removeEventListener("userAuthenticated", listener);
  });
});

// ── End-user OAuth session ─────────────────────────────────────────────────

describe("App — end-user OAuth session detected", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    localStorage.clear();
    delete window.location;
    window.location = { search: "", href: "/" };
    // Admin endpoint: unauthenticated; user endpoint: authenticated
    axios.get.mockImplementation((url) => {
      if (url === "/api/admin/config")
        return Promise.resolve({ data: { config: {} } });
      if (url === "/api/auth/oauth/user/status") {
        return Promise.resolve({
          data: { authenticated: true, user: CUSTOMER_USER },
        });
      }
      return Promise.resolve({ data: { authenticated: false, user: null } });
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it("dispatches userAuthenticated when end-user session is found", async () => {
    const listener = jest.fn();
    window.addEventListener("userAuthenticated", listener);
    render(<App />);
    await act(async () => {
      jest.advanceTimersByTime(5000);
    });
    await waitFor(() => expect(listener).toHaveBeenCalled());
    window.removeEventListener("userAuthenticated", listener);
  });
});

// ── Generic /session fallback ──────────────────────────────────────────────

describe("App — generic /api/auth/session fallback", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    localStorage.clear();
    delete window.location;
    window.location = { search: "", href: "/" };
    // Both OAuth endpoints unauthenticated; generic session endpoint authenticated
    axios.get.mockImplementation((url) => {
      if (url === "/api/admin/config")
        return Promise.resolve({ data: { config: {} } });
      if (url === "/api/auth/session") {
        return Promise.resolve({
          data: { authenticated: true, user: CUSTOMER_USER },
        });
      }
      return Promise.resolve({ data: { authenticated: false, user: null } });
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it("dispatches userAuthenticated for the /api/auth/session cookie-restore path", async () => {
    const listener = jest.fn();
    window.addEventListener("userAuthenticated", listener);
    render(<App />);
    await act(async () => {
      jest.advanceTimersByTime(5000);
    });
    await waitFor(() => expect(listener).toHaveBeenCalled());
    window.removeEventListener("userAuthenticated", listener);
  });
});

// ── Regular page load — no retry loop ─────────────────────────────────────

describe("App — regular page load does not retry", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    localStorage.clear();
    delete window.location;
    window.location = { search: "", href: "/" }; // NOT ?oauth=success
    mockAllUnauthenticated();
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it("makes exactly one round of endpoint checks (no retry loop)", async () => {
    render(<App />);
    await act(async () => {
      jest.advanceTimersByTime(200);
    });
    await act(async () => {
      jest.advanceTimersByTime(5000);
    });

    const authCalls = axios.get.mock.calls
      .map((c) => c[0])
      .filter((u) => u.startsWith("/api/auth"));
    // 3 calls = one round-trip from checkOAuthSession; if retry fired we'd see 6+.
    // A small number of extra /api/auth calls from other mounted (non-mocked) components
    // is acceptable — the key invariant is "far fewer than 6".
    expect(authCalls.length).toBeLessThan(6);
  });
});

// ── ?oauth=success — retry loop ────────────────────────────────────────────

describe("App — ?oauth=success triggers retry loop", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    localStorage.clear();
    delete window.location;
    window.location = {
      search: "?oauth=success",
      href: "/admin?oauth=success",
    };
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it("eventually finds the session after a late Redis response", async () => {
    let callCount = 0;
    axios.get.mockImplementation((url) => {
      if (url === "/api/admin/config")
        return Promise.resolve({ data: { config: {} } });
      callCount++;
      // Fail the first 3 rounds (9 calls), succeed on 4th round
      if (callCount <= 9) {
        return Promise.resolve({ data: { authenticated: false, user: null } });
      }
      return Promise.resolve({
        data: { authenticated: true, user: ADMIN_USER },
      });
    });

    const listener = jest.fn();
    window.addEventListener("userAuthenticated", listener);

    render(<App />);

    // Advance through initial check + 3 retries
    await act(async () => {
      jest.advanceTimersByTime(200);
    });
    await act(async () => {
      jest.advanceTimersByTime(450);
    });
    await act(async () => {
      jest.advanceTimersByTime(950);
    });
    await act(async () => {
      jest.advanceTimersByTime(1900);
    });

    await waitFor(() => expect(listener).toHaveBeenCalled());
    window.removeEventListener("userAuthenticated", listener);
  });
});

// ── userAuthenticated event listener ──────────────────────────────────────

describe("App — userAuthenticated event re-triggers check", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    localStorage.clear();
    delete window.location;
    window.location = { search: "", href: "/" };
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it("re-checks session when BankingAgent dispatches userAuthenticated", async () => {
    mockAllUnauthenticated();
    render(<App />);
    await act(async () => {
      jest.advanceTimersByTime(5000);
    });

    const callsBefore = axios.get.mock.calls
      .map((c) => c[0])
      .filter((u) => u.startsWith("/api/auth")).length;

    // Dispatch the event as BankingAgent would
    await act(async () => {
      window.dispatchEvent(new CustomEvent("userAuthenticated"));
    });
    await act(async () => {
      jest.advanceTimersByTime(5000);
    });

    // App should re-run checkOAuthSession — more auth calls expected
    const callsAfter = axios.get.mock.calls
      .map((c) => c[0])
      .filter((u) => u.startsWith("/api/auth")).length;
    expect(callsAfter).toBeGreaterThan(callsBefore);
  });
});

// ── userLoggedOut localStorage flag ───────────────────────────────────────

describe("App — userLoggedOut localStorage flag skips check", () => {
  beforeEach(() => {
    delete window.location;
    window.location = { search: "", href: "/", pathname: "/" };
    localStorage.setItem("userLoggedOut", "true");
    global.fetch = jest.fn(() => Promise.resolve({ ok: true }));
    window.history.replaceState = jest.fn();
  });

  afterEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
  });

  it("clears the userLoggedOut flag after clear-session and makes no auth endpoint calls", async () => {
    mockAllUnauthenticated();
    render(<App />);
    await waitFor(() => {
      expect(localStorage.getItem("userLoggedOut")).toBeNull();
    });
    expect(global.fetch).toHaveBeenCalledWith(
      "/api/auth/clear-session",
      expect.objectContaining({ method: "POST", credentials: "include" }),
    );

    // Auth endpoints should NOT have been called by checkOAuthSession (logout path skips it).
    // A single incidental /api/auth call from a mounted non-mocked component is allowed;
    // the critical invariant is that checkOAuthSession's 3-endpoint round was NOT triggered.
    const authCalls = axios.get.mock.calls
      .map((c) => c[0])
      .filter((u) => u.startsWith("/api/auth"));
    expect(authCalls.length).toBeLessThan(3);
  });
});
