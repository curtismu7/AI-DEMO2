import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { applyChildOrder } from "../config/navStructureCatalog";
import useDividerDrag from "../hooks/useDividerDrag";
import { useAgentUiMode } from "../context/AgentUiModeContext";
import { useEducationUI } from "../context/EducationUIContext";
import apiClient from "../services/apiClient";
import { persistAgentUi } from "../services/demoScenarioService";
import { performLogout } from "../services/logout";
import { notifyError } from "../utils/appToast";
import { spinner } from "../services/spinnerService";
import { navigateToCustomerOAuthLogin } from "../utils/authUi";
import { setDashboardLayout } from "../utils/dashboardLayout";
import { startRoleSwitch } from "../utils/roleSwitch";
import { useVertical } from "../vertical/useVertical";
import ConfirmModal from "./ConfirmModal";
import ControlPlaneIntroModal from "./ControlPlaneIntroModal";
import DraggableModal from "./DraggableModal";
import { EDU } from "./education/educationIds";
import { PAC_EDITOR_URL } from "./pacEditorStatus";
import "./adminSkinPing2026.css";
import { HiOutlineUsers } from "react-icons/hi";
import {
  MdAccountBalance,
  MdApi,
  MdArchitecture,
  MdBarChart,
  MdBook,
  MdBugReport,
  MdBuild,
  MdCode,
  MdCollections,
  MdComputer,
  MdDashboard,
  MdDescription,
  MdEdit,
  MdEmail,
  MdFlag,
  MdHome,
  MdKey,
  MdLightbulb,
  MdLink,
  MdList,
  MdLock,
  MdLogin,
  MdLogout,
  MdManageAccounts,
  MdMobileFriendly,
  MdNetworkCheck,
  MdOutlineChat,
  MdPlayArrow,
  MdPolicy,
  MdPublic,
  MdRefresh,
  MdRoute,
  MdSearch,
  MdSecurity,
  MdSettings,
  MdShield,
  MdSmartToy,
  MdStar,
  MdStop,
  MdStorage,
  MdSwapHoriz,
  MdSyncAlt,
  MdTimeline,
  MdTune,
  MdViewQuilt,
} from "react-icons/md";
import "./AdminSideNav.css";

const ICON_MAP = {
  home: MdHome,
  dashboard: MdDashboard,
  doc: MdDescription,
  usr: HiOutlineUsers,
  rpt: MdBarChart,
  log: MdList,
  edt: MdEdit,
  srch: MdSearch,
  mcp: MdNetworkCheck,
  api: MdApi,
  lnk: MdLink,
  dbg: MdBugReport,
  flw: MdTimeline,
  arc: MdArchitecture,
  bld: MdViewQuilt,
  ">": MdPlayArrow,
  rte: MdRoute,
  sec: MdSecurity,
  cfg: MdSettings,
  key: MdKey,
  dlg: MdManageAccounts,
  pol: MdPolicy,
  shld: MdShield,
  flag: MdFlag,
  tool: MdBuild,
  agt: MdSmartToy,
  fix: MdTune,
  msg: MdEmail,
  find: MdSearch,
  txn: MdSwapHoriz,
  acc: MdAccountBalance,
  lck: MdLock,
  tst: MdCode,
  mbl: MdMobileFriendly,
  syn: MdSyncAlt,
  demo: MdLightbulb,
  ref: MdBook,
  web: MdPublic,
  clk: MdComputer,
  ai: MdSmartToy,
  file: MdDescription,
  "*": MdStar,
  "|": MdViewQuilt,
  _: MdViewQuilt,
  chat: MdOutlineChat,
  "<>": MdSyncAlt,
  out: MdLogout,
  "sign-in": MdLogin,
  stp: MdStop,
  vault: MdStorage,
  msg2: MdCollections,
};

/**
 * AdminSideNav — PingIdentity-style persistent left sidebar for navigation.
 *
 * Based on PingIdentity console design:
 * - Dark background sidebar (left)
 * - White text labels for all entries
 * - Expandable submenu sections
 * - Active link highlighting
 * - Consistent icon + label styling
 * - Responsive on mobile
 *
 * Updated Phase 155: All routes verified against App.js; broken links fixed
 * Updated Phase 163: Role-aware — renders for ALL logged-in users, filters items by role
 * Updated Phase 163: Added Config, Demo Config, Role Switch; consolidated all nav here
 */
const DEFAULT_WIDTH = 310;
const MIN_WIDTH = 180;
const MAX_WIDTH = 520;
// Persists which sidebar sections are expanded so the user's open group
// survives remounts and full-page reloads (per-tab, cleared when the tab closes).
// Namespaced by role so admin and customer keep independent expansion state
// (deliberate UX: switching roles restores that role's own open group).
const EXPANDED_SECTIONS_KEY_BASE = "adminSideNav.expandedSections";
const COLLAPSED_KEY = "adminSideNav.collapsed";
const READINESS_POLL_INTERVAL_MS = 500;

function isFullyReadyReadinessReport(report) {
  return report?.status === "ready"
    && report?.ready === true
    && Array.isArray(report.targets)
    && ["local", "se"].every((target) => report.targets.includes(target));
}

function isAuthorizePolicyTreeWaiver(row) {
  return row?.id === "pingone:policyReadback"
    && row.status === "blocked"
    && row.required === false
    && typeof row.waiver === "string";
}

/** The sidebar rests as an icon rail unless the user has expanded it before. */
function readStoredCollapsed() {
  try {
    return window.localStorage.getItem(COLLAPSED_KEY) !== "false";
  } catch {
    return true;
  }
}
const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "local.ping-devops.com"]);

// Auto-expand table: the group containing the current route opens on first
// load when nothing is saved. Ids must equal slugify(<group label>) from
// `allNavItems` below — update both together when renaming a group.
const AUTO_EXPAND_SECTIONS = [
  { id: "ai-gateway", paths: ["/ai-gateway/shadow-ai-detector", "/privilege-mcp-client", "/llm-gateway", "/agent-gateway-authorization", "/code-search"] },
  { id: "davinci", paths: ["/davinci-sdk", "/davinci-widget", "/davinci-orchestration-sdk", "/pingfederate-davinci-kit"] },
  { id: "ping-products", paths: ["/ping-products/verify-recognize", "/pingcli", "/sdk-login", "/samples/m2m-credentials", "/samples/custom-admin-role"] },
  { id: "identity-journeys", paths: ["/self-service", "/samples/user-registration", "/samples/mfa-demo", "/login-flow", "/oauth-academy", "/oas-demo"] },
  { id: "ai-experiences", paths: ["/delegated-commerce", "/use-cases", "/use-cases/live", "/demo-track", "/group-policy", "/agent-lifecycle", "/delegation-chain-value", "/a2a-protocol-learning", "/jev-learning", "/control-plane", "/ai-control-plane", "/agent-registry", "/agent-builder", "/agent-flow-inspector", "/agent-onboarding-flow", "/agent-onboarding-flow-subway", "/langchain", "/ungoverned-agent", "/servers", "/autonomous-agents", "/personal-agent", "/privilege-for-ai"] },
  { id: "mcp-integrations", paths: ["/pingone-mcp-inspector", "/pingone-setup", "/demo/enterprise-mcp", "/ping-ai-test-lab", "/agent-gateway-inspector", "/agent-gateway-capabilities", "/webmcp", "/mcp-scanner", "/personal-agent"] },
  { id: "pingfederate-id-jag", paths: ["/pingfederate-id-jag"] },
  { id: "pingfederate-ai-agent", paths: ["/pingfederate-ai-agent"] },
  { id: "utilities", paths: ["/pingone-test", "/mfa-test", "/oauth-debug-logs", "/token-exchange-tester", "/mgmt-api", "/pingone-setup", "/mcp-discovery", "/check"] },
  { id: "delegation-consent", paths: ["/transaction-consent", "/actor-token-education"] },
  { id: "authorize", paths: ["/pingone-authorize", "/pingone-authorize-capabilities", "/policy-decision-trace", "/authz-test", "/scope-audit", "/scope-reference"] },
  { id: "administration", paths: ["/admin", "/admin/pingone", "/users", "/accounts", "/transactions", "/admin/banking", "/admin/healthcare", "/admin/retail", "/admin/sporting-goods", "/admin/workforce", "/admin/verticals", "/path/mortgage", "/configure", "/settings", "/client-registration"] },
  { id: "observability", paths: ["/audit", "/monitoring", "/reports", "/error-audit", "/telemetry", "/tracing", "/transaction-trace", "/mcp-observability", "/check"] },
];

// Load a role's saved expansion state, falling back to the path-based
// auto-expand default. Shared by the mount initializer and the key-change
// reload below so both read the same shape.
const loadExpandedSections = (storageKey, pathname) => {
  try {
    const saved = sessionStorage.getItem(storageKey);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (parsed && typeof parsed === "object") return parsed;
    }
  } catch (_e) {
    /* ignore malformed/unavailable storage */
  }
  const initial = {};
  const matches = (paths) =>
    paths.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  for (const s of AUTO_EXPAND_SECTIONS) {
    if (matches(s.paths)) initial[`nav-${s.id}`] = true;
  }
  return initial;
};

