// QuickFlagsPill — always-visible header pill showing the live token-validation
// mode (🔐 JWKS / 🔎 Introspect) + a dropdown with the curated demo switches.
// Read AND write paths of /api/admin/feature-flags are intentionally
// unauthenticated at the server (see server.js — demo posture, do not add a
// gate silently). Any signed-in user (customer or admin) can flip these here —
// the 403 / adminDenied handling is defensive for a future server-side gate.
// Env-pinned flags (pinned/pinnedBy from the API) render locked: getEffective()
// is env-first, so their toggles would be silently inert.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import './QuickFlagsPill.css';

// The curated lineup. Adding switch #11 = one new entry here.
// control: 'segmented' renders all modes as A/B buttons; 'toggle' renders an
// on/off switch. For segmented booleans, modes map labels onto true/false.
const QUICK_FLAGS = [
  { id: 'ff_mcp_gateway_jwks',          group: 'Token & Gateway', control: 'segmented', label: 'Token Validation',                modes: [{ value: true, label: '🔐 JWKS' }, { value: false, label: '🔎 Introspect' }] },
  { id: 'ff_mcp_gateway_pinggateway',   group: 'Token & Gateway', control: 'segmented', label: 'Agent Gateway',                   modes: [{ value: true, label: 'PingOne GW' }, { value: false, label: 'Demo GW' }] },
  { id: 'introspectionProvider',        group: 'Token & Gateway', control: 'segmented', label: 'Introspection Provider',          modes: [{ value: 'pinggateway', label: 'PingGateway' }, { value: 'p1az', label: 'P1AZ' }] },
  { id: 'ff_skip_token_exchange',       group: 'Token & Gateway', control: 'toggle',    label: 'Skip Token Exchange' },
  { id: 'ff_authorize_simulated',       group: 'AuthN / AuthZ',   control: 'segmented', label: 'Authorize Engine',                modes: [{ value: false, label: 'Real P1AZ' }, { value: true, label: 'Simulated' }] },
  { id: 'ff_id_token_exchange',         group: 'AuthN / AuthZ',   control: 'toggle',    label: 'ID Token Exchange Mode' },
  { id: 'ff_token_auth_private_key_jwt', group: 'AuthN / AuthZ',  control: 'toggle',    label: 'Client Auth — Private Key JWT' },
  { id: 'ciba_enabled',                 group: 'AuthN / AuthZ',   control: 'toggle',    label: 'CIBA — Out-of-Band Approval' },
  { id: 'ff_heuristic_enabled',         group: 'Agent',           control: 'toggle',    label: 'LLM Chips — Heuristic Fast-Path' },
  { id: 'ff_agent_results_panel',       group: 'Agent',           control: 'toggle',    label: 'Floating Results Panel' },
];
const GROUPS = ['Token & Gateway', 'AuthN / AuthZ', 'Agent'];
const PILL_FLAG = 'ff_mcp_gateway_jwks';

