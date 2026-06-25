// banking_api_ui/src/components/ApiTrafficPanel.js
import React, { useState, useEffect } from 'react';
import { subscribe, getAll } from '../services/apiTrafficStore';
import JsonHighlight from './shared/JsonHighlight';
import './ApiTrafficPanel.css';

const FILTERS = ['All', 'MCP', 'Token', 'HTTP', 'Errors'];

// ── RFC Claim Annotations ────────────────────────────────────────────────────

/**
 * Per-claim RFC footnotes. Used by ClaimsTable to annotate each JWT / introspection claim
 * with its standard definition and RFC section.
 */
const RFC_NOTES = {
  sub:       { ref: 'RFC 7519 §4.1.2', what: 'Subject — unique identifier for the authenticated user' },
  iss:       { ref: 'RFC 7519 §4.1.1', what: 'Issuer — the PingOne token endpoint that signed this token' },
  aud:       { ref: 'RFC 7519 §4.1.3', what: 'Audience — the intended recipient(s) of this token; must match the resource server' },
  exp:       { ref: 'RFC 7519 §4.1.4', what: 'Expiration — Unix timestamp after which the token MUST be rejected' },
  iat:       { ref: 'RFC 7519 §4.1.6', what: 'Issued At — when PingOne generated and signed this token' },
  nbf:       { ref: 'RFC 7519 §4.1.5', what: 'Not Before — token is invalid before this Unix timestamp' },
  jti:       { ref: 'RFC 7519 §4.1.7', what: 'JWT ID — unique identifier; use for replay-attack prevention' },
  scope:     { ref: 'RFC 9068 §2.2 · RFC 8693 §4.2', what: 'Granted OAuth 2.0 scopes — space-separated permissions the client may exercise' },
  client_id: { ref: 'RFC 9068 §2.2', what: 'Client ID — the OAuth 2.0 client that requested this token' },
  act:       { ref: 'RFC 8693 §4.4',  what: 'Authorized Actor — identifies who is currently acting on behalf of the subject (delegation)' },
  may_act:   { ref: 'RFC 8693 §4.4.3 (draft)', what: 'May Act — identifies who is authorized to obtain a token acting on behalf of this subject' },
  azp:       { ref: 'OIDC Core §2',   what: 'Authorized Party — the client ID the token was issued to (when aud is multi-valued)' },
  acr:       { ref: 'OIDC Core §2',   what: 'Authentication Context Class Reference — strength of the user\u2019s authentication' },
  auth_time: { ref: 'OIDC Core §2',   what: 'Auth Time — Unix timestamp when the end-user\'s authentication took place' },
  active:    { ref: 'RFC 7662 §2.2',  what: 'Active — Boolean; true means the token is currently valid at the introspection endpoint' },
};

/**
 * RFC-annotated claims table. Collapsed by default; click a row to see the RFC footnote.
 * @param {{ claims: object|null }} props
 */