// Stable section id from a label — decouples expansion/persistence keys from
// array position so reordering nav items can't silently break auto-expand or
// restore the wrong group. Top-level labels are unique, so slugs are unique.
const slugify = (label) =>
  String(label || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
const sectionIdOf = (item, index) =>
  item.id || slugify(item.label) || `i${index}`;
const isLocalHost = () =>
  typeof window !== "undefined" && LOCAL_HOSTNAMES.has(window.location.hostname);

const NAV_SECTION_LABELS = new Map([
  ["Home", "Core"],
  ["Agent Privilege", "PingOne Platform"],
  ["Identity Journeys", "Separate Areas"],
]);

const PRODUCT_CARD_GROUPS = new Set(["Agent Privilege", "DaVinci", "Ping products"]);

const navGroupClassName = (label) => {
  if (PRODUCT_CARD_GROUPS.has(label)) return "admin-side-nav__group--product-card";
  if (label === "Utilities" || label === "Diagrams") return "admin-side-nav__group--utility";
  return "admin-side-nav__group--separate";
};

export default function AdminSideNav({
  user,
  onStopAgentClick = () => {},
  agentRevoked = false,
}) {
  const location = useLocation();
  const navigate = useNavigate();
  // The icon rail is the resting state: "Unchanged — icon rail, expands to the
  // same tree. Only the resting width changes" (dashboard-final.html). The nav
  // is 36 items across 15 groups; at full width it competes with the thing the
  // demo is actually about. Persisted in localStorage rather than sessionStorage
  // because this is a standing preference, not per-tab state like the expanded
  // group below — someone who expands it should not have to do so every tab.
  const [collapsed, setCollapsed] = useState(readStoredCollapsed);
  // Fully hidden (the vertical-logo magic link / Ctrl+Shift+B). Distinct from
  // collapsed: hidden removes the rail entirely and the content reflows to
  // full width. Persisted — someone who hides the rail wants it to stay hidden.
  const [hidden, setHidden] = useState(() => {
    try {
      return localStorage.getItem("adminSideNav.hidden") === "1";
    } catch {
      return false;
    }
  });
  useEffect(() => {
    document.querySelector(".App")?.classList.toggle("sidenav-hidden", hidden);
    return undefined;
  }, [hidden]);
  useEffect(() => {
    const onHiddenToggle = () => {
      setHidden((h) => {
        try {
          localStorage.setItem("adminSideNav.hidden", h ? "0" : "1");
        } catch {
          /* private mode — session-only */
        }
        return !h;
      });
    };
    window.addEventListener("admin-sidenav-hidden-toggle", onHiddenToggle);
    return () => window.removeEventListener("admin-sidenav-hidden-toggle", onHiddenToggle);
  }, []);
  // Width now persists (it never did before convergence on useDividerDrag);
  // collapse state was already persisted separately.
  const { size: sidebarWidth, handleProps: resizeHandleProps } = useDividerDrag({
    min: MIN_WIDTH,
    max: MAX_WIDTH,
    initial: DEFAULT_WIDTH,
    storageKey: "admin-side-nav-width",
  });
  const [navFilter, setNavFilter] = useState("");
  const [hiddenNavLabels, setHiddenNavLabels] = useState([]);
  const [navOrder, setNavOrder] = useState(null);
  const [childOrder, setChildOrder] = useState(null);
  const showPacEditorLink = isLocalHost();
  // Grafana is served differently per target and there is no single URL that
  // works in both: under /grafana on the same origin in k8s (nginx proxies it),
  // and on its own port in Docker Compose, which is a different origin from the
  // UI. Same split the BFF makes for tracesUiUrl.
  const grafanaUrl = isLocalHost() ? "http://localhost:3000" : "/grafana";
  // LibreChat is a separate app on :3080 (docker), reached as an external link —
  // same action+window.open shape as Grafana. It runs locally only.
  const libreChatUrl = "http://localhost:3080";
  const lmStudioSetupPath = "/privilege-mcp-client?client=lm-studio";

  // Per-user sidebar customization (Demo Config page). Returns [] when
  // ff_sidebar_customization is OFF or the request fails — full nav either way.
  const loadNavConfig = useCallback(() => {
    if (!user) return;
    fetch("/api/user/nav-config", { credentials: "include" })
      .then((res) => res.json())
      .then((data) => {
        setHiddenNavLabels(data.hiddenLabels || []);
        setNavOrder(data.navOrder || null);
        setChildOrder(data.childOrder || null);
      })
      .catch(() => { setHiddenNavLabels([]); setNavOrder(null); setChildOrder(null); });
  }, [user]);
  // Refetch on 'nav-config-changed' (Demo Config save/apply) so the sidebar
  // updates without a full page reload; also callable via the refresh button.
  useEffect(() => {
    loadNavConfig();
    window.addEventListener("nav-config-changed", loadNavConfig);
    return () => window.removeEventListener("nav-config-changed", loadNavConfig);
  }, [loadNavConfig]);

  // Sync --sidebar-width CSS var on App so main content margin stays correct
  useEffect(() => {
    if (!collapsed) {
      document
        .querySelector(".App")
        ?.style.setProperty("--sidebar-width", `${sidebarWidth}px`);
    }
  }, [sidebarWidth, collapsed]);

  // Auto-collapse to the icon rail on narrow viewports. App.css drops the
  // content offset to the collapsed width at <=768px assuming this collapse
  // happens; without it the still-310px nav overlaps the content by ~230px.
  // Re-expand on the way back up, but only when THIS effect was the one that
  // collapsed it — autoCollapsedRef stays false once the manual toggle button
  // fires (see below), so a real manual collapse still stays respected even
  // if the viewport happens to cross the breakpoint afterward.
  const autoCollapsedRef = useRef(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 768px)");
    const apply = () => {
      if (mq.matches) {
        autoCollapsedRef.current = true;
        setCollapsed(true);
      } else if (autoCollapsedRef.current) {
        autoCollapsedRef.current = false;
        setCollapsed(false);
      }
    };
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  // Auto-collapse while the dashboard's "Sequence view" is on, so the
  // diagram gets the width back — same ref-gated pattern as the viewport
  // auto-collapse above: only restore if THIS is what collapsed it, so a
  // manual collapse (or the viewport auto-collapse) in between still holds.
  const seqViewAutoCollapsedRef = useRef(false);
  useEffect(() => {
    const handler = (e) => {
      const on = !!e.detail?.collapsed;
      if (on) {
        seqViewAutoCollapsedRef.current = true;
        setCollapsed(true);
      } else if (seqViewAutoCollapsedRef.current) {
        seqViewAutoCollapsedRef.current = false;
        setCollapsed(false);
      }
    };
    window.addEventListener("admin-sidenav-collapse-toggle", handler);
    return () => window.removeEventListener("admin-sidenav-collapse-toggle", handler);
  }, []);

  // Role-scoped expansion state: a group the user opened should stay open
  // until they open a different one, even across sidebar remounts and the
  // full-page reloads this app performs (role/vertical switch, reauth).
  // Persisted choice wins; path-based auto-expand is the first-load default.
  const expandedSectionsKey = `${EXPANDED_SECTIONS_KEY_BASE}.${user?.role || "guest"}`;
  const [expandedSections, setExpandedSections] = useState(() =>
    loadExpandedSections(expandedSectionsKey, location.pathname),
  );
  // The initializer runs once, but on public routes the nav mounts before the
  // session resolves (user null → "guest" key) and the same instance later
  // flips to the real role. Reload that role's saved state when the key
  // changes, and gate persistence on the loaded key so the old role's state
  // is never written into the new role's bucket.
  const loadedSectionsKeyRef = useRef(expandedSectionsKey);
  useEffect(() => {
    if (loadedSectionsKeyRef.current === expandedSectionsKey) return;
    setExpandedSections(
      loadExpandedSections(expandedSectionsKey, location.pathname),
    );
    loadedSectionsKeyRef.current = expandedSectionsKey;
    // The ref guard makes path-change re-runs a no-op: reload happens only
    // when the role/key actually changes.
  }, [expandedSectionsKey, location.pathname]);
  // Persist expansion state so the open group stays open until the user opens
  // another (see expandedSectionsKey).
  useEffect(() => {
    if (loadedSectionsKeyRef.current !== expandedSectionsKey) return;
    try {
      sessionStorage.setItem(
        expandedSectionsKey,
        JSON.stringify(expandedSections),
      );
    } catch (_e) {
      /* ignore storage-unavailable (private mode / quota) */
    }
  }, [expandedSections, expandedSectionsKey]);
  // Path of the admin-marked link a non-admin clicked; non-null opens the
  // "log in as admin" confirm dialog.
  const [adminPromptPath, setAdminPromptPath] = useState(null);
  // Path queued behind the AI Control Plane intro-gate modal (null = closed).
  const [controlPlaneIntroPath, setControlPlaneIntroPath] = useState(null);
  const [showResetModal, setShowResetModal] = useState(false);
  // Sign Out asks first — same interpose as the topnav's; the reset-demo
  // cleanup path keeps calling performLogout() directly (it already has its
  // own readiness confirmation).
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [readinessJob, setReadinessJob] = useState(null);
  const [showRepairConfirm, setShowRepairConfirm] = useState(false);
  const readinessPollTimerRef = useRef(null);
  const readinessGenerationRef = useRef(0);
  const readinessResetStartedRef = useRef(false);
  const [latestRunId, setLatestRunId] = useState(null);
  const [latestRunTime, setLatestRunTime] = useState(null);

  useEffect(() => () => {
    clearTimeout(readinessPollTimerRef.current);
    readinessGenerationRef.current += 1;
  }, []);

  const isAdmin = user?.role === "admin";
  const { placement, fab, setAgentUi } = useAgentUiMode();
  const { open: openEdu } = useEducationUI();
  const { activeId: activeVerticalId, refetch: refetchVertical } = useVertical();

  // Listen for agent run completion events to show latest report
  useEffect(() => {
    const handleRunCompleted = (event) => {
      const { runId } = event.detail || {};
      if (runId) {
        setLatestRunId(runId);
        setLatestRunTime(new Date().toLocaleTimeString());
      }
    };
    window.addEventListener("agent-run-completed", handleRunCompleted);
    return () =>
      window.removeEventListener("agent-run-completed", handleRunCompleted);
  }, []);

  // Vertical list for the in-sidebar picker. Same data source as
  // VerticalSwitcher (/api/verticals/list). Fetched LAZILY — only when the
  // user expands the Vertical section — so it doesn't add a network call
  // (and OAuth validation) to every dashboard mount. Re-fetches on
  // 'vertical-list-changed' but only after first expansion, so clone/delete
  // from the admin editor stays in sync when the user is looking at it.
  const [verticals, setVerticals] = useState([]);
  const [switchingVertical, setSwitchingVertical] = useState(false);
  const verticalsPickerExpanded = !!expandedSections["vertical-picker"];
  useEffect(() => {
    if (!verticalsPickerExpanded) return;
    let cancelled = false;
    const load = () => {
      fetch("/api/verticals/list", { credentials: "include" })
        .then((r) => (r.ok ? r.json() : []))
        .then((data) => {
          if (!cancelled) setVerticals(Array.isArray(data) ? data : []);
        })
        .catch((err) => console.error("[Sidebar] Vertical list load failed:", err.message));
    };
    load();
    window.addEventListener("vertical-list-changed", load);
    return () => {
      cancelled = true;
      window.removeEventListener("vertical-list-changed", load);
    };
  }, [verticalsPickerExpanded]);

  const handleSwitchVertical = useCallback(
    async (id) => {
      if (!id || id === activeVerticalId || switchingVertical) return;
      setSwitchingVertical(true);
      try {
        await fetch("/api/verticals/active", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id }),
        });
        // Session-scoped switches (e.g. a guest session) do not emit the
        // vertical-switched SSE event VerticalProvider otherwise relies on —
        // refetch explicitly, same as VerticalSwitcher.jsx's handleSwitch, so
        // the banner/title/dialog update without a manual reload.
        await refetchVertical();
        setSwitchingVertical(false);
      } catch (err) {
        console.error("[Sidebar] Switch vertical failed:", err.message);
        setSwitchingVertical(false);
      }
    },
    [activeVerticalId, switchingVertical, refetchVertical],
  );

  const handleAgentPlacement = useCallback(
    async (p) => {
      if (p === placement) return;
      let next;
      let needsReload = true;
      if (p === "middle") {
        setDashboardLayout("split3");
        next = { placement: "middle", fab };
        needsReload = false; // live context update — no flash
      } else {
        next = { placement: "none", fab: true };
      }
      if (needsReload) {
        try {
          localStorage.setItem("banking_agent_ui_v2", JSON.stringify(next));
        } catch (_e) {
          /* noop */
        }
        await persistAgentUi(next);
        window.setTimeout(() => window.location.reload(), 250);
      } else {
        setAgentUi(next);
        await persistAgentUi(next);
      }
    },
    [placement, fab, setAgentUi],
  );

  const handleFabToggle = useCallback(async () => {
    if (placement === "none") return;
    const next = { placement, fab: !fab };
    try {
      localStorage.setItem("banking_agent_ui_v2", JSON.stringify(next));
    } catch (_e) {
      /* noop */
    }
    await persistAgentUi(next);
    window.setTimeout(() => window.location.reload(), 250);
  }, [placement, fab]);

  // Main navigation items (some with submenus) — ALL ROUTES VERIFIED
  // Items with adminOnly: true stay visible to everyone but carry an "admin"
  // badge; non-admin clicks prompt an admin re-login (see adminPromptPath)
  const legacyNavItems = [
    { label: "Home", path: "/", icon: "home" },
    { label: "Security Dashboard", path: "/security-dashboard", icon: "dashboard", adminOnly: true },
    {
      label: "AI-Gateway",
      icon: "shld",
      children: [
        {
          label: "Shadow AI Detector",
          path: "/ai-gateway/shadow-ai-detector",
          icon: "dbg",
          searchAlias: "shadow ai detector ai usage oauth agents sensitive data flows browser extension",
        },
      ],
    },
    {
      label: "AI Agent Gateway",
      icon: "shld",
      children: [
        { label: "Protocol Playground", path: "/protocol-playground", icon: "dbg" },
        { label: "AI Guard Client", path: "/privilege-mcp-client", icon: "shld" },
        { label: "LLM Gateway", path: "/llm-gateway", icon: "key" },
        { label: "Intent Inspector", path: "/intent-inspector", icon: "shld", adminOnly: true },
        { label: "Audit Agent", path: "/audit-agent", icon: "shld" },
        { label: "AI Agent Gateway Guide", path: "/privilege-mcp-learning", icon: "doc" },
        {
          label: "Agent Gateway Authorization",
          path: "/agent-gateway-authorization",
          icon: "doc",
          searchAlias: "agent authorization authorization walkthrough delegated access mcp tool policy PingOne Authorize P1AZ",
        },
        { label: "AI Agent Gateway Diagrams", path: "/privilege-mcp-diagrams", icon: "arc" },
      ],
    },
    {
      label: "AI Product Pages",
      icon: "shld",
      children: [
        { label: "Agent IAM Core", path: "/ai-products/core", icon: "key" },
        { label: "Agent Gateway", path: "/ai-products/gateway", icon: "shld" },
        { label: "PingOne Authorize", path: "/ai-products/authorize", icon: "pol" },
        { label: "PingOne Protect", path: "/ai-products/protect", icon: "shld" },
        { label: "Privilege · LLM", path: "/ai-products/privilege-llm", icon: "key" },
        { label: "Privilege · A2A", path: "/ai-products/privilege-a2a", icon: "lnk" },
        { label: "Privilege · MCP", path: "/ai-products/privilege-mcp", icon: "mcp" },
      ],
    },
    { label: "Skin Studio", path: "/admin/skin-studio", icon: "cfg" },
    {
      label: "Demos",
      icon: "demo",
      children: [
        // Both were bare kickoff ACTIONS (or, for Brave, nothing at all): a click
        // that POSTed a use case and bounced to /dashboard without ever showing
        // the policy it was about to demonstrate. They are pages now — the page
        // still runs the same use case, from a button that says which outcome to
        // expect. `apiClient` / `activeVerticalId` moved with the dispatch.
        { label: "Weather MCP", path: "/weather-mcp", icon: "mcp" },
        { label: "Brave Search MCP", path: "/brave-mcp", icon: "mcp" },
        { label: "Use Cases", path: "/use-cases", icon: "demo" },
        { label: "Use Cases (Live)", path: "/use-cases/live", icon: "demo" },
        { label: "Guided Demo Track", path: "/demo-track", icon: "demo" },
        { label: "Delegation Chain Value", path: "/delegation-chain-value", icon: "demo" },
        { label: "A2A Protocol & Identity", path: "/a2a-protocol-learning", icon: "demo" },
        { label: "Jev Decision Model", path: "/jev-learning", icon: "demo" },
        { label: "Group Policy Board", path: "/group-policy", icon: "demo" },
        {
          label: "Demo Script",
          icon: "demo",
          action: () => window.dispatchEvent(new CustomEvent("demo-script-toggle")),
        },
        { label: "Demo Config", path: "/demo-config", icon: "cfg", adminOnly: true },
      ],
    },
    // Latest report — shown when agent run completes
    ...(latestRunId
      ? [
          {
            label: `Latest Report (${latestRunTime})`,
            path: `/reports`,
            icon: "rpt",
            badge: "new",
          },
        ]
      : []),
    {
      label: "AI Flows",
      icon: "agt",
      children: [
        {
          label: "Agentic Control Plane",
          path: "/control-plane",
          icon: "sec",
          highlight: true,
        },
        {
          // Renamed: this is the kill-switch roster, reachable from the
          // Governance zone. It never was the control plane.
          label: "Agent Kill Switch",
          path: "/ai-control-plane",
          icon: "sec",
          introGate: true,
        },
        {
          label: "Agent Registry",
          path: "/agent-registry",
          icon: "sec",
        },
        {
          label: "PingOne Agent Builder",
          path: "/agent-builder",
          icon: "tool",
        },
        {
          label: "Agent & Token Flow History",
          path: "/agent-flow-inspector",
          icon: "flw",
        },
        {
          label: "Login Flow Diagram",
          path: "/login-flow",
          icon: "flw",
        },
        {
          // Public on purpose (auth-requirements.json) — no adminOnly here.
          label: "Autonomous Agents",
          path: "/autonomous-agents",
          icon: "clk",
        },
        {
          // Public on purpose (auth-requirements.json) — no adminOnly here.
          label: "Personal Agent",
          path: "/personal-agent",
          icon: "agt",
        },
        {
          label: "Agent Lifecycle (guided demo)",
          path: "/agent-lifecycle",
          icon: "agt",
          adminOnly: true,
        },
        {
          label: "Delegated Commerce (guided demo)",
          path: "/delegated-commerce",
          icon: "agt",
          adminOnly: true,
        },
        { label: "Family Delegation", path: "/delegation", icon: "usr", adminOnly: true },
        { label: "LangChain Agent", path: "/langchain", icon: "agt" },
        {
          label: "Ungoverned Agent",
          path: "/ungoverned-agent",
          icon: "dbg",
        },
      ],
    },
    {
      label: "Inspectors",
      icon: "dbg",
      children: [
        { label: "MCP Inspector", path: "/pingone-mcp-inspector", icon: "dbg" },
        { label: "Agent Gateway Inspector", path: "/agent-gateway-inspector", icon: "rte" },
        { label: "P1AZ Inspector", path: "/pingone-authorize", icon: "pol", searchAlias: "PingOne Authorize" },
      ],
    },
    {
      label: "PingOne MCP",
      icon: "mcp",
      children: [
        {
          label: "MCP Inspector",
          path: "/pingone-mcp-inspector",
          icon: "dbg",
        },
        { label: "PingOne MCP Setup", path: "/pingone-setup", icon: "cfg" },
        {
          label: "Enterprise-Managed MCP Auth",
          path: "/demo/enterprise-mcp",
          icon: "shld",
        },
      ],
    },
    {
      label: "MCP & Gateways",
      icon: "rte",
      children: [
        {
          label: "MCP Discovery",
          path: "/mcp-discovery",
          icon: "find",
          searchAlias: "mcp discovery inventory runtime servers",
        },
        {
          label: "Ping AI Test Lab",
          path: "/ping-ai-test-lab",
          icon: "tst",
        },
        {
          label: "Agent Gateway Inspector",
          path: "/agent-gateway-inspector",
          icon: "rte",
        },
        { label: "Capability Tour", path: "/agent-gateway-capabilities", icon: "shld" },
        {
          label: "MCP Runtime Inventory",
          path: "/mcp-discovery",
          icon: "mcp",
          searchAlias: "runtime discovery servers host processes local listeners remote URLs",
        },
      ],
    },
    {
      label: "PingOne Sample Apps",
      icon: "tst",
      children: [
        {
          label: "M2M Client Credentials",
          path: "/samples/m2m-credentials",
          icon: "key",
          searchAlias: "machine to machine client credentials protect sample",
        },
        {
          label: "Custom Admin Role",
          path: "/samples/custom-admin-role",
          icon: "pol",
          searchAlias: "delegated administration custom role sample",
        },
        {
          label: "User Registration",
          path: "/samples/user-registration",
          icon: "usr",
          searchAlias: "self service registration email verification pi.flow sample",
        },
        {
          label: "Login with MFA",
          path: "/samples/mfa-demo",
          icon: "lck",
          searchAlias: "multi factor authentication native flow sample",
        },
      ],
    },
    {
      label: "PingOne Demo Apps",
      icon: "tst",
      children: [
        { label: "Self-Service Registration", path: "/self-service", icon: "usr" },
        { label: "PingOne Test", path: "/pingone-test", icon: "tst" },
        { label: "MFA Test", path: "/mfa-test", icon: "lck" },
        {
          label: "Token Exchange Tester",
          path: "/token-exchange-tester",
          icon: "syn",
        },
        { label: "OAuth Academy", path: "/oauth-academy", icon: "sec" },
        { label: "OAS Demo", path: "/oas-demo", icon: "pol" },
        { label: "Privilege Demo", path: "/privilege-demo", icon: "shld" },
        { label: "SDK Login", path: "/sdk-login", icon: "mbl" },
        { label: "DaVinci SDK", path: "/davinci-sdk", icon: "sec" },
      ],
    },
    {
      label: "Delegation & Consent",
      icon: "dlg",
      children: [
        {
          label: "Transaction Consent",
          path: "/transaction-consent",
          icon: "lck",
        },
        {
          label: "Actor Token Education",
          path: "/actor-token-education",
          icon: "key",
        },
      ],
    },
    {
      label: "Authorize",
      icon: "pol",
      children: [
        { label: "P1AZ Inspector", path: "/pingone-authorize", icon: "pol", searchAlias: "PingOne Authorize" },
        ...(showPacEditorLink
          ? [{
              label: "PAC Editor",
              icon: "edt",
              searchAlias: "Policy as Code",
              action: () => window.open(PAC_EDITOR_URL, "_blank", "noopener,noreferrer"),
            }]
          : []),
        { label: "Authorize Capabilities", path: "/pingone-authorize-capabilities", icon: "pol" },
        {
          label: "Policy Decision Trace",
          path: "/policy-decision-trace",
          icon: "flw",
        },
        {
          label: "Scope Audit",
          path: "/scope-audit",
          icon: "find",
          adminOnly: true,
        },
        {
          label: "Scope Reference",
          path: "/scope-reference",
          icon: "doc",
        },
        {
          label: "Snapshot Import",
          path: "/snapshot-import",
          icon: "file",
        },
        {
          label: "Headless Identity Demo",
          path: "/pingcli",
          icon: "tool",
        },
        {
          label: "Resource Server Checkpoint",
          path: "/resource-server-checkpoint",
          icon: "pol",
        },
      ],
    },
    {
      label: "OAuth & Identity",
      icon: "sec",
      children: [
        {
          label: "Security Settings",
          path: "/settings",
          icon: "cfg",
          adminOnly: true,
        },
        {
          label: "OAuth Debug",
          path: "/oauth-debug-logs",
          icon: "key",
          adminOnly: true,
        },
        {
          label: "CIMD Simulation",
          path: "/client-registration",
          icon: "edt",
          adminOnly: true,
        },
      ],
    },
    {
      label: "Platform Admin",
      icon: "cfg",
      children: [
        // The PingOne admin dashboard used to be /admin and had no side-nav
        // entry at all — it was reached by URL. The support console took
        // /admin, so this content moved to /admin/pingone and now has one.
        {
          label: "PingOne Admin",
          path: "/admin/pingone",
          icon: "cfg",
          adminOnly: true,
        },
      ],
    },
    {
      label: "Industry Verticals",
      icon: "bld",
      children: [
        // adminOnly does not hide these — it shows the "admin" badge and
        // prompts an admin re-login on click. Every /admin/<vertical> route has
        // been wrapped in RequireAdminLogin since PR #1473, but the nav was
        // never updated to match, so a non-admin got an ordinary-looking link
        // that dead-ends at the route-level login wall. /admin is the same.
        // "Support Console" used to sit here pointing at /admin. #1494 put
        // /admin back on the PingOne dashboard and repointed the entry at
        // /admin/sporting-goods, which is exactly where "Sporting Goods Ops"
        // below already goes — same route, same component, duplicate React key.
        // Removed rather than re-keyed: a second link to one destination is not
        // a distinct nav item.
        { label: "Banking Ops", path: "/admin/banking", icon: "acc", adminOnly: true },
        { label: "Healthcare Ops", path: "/admin/healthcare", icon: "cfg", adminOnly: true },
        { label: "Retail Ops", path: "/admin/retail", icon: "cfg", adminOnly: true },
        {
          label: "Sporting Goods Ops",
          path: "/admin/sporting-goods",
          icon: "cfg",
          adminOnly: true,
        },
        { label: "Workforce Ops", path: "/admin/workforce", icon: "cfg", adminOnly: true },
        {
          label: "Vertical Editor",
          path: "/admin/verticals",
          icon: "edt",
          adminOnly: true,
        },
        { label: "Mortgage Path", path: "/path/mortgage", icon: "acc" },
      ],
    },
    {
      label: "Users & Accounts",
      icon: "usr",
      adminOnly: true,
      children: [
        { label: "Users", path: "/users", icon: "usr" },
        { label: "Accounts", path: "/accounts", icon: "acc" },
        { label: "Transactions", path: "/transactions", icon: "txn" },
      ],
    },
    {
      label: "AI Attack Demos",
      icon: "sec",
      children: [
        {
          label: "Prompt Injection",
          icon: "dbg",
          action: () => openEdu(EDU.AI_ATTACKS, "prompt-injection"),
        },
        {
          label: "HITL Bypass",
          icon: "lck",
          action: () => openEdu(EDU.AI_ATTACKS, "hitl-bypass"),
        },
        {
          label: "Indirect Injection",
          icon: "dbg",
          action: () => openEdu(EDU.AI_ATTACKS, "indirect-injection"),
        },
        {
          label: "Unauthorized Commitments",
          icon: "doc",
          action: () => openEdu(EDU.AI_ATTACKS, "unauthorized-commitments"),
        },
        {
          label: "Scope Abuse",
          icon: "pol",
          action: () => openEdu(EDU.AI_ATTACKS, "scope-abuse"),
        },
        {
          label: "Intent Bypass",
          icon: "lck",
          action: () => {
            window.dispatchEvent(new CustomEvent("banking-agent-open"));
            window.dispatchEvent(
              new CustomEvent("banking-attack-demo", {
                detail: { type: "intent-bypass" },
              }),
            );
            // Same no-agent fallback as AiAttacksPanel Run buttons — without
            // this, Intent Bypass is a silent no-op on routes where the agent
            // is not mounted.
            if (!window.__bankingAgentMounted) {
              try {
                sessionStorage.setItem(
                  "banking-agent-pending-attack",
                  JSON.stringify({
                    type: "intent-bypass",
                    payload: { type: "intent-bypass" },
                  }),
                );
              } catch (_) {
                /* sessionStorage unavailable */
              }
              window.location.assign("/dashboard");
            }
          },
        },
      ],
    },
    {
      label: "Monitoring",
      icon: "log",
      children: [
        { label: "Audit Trail", path: "/audit", icon: "srch", adminOnly: true },
        {
          label: "Learning Log",
          icon: "log",
          action: () => {
            window.open(
              "/logs?mode=learn",
              "BankingLogs",
              "width=1400,height=900,scrollbars=yes,resizable=yes",
            );
          },
        },
        {
          label: "Activity Log",
          path: "/monitoring/activity-log",
          icon: "log",
          searchAlias: "activity live event stream",
        },
        {
          label: "API Activity",
          path: "/monitoring/api-activity",
          icon: "api",
          searchAlias: "api activity audit persisted records",
        },
        { label: "Run Reports", path: "/reports", icon: "rpt" },
        {
          label: "Error Audit Log",
          path: "/error-audit",
          icon: "log",
          adminOnly: true,
        },
        {
          label: "New Relic",
          path: "/monitoring/new-relic",
          icon: "log",
        },
        {
          label: "CI Queue Dashboard",
          icon: "log",
          action: () => {
            window.open("http://127.0.0.1:57500/", "_blank", "noopener,noreferrer");
          },
        },
        {
          label: "PingOne Events",
          path: "/monitoring/pingone-events",
          icon: "log",
        },
        {
          label: "PingOne Authorize",
          path: "/monitoring/p1az",
          icon: "log",
        },
        {
          label: "Token Exchange",
          path: "/monitoring/token-exchange",
          icon: "log",
        },
        {
          label: "System Flow",
          path: "/monitoring/system-flow",
          icon: "lnk",
        },
      ],
    },
    {
      label: "Telemetry",
      icon: "log",
      children: [
        { label: "Service Graph", path: "/telemetry", icon: "log" },
        { label: "Tracing", path: "/tracing", icon: "log", searchAlias: "jaeger opentelemetry distributed traces" },
        { label: "Transaction Trace", path: "/transaction-trace", icon: "log" },
        { label: "MCP Observability", path: "/mcp-observability", icon: "log", adminOnly: true },
        {
          // External, so it uses the same action+window.open shape as PAC
          // Editor rather than a router path. Grafana holds PingOne Agent Gateway's own
          // metrics and is where traces open now that the public /jaeger/
          // route is gone; without this entry you have to know the URL.
          label: "Grafana",
          icon: "log",
          searchAlias: "metrics dashboards prometheus pinggateway traces",
          action: () => window.open(grafanaUrl, "_blank", "noopener,noreferrer"),
        },
        { label: "Health Check", path: "/check", icon: "clk" },
      ],
    },
    {
      label: "Diagrams",
      icon: "arc",
      children: [
        { label: "Demo Map", path: "/demo-map", icon: "arc" },
        { label: "All Diagrams", path: "/diagrams", icon: "arc" },
        { label: "Use-case diagrams", path: "/use-case-diagrams", icon: "arc" },
        { label: "Server Topology (Interactive)", path: "/architecture/server-topology", icon: "arc" },
        { label: "PingFederate ID-JAG (Node)", path: "/architecture/pingfederate-id-jag", icon: "arc" },
        {
          label: "System Diagram (Node)",
          path: "/architecture/system",
          icon: "arc",
        },
        // Cross-listed: the canonical entry is Observability > System Flow. Same
        // route, second door — a presenter hunting a system picture looks here,
        // not under Observability. Distinct label so Demo Config (which hides by
        // label) can drop either door without taking the other with it.
        {
          label: "System Flow (Live)",
          path: "/monitoring/system-flow",
          icon: "lnk",
        },
        {
          label: "Overview Diagram (Node)",
          path: "/architecture/overview",
          icon: "bld",
        },
        {
          label: "Token Flow (Interactive) (Node)",
          path: "/architecture/token-flow",
          icon: "lnk",
        },
        {
          label: "Token Chain Architecture (Node)",
          path: "/architecture/token-chain",
          icon: "lnk",
        },
        { label: "Interactive Flow (Node)", path: "/architecture/flow", icon: ">" },
        { label: "Sequence Diagram (Node)", path: "/sequence-diagram", icon: "log" },
        { label: "Canvas Diagram (Node)", path: "/architecture/canvas", icon: "arc" },
        { label: "Delegated Access Proof", path: "/academy/delegation/guided", icon: "lnk" },
        { label: "Demo Steps Lifeline Audit", path: "/demo-steps-lifeline-audit", icon: "log" },
        { label: "Agent Onboarding Flow (Node)", path: "/agent-onboarding-flow", icon: "arc", className: "admin-side-nav__item--onboarding-white" },
        { label: "Agent Onboarding Flow Subway (Node)", path: "/agent-onboarding-flow-subway", icon: "arc", className: "admin-side-nav__item--onboarding-white" },
        { label: "Invest Dual-Auth (MM)", path: "/invest-dual-auth", icon: "rte" },
        { label: "AI Agent Gateway (MM)", path: "/privilege-mcp-diagrams", icon: "lck" },
        { label: "Privilege-First Gateway (Node)", path: "/privilege-first-gateway", icon: "lck" },
        { label: "Gateway vs P1AZ Enforcement (MM)", path: "/gateway-enforcement-map", icon: "arc" },
        { label: "Resource Server Placement (MM)", path: "/resource-server-placement", icon: "arc" },
        { label: "Personal Agent Design (Node)", path: "/personal-agent-design", icon: "arc" },
        { label: "Personal Agent Dual Gateway (Node)", path: "/personal-agent-dual-gateway", icon: "arc" },
        { label: "Personal Agent Design Review", path: "/personal-agent-review", icon: "log" },
        { label: "CIMD in Privilege (Node)", path: "/cimd-privilege", icon: "lck" },
        { label: "A2A Architecture (Node)", path: "/a2a-architecture", icon: "arc" },
      ],
    },
    {
      label: "Demo arch slides",
      icon: "arc",
      children: [
        { label: "Workload Agents · Topology", path: "/demo-arch-slides/workload-agents", icon: "arc" },
        { label: "Workload Agents · CIBA Step-up", path: "/demo-arch-slides/ciba-hitl", icon: "arc" },
        { label: "Workload Agents · 3rd-party MCP via ID-JAG", path: "/demo-arch-slides/id-jag", icon: "arc" },
        { label: "Agentic Control Plane", path: "/demo-arch-slides/control-plane", icon: "arc" },
      ],
    },
    {
      label: "Agent Studio (Preview)",
      icon: "arc",
      children: [
        { label: "IGA for AI", path: "/iga-for-ai", icon: "shld" },
        { label: "Discovery", path: "/discovery-preview", icon: "sec" },
        { label: "AI Agent Gateway (Preview)", path: "/privileges-gateway-preview", icon: "pol" },
        { label: "Platform Gaps", path: "/platform-gaps", icon: "log" },
      ],
    },
    {
      label: "Learn & Present",
      icon: "ref",
      children: [
        {
          label: "AI Security Academy",
          path: "/academy/journey",
          icon: "ref",
          searchAlias: "guided journey standalone demos PingOne OAuth AI security sales engineer presenter",
        },
        {
          label: "Academy Standalone Demos",
          path: "/academy/demos",
          icon: "demo",
          searchAlias: "standalone demo launcher live cloud PingOne presenter",
        },
        { label: "Learning Hub", path: "/learning", icon: "doc" },
        { label: "Privilege Docs Index", path: "/privilege-docs-index", icon: "doc" },
        {
          label: "Learning Hub (Web Mirror)",
          icon: "doc",
          searchAlias: "learning hub static web mirror html standalone share offline",
          // Static pages served from public/learning-mirror/, outside the React router.
          action: () => window.open("/learning-mirror/", "_blank", "noopener,noreferrer"),
        },
        { label: "SPIFFE → PingOne Bridge (TODO)", path: "/spiffe-pingone-bridge", icon: "syn", badge: "TODO" },
        { label: "Agentic Trust", path: "/agentic-trust", icon: "shld" },
        { label: "Agent Guardrails", path: "/agent-guardrails", icon: "pol" },
        { label: "OWASP Agent Risks", path: "/owasp", icon: "sec" },
        { label: "Privilege for AI", path: "/privilege-for-ai", icon: "shld" },
        { label: "MCP Scanner", path: "/mcp-scanner", icon: "dbg" },
        {
          label: "Personal Agent Clients",
          path: "/personal-agent",
          icon: "agt",
          searchAlias: "personal agent clients browser mac external local",
        },
        {
          label: "LibreChat (browser)",
          icon: "chat",
          searchAlias: "librechat browser personal agent mcp client chat privilege libre",
          action: () => window.open(libreChatUrl, "_blank", "noopener,noreferrer"),
        },
        {
          label: "LM Studio (Mac)",
          path: lmStudioSetupPath,
          icon: "agt",
          searchAlias: "lm studio mac local personal agent model mcp",
        },
        {
          label: "llama-vscode Guide",
          path: "/llama-vscode-guide",
          icon: "doc",
        },
      ],
    },
    {
      label: "Developer Tools",
      icon: "tst",
      children: [
        { label: "Code Explorer", path: "/code-explorer", icon: "tst" },
        { label: "Protected RAG", path: "/code-search", icon: "srch" },
        { label: "Graphify", path: "/graphify", icon: "arc" },
        { label: "Mgmt API Runner", path: "/mgmt-api", icon: "tool" },
        { label: "PromptFoo Evals", path: "/promptfoo", icon: "tst", searchAlias: "foo" },
      ],
    },
    {
      label: "System Tools",
      icon: "cfg",
      adminOnly: true,
      children: [
        {
          label: "Feature Flags",
          path: "/configure?tab=feature-flags",
          icon: "flag",
        },
        { label: "LLM Config", path: "/llm-config", icon: "agt" },
        { label: "Secret Rotation", path: "/secret-rotation", icon: "key" },
        { label: "App Configuration", path: "/configure", icon: "fix" },
        { label: "OAuth Debug", path: "/configure?tab=debug", icon: "dbg" },
        { label: "Postman Collections", path: "/postman", icon: "msg" },
        {
          // BFF-served pages, not router routes — same action+window.open
          // shape as Grafana above. Admin-gated server-side (authenticateToken
          // + requireAdmin on the route), so a non-admin tab just gets a 401.
          label: "API Docs (Swagger)",
          icon: "doc",
          searchAlias: "openapi swagger rest api reference",
          action: () => window.open("/api/docs", "_blank", "noopener,noreferrer"),
        },
        {
          label: "API Reference (Scalar)",
          icon: "doc",
          searchAlias: "openapi scalar rest api reference",
          action: () => window.open("/api/reference", "_blank", "noopener,noreferrer"),
        },
      ],
    },
    {
      label: "Integration Tests",
      icon: "tst",
      children: [
        {
          label: "OIDC Resource Server",
          path: "/resource-server",
          icon: "sec",
        },
        {
          label: "CC Resource Server",
          path: "/resource-server-cc",
          icon: "key",
        },
      ],
    },
  ];

  // The sidebar is intentionally organized by user intent rather than by the
  // order in which demos were added. Keep the existing item definitions above
  // as the route/action registry, then compose the presentation groups here.
  const legacyChildren = legacyNavItems.flatMap((item) => item.children || []);
  const legacyFlat = legacyNavItems.filter((item) => !item.children);
  const findLegacyItem = (label, path) => {
    const match = [...legacyChildren, ...legacyFlat].find(
      (item) => item.label === label && (!path || item.path === path),
    );
    if (!match) throw new Error(`Missing navigation item: ${label}`);
    return match;
  };
  const renameLegacyItem = (label, nextLabel, path) => ({
    ...findLegacyItem(label, path),
    label: nextLabel,
  });
  const childrenFrom = (labels) => labels.map((entry) => {
    if (typeof entry === "string") return findLegacyItem(entry);
    if (entry.rename) return renameLegacyItem(entry.from, entry.rename, entry.path);
    if (entry.path) return { ...entry, icon: entry.icon || "doc" };
    return findLegacyItem(entry.label, entry.path);
  });
  const productGroup = (label, labels, icon = "shld") => ({
    label,
    icon,
    children: childrenFrom(labels),
  });

  const allNavItems = [
    findLegacyItem("Home"),
    findLegacyItem("Security Dashboard"),
    findLegacyItem("Skin Studio"),
    productGroup("Agent Privilege", [
      { from: "Shadow AI Detector", rename: "AI Guard" },
      "Protocol Playground",
      "AI Guard Client",
      "LLM Gateway",
      "Intent Inspector",
      "Audit Agent",
      { from: "AI Agent Gateway Guide", rename: "Agent Privilege Guide" },
      "Agent Gateway Authorization",
      { from: "AI Agent Gateway Diagrams", rename: "Agent Privilege Diagrams" },
      "Agent IAM Core",
      "Agent Gateway",
      { from: "PingOne Authorize", rename: "PingOne Authorize", path: "/ai-products/authorize" },
      { from: "Privilege · LLM", rename: "Agent Privilege · LLM" },
      { from: "Privilege · A2A", rename: "Agent Privilege · A2A" },
      { label: "Agent Privilege · A2A Review", path: "/privilege-mcp-client?view=demo&tab=a2a", icon: "lnk" },
      { label: "Agent Privilege Topologies", path: "/privilege-gateway-topologies", icon: "arc" },
      { from: "Privilege · MCP", rename: "Agent Privilege · MCP" },
      { label: "Malicious MCP Catalog", path: "/llm-gateway?tab=catalog", icon: "key" },
      "Protected RAG",
      { from: "Privilege Demo", rename: "Agent Privilege Demo" },
    ]),
    productGroup("DaVinci", [
      { label: "DaVinci Widget", path: "/davinci-widget" },
      { label: "DaVinci Login", path: "/davinci-login-guide" },
      { label: "DaVinci SDK Login", path: "/davinci-sdk-login" },
      { label: "DaVinci Orchestration", path: "/davinci-orchestration" },
      { label: "DaVinci Orchestration SDK", path: "/davinci-orchestration-sdk" },
      { label: "Orchestration SDK Guide", path: "/orchestration-sdk" },
      { label: "DaVinci Orchestration Overview", path: "/davinci-orchestration" },
    ], "doc"),
    productGroup("Ping products", [
      { from: "PingOne Protect", rename: "PingOne Protect", path: "/ai-products/protect" },
      { label: "PingOne Verify & Recognize", path: "/ping-products/verify-recognize", icon: "doc" },
      { from: "Headless Identity Demo", rename: "Headless Identity / PingCLI" },
      "SDK Login",
      "M2M Client Credentials",
      "Custom Admin Role",
    ], "pol"),
    productGroup("Identity Journeys", [
      "Self-Service Registration",
      "User Registration",
      "Login with MFA",
      { from: "Login Flow Diagram", rename: "Identity Journey Map" },
      "OAuth Academy",
      "OAS Demo",
    ], "usr"),
    productGroup("Authorize", [
      "P1AZ Inspector",
      // PAC Editor is only registered on local hostnames (it opens a loopback
      // editor via scripts/pac-edit.sh) — demanding it on any other hostname
      // crashed the whole nav with "Missing navigation item" (2026-09-22).
      ...(showPacEditorLink ? ["PAC Editor"] : []),
      "Authorize Capabilities",
      "Policy Decision Trace",
      "Scope Audit",
      "Scope Reference",
      "Snapshot Import",
      "Resource Server Checkpoint",
    ], "pol"),
    productGroup("Delegation & Consent", [
      "Transaction Consent",
      "Actor Token Education",
      "Family Delegation",
    ], "dlg"),
    productGroup("Utilities", [
      "PingOne Test",
      "MFA Test",
      "OAuth Debug",
      "Token Exchange Tester",
      "OAS Demo",
      { from: "Mgmt API Runner", rename: "Management API Runner" },
      "PingOne MCP Setup",
      "MCP Discovery",
      "Resource Server Checkpoint",
      "Scope Reference",
      "Snapshot Import",
      "Health Check",
    ], "tool"),
    productGroup("AI Experiences", [
      { label: "Demo Summary", path: "/demo-summary", icon: "demo" },
      "Weather MCP",
      "Brave Search MCP",
      "Use Cases",
      "Use Cases (Live)",
      "Guided Demo Track",
      "Delegation Chain Value",
      "A2A Protocol & Identity",
      "Group Policy Board",
      "Demo Script",
      "Agentic Control Plane",
      "Agent Kill Switch",
      "Agent Registry",
      "PingOne Agent Builder",
      "Agent & Token Flow History",
      "Agent Onboarding Flow (Node)",
      "Agent Onboarding Flow Subway (Node)",
      "Autonomous Agents",
      "Agent Lifecycle (guided demo)",
      "Delegated Commerce (guided demo)",
      "LangChain Agent",
      "Ungoverned Agent",
      "Prompt Injection",
      "HITL Bypass",
      "Indirect Injection",
      "Unauthorized Commitments",
      "Scope Abuse",
      "Intent Bypass",
      "IGA for AI",
      "Discovery",
      { from: "AI Agent Gateway (Preview)", rename: "Agent Privilege (Preview)" },
      "Platform Gaps",
      "AI Security Academy",
      "Academy Standalone Demos",
      "Agentic Trust",
      "Agent Guardrails",
      "OWASP Agent Risks",
      { from: "Privilege for AI", rename: "Agent Privilege for AI" },
    ], "agt"),
    productGroup("Personal Agents", [
      "Personal Agent",
      "Personal Agent Clients",
      { label: "Target Design", path: "/personal-agent-design", icon: "arc" },
      { label: "Dual Gateway Design", path: "/personal-agent-dual-gateway", icon: "arc" },
      { label: "Design Review", path: "/personal-agent-review", icon: "log" },
    ], "agt"),
    productGroup("MCP & Integrations", [
      "MCP Inspector",
      "Agent Gateway Inspector",
      "Enterprise-Managed MCP Auth",
      "Ping AI Test Lab",
      "Capability Tour",
      "MCP Runtime Inventory",
      "MCP Scanner",
      "LibreChat (browser)",
      "LM Studio (Mac)",
    ], "mcp"),
    productGroup("PingFederate ID-JAG", [
      { label: "Run ID-JAG Demo", path: "/pingfederate-id-jag/demo" },
      { label: "How ID-JAG Works", path: "/pingfederate-id-jag" },
      { label: "ID-JAG Diagram", path: "/pingfederate-id-jag/diagram" },
    ], "sec"),
    productGroup("PingFederate AI Agent", [
      {
        label: "CIMD, Token Exchange, and RAR",
        path: "/pingfederate-ai-agent",
        searchAlias: "PingFederate PF AI feature comparison AI agent differences ID-JAG third-party token exchange third party token exchange PAR Pushed Authorization Request RAR Rich Authorization Request CIMD",
      },
    ], "sec"),
    productGroup("Developer Tools", [
      "Code Explorer",
      { from: "Graphify", rename: "Graphify" },
      "Postman Collections",
      "API Docs (Swagger)",
      "API Reference (Scalar)",
      "llama-vscode Guide",
      "PromptFoo Evals",
    ], "tst"),
    productGroup("Observability", [
      "Audit Trail",
      "Learning Log",
      "Activity Log",
      "API Activity",
      "Run Reports",
      "Error Audit Log",
      "New Relic",
      "CI Queue Dashboard",
      "PingOne Events",
      { from: "PingOne Authorize", rename: "PingOne Authorize Decisions", path: "/monitoring/p1az" },
      "Token Exchange",
      "System Flow",
      "Service Graph",
      "Tracing",
      "Transaction Trace",
      "MCP Observability",
      "Grafana",
    ], "log"),
    productGroup("Diagrams", [
      "Server Topology (Interactive)",
      "PingFederate ID-JAG (Node)",
      "System Diagram (Node)",
      "Overview Diagram (Node)",
      "Token Flow (Interactive) (Node)",
      "Token Chain Architecture (Node)",
      "Interactive Flow (Node)",
      "Sequence Diagram (Node)",
      "Canvas Diagram (Node)",
      "Delegated Access Proof",
      "Demo Steps Lifeline Audit",
      "Invest Dual-Auth (MM)",
      { from: "AI Agent Gateway (MM)", rename: "Agent Privilege (MM)" },
      { from: "Privilege-First Gateway (Node)", rename: "Agent Privilege Enforcement (Node)" },
      "Gateway vs P1AZ Enforcement (MM)",
      "Resource Server Placement (MM)",
      "Personal Agent Design (Node)",
      "Personal Agent Dual Gateway (Node)",
      "Personal Agent Design Review",
    ], "arc"),
    productGroup("Demo arch slides", [
      "Workload Agents · Topology",
      "Workload Agents · CIBA Step-up",
      "Workload Agents · 3rd-party MCP via ID-JAG",
      "Agentic Control Plane",
    ], "arc"),
    productGroup("Architecture & Learning", [
      "Learning Hub",
      "Learning Hub (Web Mirror)",
      "Privilege Docs Index",
      { label: "Page Catalog", path: "/page-catalog" },
      "SPIFFE → PingOne Bridge (TODO)",
      "llama-vscode Guide",
    ], "arc"),
    productGroup("Administration", [
      "Feature Flags",
      "LLM Config",
      "Secret Rotation",
      "App Configuration",
      "Security Settings",
      "CIMD Simulation",
      "Demo Config",
      "PingOne Admin",
      "Banking Ops",
      "Healthcare Ops",
      "Retail Ops",
      "Sporting Goods Ops",
      "Workforce Ops",
      "Vertical Editor",
      "Mortgage Path",
      "Users",
      "Accounts",
      "Transactions",
      "OIDC Resource Server",
      "CC Resource Server",
    ], "cfg"),
  ];

  // Filter by role. adminOnly items are NOT hidden — they render with an
  // "admin" badge and non-admin clicks prompt an admin re-login instead.
  // Then filter by the user's Demo Config hidden-item selection — "Demo
  // Config" itself is never hideable (would lock the user out of undoing it).
  // Finally, apply the user's saved navOrder (from Demo Config reorder) when present.
  const filteredItems = allNavItems
    .filter((item) => !item.customerOnly || !isAdmin)
    .filter((item) => item.label === "Demo Config" || !hiddenNavLabels.includes(item.label))
    // Same rules one level down, so labels that moved into a group (e.g. the
    // Demos children) keep honoring customerOnly and Demo Config hides.
    .map((item) =>
      Array.isArray(item.children)
        ? {
            ...item,
            children: item.children.filter(
              (child) =>
                (!child.customerOnly || !isAdmin) &&
                (child.label === "Demo Config" || !hiddenNavLabels.includes(child.label)),
            ),
          }
        : item,
    );
  // Escape hatch: hiding the whole Demos group must never take the Demo Config
  // page's own link with it (the user could not undo the hide from the sidebar).
  if (hiddenNavLabels.includes("Demos")) {
    filteredItems.push({ label: "Demo Config", path: "/demo-config", icon: "cfg", adminOnly: true });
  }

  // Apply the user's saved child moves/reorder (Demo Config drag of the items
  // under a group) AFTER the role/hide filters, so a hidden or role-filtered
  // child can't be smuggled back in via childOrder. A group whose children all
  // moved away (and that has no path/action of its own) is dropped — rendering
  // it would produce a dead <Link to={undefined}>.
  const childOrderedItems = applyChildOrder(filteredItems, childOrder).filter(
    (item) =>
      !(Array.isArray(item.children) && item.children.length === 0 && !item.path && !item.action),
  );

  const navItems = (() => {
    if (!Array.isArray(navOrder) || navOrder.length === 0) return childOrderedItems;
    const byLabel = Object.fromEntries(childOrderedItems.map((i) => [i.label, i]));
    const result = navOrder.filter((l) => byLabel[l]).map((l) => byLabel[l]);
    // Items the saved order predates keep their NATURAL position instead of
    // being appended to the end.
    //
    // A saved navOrder is a snapshot of the nav as it was when the user dragged
    // it, so every group added since is absent from it. Appending them all to
    // the bottom buried "AI Agent Gateway" below "Integration Tests" for anyone
    // with a saved order — it rendered, but 20+ groups down from where its
    // position in allNavItems says it belongs, which reads as missing. Same for
    // "PingOne Sample Apps" and "Platform Admin". Worse, navOrder is returned
    // even when ff_sidebar_customization is OFF (routes/userNavConfig.js only
    // gates hiddenLabels), so turning the feature off did not escape it either.
    //
    // Each unknown item is placed after its nearest preceding natural sibling
    // that the saved order does know about — which puts a new group where the
    // code says it goes, while leaving every explicitly-ordered item where the
    // user put it. Consecutive unknowns keep their relative order because each
    // one is in `result` by the time the next is placed.
    childOrderedItems.forEach((item, naturalIdx) => {
      if (navOrder.includes(item.label)) return;
      let insertAt = 0;
      for (let i = naturalIdx - 1; i >= 0; i--) {
        const at = result.indexOf(childOrderedItems[i]);
        if (at !== -1) { insertAt = at + 1; break; }
      }
      result.splice(insertAt, 0, item);
    });
    return result;
  })();

  // Live filter: match by label (or an item's optional search alias, for
  // renamed items whose old/product name should still surface them — e.g.
  // "P1AZ Inspector" via "authorize") across top-level items and their
  // children. A group is kept if its own label/alias matches (all children
  // shown) or if any child matches (only matching children shown). Empty
  // query = show everything.
  const navQuery = navFilter.trim().toLowerCase();
  const itemMatches = (item) =>
    String(item?.label || "").toLowerCase().includes(navQuery) ||
    String(item?.searchAlias || "").toLowerCase().includes(navQuery);
  const filterNavItem = (item) => {
    if (!navQuery) return item;
    if (item.children?.length) {
      if (itemMatches(item)) return item;
      const kids = item.children.filter((c) => itemMatches(c));
      return kids.length ? { ...item, children: kids } : null;
    }
    return itemMatches(item) ? item : null;
  };
  const visibleNavItems = navQuery
    ? navItems.map(filterNavItem).filter(Boolean)
    : navItems;

  // Agent UI placement options for the expandable dropdown.
  // Two layouts, and they are the only two: the bottom dock came out of this
  // picker in Phase 4e and its code paths are now gone too, so a persisted
  // 'bottom' coerces to middle in AgentUiModeContext.
  // 'middle' is rendered as "Embedded" — the dashboard split layout is
  // where the agent lives inline.
  const agentPlacementOptions = [
    { key: "middle", label: "Embedded", icon: "|" },
    { key: "none", label: "Float only", icon: "chat" },
  ];

  // Action items (buttons, not navigation links)
  const actionItems = [
    ...(user
      ? [
          {
            label: isAdmin ? "Customer View" : "Admin View",
            action: "switch-role",
            icon: "<>",
          },
        ]
      : []),
    { label: "Reset Demo", action: "reset-demo", icon: "syn" },
    ...(user
      ? [{ label: "Sign Out", action: "logout", icon: "out" }]
      : [{ label: "Sign In", action: "sign-in", icon: "key" }]),
  ];

  // Base route matcher (no Home fallback) — used to decide whether ANY sidebar
  // item matches the current route.
  const pathMatches = (path) => {
    if (path === "/") return location.pathname === "/";
    if (path === "/admin" || path === "/dashboard")
      return location.pathname === path;
    return (
      location.pathname === path || location.pathname.startsWith(`${path}/`)
    );
  };

  // Every routable path in the sidebar (top-level + children), so Home can act
  // as the default highlight when the current route matches none of them.
  const collectPaths = (items) =>
    items.flatMap((item) => [
      ...(item.path ? [item.path] : []),
      ...(item.children ? collectPaths(item.children) : []),
    ]);
  // Quick-link routes live outside navItems but still show their own active
  // state — fold them in so Home yields instead of double-highlighting.
  const QUICK_LINK_PATHS = ["/dashboard", "/admin", "/configure"];
  const anyNavActive =
    collectPaths(navItems).some((p) => p !== "/" && pathMatches(p)) ||
    QUICK_LINK_PATHS.some((p) => pathMatches(p));

  const isActive = (path) => {
    // Home ("/") is the default selection: highlighted on "/" and also as a
    // fallback when no other sidebar item matches the current route.
    if (path === "/") return location.pathname === "/" || !anyNavActive;
    return pathMatches(path);
  };

  const isParentActive = (item) => {
    if (!item.children) return false;
    return item.children.some((child) => child.path && isActive(child.path));
  };

  // Top-level nav sections behave as an accordion: opening one collapses any
  // other open top-level section, so a group stays expanded until the user
  // opens a different one (clicking a link inside it doesn't toggle, so it
  // stays open while in use). Nested sub-sections (e.g. Learn's sub-groups)
  // toggle independently and don't disturb the top-level accordion.
  const isTopLevelSection = (key) =>
    key.startsWith("nav-") ||
    key === "learn" ||
    key === "vertical-picker" ||
    key === "agent-ui-placement";

  const toggleSection = (sectionKey) => {
    setExpandedSections((prev) => {
      const willOpen = !prev[sectionKey];
      if (!isTopLevelSection(sectionKey)) {
        return { ...prev, [sectionKey]: willOpen };
      }
      // Collapse other top-level sections; preserve nested sub-section state.
      const next = {};
      for (const [k, v] of Object.entries(prev)) {
        if (!isTopLevelSection(k)) next[k] = v;
      }
      next[sectionKey] = willOpen;
      return next;
    });
  };

  const handleAction = (action) => {
    // If action is a function, call it directly
    if (typeof action === "function") {
      action();
      return;
    }

    switch (action) {
      case "switch-role": {
        // The two directions are not symmetric. "Customer View" is a view
        // change: the customer dashboard is viewable without authentication, so
        // it must not sign the admin out — startRoleSwitch POSTs
        // /api/auth/switch, which returns the login URL and destroys the current
        // session. "Admin View" genuinely changes identity and still requires
        // authenticating as an admin.
        if (isAdmin) {
          spinner.show("Loading customer dashboard…", "/dashboard");
          navigate("/dashboard");
          break;
        }
        startRoleSwitch("admin").catch((e) => {
          console.error("[Sidebar] Role switch failed:", e.message);
        });
        break;
      }
      case "logout":
        setShowLogoutConfirm(true);
        break;
      case "reset-demo":
        setShowResetModal(true);
        break;
      case "sign-in":
        navigateToCustomerOAuthLogin();
        break;
      default:
        break;
    }
  };

  async function finishReadyReset(generation) {
    if (generation !== readinessGenerationRef.current || readinessResetStartedRef.current) return;
    readinessResetStartedRef.current = true;
    setReadinessJob((current) => current ? { ...current, cleanup: "running" } : current);
    try {
      await apiClient.post("/api/admin/reset-demo");
      try { localStorage.removeItem("tokenChainHistory"); } catch (_) {}
      try { localStorage.removeItem("api-traffic-store"); } catch (_) {}
      performLogout();
    } catch (error) {
      console.error("[Sidebar] Reset Demo failed:", error?.message || "cleanup failed");
      readinessResetStartedRef.current = false;
      setReadinessJob((current) => current ? {
        ...current,
        cleanup: "failed",
        error: "Readiness passed, but demo cleanup failed. You are still signed in.",
      } : current);
      notifyError("Reset Demo failed. Please try again.");
    }
  }

  async function pollReadinessJob(jobId, generation = readinessGenerationRef.current) {
    if (generation !== readinessGenerationRef.current) return;
    clearTimeout(readinessPollTimerRef.current);
    try {
      const { data } = await apiClient.get(`/api/admin/demo-readiness/jobs/${encodeURIComponent(jobId)}`);
      if (generation !== readinessGenerationRef.current) return;
      const snapshot = { ...data, jobId };
      setReadinessJob(snapshot);
      if (snapshot.status === "ready" && isFullyReadyReadinessReport(snapshot.report)) {
        await finishReadyReset(generation);
        return;
      }
      if (snapshot.status === "ready") {
        setReadinessJob((current) => current ? {
          ...current,
          status: "not-ready",
          error: "The readiness report did not prove both targets fully READY. Reset was not run.",
        } : current);
        return;
      }
      if (snapshot.status === "running") {
        readinessPollTimerRef.current = setTimeout(
          () => pollReadinessJob(jobId, generation),
          READINESS_POLL_INTERVAL_MS,
        );
      }
    } catch (error) {
      if (generation !== readinessGenerationRef.current) return;
      console.error("[Sidebar] Readiness status check failed:", error?.message || "request failed");
      setReadinessJob((current) => current ? {
        ...current,
        status: "poll-error",
        error: "Readiness status could not be loaded. Reset was not run. Retry the status check or start a new run.",
      } : current);
    }
  }

  async function handleResetConfirm() {
    setShowResetModal(false);
    clearTimeout(readinessPollTimerRef.current);
    readinessResetStartedRef.current = false;
    const generation = ++readinessGenerationRef.current;
    setReadinessJob({ status: "starting", progress: { phase: "starting" }, preview: null, report: null });
    try {
      const { data } = await apiClient.post("/api/admin/demo-readiness/jobs");
      if (!data?.jobId) throw new Error("readiness job ID was not returned");
      if (generation !== readinessGenerationRef.current) return;
      setReadinessJob((current) => current ? { ...current, ...data, jobId: data.jobId } : current);
      await pollReadinessJob(data.jobId, generation);
    } catch (error) {
      if (generation !== readinessGenerationRef.current) return;
      console.error("[Sidebar] Readiness job could not start:", error?.message || "request failed");
      setReadinessJob({
        status: "failed",
        error: "The demo readiness job could not start. Reset was not run.",
      });
    }
  }

  async function handleRepairConfirm() {
    const activeJob = readinessJob;
    const repairDigest = activeJob?.preview?.digest;
    if (!activeJob?.jobId || !repairDigest) return;
    setShowRepairConfirm(false);
    const generation = readinessGenerationRef.current;
    setReadinessJob((current) => current ? { ...current, status: "running", error: null } : current);
    try {
      await apiClient.post(
        `/api/admin/demo-readiness/jobs/${encodeURIComponent(activeJob.jobId)}/confirm`,
        { digest: repairDigest },
      );
      await pollReadinessJob(activeJob.jobId, generation);
    } catch (error) {
      if (generation !== readinessGenerationRef.current) return;
      console.error("[Sidebar] Readiness repair confirmation failed:", error?.message || "request failed");
      setReadinessJob((current) => current ? {
        ...current,
        status: "not-ready",
        error: "The repair preview could not be confirmed. Start a new readiness run; reset was not run.",
      } : current);
    }
  }

  function declineRepairConfirmation() {
    setShowRepairConfirm(false);
    setReadinessJob((current) => current ? { ...current, declined: true } : current);
  }

  function closeReadinessJob() {
    clearTimeout(readinessPollTimerRef.current);
    readinessGenerationRef.current += 1;
    setShowRepairConfirm(false);
    setReadinessJob(null);
  }

  // Kill-switch state/handlers moved to App.js — this component (and its
  // local state) unmounts the instant `user` clears, which a successful kill
  // does immediately as its own side effect. A modal owned here can never
  // survive long enough to show its own result. See App.js's `AppWithAuth`.

  const NavIcon = ({ name }) => {
    const IconComponent = ICON_MAP[name];
    if (IconComponent)
      return <IconComponent size={16} className="admin-side-nav__icon" />;
    return null;
  };

  const renderNavItem = (item, sectionKey, index, forceOpen = false) => {
    // Stable slug-based key (not array position) so expansion state survives
    // reorders/role-filtering. See slugify / sectionIdOf.
    const itemKey = `${sectionKey}-${sectionIdOf(item, index)}`;
    const submenuId = `${itemKey}-submenu`;
    // forceOpen (active filter) expands matching groups transiently without
    // touching persisted expansion state.
    const isExpanded = forceOpen || expandedSections[itemKey];
    const hasChildren = item.children && item.children.length > 0;

    if (hasChildren) {
      return (
        <div key={itemKey} className={`admin-side-nav__group ${navGroupClassName(item.label)}`}>
          <button
            type="button"
            className={`admin-side-nav__item admin-side-nav__item--parent${isParentActive(item) ? " admin-side-nav__item--parent-active" : ""}${item.highlight ? " admin-side-nav__item--highlight-danger" : ""}`}
            onClick={() => toggleSection(itemKey)}
            title={collapsed ? item.label : undefined}
            aria-expanded={isExpanded ? "true" : "false"}
            aria-controls={submenuId}
          >
            <NavIcon name={item.icon} />
            {!collapsed && (
              <>
                <span className="admin-side-nav__label">{item.label}</span>
                {item.adminOnly && (
                  <span className="admin-side-nav__badge">🔐 admin</span>
                )}
                <span
                  className={`admin-side-nav__chevron ${isExpanded ? "admin-side-nav__chevron--expanded" : ""}`}
                  aria-hidden="true"
                >
                  →
                </span>
              </>
            )}
          </button>
          {/* Inline when expanded; when collapsed, rendered as a hover flyout
              (CSS positions it and reveals on group hover) so grouped items
              stay reachable without expanding the rail. */}
          {(isExpanded || collapsed) && (
            <section
              id={submenuId}
              aria-label={item.label}
              className={`admin-side-nav__submenu${collapsed ? " admin-side-nav__submenu--flyout" : ""}`}
            >
              {collapsed && (
                <div className="admin-side-nav__flyout-title">{item.label}</div>
              )}
              {item.children.map((child) => {
                const isAdminFeature = child.adminOnly || item.adminOnly;
                // A group may intentionally expose two labels for one route
                // (for example MCP Discovery and MCP Runtime Inventory). The
                // destination is not a unique React identity; keep the label
                // in the key so both links retain their own identity.
                const childKey = `${itemKey}-child-${slugify(child.label)}-${child.path || child.action || "action"}`;
                return child.action ? (
                  <button
                    key={childKey}
                    type="button"
                    className="admin-side-nav__item admin-side-nav__item--child"
                    title={child.label}
                    onClick={child.action}
                  >
                    <NavIcon name={child.icon} />
                    <span className="admin-side-nav__label">{child.label}</span>
                  </button>
                ) : (
                  <Link
                    key={childKey}
                    to={child.path}
                    className={`admin-side-nav__item admin-side-nav__item--child${child.highlight ? " admin-side-nav__item--highlight-danger" : ""}${child.className ? ` ${child.className}` : ""} ${isActive(child.path) ? " admin-side-nav__item--active" : ""}`}
                    title={child.label}
                    aria-current={isActive(child.path) ? "page" : undefined}
                    onClick={
                      child.introGate
                        ? (e) => {
                            e.preventDefault();
                            setControlPlaneIntroPath(child.path);
                          }
                        : !isAdmin && isAdminFeature
                          ? (e) => {
                              e.preventDefault();
                              setAdminPromptPath(child.path);
                            }
                          : undefined
                    }
                  >
                    <NavIcon name={child.icon} />
                    <span className="admin-side-nav__label">{child.label}</span>
                    {isAdminFeature && (
                      <span className="admin-side-nav__badge">🔐 admin</span>
                    )}
                  </Link>
                );
              })}
            </section>
          )}
        </div>
      );
    }

    if (item.action) {
      return (
        <button
          key={itemKey}
          type="button"
          className="admin-side-nav__item"
          title={collapsed ? item.label : undefined}
          onClick={() => handleAction(item.action)}
        >
          <NavIcon name={item.icon} />
          {!collapsed && (
            <span className="admin-side-nav__label">{item.label}</span>
          )}
        </button>
      );
    }

    return (
      <Link
        key={itemKey}
        to={item.path}
        onClick={
          item.introGate
            ? (e) => {
                e.preventDefault();
                setControlPlaneIntroPath(item.path);
              }
            : !isAdmin && item.adminOnly
              ? (e) => {
                  e.preventDefault();
                  setAdminPromptPath(item.path);
                }
              : undefined
        }
        className={`admin-side-nav__item ${item.highlight ? "admin-side-nav__item--highlight-danger" : ""} ${isActive(item.path) ? "admin-side-nav__item--active" : ""}`}
        title={collapsed ? item.label : undefined}
        aria-current={isActive(item.path) ? "page" : undefined}
      >
        <NavIcon name={item.icon} />
        {!collapsed && (
          <>
            <span className="admin-side-nav__label">{item.label}</span>
            {item.adminOnly && (
              <span className="admin-side-nav__badge">🔐 admin</span>
            )}
            {item.badge && (
              <span className="admin-side-nav__badge">{item.badge}</span>
            )}
          </>
        )}
      </Link>
    );
  };

  const readinessReport = readinessJob?.report;
  const readinessPreview = readinessJob?.preview || readinessReport?.repairPreview;
  const readinessChanges = Array.isArray(readinessPreview?.changes) ? readinessPreview.changes : [];
  const readinessBlockedChanges = Array.isArray(readinessPreview?.blocked) ? readinessPreview.blocked : [];
  const readinessFindingSource = readinessReport || readinessJob?.progress;
  const readinessFailures = [
    ...(Array.isArray(readinessFindingSource?.checks) ? readinessFindingSource.checks : []),
    ...(Array.isArray(readinessFindingSource?.rows) ? readinessFindingSource.rows : []),
  ].filter((row) => row && row.status !== "pass");
  const readinessBlockingFailures = readinessFailures.filter((row) => row.required !== false);
  const canConfirmReadinessRepairs = readinessJob?.status === "awaiting-confirmation"
    && typeof readinessPreview?.digest === "string"
    && readinessChanges.length > 0
    && readinessBlockedChanges.length === 0
    && !readinessJob.declined;
  const readinessPhase = readinessJob?.progress?.phase || readinessJob?.status;
  const readinessStatusTone = readinessJob?.cleanup === "failed"
    || readinessBlockingFailures.length > 0
    || Boolean(readinessJob?.error)
    ? "blocked"
    : readinessReport?.ready === true ? "ready" : "";

  return (
    <div
      className={`admin-side-nav ${collapsed ? "admin-side-nav--collapsed" : ""}${hidden ? " admin-side-nav--hidden" : ""}`}
      style={collapsed ? undefined : { width: sidebarWidth }}
    >
      {/* Drag-to-resize handle */}
      {!collapsed && (
        // biome-ignore lint/a11y/noStaticElementInteractions: pointer-only drag affordance; keyboard users resize via the collapse toggle.
        <div
          className="admin-side-nav__resize-handle"
          {...resizeHandleProps}
        />
      )}

      {/* Collapse Toggle Button */}
      <button
        type="button"
        className="admin-side-nav__toggle"
        onClick={() => {
          const next = !collapsed;
          autoCollapsedRef.current = false;
          seqViewAutoCollapsedRef.current = false;
          setCollapsed(next);
          try {
            window.localStorage.setItem(COLLAPSED_KEY, String(next));
          } catch {
            /* private mode — the choice is session-only */
          }
        }}
        aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        title={collapsed ? "Expand" : "Collapse"}
      >
        {collapsed ? "→" : "←"}
      </button>

      {/* Ping2026 skin brand header — hidden by CSS unless body.admin-skin-p1 */}
      {!collapsed && (
        <div className="admin-side-nav__ping-brand" aria-label="Super Banking PingOne platform demo">
          <span className="admin-side-nav__ping-mark">P1</span>
          <span className="admin-side-nav__ping-wordmark">
            <strong>Super Banking</strong>
            <small>PingOne platform demo</small>
          </span>
        </div>
      )}

      {/* Navigation Menu */}
      <nav className="admin-side-nav__menu" aria-label="Primary navigation">
        {/* Quick-access shortcuts — single column of icons when collapsed
            (incl. Refresh); 2×2 of Agent/Admin/Setup when expanded (Refresh
            lives next to search). */}
        <div className="admin-side-nav__quick-links">
          <button
            type="button"
            className={`admin-side-nav__quick-link${location.pathname === "/dashboard" ? " admin-side-nav__quick-link--active" : ""}`}
            title="Agent View"
            // Viewing the customer dashboard never re-authenticates. This used to
            // POST /api/auth/switch, which returns {redirectUrl:'/api/auth/oauth/
            // user/login'} \u2014 it destroyed the admin session and forced a PingOne
            // login just to look at the page. The customer dashboard is viewable
            // without authn; only protected prompts need it. An admin token is
            // refused on customer data (requireNotAdmin, 403), so the dashboard
            // shows demo data, exactly as it does for a signed-out visitor.
            onClick={() => {
              spinner.show('Loading customer dashboard\u2026', '/dashboard');
              navigate("/dashboard");
            }}
          >
            {collapsed ? <span className="admin-side-nav__quick-initial" aria-hidden="true">Ag</span> : <MdDashboard size={16} aria-hidden="true" />}
            {!collapsed && <span>Agent</span>}
          </button>
          <button
            type="button"
            className={`admin-side-nav__quick-link${location.pathname === "/admin" ? " admin-side-nav__quick-link--active" : ""}`}
            title="Admin View"
            onClick={() => {
              if (isAdmin) {
                navigate("/admin");
                return;
              }
              fetch("/api/auth/switch", {
                method: "POST",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ targetRole: "admin" }),
              })
                .then((r) => r.json())
                .then(({ redirectUrl }) => {
                  window.location.href = redirectUrl;
                })
                .catch((e) =>
                  console.error("[QuickNav] switch failed:", e.message),
                );
            }}
          >
            {collapsed ? <span className="admin-side-nav__quick-initial" aria-hidden="true">Ad</span> : <MdSecurity size={16} aria-hidden="true" />}
            {!collapsed && <span>Admin</span>}
          </button>
          <Link
            to="/configure"
            className={`admin-side-nav__quick-link${location.pathname.startsWith("/configure") ? " admin-side-nav__quick-link--active" : ""}`}
            title="Setup"
          >
            {collapsed ? <span className="admin-side-nav__quick-initial" aria-hidden="true">S</span> : <MdSettings size={16} aria-hidden="true" />}
            {!collapsed && <span>Setup</span>}
          </Link>
          <Link
            to="/admin/agentic-access-console"
            className={`admin-side-nav__quick-link${location.pathname === "/admin/agentic-access-console" ? " admin-side-nav__quick-link--active" : ""}`}
            title="Agentic Access Console"
          >
            {collapsed ? <span className="admin-side-nav__quick-initial" aria-hidden="true">C</span> : <MdShield size={16} aria-hidden="true" />}
            {!collapsed && <span>Console</span>}
          </Link>
          <button
            type="button"
            className="admin-side-nav__quick-link admin-side-nav__quick-link--demo-controls"
            title="Open the agent's Demo Controls dock"
            onClick={() => {
              window.dispatchEvent(new CustomEvent("agent-command-dock-open"));
            }}
          >
            {collapsed ? <span className="admin-side-nav__quick-initial" aria-hidden="true">D</span> : "🎛"}
            {!collapsed && <span>Demo Controls</span>}
          </button>
          {collapsed && (
            <button
              type="button"
              className="admin-side-nav__quick-link"
              title="Refresh sidebar (pick up Demo Config changes)"
              aria-label="Refresh sidebar"
              onClick={loadNavConfig}
            >
              <span className="admin-side-nav__quick-initial" aria-hidden="true">R</span>
            </button>
          )}
        </div>

        {/* Filter — live-filters nav items by label or search alias (hidden when collapsed) */}
        {!collapsed && (
          <div className="admin-side-nav__filter-row">
            <div className="admin-side-nav__filter">
              <MdSearch
                className="admin-side-nav__filter-icon"
                size={16}
                aria-hidden="true"
              />
              <input
                type="text"
                className="admin-side-nav__filter-input"
                placeholder="Search menu…"
                value={navFilter}
                onChange={(e) => setNavFilter(e.target.value)}
                aria-label="Search navigation"
              />
              {navFilter && (
                <button
                  type="button"
                  className="admin-side-nav__filter-clear"
                  onClick={() => setNavFilter("")}
                  aria-label="Clear filter"
                  title="Clear"
                >
                  ✕
                </button>
              )}
            </div>
            <button
              type="button"
              className="admin-side-nav__filter-refresh"
              title="Refresh sidebar (pick up Demo Config changes)"
              aria-label="Refresh sidebar"
              onClick={loadNavConfig}
            >
              <MdRefresh size={16} aria-hidden="true" />
            </button>
          </div>
        )}

        {/* Main Navigation Section */}
        <div className="admin-side-nav__section">
          {visibleNavItems.map((item, idx) => (
            <Fragment key={`nav-section-${item.label}`}>
              {!collapsed && NAV_SECTION_LABELS.has(item.label) && (
                <div className="admin-side-nav__section-label">
                  {NAV_SECTION_LABELS.get(item.label)}
                </div>
              )}
              {renderNavItem(item, "nav", idx, !!navQuery)}
            </Fragment>
          ))}
          {!collapsed && navQuery && visibleNavItems.length === 0 && (
            <div className="admin-side-nav__filter-empty">
              No matches for “{navFilter.trim()}”
            </div>
          )}
        </div>

        {/* Agent UI Placement — expandable dropdown */}
        {!collapsed && <div className="admin-side-nav__divider" />}
        <div className="admin-side-nav__section">
          <div>
            <button
              type="button"
              className="admin-side-nav__item admin-side-nav__item--parent"
              onClick={() => toggleSection("agent-ui-placement")}
              title={collapsed ? "Agent UI Placement" : undefined}
            >
              <NavIcon name="agt" />
              {!collapsed && (
                <>
                  <span className="admin-side-nav__label">Agent UI</span>
                  <span
                    className={`admin-side-nav__chevron ${expandedSections["agent-ui-placement"] ? "admin-side-nav__chevron--expanded" : ""}`}
                  >
                    →
                  </span>
                </>
              )}
            </button>
            {expandedSections["agent-ui-placement"] && !collapsed && (
              <div className="admin-side-nav__submenu">
                {agentPlacementOptions.map((opt) => (
                  <button
                    type="button"
                    key={opt.key}
                    onClick={() => void handleAgentPlacement(opt.key)}
                    className={`admin-side-nav__item admin-side-nav__item--child${placement === opt.key ? " admin-side-nav__item--active" : ""}`}
                    title={opt.label}
                  >
                    <NavIcon name={opt.icon} />
                    <span className="admin-side-nav__label">{opt.label}</span>
                  </button>
                ))}
                {placement !== "none" && (
                  <label className="admin-side-nav__item admin-side-nav__item--child admin-side-nav__fab-toggle">
                    <input
                      type="checkbox"
                      checked={fab}
                      onChange={() => void handleFabToggle()}
                    />
                    <span className="admin-side-nav__label">+ Show FAB</span>
                  </label>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Vertical picker — same data source as the TopNav VerticalSwitcher
            (/api/verticals/list + POST /api/verticals/active). Header always
            renders; the list is fetched lazily on first expansion to avoid
            adding a network call to every dashboard mount. Uses existing
            item/submenu classes only — no CSS or renderIcon changes. */}
        {!collapsed && <div className="admin-side-nav__divider" />}
        <div className="admin-side-nav__section">
          <div>
            <button
              type="button"
              className="admin-side-nav__item admin-side-nav__item--parent"
              onClick={() => toggleSection("vertical-picker")}
              title={collapsed ? "Vertical" : undefined}
            >
              <NavIcon name="bld" />
              {!collapsed && (
                <>
                  <span className="admin-side-nav__label">Vertical</span>
                  <span
                    className={`admin-side-nav__chevron ${expandedSections["vertical-picker"] ? "admin-side-nav__chevron--expanded" : ""}`}
                  >
                    →
                  </span>
                </>
              )}
            </button>
            {expandedSections["vertical-picker"] && !collapsed && (
              <div className="admin-side-nav__submenu">
                {verticals.map((v) => (
                  <button
                    key={v.id}
                    type="button"
                    onClick={() => void handleSwitchVertical(v.id)}
                    disabled={switchingVertical}
                    className={`admin-side-nav__item admin-side-nav__item--child${v.id === activeVerticalId ? " admin-side-nav__item--active" : ""}`}
                    title={v.displayName}
                  >
                    <NavIcon name="*" />
                    <span className="admin-side-nav__label">
                      {v.displayName}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Stop Agent */}
        {!collapsed && <div className="admin-side-nav__divider" />}
        <div className="admin-side-nav__section">
          <button
            type="button"
            className="admin-side-nav__item admin-side-nav__stop-agent"
            onClick={() => !agentRevoked && onStopAgentClick()}
            disabled={agentRevoked}
            title={
              agentRevoked
                ? "Agent already revoked"
                : "Stop agent (emergency control)"
            }
          >
            <NavIcon name="stp" />
            {!collapsed && (
              <span className="admin-side-nav__label">
                {agentRevoked ? "AGENT REVOKED" : "STOP AGENT"}
              </span>
            )}
          </button>
        </div>


        {/* Divider */}
        {!collapsed && <div className="admin-side-nav__divider" />}

        {/* Actions Section */}
        <div className="admin-side-nav__section">
          {actionItems.map((item) => (
            <button
              type="button"
              key={item.action}
              onClick={() => handleAction(item.action)}
              className="admin-side-nav__item admin-side-nav__item--action"
              title={collapsed ? item.label : undefined}
            >
              <NavIcon name={item.icon} />
              {!collapsed && (
                <span className="admin-side-nav__label">{item.label}</span>
              )}
            </button>
          ))}
        </div>
      </nav>
      <ConfirmModal
        isOpen={showLogoutConfirm}
        title="Sign out?"
        message="This ends your session and clears the live token chain. Sign back in to continue."
        confirmLabel="Sign Out"
        danger
        onConfirm={() => { setShowLogoutConfirm(false); performLogout(); }}
        onCancel={() => setShowLogoutConfirm(false)}
      />
      <ConfirmModal
        isOpen={showResetModal}
        title="Reset Demo"
        message="First verify Agent Gateway, Authorize, audiences, scopes, and grants for local Docker and hosted SE, including PingOne and PingFederate sessions and UC40 ID-JAG. Any configuration changes will be shown for your confirmation. Cleanup and sign-out happen only after every required check is READY."
        confirmLabel="Check readiness"
        danger
        onConfirm={handleResetConfirm}
        onCancel={() => setShowResetModal(false)}
      />
      <DraggableModal
        isOpen={Boolean(readinessJob)}
        title="Demo readiness"
        storageKey={null}
        defaultWidth={680}
        defaultHeight={620}
        minWidth={520}
        onClose={closeReadinessJob}
      >
        <div className="dm-scroll admin-side-nav__readiness-content" aria-live="polite">
          <p className="admin-side-nav__readiness-intro">
            Checking all 48 Demo Steps against local Docker and hosted SE, with PingOne and PingFederate sessions and UC40 ID-JAG coverage.
          </p>
          <p className={`admin-side-nav__readiness-status${readinessStatusTone ? ` admin-side-nav__readiness-status--${readinessStatusTone}` : ""}`}>
            {readinessJob?.cleanup === "running"
              ? "All readiness checks passed. Resetting demo state…"
              : readinessJob?.cleanup === "failed"
                ? "Readiness passed, but demo cleanup failed. You are still signed in."
                : readinessJob?.status === "starting"
                  ? "Starting readiness checks…"
                  : `Status: ${String(readinessJob?.status || "running").replaceAll("-", " ")}`}
          </p>
          {readinessPhase && readinessJob?.status !== "starting" && (
            <p>Current phase: {String(readinessPhase).replaceAll("-", " ")}</p>
          )}
          {readinessJob?.error && <p role="alert">{readinessJob.error}</p>}
          {readinessJob?.status === "poll-error" && readinessJob.jobId && (
            <button type="button" className="btn btn-secondary" onClick={() => void pollReadinessJob(readinessJob.jobId)}>
              Retry status check
            </button>
          )}

          {readinessPreview && (
            <section className="admin-side-nav__readiness-section" aria-labelledby="readiness-preview-heading">
              <h3 id="readiness-preview-heading">Configuration repair preview</h3>
              <p>Proposed changes: {readinessChanges.length}. Blocked changes: {readinessBlockedChanges.length}.</p>
              {readinessChanges.length === 0 && <p>No automatic configuration changes are proposed.</p>}
              <ul className="admin-side-nav__readiness-list">
                {readinessChanges.map((change, index) => (
                  <li key={`${change.target || "target"}-${change.object || "object"}-${index}`}>
                    <strong>{[change.target, change.object, change.operation].filter(Boolean).map((value) => typeof value === "string" ? value : JSON.stringify(value)).join(" · ") || `Change ${index + 1}`}</strong>
                    {change.sourceRef && <div>Source: {change.sourceRef}</div>}
                    {Object.prototype.hasOwnProperty.call(change, "current") && <div>Current value: {JSON.stringify(change.current)}</div>}
                    {Object.prototype.hasOwnProperty.call(change, "expected") && <div>Expected value: {JSON.stringify(change.expected)}</div>}
                  </li>
                ))}
                {readinessBlockedChanges.map((change, index) => (
                  <li key={`blocked-${index}`}>
                    <strong>Blocked: {[change.target, change.object].filter(Boolean).map((value) => typeof value === "string" ? value : JSON.stringify(value)).join(" · ") || `Change ${index + 1}`}</strong>
                    {change.reason && <div>{change.reason}</div>}
                  </li>
                ))}
              </ul>
              {readinessPreview.digest && (
                <p className="admin-side-nav__readiness-digest">Preview digest: {readinessPreview.digest}</p>
              )}
              {canConfirmReadinessRepairs && (
                <button type="button" className="btn btn-primary" onClick={() => setShowRepairConfirm(true)}>
                  Review repairs and confirm
                </button>
              )}
              {readinessJob?.declined && <p role="status">Repair confirmation declined. No changes were applied; reset was not run.</p>}
            </section>
          )}

          {(readinessReport || readinessFailures.length > 0) && (
            <section className="admin-side-nav__readiness-section" aria-labelledby="readiness-results-heading">
              <h3 id="readiness-results-heading">{readinessReport ? "Readiness results" : "Findings to review"}</h3>
              {readinessFailures.length > 0 ? (
                <ul className="admin-side-nav__readiness-list">
                  {readinessFailures.map((row, index) => (
                    <li key={`${row.id || "finding"}-${index}`}>
                      <strong>{row.id || `Finding ${index + 1}`} — {isAuthorizePolicyTreeWaiver(row) ? "waived (not verified)" : row.status}</strong>
                      {isAuthorizePolicyTreeWaiver(row) && <div>{row.waiver}</div>}
                      {row.evidence && <div>{typeof row.evidence === "string" ? row.evidence : JSON.stringify(row.evidence)}</div>}
                    </li>
                  ))}
                </ul>
              ) : readinessReport?.ready === true ? (
                <p>Every required check passed for local Docker and hosted SE.</p>
              ) : (
                <p>The report does not establish full readiness. Demo state was not reset.</p>
              )}
              {readinessReport?.ready === true && readinessFailures.some(isAuthorizePolicyTreeWaiver) && (
                <p>Every required check passed for local Docker and hosted SE. The waived finding above remains unverified.</p>
              )}
            </section>
          )}
        </div>
      </DraggableModal>
      <ConfirmModal
        isOpen={showRepairConfirm}
        title="Apply readiness repairs"
        message={`Confirm this exact repair preview to apply the displayed changes. The digest is ${readinessPreview?.digest || "unavailable"}. Cancelling applies nothing and does not reset demo state.`}
        confirmLabel="Apply displayed repairs"
        danger
        onConfirm={handleRepairConfirm}
        onCancel={declineRepairConfirmation}
      />
      <ConfirmModal
        isOpen={adminPromptPath != null}
        title="Admin sign-in required"
        message="This is an admin feature. Log in as admin to continue? Your current session will end."
        confirmLabel="Log in as admin"
        onConfirm={() =>
          startRoleSwitch("admin", adminPromptPath).catch((e) =>
            console.error("[Sidebar] Role switch failed:", e.message),
          )
        }
        onCancel={() => setAdminPromptPath(null)}
      />
      <ControlPlaneIntroModal
        isOpen={controlPlaneIntroPath != null}
        onConfirm={() => {
          const path = controlPlaneIntroPath;
          setControlPlaneIntroPath(null);
          if (path) navigate(path);
        }}
        onCancel={() => setControlPlaneIntroPath(null)}
      />
    </div>
  );
}
