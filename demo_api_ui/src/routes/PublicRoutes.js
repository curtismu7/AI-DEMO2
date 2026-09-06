import { Navigate, Route, Routes } from "react-router-dom";
import AppShell from "./AppShell";
import { InspectorFieldProvider } from "../context/InspectorFieldContext";
import IntentBindingLearningPage from "../pages/IntentBindingLearningPage";
import A2AProtocolLearningPage from "../pages/A2AProtocolLearningPage";
import PrivilegeMcpLearningPage from "../pages/PrivilegeMcpLearningPage";
import AgentGatewayCapabilitiesPage from "../pages/AgentGatewayCapabilitiesPage";
import LiveUseCaseWorkbenchPage from "../pages/LiveUseCaseWorkbenchPage";
import AIAgent from "../components/AIAgent";
import CodeExplorerPage from "../components/CodeExplorerPage";
import GraphifyPage from "../components/GraphifyPage";
import { CodeSearchPage } from "../pages/CodeSearchPage";
import OAuthAcademyPage from "../components/OAuthAcademyPage";
import CopilotPage from "../components/CopilotPage";
import OASDemoPage from "../components/OASDemoPage";
import RunReportPage from "../components/RunReportPage";
import ComplianceModalPopout from "../components/ComplianceModalPopout";
import DemoGuidePopout from "../components/DemoGuidePopout";
import LogoutPage from "../components/LogoutPage";
import MFATestPage from "../components/MFATestPage";
import PingOneSetupGuidePage from "../components/PingOneSetupGuidePage";
import PingOneTestPage from "../components/PingOneTestPage";
import SampleAppPage from "../pages/SampleAppPage";
import M2mCredentialsSamplePage from "../pages/M2mCredentialsSamplePage";
import {
  StandaloneIndex,
  StandaloneSample,
  StandaloneRunnerShell,
} from "../pages/StandaloneSamples";
import PingOneSetup from "../pages/PingOneSetup";
import SelfServicePage from "../components/SelfServicePage";
import SetupPage from "../components/SetupPage";
import SetupWizard from "../components/SetupWizard";
import UnifiedConfigurationPage from "../components/Configuration/UnifiedConfigurationPage";
import UseCaseLauncherPage from "../pages/UseCaseLauncherPage";
import TokenExchangeTesterPage from "../pages/TokenExchangeTesterPage";
import McpInspectorPageClean from "../components/McpInspectorPageClean";
import PingOneMcpInspector from "../components/PingOneMcpInspector";
import AgentGatewayInspectorClean from "../components/AgentGatewayInspectorClean";
import SdkLoginPage from "../pages/SdkLoginPage";
import SdkLoginCallback from "../pages/SdkLoginCallback";
import DavinciLoginPage from "../pages/DavinciLoginPage";
import DavinciLoginCallback from "../pages/DavinciLoginCallback";
import DavinciLoginConfirmedPage from "../pages/DavinciLoginConfirmedPage";
import DavinciExplainerPage from "../pages/DavinciExplainerPage";
import CibaApprovalPage from "../pages/CibaApprovalPage";
import PrivilegeDemoPage from "../pages/PrivilegeDemoPage";
import EnterpriseMcpDemoPage from '../pages/EnterpriseMcpDemoPage';
import GroupPolicyBoardPage from '../pages/GroupPolicyBoardPage';
import PrivilegeMcpClientPage from "../pages/PrivilegeMcpClientPage";
import LlmGatewayCombinedPage from '../pages/LlmGatewayCombinedPage';
import AuditAgentPage from "../pages/AuditAgentPage";

export default function PublicRoutes({ user, logout }) {
  return (
    <Routes>
      <Route path="pingone" element={<PingOneSetupGuidePage />} />
      <Route path="wizard" element={<SetupWizard />} />
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
  return (
    <AppShell user={user} logout={logout}>
      <AgentGatewayCapabilitiesPage />
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

/** SE Privilege demo hub — needs AppShell so logged-in sidebar does not overlay content. */
export function PrivilegeDemoPageRoute({ user, logout }) {
  return (
    <AppShell user={user} logout={logout}>
      <PrivilegeDemoPage />
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

/** Group policy board — live per-vertical decisions against real directory membership. */
export function GroupPolicyBoardPageRoute({ user, logout }) {
  return (
    <AppShell user={user} logout={logout}>
      <GroupPolicyBoardPage />
    </AppShell>
  );
}

/** PingOne Privilege MCP Client — chat-first tool discovery through Privilege Gateway. */
export function PrivilegeMcpClientPageRoute({ user, logout }) {
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

/** Audit Agent — agent scoped to PingOne audit tools by Privilege policy. */
export function AuditAgentPageRoute({ user, logout }) {
  return (
    <AppShell user={user} logout={logout}>
      <AuditAgentPage />
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

// DaVinci widget login sandbox (public) — drives its own browser-side flow.
// AppShell-wrapped like /dashboard: TopNav and the side nav render fine with
// user=null (both are optional-chained), and it's what gives the page the
// main-content flex layout that keeps the footer pinned to the bottom.
export function DavinciLoginPageRoute({ user, logout }) {
  return (
    <AppShell user={user} logout={logout}>
      <DavinciLoginPage />
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

// OIDC redirect callback (bare — no shell, it exchanges the code and redirects).
export function SdkLoginCallbackRoute() {
  return <SdkLoginCallback />;
}

export function CibaApprovalPageRoute() {
  return <CibaApprovalPage />;
}

export { LogoutPage, ComplianceModalPopout, DemoGuidePopout };
