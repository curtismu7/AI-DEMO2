import { Navigate, Route, Routes } from "react-router-dom";
import AppShell from "./AppShell";
import ActivityLogPage from "../components/ActivityLogPage";
import ActivityLogs from "../components/ActivityLogs";
import ApiTrafficPage from "../components/ApiTrafficPage";
import DevToolsDashboard from "../components/DevToolsDashboard";
import LogViewerPage from "../components/LogViewerPage";
import McpInspector from "../components/McpInspector";
import McpTrafficPage from "../components/McpTrafficPage";
import NewRelicDashboard from "../components/NewRelicDashboard";
import PingOneEventPanel from "../components/PingOneEventPanel";
import SequenceDiagramPage from "../components/SequenceDiagramPage";
import TokenChainTraceRail from "../components/TokenChainTraceRail";
import UnifiedTokenFlowInspector from "../components/UnifiedTokenFlowInspector";
import WebMcpPanel from "../components/WebMcpPanel";

// Passed as prop to avoid circular dependency — AgentFlowPage is defined in App.js
export default function MonitoringRoutes({ user, logout, AgentFlowPage }) {
  return (
    <AppShell user={user} logout={logout}>
      <Routes>
        {/* Note: token-chain/flow-inspector/api-explorer match the
            pre-refactor behavior — ungated at the /monitoring/* level so deep
            links work for guests. The wildcard catch-all path for the same
            slugs in App.js was historically gated; only the top-level path
            (this one) ever rendered them in practice. */}
        {/* One live Token Chain model (tokenChainTraceStore) — TraceRail is the
            canonical display; classic TokenChainDisplay is no longer mounted. */}
        <Route path="token-chain" element={<TokenChainTraceRail />} />
        <Route path="mcp-traffic" element={<McpTrafficPage />} />
        <Route path="api-explorer" element={<Navigate to="/pingone-mcp-inspector?source=api" replace />} />
        <Route path="agent-flow" element={
          user && AgentFlowPage
            ? <AgentFlowPage />
            : <Navigate to="/" replace />
        } />
        {/* Live app-events stream (oauth / mcp / HITL / …). HTTP audit table kept at api-activity. */}
        <Route path="activity-log" element={<ActivityLogPage />} />
        <Route path="api-activity" element={<ActivityLogs user={user} onLogout={logout} />} />
      </Routes>
    </AppShell>
  );
}

// Named exports for top-level standalone routes (outside /monitoring/*)
export function ApiTrafficRoute({ user, logout }) {
  return (
    <AppShell user={user} logout={logout}>
      <ApiTrafficPage />
    </AppShell>
  );
}

export function McpTrafficRoute({ user, logout }) {
  return (
    <AppShell user={user} logout={logout}>
      <McpTrafficPage />
    </AppShell>
  );
}

export function DevToolsRoute({ user, logout }) {
  return (
    <AppShell user={user} logout={logout}>
      <DevToolsDashboard
        defaultWidth={1200}
        defaultHeight={700}
        onClose={() => window.history.back()}
      />
    </AppShell>
  );
}

export function SequenceDiagramRoute({ user, logout }) {
  return (
    <AppShell user={user} logout={logout}>
      <SequenceDiagramPage user={user} />
    </AppShell>
  );
}

export function LogsRoute({ user, logout }) {
  if (!user) return <Navigate to="/" replace />;
  // Standalone pop-out page — no AppShell chrome (side nav / TopNav).
  return <LogViewerPage />;
}

export function McpInspectorRoute({ user, logout }) {
  return (
    <AppShell user={user} logout={logout}>
      <McpInspector user={user} onLogout={logout} />
    </AppShell>
  );
}

export function WebMcpRoute({ user, logout }) {
  if (!user) return <Navigate to="/" replace />;
  return (
    <AppShell user={user} logout={logout}>
      <WebMcpPanel />
    </AppShell>
  );
}

export function AgentFlowInspectorRoute({ user }) {
  if (!user) return <Navigate to="/" replace />;
  // Mounted under App.js catch-all which already supplies TopNav + main-content
  // (+ side nav). Do not nest another shell — a second .main-content also got
  // the sidebar width offset and left empty space on the right.
  return (
    <UnifiedTokenFlowInspector floatingByDefault={false} showToggle={true} />
  );
}

// Public — no session required. Wrapped in AppShell so the header and side nav
// render for signed-out visitors too; TopNav and AdminSideNav are both
// null-user safe. Deliberately NOT in isNoChromeRoute(): with user null,
// shellRendersSideNav() returns true and AppShell supplies the sidebar.
export function NewRelicRoute({ user, logout }) {
  return (
    <AppShell user={user} logout={logout}>
      <NewRelicDashboard />
    </AppShell>
  );
}

// The PingOne webhook event stream. Split out of /monitoring/new-relic, which
// was named for New Relic but rendered this. Public, matching its old behavior.
export function PingOneEventsRoute({ user, logout }) {
  return (
    <AppShell user={user} logout={logout}>
      <PingOneEventPanel />
    </AppShell>
  );
}
