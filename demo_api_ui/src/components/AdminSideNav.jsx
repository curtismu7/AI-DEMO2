import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { applyChildOrder } from "../config/navStructureCatalog";
import useDividerDrag from "../hooks/useDividerDrag";
import { useAgentUiMode } from "../context/AgentUiModeContext";
import { useEducationUI } from "../context/EducationUIContext";
import apiClient from "../services/apiClient";
import { persistAgentUi } from "../services/demoScenarioService";
import { performLogout } from "../services/logout";
import { spinner } from "../services/spinnerService";
import { navigateToCustomerOAuthLogin } from "../utils/authUi";
import { setDashboardLayout } from "../utils/dashboardLayout";
import { startRoleSwitch } from "../utils/roleSwitch";
import { useVertical } from "../vertical/useVertical";
import ConfirmModal from "./ConfirmModal";
import ControlPlaneIntroModal from "./ControlPlaneIntroModal";
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
  { id: "customer-demos", paths: ["/agent-lifecycle"] },
  { id: "demos", paths: ["/delegated-commerce", "/use-cases", "/use-cases/live", "/demo-track", "/group-policy", "/demo-config", "/delegation", "/delegation-chain-value"] },
  { id: "ai-agents", paths: ["/ai-control-plane", "/agent", "/agent-builder", "/agent-flow-inspector", "/langchain", "/ungoverned-agent", "/servers"] },
  { id: "pingone-mcp", paths: ["/pingone-mcp-inspector", "/pingone-setup", "/privilege-mcp-client", "/privilege-mcp-learning"] },
  { id: "banking-mcp", paths: ["/webmcp", "/ping-ai-test-lab"] },
  { id: "banking-mcp-gateways", paths: ["/agent-gateway-inspector", "/pinggateway-test", "/mcp-traffic", "/token-security", "/agent-gateway-capabilities"] },
  { id: "pingone-demo-apps", paths: ["/self-service", "/pingone-test", "/mfa-test", "/token-exchange-tester", "/oauth-academy", "/oas-demo", "/privilege-demo", "/sdk-login"] },
  { id: "delegation-consent", paths: ["/transaction-consent", "/actor-token-education"] },
  { id: "authorize", paths: ["/pingone-authorize", "/pingone-authorize-capabilities", "/policy-decision-trace", "/authz-test", "/scope-audit", "/scope-reference"] },
  { id: "users-accounts", paths: ["/users", "/accounts", "/transactions"] },
  { id: "platform-admin", paths: ["/admin", "/admin/pingone"] },
  // No "/admin" here — it belongs to platform-admin now that the dashboard
  // is back on it. Listing a path in two sections expands both, which
  // breaks the single-section accordion.
  { id: "industry-verticals", paths: ["/admin/banking", "/admin/healthcare", "/admin/retail", "/admin/sporting-goods", "/admin/workforce", "/admin/university", "/admin/government", "/admin/manufacturing", "/admin/investment", "/admin/abercrombie-fitch", "/admin/verticals", "/path/mortgage"] },
  { id: "monitoring", paths: ["/audit", "/monitoring", "/reports", "/error-audit"] },
  { id: "telemetry", paths: ["/tracing", "/telemetry", "/transaction-trace", "/check"] },
  { id: "agent-studio-preview", paths: ["/iga-for-ai", "/discovery-preview", "/privileges-gateway-preview", "/platform-gaps"] },
  { id: "learn-present", paths: ["/learning", "/agentic-trust", "/agent-guardrails", "/owasp", "/llama-vscode-guide"] },
  { id: "tests", paths: ["/resource-server", "/resource-server-cc"] },
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
  const [latestRunId, setLatestRunId] = useState(null);
  const [latestRunTime, setLatestRunTime] = useState(null);

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
        .catch(() => {});
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
      } catch {
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
      } else if (p === "bottom") {
        setDashboardLayout("classic");
        next = { placement: "bottom", fab };
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
  const allNavItems = [
    { label: "Home", path: "/", icon: "~" },
    { label: "Dashboard", path: "/dashboard", icon: "≡" },
    {
      label: "AI Agent Gateway",
      icon: "shld",
      children: [
        { label: "Protocol Playground", path: "/protocol-playground", icon: "dbg" },
        { label: "AI Gateway Client", path: "/privilege-mcp-client", icon: "shld" },
        { label: "AI Agent Gateway Guide", path: "/privilege-mcp-learning", icon: "doc" },
        { label: "AI Agent Gateway Diagrams", path: "/privilege-mcp-diagrams", icon: "arc" },
        { label: "Privilege Gateway Topologies", path: "/privilege-gateway-topologies", icon: "arc" },
      ],
    },
    { label: "Themes", path: "/themes", icon: "cfg" },
    {
      // Customer-facing demo pages — visible to admins too ("there is no
      // reason to hide on admin dashboard", 2026-08-10): the presenter drives
      // these demos from an admin session. customerOnly was dropped from
      // Agent Lifecycle when it moved here.
      label: "Customer Demos",
      icon: "demo",
      children: [
        {
          label: "Agent Lifecycle (guided demo)",
          path: "/agent-lifecycle",
          icon: "agt",
          adminOnly: true,
        },
        {
          label: "Personal Agent",
          path: "/personal-agent",
          icon: "agt",
          adminOnly: true,
        },
      ],
    },
    {
      label: "Demos",
      icon: "demo",
      children: [
        {
          label: "Delegated Commerce (guided demo)",
          path: "/delegated-commerce",
          icon: "agt",
          adminOnly: true,
        },
        {
          label: "Weather MCP",
          icon: "mcp",
          // UC30 — Texas permit kickoff (same as Use Cases → Run).
          action: () => {
            const vertical = activeVerticalId || "banking";
            apiClient
              .post("/api/use-cases/demo/run", {
                useCaseId: "weather-mcp-texas-permit",
                vertical,
              })
              .then(({ data }) =>
                apiClient
                  .post("/api/verticals/active", { id: vertical })
                  .then(() => data),
              )
              .then((data) => {
                navigate("/dashboard", {
                  state: {
                    useCaseId: data.useCaseId,
                    triggerText: data.triggerText,
                    type: data.type,
                    vertical,
                  },
                });
              })
              .catch((err) => {
                console.error("Weather MCP nav: failed to run use case", err);
              });
          },
        },
        { label: "Use Cases", path: "/use-cases", icon: "demo" },
        { label: "Use Cases (Live)", path: "/use-cases/live", icon: "demo" },
        { label: "Guided Demo Track", path: "/demo-track", icon: "demo" },
        { label: "Delegation Chain Value", path: "/delegation-chain-value", icon: "demo" },
        { label: "Group Policy Board", path: "/group-policy", icon: "demo" },
        {
          label: "Demo Script",
          icon: "demo",
          action: () => window.dispatchEvent(new CustomEvent("demo-script-toggle")),
        },
        { label: "Demo Config", path: "/demo-config", icon: "cfg", adminOnly: true },
        { label: "Family Delegation", path: "/delegation", icon: "usr", adminOnly: true },
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
      label: "AI Agents",
      icon: "agt",
      children: [
        {
          label: "AI Control Plane",
          path: "/ai-control-plane",
          icon: "sec",
          highlight: true,
          introGate: true,
        },
        {
          label: "PingOne Agent Builder",
          path: "/agent-builder",
          icon: "tool",
          adminOnly: true,
        },
        {
          label: "Agent & Token Flow History",
          path: "/agent-flow-inspector",
          icon: "flw",
        },
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
      ],
    },
    {
      label: "MCP & Gateways",
      icon: "rte",
      children: [
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
          label: "Dashboard",
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
      ],
    },
    {
      label: "Telemetry",
      icon: "log",
      children: [
        { label: "Service Graph", path: "/telemetry", icon: "log" },
        { label: "Tracing", path: "/tracing", icon: "log" },
        { label: "Transaction Trace", path: "/transaction-trace", icon: "log" },
        { label: "Health Check", path: "/check", icon: "clk" },
      ],
    },
    {
      label: "Diagrams",
      icon: "arc",
      children: [
        {
          label: "System Diagram (Node)",
          path: "/architecture/system",
          icon: "arc",
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
        {
          label: "Phase 266 — 3 Paths (MM)",
          path: "/architecture/phase-266",
          icon: "rte",
        },
        { label: "Sequence Diagram (Node)", path: "/sequence-diagram", icon: "log" },
        { label: "Canvas Diagram (Node)", path: "/architecture/canvas", icon: "⬡" },
        { label: "Agent Onboarding Flow (Node)", path: "/agent-onboarding-flow", icon: "arc", className: "admin-side-nav__item--onboarding-white" },
        { label: "Agent Onboarding Flow Subway (Node)", path: "/agent-onboarding-flow-subway", icon: "arc", className: "admin-side-nav__item--onboarding-white" },
        { label: "Agent Onboarding Flow (MM)", path: "/agent-onboarding-flow-mermaid", icon: "arc", className: "admin-side-nav__item--onboarding-white" },
        { label: "Agent Gateway OAuth Flow (MM)", path: "/mcp-gateway-oauth-flow", icon: "log" },
        { label: "Invest Dual-Auth (MM)", path: "/invest-dual-auth", icon: "rte" },
        { label: "AI Agent Gateway (MM)", path: "/privilege-mcp-diagrams", icon: "lck" },
        { label: "Privilege Gateway Topologies (MM)", path: "/privilege-gateway-topologies", icon: "arc" },
        { label: "Gateway vs P1AZ Enforcement (MM)", path: "/gateway-enforcement-map", icon: "arc" },
        { label: "Resource Server Placement (MM)", path: "/resource-server-placement", icon: "arc" },
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
        { label: "Learning Hub", path: "/learning", icon: "doc" },
        { label: "Agentic Trust", path: "/agentic-trust", icon: "shld" },
        { label: "Agent Guardrails", path: "/agent-guardrails", icon: "pol" },
        { label: "OWASP Agent Risks", path: "/owasp", icon: "sec" },
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
        { label: "App Configuration", path: "/configure", icon: "fix" },
        { label: "OAuth Debug", path: "/configure?tab=debug", icon: "dbg" },
        { label: "Postman Collections", path: "/postman", icon: "msg" },
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
    const ordered = navOrder.filter((l) => byLabel[l]).map((l) => byLabel[l]);
    const rest = childOrderedItems.filter((i) => !navOrder.includes(i.label));
    return [...ordered, ...rest];
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
  // Phase 4e: Bottom dock removed from the picker (legacy code paths in
  // App.js / EmbeddedAgentDock still understand placement === 'bottom' for
  // back-compat with persisted state, but the option is no longer offered).
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
        performLogout();
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

  const handleResetConfirm = async () => {
    setShowResetModal(false);
    try {
      await fetch("/api/admin/reset-demo", {
        method: "POST",
        credentials: "include",
      });
    } catch (_) {}
    try {
      localStorage.removeItem("tokenChainHistory");
    } catch (_) {}
    try {
      localStorage.removeItem("api-traffic-store");
    } catch (_) {}
    performLogout();
  };

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
        <div key={itemKey} className="admin-side-nav__group">
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
                const childKey = `${itemKey}-child-${child.path || child.action || child.label}`;
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
            {item.badge && (
              <span className="admin-side-nav__badge">{item.badge}</span>
            )}
          </>
        )}
      </Link>
    );
  };

  return (
    <div
      className={`admin-side-nav ${collapsed ? "admin-side-nav--collapsed" : ""}`}
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
        <div className="admin-side-nav__ping-brand" aria-hidden="true">
          <span className="admin-side-nav__ping-mark" />
          <span className="admin-side-nav__ping-wordmark">
            Ping<strong>Identity</strong>
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
            {collapsed ? <MdDashboard size={16} aria-hidden="true" /> : "Agent"}
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
            {collapsed ? <MdSecurity size={16} aria-hidden="true" /> : "Admin"}
          </button>
          <Link
            to="/configure"
            className={`admin-side-nav__quick-link${location.pathname.startsWith("/configure") ? " admin-side-nav__quick-link--active" : ""}`}
            title="Setup"
          >
            {collapsed ? <MdSettings size={16} aria-hidden="true" /> : "Setup"}
          </Link>
          {collapsed && (
            <button
              type="button"
              className="admin-side-nav__quick-link"
              title="Refresh sidebar (pick up Demo Config changes)"
              aria-label="Refresh sidebar"
              onClick={loadNavConfig}
            >
              <MdRefresh size={16} aria-hidden="true" />
            </button>
          )}
        </div>

        {/* Filter — live-filters nav items by label (hidden when collapsed) */}
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
          {visibleNavItems.map((item, idx) =>
            renderNavItem(item, "nav", idx, !!navQuery),
          )}
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
        isOpen={showResetModal}
        title="Reset Demo"
        message="Clear all agent history, token chain events, and MCP audit logs? You will be signed out and the theme will reset to default."
        confirmLabel="Reset"
        danger
        onConfirm={handleResetConfirm}
        onCancel={() => setShowResetModal(false)}
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
