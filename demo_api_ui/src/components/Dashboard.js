import React, { useState, useEffect, useCallback } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { format } from "date-fns";
import {
  toast,
  notifySuccess,
  notifyError,
  notifyWarning,
  notifyInfo,
} from "../utils/appToast";
import bffAxios from "../services/bffAxios";
import { resolveSessionUser } from "../services/sessionResolver";
import TokenChainTraceRail from "./TokenChainTraceRail";
import ExchangeModeToggle from "./ExchangeModeToggle";
import { useCurrentUserTokenEvent } from "../hooks/useCurrentUserTokenEvent";
import { navigateToAdminOAuthLogin } from "../utils/authUi";
import { toastAdminSessionError } from "../utils/dashboardToast";
import "../styles/appShellPages.css";
import "./Dashboard.css";
// Console visual language for this page — additive CSS only, scoped to
// .admin-dashboard-page. See the file header for why the look moved here
// rather than the features moving to the console.
import "./AdminDashboardSkin.css";
import { useAgentUiMode } from "../context/AgentUiModeContext";
import { useTheme } from "../context/ThemeContext";
import { useSessionToken } from '../context/SessionTokenContext';
import { useEventStream } from "../context/EventStreamContext";
import EventStreamPanel from "./EventStreamPanel";

import ApiCallsModal from "./ApiCallsModal";

import FloatingPanel from "./FloatingPanel";
import OAuthTokenDisplayPage from "./OAuthTokenDisplayPage";
import ConfirmModal from "./ConfirmModal";
import DraggableModal from "./DraggableModal";
import ThresholdControls from "./ThresholdControls";
import AdminCustomerPanel from "./AdminCustomerPanel";
import AdminDemoControlStrip from "./AdminDemoControlStrip";
import GroupMembershipToggle from "./GroupMembershipToggle";

