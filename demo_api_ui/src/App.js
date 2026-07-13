import { useEffect, useLayoutEffect, useState } from "react";
import {
  Navigate,
  Route,
  BrowserRouter as Router,
  Routes,
  useLocation,
} from "react-router-dom";
import { ToastContainer } from "react-toastify";
import { MdSwapHoriz } from "react-icons/md";
import "react-toastify/dist/ReactToastify.css";

import AccessIdTokenPathPage from "./components/AccessIdTokenPathPage";
import Accounts from "./components/Accounts";
import { ActorTokenEducation } from "./components/ActorTokenEducation";
import AdminErrorAuditLog from "./components/AdminErrorAuditLog";
import AdminSideNav from "./components/AdminSideNav";
import AdminTokenComplianceAudit from "./components/AdminTokenComplianceAudit";
import AdminVaultPage from "./components/AdminVaultPage";
import AgentBuilderPage from "./components/AgentBuilderPage";
import AgentGuardrailsPage from "./pages/AgentGuardrailsPage";
import AgentOnboardingFlowDiagram from "./components/AgentOnboardingFlowDiagram";
import AgentOnboardingSubwayPage from "./components/AgentOnboardingSubwayPage";
import AgentOnboardingMermaidPage from "./components/AgentOnboardingMermaidPage";
import AgentStudioPreviewPage from "./components/agentStudioPreview/AgentStudioPreviewPage";
import DiscoveryPreviewPage from "./components/agentStudioPreview/DiscoveryPreviewPage";
import IgaForAiPage from "./components/agentStudioPreview/IgaForAiPage";
import PrivilegesGatewayPreviewPage from "./components/agentStudioPreview/PrivilegesGatewayPreviewPage";
import PlatformGapsPage from "./components/agentStudioPreview/PlatformGapsPage";
import AgentFlowDiagramPanel from "./components/AgentFlowDiagramPanel";
import { AgenticTrustEducation } from "./components/AgenticTrustEducation";
import OwaspLearnerPage from "./components/OwaspLearnerPage";
import UngovernedAgentPage from "./components/UngovernedAgentPage";
import AIAgent from "./components/AIAgent";
import ApiKeyPathPage from "./components/ApiKeyPathPage";
import AuditPage from "./components/AuditPage";
import BankingAdminOps from "./components/BankingAdminOps";
import CIBAPanel from "./components/CIBAPanel";
import CimdSimPanel from "./components/CimdSimPanel";
import ClientCredentialsResourcePage from "./components/ClientCredentialsResourcePage";
import ClientRegistrationPage from "./components/ClientRegistrationPage";
import ComplianceModalPopout from "./components/ComplianceModalPopout";
import Dashboard from "./components/Dashboard";
import DelegatedAccessPage from "./components/DelegatedAccessPage";
import DelegationPage from "./components/DelegationPage";
import DemoGuidePopout from "./components/DemoGuidePopout";
import DemoServerCheckModal from "./components/DemoServerCheckModal";
import { resolveEmbeddedFocus } from "./components/demoAgentSafety";
import EmbeddedAgentDock from "./components/EmbeddedAgentDock";
import EducationPanelsHost from "./components/education/EducationPanelsHost";
import FeatureFlagsPage from "./components/FeatureFlagsPage";
import Footer from "./components/Footer";
import HealthcareAdminOps from "./components/HealthcareAdminOps";
import LandingPage from "./components/LandingPage";
import LearningHub from "./components/LearningHub";
import LlmConfigPage from "./components/LlmConfigPage";
import LogoutPage from "./components/LogoutPage";
import LogViewer from "./components/LogViewer";
import { MCPToolsEducation } from "./components/MCPToolsEducation";
import McpInspector from "./components/McpInspector";
import MissingCredentialsModal from "./components/MissingCredentialsModal";
import MockAuthzRulesPage from "./components/MockAuthzRulesPage";
import MortgagePathPage from "./components/MortgagePathPage";
import OAuthDebugLogViewer from "./components/OAuthDebugLogViewer";
import OAuthTokenDisplayPage from "./components/OAuthTokenDisplayPage";
import PingOneAuthorizePage from "./components/PingOneAuthorizePage";
import PingOneMcpInspector from "./components/PingOneMcpInspector";
import PostmanCollectionsPage from "./components/PostmanCollectionsPage";
import Profile from "./components/Profile";
import ResourceServerPage from "./components/ResourceServerPage";
import RetailAdminOps from "./components/RetailAdminOps";
import ScopeAuditPage from "./components/ScopeAuditPage";
import ScopeReferencePage from "./components/ScopeReferencePage";
import SecurityCenter from "./components/SecurityCenter";
import SecuritySettings from "./components/SecuritySettings";
import ServerRestartModal from "./components/ServerRestartModal";
import AuthorizeFallbackListener from "./components/AuthorizeFallbackListener";
import SessionReauthBanner from "./components/SessionReauthBanner";
import SportingGoodsAdminOps from "./components/SportingGoodsAdminOps";
import SpinnerHost from "./components/shared/SpinnerHost";
import TopNav from "./components/TopNav";
import TransactionConsentPage from "./components/TransactionConsentPage";
import Transactions from "./components/Transactions";
import DemoTourModal from "./components/tour/DemoTourModal";
import UserAccounts from "./components/UserAccounts";
import Users from "./components/Users";
import UserTransactions from "./components/UserTransactions";
import VerticalFeaturePage from "./components/VerticalFeaturePage";
import WebMcpExplainer from "./components/WebMcpExplainer";
import NotFoundPage from "./components/NotFoundPage";
import WorkforceAdminOps from "./components/WorkforceAdminOps";
import { ActivityNarrativeProvider } from "./context/ActivityNarrativeContext";
import {
  AgentUiModeProvider,
  useAgentUiMode,
} from "./context/AgentUiModeContext";
import { DemoTourProvider } from "./context/DemoTourContext";
import { EducationUIProvider } from "./context/EducationUIContext";
import { ExchangeModeProvider } from "./context/ExchangeModeContext";
import { IndustryBrandingProvider } from "./context/IndustryBrandingContext";
import { SessionTokenProvider } from "./context/SessionTokenContext";
import { SpinnerProvider } from "./context/SpinnerContext";
import { TokenChainProvider } from "./context/TokenChainContext";
import useAdminSkin from "./hooks/useAdminSkin";
import { useAppFlags } from "./hooks/useAppFlags";
import { useAuth } from "./hooks/useAuth";
import { useOAuthUrlCleanup } from "./hooks/useOAuthUrlCleanup";
import { useServerHealthCheck } from "./hooks/useServerHealthCheck";
import AdminThemesPage from "./pages/AdminThemesPage";
import AiControlPlanePage from "./pages/AiControlPlanePage";
import CheckPage from "./pages/CheckPage";
import ServersPage from "./pages/ServersPage";
import TracingPage from "./pages/TracingPage";
import LangChainPage from "./pages/LangChainPage";
import SnapshotImport from "./pages/SnapshotImport";
import PrivilegeDemoPage from "./pages/PrivilegeDemoPage";
import PingCliPage from "./components/PingCliPage";
import PingAiTestLabPage from "./components/PingAiTestLabPage";
import LlamaVscodeGuidePage from "./components/LlamaVscodeGuidePage";
import AdminRoute from "./routes/AdminRoute";
import { DashboardContent } from "./routes/CustomerRoutes";
import AdminBlockedDashboard from "./components/AdminBlockedDashboard";
import EducationRoutes from "./routes/EducationRoutes";
import MonitoringRoutes, {
  AgentFlowInspectorRoute,
  ApiTrafficRoute,
  DevToolsRoute,
  LogsRoute,
  McpTrafficRoute,
  SequenceDiagramRoute,
} from "./routes/MonitoringRoutes";
import PublicRoutes, {
  AgentPageRoute,
  AuthzTestPageRoute,
  CodeExplorerPageRoute,
  CodeSearchPageRoute,
  ConfigurePage,
  CopilotPageRoute,
  GraphifyPageRoute,
  MFATestPageRoute,
  OASDemoPageRoute,
  OAuthAcademyPageRoute,
  OnboardingRoute,
  PingOneSetupPageRoute,
  PingOneTestPageRoute,
  ReportsPageRoute,
  SdkLoginCallbackRoute,
  SdkLoginPageRoute,
  SelfServicePageRoute,
  TokenExchangeTesterPageRoute,
  UseCasesPageRoute,
} from "./routes/PublicRoutes";
import RequireAdminLogin from "./routes/RequireAdminLogin";
import { monitorApiHealth } from "./services/bankingRestartNotificationService";
import {
  isBankingAgentDashboardRoute,
  isEmbeddedAgentDockRoute,
  isMonitoringRoute,
  isPublicMarketingAgentPath,
} from "./utils/embeddedAgentFabVisibility";
import { VerticalEditorPage } from "./vertical/AdminEditor/VerticalEditorPage";
import { VerticalProvider } from "./vertical/VerticalProvider";
import { EventStreamProvider } from "./context/EventStreamContext";
import "./App.css";

