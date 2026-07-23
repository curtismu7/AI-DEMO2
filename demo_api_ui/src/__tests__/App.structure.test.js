/**
 * App.structure.test.js — merge-safety guard for App.js and route files
 *
 * Two layers of protection:
 *
 * 1. String-level assertions: cheap, fast — guard critical imports and JSX
 *    placements against silent merge drops (e.g. AuthorizeRulesPanel drop in
 *    merge 3d2cf092).
 *
 * 2. Render smoke tests: actually mount each /:path under MemoryRouter and
 *    confirm it doesn't throw. Catches the class of bug where the structure
 *    LOOKS right as text but React Router rejects it at render time (e.g.
 *    "<X> is not a <Route> component" — caught by Playwright but missed by
 *    string-level tests, see the inlined-wildcard fix).
 */

// Stub all direct imports of PublicRoutes so `await import("../routes/PublicRoutes")`
// in the render smoke test completes quickly. The deep import trees hang in jsdom
// (network hooks, EventSource, WebSocket setup at module level). The smoke test
// only checks routing structure, not component content.
vi.mock("../components/AIAgent", () => ({ default: () => null }));
vi.mock("../components/EmbeddedAgentDock", () => ({ default: () => null }));
vi.mock("../routes/AppShell", () => ({ default: ({ children }) => children }));
vi.mock("../components/AuthzTestPage", () => ({ default: () => null }));
vi.mock("../components/ComplianceModalPopout", () => ({ default: () => null }));
vi.mock("../components/DemoGuidePopout", () => ({ default: () => null }));
vi.mock("../components/LogoutPage", () => ({ default: () => null }));
vi.mock("../components/MFATestPage", () => ({ default: () => null }));
vi.mock("../components/Onboarding", () => ({ default: () => null }));
vi.mock("../components/PingOneSetupGuidePage", () => ({ default: () => null }));
vi.mock("../components/PingOneTestPage", () => ({ default: () => null }));
vi.mock("../components/SelfServicePage", () => ({ default: () => null }));
vi.mock("../components/SetupPage", () => ({ default: () => null }));
vi.mock("../components/SetupWizard", () => ({ default: () => null }));
vi.mock("../components/Configuration/UnifiedConfigurationPage", () => ({ default: () => null }));

const fs = require("fs");
const path = require("path");

const appSrc = fs.readFileSync(
  path.resolve(__dirname, "../App.js"),
  "utf8"
);

// ─── App.js Imports ───────────────────────────────────────────────────────────

describe("App.js — critical imports", () => {
  const cases = [
    ["AIAgent", 'import AIAgent from "./components/AIAgent"'],
    ["EmbeddedAgentDock", 'import EmbeddedAgentDock from "./components/EmbeddedAgentDock"'],
    ["SessionTokenProvider", 'import { SessionTokenProvider } from "./context/SessionTokenContext"'],
    ["resolveEmbeddedFocus from demoAgentSafety", 'import { resolveEmbeddedFocus } from "./components/demoAgentSafety"'],
    ["DashboardContent", 'import { DashboardContent } from "./routes/CustomerRoutes"'],
    ["EducationRoutes", 'import EducationRoutes from "./routes/EducationRoutes"'],
    ["MonitoringRoutes", 'import MonitoringRoutes'],
    ["PublicRoutes", 'import PublicRoutes'],
    // AuthorizeRulesPanel and WebMcpPanel both moved to side-nav routes.
  ];

  test.each(cases)("imports %s", (_name, importStr) => {
    expect(appSrc).toContain(importStr);
  });
});

// ─── App.js JSX placements ────────────────────────────────────────────────────

