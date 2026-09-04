// demo_api_ui/src/pages/TelemetryPage.jsx
import React, { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import "./TelemetryPage.css";
import TraceGraphCore from "../components/TraceGraphCore";
import { getMyAccounts } from "../services/demoAgentService";
import { useThemeOptional } from "../context/ThemeContext";

const REFRESH_MS = 5000;
const DEFAULT_SERVICE = "demo-api-server";
const LOOKBACK_OPTIONS = [
  { value: "15m", label: "Last 15 minutes" },
  { value: "1h", label: "Last hour" },
  { value: "6h", label: "Last 6 hours" },
  { value: "24h", label: "Last 24 hours" },
];

async function fetchJson(url) {
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message || `HTTP ${res.status}`);
  }
  return res.json();
}

/**
 * Telemetry page — Overview (whole system, aggregated across every service's
 * recent traces) or Detailed (one selected trace), both rendered by the same
 * D3 graph core /tracing's Graph tab uses.
 */
export default function TelemetryPage() {
  const navigate = useNavigate();
  const { darkMode, toggleDarkMode } = useThemeOptional();
  const [mode, setMode] = useState("overview");
  const [lookback, setLookback] = useState("1h");
  const [traces, setTraces] = useState([]);
  const [selectedTraceId, setSelectedTraceId] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [tracesError, setTracesError] = useState(null);
  const [overviewRefreshKey, setOverviewRefreshKey] = useState(0);
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState(null);

  const loadTraces = useCallback(async () => {
    try {
      const data = await fetchJson(
        `/api/health/tracing/traces?service=${DEFAULT_SERVICE}&limit=20&lookback=${lookback}`,
      );
      setTraces(data.traces || []);
      setTracesError(null);
      setLastUpdated(new Date());
    } catch (err) {
      setTracesError(err.message || "Failed to load traces");
    }
  }, [lookback]);

  const refreshAll = useCallback(() => {
    loadTraces();
    setOverviewRefreshKey((k) => k + 1);
  }, [loadTraces]);

  useEffect(() => {
    loadTraces();
  }, [loadTraces]);

  useEffect(() => {
    if (mode !== "overview") return undefined;
    const id = setInterval(() => {
      if (!document.hidden) refreshAll();
    }, REFRESH_MS);
    return () => clearInterval(id);
  }, [mode, refreshAll]);

  const generateTraffic = useCallback(async () => {
    setGenerating(true);
    setGenerateError(null);
    try {
      await getMyAccounts();
      refreshAll();
    } catch (err) {
      setGenerateError(err.message || "Failed to generate traffic");
    } finally {
      setGenerating(false);
    }
  }, [refreshAll]);

  const overviewUrl = `/api/health/tracing/overview/raw?lookback=${encodeURIComponent(lookback)}`;
  const detailedUrl = selectedTraceId ? `/api/health/tracing/traces/${selectedTraceId}/raw` : null;

  return (
    <div className="telemetry-page">
      <header className="telemetry-header">
        <div>
          <button type="button" className="telemetry-back-btn" onClick={() => navigate(-1)}>
            ← Back
          </button>
          <h1>Telemetry</h1>
          <p className="telemetry-subtitle">
            The whole system at a glance — every service, every dependency, aggregated across
            recent traffic. Switch to Detailed to inspect one trace.
          </p>
        </div>
        <div className="telemetry-header-actions">
          {generateError && <span className="telemetry-error-inline">{generateError}</span>}
          {lastUpdated && (
            <span className="telemetry-meta">Updated {lastUpdated.toLocaleTimeString()}</span>
          )}
          <button type="button" className="telemetry-btn" onClick={generateTraffic} disabled={generating}>
            {generating ? "Generating…" : "Generate demo traffic"}
          </button>
          <button type="button" className="telemetry-btn" onClick={refreshAll}>Refresh</button>
          <button
            type="button"
            className="telemetry-btn"
            onClick={toggleDarkMode}
            title="Switch this page between light and dark"
            aria-pressed={darkMode}
          >
            {darkMode ? "☀️ Light mode" : "🌙 Dark mode"}
          </button>
        </div>
      </header>

      <div className="telemetry-mode-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={mode === "overview"}
          className={`telemetry-mode-tab ${mode === "overview" ? "telemetry-mode-tab--active" : ""}`}
          onClick={() => setMode("overview")}
        >
          Overview
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === "detailed"}
          className={`telemetry-mode-tab ${mode === "detailed" ? "telemetry-mode-tab--active" : ""}`}
          onClick={() => setMode("detailed")}
        >
          Detailed
        </button>
      </div>

      {mode === "overview" && (
        <>
          <div className="telemetry-filters">
            <label className="telemetry-filter">
              <span>Window</span>
              <select value={lookback} onChange={(e) => setLookback(e.target.value)}>
                {LOOKBACK_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </label>
          </div>
          {tracesError && (
            <div className="tracing-detail tracing-detail--msg tracing-detail--error" role="alert">
              {tracesError}
            </div>
          )}
          <TraceGraphCore rawUrl={overviewUrl} refreshKey={overviewRefreshKey} />
        </>
      )}

      {mode === "detailed" && (
        <>
          <div className="telemetry-trace-picker">
            <span>Trace</span>
            <select
              value={selectedTraceId || ""}
              onChange={(e) => setSelectedTraceId(e.target.value || null)}
            >
              <option value="" disabled>
                {tracesError ? tracesError : traces.length ? "Select a trace…" : "No traces in this window"}
              </option>
              {traces.map((t) => (
                <option key={t.traceId} value={t.traceId}>
                  {t.operation} · {t.spanCount} spans · {t.durationMs}ms · {new Date(t.startTime).toLocaleTimeString()}
                </option>
              ))}
            </select>
          </div>
          {detailedUrl ? (
            <TraceGraphCore rawUrl={detailedUrl} />
          ) : (
            <div className="tracing-detail tracing-detail--msg">Pick a trace above.</div>
          )}
        </>
      )}
    </div>
  );
}
