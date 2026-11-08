import lazyWithRetry from "../utils/lazyWithRetry";
import { Navigate, Route, Routes, useSearchParams } from "react-router-dom";
import AppShell from "./AppShell";
import { InspectorFieldProvider } from "../context/InspectorFieldContext";
const IntentBindingLearningPage = lazyWithRetry(() => import("../pages/IntentBindingLearningPage"));
const A2AProtocolLearningPage = lazyWithRetry(() => import("../pages/A2AProtocolLearningPage"));
const JevLearningPage = lazyWithRetry(() => import("../pages/JevLearningPage"));
const JevDemoGalleryPage = lazyWithRetry(() => import("../pages/JevDemoGalleryPage"));
const PrivilegeMcpLearningPage = lazyWithRetry(() => import("../pages/PrivilegeMcpLearningPage"));
import AgentGatewayCapabilitiesPage from "../pages/AgentGatewayCapabilitiesPage";
const AgentGatewayAuthorizationLessonPage = lazyWithRetry(() => import("../pages/AgentGatewayAuthorizationLessonPage"));
const ExternalAgentLessonPage = lazyWithRetry(() => import("../pages/ExternalAgentLessonPage"));
const LiveUseCaseWorkbenchPage = lazyWithRetry(() => import("../pages/LiveUseCaseWorkbenchPage"));
const AIAgent = lazyWithRetry(() => import("../components/AIAgent"));
const CodeExplorerPage = lazyWithRetry(() => import("../components/CodeExplorerPage"));
const GraphifyPage = lazyWithRetry(() => import("../components/GraphifyPage"));
import { CodeSearchPage } from "../pages/CodeSearchPage";
const OAuthAcademyPage = lazyWithRetry(() => import("../components/OAuthAcademyPage"));
const CopilotPage = lazyWithRetry(() => import("../components/CopilotPage"));
const OASDemoPage = lazyWithRetry(() => import("../components/OASDemoPage"));
const RunReportPage = lazyWithRetry(() => import("../components/RunReportPage"));
import ComplianceModalPopout from "../components/ComplianceModalPopout";
import DemoGuidePopout from "../components/DemoGuidePopout";
import LogoutPage from "../components/LogoutPage";
const MFATestPage = lazyWithRetry(() => import("../components/MFATestPage"));
const PingOneSetupGuidePage = lazyWithRetry(() => import("../components/PingOneSetupGuidePage"));
const PingOneTestPage = lazyWithRetry(() => import("../components/PingOneTestPage"));
import SampleAppPage from "../pages/SampleAppPage";
const M2mCredentialsSamplePage = lazyWithRetry(() => import("../pages/M2mCredentialsSamplePage"));
import {
  StandaloneIndex,
  StandaloneSample,
  StandaloneRunnerShell,
  StandaloneAiPoliciesShell,
} from "../pages/StandaloneSamples";
const PingOneSetup = lazyWithRetry(() => import("../pages/PingOneSetup"));
const SelfServicePage = lazyWithRetry(() => import("../components/SelfServicePage"));
const SetupPage = lazyWithRetry(() => import("../components/SetupPage"));
const SetupWizard = lazyWithRetry(() => import("../components/SetupWizard"));
const UnifiedConfigurationPage = lazyWithRetry(() => import("../components/Configuration/UnifiedConfigurationPage"));
const UseCaseLauncherPage = lazyWithRetry(() => import("../pages/UseCaseLauncherPage"));
const TokenExchangeTesterPage = lazyWithRetry(() => import("../pages/TokenExchangeTesterPage"));
const McpInspectorPageClean = lazyWithRetry(() => import("../components/McpInspectorPageClean"));
import PingOneMcpInspector from "../components/PingOneMcpInspector";
import AgentGatewayInspectorClean from "../components/AgentGatewayInspectorClean";
const AgentGatewayLogPanel = lazyWithRetry(() => import("../components/AgentGatewayLogPanel"));
const SdkLoginPage = lazyWithRetry(() => import("../pages/SdkLoginPage"));
const SdkLoginCallback = lazyWithRetry(() => import("../pages/SdkLoginCallback"));
const DavinciLoginCallback = lazyWithRetry(() => import("../pages/DavinciLoginCallback"));
const DavinciLoginConfirmedPage = lazyWithRetry(() => import("../pages/DavinciLoginConfirmedPage"));
const DavinciExplainerPage = lazyWithRetry(() => import("../pages/DavinciExplainerPage"));
const OrchestrationSdkExplainerPage = lazyWithRetry(() => import("../pages/OrchestrationSdkExplainerPage"));
const DavinciSdkLoginPage = lazyWithRetry(() => import("../pages/DavinciSdkLoginPage"));
const DavinciLoginGuidePage = lazyWithRetry(() => import("../pages/DavinciLoginGuidePage"));
const PingOneProviderGuard = lazyWithRetry(() => import("../components/PingOneProviderGuard"));
const PingFederateDavinciKitPage = lazyWithRetry(() => import("../pages/PingFederateDavinciKitPage"));
const CibaApprovalPage = lazyWithRetry(() => import("../pages/CibaApprovalPage"));
const CibaEmailApprovePage = lazyWithRetry(() => import("../pages/CibaEmailApprovePage"));
const EnterpriseMcpDemoPage = lazyWithRetry(() => import("../pages/EnterpriseMcpDemoPage"));
const PingFederateIdJagExplainerPage = lazyWithRetry(() => import("../pages/PingFederateIdJagExplainerPage"));
const PingFederateIdJagImplementationPage = lazyWithRetry(() => import("../pages/PingFederateIdJagImplementationPage"));
const IdJagPlaygroundPage = lazyWithRetry(() => import("../pages/IdJagPlaygroundPage"));
const IdJagPlaygroundDiagramPage = lazyWithRetry(() => import("../pages/IdJagPlaygroundDiagramPage"));
const IdJagLearnPage = lazyWithRetry(() => import("../pages/IdJagLearnPage"));
const IdJagInspectPage = lazyWithRetry(() => import("../pages/IdJagInspectPage"));
const IdJagRunnerLabPage = lazyWithRetry(() => import("../pages/IdJagRunnerLabPage"));
const PingFederateIdJagPage = lazyWithRetry(() => import("../components/PingFederateIdJagPage"));
const PingFederateAiAgentPage = lazyWithRetry(() => import("../pages/PingFederateAiAgentPage"));
const AicTokenExchangePage = lazyWithRetry(() => import("../pages/AicTokenExchangePage"));
const OboDemoPage = lazyWithRetry(() => import("../pages/OboDemoPage"));
const SessionLabPage = lazyWithRetry(() => import("../pages/SessionLabPage"));
const DigitalWorkerPage = lazyWithRetry(() => import("../pages/DigitalWorkerPage"));
const AuthorizationFlowPage = lazyWithRetry(() => import("../pages/AuthorizationFlowPage"));
const ChatgptLoginPage = lazyWithRetry(() => import("../pages/ChatgptLoginPage"));
const GroupPolicyBoardPage = lazyWithRetry(() => import("../pages/GroupPolicyBoardPage"));
const PageCatalogPage = lazyWithRetry(() => import("../pages/PageCatalogPage"));
const PrivilegeMcpClientPage = lazyWithRetry(() => import("../pages/PrivilegeMcpClientPage"));
const LlmGatewayCombinedPage = lazyWithRetry(() => import("../pages/LlmGatewayCombinedPage"));
const IntentInspectorPage = lazyWithRetry(() => import("../pages/IntentInspectorPage"));
const AuditAgentPage = lazyWithRetry(() => import("../pages/AuditAgentPage"));
const SpiffePingoneBridgePage = lazyWithRetry(() => import("../components/SpiffePingoneBridgePage"));

