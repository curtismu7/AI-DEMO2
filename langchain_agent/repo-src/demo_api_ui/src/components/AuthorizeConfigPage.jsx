import React, { useState, useEffect, useCallback } from "react";
import "./AuthorizeConfigPage.css";
import MockAuthzRulesPage from "./MockAuthzRulesPage";

const API_BASE = process.env.REACT_APP_API_BASE || "";

function ToolPicker({ tools, selected, onChange, colorClass }) {
  const selectedSet = new Set(
    (selected || '').split(',').map(s => s.trim()).filter(Boolean)
  );

  const toggle = (name) => {
    const next = new Set(selectedSet);
    if (next.has(name)) next.delete(name); else next.add(name);
    onChange(Array.from(next).join(', '));
  };

  if (!tools.length) {
    return (
      <input
        className="azc-input azc-input--tools-fallback"
        value={selected}
        onChange={e => onChange(e.target.value)}
        placeholder="tool1, tool2, tool3 (MCP server not reachable)"
      />
    );
  }

  return (
    <div className="azc-tool-picker">
      {tools.map(name => (
        <button
          key={name}
          type="button"
          onClick={() => toggle(name)}
          className={`azc-tool-chip${selectedSet.has(name) ? ` azc-tool-chip--${colorClass}` : ''}`}
        >
          {name}
        </button>
      ))}
    </div>
  );
}

function StatusBadge({ activeEngine }) {
  const engineLabel =
    {
      off: "Authorization Off",
      simulated: "Simulated (Mock)",
      pingone: "PingOne Authorize",
      pending_config: "Not Configured",
    }[activeEngine] || "Unknown";

  const cssClass = `azc-badge azc-badge--${activeEngine}`;
  return <span className={cssClass}>{engineLabel}</span>;
}

