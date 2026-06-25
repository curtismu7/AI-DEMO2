import React, { useCallback, useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { useEducationUIOptional } from "../context/EducationUIContext";
import { EDU } from "./education/educationIds";
import { useIndustryBranding } from "../context/IndustryBrandingContext";
import { useVertical } from "../vertical/useVertical";
import KillSwitchConfirmModal from "./KillSwitchConfirmModal";
import {
  MdCode,
  MdLock,
  MdSettings,
  MdSearch,
  MdDataUsage,
  MdDeploy,
  MdBook,
  MdPerson,
  MdDescription,
  MdListAlt,
  MdSwapHoriz,
  MdSwapCalls,
  MdAccountBalance,
  MdMoneyExchange,
  MdPlug,
  MdFileText,
  MdSecurity,
  MdApps,
  MdOutlineChat,
  MdManageAccounts,
  MdMenuBook,
  MdAccountTree,
} from "react-icons/md";
import { HiOutlineUsers, HiOutlineBarChart3 } from "react-icons/hi";
import "./SideNav.css";

const ADMIN_NAV = [
  {
    group: "Overview",
    items: [
      { to: "/admin", label: "Admin Dashboard", icon: "MdManageAccounts" },
      { to: "/agent", label: "AI Agent", icon: "MdOutlineChat" },
      { to: "/mcp-traffic", label: "MCP Tool Tester", icon: "MdPlug" },
      { label: "🔄 Reset Demo", icon: "MdSettings", action: "resetDemo" },
    ],
  },
  {
    group: "Management",
    items: [
      { to: "/activity", label: "Activity Logs", icon: "MdListAlt" },
      { to: "/users", label: "Users", icon: "HiOutlineUsers" },
      { to: "/accounts", label: "Accounts", icon: "MdAccountBalance" },
      {
        to: "/admin/banking",
        label: "Demo admin",
        icon: "MdAccountBalance",
      },
      { to: "/transactions", label: "Transactions", icon: "MdSwapHoriz" },
      { to: "/delegation", label: "Manage Delegates", icon: "HiOutlineUsers" },
    ],
  },
  {
    group: "Configuration",
    items: [
      { to: "/scope-audit", label: "Scope Audit", icon: "MdSecurity" },
      { to: "/configure", label: "Configure", icon: "MdTune" },
      { to: "/config", label: "App Config", icon: "MdSettings" },
      { to: "/settings", label: "Security", icon: "MdLock" },
      { to: "/demo-data", label: "Demo Data", icon: "MdDataUsage" },
      { to: "/onboarding", label: "Setup Guide", icon: "MdDeploy" },
      { to: "/setup/pingone", label: "PingOne Ref.", icon: "MdBook" },
      { to: "/setup/wizard", label: "Setup Wizard", icon: "MdDeploy" },
      { to: "/pingone-test", label: "PingOne Test", icon: "MdBuild" },
      { to: "/mfa-test", label: "P1MFA Test", icon: "MdLock" },
      { to: "/mcp-tools", label: "MCP Tools", icon: "MdPlug" },
      { to: "/pingone-authorize", label: "Authorize", icon: "MdPolicy" },
    ],
  },
  {
    group: "User Management",
    items: [{ to: "/self-service", label: "Create Account", icon: "MdPerson" }],
  },
  {
    group: "Tools",
    items: [
      { to: "/code-explorer", label: "Code Explorer", icon: "MdCode" },
      { to: "/architecture/token-flow", label: "Token Flow Diagram", icon: "MdAccountTree" },
      { to: "/sequence-diagram", label: "Sequence Diagram", icon: "MdSwapCalls" },
    ],
  },
];

function buildUserNav(terminology, identity) {
  const brand = identity?.displayName || identity?.headerTitle || 'Workspace';
  const accountsLabel = terminology?.accounts ? `My ${terminology.accounts}` : 'My Accounts';
  const transferLabel = terminology?.highValueAction || 'Transfer Money';
  return [
    {
      group: `My ${brand}`,
      items: [
        { to: "/use-cases", label: "Use Cases", icon: "MdApps" },
        { to: "/dashboard", label: terminology?.dashboard || "My Dashboard", icon: "HiOutlineBarChart3" },
        { to: "/agent", label: "AI Agent", icon: "MdOutlineChat" },
        { to: "/mcp-traffic", label: "MCP Tool Tester", icon: "MdPlug" },
        { to: "/demo-data", label: "Demo config", icon: "MdSettings" },
        { label: "🔄 Reset Demo", icon: "MdSettings", action: "resetDemo" },
        { to: "/pingone-test", label: "Test Page", icon: "MdSettings" },
      ],
    },
    {
      group: "Self Service",
      items: [
        { to: "/self-service", label: "Create Account", icon: "MdPerson" },
        { to: "/accounts", label: accountsLabel, icon: "MdAccountBalance" },
        { to: "/transactions", label: transferLabel, icon: "MdMoneyExchange" },
        { to: "/profile", label: "Profile Settings", icon: "MdPerson" },
        { to: "/security", label: "Security Center", icon: "MdSecurity" },
        { to: "/delegation", label: "Manage Delegates", icon: "HiOutlineUsers" },
      ],
    },
    {
      group: "Tools",
      items: [
        { to: "/code-explorer", label: "Code Explorer", icon: "MdCode" },
        { to: "/architecture/token-flow", label: "Token Flow Diagram", icon: "MdAccountTree" },
        { to: "/sequence-diagram", label: "Sequence Diagram", icon: "MdSwapCalls" },
      ],
    },
  ];
}

export default function SideNav({ user, onLogout }) {
  const { preset } = useIndustryBranding();
  const { pageManifest } = useVertical();
  const terminology = pageManifest?.terminology;
  const identity = pageManifest?.identity;
  const [collapsed, setCollapsed] = useState(false);
  const [showKillModal, setShowKillModal] = useState(false);
  const [agentRevoked, setAgentRevoked] = useState(false);
  const navigate = useNavigate();
  const edu = useEducationUIOptional();
  const isAdmin = user?.role === "admin";
  const navGroups = isAdmin ? ADMIN_NAV : buildUserNav(terminology, identity);

  // Helper function to render React Icon component from icon string name
  const renderIcon = (iconName, size = 20) => {
    const iconMap = {
      MdCode,
      MdOutlineChat,
      MdListAlt,
      HiOutlineUsers,
      MdAccountBalance,
      MdSwapHoriz,
      MdSettings,
      MdLock,
      MdDataUsage,
      MdDeploy,
      MdBook,
      MdPerson,
      MdPlug,
      MdSearch,
      MdFileText,
      HiOutlineBarChart3,
      MdMoneyExchange,
      MdSecurity,
      MdApps,
      MdDescription,
      MdSwapCalls,
      MdManageAccounts,
      MdMenuBook,
      MdAccountTree,
    };

    const IconComponent = iconMap[iconName];
    if (IconComponent) {
      return <IconComponent size={size} className="sidenav-icon" />;
    }
    return <span className="sidenav-icon">{iconName}</span>;
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
          console.log("[SideNav] Agent killed — navigating to logout page");
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
        console.error("[SideNav] Kill switch error:", e.message);
      }
    },
    [navigate],
  );

  const handleNavAction = async (action) => {
    if (action === "runScopeAudit") {
      navigate("/scope-audit");
    } else if (action === "openMcpTracking") {
      window.dispatchEvent(new CustomEvent("open-mcp-tracking-modal"));
    } else if (action === "resetDemo") {
      if (
        !window.confirm(
          "Reset demo? This clears all agent history, token chain events, and MCP audit logs. You will stay signed in.",
        )
      )
        return;
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
      navigate(isAdmin ? "/admin" : "/dashboard", {
        replace: true,
        state: { resetDemo: true },
      });
    }
  };

  function openCiba() {
    window.dispatchEvent(
      new CustomEvent("education-open-ciba", { detail: { tab: "what" } }),
    );
  }
  function openCimd() {
    window.dispatchEvent(
      new CustomEvent("education-open-cimd", { detail: { tab: "what" } }),
    );
  }

  const LEARN_ITEMS = [
    {
      label: "Login Flow",
      icon: "MdLock",
      action: () => edu?.open(EDU.LOGIN_FLOW, "what"),
    },
    {
      label: "Token Exchange",
      icon: "MdSwapHoriz",
      action: () => edu?.open(EDU.TOKEN_EXCHANGE, "why"),
    },
    {
      label: "may_act / act",
      icon: "MdListAlt",
      action: () => edu?.open(EDU.MAY_ACT, "what"),
    },
    {
      label: "PKCE",
      icon: "MdLock",
      action: () => edu?.open(EDU.LOGIN_FLOW, "pkce"),
    },
    { label: "CIBA", icon: "MdPlug", action: openCiba },
    {
      label: "MCP Protocol",
      icon: "MdPlug",
      action: () => edu?.open(EDU.MCP_PROTOCOL, "what"),
    },
    {
      label: "Introspection",
      icon: "MdSearch",
      action: () => edu?.open(EDU.INTROSPECTION, "why"),
    },
    {
      label: "Agent Gateway",
      icon: "MdApps",
      action: () => edu?.open(EDU.AGENT_GATEWAY, "overview"),
    },
    {
      label: "RFC Index",
      icon: "MdFileText",
      action: () => edu?.open(EDU.RFC_INDEX, "index"),
    },
    { label: "CIMD", icon: "MdDescription", action: openCimd },
    {
      label: "Intent Auth Standards",
      icon: "MdSecurity",
      action: () => edu?.open(EDU.INTENT_AUTH_STANDARDS, "rfc-foundations"),
    },
    {
      label: "⭐ IETF Standards",
      icon: "MdBook",
      action: () => edu?.open(EDU.IETF_STANDARDS, "overview"),
    },
    {
      label: "OWASP Agentic",
      icon: "MdSecurity",
      action: () => navigate("/owasp"),
    },
  ];

  return (
    <aside className={`sidenav${collapsed ? " sidenav--collapsed" : ""}`}>
      {/* Brand */}
      <div className="sidenav-brand">
        <div className="sidenav-brand-logo">
          <div className="sidenav-logo-grid">
            <span />
            <span />
            <span />
            <span />
          </div>
        </div>
        {!collapsed && (
          <span className="sidenav-brand-name">{preset.shortName}</span>
        )}
        <button
          type="button"
          className="sidenav-collapse-btn"
          onClick={() => setCollapsed((c) => !c)}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? "›" : "‹"}
        </button>
      </div>

      {/* User badge */}
      {!collapsed && (
        <div className="sidenav-user">
          <div className="sidenav-user-avatar">
            {(user?.firstName?.[0] || "?").toUpperCase()}
          </div>
          <div className="sidenav-user-info">
            <div className="sidenav-user-name">
              {user?.firstName} {user?.lastName}
            </div>
            <div className="sidenav-user-role">
              {isAdmin ? "👑 Admin" : "👤 Customer"}
            </div>
          </div>
        </div>
      )}

      {/* Nav groups */}
      <nav className="sidenav-nav">
        {navGroups.map((group) => (
          <div key={group.group} className="sidenav-group">
            {!collapsed && (
              <div className="sidenav-group-label">{group.group}</div>
            )}
            {group.items.map((item, idx) => {
              // Action button item
              if (item.action) {
                return (
                  <button
                    key={`${item.action}-${idx}`}
                    type="button"
                    className="sidenav-link sidenav-action-btn"
                    onClick={() => handleNavAction(item.action)}
                    title={collapsed ? item.label : undefined}
                  >
                    {renderIcon(item.icon)}
                    {!collapsed && (
                      <span className="sidenav-link-label">{item.label}</span>
                    )}
                  </button>
                );
              }
              // Regular link item
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.to === "/admin" || item.to === "/dashboard"}
                  className={({ isActive }) =>
                    `sidenav-link${isActive ? " sidenav-link--active" : ""}`
                  }
                  title={collapsed ? item.label : undefined}
                >
                  {renderIcon(item.icon)}
                  {!collapsed && (
                    <span className="sidenav-link-label">{item.label}</span>
                  )}
                </NavLink>
              );
            })}
          </div>
        ))}
      </nav>

      {/* Safety & Emergency Controls */}
      <div className="sidenav-group sidenav-safety">
        {!collapsed && <div className="sidenav-group-label">Safety</div>}
        <button
          type="button"
          className="sidenav-link sidenav-safety-btn"
          onClick={() => setShowKillModal(true)}
          disabled={agentRevoked}
          title="Stop agent (emergency control)"
          style={{
            background: agentRevoked ? "#999" : "#ef4444",
            color: "white",
            cursor: agentRevoked ? "not-allowed" : "pointer",
          }}
        >
          <span style={{ fontSize: "18px" }}>🛑</span>
          {!collapsed && (
            <span className="sidenav-link-label">
              {agentRevoked ? "🔒 REVOKED" : "STOP AGENT"}
            </span>
          )}
        </button>
      </div>

      {/* Learn & Explore — mirrors the Education Bar buttons across the top */}
      <div className="sidenav-group sidenav-learn">
        {!collapsed && (
          <div className="sidenav-group-label">Learn &amp; Explore</div>
        )}
        {LEARN_ITEMS.map((item) => (
          <button
            key={item.label}
            type="button"
            className="sidenav-link sidenav-learn-btn"
            onClick={item.action}
            title={item.label}
          >
            {renderIcon(item.icon)}
            {!collapsed && (
              <span className="sidenav-link-label">{item.label}</span>
            )}
          </button>
        ))}
      </div>

      {/* Footer: logout */}
      <div className="sidenav-footer">
        <button
          type="button"
          className="sidenav-logout-btn"
          onClick={onLogout}
          title="Sign out"
        >
          <span className="sidenav-link-icon">⏻</span>
          {!collapsed && <span>Sign out</span>}
        </button>
      </div>
      {showKillModal && (
        <KillSwitchConfirmModal
          isOpen={showKillModal}
          onClose={() => setShowKillModal(false)}
          onConfirm={(agentId, reason) =>
            handleKillSwitchConfirm(agentId || "default-agent", reason)
          }
        />
      )}
    </aside>
  );
}