const Dashboard = ({ user, onLogout }) => {
  // Fetch and display current user token in the token chain
  useCurrentUserTokenEvent();
  const location = useLocation();
  const navigate = useNavigate();
  const { placement: agentPlacement } = useAgentUiMode();
  const { darkMode, toggleDarkMode } = useTheme();
  const { addEvent } = useEventStream();
  const [stats, setStats] = useState(null);
  const [recentActivity, setRecentActivity] = useState([]);
  const [loading, setLoading] = useState(true);
  const [forbidden403, setForbidden403] = useState(false);
  const [showTokenModal, setShowTokenModal] = useState(false);
  const { registerTokenModalOpener } = useSessionToken();
  const [resettingDemo, setResettingDemo] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [confirmWriteSeed, setConfirmWriteSeed] = useState(false);
  const [apiCallsModalOpen, setApiCallsModalOpen] = useState(false);
  const [showEventStream, setShowEventStream] = useState(false);
  const fetchingRef = React.useRef(false);
  const mountedRef = React.useRef(true);
  const [scopeInjectionEnabled, setScopeInjectionEnabled] = useState(false);
  const [selectedMetric, setSelectedMetric] = useState(null);
  const [metricDetails, setMetricDetails] = useState(null);

  const isLocalApiHost =
    typeof window !== "undefined" && false; /* always use api.ping.demo */

  // Helper: Dispatch backend events from agent request responses
  const dispatchBackendEvents = useCallback((data, requestId) => {
    if (data?.events && Array.isArray(data.events)) {
      data.events.forEach(e => {
        addEvent({
          ...e,
          requestId: requestId || e.requestId,
          timestamp: e.timestamp || new Date().toISOString(),
        });
      });
    }
  }, [addEvent]);

  // Helper: Dispatch error event
  const dispatchErrorEvent = useCallback((error, requestId) => {
    addEvent({
      type: 'error',
      message: error.message || 'Request failed',
      plainEnglish: error.message || 'An error occurred',
      technicalDetails: {
        details: error.stack || error.toString(),
        status: error.response?.status,
        data: error.response?.data,
      },
      severity: 'error',
      requestId,
      timestamp: new Date().toISOString(),
    });
  }, [addEvent]);

  const handleDownloadBootstrap = async () => {
    try {
      const res = await bffAxios.get("/api/admin/bootstrap/export", {
        responseType: "blob",
      });
      const blob = new Blob([res.data], { type: "application/json" });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "bootstrapData.json";
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
      notifySuccess(
        "Downloaded bootstrapData.json — commit it to update the default seed.",
      );
    } catch (err) {
      let msg = err.message || "Seed export failed.";
      const data = err.response?.data;
      if (data instanceof Blob) {
        try {
          const text = await data.text();
          const j = JSON.parse(text);
          msg = j.message || j.error || msg;
        } catch {
          msg = "Seed export failed.";
        }
      } else if (data?.message) {
        msg = data.message;
      }
      notifyError(msg);
    }
  };

  const handleWriteBootstrap = async () => {
    setConfirmWriteSeed(true);
  };

  const doWriteBootstrap = async () => {
    setConfirmWriteSeed(false);
    try {
      const { data } = await bffAxios.post("/api/admin/bootstrap/export");
      notifySuccess(data.path ? `Wrote ${data.path}` : "Seed file written.");
    } catch (err) {
      const msg =
        err.response?.data?.message || err.response?.data?.error || err.message;
      notifyError(msg || "Could not write seed file.");
    }
  };

  const handleMetricClick = (metricKey) => {
    const details = {
      totalUsers: {
        title: "Total Users",
        value: stats?.totalUsers || 0,
        description: "Total number of user accounts in the system",
        details: [
          { label: "Active Users", value: stats?.activeUsers || 0 },
          {
            label: "Inactive Users",
            value: (stats?.totalUsers || 0) - (stats?.activeUsers || 0),
          },
        ],
      },
      activeUsers: {
        title: "Active Users",
        value: stats?.activeUsers || 0,
        description: "Users with activity in the last 24 hours",
        details: [
          { label: "Total Users", value: stats?.totalUsers || 0 },
          {
            label: "Activity Rate",
            value: `${(((stats?.activeUsers || 0) / (stats?.totalUsers || 1)) * 100).toFixed(1)}%`,
          },
        ],
      },
      totalAccounts: {
        title: "Total Accounts",
        value: stats?.totalAccounts || 0,
        description: "Total number of bank accounts across all users",
        details: [
          { label: "Users", value: stats?.totalUsers || 0 },
          {
            label: "Accounts per User",
            value: (
              (stats?.totalAccounts || 0) / (stats?.totalUsers || 1)
            ).toFixed(1),
          },
        ],
      },
      totalTransactions: {
        title: "Total Transactions",
        value: stats?.totalTransactions || 0,
        description: "Total number of transactions processed",
        details: [
          { label: "Total Accounts", value: stats?.totalAccounts || 0 },
          {
            label: "Transactions per Account",
            value: (
              (stats?.totalTransactions || 0) / (stats?.totalAccounts || 1)
            ).toFixed(1),
          },
        ],
      },
      totalBalance: {
        title: "Total Balance",
        value: `$${(stats?.totalBalance || 0).toLocaleString()}`,
        description: "Combined balance across all accounts by type",
        details: stats?.balanceByType
          ? Object.entries(stats.balanceByType).map(([type, data]) => ({
              label: `${type.charAt(0).toUpperCase() + type.slice(1)} (${data.count} accounts)`,
              value: `$${data.balance.toLocaleString()}`,
            }))
          : [
              { label: "Total Accounts", value: stats?.totalAccounts || 0 },
              {
                label: "Average Balance",
                value: `$${(stats?.averageBalance || 0).toLocaleString()}`,
              },
            ],
      },
      averageBalance: {
        title: "Average Balance",
        value: `$${(stats?.averageBalance || 0).toLocaleString()}`,
        description: "Average account balance",
        details: [
          {
            label: "Total Balance",
            value: `$${(stats?.totalBalance || 0).toLocaleString()}`,
          },
          { label: "Total Accounts", value: stats?.totalAccounts || 0 },
        ],
      },
    };
    setSelectedMetric(metricKey);
    setMetricDetails(details[metricKey]);
  };

  const handleResetDemo = async () => {
    setConfirmReset(true);
  };

  const doResetDemo = async () => {
    setConfirmReset(false);
    setResettingDemo(true);
    try {
      await bffAxios.post("/api/accounts/reset-all-demo");
      notifySuccess("Demo accounts reset to $5,000.");
    } catch (err) {
      notifyError(`Reset failed: ${err.response?.data?.error || err.message}`);
    } finally {
      setResettingDemo(false);
    }
  };

  const fetchDashboardData = useCallback(
    async (attempt = 0) => {
      if (fetchingRef.current && attempt === 0) return;
      if (attempt === 0) fetchingRef.current = true;
      // Guard: abort retries if component has unmounted
      if (mountedRef.current === false) return;
      try {
        setLoading(true);
        const [statsResult, activityResult] = await Promise.allSettled([
          bffAxios.get("/api/admin/stats"),
          bffAxios.get("/api/admin/activity/recent?hours=24"),
        ]);

        if (statsResult.status === "rejected") {
          const err = statsResult.reason;
          console.error(
            "Dashboard stats error:",
            err?.response?.data || err?.message || err,
          );
          const status = err.response?.status;
          const detail =
            err.response?.data?.error_description ||
            err.response?.data?.message ||
            err.message ||
            "";
          if (status === 401 && user?.role === "admin" && attempt < 3) {
            const delays = [600, 1400, 2200];
            setForbidden403(false);
            if (attempt === 0) {
              notifyInfo("Reconnecting to admin API…", {
                toastId: "admin-dash-reconnect",
                autoClose: 3000,
              });
            }
            await new Promise((r) => setTimeout(r, delays[attempt]));
            return fetchDashboardData(attempt + 1);
          }
          toast.dismiss("admin-dash-reconnect");
          if (status === 401) {
            setForbidden403(false);
            const still = await resolveSessionUser();
            if (still?.role === "admin") {
              notifyWarning(
                "Could not load admin data yet. Try refreshing the page, or use Refresh access token in the AI agent.",
                { autoClose: 14000 },
              );
            } else {
              toastAdminSessionError(
                "Your session has expired. Please sign in again.",
                navigateToAdminOAuthLogin,
              );
            }
          } else if (status === 403) {
            setForbidden403(true);
            notifyError(
              "You do not have permission to access the admin dashboard.",
            );
          } else {
            setForbidden403(false);
            notifyError(
              detail
                ? `Failed to load dashboard data (${status || "error"}): ${detail}`
                : `Failed to load dashboard data${status ? ` (HTTP ${status})` : ""}. Try refreshing the page.`,
            );
          }
          setStats(null);
          return;
        }

        const nextStats = statsResult.value.data?.stats;
        if (!nextStats || typeof nextStats !== "object") {
          toast.dismiss("admin-dash-reconnect");
          setForbidden403(false);
          notifyError(
            "Failed to load dashboard data: invalid response from server.",
          );
          setStats(null);
          return;
        }
        toast.dismiss("admin-dash-reconnect");
        setStats(nextStats);
        setForbidden403(false);

        if (activityResult.status === "fulfilled") {
          setRecentActivity(activityResult.value.data?.logs ?? []);
        } else {
          console.error(
            "Dashboard activity error:",
            activityResult.reason?.response?.data ||
              activityResult.reason?.message,
          );
          setRecentActivity([]);
        }
      } catch (err) {
        console.error("Dashboard error:", err);
        toast.dismiss("admin-dash-reconnect");
        setForbidden403(false);
        notifyError(err.message || "Failed to load dashboard data");
        setStats(null);
      } finally {
        setLoading(false);
        fetchingRef.current = false;
      }
    },
    [user],
  );
  // Scope-injection flag. This used to share an effect with the customer
  // lookup card's config/hints fetches; that card is gone, but
  // setScopeInjectionEnabled is not — it drives the scope-injection banner.
  // Removing the effect wholesale took this with it until the parity guard
  // caught the missing /api/admin/config call.
  useEffect(() => {
    bffAxios
      .get("/api/admin/config")
      .then((res) => {
        const cfg = res.data;
        setScopeInjectionEnabled(
          cfg.ff_inject_scopes === "true" || cfg.ff_inject_scopes === true,
        );
      })
      .catch(() => {
        /* non-critical */
      });
  }, []);


  useEffect(() => {
    mountedRef.current = true;
    fetchDashboardData();
    return () => { mountedRef.current = false; };
  }, [fetchDashboardData]);

  useEffect(() => {
    if (!location.state?.resetDemoSuccess) return;
    notifySuccess("Demo reset. All agent history and audit logs cleared.");
    navigate(location.pathname, { replace: true, state: {} });
    fetchDashboardData();
  }, [location.state, location.pathname, navigate, fetchDashboardData]);


  // Function to open token modal
  const openTokenModal = () => {
    setShowTokenModal(true);
  };

  // SessionTokenProvider owns the pill countdown; this dashboard only owns the
  // token-detail modal, so register an opener for the pill's "View Token" button.
  useEffect(
    () => registerTokenModalOpener(() => setShowTokenModal(true)),
    [registerTokenModalOpener],
  );

  // Check if scope injection is enabled (Phase 146 — D-04)

  if (loading) {
    return (
      <div className="loading" role="status" aria-live="polite">
        <div>Loading dashboard…</div>
      </div>
    );
  }

  return (
    <div className="admin-dashboard-page app-page-shell app-page-shell--toolbar-room app-page-shell--dash2026">
      <a href="#admin-dashboard-main" className="dash-skip-link">
        Skip to admin content
      </a>
      <div
        className={`app-page-shell__body app-page-shell__body--wide ${agentPlacement === "bottom" ? "app-page-shell__body--embed-agent" : ""}`}
      >
        <div
          className={`ud-shell ${agentPlacement === "bottom" ? "ud-shell--embed-bottom" : "ud-shell--floating-only"}`}
        >
          <div className="split-pane-layout">
            {scopeInjectionEnabled && (
              <div className="dash-scope-injection-banner" role="alert">
                <span className="dash-scope-injection-banner__icon"></span>
                <div className="dash-scope-injection-banner__text">
                  <strong>SCOPE INJECTION ENABLED — Demo Mode</strong>
                  <span>
                    Banking scopes are being injected by the BFF (not from
                    PingOne). Check Token Chain for ⚡ INJECTED badges.
                  </span>
                </div>
                <button
                  className="dash-scope-injection-banner__close"
                  onClick={() => setScopeInjectionEnabled(false)}
                  aria-label="Dismiss"
                  type="button"
                >
                  ✕
                </button>
              </div>
            )}
            <div
              className="app-page-toolbar"
              role="toolbar"
              aria-label="Admin actions"
            >
              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.4rem",
                  cursor: "pointer",
                  padding: "0.3rem 0.5rem",
                  borderRadius: "6px",
                  fontSize: "0.85rem",
                  fontWeight: 500,
                  userSelect: "none",
                }}
              >
                <input
                  type="checkbox"
                  checked={showEventStream}
                  onChange={(e) => setShowEventStream(e.target.checked)}
                  style={{ cursor: "pointer" }}
                  aria-label="Toggle What's Happening event stream"
                />
                What's Happening:
              </label>
              {/* Page-level theme control. The only other dark-mode switch in
                  the app lives in the agent header's More tray, and the agent
                  starts collapsed on this page — without this button the
                  dashboard's dark mode is unreachable on sight. */}
              <button
                type="button"
                onClick={toggleDarkMode}
                className="app-page-toolbar-btn"
                title="Switch the dashboard between light and dark"
                aria-pressed={darkMode}
              >
                {darkMode ? "Light mode" : "Dark mode"}
              </button>
              <button
                type="button"
                onClick={() => setApiCallsModalOpen(true)}
                className="app-page-toolbar-btn"
                title="View API calls history"
              >
                API Calls
              </button>
              <ThresholdControls />
              <button
                type="button"
                onClick={openTokenModal}
                className="app-page-toolbar-btn app-page-toolbar-btn--icon"
                title="View OAuth Token Info"
              >
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  aria-hidden="true"
                >
                  <path d="M12,15.5A3.5,3.5 0 0,1 8.5,12A3.5,3.5 0 0,1 12,8.5A3.5,3.5 0 0,1 15.5,12A3.5,3.5 0 0,1 12,15.5M19.43,12.97C19.47,12.65 19.5,12.33 19.5,12C19.5,11.67 19.47,11.34 19.43,11L21.54,9.37C21.73,9.22 21.78,8.95 21.66,8.73L19.66,5.27C19.54,5.05 19.27,4.96 19.05,5.05L16.56,6.05C16.04,5.66 15.5,5.32 14.87,5.07L14.5,2.42C14.46,2.18 14.25,2 14,2H10C9.75,2 9.54,2.18 9.5,2.42L9.13,5.07C8.5,5.32 7.96,5.66 7.44,6.05L4.95,5.05C4.73,4.96 4.46,5.05 4.34,5.27L2.34,8.73C2.22,8.95 2.27,9.22 2.46,9.37L4.57,11C4.53,11.34 4.5,11.67 4.5,12C4.5,12.33 4.53,12.65 4.57,12.97L2.46,14.63C2.27,14.78 2.22,15.05 2.34,15.27L4.34,18.73C4.46,18.95 4.73,19.03 4.95,18.95L7.44,17.94C7.96,18.34 8.5,18.68 9.13,18.93L9.5,21.58C9.54,21.82 9.75,22 10,22H14C14.25,22 14.46,21.82 14.5,21.58L14.87,18.93C15.5,18.68 16.04,18.34 16.56,17.94L19.05,18.95C19.27,19.03 19.54,18.95 19.66,18.73L21.66,15.27C21.78,15.05 21.73,14.78 21.54,14.63L19.43,12.97Z" />
                </svg>
              </button>
              <button
                type="button"
                onClick={handleDownloadBootstrap}
                className="app-page-toolbar-btn"
                title="Download current in-memory data as bootstrapData.json for the next deploy"
              >
                Export seed JSON
              </button>
              {isLocalApiHost && (
                <button
                  type="button"
                  onClick={handleWriteBootstrap}
                  className="app-page-toolbar-btn"
                  title="Write data/bootstrapData.json on the server (requires ALLOW_BOOTSTRAP_EXPORT_WRITE in production)"
                >
                  Save seed on server
                </button>
              )}
              <button
                type="button"
                onClick={handleResetDemo}
                disabled={resettingDemo}
                className="app-page-toolbar-btn"
                title="Reset all OAuth demo accounts to $5,000 starting balance"
              >
                {resettingDemo ? "Resetting…" : "Reset Demo"}
              </button>
            </div>
            {/* Demo controls — the agent-header controls that only matter while
                presenting this page. The agent hides its own copies here (see
                pageOwnsAgentChrome in AIAgent.js). */}
            <AdminDemoControlStrip />
            <main
              id="admin-dashboard-main"
              tabIndex={-1}
              className="admin-dash-main--split"
            >
              {/* Token chain — grouped card (inspector includes its own title) */}
              <section
                className="dash-shell-card dash-shell-card--token"
                aria-label="Security and token chain"
              >
                <ExchangeModeToggle hideTable />
                <TokenChainTraceRail />
              </section>

              {/* Col-2 wrapper: all right-column sections scroll together */}
              <div className="admin-dash-col2">
              <section
                className="dash-shell-card"
                aria-labelledby="pingone-admin-access-heading"
              >
                <h2 id="pingone-admin-access-heading" className="dash-shell-card__title">
                  PingOne Admin access
                </h2>
                <GroupMembershipToggle verticalId="pingone-admin" />
              </section>
              <AdminCustomerPanel />
              {/* The Customer lookup card lived here. It duplicated the
                  search, profile, accounts and transactions of the
                  Customer lookup & admin panel below, which now also
                  renders the PingOne record via
                  /api/admin/transactions/lookup. One search on the page,
                  nothing removed. */}

              {/* Statistics Cards */}
              {stats ? (
                <section
                  className="dash-shell-card"
                  aria-labelledby="dash-kpi-heading"
                >
                  <h2 id="dash-kpi-heading" className="dash-shell-card__title">
                    Key metrics
                  </h2>
                  <div className="stats-grid">
                    <button
                      className="stat-card stat-card--clickable"
                      onClick={() => handleMetricClick("totalUsers")}
                      type="button"
                      aria-label="View total users details"
                    >
                      <div className="stat-value">{stats.totalUsers}</div>
                      <div className="stat-label">Total Users</div>
                    </button>
                    <button
                      className="stat-card stat-card--clickable"
                      onClick={() => handleMetricClick("activeUsers")}
                      type="button"
                      aria-label="View active users details"
                    >
                      <div className="stat-value">{stats.activeUsers}</div>
                      <div className="stat-label">Active Users</div>
                    </button>
                    <button
                      className="stat-card stat-card--clickable"
                      onClick={() => handleMetricClick("totalAccounts")}
                      type="button"
                      aria-label="View total accounts details"
                    >
                      <div className="stat-value">{stats.totalAccounts}</div>
                      <div className="stat-label">Total Accounts</div>
                    </button>
                    <button
                      className="stat-card stat-card--clickable"
                      onClick={() => handleMetricClick("totalTransactions")}
                      type="button"
                      aria-label="View total transactions details"
                    >
                      <div className="stat-value">
                        {stats.totalTransactions}
                      </div>
                      <div className="stat-label">Total Transactions</div>
                    </button>
                    <button
                      className="stat-card stat-card--clickable"
                      onClick={() => handleMetricClick("totalBalance")}
                      type="button"
                      aria-label="View total balance details"
                    >
                      <div className="stat-value">
                        ${stats.totalBalance.toLocaleString()}
                      </div>
                      <div className="stat-label">Total Balance</div>
                    </button>
                    <button
                      className="stat-card stat-card--clickable"
                      onClick={() => handleMetricClick("averageBalance")}
                      type="button"
                      aria-label="View average balance details"
                    >
                      <div className="stat-value">
                        ${stats.averageBalance.toLocaleString()}
                      </div>
                      <div className="stat-label">Average Balance</div>
                    </button>
                  </div>
                </section>
              ) : (
                <div className="card" style={{ marginBottom: "1rem" }}>
                  <p style={{ marginTop: 0 }}>
                    Could not load admin statistics. Check the toast for
                    details.
                  </p>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => fetchDashboardData(0)}
                  >
                    Retry
                  </button>
                  {forbidden403 && (
                    <div
                      style={{
                        marginTop: "1rem",
                        fontSize: "0.9rem",
                        color: "#374151",
                        lineHeight: 1.5,
                      }}
                    >
                      <p style={{ marginTop: 0 }}>
                        The API rejected this request. Common causes: the access
                        token was issued to the <strong>end-user</strong>{" "}
                        PingOne app but the admin dashboard requires the{" "}
                        <strong>admin</strong> app; or hosted env vars (
                        <code>PINGONE_ENVIRONMENT_ID</code>,{" "}
                        <strong>admin</strong> and <strong>user</strong> client
                        IDs/secrets, redirect URIs) do not match the PingOne
                        apps that issued the token.
                      </p>
                      <p>
                        <strong>Shared hosted URL:</strong> everyone uses the
                        same env vars in the deployment — set{" "}
                        <code>PINGONE_AI_CORE_CLIENT_ID</code> (or{" "}
                        <code>PINGONE_CORE_CLIENT_ID</code>) to your{" "}
                        <strong>admin</strong> PingOne application ID, and
                        register this site&apos;s redirect URIs in that app.
                      </p>
                      <p>
                        <strong>Serverless / multi-instance:</strong> set{" "}
                        <code>REDIS_URL</code> (or Vercel KV / Replit Redis) so
                        OAuth session/state survives across instances —
                        otherwise <strong>Admin Sign in</strong> may fail before
                        you reach PingOne.
                      </p>
                      <p style={{ marginBottom: 0 }}>
                        <button
                          type="button"
                          className="btn btn-primary"
                          onClick={onLogout}
                        >
                          Sign out
                        </button>
                        <span style={{ marginLeft: "0.5rem" }}>
                          then open <strong>Admin Sign in</strong> again on the
                          login page.
                        </span>
                      </p>
                    </div>
                  )}
                </div>
              )}

              {/* Recent Activity */}
              <div className="card">
                <div className="card-header">
                  <h2 className="card-title">
                    Recent Activity (Last 24 Hours)
                  </h2>
                </div>

                {recentActivity.length > 0 ? (
                  <div className="table-container">
                    <table className="table">
                      <thead>
                        <tr>
                          <th>Time</th>
                          <th>User</th>
                          <th>Action</th>
                          <th>Endpoint</th>
                          <th>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {recentActivity.slice(0, 10).map((log) => (
                          <tr key={log.id}>
                            <td>
                              {format(
                                new Date(log.timestamp),
                                "MMM dd, HH:mm:ss",
                              )}
                            </td>
                            <td>{log.username || "Unknown"}</td>
                            <td>
                              <span
                                style={{
                                  padding: "0.25rem 0.5rem",
                                  borderRadius: "0.25rem",
                                  fontSize: "0.75rem",
                                  fontWeight: "500",
                                  backgroundColor: getActionColor(log.action),
                                  color: "white",
                                }}
                              >
                                {log.action}
                              </span>
                            </td>
                            <td
                              style={{
                                fontFamily: "inherit",
                                fontSize: "0.875rem",
                              }}
                            >
                              {log.endpoint}
                            </td>
                            <td>
                              <span
                                style={{
                                  padding: "0.25rem 0.5rem",
                                  borderRadius: "0.25rem",
                                  fontSize: "0.75rem",
                                  fontWeight: "500",
                                  backgroundColor:
                                    log.responseStatus >= 400
                                      ? "#ef4444"
                                      : "#10b981",
                                  color: "white",
                                }}
                              >
                                {log.responseStatus}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="empty-state">
                    <h3>No recent activity</h3>
                    <p>No activity has been recorded in the last 24 hours.</p>
                  </div>
                )}
              </div>
              </div>{/* end admin-dash-col2 */}
            </main>
          </div>
        </div>

        {/* User Session Token Modal */}
        {showTokenModal && (
          <FloatingPanel
            title="User Session Token"
            onClose={() => setShowTokenModal(false)}
            defaultWidth={820}
            defaultHeight={Math.min(window.innerHeight - 80, 940)}
            defaultX={Math.max(0, Math.round((window.innerWidth - 820) / 2))}
            defaultY={60}
            minWidth={360}
            minHeight={200}
          >
            <div style={{ overflowY: "auto", height: "100%" }}>
              <OAuthTokenDisplayPage />
            </div>
          </FloatingPanel>
        )}

        <ApiCallsModal
          open={apiCallsModalOpen}
          onClose={() => setApiCallsModalOpen(false)}
        />

        {showEventStream && (
          <div style={{ position: "fixed", bottom: "2rem", right: "2rem", zIndex: 999 }}>
            <EventStreamPanel onClose={() => setShowEventStream(false)} />
          </div>
        )}

        <ConfirmModal
          isOpen={confirmReset}
          title="Reset Demo Accounts?"
          message="Reset all demo OAuth accounts to a $5,000 starting balance? This will overwrite any transfers or deposits made during the demo."
          confirmLabel="Reset accounts"
          cancelLabel="Cancel"
          danger
          onConfirm={doResetDemo}
          onCancel={() => setConfirmReset(false)}
        />
        <ConfirmModal
          isOpen={confirmWriteSeed}
          title="Overwrite seed file?"
          message="This will overwrite data/bootstrapData.json on the API server with the current in-memory data. Local dev only."
          confirmLabel="Write seed file"
          cancelLabel="Cancel"
          onConfirm={doWriteBootstrap}
          onCancel={() => setConfirmWriteSeed(false)}
        />

        {/* Metric Details Modal */}
        {/* Metric details — DraggableModal per the standing modal rule (was a
            hand-rolled fixed overlay). The default footer supplies Close.
            Styled via .dash-metric-detail classes (Dashboard.css): the modal
            portals to document.body, OUTSIDE .admin-dashboard-page, so the
            --admin-* tokens do not resolve here — those classes carry their
            own dark block. */}
        <DraggableModal
          isOpen={Boolean(selectedMetric && metricDetails)}
          onClose={() => setSelectedMetric(null)}
          title={metricDetails?.title || "Metric details"}
          defaultWidth={500}
          defaultHeight={430}
          storageKey="admin-metric-details"
        >
          {metricDetails && (
            <div className="dash-metric-detail">
              <p className="dash-metric-detail__desc">{metricDetails.description}</p>
              <div className="dash-metric-detail__value-box">
                <div className="dash-metric-detail__value">{metricDetails.value}</div>
              </div>
              {metricDetails.details && metricDetails.details.length > 0 && (
                <div>
                  <h3 className="dash-metric-detail__h">Related Metrics</h3>
                  {metricDetails.details.map((detail) => (
                    <div key={detail.label} className="dash-metric-detail__row">
                      <span className="dash-metric-detail__label">{detail.label}</span>
                      <span className="dash-metric-detail__val">{detail.value}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </DraggableModal>
      </div>
    </div>
  );
};

const getActionColor = (action) => {
  const colors = {
    LOGIN: "#10b981",
    REGISTER: "var(--brand-navy)",
    TRANSFER_MONEY: "#f59e0b",
    CHECK_BALANCE: "#8b5cf6",
    GET_TRANSACTIONS: "#06b6d4",
    CREATE_USER: "#84cc16",
    UPDATE_USER: "#f97316",
    DELETE_USER: "#ef4444",
    ADMIN_ACCESS: "#6366f1",
    VIEW_ACTIVITY_LOGS: "#ec4899",
  };

  return colors[action] || "#6b7280";
};

export default Dashboard;
