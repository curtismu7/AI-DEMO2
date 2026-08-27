import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  Navigate,
  Route,
  BrowserRouter as Router,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom";
import { ToastContainer } from "react-toastify";
import { MdSwapHoriz } from "react-icons/md";
import "react-toastify/dist/ReactToastify.css";

import AccessIdTokenPathPage from "./components/AccessIdTokenPathPage";
import Accounts from "./components/Accounts";
import { ActorTokenEducation } from "./components/ActorTokenEducation";
import AdminErrorAuditLog from "./components/AdminErrorAuditLog";
import AdminSideNav from "./components/AdminSideNav";
import { appRendersSideNav, isNoChromeRoute, normalizePath } from "./routes/sideNavOwner";
import AdminTokenComplianceAudit from "./components/AdminTokenComplianceAudit";
import AgentBuilderPage from "./components/AgentBuilderPage";
import AgentGuardrailsPage from "./pages/AgentGuardrailsPage";
import AgentOnboardingFlowDiagram from "./components/AgentOnboardingFlowDiagram";
import AgentOnboardingSubwayPage from "./components/AgentOnboardingSubwayPage";
import AgentOnboardingMermaidPage from "./components/AgentOnboardingMermaidPage";
import McpGatewayOauthFlowPage from "./components/McpGatewayOauthFlowPage";
import PrivilegeMcpDiagramPage from "./components/PrivilegeMcpDiagramPage";
import PrivilegeGatewayTopologyPage from "./components/PrivilegeGatewayTopologyPage";
import InvestDualAuthDiagramPage from "./components/InvestDualAuthDiagramPage";
import ExternalDoorDiagramPage from "./components/ExternalDoorDiagramPage";
import GatewayEnforcementMapPage from "./components/GatewayEnforcementMapPage";
import ResourceServerPlacementPage from "./components/ResourceServerPlacementPage";
import ResourceServerCheckpointPage from "./components/ResourceServerCheckpointPage";
import DemoTrackPage from "./pages/DemoTrackPage";
import DelegationChainValuePage from "./pages/DelegationChainValuePage";
import DiscoveryPreviewPage from "./components/agentStudioPreview/DiscoveryPreviewPage";
import IgaForAiPage from "./components/agentStudioPreview/IgaForAiPage";
import PrivilegesGatewayPreviewPage from "./components/agentStudioPreview/PrivilegesGatewayPreviewPage";
import PlatformGapsPage from "./components/agentStudioPreview/PlatformGapsPage";
import AgentFlowDiagramPanel from "./components/AgentFlowDiagramPanel";
import { AgenticTrustEducation } from "./components/AgenticTrustEducation";
import OwaspLearnerPage from "./components/OwaspLearnerPage";
import UngovernedAgentPage from "./components/UngovernedAgentPage";
import AIAgent from "./components/AIAgent";
import ErrorBoundary from "./components/ErrorBoundary";
import OfflineBanner from "./components/OfflineBanner";
import ApiKeyPathPage from "./components/ApiKeyPathPage";
import AuditPage from "./components/AuditPage";
import BankingAdminOps from "./components/BankingAdminOps";
import CIBAPanel from "./components/CIBAPanel";
import CimdSimPanel from "./components/CimdSimPanel";
import ClientCredentialsResourcePage from "./components/ClientCredentialsResourcePage";
import ClientRegistrationPage from "./components/ClientRegistrationPage";
import ComplianceModalPopout from "./components/ComplianceModalPopout";
import Dashboard from "./components/Dashboard";
import DelegationPage from "./components/DelegationPage";
import AgentLifecyclePage from "./pages/AgentLifecyclePage";
import DelegatedCommercePage from "./pages/DelegatedCommercePage";
import DemoGuidePopout from "./components/DemoGuidePopout";
import DemoServerCheckModal from "./components/DemoServerCheckModal";
import { resolveEmbeddedFocus } from "./components/demoAgentSafety";
import EmbeddedAgentDock from "./components/EmbeddedAgentDock";
import EducationPanelsHost from "./components/education/EducationPanelsHost";
import DemoConfigPage from "./components/DemoConfigPage";
import FeatureFlagsPage from "./components/FeatureFlagsPage";
import Footer from "./components/Footer";
import FloatingTokenChainPanel from "./components/FloatingTokenChainPanel";
import TokenTopologyPanel from "./components/TokenTopologyPanel";
import HealthcareAdminOps from "./components/HealthcareAdminOps";
import KillSwitchConfirmModal from "./components/KillSwitchConfirmModal";
import LandingPage from "./components/LandingPage";
import LearningHub from "./components/LearningHub";
import LlmConfigPage from "./components/LlmConfigPage";
import LogoutPage from "./components/LogoutPage";
import LoginSuccessModal from "./components/LoginSuccessModal";
import LogViewer from "./components/LogViewer";
import MgmtApiRunnerPage from "./components/MgmtApiRunnerPage";
import MissingCredentialsModal from "./components/MissingCredentialsModal";
import MockAuthzRulesPage from "./components/MockAuthzRulesPage";
import MortgagePathPage from "./components/MortgagePathPage";
import OAuthDebugLogViewer from "./components/OAuthDebugLogViewer";
import OAuthTokenDisplayPage from "./components/OAuthTokenDisplayPage";
import PingOneAuthorizePage from "./components/PingOneAuthorizePage";
import PingOneAuthorizeCapabilitiesPage from "./pages/PingOneAuthorizeCapabilitiesPage";
import PolicyDecisionTracePage from "./components/PolicyDecisionTracePage";
import PostmanCollectionsPage from "./components/PostmanCollectionsPage";
import Profile from "./components/Profile";
import ResourceServerPage from "./components/ResourceServerPage";
import ResourceServerJourneyPage from "./pages/ResourceServerJourneyPage";
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
import DemoScriptLauncher from "./components/DemoScriptLauncher";
import TokenSecurityTester from "./components/TokenSecurityTester";
import TopNav from "./components/TopNav";
import TransactionConsentPage from "./components/TransactionConsentPage";
import Transactions from "./components/Transactions";
import DemoTourModal from "./components/tour/DemoTourModal";
import UserAccounts from "./components/UserAccounts";
import Users from "./components/Users";
import UserTransactions from "./components/UserTransactions";
import VerifiedBanner from "./components/VerifiedBanner";
import VerticalFeaturePage from "./components/VerticalFeaturePage";
import WebMcpExplainer from "./components/WebMcpExplainer";
import NotFoundPage from "./components/NotFoundPage";
import WorkforceAdminOps from "./components/WorkforceAdminOps";
import UniversityAdminOps from "./components/UniversityAdminOps";
import SupportConsole from "./components/supportConsole/SupportConsole";
import { resolveConsoleVertical } from "./components/supportConsole/supportConsoleConfig";
import GovernmentAdminOps from "./components/GovernmentAdminOps";
import ManufacturingAdminOps from "./components/ManufacturingAdminOps";
import InvestmentAdminOps from "./components/InvestmentAdminOps";
import AbercrombieFitchAdminOps from "./components/AbercrombieFitchAdminOps";
import { ActivityNarrativeProvider } from "./context/ActivityNarrativeContext";
import {
  AgentUiModeProvider,
  useAgentUiMode,
} from "./context/AgentUiModeContext";
import { ThemeProvider } from "./context/ThemeContext";
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
import AgentRegistryPage from "./pages/AgentRegistryPage";
import CheckPage from "./pages/CheckPage";
import TracingPage from "./pages/TracingPage";
import TransactionTracePage from "./pages/TransactionTracePage";
import AutonomousAgentsPage from "./pages/AutonomousAgentsPage";
import FootprintPicksPage from "./pages/FootprintPicksPage";
import FootprintMockGalleryPage from "./pages/FootprintMockGalleryPage";
import FootprintLiveShellPage from "./pages/FootprintLiveShellPage";
import TelemetryPage from "./pages/TelemetryPage";
import LangChainPage from "./pages/LangChainPage";
import SnapshotImport from "./pages/SnapshotImport";
import PersonalAgentStudioPage from "./pages/PersonalAgentStudioPage";
import PersonalAgentClientWindow from "./pages/PersonalAgentClientWindow";
import TransactionTraceEmbedPage from "./pages/TransactionTraceEmbedPage";
import PingCliPage from "./components/PingCliPage";
import LlamaVscodeGuidePage from "./components/LlamaVscodeGuidePage";
import AdminRoute from "./routes/AdminRoute";
import { DashboardContent } from "./routes/CustomerRoutes";
import EducationRoutes from "./routes/EducationRoutes";
import MonitoringRoutes, {
  AgentFlowInspectorRoute,
  ApiTrafficRoute,
  DevToolsRoute,
  LogsRoute,
  McpTrafficRoute,
  NewRelicRoute,
  P1AzRoute,
  PingOneEventsRoute,
  SequenceDiagramRoute,
  TokenExchangeRoute,
} from "./routes/MonitoringRoutes";
import PublicRoutes, {
  CibaApprovalPageRoute,
  CodeExplorerPageRoute,
  CodeSearchPageRoute,
  ConfigurePage,
  CopilotPageRoute,
  DavinciLoginPageRoute,
  DavinciExplainerRoute,
  GraphifyPageRoute,
  IntentBindingLearningPageRoute,
  LiveUseCaseWorkbenchPageRoute,
  MFATestPageRoute,
  OASDemoPageRoute,
  PrivilegeMcpLearningPageRoute,
  AgentGatewayCapabilitiesPageRoute,
  OAuthAcademyPageRoute,
  PrivilegeDemoPageRoute,
  EnterpriseMcpDemoPageRoute,
  GroupPolicyBoardPageRoute,
  PrivilegeMcpClientPageRoute,
  PingOneSetupPageRoute,
  M2mCredentialsSamplePageRoute,
  PingOneTestPageRoute,
  ReportsPageRoute,
  SdkLoginCallbackRoute,
  SdkLoginPageRoute,
  SelfServicePageRoute,
  TokenExchangeTesterPageRoute,
  McpInspectorPageRoute,
  McpGatewayConfigRoute,
  UseCasesPageRoute,
} from "./routes/PublicRoutes";
import RequireAdminLogin from "./routes/RequireAdminLogin";
import SignInRequired from "./routes/SignInRequired";
import SignInPrompt from "./components/SignInPrompt";
import AppShell from "./routes/AppShell";
import { ProtocolPlaygroundPageRoute } from "./routes/ProtocolPlaygroundRoutes";
import { monitorApiHealth } from "./services/bankingRestartNotificationService";
import {
  isBankingAgentDashboardRoute,
  isEmbeddedAgentDockRoute,
  isLiveWorkbenchRoute,
  isAgentLifecycleRoute,
  isEnterpriseMcpDemoRoute,
  isMonitoringRoute,
  isPublicMarketingAgentPath,
  isPingOneAdminAgentRoute,
} from "./utils/embeddedAgentFabVisibility";
import { VerticalEditorPage } from "./vertical/AdminEditor/VerticalEditorPage";
import { VerticalProvider } from "./vertical/VerticalProvider";
import { useVertical } from "./vertical/useVertical";
import { EventStreamProvider } from "./context/EventStreamContext";
import { ProofOfEnforcementProvider } from "./context/ProofOfEnforcementContext";
import "./App.css";

