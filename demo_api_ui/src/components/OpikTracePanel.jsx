import React, { useCallback, useEffect, useState } from 'react';
import './OpikTracePanel.css';
import InlineSpinner from './shared/InlineSpinner';

/**
 * Trace tab of the embedded agent: Opik stats, recent traces and a span
 * waterfall. Data comes from the BFF (/api/agent/opik/*), which proxies the
 * langchain agent — the Opik key never reaches the browser.
 */
const WINDOWS = ['1h', '3h', '12h', '7d'];
const BASE = '/api/agent/opik';

export function fmtMs(ms) {
  if (ms == null || Number.isNaN(Number(ms))) return '—';
  const n = Number(ms);
  return n >= 1000 ? `${(n / 1000).toFixed(1)} s` : `${Math.round(n)} ms`;
}

export function fmtNum(n) {
  return n == null ? '—' : Number(n).toLocaleString();
}

/** Nesting depth of each span, from parent_id links (orphans count as roots). */
export function withDepth(spans) {
  const byId = new Map(spans.map((s) => [s.id, s]));
  const depthOf = (s, guard = 0) => (s.parent_id && byId.has(s.parent_id) && guard < 50
    ? 1 + depthOf(byId.get(s.parent_id), guard + 1)
    : 0);
  return spans.map((s) => ({ ...s, depth: depthOf(s) }));
}

async function getJson(path) {
  const r = await fetch(`${BASE}${path}`, { credentials: 'include' });
  if (r.status === 401 || r.status === 403) throw new Error('Sign in to view traces.');
  if (!r.ok) throw new Error('Opik traces are unavailable right now.');
  return r.json();
}

function Tile({ label, value, sub, tone }) {
  return (
    <div className={`opik-tile${tone ? ` opik-tile--${tone}` : ''}`}>
      <div className="opik-tile__k">{label}</div>
      <div className="opik-tile__v">{value}</div>
      {sub && <div className="opik-tile__d">{sub}</div>}
    </div>
  );
}

function Waterfall({ data }) {
  const total = data.total_ms || 1;
  const spans = withDepth(data.spans);
  return (
    <div className="opik-wf" role="table" aria-label="Span waterfall">
      <div className="opik-wf__axis" aria-hidden="true">
        <div>Span</div>
        <div><span>0</span><span>{fmtMs(total)}</span></div>
        <div />
      </div>
      {spans.map((s) => (
        <div className="opik-wf__row" role="row" key={s.id}>
          <div className="opik-wf__name" style={{ '--d': s.depth }} title={s.model || s.name}>
            <span className="opik-wf__kind">{s.type === 'llm' ? 'LLM' : s.type === 'tool' ? 'TOOL' : 'SPAN'}</span>
            <span>{s.name}</span>
            {s.error && <span className="opik-st opik-st--err">error</span>}
          </div>
          <div className="opik-wf__track">
            <div
              className={`opik-wf__bar opik-wf__bar--${s.type === 'llm' || s.type === 'tool' ? s.type : 'span'}`}
              style={{ '--l': (s.offset_ms / total) * 100, '--w': (s.duration_ms / total) * 100 }}
            />
          </div>
          <div className="opik-wf__ms">{fmtMs(s.duration_ms)}</div>
        </div>
      ))}
    </div>
  );
}

