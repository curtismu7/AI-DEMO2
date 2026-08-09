import React, { useCallback, useEffect, useState } from 'react';
import apiClient from '../services/apiClient';
import { useThemeOptional } from '../context/ThemeContext';
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

const WINDOWS = ['30m', '1h', '24h'];
const POLL_MS = 30000;

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
    <svg viewBox="0 0 600 160" className="nrd-spark" role="img"
         aria-label={`Event volume, peak ${max} per bucket`}>
      <polyline points={coords.join(' ')} fill="none"
                stroke="var(--nrd-accent)" strokeWidth="2"
                strokeLinejoin="round" strokeLinecap="round" />
      <text x="34" y="44" className="nrd-spark-max" textAnchor="end">{max}</text>
    </svg>
  );
}

export default function NewRelicDashboard() {
  const [win, setWin] = useState('1h');
  const [data, setData] = useState(null);
  const [state, setState] = useState('loading'); // loading | ready | unconfigured | error
  const { darkMode, setDarkMode } = useThemeOptional();

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

  const counts = {};
  (data?.funnel || []).forEach((r) => { counts[r.category] = r.count; });
  const peak = Math.max(1, ...STAGES.map((s) => counts[s.key] || 0));
  const totalEvents = (data?.funnel || []).reduce((n, r) => n + (r.count || 0), 0);

  return (
    <div className="nrd">
      <div className="nrd-head">
        <div>
          <h1 className="nrd-title">New Relic</h1>
          <p className="nrd-sub">Identity pipeline as observed telemetry</p>
        </div>
        <span className="nrd-spacer" />

        <div className="nrd-seg" role="group" aria-label="Time window">
          {WINDOWS.map((w) => (
            <button key={w} type="button" onClick={() => setWin(w)}
                    className={w === win ? 'is-on' : ''} aria-pressed={w === win}>
              {w}
            </button>
          ))}
        </div>

        <div className="nrd-theme">
          <span className={darkMode ? '' : 'is-on'}>Light</span>
          <button type="button" className="nrd-switch" role="switch"
                  aria-checked={darkMode} aria-label="Dark mode"
                  title={`Switch to ${darkMode ? 'light' : 'dark'} mode`}
                  onClick={() => setDarkMode(!darkMode)}>
            <span className="nrd-thumb" />
          </button>
          <span className={darkMode ? 'is-on' : ''}>Dark</span>
        </div>

        <button type="button" className="nrd-btn" onClick={load}>Refresh</button>
      </div>

      {state === 'loading' && (
        <div className="nrd-msg" role="status">Loading New Relic data…</div>
      )}

      {state === 'unconfigured' && (
        <div className="nrd-msg" role="status">
          New Relic is not configured. Set <code>NR_USER_API_KEY</code> and{' '}
          <code>NR_ACCOUNT_ID</code> in <code>demo_api_server/.env</code>.
        </div>
      )}

      {state === 'error' && (
        <div className="nrd-msg nrd-msg-err" role="alert">
          Could not load New Relic data. Check the BFF logs for the upstream reason.
        </div>
      )}

      {state === 'ready' && (
        <>
          <section className="nrd-card">
            <div className="nrd-card-head"><span>Identity pipeline</span></div>
            <div className="nrd-pipe">
              {STAGES.map((s) => {
                const n = counts[s.key] || 0;
                return (
                  <div key={s.key} className={`nrd-stage${n === 0 ? ' is-zero' : ''}`}
                       data-testid={`stage-${s.key}`}>
                    <span className="nrd-stage-name">{s.key}</span>
                    <span className="nrd-stage-count">{n}</span>
                    <span className="nrd-stage-note">{s.note}</span>
                    <div className="nrd-stage-bar" style={{ width: `${(n / peak) * 100}%` }} />
                  </div>
                );
              })}
            </div>
          </section>

          {totalEvents === 0 && (data?.stream || []).length === 0 ? (
            <div className="nrd-msg" role="status">
              No events in this window. Run a use case to generate traffic.
            </div>
          ) : (
            <>
              <section className="nrd-card">
                <div className="nrd-card-head"><span>Event volume</span></div>
                <div className="nrd-card-body">
                  <Sparkline points={data?.timeseries || []} />
                </div>
              </section>

              <section className="nrd-card">
                <div className="nrd-card-head"><span>Recent events</span></div>
                <div className="nrd-tbl-wrap">
                  <table className="nrd-tbl">
                    <thead>
                      <tr>
                        <th>Time</th><th>Category</th><th>Severity</th>
                        <th>Message</th><th>Correlation</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(data?.stream || []).map((e, i) => (
                        <tr key={`${e.timestamp}-${i}`}>
                          <td className="nrd-mono">
                            {new Date(e.timestamp).toLocaleTimeString()}
                          </td>
                          <td><span className="nrd-chip">{e.category}</span></td>
                          <td>
                            <span className={`nrd-sev nrd-sev-${e.severity || 'info'}`}>
                              {e.severity || 'info'}
                            </span>
                          </td>
                          <td>{e.message}</td>
                          <td className="nrd-mono">{e.correlationId || ''}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            </>
          )}
        </>
      )}
    </div>
  );
}