function ClaimsTable({ claims }) {
  const [expandedKey, setExpandedKey] = useState(null);

  if (!claims || typeof claims !== 'object') {
    return <p className="api-claims-empty">No claims available.</p>;
  }

  const entries = Object.entries(claims);
  if (entries.length === 0) {
    return <p className="api-claims-empty">No claims available.</p>;
  }

  return (
    <table className="api-claims-table" aria-label="JWT / introspection claims">
      <thead>
        <tr>
          <th className="api-claims-th api-claims-th--claim">Claim</th>
          <th className="api-claims-th api-claims-th--value">Value</th>
          <th className="api-claims-th api-claims-th--rfc">Standard</th>
        </tr>
      </thead>
      <tbody>
        {entries.map(([k, v]) => {
          const note = RFC_NOTES[k];
          const isExpanded = expandedKey === k;
          const displayVal = typeof v === 'object'
            ? JSON.stringify(v)
            : String(v);
          return (
            <React.Fragment key={k}>
              <tr
                className={`api-claims-row${note ? ' api-claims-row--annotated' : ''}`}
                onClick={() => note && setExpandedKey(isExpanded ? null : k)}
                aria-expanded={note ? isExpanded : undefined}
                tabIndex={note ? 0 : undefined}
                onKeyDown={note ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpandedKey(isExpanded ? null : k); } } : undefined}
              >
                <td className="api-claims-td api-claims-td--claim">
                  <code>{k}</code>
                  {note && <span className="api-claims-expand-icon" aria-hidden="true">{isExpanded ? ' ▲' : ' ▼'}</span>}
                </td>
                <td className="api-claims-td api-claims-td--value">
                  <span className="api-claims-val">{displayVal}</span>
                </td>
                <td className="api-claims-td api-claims-td--rfc">
                  {note ? <span className="api-claims-rfc-ref">{note.ref}</span> : null}
                </td>
              </tr>
              {note && isExpanded && (
                <tr className="api-claims-row api-claims-row--note">
                  <td colSpan={3} className="api-claims-td api-claims-td--note">
                    <span className="api-claims-note-icon">📋</span> {note.what}
                  </td>
                </tr>
              )}
            </React.Fragment>
          );
        })}
      </tbody>
    </table>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Syntax-highlight a JSON value (light theme) using the shared viewer. */
function JsonView({ value }) {
  return <pre className="api-json"><JsonHighlight value={value} /></pre>;
}

/** Absolute URL for same-origin /api paths (shown in traffic detail). */
function absoluteApiUrl(relativePath) {
  if (typeof window === 'undefined' || !relativePath) return relativePath || '';
  const path = relativePath.startsWith('/') ? relativePath : `/${relativePath}`;
  return `${window.location.origin}${path}`;
}

/** Single JSON snapshot: full request + response for debugging. */
function buildHttpExchangeSnapshot(entry) {
  const fullUrl = absoluteApiUrl(entry.url);
  return {
    request: {
      method: (entry.method || 'GET').toUpperCase(),
      path: entry.url,
      fullUrl,
      headers: entry.requestHeaders || {},
      body: entry.requestBody ?? null,
    },
    response: {
      status: entry.status,
      headers: entry.responseHeaders || {},
      body: entry.responseBody ?? null,
      error: entry.error || null,
    },
    meta: {
      durationMs: entry.duration,
      timestamp: entry.timestamp,
      source: entry.source,
    },
  };
}

function HeadersView({ headers }) {
  if (!headers || !Object.keys(headers).length)
    return <p className="api-detail-muted">No headers captured.</p>;
  return (
    <div className="api-detail-kv">
      {Object.entries(headers).map(([k, v]) => (
        <React.Fragment key={k}>
          <span className="api-detail-kv-key">{k}</span>
          <span className="api-detail-kv-val">{String(v)}</span>
        </React.Fragment>
      ))}
    </div>
  );
}

function StatusBadge({ entry }) {
  if (entry.kind === 'token-event') {
    const s = entry.eventStatus || 'active';
    const cls = { failed: 'err', skipped: 'skip' }[s] || 'tok';
    return <span className={`api-status-badge api-status-badge--${cls}`}>{s}</span>;
  }
  const { status } = entry;
  if (!status) return <span className="api-status-badge api-status-badge--net">net</span>;
  const cls = status >= 200 && status < 400 ? 'ok' : status === 0 ? 'net' : 'err';
  return <span className={`api-status-badge api-status-badge--${cls}`}>{status}</span>;
}

