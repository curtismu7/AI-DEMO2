import { Navigate, Route, Routes } from "react-router-dom";
import AppShell from "./AppShell";
import AuthzTestPage from "../components/AuthzTestPage";
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
import Onboarding from "../components/Onboarding";
import PingOneSetupGuidePage from "../components/PingOneSetupGuidePage";
import PingOneTestPage from "../components/PingOneTestPage";
import PingOneSetup from "../pages/PingOneSetup";
import SelfServicePage from "../components/SelfServicePage";
import SetupPage from "../components/SetupPage";
import SetupWizard from "../components/SetupWizard";
import UnifiedConfigurationPage from "../components/Configuration/UnifiedConfigurationPage";
import UseCaseLauncherPage from "../pages/UseCaseLauncherPage";
import TokenExchangeTesterPage from "../pages/TokenExchangeTesterPage";
import SdkLoginPage from "../pages/SdkLoginPage";
import SdkLoginCallback from "../pages/SdkLoginCallback";

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

export function AuthzTestPageRoute({ user, logout }) {
  return (
    <AppShell user={user} logout={logout}>
      <AuthzTestPage />
    </AppShell>
  );
}

export function OnboardingRoute({ user }) {
  if (user && user.role !== "admin") return <Navigate to="/" replace />;
  return <Onboarding />;
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
      <OASDemoPage />
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

export function UseCasesPageRoute({ user, logout }) {
  return (
    <AppShell user={user} logout={logout}>
      {/* A5.2 — slim launch drawer on /agent screen — deferred to A5.2 */}
      <UseCaseLauncherPage />
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

// OIDC SDK centralized-login sandbox (public) — drives its own browser-side login.
export function SdkLoginPageRoute() {
  // Bare (no AppShell): the SDK sandbox is a self-contained page — no banking app
  // chrome, sidebar, or global education modals.
  return <SdkLoginPage />;
}

// OIDC redirect callback (bare — no shell, it exchanges the code and redirects).
export function SdkLoginCallbackRoute() {
  return <SdkLoginCallback />;
}

export { LogoutPage, ComplianceModalPopout, DemoGuidePopout };