export default function PublicRoutes({ user, logout }) {
  return (
    <Routes>
      <Route
        path="pingone"
        element={
          <AppShell user={user} logout={logout}>
            <PingOneSetupGuidePage />
          </AppShell>
        }
      />
      <Route
        path="wizard"
        element={
          <AppShell user={user} logout={logout}>
            <SetupWizard />
          </AppShell>
        }
      />
      <Route
        path=""
        element={
          <AppShell user={user} logout={logout}>
            <SetupPage user={user} logout={logout} />
          </AppShell>
        }
      />
    </Routes>
  );
}

// Shell-wrapped public pages used as top-level route elements in App.js
export function ConfigurePage({ user, logout }) {
  return (
    <AppShell user={user} logout={logout}>
      <UnifiedConfigurationPage user={user} onLogout={logout} />
    </AppShell>
  );
}

export function SelfServicePageRoute({ user, logout }) {
  return (
    <AppShell user={user} logout={logout}>
      <SelfServicePage />
    </AppShell>
  );
}

// One wrapper per sample app. SampleAppPage is shared; sampleId selects the
// content from data/sampleApps.js + data/sampleCode.json.
export function SampleM2mPageRoute({ user, logout }) {
  return (
    <AppShell user={user} logout={logout}>
      <SampleAppPage sampleId="m2m-credentials" />
    </AppShell>
  );
}

