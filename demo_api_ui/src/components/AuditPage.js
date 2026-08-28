import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import JsonHighlight from './shared/JsonHighlight';
import './AuditPage.css';

const EVENT_TYPES = ['', 'tool_call', 'banking_operation', 'authentication', 'authorization', 'session_management', 'token_chain'];
const OUTCOMES = ['', 'success', 'failure', 'partial'];

// ── Scenario 5: Compliance Report projection ──────────────────────────────────
// Project a raw MCP audit event into the compliance columns
// (Time, User, Action, Status, Scope, Group check, ACR). Derives PERMIT/DENY/
// STEP-UP from the explicit decision (preflight authorize events) or the
// transport outcome (gateway tool-call events). Scope/ACR/group come from the
// enriched event details.
function scopeText(d) {
  const s = d.tokenScopes ?? d.userToken?.scope;
  if (Array.isArray(s)) return s.join(' ');
  return s || '';
}
function projectComplianceRow(ev) {
  const d = ev.details || {};
  let status = d.decision
    || (ev.outcome === 'success' ? 'PERMIT'
      : ev.outcome === 'failure' ? 'DENY'
        : ev.outcome === 'partial' ? 'STEP-UP'
          : '—');
  if (status === 'HITL') status = 'STEP-UP';
  // Group check: only meaningful when a group was required for this call.
  let group = '—';
  let groupPass = null;
  if (d.requiredGroup) {
    const inGroup = Array.isArray(d.userGroups) && d.userGroups.includes(d.requiredGroup);
    groupPass = inGroup && d.deny_reason !== 'user_not_in_group';
    group = groupPass ? d.requiredGroup : `not in ${d.requiredGroup}`;
  }
  return {
    eventId: ev.eventId,
    time: ev.timestamp,
    user: ev.userId || '—',
    agentId: ev.agentId || null,
    action: ev.operation || '—',
    status,
    scope: scopeText(d) || '—',
    group,
    groupPass,
    acr: d.acr || '—',
    delegated: !!(ev.agentId || d.exchangedToken),
    denyReason: d.deny_reason || null,
    raw: ev,
  };
}
function toCsv(rows) {
  const head = ['Time', 'User', 'Action', 'Status', 'Scope', 'Group check', 'ACR', 'Delegated', 'Reason'];
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = rows.map((r) => [r.time, r.user, r.action, r.status, r.scope,
    r.groupPass === null ? '' : (r.groupPass ? `pass (${r.group})` : `fail (${r.group})`),
    r.acr, r.delegated ? 'yes' : 'no', r.denyReason || ''].map(esc).join(','));
  return [head.map(esc).join(','), ...lines].join('\n');
}
function downloadBlob(name, type, content) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

const MIN_W = 420;
const MIN_H = 300;
const DEFAULT_W = 1200;
const DEFAULT_H = 620;

// Auto-refresh cadence options. 0 = off. Default is a quiet 5 minutes so the
// window doesn't hammer the gateway when left open; dial it down for a live demo.
const REFRESH_OPTIONS = [
  { label: 'Off', ms: 0 },
  { label: '5s', ms: 5000 },
  { label: '15s', ms: 15000 },
  { label: '30s', ms: 30000 },
  { label: '1m', ms: 60000 },
  { label: '5m', ms: 300000 },
];
const DEFAULT_REFRESH_MS = 300000; // 5 minutes
const REFRESH_STORAGE_KEY = 'auditRefreshMs';

// Restore the persisted cadence; fall back to the default for a missing or
// unrecognised value (guards against a stale/hand-edited localStorage entry).
function loadRefreshMs() {
  try {
    const raw = window.localStorage.getItem(REFRESH_STORAGE_KEY);
    const parsed = raw == null ? DEFAULT_REFRESH_MS : Number(raw);
    return REFRESH_OPTIONS.some((o) => o.ms === parsed) ? parsed : DEFAULT_REFRESH_MS;
  } catch {
    return DEFAULT_REFRESH_MS;
  }
}

// Union `incoming` (falsy values dropped) into the existing option list, sorted.
// Used to grow the Agent-ID / operation filter dropdowns from the values that
// actually appear in the audit events, so the user picks from real data.
function mergeSorted(prev, incoming) {
  const set = new Set(prev);
  for (const v of incoming) if (v) set.add(v);
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}

