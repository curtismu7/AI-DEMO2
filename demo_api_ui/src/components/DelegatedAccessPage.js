// banking_api_ui/src/components/DelegatedAccessPage.js
import React, { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { MdSyncAlt, MdVpnKey, MdInfo, MdDelete, MdLock, MdGroup, MdMailOutline } from 'react-icons/md';
import { notifySuccess, notifyInfo } from '../utils/appToast';
import { formatDate } from '../utils/formatters';
import { clientAuthMethodLabel } from '../utils/clientAuthMethod';
import { useDraggablePanel } from '../hooks/useDraggablePanel';
import '../styles/appShellPages.css';
import '../styles/draggablePanel.css';
import './DelegatedAccessPage.css';

// ─── Demo data ────────────────────────────────────────────────────────────────

const DEMO_ACCOUNTS = [
  { id: 'chk-001', name: 'Everyday Checking', type: 'Checking', balance: 4820.55 },
  { id: 'sav-001', name: 'High-Yield Savings', type: 'Savings',  balance: 18340.00 },
  { id: 'sav-002', name: 'Emergency Fund',     type: 'Savings',  balance: 6000.00 },
  { id: 'inv-001', name: 'Investment Account', type: 'Investment', balance: 42100.80 },
];

const RELATIONSHIPS = ['Spouse / Partner', 'Child', 'Parent', 'Sibling', 'Trusted Advisor', 'Other'];

const DEMO_GRANTED_BY_ME = [
  {
    id: 'del-1',
    name: 'Sarah Pieper',
    email: 'sarah.pieper@example.com',
    relationship: 'Spouse / Partner',
    accountIds: ['chk-001', 'sav-001'],
    since: '2025-11-14',
    status: 'active',
  },
  {
    id: 'del-2',
    name: 'Jamie Pieper',
    email: 'jamie.pieper@example.com',
    relationship: 'Child',
    accountIds: ['chk-001'],
    since: '2026-01-03',
    status: 'active',
  },
];

const DEMO_GRANTED_TO_ME = [
  {
    id: 'del-3',
    name: 'Harold Pieper',
    email: 'harold.pieper@example.com',
    relationship: 'Parent',
    accountIds: ['chk-001', 'sav-001', 'sav-002'],
    since: '2025-09-22',
    status: 'active',
    ownerAccounts: [
      { id: 'chk-ext-1', name: 'Family Checking', type: 'Checking' },
      { id: 'sav-ext-1', name: 'Vacation Savings', type: 'Savings' },
      { id: 'sav-ext-2', name: 'Trust Fund',       type: 'Savings' },
    ],
  },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Returns initials from a full name. */
const initials = (name) =>
  name.split(' ').map(p => p[0]).join('').toUpperCase().slice(0, 2);

/** Hue derived from a string for consistent avatar colours. */
const avatarHue = (str) =>
  str.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0) % 360;

/** Format ISO date as "Nov 14, 2025". */
const fmtDate = (iso) => formatDate(iso);

// ─── Avatar ───────────────────────────────────────────────────────────────────

function Avatar({ name, size = 42 }) {
  const hue = avatarHue(name);
  return (
    <div
      className="da-avatar"
      style={{
        width: size, height: size, fontSize: size * 0.38,
        background: `hsl(${hue}, 55%, 42%)`,
      }}
      aria-hidden
    >
      {initials(name)}
    </div>
  );
}

// ─── Account pill ─────────────────────────────────────────────────────────────

function AccountPill({ account }) {
  const typeClass = {
    Checking:   'da-pill--checking',
    Savings:    'da-pill--savings',
    Investment: 'da-pill--invest',
  }[account.type] || 'da-pill--checking';
  return <span className={`da-pill ${typeClass}`}>{account.name}</span>;
}

// ─── Token Exchange Simulator ─────────────────────────────────────────────────

/** Maps event status to badge CSS class. */
const STATUS_BADGE = {
  active:    'da-badge--active',
  acquired:  'da-badge--active',
  exchanged: 'da-badge--exchanged',
  acquiring: 'da-badge--acquiring',
  failed:    'da-badge--failed',
  skipped:   'da-badge--skipped',
  waiting:   'da-badge--waiting',
};

/** Highlight key claim names in the detail panel. */
const CLAIM_CLASS = {
  may_act: 'da-claim--may-act',
  act:     'da-claim--act',
  scope:   'da-claim--scope',
  aud:     'da-claim--aud',
};

/**
 * One row in the left-column token chain.
 * Shows label + status badge; expander for explanation; connector line to next step.
 */
function SimEventRow({ event, isSelected, isLast, onClick }) {
  return (
    <div
      className={`da-sim-row${isSelected ? ' da-sim-row--selected' : ''}`}
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={e => e.key === 'Enter' && onClick()}
    >
      <div className="da-sim-row__top">
        <span className="da-sim-row__label">{event.label}</span>
        {event.clientAuthMethod === 'private_key_jwt' && (
          <span
            className="da-auth-method da-auth-method--jwks"
            title="How the BFF authenticated to the PingOne token endpoint for this step"
          >
            {clientAuthMethodLabel(event.clientAuthMethod)}
          </span>
        )}
        <span className={`da-badge ${STATUS_BADGE[event.status] || 'da-badge--waiting'}`}>
          {event.status}
        </span>
      </div>
      {event.explanation && (
        <div className="da-sim-row__expl">{event.explanation}</div>
      )}
      {!isLast && <div className="da-sim-row__connector"><span>↓</span></div>}
    </div>
  );
}

/**
 * Right-column detail panel for a selected token event.
 * Shows exchange request (API call), JWT claims, explanation, and optionally full JWT.
 */
function SimEventDetail({ event }) {
  const [showRaw, setShowRaw] = useState(false);
  const claims = event.claims || {};
  const hasClaims = Object.keys(claims).length > 0;

  return (
    <div className="da-sim-detail">
      <div className="da-sim-detail__name">{event.label}</div>

      {/* ── RFC 8693 exchange request ── */}
      {event.exchangeRequest && (
        <div className="da-sim-detail__section">
          <div className="da-sim-detail__sec-title"><MdSyncAlt aria-hidden style={{ verticalAlign: 'middle', marginRight: 6 }} /> Token Exchange API Call</div>
          <div className="da-sim-detail__api-badge">POST /as/token</div>
          <pre className="da-sim-detail__pre">{event.exchangeRequest}</pre>
        </div>
      )}

      {/* ── JWT Claims ── */}
      {hasClaims && (
        <div className="da-sim-detail__section">
          <div className="da-sim-detail__sec-title"><MdVpnKey aria-hidden style={{ verticalAlign: 'middle', marginRight: 6 }} /> Token Claims</div>
          <div className="da-sim-detail__claims">
            {Object.entries(claims).map(([k, v]) => (
              <div key={k} className={`da-sim-claim ${CLAIM_CLASS[k] || ''}`}>
                <span className="da-sim-claim__key">{k}</span>
                <span className="da-sim-claim__sep">:</span>
                <span className="da-sim-claim__val">
                  {typeof v === 'object' ? JSON.stringify(v) : String(v)}
                </span>
              </div>
            ))}
          </div>
          {claims.may_act && (
            <div className="da-sim-pill da-sim-pill--may">
              may_act present → BFF is pre-authorised to exchange
            </div>
          )}
          {claims.act && (
            <div className="da-sim-pill da-sim-pill--act">
              act present → delegation chain proven
            </div>
          )}
        </div>
      )}

      {/* ── Explanation ── */}
      {event.explanation && (
        <div className="da-sim-detail__section">
          <div className="da-sim-detail__sec-title"><MdInfo aria-hidden style={{ verticalAlign: 'middle', marginRight: 6 }} /> What happened</div>
          <div className="da-sim-detail__expl">{event.explanation}</div>
        </div>
      )}

      {/* ── Full JWT ── */}
      {event.jwtFullDecode && (
        <div className="da-sim-detail__section">
          <button
            type="button"
            className="da-sim-detail__toggle"
            onClick={() => setShowRaw(r => !r)}
          >
            {showRaw ? '▼' : '▶'} Full JWT (header + claims)
          </button>
          {showRaw && (
            <pre className="da-sim-detail__pre da-sim-detail__pre--raw">
              {JSON.stringify(event.jwtFullDecode, null, 2)}
            </pre>
          )}
        </div>
      )}

      {!event.exchangeRequest && !hasClaims && !event.explanation && (
        <div className="da-sim-detail__empty">No detail available for this step.</div>
      )}
    </div>
  );
}

/**
 * Full-screen token exchange simulator.
 * Fires a real POST /api/mcp/tool to trigger the RFC 8693 chain,
 * then renders the resulting tokenEvents as a 2-column inspector:
 *   left  → token chain steps
 *   right → selected event detail (API call + JWT claims)
 */
function TokenExchangeSimulator({ delegate, onClose }) {
  const [loading, setLoading]         = useState(true);
  const [tokenEvents, setTokenEvents] = useState([]);
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [callMeta, setCallMeta]       = useState(null); // { status, duration }
  const [simError, setSimError]       = useState(null);

  const { pos: simPos, size: simSize, handleDragStart: simDragStart, handleResizeStart: simResizeStart } =
    useDraggablePanel(
      () => ({ x: Math.max(20, (window.innerWidth  - 1100) / 2), y: 30 }),
      () => ({ w: Math.min(1100, window.innerWidth - 40), h: Math.min(780, window.innerHeight - 60) })
    );

  const runSimulation = useCallback(async () => {
    setLoading(true);
    setSimError(null);
    const t0 = Date.now();
    try {
      const res = await fetch('/api/mcp/tool', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tool: 'get_my_accounts', params: {} }),
      });
      const duration = Date.now() - t0;
      const data = await res.json();
      const events = data.tokenEvents || [];
      setTokenEvents(events);
      setCallMeta({ status: res.status, duration });
      // Auto-select the user-token (before) or first meaningful event
      const auto = events.find(e => e.id === 'user-token')
        || events.find(e => e.claims || e.exchangeRequest)
        || events[0];
      if (auto) setSelectedEvent(auto);
    } catch (err) {
      setSimError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { runSimulation(); }, [runSimulation]);

  return createPortal(
    <>
      {/* Dim backdrop — click to close */}
      <div className="drp-backdrop" onClick={onClose} />

      <div
        className="da-sim"
        style={{
          position: 'fixed',
          left:     simPos.x,
          top:      simPos.y,
          width:    simSize.w,
          height:   simSize.h,
          zIndex:   9991,
        }}
        role="dialog"
        aria-label="Token Exchange Simulator"
        aria-modal="true"
      >
        {/* ── Header (drag handle) ── */}
        <div
          className="da-sim__header"
          onPointerDown={simDragStart}
          style={{ cursor: 'grab' }}
        >
          <div className="da-sim__title">
            <span className="da-sim__icon">⇄</span>
            RFC 8693 Token Exchange — Act as {delegate.name}
          </div>
          <div className="da-sim__header-actions">
            {callMeta && (
              <span className="da-sim__meta">
                HTTP {callMeta.status} · {callMeta.duration}ms
              </span>
            )}
            <button
              type="button"
              className="da-sim__retry"
              onClick={runSimulation}
              onMouseDown={e => e.stopPropagation()}
              disabled={loading}
              title="Re-run exchange"
            >
              ↺
            </button>
            <button
              type="button"
              className="da-sim__close"
              onClick={onClose}
              onMouseDown={e => e.stopPropagation()}
              aria-label="Close"
            >
              ×
            </button>
          </div>
        </div>

        {/* ── Body: 2 columns ── */}
        <div className="da-sim__body">
          {/* Left: token chain */}
          <div className="da-sim__chain">
            <div className="da-sim__chain-hd">Token Chain</div>

            {loading && (
              <div className="da-sim__loading">
                <span className="da-sim__spinner" />
                Running RFC 8693 exchange…
              </div>
            )}

            {simError && !loading && (
              <div className="da-sim__error">
                <strong>Error:</strong> {simError}
                <button type="button" className="da-sim__retry-inline" onClick={runSimulation}>
                  Retry
                </button>
              </div>
            )}

            {!loading && tokenEvents.length === 0 && !simError && (
              <div className="da-sim__error">
                No token events returned — you may need to log in or configure{' '}
                <code>AGENT_OAUTH_CLIENT_ID</code> for actor-token exchange.
              </div>
            )}

            {tokenEvents.map((ev, i) => (
              <SimEventRow
                key={ev.id || i}
                event={ev}
                isSelected={selectedEvent?.id === ev.id}
                isLast={i === tokenEvents.length - 1}
                onClick={() => setSelectedEvent(ev)}
              />
            ))}
          </div>

          {/* Right: detail */}
          <div className="da-sim__detail-col">
            {selectedEvent
              ? <SimEventDetail event={selectedEvent} />
              : (
                <div className="da-sim__detail-empty">
                  <span>←</span> Select a token step to inspect its claims and API call
                </div>
              )
            }
          </div>
        </div>

        {/* Resize grip */}
        <div className="drp-resize-grip" onMouseDown={simResizeStart} aria-hidden title="Drag to resize" />
      </div>
    </>,
    document.body
  );
}

