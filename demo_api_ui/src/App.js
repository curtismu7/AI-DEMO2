import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import installModalEnterDefault from './utils/modalEnterDefault';
import {
  Navigate,
  Route,
  BrowserRouter as Router,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom";
import { ToastContainer } from "react-toastify";
import { initSignInService } from "./utils/signInService";
import { MdSwapHoriz } from "react-icons/md";
import "react-toastify/dist/ReactToastify.css";

import AccessIdTokenPathPage from "./components/AccessIdTokenPathPage";
import Accounts from "./components/Accounts";
import { ActorTokenEducation } from "./components/ActorTokenEducation";
import AdminErrorAuditLog from "./components/AdminErrorAuditLog";
import AdminSideNav from "./components/AdminSideNav";
import DrawOverlay from "./components/DrawOverlay";
import PageGuide from "./components/PageGuide";
import { appRendersSideNav, isNoChromeRoute, normalizePath } from "./routes/sideNavOwner";
import AdminTokenComplianceAudit from "./components/AdminTokenComplianceAudit";
import AgentBuilderPage from "./components/AgentBuilderPage";
const AgentGuardrailsPage = lazy(() => import("./pages/AgentGuardrailsPage"));
import AgentOnboardingFlowDiagram from "./components/AgentOnboardingFlowDiagram";
import AgentOnboardingSubwayPage from "./components/AgentOnboardingSubwayPage";
import AgentOnboardingMermaidPage from "./components/AgentOnboardingMermaidPage";
import McpGatewayOauthFlowPage from "./components/McpGatewayOauthFlowPage";
import PrivilegeMcpDiagramPage from "./components/PrivilegeMcpDiagramPage";
const PrivilegeAiPoliciesDemoPage = lazy(() => import("./pages/PrivilegeAiPoliciesDemoPage"));
const PrivilegePfTokenDemoPage = lazy(() => import("./pages/PrivilegePfTokenDemoPage"));
const P1ThirdPartyExchangePage = lazy(() => import("./pages/P1ThirdPartyExchangePage"));
import PrivilegeGatewayTopologyPage from "./components/PrivilegeGatewayTopologyPage";
const PrivilegeDocsIndexPage = lazy(() => import("./pages/PrivilegeDocsIndexPage"));
const SkillsIndexPage = lazy(() => import("./pages/SkillsIndexPage"));
import InvestDualAuthDiagramPage from "./components/InvestDualAuthDiagramPage";
import ExternalDoorDiagramPage from "./components/ExternalDoorDiagramPage";
import DemoArchSlidesPage, { Id4aiSlidesRoute } from "./components/DemoArchSlidesPage";
import DemoStepsLifelineAuditPage from "./components/DemoStepsLifelineAuditPage";
import DemoMapPage from "./components/DemoMapPage";
import GatewayEnforcementMapPage from "./components/GatewayEnforcementMapPage";
import ResourceServerPlacementPage from "./components/ResourceServerPlacementPage";
import PrivilegeFirstGatewayPage from "./components/PrivilegeFirstGatewayPage";
import PersonalAgentDesignPage from "./components/personalAgent/PersonalAgentDesignPage";
const UhgChatgptMcpFlowPage = lazy(() => import("./pages/UhgChatgptMcpFlowPage"));
const GatewayClaimsPage = lazy(() => import("./pages/GatewayClaimsPage"));
const UnitedPersonalAgentFlowPage = lazy(() => import("./pages/UnitedPersonalAgentFlowPage"));
const PersonalAgentFlowPage = lazy(() => import("./pages/PersonalAgentFlowPage"));
import PersonalAgentReviewPage from "./components/personalAgent/PersonalAgentReviewPage";
import CimdPrivilegePage from "./components/cimdPrivilege/CimdPrivilegePage";
import A2aArchitecturePage from "./components/a2aArchitecture/A2aArchitecturePage";
import DiagramsIndexPage from "./components/diagramsIndex/DiagramsIndexPage";
import UseCaseDiagramPage from "./components/UseCaseDiagramPage";
import UseCaseDiagramsGalleryPage from "./components/UseCaseDiagramsGalleryPage";
import ResourceServerCheckpointPage from "./components/ResourceServerCheckpointPage";
const DemoTrackPage = lazy(() => import("./pages/DemoTrackPage"));
const DemoSummaryPage = lazy(() => import("./pages/DemoSummaryPage"));
const DelegationChainValuePage = lazy(() => import("./pages/DelegationChainValuePage"));
const McpShowcasePage = lazy(() => import("./pages/McpShowcasePage"));
import DiscoveryPreviewPage from "./components/agentStudioPreview/DiscoveryPreviewPage";
import AgentStudioPreviewPage from "./components/agentStudioPreview/AgentStudioPreviewPage";
import IgaForAiPage from "./components/agentStudioPreview/IgaForAiPage";
import PrivilegesGatewayPreviewPage from "./components/agentStudioPreview/PrivilegesGatewayPreviewPage";
import PlatformGapsPage from "./components/agentStudioPreview/PlatformGapsPage";
import AgentFlowDiagramPanel from "./components/AgentFlowDiagramPanel";
import { AgenticTrustEducation } from "./components/AgenticTrustEducation";
import OwaspLearnerPage from "./components/OwaspLearnerPage";
const PrivilegeAiDemoPage = lazy(() => import("./pages/PrivilegeAiDemoPage"));
const McpScannerPage = lazy(() => import("./pages/McpScannerPage"));
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
import SecurityRiskDashboard from "./components/SecurityRiskDashboard";
import DelegationPage from "./components/DelegationPage";
const AgentLifecyclePage = lazy(() => import("./pages/AgentLifecyclePage"));
const DelegatedCommercePage = lazy(() => import("./pages/DelegatedCommercePage"));
import DemoGuidePopout from "./components/DemoGuidePopout";
import DemoServerCheckModal from "./components/DemoServerCheckModal";
import { resolveEmbeddedFocus } from "./components/demoAgentSafety";
import EducationPanelsHost from "./components/education/EducationPanelsHost";
import DemoConfigPage from "./components/DemoConfigPage";
import FeatureFlagsPage from "./components/FeatureFlagsPage";
import Footer from "./components/Footer";
import FloatingTokenChainPanel from "./components/FloatingTokenChainPanel";
import TokenTopologyPanel from "./components/TokenTopologyPanel";
import SystemFlowMapPanel from "./components/SystemFlowMap";
import HealthcareAdminOps from "./components/HealthcareAdminOps";
import KillSwitchConfirmModal from "./components/KillSwitchConfirmModal";
import LandingPage from "./components/LandingPage";
import LearningHub from "./components/LearningHub";
import { AcademyLessonRoute, AcademyLegacyPrefixRoute, AgentIdentityAcademyRoute } from "./routes/AcademyRoutes";
const ShadowAiDetectorPage = lazy(() => import("./pages/ShadowAiDetectorPage"));
const LearningProtocolLabPage = lazy(() => import("./pages/LearningProtocolLabPage"));
const SpinnerShowcasePage = lazy(() => import("./pages/SpinnerShowcasePage"));
import LlmConfigPage from "./components/LlmConfigPage";
import LogoutPage from "./components/LogoutPage";
import LoginSuccessModal from "./components/LoginSuccessModal";
import AdminRequiredModal from "./components/AdminRequiredModal";
import LogViewer from "./components/LogViewer";
import MgmtApiRunnerPage from "./components/MgmtApiRunnerPage";
import MissingCredentialsModal from "./components/MissingCredentialsModal";
import MockAuthzRulesPage from "./components/MockAuthzRulesPage";
import MortgagePathPage from "./components/MortgagePathPage";
import OAuthDebugLogViewer from "./components/OAuthDebugLogViewer";
import OAuthTokenDisplayPage from "./components/OAuthTokenDisplayPage";
import PingOneAuthorizePage from "./components/PingOneAuthorizePage";
const PingOneAuthorizeCapabilitiesPage = lazy(() => import("./pages/PingOneAuthorizeCapabilitiesPage"));
import PolicyDecisionTracePage from "./components/PolicyDecisionTracePage";
import PostmanCollectionsPage from "./components/PostmanCollectionsPage";
import Profile from "./components/Profile";
import ResourceServerPage from "./components/ResourceServerPage";
const ResourceServerJourneyPage = lazy(() => import("./pages/ResourceServerJourneyPage"));
import RetailAdminOps from "./components/RetailAdminOps";
import ScopeAuditPage from "./components/ScopeAuditPage";
import ScopeReferencePage from "./components/ScopeReferencePage";
const SecretRotationPage = lazy(() => import("./pages/SecretRotationPage"));
import SecurityCenter from "./components/SecurityCenter";
import SecuritySettings from "./components/SecuritySettings";
import ServerRestartModal from "./components/ServerRestartModal";
import AuthorizeFallbackListener from "./components/AuthorizeFallbackListener";
import SessionReauthBanner from "./components/SessionReauthBanner";
import PiFlowSignInModal from "./components/PiFlowSignInModal";
import PingFederateDownModal from "./components/PingFederateDownModal";
import PingFederateRequiredModal from "./components/PingFederateRequiredModal";
import SportingGoodsAdminOps from "./components/SportingGoodsAdminOps";
import SpinnerHost from "./components/shared/SpinnerHost";
import AuthLoadingScreen from "./components/shared/AuthLoadingScreen";
import DemoScriptLauncher from "./components/DemoScriptLauncher";
import TokenSecurityTester from "./components/TokenSecurityTester";
import TopNav from "./components/TopNav";
import TransactionConsentPage from "./components/TransactionConsentPage";
import Transactions from "./components/Transactions";
import DemoTourModal from "./components/tour/DemoTourModal";
import WelcomeWizard from "./components/WelcomeWizard";
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
const SkinStudioPage = lazy(() => import("./pages/SkinStudioPage"));
const AiControlPlanePage = lazy(() => import("./pages/AiControlPlanePage"));
const ControlPlanePage = lazy(() => import("./pages/ControlPlanePage"));
const AgentRegistryPage = lazy(() => import("./pages/AgentRegistryPage"));
const CheckPage = lazy(() => import("./pages/CheckPage"));
const McpDiscoveryPage = lazy(() => import("./pages/McpDiscoveryPage"));
const TracingPage = lazy(() => import("./pages/TracingPage"));
const TransactionTracePage = lazy(() => import("./pages/TransactionTracePage"));
const AutonomousAgentsPage = lazy(() => import("./pages/AutonomousAgentsPage"));
const FootprintPicksPage = lazy(() => import("./pages/FootprintPicksPage"));
const FootprintMockGalleryPage = lazy(() => import("./pages/FootprintMockGalleryPage"));
const FootprintLiveShellPage = lazy(() => import("./pages/FootprintLiveShellPage"));
const TelemetryPage = lazy(() => import("./pages/TelemetryPage"));
const McpObservabilityPage = lazy(() => import("./pages/McpObservabilityPage"));
const LangChainPage = lazy(() => import("./pages/LangChainPage"));
const SnapshotImport = lazy(() => import("./pages/SnapshotImport"));
const PersonalAgentStudioPage = lazy(() => import("./pages/PersonalAgentStudioPage"));
const PersonalAgentLearnPage = lazy(() => import("./pages/PersonalAgentLearnPage"));
const WorkloadAgentsPage = lazy(() => import("./pages/WorkloadAgentsPage"));
const PersonalAgentClientWindow = lazy(() => import("./pages/PersonalAgentClientWindow"));
const DotWorkbenchPage = lazy(() => import("./pages/DotWorkbenchPage"));
const MusePage = lazy(() => import("./pages/MusePage"));
const GovernanceTimelinePage = lazy(() => import("./pages/GovernanceTimelinePage"));
const EmbeddedWorkerPage = lazy(() => import("./pages/EmbeddedWorkerPage"));
const TransactionTraceEmbedPage = lazy(() => import("./pages/TransactionTraceEmbedPage"));
import PingCliPage from "./components/PingCliPage";
import PromptFooPage from "./components/PromptFooPage";
import LlamaVscodeGuidePage from "./components/LlamaVscodeGuidePage";
const AgenticAccessConsolePage = lazy(() => import("./pages/AgenticAccessConsolePage"));
const PingAiProductPage = lazy(() => import("./pages/PingAiProductPage"));
const PingOneProtectBrowserDemo = lazy(() => import("./pages/PingOneProtectBrowserDemo"));
const PingOneVerifyRecognizePage = lazy(() => import("./pages/PingOneVerifyRecognizePage"));
import AdminRoute from "./routes/AdminRoute";
const HostedRegistrationPage = lazy(() => import("./pages/HostedRegistrationPage"));
const HostedRegistrationAdminPage = lazy(() => import("./pages/HostedRegistrationAdminPage"));
import { DashboardContent } from "./routes/CustomerRoutes";
import EducationRoutes from "./routes/EducationRoutes";
import MonitoringRoutes, {
  AgentFlowInspectorRoute,
  ApiTrafficRoute,
  DevToolsRoute,
  LoginFlowRoute,
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
  DavinciLoginCallbackRoute,
  DavinciLoginConfirmedRoute,
  OrchestrationSdkExplainerRoute,
  DavinciSdkLoginRoute,
  DavinciLoginGuidePageRoute,
  PingFederateDavinciKitRoute,
  GraphifyPageRoute,
  GuidedJourneyRoute,
  StandaloneDemoLauncherRoute,
  IntentBindingLearningPageRoute,
  A2AProtocolLearningPageRoute,
  JevLearningPageRoute,
  JevDemoGalleryPageRoute,
  LiveUseCaseWorkbenchPageRoute,
  MFATestPageRoute,
  OASDemoPageRoute,
  PrivilegeMcpLearningPageRoute,
  AgentGatewayCapabilitiesPageRoute,
  AgentGatewayAuthorizationLessonPageRoute,
  ExternalAgentLessonPageRoute,
  OAuthAcademyPageRoute,
  PrivilegeDemoPageRoute,
  EnterpriseMcpDemoPageRoute,
  PingFederateIdJagExplainerPageRoute,
  PingFederateIdJagDemoPageRoute,
  PingFederateIdJagDiagramPageRoute,
  PingFederateIdJagImplementationPageRoute,
  IdJagPlaygroundPageRoute,
  IdJagPlaygroundDiagramPageRoute,
  IdJagLearnPageRoute,
  IdJagInspectPageRoute,
  PingFederateAiAgentPageRoute,
  AicTokenExchangePageRoute,
  OboDemoPageRoute,
  DigitalWorkerPageRoute,
  AuthorizationFlowPageRoute,
  ChatgptLoginPageRoute,
  GroupPolicyBoardPageRoute,
  PageCatalogPageRoute,
  PrivilegeMcpClientPageRoute,
  PrivilegeA2aPageRoute,
  LlmGatewayPageRoute,
  LlmTestPageRoute,
  IntentInspectorPageRoute,
  AuditAgentPageRoute,
  SpiffePingoneBridgePageRoute,
  PingOneSetupPageRoute,
  M2mCredentialsSamplePageRoute,
  StandaloneIndexRoute,
  StandaloneSampleRoute,
  StandaloneRunnerRoute,
  StandaloneAiPoliciesRoute,
  SampleM2mPageRoute,
  SampleCustomAdminRolePageRoute,
  SampleUserRegistrationPageRoute,
  SampleMfaDemoPageRoute,
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
const GroupPolicyBoardPage = lazy(() => import("./pages/GroupPolicyBoardPage"));
import AppShell from "./routes/AppShell";
import { ProtocolPlaygroundPageRoute } from "./routes/ProtocolPlaygroundRoutes";
import apiClient from "./services/apiClient";
import { agentFlowDiagram } from "./services/agentFlowDiagramService";
import { monitorApiHealth } from "./services/bankingRestartNotificationService";
import {
  isBankingAgentDashboardRoute,
  isLiveWorkbenchRoute,
  isAgentLifecycleRoute,
  isEnterpriseMcpDemoRoute,
  isMonitoringRoute,
  isDemoControlsRoute,
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
export function AgentFlowPage() {
  useEffect(() => {
    // Open through the service, not the `agent-flow-diagram-open` event: this
    // effect runs before <AgentFlowDiagramPanel/> (a later sibling in App) has
    // attached its listener, so on a fresh load the event was dropped and the
    // panel never opened. Same steps the panel's listener takes.
    agentFlowDiagram.open();
    if (!agentFlowDiagram.getState().steps.length) agentFlowDiagram.reset();
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

  const { user, signIn, loading, logout, sessionReauth, setSessionReauth } = useAuth();
  const { activeId: activeVerticalId } = useVertical();
  useAdminSkin();
  const { appFlags } = useAppFlags();
  const { downServers, markAllUp, dismissForSession } = useServerHealthCheck();
  useOAuthUrlCleanup();
  const navigate = useNavigate();

  // Warm the sign-in service's cached availability before any CTA can click.
  useEffect(() => { initSignInService(); }, []);

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
  const [showSystemFlow, setShowSystemFlow] = useState(false);
  const [agentFlowSurface, setAgentFlowSurface] = useState("popout");
  useEffect(() => {
    const onSurface = (event) => setAgentFlowSurface(event.detail?.surface || "none");
    window.addEventListener("agent-flow-diagram-surface", onSurface);
    return () => window.removeEventListener("agent-flow-diagram-surface", onSurface);
  }, []);
  useEffect(() => {
    const onOpen = () => setShowTokenTopology(true);
    const onClose = () => setShowTokenTopology(false);
    window.addEventListener('token-topology-open', onOpen);
    window.addEventListener('token-topology-close', onClose);
    return () => {
      window.removeEventListener('token-topology-open', onOpen);
      window.removeEventListener('token-topology-close', onClose);
    };
  }, []);
  useEffect(() => {
    const onOpen = () => setShowSystemFlow(true);
    window.addEventListener('system-flow-open', onOpen);
    return () => window.removeEventListener('system-flow-open', onOpen);
  }, []);
  useEffect(() => {
    const onOpen = () => setShowTokenChain(true);
    window.addEventListener('floating-token-chain-open', onOpen);
    return () => window.removeEventListener('floating-token-chain-open', onOpen);
  }, []);
  // Ctrl+Shift+B — the keyboard twin of the vertical-logo magic link: fully
  // hide / bring back the side nav (AdminSideNav listens for this event).
  useEffect(() => {
    const onKey = (e) => {
      if (e.ctrlKey && e.shiftKey && (e.key === 'B' || e.key === 'b')) {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('admin-sidenav-hidden-toggle'));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(installModalEnterDefault, []);

  // Post-login success modal. `?oauth=success` is captured on the first render
  // — before useOAuthUrlCleanup strips it — so the modal opens exactly once
  // after a fresh PingOne login (not on every dashboard refresh).
  const [freshLogin] = useState(
    () =>
      typeof window !== "undefined" &&
      new URLSearchParams(window.location.search || "").get("oauth") ===
        "success",
  );
  // `?adminRequired=<path>` is set by the BFF when a signed-in non-admin opens
  // an admin-only doc page (/api/docs, /api/reference). Those open in a bare
  // tab with no SPA, so the server redirects here to show the modal. Captured
  // on first render for the same reason as `?oauth=success` above — the URL
  // cleanup strips it.
  const [adminRequiredPath] = useState(() =>
    typeof window !== "undefined"
      ? new URLSearchParams(window.location.search || "").get("adminRequired")
      : null,
  );
  const [adminRequiredOpen, setAdminRequiredOpen] = useState(
    () => !!adminRequiredPath,
  );

  const [loginSuccessOpen, setLoginSuccessOpen] = useState(false);
  const loginModalShownRef = useRef(false);
  useEffect(() => {
    if (loginModalShownRef.current) return;
    if (!freshLogin || !user || user.hideSuccessScreen) return;
    loginModalShownRef.current = true;
    setLoginSuccessOpen(true);
  }, [freshLogin, user]);

  // First-run welcome wizard. Auto-open is currently OFF (see below). It used to auto-open once per browser — but never on the
  // same load as the post-login success modal (freshLogin), which owns that
  // moment. `?welcome=1` forces it open (shareable link, no login needed);
  // re-openable any time from the TopNav Welcome button and the Learning Hub.
  const [welcomeOpen, setWelcomeOpen] = useState(() => {
    try {
      if (new URLSearchParams(window.location.search || "").get("welcome") === "1") return true;
      if (window.location.pathname === "/welcome") return true;
      // First-visit auto-open is off for now (2026-10-17); re-enable with:
      // return !localStorage.getItem("demo_welcome_seen") && !freshLogin;
      return false;
    } catch {
      return false;
    }
  });
  // TopNav "Welcome" button and the Learning Hub launcher request the wizard
  // via this event (they sit outside the state owner).
  useEffect(() => {
    const onOpen = () => setWelcomeOpen(true);
    window.addEventListener("welcome-wizard:open", onOpen);
    return () => window.removeEventListener("welcome-wizard:open", onOpen);
  }, []);

  // `?login_trace=<id>` — set by the BFF's OAuth callback (routes/oauthUser.js)
  // alongside `?oauth=success`. Captured the same way as freshLogin, above,
  // before useOAuthUrlCleanup strips it. Fetches the recorded login sequence
  // once and renders it in the Agent Flow panel so it's visible the moment
  // you land back signed in — see loginFlowTraceService.js for why this can't
  // be a live stream (the browser was away at PingOne for the middle of it).
  const [loginTraceId] = useState(() =>
    typeof window !== "undefined"
      ? new URLSearchParams(window.location.search || "").get("login_trace")
      : null,
  );
  const loginTraceShownRef = useRef(false);
  useEffect(() => {
    if (loginTraceShownRef.current || !loginTraceId) return;
    loginTraceShownRef.current = true;
    apiClient
      .get(`/api/auth/oauth/user/login-trace/${loginTraceId}`)
      .then(({ data }) => {
        if (data?.steps?.length) agentFlowDiagram.showLoginFlow(data.steps);
      })
      .catch(() => {}); // best-effort — a missing/expired trace just skips the diagram
  }, [loginTraceId]);

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

  const onMonitoringRoute = isMonitoringRoute(pathname);

  // Use-case launch, inspector / token tools and setup pages: the floating agent
  // (and with it the Demo Controls pill) is available there too. NO Boolean(user)
  // check, unlike the monitoring pages: the pill must be reachable before sign-in,
  // same reasoning as onEnterpriseMcpDemoRoute.
  const onDemoControlsRoute = isDemoControlsRoute(pathname);

  const agentDisabled = appFlags.agentUiMode === "disabled";

  const showFloatingAgent =
    !agentDisabled &&
    !isApiTrafficOnlyPage &&
    (marketingAgentSurface ||
      (Boolean(user) && agentPlacement === "none") ||
      (Boolean(user) && onMonitoringRoute) ||
      onDemoControlsRoute ||
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
    onMiddlePlacementInDashboard ||
    onLiveWorkbenchRoute ||
    onAgentLifecycleRoute ||
    onEnterpriseMcpDemoRoute;

  // Inline chrome (no floating frame/drag) for the surfaces that host the agent
  // in a column; float and everything else keep the default floating chrome.
  // The bottom-dock branch that used to sit between these two went with the dock
  // layout — see AgentUiModeContext for why 'bottom' no longer exists.
  let singleAgentSurfaceProps = {};
  if (clinicalSplit) {
    singleAgentSurfaceProps = { mode: "inline", splitColumnChrome: true };
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
              className={`App end-user-nano${isOnDashboard ? " App--on-dashboard" : ""}${sessionReauth ? " App--session-reauth" : ""}`}
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
              <PiFlowSignInModal />
              <PingFederateDownModal />
              <PingFederateRequiredModal />
              <DrawOverlay />
              {sessionReauth && (
                <SessionReauthBanner
                  message={sessionReauth.message}
                  detail={sessionReauth.detail}
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
                  <AuthLoadingScreen label="Loading Agent…" />
                </main>
              )}
              {/* A render error on any page used to unmount the whole app (a white
                  screen); only AIAgent had a boundary. resetKey clears it on navigation. */}
              <ErrorBoundary resetKey={pathname}>
              <Routes>
                <Route
                  path="/request-access"
                  element={
                    <AppShell user={user} logout={logout}>
                      <HostedRegistrationPage />
                    </AppShell>
                  }
                />
                <Route
                  path="/spinner-showcase"
                  element={
                    <AppShell user={user} logout={logout}>
                      <SpinnerShowcasePage />
                    </AppShell>
                  }
                />
                <Route
                  path="/hosted-registrations"
                  element={
                    <AppShell user={user} logout={logout}>
                      <AdminRoute user={user}>
                        <HostedRegistrationAdminPage />
                      </AdminRoute>
                    </AppShell>
                  }
                />
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
                <Route
                  path="/governance-timeline"
                  element={
                    <AppShell user={user} logout={logout}>
                      <GovernanceTimelinePage />
                    </AppShell>
                  }
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
                {/* Standalone sample URLs — the same sample pages with no
                    AppShell around them, for sharing or screen-sharing without
                    the demo. Public: they render no session-dependent UI. */}
                <Route path="/standalone" element={<StandaloneIndexRoute />} />
                <Route
                  path="/standalone/runner/m2m"
                  element={<StandaloneRunnerRoute />}
                />
                <Route
                  path="/standalone/ai-policies"
                  element={<StandaloneAiPoliciesRoute />}
                />
                {/* The first version of this page was a browser Cedar toy at /standalone/cedar; keep shared links alive. */}
                <Route
                  path="/standalone/cedar"
                  element={<Navigate to="/standalone/ai-policies" replace />}
                />
                <Route
                  path="/standalone/:sampleId"
                  element={<StandaloneSampleRoute />}
                />
                {/* PingOne sample apps — what each teaches, plus its code in 5 stacks */}
                <Route
                  path="/samples/m2m-credentials"
                  element={<SampleM2mPageRoute user={user} logout={logout} />}
                />
                <Route
                  path="/samples/custom-admin-role"
                  element={
                    <SampleCustomAdminRolePageRoute user={user} logout={logout} />
                  }
                />
                <Route
                  path="/samples/user-registration"
                  element={
                    <SampleUserRegistrationPageRoute user={user} logout={logout} />
                  }
                />
                <Route
                  path="/samples/mfa-demo"
                  element={<SampleMfaDemoPageRoute user={user} logout={logout} />}
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
                  path="/jev-learning"
                  element={<JevLearningPageRoute user={user} logout={logout} />}
                />
                <Route
                  path="/jev-demos"
                  element={<Navigate to="/jev-demos/pr-review" replace />}
                />
                <Route
                  path="/jev-demos/:demoId"
                  element={<JevDemoGalleryPageRoute user={user} logout={logout} />}
                />
                {/* Public: the concept, the Agent Card and the no-bearer probe
                    all render signed out. The delegation run inside is
                    sign-in gated by the BFF and prompts inline. */}
                <Route
                  path="/a2a-protocol-learning"
                  element={
                    <A2AProtocolLearningPageRoute user={user} logout={logout} />
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
                  path="/agent-gateway-authorization"
                  element={
                    <AgentGatewayAuthorizationLessonPageRoute user={user} logout={logout} />
                  }
                />
                <Route
                  path="/external-agents/:agentId"
                  element={
                    <ExternalAgentLessonPageRoute user={user} logout={logout} />
                  }
                />
                <Route
                  path="/learning-lab/:lab"
                  element={
                    <AppShell user={user} logout={logout}>
                      <LearningProtocolLabPage />
                    </AppShell>
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
                    <Navigate to="/agent-gateway-capabilities" replace />
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
                  element={<SdkLoginPageRoute user={user} logout={logout} />}
                />
                <Route path="/sdk-login/callback" element={<SdkLoginCallbackRoute />} />
                <Route
                  path="/protect-auth-demo"
                  element={
                    <AppShell user={user} logout={logout}>
                      <PingOneProtectBrowserDemo />
                    </AppShell>
                  }
                />
                <Route path="/protect-auth-demo/popout" element={<PingOneProtectBrowserDemo popout />} />
                <Route path="/davinci-login/callback" element={<DavinciLoginCallbackRoute user={user} logout={logout} />} />
                <Route path="/davinci-login/confirmed" element={<DavinciLoginConfirmedRoute user={user} logout={logout} />} />
                <Route path="/davinci-orchestration-sdk" element={<DavinciSdkLoginRoute user={user} logout={logout} />} />
                <Route path="/davinci-widget" element={<DavinciLoginGuidePageRoute user={user} logout={logout} />} />
                <Route path="/davinci-sdk" element={<OrchestrationSdkExplainerRoute user={user} logout={logout} />} />
                <Route path="/pingfederate-davinci-kit" element={<PingFederateDavinciKitRoute user={user} logout={logout} />} />
                <Route path="/orchestration-sdk" element={<Navigate to="/davinci-sdk" replace />} />
                <Route path="/davinci-orchestration" element={<Navigate to="/davinci-sdk" replace />} />
                <Route path="/davinci-sdk-login" element={<Navigate to="/davinci-orchestration-sdk" replace />} />
                <Route path="/davinci-login-guide" element={<Navigate to="/davinci-widget" replace />} />
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
                  path="/spiffe-pingone-bridge"
                  element={<SpiffePingoneBridgePageRoute user={user} logout={logout} />}
                />
                <Route
                  path="/academy/journey"
                  element={
                    <GuidedJourneyRoute
                      loading={loading}
                      user={user}
                      logout={logout}
                    />
                  }
                />
                <Route
                  path="/academy/demos"
                  element={
                    <StandaloneDemoLauncherRoute
                      loading={loading}
                      user={user}
                      logout={logout}
                    />
                  }
                />
                <Route
                  path="/academy/identity"
                  element={
                    <AgentIdentityAcademyRoute
                      loading={loading}
                      user={user}
                      logout={logout}
                    />
                  }
                />
                <Route
                  path="/academy/academy/:lessonId/:mode"
                  element={<AcademyLegacyPrefixRoute />}
                />
                <Route
                  path="/academy/:lessonId/:mode"
                  element={<AcademyLessonRoute loading={loading} user={user} logout={logout} />}
                />
                <Route
                  path="/academy/:lessonId"
                  element={<AcademyLessonRoute loading={loading} user={user} logout={logout} />}
                />
                <Route
                  path="/ai-gateway/shadow-ai-detector"
                  element={
                    loading ? null : (
                      <>
                        <TopNav user={user} onLogout={logout} />
                        <main className="main-content">
                          <ShadowAiDetectorPage />
                        </main>
                      </>
                    )
                  }
                />
                <Route
                  path="/ping-products/verify-recognize"
                  element={
                    <AppShell user={user} logout={logout}>
                      <main className="ai-product-main">
                        <PingOneVerifyRecognizePage />
                      </main>
                    </AppShell>
                  }
                />
                <Route
                  path="/ai-products/core"
                  element={
                    <AppShell user={user} logout={logout}>
                      <main className="ai-product-main">
                        <PingAiProductPage product="core" />
                      </main>
                    </AppShell>
                  }
                />
                <Route
                  path="/ai-products/gateway"
                  element={
                    <AppShell user={user} logout={logout}>
                      <main className="ai-product-main">
                        <PingAiProductPage product="gateway" />
                      </main>
                    </AppShell>
                  }
                />
                <Route
                  path="/ai-products/authorize"
                  element={
                    <AppShell user={user} logout={logout}>
                      <main className="ai-product-main">
                        <PingAiProductPage product="authorize" />
                      </main>
                    </AppShell>
                  }
                />
                <Route
                  path="/ai-products/protect"
                  element={
                    <AppShell user={user} logout={logout}>
                      <main className="ai-product-main">
                        <PingAiProductPage product="protect" />
                      </main>
                    </AppShell>
                  }
                />
                <Route
                  path="/ai-products/privilege-llm"
                  element={
                    <AppShell user={user} logout={logout}>
                      <main className="ai-product-main">
                        <PingAiProductPage product="privilegeLlm" />
                      </main>
                    </AppShell>
                  }
                />
                <Route
                  path="/ai-products/privilege-a2a"
                  element={
                    <AppShell user={user} logout={logout}>
                      <main className="ai-product-main">
                        <PingAiProductPage product="privilegeA2a" />
                      </main>
                    </AppShell>
                  }
                />
                <Route
                  path="/ai-products/privilege-mcp"
                  element={
                    <AppShell user={user} logout={logout}>
                      <main className="ai-product-main">
                        <PingAiProductPage product="privilegeMcp" />
                      </main>
                    </AppShell>
                  }
                />
                <Route
                  path="/reports"
                  element={<ReportsPageRoute user={user} logout={logout} />}
                />
                {/* Agentic Control Plane — the five zones, any logged-in user. */}
                <Route
                  path="/control-plane"
                  element={
                    loading ? null : user ? (
                      <>
                        <TopNav user={user} onLogout={logout} />
                        <main className="main-content">
                          <ControlPlanePage />
                        </main>
                      </>
                    ) : (
                      <SignInRequired />
                    )
                  }
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
                  path="/mcp-discovery"
                  element={
                    loading ? null : user ? (
                      <>
                        <TopNav user={user} onLogout={logout} />
                        <main className="main-content">
                          <McpDiscoveryPage />
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
                          <ErrorBoundary>
                            <FootprintLiveShellPage />
                          </ErrorBoundary>
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
                {/* Bare full-page variant for sharing from the handoff page: no side nav, header or
                    footer. Signed-out visitors get the sign-in prompt alone (SignInRequired would
                    bring the top nav back). */}
                <Route
                  path="/group-policy/full"
                  element={loading ? null : user ? <GroupPolicyBoardPage /> : <SignInPrompt message="The group policy board reads your own directory membership, so it needs a signed-in session." />}
                />
                {/* Page catalog — signed-in users only (it edits their own side-nav prefs). */}
                <Route
                  path="/page-catalog"
                  element={
                    loading ? null : user ? (
                      <PageCatalogPageRoute user={user} logout={logout} />
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
                  path="/pingfederate-id-jag"
                  element={<PingFederateIdJagExplainerPageRoute user={user} logout={logout} />}
                />
                <Route
                  path="/pingfederate-id-jag/demo"
                  element={<PingFederateIdJagDemoPageRoute user={user} logout={logout} />}
                />
                <Route
                  path="/pingfederate-id-jag/diagram"
                  element={<PingFederateIdJagDiagramPageRoute user={user} logout={logout} />}
                />
                <Route
                  path="/pingfederate-id-jag/implementation"
                  element={<PingFederateIdJagImplementationPageRoute user={user} logout={logout} />}
                />
                <Route
                  path="/pingfederate-id-jag/playground"
                  element={<IdJagPlaygroundPageRoute user={user} logout={logout} />}
                />
                <Route
                  path="/pingfederate-id-jag/learn"
                  element={<IdJagLearnPageRoute user={user} logout={logout} />}
                />
                <Route
                  path="/pingfederate-id-jag/inspect"
                  element={<IdJagInspectPageRoute user={user} logout={logout} />}
                />
                <Route
                  path="/pingfederate-id-jag/playground/diagram/:mode"
                  element={<IdJagPlaygroundDiagramPageRoute user={user} logout={logout} />}
                />
                <Route
                  path="/pingfederate-ai-agent"
                  element={<PingFederateAiAgentPageRoute user={user} logout={logout} />}
                />
                {/* AIC token exchange — signed-in users only (its tokens live in their BFF session). */}
                <Route
                  path="/aic-token-exchange"
                  element={
                    loading ? null : user ? (
                      <AicTokenExchangePageRoute user={user} logout={logout} />
                    ) : (
                      <SignInRequired />
                    )
                  }
                />
                {/* OBO demo: signed-in users only (the delegation runs on their BFF session). */}
                <Route
                  path="/obo-demo"
                  element={
                    loading ? null : user ? (
                      <OboDemoPageRoute user={user} logout={logout} />
                    ) : (
                      <SignInRequired />
                    )
                  }
                />
                <Route
                  path="/chatgpt-login"
                  element={
                    loading ? null : user ? (
                      <ChatgptLoginPageRoute user={user} logout={logout} />
                    ) : (
                      <SignInRequired />
                    )
                  }
                />
                <Route
                  path="/digital-worker"
                  element={<DigitalWorkerPageRoute user={user} logout={logout} />}
                />
                <Route
                  path="/authorization-flow"
                  element={<AuthorizationFlowPageRoute user={user} logout={logout} />}
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
                  path="/privilege-a2a"
                  element={
                    <PrivilegeA2aPageRoute user={user} logout={logout} />
                  }
                />
                <Route
                  path="/llm-gateway"
                  element={
                    loading ? null : user ? (
                      <LlmGatewayPageRoute user={user} logout={logout} />
                    ) : (
                      <SignInRequired />
                    )
                  }
                />
                <Route
                  path="/intent-inspector"
                  element={
                    <RequireAdminLogin user={user}>
                      <IntentInspectorPageRoute user={user} logout={logout} />
                    </RequireAdminLogin>
                  }
                />
                <Route
                  path="/llm-test"
                  element={
                    loading ? null : user ? (
                      <LlmTestPageRoute user={user} logout={logout} />
                    ) : (
                      <SignInRequired />
                    )
                  }
                />
                <Route
                  path="/audit-agent"
                  element={
                    <AuditAgentPageRoute user={user} logout={logout} />
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
                  path="/promptfoo"
                  element={
                    // Public route — no login required (same pattern as /pingcli).
                    <AppShell user={user} logout={logout}>
                      <PromptFooPage user={user} />
                    </AppShell>
                  }
                />
                <Route
                  path="/personal-agent"
                  element={
                    // Public route — no login required (same pattern as /pingcli).
                    <AppShell user={user} logout={logout}>
                      <PersonalAgentStudioPage user={user} />
                    </AppShell>
                  }
                />
                <Route
                  path="/personal-agent/full"
                  element={
                    // Bare full-page variant for sharing from the handoff page —
                    // no side nav, header or footer. Same page component; bare drops
                    // the chrome-height subtraction from its fixed-height shell.
                    <PersonalAgentStudioPage user={user} bare />
                  }
                />
                <Route
                  path="/workload-agents"
                  element={
                    <AppShell user={user} logout={logout}>
                      <WorkloadAgentsPage user={user} />
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
                  path="/personal-agent/dot"
                  element={
                    <AppShell user={user} logout={logout}>
                      <DotWorkbenchPage user={user} />
                    </AppShell>
                  }
                />
                {/* Muse: real PingOne sign-in + delegation. Signed-in only (the BFF keys the flow to the session). */}
                <Route
                  path="/personal-agent/muse"
                  element={
                    loading ? null : user ? (
                      <AppShell user={user} logout={logout}>
                        <MusePage />
                      </AppShell>
                    ) : (
                      <SignInRequired />
                    )
                  }
                />
                <Route
                  path="/personal-agent/learn"
                  element={
                    // Standalone, teaching-first Personal Agent Studio: no side nav, header or footer. Signed-out
                    // visitors see the page with a sign-in prompt (the agent needs a session to run).
                    <PersonalAgentLearnPage user={user} />
                  }
                />
                <Route
                  path="/personal-agent/dot/full"
                  element={
                    // Bare full-page variant for sharing from the handoff page —
                    // no side nav, header or footer. Same page component; bare
                    // drops the chrome-height subtraction and moves the diagram
                    // below the fixed-height sheet.
                    <DotWorkbenchPage user={user} bare />
                  }
                />
                <Route
                  path="/embedded-worker"
                  element={
                    <AppShell user={user} logout={logout}>
                      <EmbeddedWorkerPage />
                    </AppShell>
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
                {/* Public /welcome — shareable welcome-wizard link (email, docs).
                    Always opens the wizard regardless of the demo_welcome_seen
                    flag; behind the oauth-bypass ingress so it needs no hosted
                    access session. */}
                <Route
                  path="/welcome"
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
                                user ? (
                                  <Dashboard user={user} onLogout={logout} />
                                ) : (
                                  <LandingPage user={user} onLogout={logout} />
                                )
                              }
                            />
                            <Route
                              path="/mcp-observability"
                              element={
                                user ? <McpObservabilityPage /> : <SignInPrompt />
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
                            <Route
                              path="/security-dashboard"
                              element={
                                <RequireAdminLogin user={user}>
                                  <SecurityRiskDashboard />
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
                            {/* Public on purpose — read-only/illustrative, meant to be
                                shared without requiring an admin session. */}
                            <Route
                              path="/admin/agentic-access-console"
                              element={<AgenticAccessConsolePage user={user} />}
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
                              path="/admin/walbuy"
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
                              path="/admin/skin-studio"
                              // Admin-gated like /admin/verticals: logo upload and
                              // duplicate are admin write surfaces. Theme picks via
                              // ThemeZonePanel are publicly writable on the backend
                              // (deliberate — see verticalThemes.js) and remain so.
                              element={
                                <RequireAdminLogin user={user}>
                                  <SkinStudioPage />
                                </RequireAdminLogin>
                              }
                            />
                            <Route
                              path="/themes"
                              // Legacy alias — the Themes admin moved to the
                              // Skin Studio (T7). Kept public to match the old
                              // route; Skin Studio itself is admin-gated.
                              element={<Navigate to="/admin/skin-studio" replace />}
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
                            {/* Any logged-in user, not admin-only — deliberate, per
                                auth-requirements.json "/secret-rotation": "user". */}
                            <Route
                              path="/secret-rotation"
                              element={
                                loading ? null : user ? (
                                  <SecretRotationPage />
                                ) : (
                                  <SignInRequired />
                                )
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
                            <Route
                              path="/login-flow"
                              element={<LoginFlowRoute />}
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
                                loading ? null : user ? (
                                  <AgentBuilderPage />
                                ) : (
                                  <SignInRequired />
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
                              path="/privilege-for-ai"
                              element={<PrivilegeAiDemoPage />}
                            />
                            <Route
                              path="/mcp-scanner"
                              element={<McpScannerPage />}
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
                            {/* The live demo, inside the app shell so the side nav stays (/standalone/ai-policies is the walkthrough). */}
                            <Route
                              path="/privilege-ai-policies"
                              element={<PrivilegeAiPoliciesDemoPage />}
                            />
                            {/* PingFederate token on Privilege: live run through the BFF (run needs a session; the page is public). */}
                            {/* PingOne token exchange with third-party JWTs (Ping UAT guide, Oct 2026). Mock, no live call. */}
                            <Route
                              path="/p1-third-party-exchange"
                              element={<P1ThirdPartyExchangePage />}
                            />
                            <Route
                              path="/privilege-pf-token"
                              element={<PrivilegePfTokenDemoPage />}
                            />
                            {/* What gateway v1.261024 added: nested-claim gate + AgentCore posture. Explains only, no live call. */}
                            <Route
                              path="/gateway-claims"
                              element={<GatewayClaimsPage />}
                            />
                            <Route
                              path="/privilege-cedar"
                              element={<Navigate to="/privilege-ai-policies" replace />}
                            />
                            <Route
                              path="/privilege-docs-index"
                              element={<PrivilegeDocsIndexPage />}
                            />
                            <Route
                              path="/claude-skills"
                              element={<SkillsIndexPage />}
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
                              path="/demo-summary"
                              element={<DemoSummaryPage />}
                            />
                            <Route
                              path="/delegation-chain-value"
                              element={<DelegationChainValuePage />}
                            />
                            {/* Gateway capability showcases. One component, two
                                configs — the pages differ only in which policy
                                the gateway enforces. */}
                            <Route
                              path="/weather-mcp"
                              element={<McpShowcasePage capability="weather" />}
                            />
                            <Route
                              path="/brave-mcp"
                              element={<McpShowcasePage capability="brave" />}
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
                              path="/demo-arch-slides/workload-agents"
                              element={<DemoArchSlidesPage slide="workload-agents" />}
                            />
                            <Route
                              path="/demo-arch-slides/ciba-hitl"
                              element={<DemoArchSlidesPage slide="ciba-hitl" />}
                            />
                            <Route
                              path="/demo-arch-slides/id-jag"
                              element={<DemoArchSlidesPage slide="id-jag" />}
                            />
                            <Route
                              path="/demo-arch-slides/obo-assistant"
                              element={<DemoArchSlidesPage slide="obo-assistant" />}
                            />
                            <Route
                              path="/demo-arch-slides/coding-agents"
                              element={<DemoArchSlidesPage slide="coding-agents" />}
                            />
                            <Route
                              path="/id4ai-slides/:slideId"
                              element={<Id4aiSlidesRoute />}
                            />
                            <Route
                              path="/demo-arch-slides/control-plane"
                              element={<DemoArchSlidesPage slide="control-plane" />}
                            />
                            <Route
                              path="/demo-steps-lifeline-audit"
                              element={<DemoStepsLifelineAuditPage />}
                            />
                            <Route
                              path="/demo-map"
                              element={<DemoMapPage />}
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
                              path="/privilege-first-gateway"
                              element={<PrivilegeFirstGatewayPage />}
                            />
                            <Route
                              path="/personal-agent-design"
                              element={<PersonalAgentDesignPage variant="target" />}
                            />
                            <Route
                              path="/personal-agent-flow"
                              element={<PersonalAgentFlowPage />}
                            />
                            <Route
                              path="/uhg-chatgpt-mcp-flow"
                              element={
                                // Customer architecture: signed-in users only.
                                loading ? null : user ? <UhgChatgptMcpFlowPage /> : <SignInPrompt message="This customer architecture needs a signed-in session." />
                              }
                            />
                            <Route
                              path="/united-personal-agent-flow"
                              element={<UnitedPersonalAgentFlowPage />}
                            />
                            <Route
                              path="/personal-agent-dual-gateway"
                              element={<PersonalAgentDesignPage variant="dual" />}
                            />
                            <Route
                              path="/personal-agent-review"
                              element={<PersonalAgentReviewPage />}
                            />
                            <Route
                              path="/cimd-privilege"
                              element={<CimdPrivilegePage />}
                            />
                            <Route
                              path="/a2a-architecture"
                              element={<A2aArchitecturePage />}
                            />
                            <Route
                              path="/diagrams"
                              element={<DiagramsIndexPage />}
                            />
                            <Route
                              path="/use-case-diagrams"
                              element={<UseCaseDiagramsGalleryPage />}
                            />
                            <Route
                              path="/use-case-diagrams/:ucId"
                              element={<UseCaseDiagramPage />}
                            />
                            <Route
                              path="/resource-server-checkpoint"
                              element={<ResourceServerCheckpointPage />}
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
                              element={
                                loading ? null : user ? (
                                  <SecurityCenter user={user} />
                                ) : (
                                  /* This route sits inside the shell that already
                                     renders TopNav; SignInRequired adds its own. */
                                  <SignInPrompt message="This page needs a signed-in session." />
                                )
                              }
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
              </ErrorBoundary>
              <PageGuide />
              {shouldMountSingleAgent && (
                <ErrorBoundary>
                  <AIAgent
                    user={user}
                    onLogout={logout}
                    embeddedFocus={resolveEmbeddedFocus(pathname)}
                    distinctFloatingChrome
                    surfaceHostEl={surfaceHostEl}
                    onStopAgentClick={openAdminStopAgent}
                    collapsedDockPill={onDemoControlsRoute}
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
              {!isApiTrafficOnlyPage && (
                <AgentFlowDiagramPanel
                  enabled={agentFlowSurface === "popout" || agentFlowSurface === "both"}
                />
              )}
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
              <SystemFlowMapPanel
                isOpen={showSystemFlow}
                onClose={() => setShowSystemFlow(false)}
              />
              <LogViewer
                isOpen={logViewerOpen}
                onClose={() => setLogViewerOpen(false)}
                categoryFilter={appFlags.logFilterCategories}
              />
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
              {!isApiTrafficOnlyPage && (
                <WelcomeWizard open={welcomeOpen} onClose={() => setWelcomeOpen(false)} />
              )}
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
              <AdminRequiredModal
                wantedPath={adminRequiredPath}
                isOpen={adminRequiredOpen}
                onClose={() => setAdminRequiredOpen(false)}
              />
              <LoginSuccessModal
                user={user}
                signIn={signIn}
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
                    <Suspense fallback={null}>
                      <AppWithAuth />
                    </Suspense>
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