export default function AuditPage({ onClose } = {}) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const isPopout = searchParams.get('popout') === '1';

  const [events, setEvents] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filterEventType, setFilterEventType] = useState('');
  const [filterOutcome, setFilterOutcome] = useState('');
  const [filterAgentId, setFilterAgentId] = useState(() => searchParams.get('agentId') || '');
  const [filterOperation, setFilterOperation] = useState('');
  const [expandedEventId, setExpandedEventId] = useState(null);
  // Scenario 5 — Events feed vs. formal Compliance Report.
  const [view, setView] = useState('events');
  // Auto-refresh: polling interval in ms (0 = off). Persisted so a demo's chosen
  // cadence survives reloads. lastUpdated stamps the most recent successful fetch.
  const [refreshMs, setRefreshMs] = useState(loadRefreshMs);
  const [lastUpdated, setLastUpdated] = useState(null);
  // Distinct Agent IDs / operations seen this session — populate the filter
  // dropdowns (accumulated so they don't collapse once a filter is applied).
  const [agentIdOptions, setAgentIdOptions] = useState([]);
  const [operationOptions, setOperationOptions] = useState([]);

  // Floating window position + size — centred on first render (not used in popout mode)
  const [pos, setPos] = useState(() => ({
    x: Math.max(0, (window.innerWidth - DEFAULT_W) / 2),
    y: Math.max(0, (window.innerHeight - DEFAULT_H) / 2),
  }));
  const [size, setSize] = useState({ w: DEFAULT_W, h: DEFAULT_H });

  const dragRef = useRef(null);
  const resizeRef = useRef(null);

  useEffect(() => {
    if (isPopout) {
      document.title = 'MCP Audit Trail';
      return;
    }
    const onMove = (e) => {
      if (dragRef.current) {
        const { startX, startY, origX, origY } = dragRef.current;
        setPos({ x: origX + (e.clientX - startX), y: origY + (e.clientY - startY) });
      }
      if (resizeRef.current) {
        const { dir, startX, startY, origX, origY, origW, origH } = resizeRef.current;
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        let nx = origX, ny = origY, nw = origW, nh = origH;
        if (dir.includes('e')) nw = Math.max(MIN_W, origW + dx);
        if (dir.includes('s')) nh = Math.max(MIN_H, origH + dy);
        if (dir.includes('w')) { nw = Math.max(MIN_W, origW - dx); nx = origX + origW - nw; }
        if (dir.includes('n')) { nh = Math.max(MIN_H, origH - dy); ny = origY + origH - nh; }
        setPos({ x: nx, y: ny });
        setSize({ w: nw, h: nh });
      }
    };
    const onUp = () => { dragRef.current = null; resizeRef.current = null; };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, [isPopout]);

  const onTitleBarMouseDown = useCallback((e) => {
    if (isPopout || e.button !== 0) return;
    // Don't start a drag when the mousedown lands on the title-bar action
    // buttons (refresh / popout / close); otherwise a sub-pixel move during
    // the click repositions the window and the button never receives `click`.
    if (e.target.closest('.audit-float-titlebar-actions')) return;
    e.preventDefault();
    dragRef.current = { startX: e.clientX, startY: e.clientY, origX: pos.x, origY: pos.y };
  }, [isPopout, pos]);

  const onResizeMouseDown = (dir) => (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    resizeRef.current = { dir, startX: e.clientX, startY: e.clientY, origX: pos.x, origY: pos.y, origW: size.w, origH: size.h };
  };

  const openPopout = useCallback(() => {
    window.open(
      '/audit?popout=1',
      'mcpAuditTrail',
      `width=${DEFAULT_W},height=${DEFAULT_H},resizable=yes,scrollbars=yes,toolbar=no,menubar=no,location=no`
    );
    // Defer close so browser accepts window.open before navigation changes page state
    setTimeout(() => { if (onClose) onClose(); else navigate(-1); }, 50);
  }, [onClose, navigate]);

  // silent=true → background poll: don't flash the table to its "Loading…"
  // state or disable the manual refresh button; just swap in fresh data.
  const fetchEvents = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (filterEventType) params.set('eventType', filterEventType);
      if (filterOutcome) params.set('outcome', filterOutcome);
      if (filterAgentId) params.set('agentId', filterAgentId);
      if (filterOperation) params.set('operation', filterOperation);
      const paramStr = params.toString();
      const [eventsRes, summaryRes] = await Promise.all([
        fetch(`/api/mcp/audit${paramStr ? '?' + paramStr : ''}`, { credentials: 'include' }),
        fetch('/api/mcp/audit?summary=1', { credentials: 'include' }),
      ]);
      if (!eventsRes.ok) throw new Error(`HTTP ${eventsRes.status}`);
      const [eventsData, summaryData] = await Promise.all([
        eventsRes.json(),
        summaryRes.ok ? summaryRes.json() : null,
      ]);
      const rows = Array.isArray(eventsData) ? eventsData : [];
      setEvents(rows);
      setSummary(summaryData);
      setLastUpdated(Date.now());
      setAgentIdOptions((prev) => mergeSorted(prev, rows.map((ev) => ev.agentId)));
      setOperationOptions((prev) => mergeSorted(prev, rows.map((ev) => ev.operation ?? ev.resourceType)));
    } catch (err) {
      setError(err.message);
    } finally {
      if (!silent) setLoading(false);
    }
  }, [filterEventType, filterOutcome, filterAgentId, filterOperation]);

  useEffect(() => { fetchEvents(); }, [fetchEvents]);

  // Auto-refresh poll. Silent so background refreshes don't disturb the table;
  // resets whenever the cadence or the active filters (via fetchEvents) change.
  useEffect(() => {
    if (refreshMs <= 0) return undefined;
    const id = setInterval(() => { fetchEvents({ silent: true }); }, refreshMs);
    return () => clearInterval(id);
  }, [refreshMs, fetchEvents]);

  const onChangeRefresh = useCallback((ms) => {
    setRefreshMs(ms);
    try { window.localStorage.setItem(REFRESH_STORAGE_KEY, String(ms)); } catch { /* ignore */ }
  }, []);

  function formatTime(ts) {
    if (!ts) return '—';
    return new Date(ts).toLocaleString();
  }

  const eventsContent = (
    <>
      {summary && (
        <div className="audit-page__summary">
          <div className="audit-stat">
            <span className="audit-stat__value">{summary.totalEvents ?? 0}</span>
            <span className="audit-stat__label">Total Events</span>
          </div>
          {Object.entries(summary.byOutcome ?? {}).map(([k, v]) => (
            <div key={k} className={`audit-stat audit-stat--${k}`}>
              <span className="audit-stat__value">{v}</span>
              <span className="audit-stat__label">{k}</span>
            </div>
          ))}
          {Object.entries(summary.byEventType ?? {}).map(([k, v]) => (
            <div key={k} className="audit-stat audit-stat--type">
              <span className="audit-stat__value">{v}</span>
              <span className="audit-stat__label">{k}</span>
            </div>
          ))}
        </div>
      )}
      <div className="audit-page__filters">
        <select value={filterEventType} onChange={e => setFilterEventType(e.target.value)} className="audit-filter-select" aria-label="Filter by event type">
          <option value="">All event types</option>
          {EVENT_TYPES.filter(Boolean).map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <select value={filterOutcome} onChange={e => setFilterOutcome(e.target.value)} className="audit-filter-select" aria-label="Filter by outcome">
          <option value="">All outcomes</option>
          {OUTCOMES.filter(Boolean).map(o => <option key={o} value={o}>{o}</option>)}
        </select>
        <select
          value={filterAgentId}
          onChange={e => setFilterAgentId(e.target.value)}
          className="audit-filter-select"
          aria-label="Filter by agent ID"
          disabled={agentIdOptions.length === 0}
        >
          <option value="">{agentIdOptions.length ? 'All agents' : 'No agents yet'}</option>
          {agentIdOptions.map((id) => <option key={id} value={id}>{id}</option>)}
        </select>
        <select
          value={filterOperation}
          onChange={e => setFilterOperation(e.target.value)}
          className="audit-filter-select"
          aria-label="Filter by tool or operation"
          disabled={operationOptions.length === 0}
        >
          <option value="">{operationOptions.length ? 'All tools / operations' : 'No tools yet'}</option>
          {operationOptions.map((op) => <option key={op} value={op}>{op}</option>)}
        </select>
      </div>
      {error && (
        <div className="audit-page__error">
          Failed to load audit log: {error}
          {(error.includes('401') || error.includes('403')) ? ' — admin access required.' : ''}
        </div>
      )}
      {!error && (
        <div className="audit-page__table-wrap">
          <table className="audit-table">
            <thead>
              <tr>
                <th>Time</th><th>Event Type</th><th>Agent ID</th><th>User ID</th><th>Tool / Operation</th><th>Outcome</th><th>Duration</th><th>Details</th>
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={8} className="audit-table__empty">Loading…</td></tr>}
              {!loading && events.length === 0 && <tr><td colSpan={8} className="audit-table__empty">No audit events found.</td></tr>}
              {!loading && events.map((ev, i) => {
                // Special rendering for token_chain events
                if (ev.eventType === 'token_chain') {
                  const detail = ev.details || {};
                  const userToken = detail.userToken || {};
                  const exchangedToken = detail.exchangedToken;
                  const result = detail.result || {};
                  const isExpanded = expandedEventId === (ev.eventId ?? i);
                  return (
                    <React.Fragment key={ev.eventId ?? i}>
                      <tr
                        className={`audit-row audit-row--${ev.outcome} token-chain-row`}
                        onClick={() => setExpandedEventId(isExpanded ? null : (ev.eventId ?? i))}
                        style={{ cursor: 'pointer' }}
                      >
                        <td className="audit-cell--time">{formatTime(ev.timestamp)}</td>
                        <td className="tool-name">{detail.toolName || '—'}</td>
                        <td className="audit-cell--user" title={userToken.sub}>{userToken.sub ? userToken.sub.substring(0, 20) : '—'}</td>
                        <td className="scopes">{(userToken.scope || []).join(', ') || 'none'}</td>
                        <td className="exchanged-token">
                          {exchangedToken ? (
                            <span title={`Sub: ${exchangedToken.sub || ''}\nScopes: ${(exchangedToken.scope || []).join(', ')}`}>
                              {(exchangedToken.sub || '').substring(0, 15)}{exchangedToken.act ? ' (delegated)' : ''}
                            </span>
                          ) : (
                            <span className="no-exchange">Direct</span>
                          )}
                        </td>
                        <td><span className={`audit-badge audit-badge--outcome audit-badge--outcome--${result.success ? 'success' : 'failure'}`}>{result.success ? '✓ Success' : '✗ Failed'}</span></td>
                        <td className="audit-cell--duration">{result.duration != null ? `${result.duration}ms` : '—'}</td>
                        <td className="audit-cell--details">{isExpanded ? '▾' : '▸'}</td>
                      </tr>
                      {isExpanded && (
                        <tr className="token-chain-detail-row">
                          <td colSpan={8}>
                            <div className="token-detail">
                              <div className="token-section">
                                <h4>User Token</h4>
                                <pre className="audit-details-pre"><JsonHighlight value={userToken} /></pre>
                              </div>
                              {exchangedToken && (
                                <div className="token-section">
                                  <h4>Exchanged Token (Delegation)</h4>
                                  <pre className="audit-details-pre"><JsonHighlight value={exchangedToken} /></pre>
                                </div>
                              )}
                              <div className="token-section">
                                <h4>Execution</h4>
                                <pre className="audit-details-pre"><JsonHighlight value={result} /></pre>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                }

                // Default rendering for other event types
                // Scenario 4 — an insufficient-scope denial is flagged as an
                // "unauthorized tool attempt" alert (details.alert from the gateway audit).
                const isScopeAlert = ev?.details?.alert === true && ev?.details?.reason === 'insufficient_scope';
                const rowKey = ev.eventId ?? i;
                const detailObj = (ev.details || ev.scope || ev.requestSummary) ? {
                  ...(ev.scope ? { scope: ev.scope } : {}),
                  ...(ev.tokenType ? { tokenType: ev.tokenType } : {}),
                  ...(ev.requestSummary ? { requestSummary: ev.requestSummary } : {}),
                  ...(ev.responseSummary ? { responseSummary: ev.responseSummary } : {}),
                  ...(ev.details ?? {}),
                } : null;
                const isExpanded = expandedEventId === rowKey;
                return (
                  <React.Fragment key={rowKey}>
                  <tr className={`audit-row audit-row--${ev.outcome}${isScopeAlert ? ' audit-row--alert' : ''}`}>
                    <td className="audit-cell--time">{formatTime(ev.timestamp)}</td>
                    <td><span className="audit-badge audit-badge--type">{ev.eventType}</span></td>
                    <td className="audit-cell--user" title={ev.agentId ?? ''}>{ev.agentId ? ev.agentId.slice(0, 16) + (ev.agentId.length > 16 ? '…' : '') : '—'}</td>
                    <td className="audit-cell--user">{ev.userId ?? '—'}</td>
                    <td>
                      {ev.operation ?? ev.resourceType ?? '—'}
                      {isScopeAlert && (
                        <span
                          className="audit-badge audit-badge--alert"
                          title={`Agent attempted unauthorized tool — required [${(ev.details.requiredScopes || []).join(', ')}], had [${(ev.details.availableScopes || []).join(', ') || 'none'}]`}
                        >
                          ALERT · unauthorized tool
                        </span>
                      )}
                    </td>
                    <td><span className={`audit-badge audit-badge--outcome audit-badge--outcome--${ev.outcome}`}>{ev.outcome}</span></td>
                    <td className="audit-cell--duration">{ev.duration != null ? `${ev.duration}ms` : '—'}</td>
                    <td className="audit-cell--details">
                      {detailObj ? (
                        <button
                          type="button"
                          className="audit-details-toggle"
                          aria-expanded={isExpanded}
                          onClick={() => setExpandedEventId(isExpanded ? null : rowKey)}
                        >
                          {isExpanded ? '▾ hide' : '▸ show'}
                        </button>
                      ) : '—'}
                    </td>
                  </tr>
                  {detailObj && isExpanded && (
                    <tr className="audit-detail-row">
                      <td colSpan={8}>
                        <pre className="audit-json jh-dark"><JsonHighlight value={detailObj} /></pre>
                      </td>
                    </tr>
                  )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );

  // ── Scenario 5: Compliance Report (formal PERMIT/DENY · Scope · Group · ACR) ──
  const complianceRows = useMemo(() => events.map(projectComplianceRow), [events]);
  const complianceSummary = useMemo(() => {
    const s = { total: complianceRows.length, permit: 0, deny: 0, stepup: 0, delegated: 0 };
    for (const r of complianceRows) {
      if (r.status === 'PERMIT') s.permit++;
      else if (r.status === 'DENY') s.deny++;
      else if (r.status === 'STEP-UP') s.stepup++;
      if (r.delegated) s.delegated++;
    }
    return s;
  }, [complianceRows]);
  const exportCompliance = (fmt) => {
    const stamp = new Date().toISOString().slice(0, 10);
    if (fmt === 'csv') {
      downloadBlob(`compliance_report_${stamp}.csv`, 'text/csv', toCsv(complianceRows));
    } else {
      // eslint-disable-next-line no-unused-vars
      const clean = complianceRows.map(({ raw, ...r }) => r);
      downloadBlob(`compliance_report_${stamp}.json`, 'application/json', JSON.stringify(clean, null, 2));
    }
  };

  const complianceContent = (
    <>
      <div className="audit-page__summary">
        <div className="audit-stat"><span className="audit-stat__value">{complianceSummary.total}</span><span className="audit-stat__label">Total</span></div>
        <div className="audit-stat audit-stat--success"><span className="audit-stat__value">{complianceSummary.permit}</span><span className="audit-stat__label">Permit</span></div>
        <div className="audit-stat audit-stat--failure"><span className="audit-stat__value">{complianceSummary.deny}</span><span className="audit-stat__label">Deny</span></div>
        <div className="audit-stat audit-stat--partial"><span className="audit-stat__value">{complianceSummary.stepup}</span><span className="audit-stat__label">Step-ups</span></div>
        <div className="audit-stat audit-stat--type"><span className="audit-stat__value">{complianceSummary.delegated}/{complianceSummary.total}</span><span className="audit-stat__label">Delegation (act)</span></div>
      </div>
      <div className="audit-page__filters">
        <button type="button" className="audit-export-btn" onClick={() => exportCompliance('csv')}>Export CSV</button>
        <button type="button" className="audit-export-btn" onClick={() => exportCompliance('json')}>Export JSON</button>
      </div>
      {error && <div className="audit-page__error">Failed to load audit log: {error}</div>}
      {!error && (
        <div className="audit-page__table-wrap">
          <table className="audit-table">
            <thead>
              <tr><th>Time</th><th>User</th><th>Action</th><th>Status</th><th>Scope</th><th>Group check</th><th>ACR</th></tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={7} className="audit-table__empty">Loading…</td></tr>}
              {!loading && complianceRows.length === 0 && <tr><td colSpan={7} className="audit-table__empty">No audit events found.</td></tr>}
              {!loading && complianceRows.map((r, i) => (
                <tr key={r.eventId ?? i} className={`audit-row audit-row--${r.status === 'PERMIT' ? 'success' : r.status === 'DENY' ? 'failure' : 'partial'}`}>
                  <td className="audit-cell--time">{formatTime(r.time)}</td>
                  <td className="audit-cell--user" title={r.agentId ? `agent: ${r.agentId}` : ''}>{r.user}</td>
                  <td>{r.action}</td>
                  <td><span className={`audit-badge audit-badge--status--${r.status === 'PERMIT' ? 'permit' : r.status === 'DENY' ? 'deny' : 'stepup'}`}>{r.status}</span></td>
                  <td className="scopes">{r.scope}</td>
                  <td title={r.denyReason || ''}>
                    {r.groupPass === null
                      ? '—'
                      : <span className={r.groupPass ? 'audit-group--pass' : 'audit-group--fail'}>{r.groupPass ? `✓ ${r.group}` : `✗ ${r.group}`}</span>}
                  </td>
                  <td>{r.acr}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );

  const auditContent = (
    <>
      <div className="audit-view-tabs">
        <button type="button" className={`audit-view-tab${view === 'events' ? ' active' : ''}`} onClick={() => setView('events')}>Events</button>
        <button type="button" className={`audit-view-tab${view === 'compliance' ? ' active' : ''}`} onClick={() => setView('compliance')}>Compliance Report</button>
      </div>
      {view === 'compliance' ? complianceContent : eventsContent}
    </>
  );

  // Shared titlebar controls: auto-refresh cadence picker + last-refreshed stamp.
  const refreshControl = (
    <label className="audit-refresh-control" title="Auto-refresh interval — dial down for a live demo">
      <span className="audit-refresh-control__icon" aria-hidden="true">⟳</span>
      <select
        className="audit-refresh-select"
        value={refreshMs}
        onChange={(e) => onChangeRefresh(Number(e.target.value))}
        aria-label="Auto-refresh interval"
      >
        {REFRESH_OPTIONS.map((o) => (
          <option key={o.ms} value={o.ms}>{o.ms === 0 ? 'Off' : `Every ${o.label}`}</option>
        ))}
      </select>
    </label>
  );
  const lastUpdatedLabel = lastUpdated ? (
    <span className="audit-last-updated" title="Last refreshed">
      {new Date(lastUpdated).toLocaleTimeString()}
    </span>
  ) : null;

  // ── Popout mode: plain page layout (OS window handles positioning/sizing) ──
  if (isPopout) {
    return (
      <div className="audit-popout-page">
        <div className="audit-popout-titlebar">
          <span className="audit-float-title">MCP Audit Trail</span>
          <div className="audit-float-titlebar-actions">
            {lastUpdatedLabel}
            {refreshControl}
            <button type="button" className="audit-float-btn" onClick={() => fetchEvents()} disabled={loading} title="Refresh now" aria-label="Refresh now">
              {loading ? '…' : '↻'}
            </button>
          </div>
        </div>
        <div className="audit-popout-content">{auditContent}</div>
      </div>
    );
  }

  // ── Floating window mode (within-browser, draggable + resizable) ──
  return (
    <div
      className="audit-float-window"
      style={{ left: pos.x, top: pos.y, width: size.w, height: size.h }}
      role="dialog"
      aria-modal="true"
      aria-label="MCP Audit Trail"
    >
      {['n','ne','e','se','s','sw','w','nw'].map(dir => (
        <div key={dir} className={`audit-resize-handle audit-resize-${dir}`} onMouseDown={onResizeMouseDown(dir)} />
      ))}
      <div className="audit-float-titlebar" onMouseDown={onTitleBarMouseDown}>
        <span className="audit-float-title">MCP Audit Trail</span>
        <div className="audit-float-titlebar-actions">
          {lastUpdatedLabel}
          {refreshControl}
          <button type="button" className="audit-float-btn" onClick={() => fetchEvents()} disabled={loading} title="Refresh now" aria-label="Refresh audit log now">
            {loading ? '…' : '↻'}
          </button>
          <button type="button" className="audit-float-btn" onClick={openPopout} title="Open in new window (move to any screen)" aria-label="Pop out to new window">
            ⧉
          </button>
          <button type="button" className="audit-float-close" onClick={() => onClose ? onClose() : navigate(-1)} title="Close" aria-label="Close audit log">
            ×
          </button>
        </div>
      </div>
      <div className="audit-float-content">{auditContent}</div>
    </div>
  );
}
