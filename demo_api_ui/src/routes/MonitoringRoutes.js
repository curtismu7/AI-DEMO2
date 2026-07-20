import { Navigate, Route, Routes } from "react-router-dom";
import AppShell from "./AppShell";
import ActivityLogPage from "../components/ActivityLogPage";
import ActivityLogs from "../components/ActivityLogs";
import ApiTrafficPage from "../components/ApiTrafficPage";
import DevToolsDashboard from "../components/DevToolsDashboard";
import LogViewerPage from "../components/LogViewerPage";
import McpInspector from "../components/McpInspector";
import McpTrafficPage from "../components/McpTrafficPage";
import SequenceDiagramPage from "../components/SequenceDiagramPage";
import TokenChainDisplay from "../components/TokenChainDisplay";
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
        <Route path="token-chain" element={<TokenChainDisplay />} />
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

export function AgentFlowInspectorRoute({ user, logout }) {
  if (!user) return <Navigate to="/" replace />;
  return (
    <AppShell user={user} logout={logout}>
      <UnifiedTokenFlowInspector floatingByDefault={false} showToggle={true} />
    </AppShell>
  );
}