export function SampleCustomAdminRolePageRoute({ user, logout }) {
  return (
    <AppShell user={user} logout={logout}>
      <SampleAppPage sampleId="custom-admin-role" />
    </AppShell>
  );
}

export function SampleUserRegistrationPageRoute({ user, logout }) {
  return (
    <AppShell user={user} logout={logout}>
      <SampleAppPage sampleId="user-registration" />
    </AppShell>
  );
}

export function SampleMfaDemoPageRoute({ user, logout }) {
  return (
    <AppShell user={user} logout={logout}>
      <SampleAppPage sampleId="mfa-demo" />
    </AppShell>
  );
}

// The /standalone/* routes take no user and no logout on purpose: they render
// no AppShell, so there is no TopNav to sign in from and no session state to
// pass down. That is the whole point of them — the same sample pages with none
// of this demo around them.
export function StandaloneIndexRoute() {
  return <StandaloneIndex />;
}

export function StandaloneSampleRoute() {
  return <StandaloneSample />;
}

export function StandaloneRunnerRoute() {
  return <StandaloneRunnerShell />;
}

export function StandaloneAiPoliciesRoute() {
  return <StandaloneAiPoliciesShell />;
}

export function M2mCredentialsSamplePageRoute({ user, logout }) {
  return (
    <AppShell user={user} logout={logout}>
      <M2mCredentialsSamplePage />
    </AppShell>
  );
}

export function PingOneTestPageRoute({ user, logout }) {
  return (
    <AppShell user={user} logout={logout}>
      <PingOneTestPage />
    </AppShell>
  );
}

export function PingOneSetupPageRoute({ user, logout }) {
  return (
    <AppShell user={user} logout={logout}>
      <PingOneSetup />
    </AppShell>
  );
}

export function CopilotPageRoute({ user, logout }) {
  return (
    <AppShell user={user} logout={logout}>
      <CopilotPage />
    </AppShell>
  );
}

export function MFATestPageRoute({ user, logout }) {
  return (
    <AppShell user={user} logout={logout}>
      <MFATestPage />
    </AppShell>
  );
}

export function IntentBindingLearningPageRoute({ user, logout }) {
  return (
    <AppShell user={user} logout={logout}>
      <IntentBindingLearningPage />
    </AppShell>
  );
}

export function JevLearningPageRoute({ user, logout }) {
  return (
    <AppShell user={user} logout={logout}>
      <JevLearningPage />
    </AppShell>
  );
}

export function JevDemoGalleryPageRoute({ user, logout }) {
  return (
    <AppShell user={user} logout={logout}>
      <JevDemoGalleryPage />
    </AppShell>
  );
}

export function A2AProtocolLearningPageRoute({ user, logout }) {
  return (
    <AppShell user={user} logout={logout}>
      <A2AProtocolLearningPage />
    </AppShell>
  );
}

export function PrivilegeMcpLearningPageRoute({ user, logout }) {
  return (
    <AppShell user={user} logout={logout}>
      <PrivilegeMcpLearningPage />
    </AppShell>
  );
}

export function AgentGatewayCapabilitiesPageRoute({ user, logout }) {
  // AgentGatewayCapabilitiesPage renders AgentGatewayInspectorClean; the provider
  // lets its fields be suggested across inspectors (same as McpGatewayConfigRoute).
  return (
    <InspectorFieldProvider>
      <AppShell user={user} logout={logout}>
        <AgentGatewayCapabilitiesPage />
      </AppShell>
    </InspectorFieldProvider>
  );
}

export function AgentGatewayAuthorizationLessonPageRoute({ user, logout }) {
  return (
    <AppShell user={user} logout={logout}>
      <AgentGatewayAuthorizationLessonPage />
    </AppShell>
  );
}

export function ExternalAgentLessonPageRoute({ user, logout }) {
  return (
    <AppShell user={user} logout={logout}>
      <ExternalAgentLessonPage />
    </AppShell>
  );
}