function MethodBadge({ entry }) {
  if (entry.kind === 'token-event') {
    const icons = {
      'user-token':               { label: 'User token', cls: 'TOKEN-USER' },
      'user-token-introspection': { label: 'Introspect', cls: 'TOKEN-INTRO' },
      'agent-actor-token':        { label: 'Agent token', cls: 'TOKEN-AGENT' },
      'exchange-in-progress':     { label: 'Exchange', cls: 'TOKEN-XCHG' },
      'on-behalf-of-warning':     { label: 'Agent?', cls: 'TOKEN-SKIP' },
      'exchanged-token':          { label: 'MCP token', cls: 'TOKEN-MCP' },
      'exchanged-token-verified':        { label: 'JWKS ✓', cls: 'TOKEN-VERIFY' },
      'agent-actor-token-verified':      { label: 'JWKS ✓', cls: 'TOKEN-VERIFY' },
      'two-ex-agent-actor-verified':     { label: 'JWKS ✓', cls: 'TOKEN-VERIFY' },
      'two-ex-exchange1-verified':       { label: 'JWKS ✓', cls: 'TOKEN-VERIFY' },
      'two-ex-mcp-actor-verified':       { label: 'JWKS ✓', cls: 'TOKEN-VERIFY' },
      'two-ex-final-token-verified':     { label: 'JWKS ✓', cls: 'TOKEN-VERIFY' },
      'gw-introspection':         { label: 'GW INTROSPECT', cls: 'TOKEN-VERIFY' },
      'gw-authorize':             { label: 'GW AUTHZ', cls: 'TOKEN-XCHG' },
      'gw-exchange':              { label: 'GW EXCHANGE', cls: 'TOKEN-XCHG' },
      'exchange':                 { label: 'Pending', cls: 'TOKEN-XCHG' },
      'exchange-required':        { label: 'RFC 8693', cls: 'TOKEN-FAIL' },
      'user-scopes-insufficient': { label: 'Scopes', cls: 'TOKEN-FAIL' },
      'exchange-failed':          { label: 'Exchange', cls: 'TOKEN-FAIL' },
      'agent-scope-denied':       { label: 'Policy', cls: 'TOKEN-FAIL' },
      'mcp-token-reused':         { label: 'MCP token', cls: 'TOKEN-MCP' },
    };
    const { label, cls, title } = icons[entry.eventId] || { label: 'Token', cls: 'TOKEN-USER', title: '' };
    return (
      <span className={`api-method-badge api-method-badge--${cls}`} title={title || label}>
        {label}
      </span>
    );
  }
  if (entry.url === '/api/mcp/tool' || entry.source === 'mcp') {
    return <span className="api-method-badge api-method-badge--MCP">MCP</span>;
  }
  const m = (entry.method || 'GET').toUpperCase();
  const cls = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(m) ? m : 'GET';
  return <span className={`api-method-badge api-method-badge--${cls}`}>{m}</span>;
}

function entryLabel(entry) {
  if (entry.kind === 'token-event') return entry.url;
  if (entry.url === '/api/mcp/tool' && entry.requestBody?.tool)
    return `/api/mcp/tool → ${entry.requestBody.tool}`;
  return entry.url;
}

function matchFilter(entry, filter, search) {
  if (search) {
    const q = search.toLowerCase();
    if (!entryLabel(entry).toLowerCase().includes(q)) return false;
  }
  if (filter === 'MCP')
    return entry.url === '/api/mcp/tool' || entry.kind === 'token-event';
  if (filter === 'Token')
    return entry.kind === 'token-event';
  if (filter === 'HTTP')
    return entry.kind !== 'token-event';
  if (filter === 'Errors')
    return !!entry.error || entry.status >= 400 || entry.status === 0 ||
      entry.eventStatus === 'failed';
  return true;
}

// ── Token Event Detail ────────────────────────────────────────────────────────