// ─── Add/Edit delegation modal ────────────────────────────────────────────────

function AddDelegateModal({ onClose, onSave }) {
  const [name, setName]         = useState('');
  const [email, setEmail]       = useState('');
  const [rel, setRel]           = useState(RELATIONSHIPS[0]);
  const [selected, setSelected] = useState({});
  const [error, setError]       = useState('');

  const { pos, size, handleDragStart, handleResizeStart } = useDraggablePanel(
    () => ({
      x: Math.max(20, (window.innerWidth  - 500) / 2),
      y: Math.max(20, (window.innerHeight - 560) / 2),
    }),
    { w: 500, h: 560 }
  );

  const toggleAccount = (id) =>
    setSelected(prev => ({ ...prev, [id]: !prev[id] }));

  const chosenIds = Object.keys(selected).filter(id => selected[id]);

  const handleSave = () => {
    if (!name.trim())     return setError('Name is required.');
    if (!email.trim())    return setError('Email is required.');
    if (!chosenIds.length) return setError('Select at least one account.');
    setError('');
    onSave({ name: name.trim(), email: email.trim(), relationship: rel, accountIds: chosenIds });
  };

  return createPortal(
    <>
      {/* Dim backdrop — click to close */}
      <div className="drp-backdrop" onClick={onClose} />

      <div
        className="da-modal"
        style={{
          position: 'fixed',
          left:     pos.x,
          top:      pos.y,
          width:    size.w,
          height:   size.h,
          zIndex:   9991,
          maxWidth: 'none',
          maxHeight: 'none',
        }}
        role="dialog"
        aria-label="Add delegation"
      >
        <div
          className="da-modal__header"
          onPointerDown={handleDragStart}
          style={{ cursor: 'grab' }}
        >
          <h2 className="da-modal__title">Grant account access</h2>
          <button
            type="button"
            className="da-modal__close"
            onClick={onClose}
            onMouseDown={e => e.stopPropagation()}
            aria-label="Close"
          >×</button>
        </div>

        <div className="da-modal__body">
          <label className="da-field">
            <span className="da-field__label">Full name</span>
            <input
              className="da-field__input"
              type="text"
              placeholder="e.g. Sarah Pieper"
              value={name}
              onChange={e => setName(e.target.value)}
              autoFocus
            />
          </label>

          <label className="da-field">
            <span className="da-field__label">Email address</span>
            <input
              className="da-field__input"
              type="email"
              placeholder="e.g. sarah@example.com"
              value={email}
              onChange={e => setEmail(e.target.value)}
            />
          </label>

          <label className="da-field">
            <span className="da-field__label">Relationship</span>
            <select className="da-field__input da-field__select" value={rel} onChange={e => setRel(e.target.value)}>
              {RELATIONSHIPS.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </label>

          <fieldset className="da-field da-field--accounts">
            <legend className="da-field__label">Accounts to share</legend>
            <p className="da-field__hint">Select one or more accounts this person can view and act on your behalf.</p>
            <div className="da-acct-checkboxes">
              {DEMO_ACCOUNTS.map(acct => (
                <label key={acct.id} className={`da-acct-check${selected[acct.id] ? ' da-acct-check--on' : ''}`}>
                  <input
                    type="checkbox"
                    checked={!!selected[acct.id]}
                    onChange={() => toggleAccount(acct.id)}
                  />
                  <span className="da-acct-check__name">{acct.name}</span>
                  <span className="da-acct-check__type">{acct.type}</span>
                  <span className="da-acct-check__bal">
                    ${acct.balance.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          {error && <p className="da-modal__error">{error}</p>}
        </div>

        <div className="da-modal__footer">
          <button type="button" className="da-btn da-btn--ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="da-btn da-btn--primary" onClick={handleSave}>
            Send invitation
          </button>
        </div>

        {/* Resize grip */}
        <div className="drp-resize-grip" onMouseDown={handleResizeStart} aria-hidden title="Drag to resize" />
      </div>
    </>,
    document.body
  );
}

// ─── Delegate card ────────────────────────────────────────────────────────────

function DelegateCard({ delegate, accounts, onRevoke, onActAs }) {
  const sharedAccounts = accounts.filter(a => delegate.accountIds.includes(a.id));
  const isGrantedToMe = Boolean(delegate.ownerAccounts);
  const displayAccounts = isGrantedToMe ? delegate.ownerAccounts : sharedAccounts;

  return (
    <div className="da-card">
      <Avatar name={delegate.name} />

      <div className="da-card__body">
        <div className="da-card__top">
          <div>
            <span className="da-card__name">{delegate.name}</span>
            <span className="da-card__email">{delegate.email}</span>
          </div>
          <span className="da-card__rel">{delegate.relationship}</span>
        </div>

        <div className="da-card__accounts">
          {displayAccounts.map(a => <AccountPill key={a.id} account={a} />)}
        </div>

        <div className="da-card__footer">
          <span className="da-card__since">Since {fmtDate(delegate.since)}</span>
          <div className="da-card__actions">
            <button
              type="button"
              className="da-btn da-btn--act"
              onClick={() => onActAs(delegate)}
            >
              ⇄ Act as
            </button>
            <button
              type="button"
              className="da-btn da-btn--revoke"
              onClick={() => onRevoke(delegate)}
            >
              <MdDelete aria-hidden style={{ verticalAlign: 'middle', marginRight: 4 }} /> {isGrantedToMe ? 'Remove access' : 'Revoke'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

/**
 * Delegated access page — manage RFC 8693 delegations (granted by me / granted to me).
 */
export default function DelegatedAccessPage({ user }) {
  const [grantedByMe, setGrantedByMe] = useState(DEMO_GRANTED_BY_ME);
  const [grantedToMe]                 = useState(DEMO_GRANTED_TO_ME);
  const [tab, setTab]                 = useState('granted');  // 'granted' | 'received'
  const [showAdd, setShowAdd]         = useState(false);
  const [actAsDelegate, setActAsDelegate] = useState(null);

  const handleSave = (data) => {
    const entry = {
      id: `del-${Date.now()}`,
      ...data,
      since: new Date().toISOString().slice(0, 10),
      status: 'active',
    };
    setGrantedByMe(prev => [...prev, entry]);
    setShowAdd(false);
    notifySuccess(`Invitation sent to ${data.name}. They will receive an email to confirm access.`);
  };

  const handleRevoke = (delegate) => {
    if (!window.confirm(`Revoke ${delegate.name}'s access to your accounts?`)) return;
    setGrantedByMe(prev => prev.filter(d => d.id !== delegate.id));
    notifySuccess(`Access revoked for ${delegate.name}.`);
  };

  return (
    <div className="da-page app-page-shell">
      {/* Header */}
      <header className="da-page__hero">
        <div className="da-page__hero-inner">
          <div>
            <Link to="/dashboard" className="da-page__back">← Dashboard</Link>
            <h1 className="da-page__title">Delegated Access</h1>
            <p className="da-page__subtitle">
              Share account access with trusted family members using OAuth 2.0 delegation (RFC 8693).
            </p>
          </div>
          <div className="da-page__stats">
            <div className="da-stat">
              <span className="da-stat__n">{grantedByMe.length}</span>
              <span className="da-stat__l">Granted by me</span>
            </div>
            <div className="da-stat">
              <span className="da-stat__n">{grantedToMe.length}</span>
              <span className="da-stat__l">Granted to me</span>
            </div>
          </div>
        </div>
      </header>

      {/* RFC 8693 explainer strip */}
      <div className="da-edu-strip">
        <span className="da-edu-strip__icon"><MdLock aria-hidden style={{ verticalAlign: 'middle' }} /></span>
        <span>
          Delegated access uses <strong>RFC 8693 Token Exchange</strong>. When you or a delegate acts on an account,
          the BFF requests a narrowed token with an <code>act</code> claim — the token proves{' '}
          <em>who is acting</em> and <em>on whose behalf</em>, without sharing passwords or full access tokens.
        </span>
        <a
          className="da-edu-strip__link"
          href="https://datatracker.ietf.org/doc/html/rfc8693"
          target="_blank"
          rel="noopener noreferrer"
        >
          RFC 8693 ↗
        </a>
      </div>

      {/* Tabs + Add button */}
      <div className="da-toolbar">
        <div className="da-tabs" role="tablist">
          <button
            role="tab"
            type="button"
            className={`da-tab${tab === 'granted' ? ' da-tab--active' : ''}`}
            aria-selected={tab === 'granted'}
            onClick={() => setTab('granted')}
          >
            Access I've granted
            {grantedByMe.length > 0 && <span className="da-tab__badge">{grantedByMe.length}</span>}
          </button>
          <button
            role="tab"
            type="button"
            className={`da-tab${tab === 'received' ? ' da-tab--active' : ''}`}
            aria-selected={tab === 'received'}
            onClick={() => setTab('received')}
          >
            Granted to me
            {grantedToMe.length > 0 && <span className="da-tab__badge">{grantedToMe.length}</span>}
          </button>
        </div>
        {tab === 'granted' && (
          <button
            type="button"
            className="da-btn da-btn--primary da-btn--add"
            onClick={() => setShowAdd(true)}
          >
            + Add person
          </button>
        )}
      </div>

      {/* Card list */}
      <div className="da-list">
        {tab === 'granted' && grantedByMe.length === 0 && (
          <div className="da-empty">
            <div className="da-empty__icon"><MdGroup aria-hidden style={{ verticalAlign: 'middle' }} /></div>
            <p className="da-empty__text">You haven't granted access to anyone yet.</p>
            <button type="button" className="da-btn da-btn--primary" onClick={() => setShowAdd(true)}>
              + Grant access to a family member
            </button>
          </div>
        )}

        {tab === 'granted' && grantedByMe.map(d => (
          <DelegateCard
            key={d.id}
            delegate={d}
            accounts={DEMO_ACCOUNTS}
            onRevoke={handleRevoke}
            onActAs={setActAsDelegate}
          />
        ))}

        {tab === 'received' && grantedToMe.length === 0 && (
          <div className="da-empty">
            <div className="da-empty__icon"><MdMailOutline aria-hidden style={{ verticalAlign: 'middle' }} /></div>
            <p className="da-empty__text">No one has granted you delegated access yet.</p>
          </div>
        )}

        {tab === 'received' && grantedToMe.map(d => (
          <DelegateCard
            key={d.id}
            delegate={d}
            accounts={DEMO_ACCOUNTS}
            onRevoke={() => notifyInfo('Contact the account holder to remove your access.')}
            onActAs={setActAsDelegate}
          />
        ))}
      </div>

      {/* Modals */}
      {showAdd && <AddDelegateModal onClose={() => setShowAdd(false)} onSave={handleSave} />}
      {actAsDelegate && (
        <TokenExchangeSimulator delegate={actAsDelegate} onClose={() => setActAsDelegate(null)} />
      )}
    </div>
  );
}