export default function OpikTracePanel() {
  const [windowKey, setWindowKey] = useState('1h');
  const [state, setState] = useState({ status: 'loading' });
  const [selected, setSelected] = useState(null);
  const [spans, setSpans] = useState(null);
  const [spansError, setSpansError] = useState(false);

  const load = useCallback(async () => {
    setState({ status: 'loading' });
    setSelected(null);
    setSpans(null);
    try {
      const [stats, tr] = await Promise.all([
        getJson(`/stats?window=${windowKey}`),
        getJson(`/traces?limit=15&window=${windowKey}`),
      ]);
      if (stats.enabled === false || tr.enabled === false) {
        setState({ status: 'disabled' });
        return;
      }
      setState({ status: 'ready', stats, traces: tr.traces || [] });
      if (tr.traces?.length) setSelected(tr.traces[0].id);
    } catch (err) {
      setState({ status: 'error', message: err.message });
    }
  }, [windowKey]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!selected) return undefined;
    let live = true;
    setSpans(null);
    setSpansError(false);
    getJson(`/traces/${encodeURIComponent(selected)}/spans`)
      .then((d) => { if (live) setSpans(d); })
      .catch(() => { if (live) setSpansError(true); });
    return () => { live = false; };
  }, [selected]);

  const { status, stats, traces } = state;
  const projectUrl = stats?.project_url;

  return (
    <section className="opik-trace" aria-label="Opik trace">
      <div className="opik-head">
        <h3>Opik traces{stats?.project ? <span className="opik-head__proj"> · {stats.project}</span> : null}</h3>
        <div className="opik-range" role="group" aria-label="Time window">
          {WINDOWS.map((w) => (
            <button key={w} type="button" aria-pressed={w === windowKey} onClick={() => setWindowKey(w)}>{w}</button>
          ))}
          <button type="button" onClick={load} aria-label="Refresh traces">Refresh</button>
        </div>
      </div>

      {status === 'loading' && <p className="opik-note"><InlineSpinner label="Loading traces…" /></p>}
      {status === 'disabled' && (
        <p className="opik-note" role="status">
          Opik tracing is not configured. Set <code>OPIK_API_KEY</code> for the langchain agent to see traces here.
        </p>
      )}
      {status === 'error' && (
        <p className="opik-note opik-note--err" role="alert">
          {state.message} <button type="button" className="opik-link" onClick={load}>Retry</button>
        </p>
      )}

      {status === 'ready' && (
        <>
          <div className="opik-tiles">
            <Tile label="Traces" value={fmtNum(stats.traces)} sub={`last ${stats.window}`} />
            <Tile label="Latency p50" value={fmtMs(stats.p50_ms)} sub={`p90 ${fmtMs(stats.p90_ms)}`} />
            <Tile label="Tokens in / trace" value={fmtNum(stats.avg_tokens_in)} />
            <Tile label="Tokens out / trace" value={fmtNum(stats.avg_tokens_out)} />
            <Tile
              label="Error rate"
              value={`${(stats.error_rate * 100).toFixed(1)}%`}
              sub={`${fmtNum(stats.errors)} failed`}
              tone={stats.errors > 0 ? 'bad' : 'good'}
            />
            <Tile label="Tool calls" value={fmtNum(stats.tool_calls)} />
          </div>

          {traces.length === 0 ? (
            <p className="opik-note" role="status">No traces in this window. Send the agent a message, then refresh.</p>
          ) : (
            <div className="opik-split">
              <div className="opik-card">
                <h4>Recent traces</h4>
                <div className="opik-tbl-wrap">
                  <table className="opik-traces">
                    <thead>
                      <tr><th>Started</th><th>Duration</th><th>Tokens</th><th>Spans</th><th>Status</th></tr>
                    </thead>
                    <tbody>
                      {traces.map((t) => (
                        <tr key={t.id} aria-selected={t.id === selected}>
                          <td>
                            <button type="button" className="opik-rowbtn" onClick={() => setSelected(t.id)}>
                              {t.start_time ? new Date(t.start_time).toLocaleTimeString() : '—'}
                            </button>
                          </td>
                          <td>{fmtMs(t.duration_ms)}</td>
                          <td>{fmtNum(t.total_tokens)}</td>
                          <td>{fmtNum(t.span_count)}{t.tool_calls ? ' · tools' : ''}</td>
                          <td>
                            <span className={`opik-st ${t.error ? 'opik-st--err' : 'opik-st--ok'}`}>{t.error ? 'error' : 'ok'}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              <div className="opik-card">
                <h4>
                  Span waterfall
                  <span className="opik-legend">
                    <span><i className="opik-sw opik-sw--llm" />LLM</span>
                    <span><i className="opik-sw opik-sw--tool" />Tool</span>
                    <span><i className="opik-sw opik-sw--span" />Other</span>
                  </span>
                </h4>
                {spansError && <p className="opik-note opik-note--err" role="alert">Could not load spans for this trace.</p>}
                {!spansError && !spans && selected && <p className="opik-note"><InlineSpinner label="Loading spans…" /></p>}
                {spans && spans.spans.length === 0 && <p className="opik-note">This trace has no spans.</p>}
                {spans && spans.spans.length > 0 && <Waterfall data={spans} />}
              </div>
            </div>
          )}

          {projectUrl && (
            <div className="opik-foot">
              <a className="opik-btn" href={projectUrl} target="_blank" rel="noopener noreferrer">Open in Opik</a>
            </div>
          )}
        </>
      )}
    </section>
  );
}