export function AgentPageRoute({ user, logout }) {
  return (
    <AIAgent
      user={user}
      onLogout={logout}
      mode="inline"
      distinctFloatingChrome
    />
  );
}

export function CodeExplorerPageRoute({ user, logout }) {
  return (
    <AppShell user={user} logout={logout}>
      <CodeExplorerPage />
    </AppShell>
  );
}

export function CodeSearchPageRoute({ user, logout }) {
  return (
    <AppShell user={user} logout={logout}>
      <CodeSearchPage />
    </AppShell>
  );
}

export function GraphifyPageRoute({ user, logout }) {
  return (
    <AppShell user={user} logout={logout}>
      <GraphifyPage />
    </AppShell>
  );
}

export function OAuthAcademyPageRoute({ user, logout }) {
  return (
    <AppShell user={user} logout={logout}>
      <OAuthAcademyPage />
    </AppShell>
  );
}

export function OASDemoPageRoute({ user, logout }) {
  return (
    <AppShell user={user} logout={logout}>
      <OASDemoPage user={user} />
    </AppShell>
  );
}

/** MCP Enterprise-Managed Authorization demo — arm one flag, run it, reset. */
export function EnterpriseMcpDemoPageRoute({ user, logout }) {
  return (
    <AppShell user={user} logout={logout}>
      <EnterpriseMcpDemoPage />
    </AppShell>
  );
}

export function PingFederateIdJagExplainerPageRoute({ user, logout }) {
  return (
    <AppShell user={user} logout={logout}>
      <PingFederateIdJagExplainerPage />
    </AppShell>
  );
}

export function PingFederateIdJagDemoPageRoute({ user, logout }) {
  return (
    <AppShell user={user} logout={logout}>
      <EnterpriseMcpDemoPage />
    </AppShell>
  );
}

export function PingFederateIdJagDiagramPageRoute({ user, logout }) {
  return (
    <AppShell user={user} logout={logout}>
      <PingFederateIdJagPage />
    </AppShell>
  );
}

export function PingFederateIdJagImplementationPageRoute({ user, logout }) {
  return (
    <AppShell user={user} logout={logout}>
      <PingFederateIdJagImplementationPage />
    </AppShell>
  );
}

export function IdJagPlaygroundPageRoute({ user, logout }) {
  return (
    <AppShell user={user} logout={logout}>
      <IdJagPlaygroundPage />
    </AppShell>
  );
}

export function IdJagLearnPageRoute({ user, logout }) {
  return (
    <AppShell user={user} logout={logout}>
      <IdJagLearnPage />
    </AppShell>
  );
}

export function IdJagRunnerLabPageRoute({ user, logout }) {
  return (
    <AppShell user={user} logout={logout}>
      <IdJagRunnerLabPage />
    </AppShell>
  );
}

export function IdJagInspectPageRoute({ user, logout }) {
  return (
    <AppShell user={user} logout={logout}>
      <IdJagInspectPage />
    </AppShell>
  );
}

export function IdJagPlaygroundDiagramPageRoute({ user, logout }) {
  return (
    <AppShell user={user} logout={logout}>
      <IdJagPlaygroundDiagramPage />
    </AppShell>
  );
}

export function AicTokenExchangePageRoute({ user, logout }) {
  return (
    <AppShell user={user} logout={logout}>
      <AicTokenExchangePage />
    </AppShell>
  );
}

export function OboDemoPageRoute({ user, logout }) {
  return (
    <AppShell user={user} logout={logout}>
      <OboDemoPage />
    </AppShell>
  );
}

export function SessionLabPageRoute({ user, logout }) {
  return (
    <AppShell user={user} logout={logout}>
      <SessionLabPage />
    </AppShell>
  );
}

export function ChatgptLoginPageRoute({ user, logout }) {
  return (
    <AppShell user={user} logout={logout}>
      <ChatgptLoginPage />
    </AppShell>
  );
}

export function DigitalWorkerPageRoute({ user, logout }) {
  return (
    <AppShell user={user} logout={logout}>
      <DigitalWorkerPage />
    </AppShell>
  );
}

export function AuthorizationFlowPageRoute({ user, logout }) {
  return (
    <AppShell user={user} logout={logout}>
      <AuthorizationFlowPage />
    </AppShell>
  );
}