export default function AuthorizeConfigPage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("mock");
  const [mcpTools, setMcpTools] = useState([]);

  useEffect(() => {
    fetch('/api/mcp/inspector/tools', { credentials: 'include' })
      .then(r => r.ok ? r.json() : { tools: [] })
      .then(d => setMcpTools((d.tools || []).map(t => t.name)))
      .catch(() => {});
  }, []);

  const fetchConfig = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/admin/authorize/config`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json());
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchConfig();
  }, [fetchConfig]);

  const [mockForm, setMockForm] = useState({});
  const [mockSaving, setMockSaving] = useState(false);
  const [mockResult, setMockResult] = useState(null);

  const [modeSaving, setModeSaving] = useState(null); // the mode currently being saved
  const [modeError, setModeError] = useState(null);

  const handleModeChange = useCallback(async (mode) => {
    setModeSaving(mode);
    setModeError(null);
    try {
      const res = await fetch(`${API_BASE}/api/admin/authorize/config`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ authorize_mode: mode }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.message || json.error || `HTTP ${res.status}`);
      await fetchConfig();
    } catch (e) {
      setModeError(e.message);
    } finally {
      setModeSaving(null);
    }
  }, [fetchConfig]);

  useEffect(() => {
    if (data?.simulated) {
      setMockForm({
        confirmAmount: data.simulated.confirmAmount,
        denyAmount: data.simulated.denyAmount,
        stepUpAmount: data.simulated.stepUpAmount,
        mcpDenyTools: (data.simulated.mcpDenyTools || []).join(", "),
        mcpHitlTools: (data.simulated.mcpHitlTools || []).join(", "),
      });
    }
  }, [data]);

  const handleMockSave = useCallback(async () => {
    setMockSaving(true);
    setMockResult(null);
    try {
      const res = await fetch(`${API_BASE}/api/admin/authorize/config`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          simulated_confirm_amount: mockForm.confirmAmount,
          simulated_deny_amount: mockForm.denyAmount,
          simulated_stepup_amount: mockForm.stepUpAmount,
          simulated_mcp_deny_tools: mockForm.mcpDenyTools,
          simulated_mcp_hitl_tools: mockForm.mcpHitlTools,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setMockResult({
        ok: true,
        msg: "Simulated authorize rules saved successfully",
      });
      fetchConfig();
    } catch (e) {
      setMockResult({ ok: false, msg: e.message });
    } finally {
      setMockSaving(false);
    }
  }, [mockForm, fetchConfig]);

  if (loading)
    return <div className="azc-loading">Loading authorize config…</div>;
  if (error)
    return (
      <div className="azc-error">
        Error: {error}{" "}
        <button type="button" onClick={fetchConfig}>
          Retry
        </button>
      </div>
    );

  return (
    <div className="azc-root">
      <div className="azc-header">
        <div>
          <h2 className="azc-title">Authorize Configuration</h2>
          <p className="azc-subtitle">
            Configure PingOne Authorize policies and simulated (mock) authorize
            rules for transaction evaluation.
          </p>
        </div>
        <div className="azc-header-badge">
          {data?.status && (
            <StatusBadge activeEngine={data.status.activeEngine} />
          )}
          <button className="azc-refresh-btn" onClick={fetchConfig}>
            ↻ Refresh
          </button>
        </div>
      </div>

      {/* Engine mode — single source of truth for which engine evaluates */}
      <div className="azc-section" style={{ marginBottom: 18, padding: "16px 18px", border: "1px solid #e2e8f0", borderRadius: 10, background: "#fff" }}>
        <h3 style={{ margin: "0 0 4px", fontSize: 14, fontWeight: 700, color: "#0f172a" }}>Authorization Engine</h3>
        <p style={{ margin: "0 0 12px", fontSize: 13, color: "#475569" }}>
          Selects which engine evaluates every transaction. Applies live, no restart.
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
          {[
            { id: "pingone", label: "PingOne only", desc: "Real PingOne Authorize. If PingOne is unreachable, transactions are denied (fail-closed)." },
            { id: "pingone_fallback_simulated", label: "PingOne → Demo fallback", desc: "Real PingOne Authorize; fall back to the in-process demo engine if PingOne is unreachable." },
            { id: "simulated", label: "Demo only", desc: "In-process simulated engine. No PingOne API call." },
          ].map((opt) => {
            const active = data?.status?.authorizeMode === opt.id;
            const busy = modeSaving === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                onClick={() => handleModeChange(opt.id)}
                disabled={!!modeSaving}
                aria-pressed={active}
                aria-label={`Authorization engine: ${opt.label}`}
                style={{
                  textAlign: "left", padding: "12px 14px", borderRadius: 8, cursor: modeSaving ? "wait" : "pointer",
                  border: active ? "2px solid #1e3a5f" : "1px solid #cbd5e1",
                  background: active ? "#eff6ff" : "#fff",
                }}
              >
                <div style={{ fontSize: 13, fontWeight: 700, color: "#0f172a", display: "flex", alignItems: "center", gap: 6 }}>
                  {active ? "● " : "○ "}{opt.label}{busy ? " …" : ""}
                </div>
                <div style={{ fontSize: 12, color: "#475569", marginTop: 4, lineHeight: 1.4 }}>{opt.desc}</div>
              </button>
            );
          })}
        </div>
        {modeError && <div style={{ marginTop: 10, fontSize: 12, color: "#b91c1c", fontWeight: 600 }}>Failed to change mode: {modeError}</div>}
        {data?.status && (
          <div style={{ marginTop: 10, fontSize: 12, color: "#475569" }}>
            Active engine: <strong style={{ color: "#0f172a" }}>{data.status.activeEngine}</strong>
            {data.status.activeEngine === "pending_config" && " — worker credentials or a decision endpoint are not configured yet."}
          </div>
        )}
      </div>

      <div className="azc-tabs">
        <button
          className={`azc-tab ${activeTab === "mock" ? "azc-tab--active" : ""}`}
          onClick={() => setActiveTab("mock")}
        >
          Mock Rules (Simulated)
        </button>
        <button
          className={`azc-tab ${activeTab === "pingone" ? "azc-tab--active" : ""}`}
          onClick={() => setActiveTab("pingone")}
        >
          PingOne Authorize
        </button>
        <button
          className={`azc-tab ${activeTab === "mcp" ? "azc-tab--active" : ""}`}
          onClick={() => setActiveTab("mcp")}
        >
          MCP Tool Gate
        </button>
        <button
          className={`azc-tab ${activeTab === "scopes" ? "azc-tab--active" : ""}`}
          onClick={() => setActiveTab("scopes")}
        >
          Scopes & Audience
        </button>
        <button
          className={`azc-tab ${activeTab === "env" ? "azc-tab--active" : ""}`}
          onClick={() => setActiveTab("env")}
        >
          Env Vars
        </button>
      </div>

      {activeTab === "mock" && data && (
        <div className="azc-panel">
          <div className="azc-section">
            <h3>Simulated Authorize Rules</h3>
            <p className="azc-description">
              These thresholds apply when{" "}
              <code>ff_authorize_simulated=true</code> and{" "}
              <code>authorize_enabled=true</code>. Changes take effect
              immediately without server restart.
            </p>

            <div className="azc-tier-bar">
              <div
                className="azc-tier-bar__permit"
                title="Permit (below confirm threshold)"
              />
              <div
                className="azc-tier-bar__confirm"
                title="Confirm (consent only)"
              />
              <div
                className="azc-tier-bar__stepup"
                title="Step-Up (MFA + consent)"
              />
              <div
                className="azc-tier-bar__deny"
                title="Deny (above hard deny threshold)"
              />
            </div>

            <div className="azc-form">
              <label className="azc-field azc-field--deny">
                <span className="azc-field-label">
                  Hard Deny Threshold (USD)
                </span>
                <input
                  type="number"
                  className="azc-input"
                  value={mockForm.denyAmount || ""}
                  onChange={(e) =>
                    setMockForm({ ...mockForm, denyAmount: e.target.value })
                  }
                  placeholder="2000"
                />
                <span className="azc-field-hint">
                  Transactions exceeding this amount are DENIED. Default: 2000
                </span>
              </label>

              <label className="azc-field azc-field--stepup">
                <span className="azc-field-label">Step-Up Threshold (USD)</span>
                <input
                  type="number"
                  className="azc-input"
                  value={mockForm.stepUpAmount || ""}
                  onChange={(e) =>
                    setMockForm({ ...mockForm, stepUpAmount: e.target.value })
                  }
                  placeholder="500"
                />
                <span className="azc-field-hint">
                  Transactions at/above this amount require elevated
                  authentication (MFA) plus consent. Default: 500
                </span>
              </label>

              <label className="azc-field azc-field--confirm">
                <span className="azc-field-label">Confirm Threshold (USD)</span>
                <input
                  type="number"
                  className="azc-input"
                  value={mockForm.confirmAmount || ""}
                  onChange={(e) =>
                    setMockForm({ ...mockForm, confirmAmount: e.target.value })
                  }
                  placeholder="250"
                />
                <span className="azc-field-hint">
                  Transactions at/above this amount require user confirmation
                  (consent only, no MFA). Default: 250
                </span>
              </label>

              <div className="azc-mcp-section">
                <div className="azc-mcp-section__label">MCP Tools — Hard Deny List</div>
                <div className="azc-mcp-section__hint">
                  Click tools to add them to the deny list. Selected tools return DENY. Leave all unselected for no denies.
                </div>
                <ToolPicker
                  tools={mcpTools}
                  selected={mockForm.mcpDenyTools || ""}
                  onChange={(v) => setMockForm({ ...mockForm, mcpDenyTools: v })}
                  colorClass="deny"
                />
              </div>

              <div className="azc-mcp-section">
                <div className="azc-mcp-section__label">MCP Tools — HITL Approval Required</div>
                <div className="azc-mcp-section__hint">
                  Click tools to require human-in-the-loop approval before execution. Leave all unselected for no HITL gates.
                </div>
                <ToolPicker
                  tools={mcpTools}
                  selected={mockForm.mcpHitlTools || ""}
                  onChange={(v) => setMockForm({ ...mockForm, mcpHitlTools: v })}
                  colorClass="hitl"
                />
              </div>

              <button
                className="azc-save-btn"
                onClick={handleMockSave}
                disabled={mockSaving}
              >
                {mockSaving ? "Saving…" : "Save Simulated Rules"}
              </button>

              {mockResult && (
                <div
                  className={`azc-alert ${mockResult.ok ? "azc-alert--success" : "azc-alert--error"}`}
                >
                  {mockResult.ok ? "✓ " : "✗ "}
                  {mockResult.msg}
                </div>
              )}
            </div>
          </div>

          <div className="azc-section">
            <h4>How Simulated Authorize Works</h4>
            <ol className="azc-rules-list">
              <li>
                <strong>Hard Deny:</strong> Transactions exceeding the deny
                threshold (default $2000) are immediately rejected (DENY
                decision)
              </li>
              <li>
                <strong>Consent + MFA (Step-Up):</strong> Transactions at/above
                the step-up threshold (default $500) require both human consent
                and elevated authentication (MFA)
              </li>
              <li>
                <strong>Confirmation (Consent Only):</strong> Transactions
                between the confirm threshold (default $250) and step-up
                threshold require user confirmation/consent only (no MFA)
              </li>
              <li>
                <strong>Default Permit:</strong> Transactions below $250 are
                automatically permitted
              </li>
              <li>
                <strong>MCP Tool Gates:</strong> Tool names in the deny list are
                rejected outright; names in the HITL list require human approval
              </li>
            </ol>
          </div>
        </div>
      )}

      {activeTab === "pingone" && data && (
        <div className="azc-panel">
          <div className="azc-alert azc-alert--info">
            ℹ️ PingOne Authorize configuration is set in the main{" "}
            <strong>App Configuration</strong> page (search for "PingOne Setup"
            tab). This tab shows the current state.
          </div>

          <div className="azc-info-grid">
            <div className="azc-info-item">
              <span className="azc-info-label">Worker Client ID</span>
              <code>{data.pingone?.workerClientId || "(not set)"}</code>
            </div>
            <div className="azc-info-item">
              <span className="azc-info-label">Decision Endpoint ID</span>
              <code>{data.pingone?.decisionEndpointId || "(not set)"}</code>
            </div>
            <div className="azc-info-item">
              <span className="azc-info-label">MCP Decision Endpoint ID</span>
              <code>{data.pingone?.mcpDecisionEndpointId || "(not set)"}</code>
            </div>
            <div className="azc-info-item">
              <span className="azc-info-label">Legacy Policy ID</span>
              <code>{data.pingone?.policyId || "(not set)"}</code>
            </div>
          </div>

          <div className="azc-section">
            <h4>PingOne Authorize Setup</h4>
            <p>To configure PingOne Authorize:</p>
            <ol className="azc-rules-list">
              <li>
                Go to <strong>App Configuration</strong> (main app config page)
              </li>
              <li>
                Select the <strong>PingOne Setup</strong> tab
              </li>
              <li>
                Enter your PingOne Authorize worker credentials and decision
                endpoint IDs
              </li>
              <li>Return here to verify the configuration is recognized</li>
            </ol>
          </div>

          <div className="azc-section">
            <h4>Super Banking DaVinci Flow Export</h4>
            <p className="azc-description">
              Download this pre-built <strong>DaVinci flow</strong> and import it
              into your PingOne environment. It drives the Super Banking
              transaction authorization demo: it collects the transaction amount
              and type, authenticates the user via PingOne SSO, calls a PingOne
              Authorize decision endpoint with the Trust Framework parameters (
              <code>UserId</code>, <code>Amount</code>,{" "}
              <code>TransactionType</code>, <code>Acr</code>,{" "}
              <code>Timestamp</code>), and renders the PERMIT / DENY / STEP-UP
              result. The PingOne Authorize policies, rules, conditions, and
              attributes themselves are provisioned separately (see the PingOne
              Authorize Setup steps above).
            </p>
            <a
              className="azc-download-btn"
              href="/downloads/Super_Banking_Authorize_Dashboard.json"
              download="Super_Banking_Authorize_Dashboard.json"
            >
              Download DaVinci Flow (JSON)
            </a>
            <p className="azc-field-hint" style={{ marginTop: "0.5rem" }}>
              Import into PingOne Console → DaVinci → Flows → Import. After
              import, point the flow's PingOne Authorize connector at your
              decision endpoint, then publish and deploy the flow.
            </p>
          </div>
        </div>
      )}

      {activeTab === "mcp" && data && (
        <div className="azc-panel" style={{ padding: 0 }}>
          <MockAuthzRulesPage />
        </div>
      )}

      {activeTab === "scopes" && data && (
        <div className="azc-panel">
          <div className="azc-section">
            <h3>OAuth Scopes</h3>
            <p className="azc-description">
              Scopes define what permissions an OAuth token grants for banking
              operations. Each scope maps to specific banking capabilities.
            </p>

            {data.scopeDefinitions && (
              <div className="azc-scopes-grid">
                {Object.entries(data.scopeDefinitions).map(([scope, def]) => (
                  <div key={scope} className="azc-scope-card">
                    <strong className="azc-scope-name">{scope}</strong>
                    <span className="azc-scope-label">{def.label}</span>
                    <p className="azc-scope-description">{def.description}</p>
                    <span className="azc-scope-hint">
                      Permissions: {def.permissions.join(", ")}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="azc-section">
            <h3>Audience (Resource Indicator)</h3>
            <p className="azc-description">
              The resource indicator (aud claim) restricts tokens to a specific
              service. Tokens requested for MCP operations include the MCP
              server URI.
            </p>

            <div className="azc-info-grid">
              <div className="azc-info-item">
                <span className="azc-info-label">MCP Resource URI</span>
                <code>{data.audience || "(not configured)"}</code>
              </div>
            </div>

            <p className="azc-description">
              Set <code>PINGONE_RESOURCE_MCP_SERVER_URI</code> in app
              configuration to enable MCP token exchange with resource
              indicator.
            </p>
          </div>
        </div>
      )}

      {activeTab === "env" && data && (
        <div className="azc-panel">
          <table className="azc-env-table">
            <tbody>
              {Object.entries(data.envVars || {}).map(([k, v]) => (
                <tr key={k}>
                  <td className="azc-env-key">
                    <code>{k}</code>
                  </td>
                  <td className="azc-env-val">{String(v)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="azc-env-note">
            Environment variables set in <code>banking_api_server/.env</code>{" "}
            (local) or Vercel env (production). ConfigStore values override env
            vars at runtime.
          </p>
        </div>
      )}
    </div>
  );
}
