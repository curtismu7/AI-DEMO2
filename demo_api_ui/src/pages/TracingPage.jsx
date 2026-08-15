// demo_api_ui/src/pages/TracingPage.jsx
import React, { useCallback, useEffect, useRef, useState } from "react";
import "./TracingPage.css";
import {
  isTransientFailure,
  pickBestService,
  rankCandidateServices,
  readStoredService,
  writeStoredService,
} from "./tracingServiceSelect";
import TraceGraphView from "../components/TraceGraphView";
import ProjectedTimeline from "../components/ProjectedTimeline";

const REFRESH_MS = 15000;
const LOOKBACK_OPTIONS = [
  { value: "15m", label: "Last 15 minutes" },
  { value: "1h", label: "Last hour" },
  { value: "6h", label: "Last 6 hours" },
  { value: "24h", label: "Last 24 hours" },
];

const TOKEN_CHAIN_HREF = "/monitoring/token-chain";

/**
 * Fetches a short trace list for auto-select probing.
 * @param {string} serviceName
 * @param {string} lookback
 */
async function fetchTraceProbe(serviceName, lookback) {
  const params = new URLSearchParams({ service: serviceName, limit: "5", lookback });
  const res = await fetch(`/api/health/tracing/traces?${params}`, { credentials: "include" });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message || `HTTP ${res.status}`);
  }
  const data = await res.json();
  return { service: serviceName, traces: data.traces || [] };
}

/**
 * Chooses initial service: stored preference, else newest-trace probe, else first in list.
 * @param {string[]} services
 * @param {string} lookback
 * @returns {Promise<{ service: string, source: "stored" | "auto" }>}
 */
async function resolveInitialService(services, lookback) {
  const stored = readStoredService();
  if (stored && services.includes(stored)) {
    return { service: stored, source: "stored" };
  }
  const candidates = rankCandidateServices(services);
  if (!candidates.length) {
    return { service: "demo-api-server", source: "auto" };
  }
  const results = await Promise.all(
    candidates.map((name) =>
      fetchTraceProbe(name, lookback).catch(() => ({ service: name, traces: [] })),
    ),
  );
  return { service: pickBestService(results, services), source: "auto" };
}

/**
 * Distributed tracing page — lists recent OpenTelemetry spans exported to Jaeger.
 * Data is proxied via GET /api/health/tracing/*; full flame graphs open in Jaeger UI.
 */
