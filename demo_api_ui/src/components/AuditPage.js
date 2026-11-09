import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import JsonHighlight from './shared/JsonHighlight';
import { useThemeOptional } from '../context/ThemeContext';
import './AuditPage.css';
import InlineSpinner from './shared/InlineSpinner';
import { PingPage, SimBanner, PageFrame, Section, Card, StatusChip } from './pingUi';

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
    // Where the status came from: the recorded decision, the call outcome (derived), or nothing at all.
    // 'none' means no decision and no mapped outcome (token_chain events carry no top-level outcome), so nothing
    // was derived and no source is claimed.
    source: d.decision ? 'decision' : status === '—' ? 'none' : 'outcome',
    delegated: !!(ev.agentId || d.exchangedToken),
    denyReason: d.deny_reason || null,
    raw: ev,
  };
}
function toCsv(rows) {
  const head = ['Time', 'User', 'Action', 'Status', 'Status source', 'Scope', 'Group check', 'ACR', 'Delegated', 'Reason'];
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = rows.map((r) => [r.time, r.user, r.action, r.status, r.source === 'none' ? '' : r.source, r.scope,
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

const FOCUSABLE = 'a[href], button:not([disabled]), select:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const MIN_W = 420;
const MIN_H = 300;
const DEFAULT_W = 1200;
const DEFAULT_H = 620;
// Tall enough to show the summary, filters and the first rows without scrolling, but never taller than the screen.
function initialHeight() {
  return Math.max(DEFAULT_H, Math.min(820, window.innerHeight - 64));
}

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
  const { darkMode, toggleDarkMode } = useThemeOptional();
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
    y: Math.max(0, (window.innerHeight - initialHeight()) / 2),
  }));
  const [size, setSize] = useState(() => ({ w: DEFAULT_W, h: initialHeight() }));

  const dragRef = useRef(null);
  const resizeRef = useRef(null);
  const windowRef = useRef(null);

  // The floating window is a modal dialog: move focus into it when it opens and hand it back on close.
  useEffect(() => {
    if (isPopout) return undefined;
    const opener = document.activeElement;
    windowRef.current?.focus({ preventScroll: true });
    return () => {
      if (opener && opener !== document.body && document.contains(opener) && typeof opener.focus === 'function') {
        opener.focus({ preventScroll: true });
      }
    };
  }, [isPopout]);

  // Escape closes the window, and Tab stays inside it (aria-modal promises both). A select that is open handles its
  // own Escape, so that key is left alone when it comes from a select.
  useEffect(() => {
    if (isPopout) return undefined;
    const win = windowRef.current;
    if (!win) return undefined;
    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        if (e.defaultPrevented || e.target.tagName === 'SELECT') return;
        if (onClose) onClose(); else navigate(-1);
        return;
      }
      if (e.key !== 'Tab') return;
      const items = [...win.querySelectorAll(FOCUSABLE)].filter((el) => el.getAttribute('aria-disabled') !== 'true' || el === document.activeElement);
      if (items.length === 0) { e.preventDefault(); win.focus(); return; }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || active === win)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
      else if (!win.contains(active)) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [isPopout, onClose, navigate]);

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

  // P2: the banner comes first in the file and in the window. It says what is real on THIS page. The store is fed
  // by the MCP gateway and by the demo's own server (credential issuance, delegation changes), so it says both.
  const banner = (
    <SimBanner data-testid="audit-banner">
      <strong>Real audit records, nothing simulated here.</strong> The log holds events from the MCP gateway and
      from this demo&apos;s server (credentials issued, delegation changes). Admins see every caller; others see their own.
      {view === 'compliance' && (
        <>
          {' '}
          Where no decision was recorded, the status is derived from the call outcome and marked <em>derived</em>.
        </>
      )}
    </SimBanner>
  );

  // ── Scenario 5: Compliance Report (formal PERMIT/DENY · Scope · Group · ACR) ──
  const complianceRows = useMemo(() => events.map(projectComplianceRow), [events]);
  const complianceSummary = useMemo(() => {
    const s = { total: complianceRows.length, permit: 0, deny: 0, stepup: 0, delegated: 0, derived: 0 };
    for (const r of complianceRows) {
      if (r.status === 'PERMIT') s.permit++;
      else if (r.status === 'DENY') s.deny++;
      else if (r.status === 'STEP-UP') s.stepup++;
      if (r.delegated) s.delegated++;
      if (r.source === 'outcome') s.derived++;
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

  // P9: ONE primary in every view state, and it is Refresh: the only control that fetches data. The exports
  // (Compliance view) and the title-bar icons are secondaries. aria-disabled, not disabled, so keyboard focus
  // stays on the button while a refresh runs.
  const toolbar = (
    <div className="audit-toolbar">
      <button
        type="button"
        className="pu-btn pu-btn--primary"
        aria-disabled={loading || undefined}
        aria-label={loading ? 'Refreshing audit log' : 'Refresh audit log now'}
        onClick={() => { if (!loading) fetchEvents(); }}
      >
        {loading ? 'Refreshing…' : 'Refresh'}
      </button>
      <label className="audit-refresh-control" title="Auto-refresh interval: dial down for a live demo">
        <span>Auto-refresh</span>
        <select
          className="pu-select audit-refresh-select"
          value={refreshMs}
          onChange={(e) => onChangeRefresh(Number(e.target.value))}
          aria-label="Auto-refresh interval"
        >
          {REFRESH_OPTIONS.map((o) => (
            <option key={o.ms} value={o.ms}>{o.ms === 0 ? 'Off' : `Every ${o.label}`}</option>
          ))}
        </select>
      </label>
      {/* A live region, always mounted so a change is announced: the refresh state and the stamp. */}
      <span className="audit-last-updated" role="status" title="Last refreshed">
        {loading ? 'Refreshing…' : lastUpdated ? `Updated ${new Date(lastUpdated).toLocaleTimeString()}` : ''}
      </span>
      {view === 'compliance' && (
        <>
          <button type="button" className="pu-btn" onClick={() => exportCompliance('csv')}>Export CSV</button>
          <button type="button" className="pu-btn" onClick={() => exportCompliance('json')}>Export JSON</button>
        </>
      )}
    </div>
  );

  const errorNote = error ? (
    <div className="audit-page__error" role="alert">
      <StatusChip tone="danger">Error</StatusChip>{' '}
      Failed to load audit log: {error}
      {view === 'events' && (error.includes('401') || error.includes('403')) ? ' — admin access required.' : ''}
    </div>
  ) : null;

  const eventsContent = (
    <>
      {summary && (
        <Section id="audit-summary" kicker="1 · Totals" title="What the log holds">
          <div className="audit-stats">
            <Stat value={summary.totalEvents ?? 0} label="Total events" />
            {Object.entries(summary.byOutcome ?? {}).map(([k, v]) => (
              <Stat key={`o-${k}`} value={v} label={k} tone={OUTCOME_TONE[k] || 'neutral'} />
            ))}
            {Object.entries(summary.byEventType ?? {}).map(([k, v]) => (
              <Stat key={`t-${k}`} value={v} label={k} tone="neutral" />
            ))}
          </div>
        </Section>
      )}
      <Section id="audit-log" kicker={summary ? '2 · Log' : '1 · Log'} title="Events">
        {toolbar}
        <div className="audit-page__filters">
          <select value={filterEventType} onChange={e => setFilterEventType(e.target.value)} className="pu-select audit-filter-select" aria-label="Filter by event type">
            <option value="">All event types</option>
            {EVENT_TYPES.filter(Boolean).map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <select value={filterOutcome} onChange={e => setFilterOutcome(e.target.value)} className="pu-select audit-filter-select" aria-label="Filter by outcome">
            <option value="">All outcomes</option>
            {OUTCOMES.filter(Boolean).map(o => <option key={o} value={o}>{o}</option>)}
          </select>
          <select
            value={filterAgentId}
            onChange={e => setFilterAgentId(e.target.value)}
            className="pu-select audit-filter-select"
            aria-label="Filter by agent ID"
            disabled={agentIdOptions.length === 0}
          >
            <option value="">{agentIdOptions.length ? 'All agents' : 'No agents yet'}</option>
            {agentIdOptions.map((id) => <option key={id} value={id}>{id}</option>)}
          </select>
          <select
            value={filterOperation}
            onChange={e => setFilterOperation(e.target.value)}
            className="pu-select audit-filter-select"
            aria-label="Filter by tool or operation"
            disabled={operationOptions.length === 0}
          >
            <option value="">{operationOptions.length ? 'All tools / operations' : 'No tools yet'}</option>
            {operationOptions.map((op) => <option key={op} value={op}>{op}</option>)}
          </select>
        </div>
        {errorNote}
        {!error && (
          <Card tone="neutral" className="audit-table-card">
            <div className="audit-page__table-wrap">
              <table className="audit-table">
                <thead>
                  <tr>
                    <th>Time</th><th>Event Type</th><th>Agent ID</th><th>User ID</th><th>Tool / Operation</th><th>Outcome</th><th>Duration</th><th>Details</th>
                  </tr>
                </thead>
                <tbody>
                  {loading && <tr><td colSpan={8} className="audit-table__empty"><InlineSpinner label="Loading…" /></td></tr>}
                  {!loading && events.length === 0 && <tr><td colSpan={8} className="audit-table__empty">No audit events found.</td></tr>}
                  {!loading && events.map((ev, i) => {
                    const rowKey = ev.eventId ?? i;
                    const isExpanded = expandedEventId === rowKey;
                    const toggle = () => setExpandedEventId(isExpanded ? null : rowKey);
                    // Special rendering for token_chain events
                    if (ev.eventType === 'token_chain') {
                      const detail = ev.details || {};
                      const userToken = detail.userToken || {};
                      const exchangedToken = detail.exchangedToken;
                      const result = detail.result || {};
                      const scopes = (userToken.scope || []).join(', ') || 'none';
                      return (
                        <React.Fragment key={rowKey}>
                          {/* The whole row is a mouse target; the Details button is the keyboard control. */}
                          <tr
                            className={`audit-row audit-row--${ev.outcome} audit-token-row audit-row--clickable`}
                            onClick={toggle}
                          >
                            <td data-label="Time" className="audit-cell--time">{formatTime(ev.timestamp)}</td>
                            <td data-label="Event type"><StatusChip tone="info">token_chain</StatusChip></td>
                            <td data-label="Agent ID" className="audit-cell--user" title={exchangedToken?.sub || ''}>
                              {exchangedToken
                                ? <>{(exchangedToken.sub || '').substring(0, 15)}{exchangedToken.act ? ' (delegated)' : ''}</>
                                : <span className="audit-no-exchange">Direct</span>}
                            </td>
                            <td data-label="User ID" className="audit-cell--user" title={userToken.sub}>{userToken.sub ? userToken.sub.substring(0, 20) : '—'}</td>
                            <td data-label="Tool / operation">
                              <span className="audit-tool-name">{detail.toolName || '—'}</span>
                              <span className="audit-cell-sub">scopes: {scopes}</span>
                            </td>
                            <td data-label="Outcome"><OutcomeChip outcome={result.success ? 'success' : 'failure'} /></td>
                            <td data-label="Duration" className="audit-cell--duration">{result.duration != null ? `${result.duration}ms` : '—'}</td>
                            <td data-label="Details" className="audit-cell--details">
                              <button
                                type="button"
                                className="audit-details-toggle"
                                aria-expanded={isExpanded}
                                aria-label={`${isExpanded ? 'Hide' : 'Show'} token details: ${detail.toolName || 'token chain'}`}
                                onClick={(e) => { e.stopPropagation(); toggle(); }}
                              >
                                {isExpanded ? '▾ hide' : '▸ show'}
                              </button>
                            </td>
                          </tr>
                          {isExpanded && (
                            <tr className="audit-token-detail-row">
                              <td colSpan={8}>
                                <div className="audit-token-detail">
                                  <div className="audit-token-section">
                                    <h4>User Token</h4>
                                    <pre className="audit-details-pre" tabIndex={0} aria-label="User token JSON"><JsonHighlight value={userToken} /></pre>
                                  </div>
                                  {exchangedToken && (
                                    <div className="audit-token-section">
                                      <h4>Exchanged Token (Delegation)</h4>
                                      <pre className="audit-details-pre" tabIndex={0} aria-label="Exchanged token JSON"><JsonHighlight value={exchangedToken} /></pre>
                                    </div>
                                  )}
                                  <div className="audit-token-section">
                                    <h4>Execution</h4>
                                    <pre className="audit-details-pre" tabIndex={0} aria-label="Execution result JSON"><JsonHighlight value={result} /></pre>
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
                    const detailObj = (ev.details || ev.scope || ev.requestSummary) ? {
                      ...(ev.scope ? { scope: ev.scope } : {}),
                      ...(ev.tokenType ? { tokenType: ev.tokenType } : {}),
                      ...(ev.requestSummary ? { requestSummary: ev.requestSummary } : {}),
                      ...(ev.responseSummary ? { responseSummary: ev.responseSummary } : {}),
                      ...(ev.details ?? {}),
                    } : null;
                    const opName = ev.operation ?? ev.resourceType ?? '—';
                    return (
                      <React.Fragment key={rowKey}>
                      <tr className={`audit-row audit-row--${ev.outcome}${isScopeAlert ? ' audit-row--alert' : ''}`}>
                        <td data-label="Time" className="audit-cell--time">{formatTime(ev.timestamp)}</td>
                        <td data-label="Event type"><StatusChip>{ev.eventType || 'unknown'}</StatusChip></td>
                        <td data-label="Agent ID" className="audit-cell--user" title={ev.agentId ?? ''}>{ev.agentId ? ev.agentId.slice(0, 16) + (ev.agentId.length > 16 ? '…' : '') : '—'}</td>
                        <td data-label="User ID" className="audit-cell--user">{ev.userId ?? '—'}</td>
                        <td data-label="Tool / operation">
                          {opName}
                          {isScopeAlert && (
                            <span
                              className="audit-alert"
                              title={`Agent attempted unauthorized tool — required [${(ev.details.requiredScopes || []).join(', ')}], had [${(ev.details.availableScopes || []).join(', ') || 'none'}]`}
                            >
                              <StatusChip tone="danger">Alert · unauthorized tool</StatusChip>
                            </span>
                          )}
                        </td>
                        <td data-label="Outcome"><OutcomeChip outcome={ev.outcome} /></td>
                        <td data-label="Duration" className="audit-cell--duration">{ev.duration != null ? `${ev.duration}ms` : '—'}</td>
                        <td data-label="Details" className="audit-cell--details">
                          {detailObj ? (
                            <button
                              type="button"
                              className="audit-details-toggle"
                              aria-expanded={isExpanded}
                              aria-label={`${isExpanded ? 'Hide' : 'Show'} details: ${opName}`}
                              onClick={toggle}
                            >
                              {isExpanded ? '▾ hide' : '▸ show'}
                            </button>
                          ) : '—'}
                        </td>
                      </tr>
                      {detailObj && isExpanded && (
                        <tr className="audit-detail-row">
                          <td colSpan={8}>
                            <pre className="audit-json jh-dark" tabIndex={0} aria-label={`Details JSON: ${opName}`}><JsonHighlight value={detailObj} /></pre>
                          </td>
                        </tr>
                      )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </Section>
    </>
  );

  const complianceContent = (
    <>
      <Section id="audit-summary" kicker="1 · Totals" title="Compliance summary">
        <div className="audit-stats">
          <Stat value={complianceSummary.total} label="Total" />
          <Stat value={complianceSummary.permit} label="Permit" tone="ok" />
          <Stat value={complianceSummary.deny} label="Deny" tone="danger" />
          <Stat value={complianceSummary.stepup} label="Step-ups" tone="warn" />
          <Stat value={complianceSummary.derived} label="Derived from outcome" tone="neutral" />
          <Stat value={`${complianceSummary.delegated}/${complianceSummary.total}`} label="Delegation (act)" tone="neutral" />
        </div>
      </Section>
      <Section id="audit-log" kicker="2 · Report" title="Compliance report">
        {toolbar}
        {errorNote}
        {!error && (
          <Card tone="neutral" className="audit-table-card">
            <div className="audit-page__table-wrap">
              <table className="audit-table">
                <thead>
                  <tr><th>Time</th><th>User</th><th>Action</th><th>Status</th><th>Scope</th><th>Group check</th><th>ACR</th></tr>
                </thead>
                <tbody>
                  {loading && <tr><td colSpan={7} className="audit-table__empty"><InlineSpinner label="Loading…" /></td></tr>}
                  {!loading && complianceRows.length === 0 && <tr><td colSpan={7} className="audit-table__empty">No audit events found.</td></tr>}
                  {!loading && complianceRows.map((r, i) => (
                    <tr key={r.eventId ?? i} className={`audit-row audit-row--${r.status === 'PERMIT' ? 'success' : r.status === 'DENY' ? 'failure' : r.status === 'STEP-UP' ? 'partial' : 'unknown'}`}>
                      <td data-label="Time" className="audit-cell--time">{formatTime(r.time)}</td>
                      <td data-label="User" className="audit-cell--user" title={r.agentId ? `agent: ${r.agentId}` : ''}>{r.user}</td>
                      <td data-label="Action">{r.action}</td>
                      <td data-label="Status">
                        {/* A derived status keeps the word and tone of a recorded one, so the text says which it is. */}
                        <StatusChip tone={STATUS_TONE[r.status] || 'neutral'}>{r.status === '—' ? 'Unknown' : r.status}</StatusChip>
                        {r.source === 'outcome' && <span className="audit-cell-sub">derived from outcome</span>}
                        {r.source === 'none' && <span className="audit-cell-sub">no decision or outcome recorded</span>}
                      </td>
                      <td data-label="Scope" className="audit-cell--token">{r.scope}</td>
                      <td data-label="Group check" title={r.denyReason || ''}>
                        {r.groupPass === null
                          ? '—'
                          : <StatusChip tone={r.groupPass ? 'ok' : 'danger'}>{r.groupPass ? `Pass: ${r.group}` : `Fail: ${r.group}`}</StatusChip>}
                      </td>
                      <td data-label="ACR" className="audit-cell--token">{r.acr}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </Section>
    </>
  );

  const auditContent = (
    <PingPage className="audit-pu">
      {banner}
      <PageFrame>
        <div className="audit-view-tabs" role="group" aria-label="Audit view">
          <button type="button" className="audit-view-tab" aria-pressed={view === 'events'} onClick={() => setView('events')}>Events</button>
          <button type="button" className="audit-view-tab" aria-pressed={view === 'compliance'} onClick={() => setView('compliance')}>Compliance Report</button>
        </div>
        {view === 'compliance' ? complianceContent : eventsContent}
      </PageFrame>
    </PingPage>
  );

  const themeToggleButton = (
    <button
      type="button"
      className="audit-float-btn"
      onClick={toggleDarkMode}
      title="Switch this window between light and dark"
      aria-label="Toggle dark mode"
      aria-pressed={darkMode}
    >
      {darkMode ? '☀️' : '🌙'}
    </button>
  );

  // ── Popout mode: plain page layout (OS window handles positioning/sizing) ──
  if (isPopout) {
    return (
      <div className="audit-popout-page">
        <div className="audit-popout-titlebar">
          <span className="audit-float-title">MCP Audit Trail</span>
          <div className="audit-float-titlebar-actions">
            {themeToggleButton}
            <button type="button" className="audit-float-close" onClick={() => window.close()} title="Close" aria-label="Close audit window">
              ✕
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
      ref={windowRef}
      tabIndex={-1}
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
          {themeToggleButton}
          <button type="button" className="audit-float-btn" onClick={openPopout} title="Open in new window (move to any screen)" aria-label="Pop out to new window">
            🪟
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

// Presentational helpers, below the page so the banner is the first markup in the file (P2).
function Stat({ value, label, tone }) {
  return (
    <Card tone={tone} className="audit-stat">
      <span className="audit-stat__value">{value}</span>
      {/* A break opportunity after each underscore, which stays with the word before it (token_chain, banking_operation) keeps long labels in whole words. */}
      <span className="audit-stat__label">
        {String(label).split('_').map((part, i, all) => (i === all.length - 1 ? part : <React.Fragment key={i}>{`${part}_`}<wbr /></React.Fragment>))}
      </span>
    </Card>
  );
}

// The word is what the gateway recorded; the tone only restates it (never a check this page ran).
const OUTCOME_TONE = { success: 'ok', failure: 'danger', partial: 'warn' };
const STATUS_TONE = { PERMIT: 'ok', DENY: 'danger', 'STEP-UP': 'warn' };

function OutcomeChip({ outcome }) {
  return <StatusChip tone={OUTCOME_TONE[outcome] || 'neutral'}>{outcome || 'unknown'}</StatusChip>;
}