describe("App.js — critical JSX placements", () => {
  test("SessionTokenProvider wraps AppWithAuth", () => {
    const providerOpen = appSrc.indexOf("<SessionTokenProvider>");
    const appWithAuth = appSrc.indexOf("<AppWithAuth />", providerOpen);
    const providerClose = appSrc.indexOf("</SessionTokenProvider>", appWithAuth);
    expect(providerOpen).toBeGreaterThan(-1);
    expect(appWithAuth).toBeGreaterThan(providerOpen);
    expect(providerClose).toBeGreaterThan(appWithAuth);
  });

  test("surfaceHostEl is passed to AIAgent (portal pattern)", () => {
    expect(appSrc).toContain("surfaceHostEl={surfaceHostEl}");
  });

  test("/admin forces pingone-admin vertical (admin demo steps, not banking UCs)", () => {
    expect(appSrc).toContain("isPingOneAdminAgentRoute");
    expect(appSrc).toContain('forceVertical: "pingone-admin"');
  });

  test("resolveEmbeddedFocus is passed as embeddedFocus prop", () => {
    expect(appSrc).toContain("embeddedFocus={resolveEmbeddedFocus(pathname)}");
  });

  test("EmbeddedAgentDock is rendered at App level", () => {
    expect(appSrc).toContain("<EmbeddedAgentDock");
  });

  test("DashboardContent is rendered inside the /dashboard route", () => {
    expect(appSrc).toContain("<DashboardContent user={user} logout={logout} />");
  });

  test("MonitoringRoutes is rendered for /monitoring/*", () => {
    expect(appSrc).toContain("<MonitoringRoutes");
  });

  test("EducationRoutes is rendered for /architecture/*", () => {
    expect(appSrc).toContain("<EducationRoutes user={user} logout={logout} />");
  });

  test("Wildcard catch-all does NOT contain bare component wrappers around <Route>", () => {
    // React Router v6 requires <Route> elements to be DIRECT children of <Routes>.
    // A bare `<AdminRoutes ...>` or `<CustomerRoutes ...>` (no path prop) returning
    // <Route> fragments crashes at render time. Catch that class of bug here.
    const wildcardForbidden = [
      "<AdminRoutes ",
      "<CustomerRoutes ",
      "<EducationWildcardRoutes ",
    ];
    for (const fragment of wildcardForbidden) {
      expect(appSrc).not.toContain(fragment);
    }
  });

  // Guests under path="*" only get TopNav — inspector must stay top-level.
  test("/pingone-mcp-inspector is a top-level McpInspectorPageRoute", () => {
    expect(appSrc).toContain("McpInspectorPageRoute");
    expect(appSrc).toMatch(
      /path=["']\/pingone-mcp-inspector["'][\s\S]*?<McpInspectorPageRoute/,
    );
    expect(appSrc).not.toContain('element={<McpInspectorPage />}');
  });
});

// ─── DashboardContent (highest priority — guards the 3d2cf092 regression) ────

describe("CustomerRoutes.js / DashboardContent — critical imports and JSX", () => {
  const src = fs.readFileSync(
    path.resolve(__dirname, "../routes/CustomerRoutes.js"),
    "utf8"
  );

  test('does NOT import WebMcpPanel (moved to /webmcp side-nav route)', () => {
    expect(src).not.toContain('import WebMcpPanel');
  });

  test('does NOT import AuthorizeRulesPanel (moved to side-nav route)', () => {
    expect(src).not.toContain('import AuthorizeRulesPanel');
  });

  test("no stale banking_api_ui paths", () => {
    expect(src).not.toContain("banking_api_ui");
  });
});

// ─── MonitoringRoutes.js ──────────────────────────────────────────────────────

describe("MonitoringRoutes.js — critical imports", () => {
  const src = fs.readFileSync(
    path.resolve(__dirname, "../routes/MonitoringRoutes.js"),
    "utf8"
  );

  test('imports TokenChainTraceRail', () => {
    expect(src).toContain('import TokenChainTraceRail from "../components/TokenChainTraceRail"');
  });

  test('token-chain route mounts TokenChainTraceRail', () => {
    expect(src).toMatch(/path=["']token-chain["'][\s\S]*TokenChainTraceRail/);
  });

  test("api-explorer deep-links to PingOne MCP inspector", () => {
    expect(src).toContain('path="api-explorer"');
    expect(src).toContain("/pingone-mcp-inspector");
  });

  // Catch-all in App.js already wraps /agent-flow-inspector in TopNav +
  // main-content; nesting AppShell re-applied the sidebar offset and left a
  // gap on the right.
  test("AgentFlowInspectorRoute does not wrap AppShell", () => {
    const fn = src.match(
      /export function AgentFlowInspectorRoute[\s\S]*?\n\}/
    )?.[0];
    expect(fn).toBeTruthy();
    expect(fn).toContain("UnifiedTokenFlowInspector");
    expect(fn).not.toContain("AppShell");
  });

  test("no stale banking_api_ui paths", () => {
    expect(src).not.toContain("banking_api_ui");
  });
});

// ─── EducationRoutes.js ───────────────────────────────────────────────────────

describe("EducationRoutes.js — critical imports", () => {
  const src = fs.readFileSync(
    path.resolve(__dirname, "../routes/EducationRoutes.js"),
    "utf8"
  );

  test('imports ArchitectureTabsPanel', () => {
    expect(src).toContain('import ArchitectureTabsPanel from "../components/ArchitectureTabsPanel"');
  });

  test("no stale banking_api_ui paths", () => {
    expect(src).not.toContain("banking_api_ui");
  });
});

// ─── Render smoke tests — catches the "<X> is not a <Route> component" class ─
//
// React Router v6 throws synchronously during render if any child of <Routes>
// is not a <Route>, <React.Fragment>, or a custom element with the same shape.
// String tests can't see this — the string `<AdminRoutes user={user} />` looks
// fine but crashes at render. The full-App mount approach hits ESM-parse
// problems on transitive imports (mermaid, etc.) in the Jest config, so we
// instead test the failure mode in isolation: render a fake "BrokenRouteGroup"
// component as a child of <Routes> and assert React Router actually throws.
// If a future React Router version silently accepts this pattern, the
// negative test starts failing — and the forbidden-fragment string assertion
// above remains the merge-safety guard.

describe("Render smoke — Router still rejects route-group component children", () => {
  const React = require("react");
  const { render } = require("@testing-library/react");
  const {
    MemoryRouter,
    Navigate,
    Route,
    Routes,
  } = require("react-router-dom");

  test("React Router throws when a <Routes> child is a component returning <Route> fragments (the AdminRoutes/CustomerRoutes/EducationWildcardRoutes bug)", () => {
    function BrokenRouteGroup() {
      return React.createElement(
        React.Fragment,
        null,
        React.createElement(Route, {
          path: "/a",
          element: React.createElement(Navigate, { to: "/", replace: true }),
        }),
      );
    }

    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    expect(() =>
      render(
        React.createElement(
          MemoryRouter,
          { initialEntries: ["/a"] },
          React.createElement(
            Routes,
            null,
            React.createElement(BrokenRouteGroup),
          ),
        ),
      ),
    ).toThrow(/is not a <Route> component/);

    consoleErrorSpy.mockRestore();
  });

  test("PublicRoutes default export renders as a <Route element={...}> without throwing", async () => {
    // PublicRoutes owns its OWN internal <Routes> — that means it is a valid
    // route ELEMENT (consumed via <Route path=\"/setup/*\" element={<PublicRoutes/>}/>),
    // not a child of <Routes>. This positive test pairs with the negative
    // test above to cover both halves of the bug class.
    const { default: PublicRoutes } = await import("../routes/PublicRoutes");

    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    expect(() =>
      render(
        React.createElement(
          MemoryRouter,
          { initialEntries: ["/setup"] },
          React.createElement(
            Routes,
            null,
            React.createElement(Route, {
              path: "/setup/*",
              element: React.createElement(PublicRoutes, {
                user: null,
                logout: () => {},
              }),
            }),
          ),
        ),
      ),
    ).not.toThrow();

    const violation = consoleErrorSpy.mock.calls
      .map((args) => String(args[0]))
      .find((msg) => /is not a <Route> component/.test(msg));
    expect(violation).toBeUndefined();

    consoleErrorSpy.mockRestore();
  });
});