// Browser extension interference detection and handling
const setupBrowserExtensionHandling = () => {
  // Monitor for extension-related errors
  const originalConsoleError = console.error;
  console.error = (...args) => {
    // Only suppress errors whose STACK (not message) references the known extension script.
    // This avoids masking legitimate app bugs that happen to contain similar message text.
    const stack = new Error().stack || '';
    if (stack.includes('bootstrap-autofill-overlay.js')) {
      console.warn(
        "[Browser Extension] Suppressed extension error (matched stack):",
        args[0]?.toString?.().slice(0, 100),
      );
      return;
    }
    originalConsoleError.apply(console, args);
  };

  // Add global error handler for extension interference
  const handleGlobalError = (event) => {
    if (event.error?.stack?.includes("bootstrap-autofill-overlay.js")) {
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
  const pathNorm = normalizePath(pathname);
  // Side-nav ownership (home + no-chrome routes opt out) lives in
  // routes/sideNavOwner.js so AppShell can't render a second one.
  // Same list suppresses the floating agent FAB on bare popup pages.
  const isApiTrafficOnlyPage = isNoChromeRoute(pathNorm);
  const {
    placement: agentPlacement,
    fab: agentFab,
    surfaceHostEl,
    clinicalSplit,
  } = useAgentUiMode();

  const { user, loading, logout, sessionReauth, setSessionReauth } = useAuth();
  const { activeId: activeVerticalId } = useVertical();
  useAdminSkin();
  const { appFlags } = useAppFlags();
  const { downServers, markAllUp, dismissForSession } = useServerHealthCheck();
  useOAuthUrlCleanup();
  const navigate = useNavigate();

  // Kill-switch modal state lives here, not in whatever page/component
  // triggers it, because a successful kill destroys the session — which
  // unmounts anything gated on `user` (AdminSideNav globally, and every
  // `user ? <Page/> : <Navigate to="/"/>` protected route, e.g.
  // /ai-control-plane, /agent-lifecycle) before it could ever show its own
  // result. This component never unmounts on auth changes, so the modal
  // survives long enough to render what actually happened.
  //
  // Callers open it via openKillSwitchModal({ agentId, initialScope,
  // onConfirm, onDismiss }) instead of owning their own modal instance —
  // onConfirm/onDismiss are supplied per-open so each caller keeps its own
  // post-kill behavior (AdminSideNav navigates to /logout; ControlPlaneRoster
  // just updates its roster row) while sharing one modal that outlives them.
  const [killModal, setKillModal] = useState(null);
  const openKillSwitchModal = useCallback((config) => setKillModal(config), []);
  const closeKillSwitchModal = useCallback(() => {
    killModal?.onDismiss?.();
    setKillModal(null);
  }, [killModal]);

  const [agentRevoked, setAgentRevoked] = useState(false);
  const handleKillSwitchConfirm = useCallback(
    async (agentId, reason, scope = "instance") => {
      const response = await fetch(`/api/admin/agent/${agentId}/kill-switch`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason, scope }),
      });
      const body = await response.json().catch(() => ({}));
      // 401 with agent_killed is the expected success response: session revoked at server
      const killed = response.status === 401 && body.error === "agent_killed";
      if (!killed && !response.ok) {
        throw new Error(
          body.error_description ||
            body.message ||
            `Kill switch failed: ${response.status}`,
        );
      }
      setAgentRevoked(true);
      return body;
    },
    [],
  );
  // AdminSideNav's "STOP AGENT" trigger — navigates to /logout on dismiss,
  // but only if this specific open actually killed the agent (not just any
  // prior kill), so a fresh local flag rather than the shared agentRevoked
  // state avoids a stale-closure/timing mismatch between open and dismiss.
  const openAdminStopAgent = useCallback(() => {
    let revokedThisOpen = false;
    openKillSwitchModal({
      agentId: "default-agent",
      initialScope: "instance",
      onConfirm: async (agentId, reason, scope) => {
        const body = await handleKillSwitchConfirm(agentId, reason, scope);
        revokedThisOpen = true;
        return body;
      },
      onDismiss: () => {
        if (revokedThisOpen) navigate("/logout");
      },
    });
  }, [handleKillSwitchConfirm, navigate, openKillSwitchModal]);

  const [logViewerOpen, setLogViewerOpen] = useState(false);
  const [credentialsModal, setCredentialsModal] = useState(null);
  const [showTokenChain, setShowTokenChain] = useState(false);
  const [showTokenTopology, setShowTokenTopology] = useState(false);
  useEffect(() => {
    const onOpen = () => setShowTokenTopology(true);
    window.addEventListener('token-topology-open', onOpen);
    return () => window.removeEventListener('token-topology-open', onOpen);
  }, []);
  useEffect(() => {
    const onOpen = () => setShowTokenChain(true);
    window.addEventListener('floating-token-chain-open', onOpen);
    return () => window.removeEventListener('floating-token-chain-open', onOpen);
  }, []);

  // Post-login success modal. `?oauth=success` is captured on the first render
  // — before useOAuthUrlCleanup strips it — so the modal opens exactly once
  // after a fresh PingOne login (not on every dashboard refresh).
  const [freshLogin] = useState(
    () =>
      typeof window !== "undefined" &&
      new URLSearchParams(window.location.search || "").get("oauth") ===
        "success",
  );
  const [loginSuccessOpen, setLoginSuccessOpen] = useState(false);
  const loginModalShownRef = useRef(false);
  useEffect(() => {
    if (loginModalShownRef.current) return;
    if (!freshLogin || !user || user.hideSuccessScreen) return;
    loginModalShownRef.current = true;
    setLoginSuccessOpen(true);
  }, [freshLogin, user]);

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

  // Live Use-Case Workbench (/use-cases/live) — same middle-column agent
  // placement mechanism as UserDashboard, extended to a second route.
  const onLiveWorkbenchRoute = Boolean(user) && isLiveWorkbenchRoute(pathname);

  const onAgentLifecycleRoute = Boolean(user) && isAgentLifecycleRoute(pathname);

  // Enterprise-Managed MCP Auth demo (/demo/enterprise-mcp) — no inline column
  // host of its own, so it only needs shouldMountSingleAgent below (default
  // floating chrome), not the inline-chrome branch onLiveWorkbenchRoute and
  // onAgentLifecycleRoute get. NO Boolean(user) check: the route is public
  // now (see the route comment below), and a guest still needs the floating
  // agent mounted to try step 2 — same reasoning as onMiddlePlacementInDashboard.
  const onEnterpriseMcpDemoRoute = isEnterpriseMcpDemoRoute(pathname);

  // Landing home (/): show floating agent even when signed out.
  // Suppress float on signed-in / only when UserDashboard owns middle placement.
  const marketingAgentSurface = isPublicMarketingAgentPath(pathname) && !user;

  // Landing /: always show float agent, never bottom dock.
  // No Boolean(user) check — guests on /dashboard get the bottom dock agent
  // (same reasoning as onMiddlePlacementInDashboard: guest must be able to start the demo).
  const hasEmbeddedDockLayout =
    agentPlacement === "bottom" && onEmbeddedDockRoute;

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
    agentPlacement === "middle" && (onUserDashboardRoute || onLiveWorkbenchRoute || pathname === "/dashboard");
  /** Single <AIAgent> portals into the bottom dock host element when present; falls back to document.body otherwise.
   *  onLiveWorkbenchRoute always mounts the agent here regardless of agentPlacement: this route's entire purpose
   *  requires the real agent to be present (narrow, inline), and unlike UserDashboard it renders no dock fallback
   *  of its own — without this, a "bottom"/"none" placement would leave banking-agent-prefill dispatches with
   *  zero listeners. */
  const shouldMountSingleAgent =
    showFloatingAgent ||
    hasEmbeddedDockLayout ||
    onMiddlePlacementInDashboard ||
    onLiveWorkbenchRoute ||
    onAgentLifecycleRoute ||
    onEnterpriseMcpDemoRoute;

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
    singleAgentSurfaceProps = { mode: "inline", embeddedDockBottom: true, splitColumnChrome: true };
  } else if (onMiddlePlacementInDashboard) {
    // Middle column owns the agent surface — render inline so the floating
    // dock chrome doesn't appear inside the column. Same pattern as the
    // clinical-split branch above.
    singleAgentSurfaceProps = { mode: "inline", splitColumnChrome: true };
  } else if (onLiveWorkbenchRoute || onAgentLifecycleRoute) {
    // Both routes' own narrow/right-column host always want the agent,
    // regardless of the user's dashboard-wide placement preference (same
    // reasoning as clinicalSplit).
    singleAgentSurfaceProps = { mode: "inline", splitColumnChrome: true };
  }

  /** Slower default dismiss on public landing so OAuth/agent messages are readable (signed-in routes stay 4s). */
  const toastContainerAutoCloseMs =
    !user && isPublicMarketingAgentPath(pathname) ? 12000 : 4000;

  return (
    <ThemeProvider>
    <DemoTourProvider>
      <EducationUIProvider>
        <TokenChainProvider activePath={pathname}>
          <ProofOfEnforcementProvider vertical={activeVerticalId || undefined} enabled={!!user}>
          <ActivityNarrativeProvider>
            <div
              className={`App end-user-nano${isOnDashboard ? " App--on-dashboard" : ""}${hasEmbeddedDockLayout ? " App--has-embedded-dock" : ""}${sessionReauth ? " App--session-reauth" : ""}`}
            >
              <OfflineBanner />
              <ToastContainer
                position="bottom-left"
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
              {appRendersSideNav({ pathname, user }) && (
                <AdminSideNav
                  user={user}
                  onStopAgentClick={openAdminStopAgent}
                  agentRevoked={agentRevoked}
                />
              )}
              {/* Auth check in flight — every route below renders null until `loading`
                  resolves, which left a blank content area under the side nav/dock.
                  Show a branded loading card in that same slot instead.
                  Skip on / and /dashboard — those routes render immediately for guests. */}
              {loading && pathname !== "/" && pathname !== "/dashboard" && (
                <main className="main-content main-content--auth-loading">
                  <div className="auth-loading-card">
                    <div className="auth-loading-dots">
                      <span className="auth-loading-dot" />
                      <span className="auth-loading-dot" />
                      <span className="auth-loading-dot" />
                    </div>
                    <div className="auth-loading-title">Loading Agent</div>
                    <div className="auth-loading-sub">Checking session and preparing chat...</div>
                  </div>
                </main>
              )}
              <Routes>
                {/* /setup/* sub-routes — no auth required */}
                <Route
                  path="/setup/*"
                  element={<PublicRoutes user={user} logout={logout} />}
                />
                {/* New Relic event stream — public, no session required */}
                <Route
                  path="/monitoring/new-relic"
                  element={<NewRelicRoute user={user} logout={logout} />}
                />
                {/* PingOne webhook events — public, same posture as New Relic */}
                <Route
                  path="/monitoring/pingone-events"
                  element={<PingOneEventsRoute user={user} logout={logout} />}
                />
                {/* PingOne Authorize decisions — public, same posture as the others */}
                <Route
                  path="/monitoring/p1az"
                  element={<P1AzRoute user={user} logout={logout} />}
                />
                {/* RFC 8693 token exchange telemetry — public, same posture as the others */}
                <Route
                  path="/monitoring/token-exchange"
                  element={<TokenExchangeRoute user={user} logout={logout} />}
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
                  path="/m2m-sample"
                  element={
                    <M2mCredentialsSamplePageRoute user={user} logout={logout} />
                  }
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
                  element={<Navigate to="/pingone-authorize?tab=guided" replace />}
                />
                <Route
                  path="/intent-binding-learning"
                  element={
                    <IntentBindingLearningPageRoute user={user} logout={logout} />
                  }
                />
                <Route
                  path="/privilege-mcp-learning"
                  element={
                    <PrivilegeMcpLearningPageRoute user={user} logout={logout} />
                  }
                />
                <Route
                  path="/agent-gateway-capabilities"
                  element={
                    <AgentGatewayCapabilitiesPageRoute user={user} logout={logout} />
                  }
                />
                <Route
                  path="/token-exchange-tester"
                  element={
                    <TokenExchangeTesterPageRoute user={user} logout={logout} />
                  }
                />
                {/* MCP Inspector — top-level (not auth catch-all). Guests under
                  path="*" only get TopNav; this page must remain reachable. */}
                <Route
                  path="/mcp-inspector"
                  element={
                    <Navigate to="/pingone-mcp-inspector?source=banking" replace />
                  }
                />
                <Route
                  path="/pingone-mcp-inspector"
                  element={
                    <McpInspectorPageRoute user={user} logout={logout} />
                  }
                />
                {/* Gateway Inspector — top-level (not auth catch-all). Guests under
                  path="*" only get TopNav; this page must remain reachable. */}
                <Route
                  path="/pinggateway-test"
                  element={
                    <Navigate to="/agent-gateway-inspector?subtab=tester" replace />
                  }
                />
                <Route
                  path="/pinggateway-inspector"
                  element={
                    <Navigate to="/agent-gateway-inspector" replace />
                  }
                />
                <Route
                  path="/agent-gateway-inspector"
                  element={
                    <McpGatewayConfigRoute user={user} logout={logout} />
                  }
                />
                <Route
                  path="/sdk-login"
                  element={<SdkLoginPageRoute />}
                />
                <Route path="/sdk-login/callback" element={<SdkLoginCallbackRoute />} />
                <Route path="/davinci-login" element={<DavinciLoginPageRoute />} />
                <Route path="/davinci-orchestration" element={<DavinciExplainerRoute user={user} logout={logout} />} />
                <Route path="/ciba-approve" element={<CibaApprovalPageRoute />} />
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
                {/* OAuth Academy educational tool — accessible without login */}
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
                          <AiControlPlanePage openKillSwitchModal={openKillSwitchModal} />
                        </main>
                      </>
                    ) : (
                      <SignInRequired />
                    )
                  }
                />
                {/* Agent Registry — any logged-in user, same level as the Control Plane */}
                <Route
                  path="/agent-registry"
                  element={
                    loading ? null : user ? (
                      <>
                        <TopNav user={user} onLogout={logout} />
                        <main className="main-content">
                          <AgentRegistryPage />
                        </main>
                      </>
                    ) : (
                      <SignInRequired />
                    )
                  }
                />
                {/* Legacy Servers URL — inventory is now a section on /check */}
                <Route path="/servers" element={<Navigate to="/check" replace />} />
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
                      <SignInRequired />
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
                      <SignInRequired />
                    )
                  }
                />
                <Route
                  path="/transaction-trace"
                  element={
                    loading ? null : user ? (
                      <>
                        <TopNav user={user} onLogout={logout} />
                        <main className="main-content">
                          <TransactionTracePage />
                        </main>
                      </>
                    ) : (
                      <SignInRequired />
                    )
                  }
                />
                {/* AI footprint costume-shell picker — SE tool, any logged-in user */}
                <Route
                  path="/demo/footprint-picks"
                  element={
                    loading ? null : user ? (
                      <>
                        <TopNav user={user} onLogout={logout} />
                        <main className="main-content">
                          <FootprintPicksPage />
                        </main>
                      </>
                    ) : (
                      <SignInRequired />
                    )
                  }
                />
                <Route
                  path="/demo/footprint-mocks"
                  element={
                    loading ? null : user ? (
                      <>
                        <TopNav user={user} onLogout={logout} />
                        <main className="main-content">
                          <FootprintMockGalleryPage />
                        </main>
                      </>
                    ) : (
                      <SignInRequired />
                    )
                  }
                />
                {/* Live costume shell — one route per catalog entry (mockSelection.MOCK_CATALOG[*].route).
                    Keeps the app's TopNav + side nav: the costume is the demo surface, not a takeover. */}
                <Route
                  path="/demo/:shellSlug"
                  element={
                    loading ? null : (
                      <>
                        <TopNav user={user} onLogout={logout} />
                        <main className="main-content">
                          <FootprintLiveShellPage />
                        </main>
                      </>
                    )
                  }
                />
                <Route
                  path="/telemetry"
                  element={
                    loading ? null : (
                      <>
                        <TopNav user={user} onLogout={logout} />
                        <main className="main-content">
                          <TelemetryPage />
                        </main>
                      </>
                    )
                  }
                />
                {/* Use-Case Launcher — any logged-in user; flag-gated (ff_use_cases_launcher default ON) */}
                <Route
                  path="/use-cases"
                  element={
                    loading ? null : !user ? (
                      <SignInRequired />
                    ) : appFlags.showUseCaseLauncher ? (
                      <UseCasesPageRoute
                        user={user}
                        logout={logout}
                        onStopAgentClick={openAdminStopAgent}
                      />
                    ) : (
                      // Flag denial, not an auth failure — home is correct here.
                      <Navigate to="/" replace />
                    )
                  }
                />
                <Route
                  path="/use-cases/live"
                  element={
                    loading ? null : !user ? (
                      <SignInRequired />
                    ) : appFlags.showUseCaseLauncher ? (
                      <LiveUseCaseWorkbenchPageRoute user={user} logout={logout} />
                    ) : (
                      // Flag denial, not an auth failure — home is correct here.
                      <Navigate to="/" replace />
                    )
                  }
                />
                {/* Group policy board — live decision per vertical; the page the
                    group demo is for. Signed-in users only (it reads their own
                    directory membership). */}
                <Route
                  path="/group-policy"
                  element={
                    loading ? null : user ? (
                      <GroupPolicyBoardPageRoute user={user} logout={logout} />
                    ) : (
                      <SignInRequired />
                    )
                  }
                />
                {/* MCP Enterprise-Managed Authorization demo. Public: the
                    explainer and token-chain filmstrip render for anyone.
                    Arming the flag / running the scenario both call
                    authenticated BFF endpoints that fail closed on their own
                    (armEnterpriseMcpDemo's 401 surfaces as a friendly toast,
                    readEnterpriseMcpDemoState never throws) — no separate
                    sign-in gate needed here. */}
                <Route
                  path="/demo/enterprise-mcp"
                  element={
                    loading ? null : (
                      <EnterpriseMcpDemoPageRoute user={user} logout={logout} />
                    )
                  }
                />
                <Route
                  path="/privilege-demo"
                  element={
                    <PrivilegeDemoPageRoute user={user} logout={logout} />
                  }
                />
                <Route
                  path="/privilege-mcp-client"
                  element={
                    <PrivilegeMcpClientPageRoute user={user} logout={logout} />
                  }
                />
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
                      <SignInRequired />
                    )
                  }
                />
                <Route
                  path="/pingcli"
                  element={
                    // Public route — no login required.
                    <AppShell user={user} logout={logout}>
                      <PingCliPage />
                    </AppShell>
                  }
                />
                <Route
                  path="/personal-agent"
                  element={
                    // Public route — no login required (same pattern as /pingcli).
                    <AppShell user={user} logout={logout}>
                      <PersonalAgentStudioPage />
                    </AppShell>
                  }
                />
                <Route
                  path="/personal-agent/client"
                  element={
                    // Bare route for pop-out window — no nav shell.
                    <PersonalAgentClientWindow />
                  }
                />
                <Route
                  path="/transaction-trace/embed/:correlationId"
                  element={
                    // Bare route — the reel an external MCP client's reel_url
                    // opens (LM Studio link / LibreChat artifact iframe). No
                    // session: the id is the capability. See routes/mcpFacade.js.
                    <TransactionTraceEmbedPage />
                  }
                />
                {/* Legacy Test Lab URL → unified Demo check */}
                <Route path="/ping-ai-test-lab" element={<Navigate to="/check" replace />} />
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
                      <SignInRequired />
                    )
                  }
                />
                <Route
                  path="/protocol-playground"
                  element={
                    loading ? null : user ? (
                      <ProtocolPlaygroundPageRoute user={user} logout={logout} />
                    ) : (
                      <SignInRequired />
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
                  path="/sequence-diagram"
                  element={<SequenceDiagramRoute user={user} logout={logout} />}
                />
                <Route
                  path="/dev-tools"
                  element={<DevToolsRoute user={user} logout={logout} />}
                />
                {/* Public landing page — available to all users */}
                <Route
                  path="/"
                  element={
                    loading ? null : (
                      <>
                        <TopNav user={user} onLogout={logout} />
                        <main className="main-content">
                          <LandingPage user={user} onLogout={logout} />
                        </main>
                      </>
                    )
                  }
                />
                {/* Explicit /dashboard so guests see UserDashboard with demo data, not LandingPage.
                    No loading guard — DashboardContent handles user=null with demo data immediately.
                    Admins get the same surface: the dashboard is viewable without a customer
                    token, and DashboardContent falls back to demo data when the backend answers
                    admin_token_forbidden. It used to render AdminBlockedDashboard here, a wall
                    whose only way forward was a role switch that signed the admin out. */}
                <Route
                  path="/dashboard"
                  element={
                    <>
                      <TopNav user={user} onLogout={logout} />
                      <main className="main-content">
                        <DashboardContent user={user} logout={logout} />
                      </main>
                    </>
                  }
                />
                {/* /login is not a real route — redirect to home so stale links or misdirected post-logout URIs land cleanly */}
                <Route path="/login" element={<Navigate to="/" replace />} />
                <Route path="/logout" element={<LogoutPage />} />
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
                    loading ? null : (
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
                            {/* /admin is the PingOne admin dashboard. It was
                                briefly repointed at the support console (#1486)
                                and reverted (#REVERT): the console does not yet
                                carry what this page does — group membership,
                                the PingOne user record on lookup, the full
                                token chain — so the repoint lost real
                                capability. It moves back once the console is at
                                parity. The support console lives at
                                /admin/<vertical> meanwhile. */}
                            <Route
                              path="/admin"
                              element={
                                <RequireAdminLogin user={user}>
                                  <Dashboard user={user} onLogout={logout} />
                                </RequireAdminLogin>
                              }
                            />
                            {/* Kept from #1486 so the Platform Admin nav entry
                                and any bookmark still resolve. Same component. */}
                            <Route
                              path="/admin/pingone"
                              element={
                                <RequireAdminLogin user={user}>
                                  <Dashboard user={user} onLogout={logout} />
                                </RequireAdminLogin>
                              }
                            />
                            <Route
                              path="/admin/banking"
                              element={
                                <RequireAdminLogin user={user}>
                                  <BankingAdminOps
                                    user={user}
                                    onLogout={logout}
                                  />
                                </RequireAdminLogin>
                              }
                            />
                            <Route
                              path="/admin/healthcare"
                              element={
                                <RequireAdminLogin user={user}>
                                  <HealthcareAdminOps
                                    user={user}
                                    onLogout={logout}
                                  />
                                </RequireAdminLogin>
                              }
                            />
                            <Route
                              path="/admin/retail"
                              element={
                                <RequireAdminLogin user={user}>
                                  <RetailAdminOps
                                    user={user}
                                    onLogout={logout}
                                  />
                                </RequireAdminLogin>
                              }
                            />
                            <Route
                              path="/admin/sporting-goods"
                              element={
                                <RequireAdminLogin user={user}>
                                  <SportingGoodsAdminOps
                                    user={user}
                                    onLogout={logout}
                                  />
                                </RequireAdminLogin>
                              }
                            />
                            <Route
                              path="/admin/workforce"
                              element={
                                <RequireAdminLogin user={user}>
                                  <WorkforceAdminOps
                                    user={user}
                                    onLogout={logout}
                                  />
                                </RequireAdminLogin>
                              }
                            />
                            <Route
                              path="/admin/university"
                              element={
                                <RequireAdminLogin user={user}>
                                  <UniversityAdminOps
                                    user={user}
                                    onLogout={logout}
                                  />
                                </RequireAdminLogin>
                              }
                            />
                            <Route
                              path="/admin/government"
                              element={
                                <RequireAdminLogin user={user}>
                                  <GovernmentAdminOps
                                    user={user}
                                    onLogout={logout}
                                  />
                                </RequireAdminLogin>
                              }
                            />
                            <Route
                              path="/admin/manufacturing"
                              element={
                                <RequireAdminLogin user={user}>
                                  <ManufacturingAdminOps
                                    user={user}
                                    onLogout={logout}
                                  />
                                </RequireAdminLogin>
                              }
                            />
                            <Route
                              path="/admin/investment"
                              element={
                                <RequireAdminLogin user={user}>
                                  <InvestmentAdminOps
                                    user={user}
                                    onLogout={logout}
                                  />
                                </RequireAdminLogin>
                              }
                            />
                            <Route
                              path="/admin/abercrombie-fitch"
                              element={
                                <RequireAdminLogin user={user}>
                                  <AbercrombieFitchAdminOps
                                    user={user}
                                    onLogout={logout}
                                  />
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
                              // Fully public — no session/user gate. Matches the
                              // backend, which mounts vertical-themes with no
                              // auth middleware at all (see verticalThemes.js).
                              element={<AdminThemesPage />}
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
                              path="/demo-config"
                              element={
                                <RequireAdminLogin user={user}>
                                  <DemoConfigPage />
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
                              path="/mgmt-api"
                              element={<MgmtApiRunnerPage />}
                            />
                            <Route
                              path="/pingone-authorize-capabilities"
                              element={<PingOneAuthorizeCapabilitiesPage />}
                            />
                            <Route
                              path="/policy-decision-trace"
                              element={<PolicyDecisionTracePage />}
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
                              top-level routes — /api-traffic, /mcp-traffic are top-level
                              and shadow any duplicate here, so don't re-add them.) */}
                            <Route
                              path="/logs"
                              element={
                                <LogsRoute user={user} logout={logout} />
                              }
                            />
                            <Route
                              path="/token-security"
                              element={<TokenSecurityTester />}
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
                              element={<Navigate to="/mcp-inspector" replace />}
                            />
                            <Route
                              path="/agent-builder"
                              element={
                                <RequireAdminLogin user={user}>
                                  <AgentBuilderPage />
                                </RequireAdminLogin>
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
                              path="/mcp-gateway-oauth-flow"
                              element={<McpGatewayOauthFlowPage />}
                            />
                            <Route
                              path="/privilege-mcp-diagrams"
                              element={<PrivilegeMcpDiagramPage />}
                            />
                            <Route
                              path="/privilege-gateway-topologies"
                              element={<PrivilegeGatewayTopologyPage />}
                            />
                            <Route
                              path="/demo-track"
                              element={<DemoTrackPage />}
                            />
                            <Route
                              path="/delegation-chain-value"
                              element={<DelegationChainValuePage />}
                            />
                            <Route
                              path="/invest-dual-auth"
                              element={<InvestDualAuthDiagramPage />}
                            />
                            <Route
                              path="/external-door-diagrams"
                              element={<ExternalDoorDiagramPage />}
                            />
                            <Route
                              path="/gateway-enforcement-map"
                              element={<GatewayEnforcementMapPage />}
                            />
                            <Route
                              path="/resource-server-placement"
                              element={<ResourceServerPlacementPage />}
                            />
                            <Route
                              path="/resource-server-checkpoint"
                              element={<ResourceServerCheckpointPage />}
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
                              // Public on purpose, including its feature
                              // toggle — see auth-requirements.json. No guard
                              // here, and authz:verify fails if that drifts.
                              path="/autonomous-agents"
                              element={<AutonomousAgentsPage />}
                            />
                            <Route
                              path="/token-compliance"
                              element={
                                user ? (
                                  <AdminTokenComplianceAudit />
                                ) : (
                                  // Catch-all shell already supplies TopNav +
                                  // main-content — bare prompt card only.
                                  <SignInPrompt />
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
                              path="/rs/olb"
                              element={<ResourceServerJourneyPage />}
                            />
                            <Route
                              path="/rs/invest"
                              element={<ResourceServerJourneyPage />}
                            />
                            <Route
                              path="/rs/api"
                              element={<ResourceServerJourneyPage />}
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
                              path="/delegation"
                              element={
                                <RequireAdminLogin user={user}>
                                  <DelegationPage
                                    user={user}
                                    onLogout={logout}
                                  />
                                </RequireAdminLogin>
                              }
                            />
                            <Route
                              path="/agent-lifecycle"
                              element={
                                <RequireAdminLogin user={user}>
                                  <AgentLifecyclePage />
                                </RequireAdminLogin>
                              }
                            />
                            <Route
                              path="/delegated-commerce"
                              element={
                                <RequireAdminLogin user={user}>
                                  <DelegatedCommercePage user={user} />
                                </RequireAdminLogin>
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
                <ErrorBoundary>
                  <AIAgent
                    user={user}
                    onLogout={logout}
                    embeddedFocus={resolveEmbeddedFocus(pathname)}
                    distinctFloatingChrome
                    surfaceHostEl={surfaceHostEl}
                    onStopAgentClick={openAdminStopAgent}
                    {...(isPingOneAdminAgentRoute(pathname)
                      ? { forceVertical: "pingone-admin" }
                      : {})}
                    {...singleAgentSurfaceProps}
                  />
                </ErrorBoundary>
              )}
              {!isApiTrafficOnlyPage && appFlags.showEducationPanel && (
                <EducationPanelsHost />
              )}
              {!isApiTrafficOnlyPage && <CIBAPanel />}
              {!isApiTrafficOnlyPage && <CimdSimPanel />}
              {!isApiTrafficOnlyPage && <AgentFlowDiagramPanel />}
              {!isApiTrafficOnlyPage && (
                <VerifiedBanner onExpand={() => setShowTokenChain(true)} />
              )}
              {!isApiTrafficOnlyPage && (
                <FloatingTokenChainPanel
                  isOpen={showTokenChain}
                  onClose={() => setShowTokenChain(false)}
                />
              )}
              <TokenTopologyPanel
                isOpen={showTokenTopology}
                onClose={() => setShowTokenTopology(false)}
              />
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
                !onLiveWorkbenchRoute &&
                !(!user && isPublicMarketingAgentPath(pathname)) && (
                  <ErrorBoundary>
                    <EmbeddedAgentDock
                      user={user}
                      agentPlacement={agentPlacement}
                    />
                  </ErrorBoundary>
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
              <KillSwitchConfirmModal
                isOpen={!!killModal}
                agentId={killModal?.agentId}
                initialScope={killModal?.initialScope}
                onCancel={closeKillSwitchModal}
                onConfirm={killModal?.onConfirm}
              />
              <LoginSuccessModal
                user={user}
                isOpen={loginSuccessOpen}
                onClose={() => setLoginSuccessOpen(false)}
                onDontShowAgain={() => {
                  fetch("/api/auth/oauth/user/success-screen-preference", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    credentials: "include",
                    body: JSON.stringify({ hideSuccessScreen: true }),
                  }).catch(() => {});
                }}
              />
              <SpinnerHost />
              {/* Global overlay — off on no-chrome routes (embedded reel). */}
              {isApiTrafficOnlyPage ? null : <DemoScriptLauncher user={user} />}
            </div>
          </ActivityNarrativeProvider>
          </ProofOfEnforcementProvider>
        </TokenChainProvider>
      </EducationUIProvider>
    </DemoTourProvider>
    </ThemeProvider>
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
