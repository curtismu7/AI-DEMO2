import React, { useCallback, useEffect, useRef, useState } from "react";
import "./ServersPage.css";

// Live server inventory — renders GET /api/health/inventory (all compose
// services + host llama tiers). Data source of truth: docs/server-inventory-sot.md
// mirrored in demo_api_server/data/serverInventory.js.

const REFRESH_MS = 15000;

const CATEGORY_LABELS = {
  core: "Core",
  mcp: "MCP Servers & Gateways",
  agents: "AI Agents",
  "ai-infra": "AI Infrastructure",
  authz: "Authorization & Consent",
  "demo-prop": "Demo Props (on-demand)",
};

const CATEGORY_ORDER = ["core", "mcp", "agents", "authz", "ai-infra", "demo-prop"];

function StatusCell({ svc }) {
  if (svc.up === null) {
    return <span className="servers-badge">on-demand</span>;
  }
  return (
    <span className={`servers-dot ${svc.up ? "up" : "down"}`} title={svc.up ? "Up" : `Down${svc.error ? ` — ${svc.error}` : ""}`} />
  );
}

function portLabel(svc) {
  if (svc.hostPort == null && svc.internalPort == null) return "—";
  if (svc.hostPort == null) return `internal :${svc.internalPort}`;
  if (svc.hostPort === svc.internalPort) return `:${svc.hostPort}`;
  return `:${svc.hostPort} → :${svc.internalPort}`;
}

export default function ServersPage() {
  const [services, setServices] = useState([]);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const inFlight = useRef(false);

  const load = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const res = await fetch("/api/health/inventory", { credentials: "include" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setServices(data.services || []);
      setLastUpdated(data.timestamp || new Date().toISOString());
      setError(null);
    } catch (e) {
      setError(e.message || "Failed to load inventory");
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(() => {
      if (!document.hidden) load();
    }, REFRESH_MS);
    return () => clearInterval(timer);
  }, [load]);

  const probed = services.filter((s) => s.up !== null);
  const upCount = probed.filter((s) => s.up).length;

  return (
    <div className="servers-page">
      <div className="servers-header">
        <div>
          <h1>Servers</h1>
          <p className="servers-subtitle">
            Live inventory of every demo service — probed by the BFF, refreshed every 15s.
          </p>
        </div>
        <div className="servers-header-right">
          {lastUpdated && (
            <span className="servers-meta">
              {upCount}/{probed.length} up · updated {new Date(lastUpdated).toLocaleTimeString()}
            </span>
          )}
          <button type="button" className="servers-refresh" onClick={load} disabled={loading}>
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="servers-error" role="alert">
          ⚠️ Could not refresh inventory ({error}). Showing last known data.
        </div>
      )}

      {loading && services.length === 0 ? (
        <div className="servers-loading">Loading inventory…</div>
      ) : (
        CATEGORY_ORDER.map((cat) => {
          const rows = services.filter((s) => s.category === cat);
          if (rows.length === 0) return null;
          return (
            <section key={cat} className="servers-group">
              <h2>{CATEGORY_LABELS[cat] || cat}</h2>
              <div className="servers-table-wrap">
                <table className="servers-table">
                  <thead>
                    <tr>
                      <th className="col-status">Status</th>
                      <th>Name</th>
                      <th>Container</th>
                      <th>Ports</th>
                      <th>Latency</th>
                      <th>Runtime</th>
                      <th>Purpose</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((svc) => (
                      <tr key={svc.key} className={svc.up === false ? "row-down" : ""}>
                        <td className="col-status"><StatusCell svc={svc} /></td>
                        <td className="col-name">{svc.name}</td>
                        <td className="col-container">{svc.container || "host process"}</td>
                        <td className="col-ports">{portLabel(svc)}</td>
                        <td className="col-latency">
                          {svc.up && svc.latencyMs != null ? `${svc.latencyMs} ms` : "—"}
                        </td>
                        <td className="col-lang">{svc.lang}</td>
                        <td className="col-purpose">{svc.purpose}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          );
        })
      )}
    </div>
  );
}
