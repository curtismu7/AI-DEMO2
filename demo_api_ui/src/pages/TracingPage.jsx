import React, { useCallback, useEffect, useRef, useState } from "react";
import "./TracingPage.css";

const REFRESH_MS = 15000;
const LOOKBACK_OPTIONS = [
  { value: "15m", label: "Last 15 minutes" },
  { value: "1h", label: "Last hour" },
  { value: "6h", label: "Last 6 hours" },
  { value: "24h", label: "Last 24 hours" },
];

/**
 * Distributed tracing page — lists recent OpenTelemetry spans exported to Jaeger.
 * Data is proxied via GET /api/health/tracing/*; full flame graphs open in Jaeger UI.
 */
export default function TracingPage() {
  const [status, setStatus] = useState(null);
  const [services, setServices] = useState([]);
  const [service, setService] = useState("demo-api-server");
  const [lookback, setLookback] = useState("1h");
  const [traces, setTraces] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [expandedId, setExpandedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState(null);
  const latestTraceReq = useRef(null);

  const toggleTrace = useCallback(async (traceId) => {
    if (expandedId === traceId) {
      setExpandedId(null);
      return;
    }
    setExpandedId(traceId);
    latestTraceReq.current = traceId;
    setDetail(null);
    setDetailError(null);
    setDetailLoading(true);
    try {
      const res = await fetch(`/api/health/tracing/traces/${traceId}`, { credentials: "include" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || `HTTP ${res.status}`);
      }
      const data = await res.json();
      if (latestTraceReq.current !== traceId) return;
      setDetail(data);
    } catch (e) {
      if (latestTraceReq.current !== traceId) return;
      setDetailError(e.message || "Failed to load trace");
    } finally {
      if (latestTraceReq.current === traceId) setDetailLoading(false);
    }
  }, [expandedId]);

  const loadStatus = useCallback(async () => {
    const res = await fetch("/api/health/tracing/status", { credentials: "include" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    setStatus(data);
    return data;
  }, []);

  const loadServices = useCallback(async () => {
    const res = await fetch("/api/health/tracing/services", { credentials: "include" });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.message || `HTTP ${res.status}`);
    }
    const data = await res.json();
    setServices(data.services || []);
    return data;
  }, []);

  const loadTraces = useCallback(async () => {
    const params = new URLSearchParams({ service, limit: "25", lookback });
    const res = await fetch(`/api/health/tracing/traces?${params}`, { credentials: "include" });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.message || `HTTP ${res.status}`);
    }
    const data = await res.json();
    setTraces(data.traces || []);
    setLastUpdated(data.timestamp || new Date().toISOString());
    setError(null);
    return data;
  }, [service, lookback]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      await loadStatus();
      await loadServices();
      await loadTraces();
    } catch (e) {
      setError(e.message || "Failed to load traces");
      setTraces([]);
    } finally {
      setLoading(false);
    }
  }, [loadStatus, loadServices, loadTraces]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    const timer = setInterval(() => {
      if (!document.hidden) {
        loadTraces().catch(() => {});
      }
    }, REFRESH_MS);
    return () => clearInterval(timer);
  }, [loadTraces]);

  const jaegerUiUrl = status?.jaegerUiUrl || "http://localhost:16686";
  const traceUrl = (traceId) => `${jaegerUiUrl}/trace/${traceId}`;

  return (
    <div className="tracing-page">
      <header className="tracing-header">
        <div>
          <h1>Tracing</h1>
          <p className="tracing-subtitle">
            OpenTelemetry spans from the BFF and cooperating services, collected by Jaeger.
            Generate traffic (login, agent tools, transfers) then inspect latency and call paths here.
          </p>
        </div>
        <div className="tracing-header-actions">
          {lastUpdated && (
            <span className="tracing-meta">
              Updated {new Date(lastUpdated).toLocaleTimeString()}
            </span>
          )}
          <a
            className="tracing-btn tracing-btn--secondary"
            href={jaegerUiUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            Open Jaeger UI
          </a>
          <button type="button" className="tracing-btn" onClick={refresh} disabled={loading}>
            Refresh
          </button>
        </div>
      </header>

      <div className="tracing-status-row">
        <span className={`tracing-pill ${status?.ok ? "tracing-pill--ok" : "tracing-pill--down"}`}>
          {status?.ok ? "Jaeger connected" : "Jaeger unreachable"}
        </span>
        {status?.otelEndpoint && (
          <span className="tracing-meta">OTLP {status.otelEndpoint}</span>
        )}
      </div>

      {error && (
        <div className="tracing-error" role="alert">
          {error}
          {!status?.ok && (
            <p className="tracing-error-hint">
              Start Jaeger with <code>docker compose up -d jaeger</code> or run <code>./run.sh</code> (native mode auto-starts it).
            </p>
          )}
        </div>
      )}

      <div className="tracing-filters">
        <label className="tracing-filter">
          <span>Service</span>
          <select
            value={service}
            onChange={(e) => setService(e.target.value)}
            disabled={!services.length}
          >
            {services.length ? (
              services.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))
            ) : (
              <option value={service}>{service}</option>
            )}
          </select>
        </label>
        <label className="tracing-filter">
          <span>Window</span>
          <select value={lookback} onChange={(e) => setLookback(e.target.value)}>
            {LOOKBACK_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="tracing-table-wrap">
        <table className="tracing-table">
          <thead>
            <tr>
              <th>Operation</th>
              <th>Trace ID</th>
              <th>Spans</th>
              <th>Duration</th>
              <th>Start</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {loading && !traces.length ? (
              <tr>
                <td colSpan={6} className="tracing-empty">Loading traces…</td>
              </tr>
            ) : traces.length === 0 ? (
              <tr>
                <td colSpan={6} className="tracing-empty">
                  No traces yet for <strong>{service}</strong> in this window.
                  Use the app, then refresh.
                </td>
              </tr>
            ) : (
              traces.map((t) => (
                <React.Fragment key={t.traceId}>
                  <tr
                    className={`tracing-row ${expandedId === t.traceId ? "tracing-row--open" : ""}`}
                    onClick={() => toggleTrace(t.traceId)}
                  >
                    <td className="tracing-op">{t.operation}</td>
                    <td className="tracing-id">
                      <code>{t.traceId.slice(0, 16)}…</code>
                    </td>
                    <td>{t.spanCount}</td>
                    <td>{t.durationMs >= 1000 ? `${(t.durationMs / 1000).toFixed(2)} s` : `${t.durationMs} ms`}</td>
                    <td>{t.startTime ? new Date(t.startTime).toLocaleString() : "—"}</td>
                    <td>
                      <a
                        className="tracing-link"
                        href={traceUrl(t.traceId)}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                      >
                        View in Jaeger
                      </a>
                    </td>
                  </tr>
                  {expandedId === t.traceId && (
                    <tr className="tracing-detail-row">
                      <td colSpan={6}>
                        <TraceDetail loading={detailLoading} error={detailError} detail={detail} />
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))
            )}
          </tbody>
        </table>
      </div>

      <section className="tracing-help">
        <h2>How to use this page</h2>
        <ol>
          <li>Confirm the status pill shows <strong>Jaeger connected</strong>.</li>
          <li>Pick <strong>demo-api-server</strong> (or another service) from the dropdown.</li>
          <li>Perform actions in the demo — API calls and MCP tool paths appear as traces.</li>
          <li>Click <strong>View in Jaeger</strong> for the full span timeline and flame graph.</li>
        </ol>
      </section>
    </div>
  );
}

function TraceDetail({ loading, error, detail }) {
  if (loading) return <div className="tracing-detail tracing-detail--msg">Loading spans…</div>;
  if (error) return <div className="tracing-detail tracing-detail--msg tracing-detail--error">{error}</div>;
  if (!detail || !detail.spans.length) {
    return <div className="tracing-detail tracing-detail--msg">No spans in this trace.</div>;
  }
  const total = detail.durationMs || 1;
  return (
    <div className="tracing-detail">
      {detail.spans.map((s) => {
        const left = Math.min(100, (s.relativeStartMs / total) * 100);
        const width = Math.max(0.5, (s.durationMs / total) * 100);
        return (
          <div className="tracing-span-row" key={s.spanID}>
            <div className="tracing-span-label" style={{ paddingLeft: `${s.depth * 14}px` }}>
              <span className="tracing-span-svc">{s.serviceName}</span>
              <span className="tracing-span-op">{s.operationName}</span>
            </div>
            <div className="tracing-span-track">
              <div
                className={`tracing-span-bar tracing-span-bar--c${detail.serviceColors[s.serviceName] ?? 0}`}
                style={{ left: `${left}%`, width: `${width}%` }}
                title={`${s.operationName} — ${s.durationMs} ms`}
              />
            </div>
            <div className="tracing-span-dur">
              {s.durationMs >= 1000 ? `${(s.durationMs / 1000).toFixed(2)} s` : `${s.durationMs} ms`}
            </div>
          </div>
        );
      })}
    </div>
  );
}