export default function TracingPage() {
  const [status, setStatus] = useState(null);
  const [services, setServices] = useState([]);
  const [service, setService] = useState("");
  const [selectionSource, setSelectionSource] = useState("auto");
  const [lookback, setLookback] = useState("1h");
  const [traces, setTraces] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [errorKind, setErrorKind] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [expandedId, setExpandedId] = useState(null);
  const [detailTab, setDetailTab] = useState("waterfall");
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState(null);
  const latestTraceReq = useRef(null);
  const serviceReady = useRef(false);
  const bootGen = useRef(0);
  const lookbackRef = useRef(lookback);
  lookbackRef.current = lookback;

  const toggleTrace = useCallback(async (traceId) => {
    if (expandedId === traceId) {
      setExpandedId(null);
      return;
    }
    setExpandedId(traceId);
    setDetailTab("waterfall");
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

  const loadTracesFor = useCallback(async (serviceName, lookbackValue) => {
    const params = new URLSearchParams({
      service: serviceName,
      limit: "25",
      lookback: lookbackValue,
    });
    const res = await fetch(`/api/health/tracing/traces?${params}`, { credentials: "include" });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.message || `HTTP ${res.status}`);
    }
    const data = await res.json();
    setTraces(data.traces || []);
    setLastUpdated(data.timestamp || new Date().toISOString());
    setError(null);
    setErrorKind(null);
    return data;
  }, []);

  const applyFailure = useCallback((e) => {
    const msg = e?.message || "Failed to load traces";
    if (isTransientFailure(e)) {
      setError("Backend briefly unavailable — retry");
      setErrorKind("transient");
    } else {
      setError(msg);
      setErrorKind("other");
    }
  }, []);

  const bootstrap = useCallback(async () => {
    const gen = ++bootGen.current;
    setLoading(true);
    setError(null);
    setErrorKind(null);
    try {
      const statusRes = await fetch("/api/health/tracing/status", { credentials: "include" });
      if (!statusRes.ok) throw new Error(`HTTP ${statusRes.status}`);
      const statusData = await statusRes.json();
      if (gen !== bootGen.current) return;
      setStatus(statusData);

      const servicesRes = await fetch("/api/health/tracing/services", { credentials: "include" });
      if (!servicesRes.ok) {
        const body = await servicesRes.json().catch(() => ({}));
        throw new Error(body.message || `HTTP ${servicesRes.status}`);
      }
      const servicesData = await servicesRes.json();
      const list = servicesData.services || [];
      if (gen !== bootGen.current) return;
      setServices(list);

      const lb = lookbackRef.current;
      const resolved = await resolveInitialService(list, lb);
      if (gen !== bootGen.current) return;
      setService(resolved.service);
      setSelectionSource(resolved.source === "stored" ? "stored" : "auto");
      serviceReady.current = true;
      await loadTracesFor(resolved.service, lb);
    } catch (e) {
      if (gen !== bootGen.current) return;
      applyFailure(e);
      setTraces([]);
    } finally {
      if (gen === bootGen.current) setLoading(false);
    }
  }, [loadTracesFor, applyFailure]);

  useEffect(() => {
    serviceReady.current = false;
    bootstrap();
    // Mount-only bootstrap; lookback/service changes use dedicated handlers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!serviceReady.current || !service) return undefined;
    const timer = setInterval(() => {
      if (!document.hidden) {
        loadTracesFor(service, lookback).catch(() => {});
      }
    }, REFRESH_MS);
    return () => clearInterval(timer);
  }, [service, lookback, loadTracesFor]);

  const handleServiceChange = async (next) => {
    writeStoredService(next);
    setSelectionSource("manual");
    setService(next);
    setExpandedId(null);
    setLoading(true);
    try {
      await loadTracesFor(next, lookback);
    } catch (e) {
      applyFailure(e);
      setTraces([]);
    } finally {
      setLoading(false);
    }
  };

  const handleLookbackChange = async (next) => {
    setLookback(next);
    if (!serviceReady.current || !service) return;
    setLoading(true);
    try {
      await loadTracesFor(service, next);
    } catch (e) {
      applyFailure(e);
      setTraces([]);
    } finally {
      setLoading(false);
    }
  };

  const handleRetry = () => {
    bootstrap();
  };

  const jaegerUiUrl = status?.jaegerUiUrl || "http://localhost:16686";
  // nginx only defines location /jaeger/ (trailing slash) — a bare /jaeger
  // link 301s through the SPA fallback to an unreachable internal port
  // instead of proxying to Jaeger. Only the plain "open UI" link needs this;
  // traceUrl's /trace/:id suffix already lands inside /jaeger/ either way.
  const jaegerUiRootUrl = jaegerUiUrl.endsWith("/") ? jaegerUiUrl : `${jaegerUiUrl}/`;
  const traceUrl = (traceId) => `${jaegerUiUrl}/trace/${traceId}`;
  const showFullEmpty =
    !loading && !error && traces.length === 0 && (selectionSource === "manual" || selectionSource === "stored");
  const showLightEmpty =
    !loading && !error && traces.length === 0 && selectionSource === "auto";

  return (
    <div className="tracing-page">
      <header className="tracing-header">
        <div>
          <h1>Tracing</h1>
          <p className="tracing-subtitle">
            See how a single request travels across the demo&apos;s services. Generate traffic —
            sign in, use the AI agent, make a transfer — then inspect the call path and latency below.
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
            href={jaegerUiRootUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            Open Jaeger UI
          </a>
          <button type="button" className="tracing-btn" onClick={handleRetry} disabled={loading}>
            Refresh
          </button>
        </div>
      </header>

      <p className="tracing-bridge">
        Traces show where time is spent across services;{" "}
        <a href={TOKEN_CHAIN_HREF}>Token Chain</a> shows the OAuth and MCP token hops for the same
        kinds of demo actions.
      </p>

      <details className="tracing-explainer">
        <summary>What am I looking at?</summary>
        <p>
          Every action in this demo — signing in, an AI agent tool call, a money transfer —
          travels through several cooperating services: the app backend (BFF), the AI agent,
          the MCP gateway, and PingOne for authorization. <strong>Distributed tracing</strong> records
          that journey. Each row below is one <strong>trace</strong> — a single end-to-end request —
          made up of <strong>spans</strong>, the individual steps it took in each service.
          <strong> Jaeger</strong> is the tool that collects these traces so you can see the full call
          path and exactly where time is spent.
        </p>
        <dl className="tracing-glossary">
          <div>
            <dt>Trace</dt>
            <dd>One complete request from start to finish — a single row in the table.</dd>
          </div>
          <div>
            <dt>Span</dt>
            <dd>One step inside a trace: an operation within a single service.</dd>
          </div>
          <div>
            <dt>Service</dt>
            <dd>A component that took part, e.g. demo-api-server, mcp-gateway, authz-server.</dd>
          </div>
          <div>
            <dt>Duration</dt>
            <dd>How long the whole trace took. Click a row to see each span&apos;s timing as a waterfall.</dd>
          </div>
        </dl>
      </details>

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
          <p>{error}</p>
          {errorKind === "transient" && (
            <button type="button" className="tracing-btn" onClick={handleRetry}>
              Retry
            </button>
          )}
          {errorKind !== "transient" && !status?.ok && (
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
            onChange={(e) => handleServiceChange(e.target.value)}
            disabled={!services.length}
            aria-label="Service"
          >
            {services.length ? (
              services.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))
            ) : (
              <option value={service || ""}>{service || "Loading…"}</option>
            )}
          </select>
        </label>
        <label className="tracing-filter">
          <span>Window</span>
          <select
            value={lookback}
            onChange={(e) => handleLookbackChange(e.target.value)}
            aria-label="Window"
          >
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
              <th title="Entry-span name for this request">Operation</th>
              <th title="Unique id for this end-to-end request">Trace ID</th>
              <th title="How many steps (spans) across services">Spans</th>
              <th title="End-to-end time for the whole trace">Duration</th>
              <th title="When the request started">Start</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {loading && !traces.length ? (
              <tr>
                <td colSpan={6} className="tracing-empty">Loading traces…</td>
              </tr>
            ) : showFullEmpty ? (
              <tr>
                <td colSpan={6} className="tracing-empty tracing-empty--explain">
                  <p>
                    No traces for <strong>{service}</strong> in this window.
                  </p>
                  <ul>
                    <li>Try another service — traffic often lands on mcp-gateway or agent-service first.</li>
                    <li>Widen the window above if the action was more than an hour ago.</li>
                    <li>Generate traffic: sign in, use the AI agent, or make a transfer, then refresh.</li>
                  </ul>
                  <p>
                    For the OAuth / MCP token story of those same actions, open{" "}
                    <a href={TOKEN_CHAIN_HREF}>Token Chain</a>.
                  </p>
                </td>
              </tr>
            ) : showLightEmpty ? (
              <tr>
                <td colSpan={6} className="tracing-empty">
                  No traces in this window yet. Sign in, use the AI agent, or make a transfer, then refresh.
                  {" "}
                  <a href={TOKEN_CHAIN_HREF}>Token Chain</a> shows the token hops while you generate traffic.
                </td>
              </tr>
            ) : traces.length === 0 ? (
              <tr>
                <td colSpan={6} className="tracing-empty">No traces to show.</td>
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
                        <div className="tracing-detail-tabs" role="tablist">
                          {[["waterfall", "Waterfall"], ["graph", "Graph"], ["steps", "Steps"]].map(([key, label]) => (
                            <button
                              key={key}
                              type="button"
                              role="tab"
                              aria-selected={detailTab === key}
                              className={`tracing-detail-tab ${detailTab === key ? "tracing-detail-tab--active" : ""}`}
                              onClick={(e) => { e.stopPropagation(); setDetailTab(key); }}
                            >
                              {label}
                            </button>
                          ))}
                        </div>
                        {detailTab === "waterfall" && <TraceDetail loading={detailLoading} error={detailError} detail={detail} />}
                        {detailTab === "graph" && <TraceGraphView traceId={t.traceId} />}
                        {detailTab === "steps" && <ProjectedTimeline traceId={t.traceId} />}
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * Renders the span waterfall for one expanded trace.
 */
function TraceDetail({ loading, error, detail }) {
  if (loading) return <div className="tracing-detail tracing-detail--msg">Loading spans…</div>;
  if (error) return <div className="tracing-detail tracing-detail--msg tracing-detail--error">{error}</div>;
  if (!detail || !detail.spans.length) {
    return <div className="tracing-detail tracing-detail--msg">No spans in this trace.</div>;
  }
  const total = detail.durationMs || 1;
  return (
    <div className="tracing-detail">
      <p className="tracing-detail-legend">
        Each row is a span: <strong>service</strong> · <strong>operation</strong>. The bar shows
        relative time within this trace.
      </p>
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
