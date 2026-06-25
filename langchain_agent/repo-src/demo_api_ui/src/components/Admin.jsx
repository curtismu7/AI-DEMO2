import React, { useState, useEffect } from "react";
import TokenSecurityTester from "../components/TokenSecurityTester";
import ForensicAuditDashboard from "../components/ForensicAuditDashboard";
import ControlPlaneRoster from "../components/ControlPlaneRoster";
import apiClient from "../services/apiClient";
import "./Admin.css";

export default function Admin() {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState("overview");

  useEffect(() => {
    loadAdminStats();
  }, []);

  const loadAdminStats = async () => {
    try {
      setLoading(true);
      setError(null);
      // Try admin stats first; fall back to banking data if scope is unavailable
      try {
        const response = await apiClient.get("/api/admin/stats");
        setStats(response.data.stats);
        return;
      } catch (adminErr) {
        if (adminErr.response?.status !== 403 && adminErr.response?.status !== 401) throw adminErr;
      }
      // Fall back: derive stats from banking accounts/transactions endpoints
      const [acctRes, txRes] = await Promise.all([
        apiClient.get("/api/accounts").catch(() => ({ data: [] })),
        apiClient.get("/api/transactions").catch(() => ({ data: [] })),
      ]);
      const accounts = Array.isArray(acctRes.data) ? acctRes.data : (acctRes.data?.accounts ?? []);
      const transactions = Array.isArray(txRes.data) ? txRes.data : (txRes.data?.transactions ?? []);
      const totalBalance = accounts.reduce((s, a) => s + (a.balance || 0), 0);
      setStats({
        totalUsers: '—',
        activeUsers: '—',
        totalAccounts: accounts.length,
        activeAccounts: accounts.filter(a => a.isActive !== false).length,
        totalBalance,
        averageBalance: accounts.length ? totalBalance / accounts.length : 0,
        totalTransactions: transactions.length,
      });
    } catch (err) {
      console.error("[Admin] Error loading stats:", err);
      setError(
        err.response?.data?.message ||
          err.response?.data?.error ||
          err.message ||
          "Failed to load admin statistics",
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="admin-container">
      <div className="admin-header">
        <h1>Admin Dashboard</h1>
        <p className="admin-subtitle">
          System management and security configuration
        </p>
      </div>

      <div className="admin-tabs">
        <button
          type="button"
          className={`admin-tab ${activeTab === "overview" ? "active" : ""}`}
          onClick={() => setActiveTab("overview")}
        >
          System Overview
        </button>
        <button
          type="button"
          className={`admin-tab ${activeTab === "security" ? "active" : ""}`}
          onClick={() => setActiveTab("security")}
        >
          Security Testing
        </button>
        <button
          type="button"
          className={`admin-tab ${activeTab === "safety" ? "active" : ""}`}
          onClick={() => setActiveTab("safety")}
        >
          Agent Safety
        </button>
        <button
          type="button"
          className={`admin-tab ${activeTab === "branding" ? "active" : ""}`}
          onClick={() => setActiveTab("branding")}
        >
          Branding
        </button>
      </div>

      {activeTab === "overview" && (
        <div className="admin-section">
          <h2>System Overview</h2>

          {loading && (
            <div className="admin-loading">
              <p>Loading system statistics...</p>
            </div>
          )}

          {error && (
            <div className="admin-error">
              <strong>Error:</strong> {error}
              <button
                type="button"
                onClick={loadAdminStats}
                className="admin-retry-button"
              >
                Try Again
              </button>
            </div>
          )}

          {stats && (
            <div className="admin-stats-grid">
              <div className="stat-card">
                <div className="stat-value">{stats.totalUsers}</div>
                <div className="stat-label">Total Users</div>
                <div className="stat-subtext">{stats.activeUsers} active</div>
              </div>

              <div className="stat-card">
                <div className="stat-value">{stats.totalAccounts}</div>
                <div className="stat-label">Accounts</div>
                <div className="stat-subtext">
                  {stats.activeAccounts} active
                </div>
              </div>

              <div className="stat-card">
                <div className="stat-value">
                  {typeof stats.totalBalance === 'number' ? `$${(stats.totalBalance / 1000).toFixed(0)}K` : stats.totalBalance}
                </div>
                <div className="stat-label">Total Balance</div>
                <div className="stat-subtext">
                  {typeof stats.averageBalance === 'number' ? `Avg: $${stats.averageBalance.toFixed(0)}` : ''}
                </div>
              </div>

              <div className="stat-card">
                <div className="stat-value">{stats.totalTransactions}</div>
                <div className="stat-label">Transactions</div>
                <div className="stat-subtext">All time</div>
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab === "security" && (
        <div className="admin-section">
          <h2>Token Security Testing</h2>
          <p className="admin-section-description">
            Test how the MCP server validates tokens and rejects requests that
            violate security controls. Each scenario demonstrates a different
            security validation.
          </p>
          <div className="admin-token-tester-wrapper">
            <TokenSecurityTester />
          </div>
        </div>
      )}

      {activeTab === "safety" && (
        <div className="admin-section">
          <h2>Agent Safety Control Center</h2>
          <p className="admin-section-description">
            Immediate agent revocation and forensic audit trail. Click the red
            button to stop an agent. All kill events are logged immutably for
            compliance and analysis.
          </p>

          <ControlPlaneRoster />

          {/* The standalone "Emergency Kill Switch" button was removed — the AI
              Control Plane's live-agent row is now the single stop control (same
              reason-logging modal + real kill). Forensic audit trail kept. */}
          <div style={{ marginTop: "24px" }}>
            <ForensicAuditDashboard agentId="demo-agent" />
          </div>
        </div>
      )}
    </div>
  );
}