export function PingFederateAiAgentPageRoute({ user, logout }) {
  return (
    <AppShell user={user} logout={logout}>
      <PingFederateAiAgentPage user={user} />
    </AppShell>
  );
}

/** Group policy board — live per-vertical decisions against real directory membership. */
export function GroupPolicyBoardPageRoute({ user, logout }) {
  return (
    <AppShell user={user} logout={logout}>
      <GroupPolicyBoardPage />
    </AppShell>
  );
}

/** Page catalog — what every page does/teaches/demos, with per-user side-nav show/hide. */
export function PageCatalogPageRoute({ user, logout }) {
  return (
    <AppShell user={user} logout={logout}>
      <PageCatalogPage />
    </AppShell>
  );
}

/** PingOne Privilege MCP Client — chat-first tool discovery through Privilege Gateway. */
export function PrivilegeMcpClientPageRoute({ user, logout }) {
  // A2A used to be a tab here; old links (?tab=a2a) land on its own page.
  const [searchParams] = useSearchParams();
  if (searchParams.get("tab") === "a2a") return <Navigate to="/privilege-a2a" replace />;
  return (
    <AppShell user={user} logout={logout}>
      <PrivilegeMcpClientPage />
    </AppShell>
  );
}

/**
 * LLM Gateway — one page, two tabs: the chat console (what a Privilege virtual
 * key permits, and what it just decided) and the raw REST tester (nothing
 * interpreted). /llm-gateway and /llm-test both render this, defaulting to
 * whichever tab matches the URL a link or bookmark used.
 */
export function LlmGatewayPageRoute({ user, logout }) {
  return (
    <AppShell user={user} logout={logout}>
      <LlmGatewayCombinedPage defaultTab="chat" />
    </AppShell>
  );
}

export function LlmTestPageRoute({ user, logout }) {
  return (
    <AppShell user={user} logout={logout}>
      <LlmGatewayCombinedPage defaultTab="raw" />
    </AppShell>
  );
}

/**
 * Intent Inspector — what the user consented to vs. what the agent is attempting,
 * decided by the Agent Intent Governance policy set. Admin: it lists decision
 * endpoints, which is an admin-only read.
 */
export function IntentInspectorPageRoute({ user, logout }) {
  return (
    <AppShell user={user} logout={logout}>
      <IntentInspectorPage />
    </AppShell>
  );
}

/** Audit Agent — agent scoped to PingOne audit tools by Privilege policy. */
export function AuditAgentPageRoute({ user, logout }) {
  return (
    <AppShell user={user} logout={logout}>
      <AuditAgentPage />
    </AppShell>
  );
}

export function SpiffePingoneBridgePageRoute({ user, logout }) {
  return (
    <AppShell user={user} logout={logout}>
      <SpiffePingoneBridgePage />
    </AppShell>
  );
}

export function ReportsPageRoute({ user, logout }) {
  return (
    <AppShell user={user} logout={logout}>
      <RunReportPage user={user} />
    </AppShell>
  );
}

export function UseCasesPageRoute({ user, logout, onStopAgentClick }) {
  return (
    <AppShell user={user} logout={logout}>
      {/* A5.2 — slim launch drawer on /agent screen — deferred to A5.2 */}
      <UseCaseLauncherPage onStopAgentClick={onStopAgentClick} />
    </AppShell>
  );
}

export function LiveUseCaseWorkbenchPageRoute({ user, logout }) {
  return (
    <AppShell user={user} logout={logout}>
      <LiveUseCaseWorkbenchPage />
    </AppShell>
  );
}

export function TokenExchangeTesterPageRoute({ user, logout }) {
  return (
    <AppShell user={user} logout={logout}>
      <TokenExchangeTesterPage />
    </AppShell>
  );
}

/** MCP Inspector — top-level so guests aren't stuck on the auth catch-all (TopNav only). */
export function McpInspectorPageRoute({ user, logout }) {
  return (
    <InspectorFieldProvider>
      <AppShell user={user} logout={logout}>
        <McpInspectorPageClean />
      </AppShell>
    </InspectorFieldProvider>
  );
}

/** Gateway Inspector — top-level so guests aren't stuck on the auth catch-all (TopNav only). */
export function McpGatewayConfigRoute({ user, logout }) {
  return (
    <InspectorFieldProvider>
      <AppShell user={user} logout={logout}>
        <AgentGatewayInspectorClean />
        {/* Every PingOne Agent Gateway P1AZ decision (who, which app, why), fed by the
            gateway's post to /internal/gateway-decision. Below the inspector,
            which fills the viewport height, so scroll down to it. .mgc-root
            restores the width, 24px inset and font its old host provided. */}
        <div className="mgc-root">
          <AgentGatewayLogPanel />
        </div>
      </AppShell>
    </InspectorFieldProvider>
  );
}

