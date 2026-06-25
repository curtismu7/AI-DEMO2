import { Route, Routes } from "react-router-dom";
import AppShell from "./AppShell";
import ArchitectureFlowPage from "../components/ArchitectureFlowPage";
import ArchitectureOverviewPage from "../components/ArchitectureOverviewPage";
import ArchitectureTabsPanel from "../components/ArchitectureTabsPanel";
import ArchitectureTokenFlowPage from "../components/ArchitectureTokenFlowPage";
import Phase266ArchitecturePage from "../components/Phase266ArchitecturePage";

// /architecture/* sub-routes
//
// NOTE: This component owns its OWN <Routes> tree (with relative paths) and
// works correctly as a route element. The non-/architecture/* education routes
// (mcp-tools, agentic-trust, etc.) live directly in App.js's wildcard <Routes>
// because React Router v6 requires <Route> elements to be DIRECT children of
// <Routes> — they cannot be returned from an intermediate component.
export default function EducationRoutes({ user, logout }) {
  return (
    <AppShell user={user} logout={logout}>
      <Routes>
        <Route path="system" element={<ArchitectureTabsPanel user={user} />} />
        <Route path="overview" element={<ArchitectureOverviewPage user={user} />} />
        <Route path="token-flow" element={<ArchitectureTokenFlowPage user={user} />} />
        <Route path="flow" element={<ArchitectureFlowPage user={user} />} />
        <Route path="phase-266" element={<Phase266ArchitecturePage />} />
      </Routes>
    </AppShell>
  );
}