export default function QuickFlagsPill({ user }) {
  const [flagsById, setFlagsById] = useState(null); // null = not loaded
  const [loadFailed, setLoadFailed] = useState(false);
  const [open, setOpen] = useState(false);
  const [savingId, setSavingId] = useState(null);
  const [error, setError] = useState(null);
  const [adminDenied, setAdminDenied] = useState(false);
  const btnRef = useRef(null);
  const panelRef = useRef(null);
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    return () => { aliveRef.current = false; };
  }, []);

  // Any signed-in user may flip the demo flags; a server 403 (adminDenied)
  // disables the controls as a defensive fallback for a future server gate.
  const canEdit = !!user && !adminDenied;

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/feature-flags', { credentials: 'include' });
      if (!aliveRef.current) return;
      if (!res.ok) { setLoadFailed(true); return; }
      const data = await res.json();
      if (!aliveRef.current) return;
      const byId = {};
      for (const f of data.flags || []) byId[f.id] = f;
      setFlagsById(byId);
      setLoadFailed(false);
    } catch (_) {
      if (!aliveRef.current) return;
      setLoadFailed(true);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Re-fetch on open so states stay honest across sessions/tabs.
  useEffect(() => { if (open) load(); }, [open, load]);

  // Close on outside click / Escape while open.
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (panelRef.current?.contains(e.target) || btnRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const save = useCallback(async (id, value) => {
    if (!flagsById) return;
    const prev = flagsById[id];
    if (!prev || prev.pinned) return;
    setSavingId(id);
    setError(null);
    // Optimistic update + rollback (FeatureFlagsPage pattern).
    setFlagsById((cur) => ({ ...cur, [id]: { ...cur[id], value } }));
    try {
      const res = await fetch('/api/admin/feature-flags', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ updates: { [id]: value } }),
      });
      if (!aliveRef.current) return;
      if (res.status === 403) {
        setAdminDenied(true);
        setFlagsById((cur) => ({ ...cur, [id]: prev }));
        return;
      }
      if (!res.ok) throw new Error(`save failed (${res.status})`);
      const data = await res.json();
      if (!aliveRef.current) return;
      if (Array.isArray(data.flags) && data.flags.length) {
        setFlagsById((cur) => {
          const next = { ...cur };
          for (const f of data.flags) next[f.id] = f;
          return next;
        });
      }
    } catch (e) {
      if (!aliveRef.current) return;
      setFlagsById((cur) => ({ ...cur, [id]: prev }));
      setError(e.message || 'save failed');
    } finally {
      if (aliveRef.current) setSavingId(null);
    }
  }, [flagsById]);

  const pillFlag = flagsById?.[PILL_FLAG];
  const pillLabel = !flagsById
    ? (loadFailed ? '⚑ Flags –' : '…')
    : pillFlag?.value
      ? '🔐 JWKS'
      : '🔎 Introspect';

  const pillTitle = 'Quick feature flags — token validation mode and demo switches';

  const rect = open ? btnRef.current?.getBoundingClientRect() : null;

  const renderControl = (def) => {
    const f = flagsById?.[def.id];
    if (!f) return <span className="qfp-missing">unavailable</span>;
    const locked = !!f.pinned;
    const disabled = locked || !canEdit || savingId === def.id;
    const lockTitle = locked
      ? `Pinned by ${f.pinnedBy} in docker-compose — change the env to flip`
      : undefined;
    if (def.control === 'segmented') {
      return (
        <span className="qfp-segmented" role="group" aria-label={def.label}>
          {def.modes.map((m) => (
            <button
              key={String(m.value)}
              type="button"
              className={`qfp-seg-btn${f.value === m.value ? ' qfp-seg-btn--active' : ''}`}
              aria-pressed={f.value === m.value}
              disabled={disabled}
              title={lockTitle}
              onClick={() => { if (f.value !== m.value) save(def.id, m.value); }}
            >
              {m.label}
            </button>
          ))}
          {locked && <span className="qfp-lock" aria-label="pinned" title={lockTitle}>🔒</span>}
        </span>
      );
    }
    return (
      <span className="qfp-toggle-wrap">
        <button
          type="button"
          className={`qfp-toggle${f.value ? ' qfp-toggle--on' : ''}`}
          role="switch"
          aria-checked={!!f.value}
          aria-label={def.label}
          disabled={disabled}
          title={lockTitle}
          onClick={() => save(def.id, !f.value)}
        >
          <span className="qfp-toggle-knob" />
        </button>
        {locked && <span className="qfp-lock" aria-label="pinned" title={lockTitle}>🔒</span>}
      </span>
    );
  };

  return (
    <>
      <button
        type="button"
        ref={btnRef}
        className={`qfp-pill${open ? ' qfp-pill--open' : ''}${loadFailed ? ' qfp-pill--muted' : ''}`}
        title={pillTitle}
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {pillLabel}
      </button>
      {open && createPortal(
        <div
          ref={panelRef}
          className="qfp-dropdown"
          style={rect ? { top: rect.bottom + 6, right: Math.max(8, window.innerWidth - rect.right) } : undefined}
          role="menu"
          aria-label="Quick feature flags"
        >
          {!canEdit && <div className="qfp-hint">Sign in to change flags</div>}
          {error && <div className="qfp-error">{error}</div>}
          {loadFailed && (
            <button type="button" className="qfp-retry" onClick={load}>Reload flags</button>
          )}
          {GROUPS.map((g) => (
            <div key={g} className="qfp-group">
              <div className="qfp-group-title">{g}</div>
              {QUICK_FLAGS.filter((d) => d.group === g).map((d) => (
                <div key={d.id} className="qfp-row">
                  <span className="qfp-row-label" title={flagsById?.[d.id]?.description || d.label}>{d.label}</span>
                  {renderControl(d)}
                </div>
              ))}
            </div>
          ))}
        </div>,
        document.body
      )}
    </>
  );
}