function TokenEventDetail({ entry }) {
  const [tab, setTab] = useState('summary');
  const tabs = [
    { id: 'summary', label: 'Summary' },
    { id: 'claims', label: 'JWT Claims' },
    ...(entry.jwtHeader ? [{ id: 'header', label: 'JWT Header' }] : []),
    ...(entry.exchangeDetails ? [{ id: 'exchange', label: 'Exchange Params' }] : []),
  ];

  return (
    <>
      <div className="api-detail-tabs" role="tablist" aria-label="Token event details">
        {tabs.map(t => (
          <button key={t.id} type="button"
            className={`api-detail-tab${tab === t.id ? ' api-detail-tab--active' : ''}`}
            onClick={() => setTab(t.id)}
          >{t.label}</button>
        ))}
      </div>
      <div className="api-detail-content">
        <div className="api-token-event-header">
          <span className="api-token-event-label">{entry.eventLabel || entry.eventId}</span>
          <span className={`api-token-event-status api-token-event-status--${entry.eventStatus || 'active'}`}>
            {entry.eventStatus || 'active'}
          </span>
          {entry.alg && <span className="api-token-event-alg">{entry.alg}</span>}
        </div>
        {entry.rfc && (
          <p className="api-token-event-rfc">📋 {entry.rfc}</p>
        )}
        {entry.mayActPresent !== undefined && (
          <p className="api-token-event-may-act">
            {entry.mayActPresent
              ? `✅ may_act present${entry.mayActValid === false ? ' (mismatch)' : ''}`
              : '⚠️ may_act absent'}
          </p>
        )}
        {tab === 'summary' && (
          <p className="api-token-event-explanation">{entry.explanation || 'No explanation available.'}</p>
        )}
        {tab === 'claims'    && <ClaimsTable claims={entry.claims} />}
        {tab === 'header'    && <JsonView value={entry.jwtHeader} />}
        {tab === 'exchange'  && <JsonView value={entry.exchangeDetails} />}
      </div>
    </>
  );
}

// ── HTTP Entry Detail ─────────────────────────────────────────────────────────

function HttpEntryDetail({ entry }) {
  const [tab, setTab] = useState('full');
  const isMcp = entry.url === '/api/mcp/tool';
  const fullUrl = absoluteApiUrl(entry.url);
  const tabs = [
    { id: 'full', label: 'Full exchange' },
    { id: 'response', label: 'Response' },
    { id: 'request', label: 'Request body' },
    { id: 'req-headers', label: 'Req headers' },
    { id: 'res-headers', label: 'Res headers' },
  ];

  return (
    <>
      <div className="api-detail-tabs" role="tablist" aria-label="HTTP exchange details">
        {tabs.map(t => (
          <button key={t.id} type="button"
            className={`api-detail-tab${tab === t.id ? ' api-detail-tab--active' : ''}`}
            onClick={() => setTab(t.id)}
          >{t.label}</button>
        ))}
      </div>
      <div className="api-detail-content">
        <div className="api-detail-summary">
          <div className="api-detail-summary-row">
            <span className="api-detail-summary-label">Full URL</span>
            <code className="api-detail-summary-value api-detail-summary-value--url">{fullUrl}</code>
          </div>
          <div className="api-detail-summary-row api-detail-summary-row--inline">
            <span><span className="api-detail-summary-label">Method</span>{' '}
              <strong>{(entry.method || 'GET').toUpperCase()}</strong></span>
            <span><span className="api-detail-summary-label">Status</span>{' '}
              <strong>{entry.status ?? '—'}</strong></span>
            {entry.duration != null && (
              <span><span className="api-detail-summary-label">Duration</span>{' '}
                <strong>{entry.duration}ms</strong></span>
            )}
            <span><span className="api-detail-summary-label">Time</span>{' '}
              <span className="api-detail-summary-mono">{entry.timestamp || '—'}</span></span>
          </div>
          {isMcp && (
            <p className="api-detail-mcp-line">
              🔌 MCP tool <strong>{entry.requestBody?.tool || 'tool call'}</strong>
            </p>
          )}
        </div>
        {entry.error && <div className="api-detail-err">Network error: {entry.error}</div>}
        {tab === 'full'       && <JsonView value={buildHttpExchangeSnapshot(entry)} />}
        {tab === 'response'   && <JsonView value={entry.responseBody} />}
        {tab === 'request'    && <JsonView value={entry.requestBody} />}
        {tab === 'req-headers' && <HeadersView headers={entry.requestHeaders} />}
        {tab === 'res-headers' && <HeadersView headers={entry.responseHeaders} />}
      </div>
    </>
  );
}

