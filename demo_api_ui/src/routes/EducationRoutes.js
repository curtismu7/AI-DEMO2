import lazyWithRetry from "../utils/lazyWithRetry";
import { Route, Routes } from "react-router-dom";
import AppShell from "./AppShell";
const ArchitectureFlowPage = lazyWithRetry(() => import("../components/ArchitectureFlowPage"));
const ArchitectureOverviewPage = lazyWithRetry(() => import("../components/ArchitectureOverviewPage"));
const ArchitectureTabsPanel = lazyWithRetry(() => import("../components/ArchitectureTabsPanel"));
const ArchitectureTokenFlowPage = lazyWithRetry(() => import("../components/ArchitectureTokenFlowPage"));
const Phase266ArchitecturePage = lazyWithRetry(() => import("../components/Phase266ArchitecturePage"));
const A2AArchitecturePage = lazyWithRetry(() => import("../components/A2AArchitecturePage"));
const ArchitectureCanvasPage = lazyWithRetry(() => import("../components/ArchitectureCanvasPage"));
const TokenChainArchitecturePage = lazyWithRetry(() => import("../components/TokenChainArchitecturePage"));
const ReactFlowPocPage = lazyWithRetry(() => import("../components/ReactFlowPocPage"));
const ReactFlowPocComparePage = lazyWithRetry(() => import("../components/ReactFlowPocComparePage"));
const PingFederateIdJagPage = lazyWithRetry(() => import("../components/PingFederateIdJagPage"));
const ObservabilityDiagramPage = lazyWithRetry(() => import("../components/ObservabilityDiagramPage"));
const ServerTopologyPage = lazyWithRetry(() => import("../components/ServerTopologyPage"));

// /architecture/* sub-routes
//
// NOTE: This component owns its OWN <Routes> tree (with relative paths) and
// works correctly as a route element. The non-/architecture/* education routes
// (agentic-trust, etc.) live directly in App.js's wildcard <Routes>
// because React Router v6 requires <Route> elements to be DIRECT children of
// <Routes> — they cannot be returned from an intermediate component.
export default function EducationRoutes({ user, logout }) {
  return (
    <AppShell user={user} logout={logout}>
      <Routes>
        <Route path="system" element={<ArchitectureTabsPanel user={user} />} />
        <Route path="overview" element={<ArchitectureOverviewPage user={user} />} />
        <Route path="token-flow" element={<ArchitectureTokenFlowPage user={user} />} />
        <Route path="token-chain" element={<TokenChainArchitecturePage user={user} />} />
        <Route path="flow" element={<ArchitectureFlowPage user={user} />} />
        <Route path="phase-266" element={<Phase266ArchitecturePage />} />
        <Route path="a2a" element={<A2AArchitecturePage />} />
        <Route path="canvas" element={<ArchitectureCanvasPage />} />
        <Route path="reactflow-poc" element={<ReactFlowPocPage />} />
        <Route path="poc-compare" element={<ReactFlowPocComparePage />} />
        <Route path="pingfederate-id-jag" element={<PingFederateIdJagPage />} />
        <Route path="observability" element={<ObservabilityDiagramPage />} />
        <Route path="server-topology" element={<ServerTopologyPage />} />
      </Routes>
    </AppShell>
  );
}
