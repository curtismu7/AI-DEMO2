import React, { useCallback, useEffect, useState } from 'react';
import apiClient from '../services/apiClient';
import DashboardShell from './dashboard/DashboardShell';
import EventStream from './dashboard/EventStream';
import StatStrip from './dashboard/StatStrip';
import './NewRelicDashboard.css';

// The demo's identity pipeline, in the order a request actually travels it.
// Fixed so a stage with no traffic still renders — its absence is the signal.
const STAGES = [
  { key: 'oauth', note: 'sign-in' },
  { key: 'token_exchange', note: 'RFC 8693' },
  { key: 'introspection', note: 'gateway' },
  { key: 'intent_auth', note: 'P1AZ decision' },
  { key: 'mcp', note: 'tool call' },
];

const WINDOWS = ['30m', '1h', '24h', '7d', '14d'];
// 1h, not 24h: pipeline events are far denser than authorize decisions, and a
// 24h default would be slow to render most of the time.
const DEFAULT_WINDOW = '1h';
const POLL_MS = 30000;

const STREAM_COLUMNS = [
  { key: 'time', label: 'Time', className: 'dash-mono' },
  { key: 'category', label: 'Category' },
  { key: 'severity', label: 'Severity' },
  { key: 'message', label: 'Message' },
  { key: 'correlationId', label: 'Correlation', className: 'dash-mono' },
];

function Sparkline({ points }) {
  if (!points.length) return null;
  const max = Math.max(...points.map((p) => p.count), 1);
  const step = points.length > 1 ? 540 / (points.length - 1) : 0;
  const coords = points.map((p, i) => {
    const x = 40 + i * step;
    const y = 140 - (p.count / max) * 102;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  return (
    <svg viewBox="0 0 600 160" className="dash-spark" role="img"
         aria-label={`Event volume, peak ${max} per bucket`}>
      <polyline points={coords.join(' ')} fill="none" stroke="var(--dash-accent)"
                strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      <text x="34" y="44" className="dash-spark-max" textAnchor="end">{max}</text>
    </svg>
  );
}

export default function NewRelicDashboard() {
  const [win, setWin] = useState(DEFAULT_WINDOW);
  const [data, setData] = useState(null);
  const [state, setState] = useState('loading');

  const load = useCallback(async () => {
    try {
      const res = await apiClient.get(`/api/newrelic/pipeline?window=${win}`);
      setData(res.data);
      setState('ready');
    } catch (err) {
      setState(err?.response?.status === 503 ? 'unconfigured' : 'error');
    }
  }, [win]);

  useEffect(() => {
    load();
    const id = setInterval(load, POLL_MS);
    return () => clearInterval(id);
  }, [load]);

  const funnel = data?.funnel || [];
  const counts = {};
  funnel.forEach((r) => { counts[r.category] = r.count; });
  const totalEvents = funnel.reduce((n, r) => n + (r.count || 0), 0);

  const stageItems = STAGES.map((s) => ({
    key: s.key,
    label: s.key,
    value: counts[s.key] || 0,
    note: s.note,
  }));

  // The pipeline strip above only calls out 5 of the ~17 categories New
  // Relic actually facets on. This shows the rest — every category present
  // in the funnel, not just the pipeline stages — so nothing fetched is
  // silently discarded. Keys are prefixed to avoid colliding with the
  // pipeline strip's own stat-<category> testids for categories both panels
  // list (oauth, mcp, intent_auth, …).
  const categoryItems = funnel
    .slice()
    .sort((a, b) => (b.count || 0) - (a.count || 0))
    .map((r) => ({ key: `cat-${r.category}`, label: r.category, value: r.count || 0 }));

  const rows = (data?.stream || []).map((e) => ({
    timestamp: e.timestamp,
    time: e.timestamp ? new Date(e.timestamp).toLocaleTimeString() : '',
    category: e.category ? <span className="dash-chip">{e.category}</span> : '',
    severity: (
      <span className={`nrd-sev nrd-sev-${e.severity || 'info'}`}>
        {e.severity || 'info'}
      </span>
    ),
    message: e.message || '',
    correlationId: e.correlationId || '',
  }));

  const hasNoTraffic = totalEvents === 0 && (data?.stream || []).length === 0;

  return (
    <DashboardShell
      title="New Relic"
      subtitle="Identity pipeline as observed telemetry"
      window={win}
      windows={WINDOWS}
      onWindow={setWin}
      onRefresh={load}
      state={state}
      notConfiguredHint={
        <>New Relic is not configured. Set <code>NR_USER_API_KEY</code> and{' '}
        <code>NR_ACCOUNT_ID</code> in <code>demo_api_server/.env</code>.</>
      }
    >
      <section className="dash-card">
        <div className="dash-card-head">Identity pipeline</div>
        <StatStrip items={stageItems} />
      </section>

      {hasNoTraffic ? (
        <div className="dash-msg" role="status">
          No events in this window. Run a use case to generate traffic.
        </div>
      ) : (
        <>
          <div className="dash-grid-2">
            <section className="dash-card">
              <div className="dash-card-head">Event volume</div>
              <div className="dash-card-body">
                <Sparkline points={data?.timeseries || []} />
              </div>
            </section>

            <section className="dash-card">
              <div className="dash-card-head">By category</div>
              <StatStrip items={categoryItems} />
            </section>
          </div>

          <section className="dash-card">
            <div className="dash-card-head">Recent events</div>
            <EventStream columns={STREAM_COLUMNS} rows={rows} />
          </section>
        </>
      )}
    </DashboardShell>
  );
}