// ── Full-page viewer ───────────────────────────────────────────────────────────

/**
 * Read-only API traffic viewer: list + detail. Search, filter, and freeze only; no agent chrome.
 */
export default function ApiTrafficPanel() {
  const [liveEntries, setLiveEntries] = useState(() => getAll());
  const [frozen, setFrozen] = useState(false);
  const [frozenEntries, setFrozenEntries] = useState(null);
  const [selected, setSelected] = useState(null);
  const [filter, setFilter] = useState('All');
  const [search, setSearch] = useState('');

  useEffect(() => subscribe(setLiveEntries), []);

  const entries = frozen && frozenEntries !== null ? frozenEntries : liveEntries;

  function toggleFreeze() {
    if (frozen) {
      setFrozenEntries(null);
      setFrozen(false);
    } else {
      setFrozenEntries(liveEntries);
      setFrozen(true);
    }
  }

  const filtered = entries.filter(e => matchFilter(e, filter, search));

  return (
    <div className="api-traffic-panel api-traffic-panel--page">
      <header className="api-traffic-header api-traffic-header--page">
        <div className="api-traffic-title">
          <span>API traffic</span>
          <span className="api-traffic-count">{filtered.length}</span>
          {frozen && <span className="api-traffic-frozen-badge">FROZEN</span>}
        </div>
        <div className="api-traffic-toolbar">
          <button
            type="button"
            className={`api-traffic-btn${frozen ? ' api-traffic-btn--frozen' : ''}`}
            onClick={toggleFreeze}
            title={frozen ? 'Resume live updates' : 'Freeze log — stop updating so you can inspect entries'}
            aria-pressed={frozen}
          >
            {frozen ? '▶ Resume' : '⏸ Freeze'}
          </button>
          <input
            className="api-traffic-search"
            placeholder="Filter by URL / tool…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            aria-label="Filter by URL or tool name"
          />
          <label className="api-traffic-filter-label">
            <span className="api-traffic-filter-sr">Category</span>
            <select
              className="api-traffic-filter-select"
              value={filter}
              onChange={e => setFilter(e.target.value)}
              aria-label="Category filter"
            >
              {FILTERS.map(f => (
                <option key={f} value={f}>{f}</option>
              ))}
            </select>
          </label>
        </div>
      </header>

      <div className="api-traffic-body">
        <div className="api-traffic-list">
          {filtered.length === 0 ? (
            <div className="api-traffic-empty">
              {entries.length === 0
                ? 'No traffic captured yet.\nUse the main app in another tab or window — API calls will appear here via shared storage.'
                : 'No entries match the current filter.'}
            </div>
          ) : (
            filtered.map(entry => (
              <div
                key={entry.id}
                className={[
                  'api-traffic-entry',
                  selected?.id === entry.id ? 'api-traffic-entry--selected' : '',
                  entry.kind === 'token-event' ? 'api-traffic-entry--token' : '',
                  (entry.error || entry.status >= 400 || entry.status === 0 || entry.eventStatus === 'failed')
                    ? 'api-traffic-entry--error' : '',
                ].filter(Boolean).join(' ')}
                onClick={() => setSelected(entry)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setSelected(entry);
                  }
                }}
              >
                <MethodBadge entry={entry} />
                <StatusBadge entry={entry} />
                <span
                  className="api-entry-url"
                  title={entry.kind === 'token-event' ? entryLabel(entry) : absoluteApiUrl(entry.url)}
                >{entryLabel(entry)}</span>
                {entry.duration != null && <span className="api-entry-dur">{entry.duration}ms</span>}
              </div>
            ))
          )}
        </div>

        <div className="api-traffic-detail">
          {!selected ? (
            <div className="api-detail-empty">← Select an entry to inspect</div>
          ) : selected.kind === 'token-event' ? (
            <TokenEventDetail entry={selected} />
          ) : (
            <HttpEntryDetail entry={selected} />
          )}
        </div>
      </div>
    </div>
  );
}