// Browser extension interference detection and handling
const setupBrowserExtensionHandling = () => {
  // Monitor for extension-related errors
  const originalConsoleError = console.error;
  console.error = (...args) => {
    // Check for browser extension errors
    const message = args.join(" ");
    if (
      message.includes("bootstrap-autofill-overlay.js") ||
      message.includes("Cannot read properties of null (reading 'includes')")
    ) {
      console.warn(
        "[Browser Extension] Detected extension interference:",
        message,
      );
      // Don't let extension errors break our app
      return;
    }
    originalConsoleError.apply(console, args);
  };

  // Add global error handler for extension interference
  const handleGlobalError = (event) => {
    if (event.error?.message?.includes("bootstrap-autofill-overlay.js")) {
      console.warn(
        "[Browser Extension] Prevented extension error from crashing app",
      );
      event.preventDefault();
      return false;
    }
  };

  window.addEventListener("error", handleGlobalError);

  // Cleanup function
  return () => {
    console.error = originalConsoleError;
    window.removeEventListener("error", handleGlobalError);
  };
};

/**
 * Renders children for admin users.
 * For non-admin logged-in users: shows a modal explaining why + fires a toast, then
 * renders a blank placeholder so the URL stays valid (no silent redirect to /).
 */
/** Page wrapper for /monitoring/agent-flow — opens the Agent Request Flow panel on mount. */
function AgentFlowPage() {
  useEffect(() => {
    window.dispatchEvent(new CustomEvent("agent-flow-diagram-open"));
  }, []);
  return (
    <div
      style={{
        padding: "2rem",
        color: "var(--text-muted, #888)",
        fontSize: "14px",
      }}
    >
      <h2 style={{ fontSize: "1rem", marginBottom: "0.5rem" }}>
        <MdSwapHoriz aria-hidden style={{ verticalAlign: "-2px", marginRight: 6 }} />
        Agent Request Flow
      </h2>
      <p>
        Use the AI agent to trigger a tool call — the request flow panel will
        appear automatically.
      </p>
    </div>
  );
}

