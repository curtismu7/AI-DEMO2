import React, { useEffect, useState } from "react";
import apiClient from "../../services/apiClient";

// Illustrative fallback — loading state AND error-state fallback (never a
// blank screen). Also what non-vertical reserved routes render as, since
// those aren't returned by /api/verticals/list.
const VERTICALS = [
  { name: "Super Banking", level: "user" },
  { name: "Super Sports", level: "user" },
  { name: "Abercrombie & Fitch", level: "user" },
  { name: "United Airlines", level: "user" },
  { name: "CivicPermit", level: "user" },
  { name: "CareConnect", level: "user" },
  { name: "Meridian Wealth", level: "user" },
  { name: "Precision Works", level: "user" },
  { name: "Great Buy", level: "user" },
  { name: "Super University", level: "user" },
  { name: "WX Workforce", level: "user" },
];

const RESERVED_ROUTES = [
  { name: "OAuth Academy", level: "public" },
  { name: "Admin Portal", level: "admin" },
  { name: "Admin Console", level: "admin" },
  { name: "PingOne Admin", level: "admin" },
];

/** Most common `auth` level across a vertical's use cases; 'user' when unknown. */
function modeAuthLevel(useCases) {
  if (!Array.isArray(useCases) || useCases.length === 0) return "user";
  const counts = {};
  for (const uc of useCases) {
    const lvl = uc.auth || "user";
    counts[lvl] = (counts[lvl] || 0) + 1;
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
}

function formatMs(seconds) {
  if (typeof seconds !== "number" || !Number.isFinite(seconds)) return "—";
  return `${Math.round(seconds * 1000)} ms`;
}

export default function VerticalsSection() {
  const [verticals, setVerticals] = useState(null); // null = loading
  const [verticalsError, setVerticalsError] = useState(false);
  const [metrics, setMetrics] = useState(null); // null = loading, false = fetch failed
  const [metricsError, setMetricsError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const { data: list } = await apiClient.get("/api/verticals/list");
        const withLevels = await Promise.all(
          (Array.isArray(list) ? list : []).map(async (v) => {
            try {
              const { data } = await apiClient.get(
                `/api/use-cases?vertical=${encodeURIComponent(v.id)}`
              );
              return { name: v.displayName || v.id, level: modeAuthLevel(data.useCases) };
            } catch {
              return { name: v.displayName || v.id, level: "user" };
            }
          })
        );
        if (!cancelled) setVerticals(withLevels);
      } catch {
        if (!cancelled) setVerticalsError(true);
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    apiClient
      .get("/api/health/gateway-metrics")
      .then(({ data }) => { if (!cancelled) setMetrics(data); })
      .catch(() => { if (!cancelled) setMetricsError(true); });
    return () => { cancelled = true; };
  }, []);

  const verticalRows = verticalsError || !verticals ? VERTICALS : verticals;

  const totalCalls = metrics?.methods?.reduce((sum, m) => sum + (m.count || 0), 0) || 0;
  const totalSeconds = metrics?.methods?.reduce((sum, m) => sum + (m.totalSeconds || 0), 0) || 0;
  const totalErrors = metrics?.errors?.reduce((sum, e) => sum + (e.count || 0), 0) || 0;
  const meanLatency = totalCalls > 0 ? totalSeconds / totalCalls : null;

  return (
    <div>
      <p className="aac-section-intro">
        Auth level, per verticals and reserved routes.
      </p>

      <div className="aac-legend">
        <span className="aac-legend-item"><span className="aac-badge aac-badge--user">user</span> default — requires signed-in session</span>
        <span className="aac-legend-item"><span className="aac-badge aac-badge--public">public</span> no session — weather, guest chat, Learning Hub UC-LEARN1-9, PAM setup/script</span>
        <span className="aac-legend-item"><span className="aac-badge aac-badge--admin">admin</span> Admin Portal/Console use cases ADMIN1-13, plus UC-NHI2</span>
      </div>

      <div className="aac-vertical-grid">
        {verticalRows.map((v) => (
          <div key={v.name} className="aac-vertical-tile">
            <span>{v.name}</span>
            <span className={`aac-badge aac-badge--${v.level}`}>{v.level}</span>
          </div>
        ))}
      </div>
      {verticalsError && (
        <p className="aac-card-sub" style={{ marginTop: 8 }}>
          Live vertical/auth-level data unavailable — showing defaults.
        </p>
      )}

      <div className="aac-section-block" style={{ marginTop: 20 }}>
        <h3>Reserved routes</h3>
        <p className="aac-card-sub" style={{ marginBottom: 8 }}>
          Fixed app routes, not verticals — not fetched live, but not mock data either.
        </p>
        <div className="aac-vertical-grid">
          {RESERVED_ROUTES.map((v) => (
            <div key={v.name} className="aac-vertical-tile">
              <span>{v.name}</span>
              <span className={`aac-badge aac-badge--${v.level}`}>{v.level}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="aac-section-block">
        <h3>Monitoring <span className="aac-badge aac-badge--live">Live</span></h3>
        {metrics?.available ? (
          <div className="aac-stat-grid">
            <div className="aac-stat-tile">
              <div className="aac-stat-value">{totalCalls}</div>
              <div className="aac-stat-label">MCP calls observed</div>
              <div className="aac-stat-detail">PingGateway admin connector</div>
            </div>
            <div className="aac-stat-tile">
              <div className="aac-stat-value">{formatMs(meanLatency)}</div>
              <div className="aac-stat-label">Mean latency</div>
            </div>
            <div className="aac-stat-tile">
              <div className="aac-stat-value">{totalErrors}</div>
              <div className="aac-stat-label">Errors (floor, see note)</div>
            </div>
          </div>
        ) : (
          <div className="aac-card">
            <div className="aac-card-body">
              {metricsError || metrics?.available === false
                ? (metrics?.reason || "PingGateway admin connector not reachable in this environment.")
                : "Loading…"}
            </div>
          </div>
        )}
        <div className="aac-card" style={{ marginTop: 12 }}>
          <div className="aac-card-body">
            Grafana / Prometheus / Jaeger, source <code>monitoring/</code>, scraping
            PingGateway's admin connector. Alert rules evaluate but there is no
            Alertmanager to route them to.
          </div>
        </div>
      </div>
    </div>
  );
}