// OIDC SDK centralized-login sandbox (public) — drives its own browser-side login.
export function SdkLoginPageRoute({ user, logout }) {
  // AppShell for the side nav + top nav (back to the app) only — /sdk-login stays
  // in sideNavOwner's no-chrome list, so App.js still suppresses the education
  // panels, footer, and agent FAB here; this remains a self-contained sandbox for
  // everything except navigation back into the app.
  return (
    <AppShell user={user} logout={logout}>
      <SdkLoginPage />
    </AppShell>
  );
}

// OIDC redirect callback for the widget login — it exchanges the code and
// redirects. Public: the user is not signed in until this route finishes.
export function DavinciLoginCallbackRoute({ user, logout }) {
  return (
    <AppShell user={user} logout={logout}>
      <DavinciLoginCallback />
    </AppShell>
  );
}

// Post-login landing page — confirms who the widget flow signed in as, the
// way a resource-server checkpoint confirms what just happened before
// dropping the user back into the app.
export function DavinciLoginConfirmedRoute({ user, logout }) {
  return (
    <AppShell user={user} logout={logout}>
      <DavinciLoginConfirmedPage />
    </AppShell>
  );
}

// DaVinci Orchestration explainer — signed-in, AppShell-wrapped (reached from
// the agent header's More menu, not a pre-login sandbox like SdkLoginPageRoute).
export function DavinciExplainerRoute({ user, logout }) {
  return (
    <AppShell user={user} logout={logout}>
      <DavinciExplainerPage />
    </AppShell>
  );
}

// How the Ping Orchestration SDK works — static lesson, no SDK/PingOne/BFF
// calls, so it teaches the same in any environment. Public for the same reason
// the widget login guide is: the subject is signing in, so it has to be
// readable before you have.
export function OrchestrationSdkExplainerRoute({ user, logout }) {
  return (
    <AppShell user={user} logout={logout}>
      <OrchestrationSdkExplainerPage />
    </AppShell>
  );
}

// DaVinci SDK login sandbox (public) — the SDK drives the flow in-page and
// renders its collectors as our own UI. Public because the user is not signed
// in until the callback POST finishes.
export function DavinciSdkLoginRoute({ user, logout }) {
  return (
    <AppShell user={user} logout={logout}>
      <PingOneProviderGuard
        returnTo="/davinci-orchestration-sdk"
        description="DaVinci sign-in here is a PingOne flow. PingFederate is currently selected for login, so switch to PingOne to try it."
      >
        <DavinciSdkLoginPage />
      </PingOneProviderGuard>
    </AppShell>
  );
}

// Training lesson for the widget login — how it works, the real
// sdk-token/callback request/response shapes, and the hop-by-hop flow.
// Public, like the sandbox it documents: it's reference material, not a
// signed-in feature.
export function DavinciLoginGuidePageRoute({ user, logout }) {
  return (
    <AppShell user={user} logout={logout}>
      <PingOneProviderGuard
        returnTo="/davinci-widget"
        description="DaVinci sign-in here is a PingOne flow. PingFederate is currently selected for login, so switch to PingOne to try it."
      >
        <DavinciLoginGuidePage />
      </PingOneProviderGuard>
    </AppShell>
  );
}

export function PingFederateDavinciKitRoute({ user, logout }) {
  return (
    <AppShell user={user} logout={logout}>
      <PingFederateDavinciKitPage />
    </AppShell>
  );
}

// OIDC redirect callback (bare — no shell, it exchanges the code and redirects).
export function SdkLoginCallbackRoute() {
  return <SdkLoginCallback />;
}

export function CibaApprovalPageRoute() {
  return <CibaApprovalPage />;
}

// CIBA email-channel approval (from the one-time emailed link; bare page).
export function CibaEmailApprovePageRoute() {
  return <CibaEmailApprovePage />;
}

export { LogoutPage, ComplianceModalPopout, DemoGuidePopout };
export {
  GuidedJourneyRoute,
  StandaloneDemoLauncherRoute,
} from "./AcademyRoutes";