function AppWithAuth() {
  const fullLocation = useLocation();
  const backgroundLocation = fullLocation.state?.backgroundLocation;
  const { pathname } = useLocation();
  const pathNorm = pathname.replace(/\/$/, "") || "/";
  const isApiTrafficOnlyPage =
    pathNorm === "/api-traffic" ||
    pathNorm === "/logs" ||
    pathNorm === "/agent" ||
    // SDK centralized-login sandbox: standalone page, no app chrome/panels/footer.
    pathNorm === "/sdk-login" ||
    pathNorm === "/sdk-login/callback";
  const {
    placement: agentPlacement,
    fab: agentFab,
    surfaceHostEl,
    clinicalSplit,
  } = useAgentUiMode();

  const { user, loading, logout, sessionReauth, setSessionReauth } = useAuth();
  useAdminSkin();
  const { appFlags } = useAppFlags();
  const { downServers, markAllUp, dismissForSession } = useServerHealthCheck();
  useOAuthUrlCleanup();

  const [logViewerOpen, setLogViewerOpen] = useState(false);
  const [credentialsModal, setCredentialsModal] = useState(null);

  // Setup browser extension interference handling
  useEffect(() => {
    const cleanup = setupBrowserExtensionHandling();
    return cleanup;
  }, []);

  // Initialize server restart notification monitoring
  useEffect(() => {
    monitorApiHealth();
  }, []);

  // Clear old page content on route change — scroll to top before paint
  // biome-ignore lint/correctness/useExhaustiveDependencies: must re-run on every route change; the body reads only DOM but depends on pathname changing.
  useLayoutEffect(() => {
    window.scrollTo(0, 0);
    const main = document.querySelector(".main-content");
    if (main) main.scrollTop = 0;
  }, [pathname]);

  // Listen for missing_credentials events (dispatched by API error handling)
  useEffect(() => {
    const onMissingCreds = (e) => {
      const d = e.detail;
      if (!d?.missingFields?.length) return;
      setCredentialsModal({
        missingFields: d.missingFields,
        credentialType: d.credentialType,
        message: d.message,
      });
    };
    window.addEventListener("missing-credentials", onMissingCreds);
    return () =>
      window.removeEventListener("missing-credentials", onMissingCreds);
  }, []);

  /** Nav rail / layout flags — computed declaratively so React className is always in sync. */
  const isOnDashboard = pathname === "/dashboard";

  /** Floating agent: dashboard homes only. Embedded dock: those routes plus `/config` (setup-focused assistant). */
  const onDashboardAgentRoute = isBankingAgentDashboardRoute(pathname);
  const onEmbeddedDockRoute = isEmbeddedAgentDockRoute(pathname);

  // Routes where UserDashboard is rendered (handles its own middle FAB + split layout and its own bottom dock).
  // Admin uses Dashboard.js on /admin — those routes need the global float/dock from App.
  // / now renders LandingPage for non-admin logged-in users; UserDashboard lives at /dashboard.
  const onUserDashboardRoute = Boolean(user) && pathname === "/dashboard";

  // Landing home (/): show floating agent even when signed out.
  // Suppress float on signed-in / only when UserDashboard owns middle placement.
  const marketingAgentSurface = isPublicMarketingAgentPath(pathname) && !user;

  // Landing /: always show float agent, never bottom dock.
  const hasEmbeddedDockLayout =
    Boolean(user) && agentPlacement === "bottom" && onEmbeddedDockRoute;

  const onMonitoringRoute = isMonitoringRoute(pathname);

  const agentDisabled = appFlags.agentUiMode === "disabled";

  const showFloatingAgent =
    !agentDisabled &&
    !isApiTrafficOnlyPage &&
    (!hasEmbeddedDockLayout ||
      onMonitoringRoute ||
      (Boolean(user) && agentFab && onDashboardAgentRoute)) &&
    (marketingAgentSurface ||
      (Boolean(user) && agentPlacement === "none") ||
      (Boolean(user) && onMonitoringRoute) ||
      (Boolean(user) &&
        agentPlacement !== "none" &&
        onDashboardAgentRoute &&
        !(agentPlacement === "middle" && onUserDashboardRoute)));

  /** Middle-mode UserDashboard registers a `middleHostEl` via setSurfaceHostEl
   *  and expects the single <AIAgent> to portal into it. The
   *  `showFloatingAgent` calc explicitly suppresses the FAB for Middle on
   *  UserDashboard (so there is exactly one agent surface), but without this
   *  extra clause `shouldMountSingleAgent` would also be false — so nothing
   *  would render to portal into the host and the agent column would appear
   *  empty. Same fix that clinicalSplit gets at the inline-mode props below.
   *
   *  Important: NO Boolean(user) check here. Guests on /dashboard still get
   *  the inline agent (BankingAgent has marketingGuestChatEnabled +
   *  BX_AGENT_PENDING_NL_KEY: when a guest asks something that needs auth,
   *  BankingAgent stashes the pending request, calls
   *  navigateToCustomerOAuthLogin(), and resumes after the OAuth callback).
   *  Restricting to signed-in users would silently strip the inline agent
   *  for guests and leave them with no way to start the demo. */
  const onMiddlePlacementInDashboard =
    agentPlacement === "middle" && onUserDashboardRoute;
  /** Single <AIAgent> portals into the bottom dock host element when present; falls back to document.body otherwise. */
  const shouldMountSingleAgent =
    showFloatingAgent || hasEmbeddedDockLayout || onMiddlePlacementInDashboard;

  // When the single agent is portaled into the bottom dock host it must wear
  // the dock's inline chrome (no floating frame/drag), exactly as the old
  // per-dock <AIAgent mode="inline" embeddedDockBottom> did. Float and
  // all other surfaces keep the default floating chrome.
  // clinicalSplit (set by TalkPane via AgentUiModeContext when ff_agent_clinical_split=on)
  // takes precedence over hasEmbeddedDockLayout — it renders BankingAgent with
  // splitColumnChrome so the existing .ba-mode-inline.ba-split-column styles apply.
  let singleAgentSurfaceProps = {};
  if (clinicalSplit) {
    singleAgentSurfaceProps = { mode: "inline", splitColumnChrome: true };
  } else if (hasEmbeddedDockLayout) {
    singleAgentSurfaceProps = { mode: "inline", embeddedDockBottom: true };
  } else if (onMiddlePlacementInDashboard) {
    // Middle column owns the agent surface — render inline so the floating
    // dock chrome doesn't appear inside the column. Same pattern as the
    // clinical-split branch above.
    singleAgentSurfaceProps = { mode: "inline", splitColumnChrome: true };
  }

  /** Slower default dismiss on public landing so OAuth/agent messages are readable (signed-in routes stay 4s). */
  const toastContainerAutoCloseMs =
    !user && isPublicMarketingAgentPath(pathname) ? 12000 : 4000;

  return (
    <DemoTourProvider>
      <EducationUIProvider>
        <TokenChainProvider activePath={pathname}>
          <ActivityNarrativeProvider>
            <div
              className={`App end-user-nano${isOnDashboard ? " App--on-dashboard" : ""}${hasEmbeddedDockLayout ? " App--has-embedded-dock" : ""}${sessionReauth ? " App--session-reauth" : ""}`}
            >
              <ToastContainer
                position="top-center"
                autoClose={toastContainerAutoCloseMs}
                hideProgressBar={false}
                newestOnTop
                closeOnClick
                pauseOnHover
                draggable
              />
              {sessionReauth && (
                <SessionReauthBanner
                  message={sessionReauth.message}
                  role={sessionReauth.role}
                  isHITL={sessionReauth.isHITL || false}
                  onDismiss={() => setSessionReauth(null)}
                />
              )}
              {user && !isApiTrafficOnlyPage && <AdminSideNav user={user} />}
              <Routes>
                {/* /setup/* sub-routes — no auth required */}
                <Route
                  path="/setup/*"
                  element={<PublicRoutes user={user} logout={logout} />}
                />
                {/* Demo config accessible without login */}
                <Route
                  path="/configure"
                  element={<ConfigurePage user={user} logout={logout} />}
                />
                <Route
                  path="/demo-data"
                  element={
                    <Navigate to="/configure?tab=demo-management" replace />
                  }
                />
                {/* Self-service + test pages — accessible without login */}
                <Route
                  path="/self-service"
                  element={<SelfServicePageRoute user={user} logout={logout} />}
                />
                <Route
                  path="/pingone-test"
                  element={<PingOneTestPageRoute user={user} logout={logout} />}
                />
                <Route
                  path="/pingone-setup"
                  element={<PingOneSetupPageRoute user={user} logout={logout} />}
                />
                <Route
                  path="/mfa-test"
                  element={<MFATestPageRoute user={user} logout={logout} />}
                />
                <Route
                  path="/authz-test"
                  element={<AuthzTestPageRoute user={user} logout={logout} />}
                />
                <Route
                  path="/token-exchange-tester"
                  element={
                    <TokenExchangeTesterPageRoute user={user} logout={logout} />
                  }
                />
                <Route
                  path="/sdk-login"
                  element={<SdkLoginPageRoute />}
                />
                <Route path="/sdk-login/callback" element={<SdkLoginCallbackRoute />} />
                <Route
                  path="/code-explorer"
                  element={
                    <CodeExplorerPageRoute user={user} logout={logout} />
                  }
                />
                <Route
                  path="/code-search"
                  element={
                    <CodeSearchPageRoute user={user} logout={logout} />
                  }
                />
                <Route
                  path="/graphify"
                  element={
                    <GraphifyPageRoute user={user} logout={logout} />
                  }
                />
                <Route
                  path="/oauth-academy"
                  element={
                    <OAuthAcademyPageRoute user={user} logout={logout} />
                  }
                />
                <Route
                  path="/oas-demo"
                  element={<OASDemoPageRoute user={user} logout={logout} />}
                />
                <Route
                  path="/learning"
                  element={
                    loading ? null : (
                      <>
                        <TopNav user={user} onLogout={logout} />
                        <main className="main-content">
                          <LearningHub />
                        </main>
                      </>
                    )
                  }
                />
                <Route
                  path="/reports"
                  element={<ReportsPageRoute user={user} logout={logout} />}
                />
                {/* AI Control Plane — any logged-in user (not admin-only) */}
                <Route
                  path="/ai-control-plane"
                  element={
                    loading ? null : user ? (
                      <>
                        <TopNav user={user} onLogout={logout} />
                        <main className="main-content">
                          <AiControlPlanePage />
                        </main>
                      </>
                    ) : (
                      <Navigate to="/" replace />
                    )
                  }
                />
                {/* Servers — live server inventory; any logged-in user (not admin-only) */}
                <Route
                  path="/servers"
                  element={
                    loading ? null : user ? (
                      <>
                        <TopNav user={user} onLogout={logout} />
                        <main className="main-content">
                          <ServersPage />
                        </main>
                      </>
                    ) : (
                      <Navigate to="/" replace />
                    )
                  }
                />
                {/* Check — server/health checks; any logged-in user (not admin-only) */}
                <Route
                  path="/check"
                  element={
                    loading ? null : user ? (
                      <>
                        <TopNav user={user} onLogout={logout} />
                        <main className="main-content">
                          <CheckPage />
                        </main>
                      </>
                    ) : (
                      <Navigate to="/" replace />
                    )
                  }
                />
                <Route
                  path="/tracing"
                  element={
                    loading ? null : user ? (
                      <>
                        <TopNav user={user} onLogout={logout} />
                        <main className="main-content">
                          <TracingPage />
                        </main>
                      </>
                    ) : (
                      <Navigate to="/" replace />
                    )
                  }
                />
                {/* Use-Case Launcher — any logged-in user; flag-gated (ff_use_cases_launcher default ON) */}
                <Route
                  path="/use-cases"
                  element={
                    loading ? null : user && appFlags.showUseCaseLauncher ? (
                      <UseCasesPageRoute user={user} logout={logout} />
                    ) : (
                      <Navigate to="/" replace />
                    )
                  }
                />
                <Route
                  path="/onboarding"
                  element={<OnboardingRoute user={user} />}
                />
                <Route path="/privilege-demo" element={<PrivilegeDemoPage />} />
                <Route
                  path="/snapshot-import"
                  element={
                    loading ? null : user ? (
                      <>
                        <TopNav user={user} onLogout={logout} />
                        <main className="main-content">
                          <SnapshotImport />
                        </main>
                      </>
                    ) : (
                      <Navigate to="/" replace />
                    )
                  }
                />
                <Route
                  path="/pingcli"
                  element={
                    loading ? null : user ? (
                      <>
                        <TopNav user={user} onLogout={logout} />
                        <main className="main-content">
                          <PingCliPage />
                        </main>
                      </>
                    ) : (
                      <Navigate to="/" replace />
                    )
                  }
                />
                <Route
                  path="/ping-ai-test-lab"
                  element={
                    loading ? null : user ? (
                      <>
                        <TopNav user={user} onLogout={logout} />
                        <main className="main-content">
                          <PingAiTestLabPage />
                        </main>
                      </>
                    ) : (
                      <Navigate to="/" replace />
                    )
                  }
                />
                <Route
                  path="/llama-vscode-guide"
                  element={
                    loading ? null : user ? (
                      <>
                        <TopNav user={user} onLogout={logout} />
                        <main className="main-content">
                          <LlamaVscodeGuidePage />
                        </main>
                      </>
                    ) : (
                      <Navigate to="/" replace />
                    )
                  }
                />
                {/* Monitoring outer routes — explicit so customers navigating from /dashboard don't hit
                    the path="*" inner-Routes catch-all which redirects back to /dashboard */}
                <Route
                  path="/monitoring/*"
                  element={
                    <MonitoringRoutes
                      user={user}
                      logout={logout}
                      AgentFlowPage={AgentFlowPage}
                    />
                  }
                />
                <Route
                  path="/architecture/*"
                  element={<EducationRoutes user={user} logout={logout} />}
                />
                <Route
                  path="/api-traffic"
                  element={<ApiTrafficRoute user={user} logout={logout} />}
                />
                <Route
                  path="/mcp-traffic"
                  element={<McpTrafficRoute user={user} logout={logout} />}
                />
                <Route
                  path="/dev-tools"
                  element={<DevToolsRoute user={user} logout={logout} />}
                />
                <Route
                  path="/sequence-diagram"
                  element={<SequenceDiagramRoute user={user} logout={logout} />}
                />
                {/* Public landing page — available to all users */}
                <Route
                  path="/"
                  element={
                    loading ? null : (
                      <>
                        <TopNav user={user} onLogout={logout} />
                        <main className="main-content">
                          {user?.role === "admin" ? (
                            <Dashboard user={user} onLogout={logout} />
                          ) : (
                            <LandingPage user={user} onLogout={logout} />
                          )}
                        </main>
                      </>
                    )
                  }
                />
                {/* Explicit /dashboard so guests see UserDashboard with demo data, not LandingPage */}
                <Route
                  path="/dashboard"
                  element={
                    loading ? null : (
                      <>
                        <TopNav user={user} onLogout={logout} />
                        <main className="main-content">
                          {user?.role === "admin" ? (
                            <AdminBlockedDashboard user={user} onLogout={logout} />
                          ) : (
                            <DashboardContent user={user} logout={logout} />
                          )}
                        </main>
                      </>
                    )
                  }
                />
                {/* /login is not a real route — redirect to home so stale links or misdirected post-logout URIs land cleanly */}
                <Route path="/login" element={<Navigate to="/" replace />} />
                <Route path="/logout" element={<LogoutPage />} />
                <Route
                  path="/agent"
                  element={<AgentPageRoute user={user} logout={logout} />}
                />
                <Route
                  path="/copilot"
                  element={<CopilotPageRoute user={user} logout={logout} />}
                />
                <Route
                  path="/compliance-modal-popout"
                  element={<ComplianceModalPopout />}
                />
                <Route
                  path="/demo-guide-popout"
                  element={<DemoGuidePopout />}
                />

                <Route
                  path="*"
                  element={
                    !user ? (
                      loading ? null : (
                        <TopNav user={null} onLogout={logout} />
                      )
                    ) : (
                      <>
                        <TopNav user={user} onLogout={logout} />
                        <main className="main-content">
                          <Routes location={backgroundLocation || fullLocation}>
                            <Route
                              path="/"
                              element={
                                user?.role === "admin" ? (
                                  <Dashboard user={user} onLogout={logout} />
                                ) : (
                                  <LandingPage user={user} onLogout={logout} />
                                )
                              }
                            />
                            {/* === Admin routes ===
                              All admin-only routes live inline here, NOT in a
                              separate file. React Router v6 requires <Route>
                              elements to be DIRECT children of <Routes>, so
                              you can't extract them into a wrapper component
                              that returns <Route> fragments — see
                              demo_api_ui/src/__tests__/App.structure.test.js
                              "Render smoke" tests for the failure mode. To
                              add a new admin route, add it to this block and
                              wrap with <AdminRoute user={user}>...</AdminRoute>. */}
                            <Route
                              path="/admin"
                              element={
                                <RequireAdminLogin user={user}>
                                  <Dashboard user={user} onLogout={logout} />
                                </RequireAdminLogin>
                              }
                            />
                            <Route
                              path="/admin/banking"
                              element={
                                <BankingAdminOps
                                  user={user}
                                  onLogout={logout}
                                />
                              }
                            />
                            <Route
                              path="/admin/healthcare"
                              element={
                                <HealthcareAdminOps
                                  user={user}
                                  onLogout={logout}
                                />
                              }
                            />
                            <Route
                              path="/admin/retail"
                              element={
                                <RetailAdminOps
                                  user={user}
                                  onLogout={logout}
                                />
                              }
                            />
                            <Route
                              path="/admin/sporting-goods"
                              element={
                                <SportingGoodsAdminOps
                                  user={user}
                                  onLogout={logout}
                                />
                              }
                            />
                            <Route
                              path="/admin/workforce"
                              element={
                                <WorkforceAdminOps
                                  user={user}
                                  onLogout={logout}
                                />
                              }
                            />
                            <Route
                              path="/admin/vault"
                              element={
                                <RequireAdminLogin user={user}>
                                  <AdminVaultPage />
                                </RequireAdminLogin>
                              }
                            />
                            <Route
                              path="/admin/verticals"
                              element={
                                <RequireAdminLogin user={user}>
                                  <VerticalEditorPage />
                                </RequireAdminLogin>
                              }
                            />
                            <Route
                              path="/themes"
                              element={
                                user ? (
                                  <AdminThemesPage />
                                ) : (
                                  <Navigate to="/" replace />
                                )
                              }
                            />
                            <Route
                              path="/users"
                              element={
                                <RequireAdminLogin user={user}>
                                  <Users user={user} onLogout={logout} />
                                </RequireAdminLogin>
                              }
                            />
                            <Route
                              path="/activity"
                              element={
                                <Navigate
                                  to="/monitoring/activity-log"
                                  replace
                                />
                              }
                            />
                            <Route
                              path="/audit"
                              element={
                                <RequireAdminLogin user={user}>
                                  <AuditPage user={user} />
                                </RequireAdminLogin>
                              }
                            />
                            <Route
                              path="/feature-flags"
                              element={
                                <RequireAdminLogin user={user}>
                                  <FeatureFlagsPage />
                                </RequireAdminLogin>
                              }
                            />
                            <Route
                              path="/llm-config"
                              element={
                                <RequireAdminLogin user={user}>
                                  <LlmConfigPage
                                    user={user}
                                    onLogout={logout}
                                  />
                                </RequireAdminLogin>
                              }
                            />
                            <Route
                              path="/settings"
                              element={
                                <RequireAdminLogin user={user}>
                                  <SecuritySettings
                                    user={user}
                                    onLogout={logout}
                                  />
                                </RequireAdminLogin>
                              }
                            />
                            <Route
                              path="/authorize-config"
                              element={
                                <Navigate
                                  to="/setup?tab=authorize-rules"
                                  replace
                                />
                              }
                            />
                            <Route
                              path="/authz-server-rules"
                              element={<MockAuthzRulesPage />}
                            />
                            <Route
                              path="/pingone-authorize"
                              element={<PingOneAuthorizePage />}
                            />
                            <Route
                              path="/mcp-gateway"
                              element={
                                <Navigate to="/configure?tab=mcp-gateway" replace />
                              }
                            />
                            <Route
                              path="/error-audit"
                              element={
                                <RequireAdminLogin user={user}>
                                  <AdminErrorAuditLog />
                                </RequireAdminLogin>
                              }
                            />
                            <Route
                              path="/oauth-debug-logs"
                              element={
                                <RequireAdminLogin user={user}>
                                  <OAuthDebugLogViewer />
                                </RequireAdminLogin>
                              }
                            />
                            <Route
                              path="/client-registration"
                              element={
                                <RequireAdminLogin user={user}>
                                  <ClientRegistrationPage />
                                </RequireAdminLogin>
                              }
                            />
                            <Route
                              path="/config"
                              element={
                                <Navigate
                                  to="/configure?tab=pingone-config"
                                  replace
                                />
                              }
                            />

                            {/* === Monitoring routes inside the wildcard (these aren't reachable as
                              top-level routes — /api-traffic, /mcp-traffic, /dev-tools are top-level
                              at lines 356-358 and shadow any duplicate here, so don't re-add them.) */}
                            <Route
                              path="/logs"
                              element={
                                <LogsRoute user={user} logout={logout} />
                              }
                            />
                            <Route
                              path="/mcp-inspector"
                              element={
                                <McpInspector user={user} onLogout={logout} />
                              }
                            />
                            <Route
                              path="/pingone-mcp-inspector"
                              element={
                                <PingOneMcpInspector
                                  user={user}
                                  onLogout={logout}
                                />
                              }
                            />
                            <Route
                              path="/webmcp"
                              element={
                                <WebMcpExplainer
                                  user={user}
                                  onLogout={logout}
                                />
                              }
                            />
                            <Route
                              path="/agent-flow-inspector"
                              element={
                                <AgentFlowInspectorRoute
                                  user={user}
                                  logout={logout}
                                />
                              }
                            />

                            {/* === Education / resource routes ===
                              All non-/architecture/* education routes are
                              inlined here. The /architecture/* sub-routes
                              (system, overview, token-flow, flow, phase-266)
                              live in routes/EducationRoutes.js because that
                              component owns its OWN internal <Routes> tree
                              and is a legal route ELEMENT. To add a new
                              education route below /architecture/*, edit
                              routes/EducationRoutes.js. To add any other
                              education/resource route, add it here. */}
                            <Route
                              path="/langchain"
                              element={<LangChainPage />}
                            />
                            <Route
                              path="/mcp-tools"
                              element={<MCPToolsEducation />}
                            />
                            <Route
                              path="/agent-builder"
                              element={
                                user ? (
                                  <AgentBuilderPage />
                                ) : (
                                  <Navigate to="/" replace />
                                )
                              }
                            />
                            <Route
                              path="/agentic-trust"
                              element={<AgenticTrustEducation />}
                            />
                            <Route
                              path="/owasp"
                              element={<OwaspLearnerPage />}
                            />
                            <Route
                              path="/ungoverned-agent"
                              element={<UngovernedAgentPage />}
                            />
                            <Route
                              path="/agent-guardrails"
                              element={<AgentGuardrailsPage />}
                            />
                            <Route
                              path="/agent-onboarding-flow"
                              element={<AgentOnboardingFlowDiagram />}
                            />
                            <Route
                              path="/agent-onboarding-flow-subway"
                              element={<AgentOnboardingSubwayPage />}
                            />
                            <Route
                              path="/agent-onboarding-flow-mermaid"
                              element={<AgentOnboardingMermaidPage />}
                            />
                            <Route
                              path="/agent-studio-preview"
                              element={<AgentStudioPreviewPage />}
                            />
                            <Route
                              path="/discovery-preview"
                              element={<DiscoveryPreviewPage />}
                            />
                            <Route
                              path="/iga-for-ai"
                              element={<IgaForAiPage />}
                            />
                            <Route
                              path="/privileges-gateway-preview"
                              element={<PrivilegesGatewayPreviewPage />}
                            />
                            <Route
                              path="/platform-gaps"
                              element={<PlatformGapsPage />}
                            />
                            <Route
                              path="/actor-token-education"
                              element={<ActorTokenEducation />}
                            />
                            <Route
                              path="/token-compliance"
                              element={
                                user ? (
                                  <AdminTokenComplianceAudit />
                                ) : (
                                  <Navigate to="/" replace />
                                )
                              }
                            />
                            <Route
                              path="/postman"
                              element={
                                <RequireAdminLogin user={user}>
                                  <PostmanCollectionsPage
                                    user={user}
                                    onLogout={logout}
                                  />
                                </RequireAdminLogin>
                              }
                            />
                            <Route
                              path="/scope-audit"
                              element={
                                <RequireAdminLogin user={user}>
                                  <ScopeAuditPage />
                                </RequireAdminLogin>
                              }
                            />
                            <Route
                              path="/scope-reference"
                              element={<ScopeReferencePage />}
                            />
                            <Route
                              path="/oauth/token-display"
                              element={<OAuthTokenDisplayPage />}
                            />
                            <Route
                              path="/resource-server"
                              element={<ResourceServerPage />}
                            />
                            <Route
                              path="/resource-server-cc"
                              element={<ClientCredentialsResourcePage />}
                            />
                            <Route
                              path="/path/mortgage"
                              element={<MortgagePathPage />}
                            />
                            <Route
                              path="/path/feature"
                              element={<VerticalFeaturePage />}
                            />
                            <Route
                              path="/path/apikey-info"
                              element={<ApiKeyPathPage />}
                            />
                            <Route
                              path="/path/dualtoken-info"
                              element={<AccessIdTokenPathPage />}
                            />

                            {/* === Customer + shared routes === */}
                            <Route
                              path="/accounts"
                              element={
                                user?.role === "admin" ? (
                                  <AdminRoute user={user}>
                                    <Accounts user={user} onLogout={logout} />
                                  </AdminRoute>
                                ) : (
                                  <UserAccounts user={user} />
                                )
                              }
                            />
                            <Route
                              path="/user-accounts"
                              element={<UserAccounts user={user} />}
                            />
                            <Route
                              path="/transactions"
                              element={
                                user?.role === "admin" ? (
                                  <AdminRoute user={user}>
                                    <Transactions
                                      user={user}
                                      onLogout={logout}
                                    />
                                  </AdminRoute>
                                ) : (
                                  <UserTransactions user={user} />
                                )
                              }
                            />
                            <Route
                              path="/transaction-consent"
                              element={<TransactionConsentPage user={user} />}
                            />
                            <Route
                              path="/delegated-access"
                              element={
                                <DelegatedAccessPage
                                  user={user}
                                  onLogout={logout}
                                />
                              }
                            />
                            <Route
                              path="/delegation"
                              element={
                                user ? (
                                  <DelegationPage
                                    user={user}
                                    onLogout={logout}
                                  />
                                ) : (
                                  <Navigate to="/" replace />
                                )
                              }
                            />
                            <Route
                              path="/profile"
                              element={<Profile user={user} />}
                            />
                            <Route
                              path="/security"
                              element={<SecurityCenter user={user} />}
                            />
                            <Route
                              path="*"
                              element={<NotFoundPage />}
                            />
                          </Routes>
                          {backgroundLocation &&
                            fullLocation.pathname === "/audit" &&
                            user && (
                              <AuditPage
                                user={user}
                                onClose={() => window.history.back()}
                              />
                            )}
                        </main>
                      </>
                    )
                  }
                />
              </Routes>
              {shouldMountSingleAgent && (
                <AIAgent
                  user={user}
                  onLogout={logout}
                  embeddedFocus={resolveEmbeddedFocus(pathname)}
                  distinctFloatingChrome
                  surfaceHostEl={surfaceHostEl}
                  {...singleAgentSurfaceProps}
                />
              )}
              {!isApiTrafficOnlyPage && appFlags.showEducationPanel && (
                <EducationPanelsHost />
              )}
              {!isApiTrafficOnlyPage && <CIBAPanel />}
              {!isApiTrafficOnlyPage && <CimdSimPanel />}
              {!isApiTrafficOnlyPage && <AgentFlowDiagramPanel />}
              <LogViewer
                isOpen={logViewerOpen}
                onClose={() => setLogViewerOpen(false)}
                categoryFilter={appFlags.logFilterCategories}
              />
              {/* UserDashboard renders EmbeddedAgentDock inside its layout. App-level dock sits in document
              order directly above the footer on non-dashboard routes.
              Guest landing (/) always uses float agent — no bottom dock. */}
              {!loading &&
                !onUserDashboardRoute &&
                !(!user && isPublicMarketingAgentPath(pathname)) && (
                  <EmbeddedAgentDock
                    user={user}
                    agentPlacement={agentPlacement}
                  />
                )}
              {!isApiTrafficOnlyPage && <Footer user={user} />}
              <AuthorizeFallbackListener />
              <ServerRestartModal />
              {downServers && downServers.length > 0 && (
                <DemoServerCheckModal
                  downServers={downServers}
                  onAllUp={markAllUp}
                  onDismiss={dismissForSession}
                />
              )}
              {!isApiTrafficOnlyPage && <DemoTourModal />}
              <MissingCredentialsModal
                isOpen={!!credentialsModal}
                missingFields={credentialsModal?.missingFields || []}
                credentialType={credentialsModal?.credentialType}
                message={credentialsModal?.message}
                onSubmit={async (formData) => {
                  const { submitCredentials } =
                    await import("./services/credentialsService");
                  await submitCredentials(
                    credentialsModal.credentialType,
                    formData,
                  );
                  setCredentialsModal(null);
                }}
                onCancel={() => setCredentialsModal(null)}
              />
              <SpinnerHost />
            </div>
          </ActivityNarrativeProvider>
        </TokenChainProvider>
      </EducationUIProvider>
    </DemoTourProvider>
  );
}

export default function App() {
  return (
    <SpinnerProvider>
      <AgentUiModeProvider>
        <ExchangeModeProvider>
          <Router
            future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
          >
            <EventStreamProvider>
              <IndustryBrandingProvider>
                <VerticalProvider>
                  <SessionTokenProvider>
                    <AppWithAuth />
                  </SessionTokenProvider>
                </VerticalProvider>
              </IndustryBrandingProvider>
            </EventStreamProvider>
          </Router>
        </ExchangeModeProvider>
      </AgentUiModeProvider>
    </SpinnerProvider>
  );
}
