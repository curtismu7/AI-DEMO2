import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAgentUiMode } from "../context/AgentUiModeContext";
import { useEducationUI } from "../context/EducationUIContext";
import { persistAgentUi } from "../services/demoScenarioService";
import { performLogout } from "../services/logout";
import { requestSilentReauth } from "../utils/authUi";
import { setDashboardLayout } from "../utils/dashboardLayout";
import { startRoleSwitch } from "../utils/roleSwitch";
import { useVertical } from "../vertical/useVertical";
import ConfirmModal from "./ConfirmModal";
import ControlPlaneIntroModal from "./ControlPlaneIntroModal";
import { EDU } from "./education/educationIds";
import KillSwitchConfirmModal from "./KillSwitchConfirmModal";
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
// Namespaced by role at use-site because section keys are positional
// (`nav-${idx}`) and the admin/customer nav lists index the same group
// differently — a shared key would restore the wrong group after a role switch.
const EXPANDED_SECTIONS_KEY_BASE = "adminSideNav.expandedSections";

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

export default function AdminSideNav({ user }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_WIDTH);
  const [navFilter, setNavFilter] = useState("");
  const isResizing = useRef(false);

  // Sync --sidebar-width CSS var on App so main content margin stays correct
  useEffect(() => {
    if (!collapsed) {
      document
        .querySelector(".App")
        ?.style.setProperty("--sidebar-width", `${sidebarWidth}px`);
    }
  }, [sidebarWidth, collapsed]);

  const startResize = useCallback(
    (e) => {
      if (collapsed) return;
      e.preventDefault();
      isResizing.current = true;
      const startX = e.clientX;
      const startW = sidebarWidth;
      const onMove = (me) => {
        if (!isResizing.current) return;
        const next = Math.min(
          MAX_WIDTH,
          Math.max(MIN_WIDTH, startW + (me.clientX - startX)),
        );
        setSidebarWidth(next);
      };
      const onUp = () => {
        isResizing.current = false;
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [collapsed, sidebarWidth],
  );

  // Auto-expand the section that contains the current path on mount/remount.
  // Prevents the sidebar collapsing when the layout remounts (e.g. customer navigating /dashboard → /monitoring/*).
  // Index offsets differ by role: customers have "Family Delegation" at idx 2, pushing later items up by 1.
  // Role-scoped so admin and customer keep independent expansion state (see
  // EXPANDED_SECTIONS_KEY_BASE — positional keys differ per role).
  const expandedSectionsKey = `${EXPANDED_SECTIONS_KEY_BASE}.${user?.role || "guest"}`;
  const [expandedSections, setExpandedSections] = useState(() => {
    // A group the user opened should stay open until they open a different one,
    // even across sidebar remounts and the full-page reloads this app performs
    // (role/vertical switch, reauth). Persisted choice wins; the path-based
    // auto-expand below is only the first-load default when nothing is saved.
    try {
      const saved = sessionStorage.getItem(expandedSectionsKey);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && typeof parsed === "object") return parsed;
      }
    } catch (_e) {
      /* ignore malformed/unavailable storage */
    }
    const initial = {};
    const path = location.pathname;
    const matches = (paths) =>
      paths.some((p) => path === p || path.startsWith(`${p}/`));
    // Auto-expand the group that contains the current route. Keyed by the
    // group's stable slug id (slugify(label)) — position-independent, so it
    // stays correct regardless of nav order or role filtering.
    const sections = [
      { id: "monitoring", paths: ["/audit", "/monitoring", "/reports", "/error-audit"] },
      { id: "mcp", paths: ["/webmcp", "/mcp-inspector", "/pingone-mcp-inspector", "/mcp-tools"] },
      { id: "authorize", paths: ["/pingone-authorize", "/authz-test", "/scope-audit", "/scope-reference"] },
      { id: "users-accounts", paths: ["/users", "/accounts", "/transactions"] },
      { id: "tests", paths: ["/pingone-test", "/mfa-test", "/resource-server", "/resource-server-cc"] },
    ];
    for (const s of sections) {
      if (matches(s.paths)) initial[`nav-${s.id}`] = true;
    }
    return initial;
  });
  // Persist expansion state so the open group stays open until the user opens
  // another (see expandedSectionsKey).
  useEffect(() => {
    try {
      sessionStorage.setItem(
        expandedSectionsKey,
        JSON.stringify(expandedSections),
      );
    } catch (_e) {
      /* ignore storage-unavailable (private mode / quota) */
    }
  }, [expandedSections, expandedSectionsKey]);
  const [showKillModal, setShowKillModal] = useState(false);
  // Path of the admin-marked link a non-admin clicked; non-null opens the
  // "log in as admin" confirm dialog.
  const [adminPromptPath, setAdminPromptPath] = useState(null);
  // Path queued behind the AI Control Plane intro-gate modal (null = closed).
  const [controlPlaneIntroPath, setControlPlaneIntroPath] = useState(null);
  const [agentRevoked, setAgentRevoked] = useState(false);
  const [showResetModal, setShowResetModal] = useState(false);
  const [latestRunId, setLatestRunId] = useState(null);
  const [latestRunTime, setLatestRunTime] = useState(null);

  const isAdmin = user?.role === "admin";
  const { placement, fab, setAgentUi } = useAgentUiMode();
  const { open: openEdu } = useEducationUI();
  const { activeId: activeVerticalId } = useVertical();

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
        // Fresh token so it carries the new vertical's featureScope (silent SSO).
        requestSilentReauth();
      } catch {
        setSwitchingVertical(false);
      }
    },
    [activeVerticalId, switchingVertical],
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
    { label: "Themes", path: "/themes", icon: "cfg" },
    { label: "Use Cases", path: "/use-cases", icon: "demo" },
    {
      label: "Agent Demo Guide",
      icon: "doc",
      action: () => navigate("/agent", { state: { openDemoGuide: true } }),
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
      label: "Family Delegation",
      path: "/delegation",
      icon: "usr",
      customerOnly: true,
    },
    {
      label: "Monitoring",
      icon: "log",
      children: [
        { label: "Audit Trail", path: "/audit", icon: "srch", adminOnly: true },
        {
          label: "Activity Log",
          path: "/monitoring/activity-log",
          icon: "log",
        },
        {
          label: "API Explorer",
          path: "/monitoring/api-explorer",
          icon: "api",
        },
        // Hidden from nav: Token Chain (reachable at /monitoring/token-chain) and
        // Token Diff — token chain now lives in the portal rails / agent panel.
        // { label: "Token Diff", path: "/monitoring/token-diff", icon: "≡" },
        { label: "Run Reports", path: "/reports", icon: "rpt" },
        {
          label: "Error Audit Log",
          path: "/error-audit",
          icon: "log",
          adminOnly: true,
        },
      ],
    },
    {
      label: "MCP",
      icon: "mcp",
      children: [
        {
          label: "Demo MCP Inspector",
          path: "/mcp-inspector",
          icon: "dbg",
        },
        {
          label: "PingOne MCP inspector",
          path: "/pingone-mcp-inspector",
          icon: "dbg",
        },
        {
          label: "MCP Tools",
          path: "/mcp-tools",
          icon: "tool",
        },
        {
          label: "PingOne MCP Tools",
          // Static HTML page (not an SPA route) — force a full navigation so
          // it loads directly instead of hitting the React Router catch-all.
          action: () => {
            window.location.href = "/pingone-mcp-tools.html";
          },
          icon: "tool",
        },
      ],
    },
    {
      label: "Agent Gateway Server",
      icon: "rte",
      children: [
        {
          label: "PingGateway Config",
          path: "/setup?tab=mcp-gateway",
          icon: "rte",
        },
        {
          label: "PingGateway Test",
          path: "/pinggateway-test.html",
          icon: "tst",
        },
      ],
    },
    {
      label: "PingOne MCP Setup",
      icon: "cfg",
      path: "/pingone-setup",
    },
    {
      label: "Vertical Ops",
      icon: "cfg",
      children: [
        { label: "Banking Ops", path: "/admin/banking", icon: "cfg" },
        { label: "Healthcare Ops", path: "/admin/healthcare", icon: "cfg" },
        { label: "Retail Ops", path: "/admin/retail", icon: "cfg" },
        { label: "Sporting Goods Ops", path: "/admin/sporting-goods", icon: "cfg" },
        { label: "Workforce Ops", path: "/admin/workforce", icon: "cfg" },
      ],
    },
    {
      label: "Authorize",
      icon: "pol",
      children: [
        { label: "PingOne Authorize", path: "/pingone-authorize", icon: "pol" },
        { label: "Demo Server Authz Test", path: "/authz-test", icon: "pol" },
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
          label: "PingCLI Demo",
          path: "/pingcli",
          icon: "tool",
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
          label: "Client Registration",
          path: "/client-registration",
          icon: "edt",
          adminOnly: true,
        },
        { label: "User Delegation", path: "/delegation", icon: "dlg" },
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
          },
        },
      ],
    },
    {
      label: "Diagrams",
      icon: "arc",
      children: [
        {
          label: "System Diagram",
          path: "/architecture/system",
          icon: "arc",
        },
        {
          label: "Overview Diagram",
          path: "/architecture/overview",
          icon: "bld",
        },
        {
          label: "Token Flow (Interactive)",
          path: "/architecture/token-flow",
          icon: "lnk",
        },
        { label: "Interactive Flow", path: "/architecture/flow", icon: ">" },
        {
          label: "Phase 266 — 3 Paths",
          path: "/architecture/phase-266",
          icon: "rte",
        },
        { label: "Sequence Diagram", path: "/sequence-diagram", icon: "log" },
        { label: "Canvas Diagram", path: "/architecture/canvas", icon: "⬡" },
      ],
    },
    {
      label: "Users & Accounts",
      icon: "rpt",
      adminOnly: true,
      children: [
        { label: "Users", path: "/users", icon: "usr" },
        { label: "Accounts", path: "/accounts", icon: "acc" },
        { label: "Transactions", path: "/transactions", icon: "txn" },
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
        { label: "Vault", path: "/admin/vault" },
        {
          label: "PingOne Agent Builder",
          path: "/agent-builder",
          icon: "tool",
        },
      ],
    },
    {
      label: "Tests",
      icon: "tst",
      children: [
        { label: "PingOne Test", path: "/pingone-test", icon: "tst" },
        { label: "MFA Test", path: "/mfa-test", icon: "lck" },
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
    { label: "Code Explorer", path: "/code-explorer", icon: "tst" },
    { label: "Code Search", path: "/code-search", icon: "srch" },
    { label: "OAuth Academy", path: "/oauth-academy", icon: "sec" },
    { label: "OAS Demo", path: "/oas-demo", icon: "sec" },
    { label: "Learning Hub", path: "/learning", icon: "doc" },
    { label: "llama-vscode Guide", path: "/llama-vscode-guide", icon: "doc" },
    // Always-visible top-level entry to the past-reports list. Kept after every
    // group referenced by the expandedSections adminIdx/customerIdx map so the
    // auto-expand offsets stay valid. (Run Reports also lives under Monitoring.)
    { label: "Run Reports", path: "/reports", icon: "rpt" },
    // Visible to ALL logged-in users (no adminOnly) — the AI Control Plane is
    // not admin-gated. Appended after the index-coupled groups so the auto-expand
    // adminIdx/customerIdx offsets above stay valid.
    {
      label: "AI Control Plane",
      path: "/ai-control-plane",
      icon: "sec",
      highlight: true,
      introGate: true,
    },
  ];

  // Filter by role. adminOnly items are NOT hidden — they render with an
  // "admin" badge and non-admin clicks prompt an admin re-login instead.
  const navItems = allNavItems.filter((item) => !item.customerOnly || !isAdmin);

  // Live filter: match by label across top-level items and their children. A
  // group is kept if its own label matches (all children shown) or if any child
  // matches (only matching children shown). Empty query = show everything.
  const navQuery = navFilter.trim().toLowerCase();
  const labelMatches = (label) =>
    String(label || "").toLowerCase().includes(navQuery);
  const filterNavItem = (item) => {
    if (!navQuery) return item;
    if (item.children?.length) {
      if (labelMatches(item.label)) return item;
      const kids = item.children.filter((c) => labelMatches(c.label));
      return kids.length ? { ...item, children: kids } : null;
    }
    return labelMatches(item.label) ? item : null;
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
        const targetRole = isAdmin ? "customer" : "admin";
        startRoleSwitch(targetRole).catch((e) => {
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
        window.location.href =
          "/api/auth/oauth/user/login?return_to=/dashboard";
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

  const handleKillSwitchConfirm = useCallback(
    async (agentId, reason) => {
      try {
        const response = await fetch(
          `/api/admin/agent/${agentId}/kill-switch`,
          {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ reason }),
          },
        );
        const body = await response.json().catch(() => ({}));
        // 401 with agent_killed is the expected success response: session revoked at server
        if (response.status === 401 && body.error === "agent_killed") {
          setAgentRevoked(true);
          setShowKillModal(false);
          console.log(
            "[AdminSideNav] Agent killed — navigating to logout page",
          );
          navigate("/logout");
          return;
        }
        if (!response.ok)
          throw new Error(
            body.error_description ||
              body.message ||
              `Kill switch failed: ${response.status}`,
          );
        // Fallback for any 2xx
        setAgentRevoked(true);
        setShowKillModal(false);
        navigate("/logout");
      } catch (e) {
        console.error("[AdminSideNav] Kill switch error:", e.message);
      }
    },
    [navigate],
  );

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
            className={`admin-side-nav__item admin-side-nav__item--parent${isParentActive(item) ? " admin-side-nav__item--parent-active" : ""}`}
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
                  <span className="admin-side-nav__badge">🛡️ admin</span>
                )}
                <span
                  className={`admin-side-nav__chevron ${isExpanded ? "admin-side-nav__chevron--expanded" : ""}`}
                  aria-hidden="true"
                >
                  ▶
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
                    className={`admin-side-nav__item admin-side-nav__item--child ${isActive(child.path) ? "admin-side-nav__item--active" : ""}`}
                    title={child.label}
                    aria-current={isActive(child.path) ? "page" : undefined}
                    onClick={
                      !isAdmin && isAdminFeature
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
                      <span className="admin-side-nav__badge">🛡️ admin</span>
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
          onMouseDown={startResize}
        />
      )}

      {/* Collapse Toggle Button */}
      <button
        type="button"
        className="admin-side-nav__toggle"
        onClick={() => setCollapsed(!collapsed)}
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
        {/* Quick-access shortcuts */}
        <div className="admin-side-nav__quick-links">
          <button
            type="button"
            className={`admin-side-nav__quick-link${location.pathname === "/dashboard" ? " admin-side-nav__quick-link--active" : ""}`}
            title="Customer View"
            onClick={() => {
              if (!isAdmin) {
                navigate("/dashboard");
                return;
              }
              fetch("/api/auth/switch", {
                method: "POST",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ targetRole: "customer" }),
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
            {collapsed ? "C" : "Customer"}
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
            {collapsed ? "A" : "Admin"}
          </button>
          <Link
            to="/configure"
            className={`admin-side-nav__quick-link${location.pathname.startsWith("/configure") ? " admin-side-nav__quick-link--active" : ""}`}
            title="Setup"
          >
            {collapsed ? "S" : "Setup"}
          </Link>
        </div>

        {/* Filter — live-filters nav items by label (hidden when collapsed) */}
        {!collapsed && (
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
                    ▶
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
                    ▶
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
            onClick={() => !agentRevoked && setShowKillModal(true)}
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
      {showKillModal && (
        <KillSwitchConfirmModal
          isOpen={showKillModal}
          onCancel={() => setShowKillModal(false)}
          onConfirm={(agentId, reason) =>
            handleKillSwitchConfirm(agentId || "default-agent", reason)
          }
        />
      )}
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
