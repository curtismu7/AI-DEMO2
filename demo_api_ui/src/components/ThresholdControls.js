// ThresholdControls.js
// Comprehensive "Demo Controls" widget with thresholds, feature flags, MFA/consent modes.
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import './ThresholdControls.css';

const FLAG_LABELS = {
  ff_authorize_simulated: 'Simulated Authorization',
  ff_authorize_fail_open: 'Allow Transactions if Auth Unavailable',
  step_up_enabled: 'MFA Step-up',
  ff_hitl_enabled: 'Human-in-the-Loop Consent',
  ff_skip_token_exchange: 'Skip Token Exchange (RFC 8693)',
  ff_inject_scopes: 'Inject Banking Scopes',
};

const FLAG_DESCRIPTIONS = {
  ff_authorize_simulated: 'Use simulated (offline) auth responses instead of live PingOne',
  ff_authorize_fail_open: 'Allow operations to proceed when authorization service is unavailable',
  step_up_enabled: 'Prompt for MFA on transactions above the step-up threshold',
  ff_hitl_enabled: 'Show a consent challenge before executing sensitive operations',
  ff_skip_token_exchange: 'Bypass RFC 8693 token exchange — also enables Inject Banking Scopes so MCP calls still work',
  ff_inject_scopes: 'Add read / write scopes to the token (required when skipping token exchange)',
};

const IMPORTANT_FLAG_IDS = Object.keys(FLAG_LABELS);

// Flags that must be toggled together to keep the demo working
const FLAG_PAIRS = {
  ff_skip_token_exchange: 'ff_inject_scopes',
  ff_inject_scopes: 'ff_skip_token_exchange',
};

export default function ThresholdControls() {
  const [open, setOpen] = useState(false);
  const [panelPos, setPanelPos] = useState({ top: 0, right: 0 });
  const [confirm, setConfirm] = useState('');
  const [mfa, setMfa] = useState('');
  const [flags, setFlags] = useState([]);
  const [flagSaving, setFlagSaving] = useState(null);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState(null);
  const [, setFlagError] = useState(null);
  const [, setIsAdmin] = useState(false);
  const [openSections, setOpenSections] = useState({ thresholds: true, verticalThresholds: false, flags: true });
  const btnRef = useRef(null);
  const panelRef = useRef(null);

  // Per-vertical thresholds
  const [verticals, setVerticals] = useState([]);
  const [selectedVertical, setSelectedVertical] = useState('');
  const [vertConfirm, setVertConfirm] = useState('');
  const [vertMfa, setVertMfa] = useState('');
  const [vertSaving, setVertSaving] = useState(false);
  const [vertStatus, setVertStatus] = useState(null);

  const toggleSection = (key) => setOpenSections((prev) => ({ ...prev, [key]: !prev[key] }));

  const loadAll = useCallback(async () => {
    try {
      // Load thresholds
      const threshRes = await fetch('/api/config/thresholds', { credentials: 'include' });
      if (threshRes.ok) {
        const data = await threshRes.json();
        setConfirm(String(data.confirm_threshold_usd ?? 250));
        setMfa(String(data.mfa_threshold_usd ?? 500));
      }

      // Load vertical list for per-vertical threshold section
      const vertRes = await fetch('/api/verticals/list', { credentials: 'include' });
      if (vertRes.ok) {
        const list = await vertRes.json();
        setVerticals(list || []);
      }

      // Load feature flags
      const flagRes = await fetch('/api/admin/feature-flags', { credentials: 'include' });
      if (flagRes.ok) {
        const data = await flagRes.json();
        setFlags(data.flags || []);
      }
    } catch (_) {
      // silent
    }
  }, []);

  // When selected vertical changes, load its thresholds
  useEffect(() => {
    if (!selectedVertical) { setVertConfirm(''); setVertMfa(''); return; }
    fetch(`/api/config/thresholds?vertical=${encodeURIComponent(selectedVertical)}`, { credentials: 'include' })
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (!data) return;
        setVertConfirm(data[`confirm_threshold_usd_${selectedVertical}`] || '');
        setVertMfa(data[`mfa_threshold_usd_${selectedVertical}`] || '');
      })
      .catch(() => {});
  }, [selectedVertical]);

  useEffect(() => {
    if (open) loadAll();
  }, [open, loadAll]);

  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      const inBtn = btnRef.current && btnRef.current.closest('.thresh-ctrl').contains(e.target);
      const inPanel = panelRef.current && panelRef.current.contains(e.target);
      if (!inBtn && !inPanel) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const handleToggle = () => {
    if (!open && btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      setPanelPos({
        top: rect.bottom + 8,
        right: window.innerWidth - rect.right,
      });
    }
    setOpen((p) => !p);
  };

  const saveVerticalThresholds = async () => {
    if (!selectedVertical) return;
    setVertSaving(true);
    setVertStatus(null);
    try {
      const body = { vertical: selectedVertical };
      if (vertConfirm) body.confirm_threshold_usd = Number(vertConfirm);
      if (vertMfa) body.mfa_threshold_usd = Number(vertMfa);
      const res = await fetch('/api/config/thresholds', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      });
      if (res.ok) {
        const data = await res.json();
        setVertConfirm(data[`confirm_threshold_usd_${selectedVertical}`] || '');
        setVertMfa(data[`mfa_threshold_usd_${selectedVertical}`] || '');
        setVertStatus('saved');
        setTimeout(() => setVertStatus(null), 2000);
      } else {
        setVertStatus('error');
      }
    } catch (_) {
      setVertStatus('error');
    } finally {
      setVertSaving(false);
    }
  };

  const saveThresholds = async () => {
    setSaving(true);
    setStatus(null);
    try {
      const body = {};
      if (confirm) body.confirm_threshold_usd = Number(confirm);
      if (mfa) body.mfa_threshold_usd = Number(mfa);
      const res = await fetch('/api/config/thresholds', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      });
      if (res.ok) {
        const data = await res.json();
        setConfirm(String(data.confirm_threshold_usd));
        setMfa(String(data.mfa_threshold_usd));
        setStatus('saved');
        setTimeout(() => setStatus(null), 2000);
      } else {
        setStatus('error');
      }
    } catch (_) {
      setStatus('error');
    } finally {
      setSaving(false);
    }
  };

  const toggleFlag = async (flagId, nextValue) => {
    setFlagSaving(flagId);
    setFlagError(null);
    try {
      const res = await fetch('/api/admin/feature-flags', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ updates: { [flagId]: nextValue, ...(FLAG_PAIRS[flagId] ? { [FLAG_PAIRS[flagId]]: nextValue } : {}) } }),
      });
      if (res.ok) {
        const data = await res.json();
        const flagMap = new Map((data.flags || []).map((f) => [f.id, f]));
        setFlags((prev) => prev.map((f) => flagMap.get(f.id) || f));
      } else if (res.status === 403) {
        setFlagError('Admin session required to modify flags');
        setIsAdmin(false);
      } else {
        const errData = await res.json();
        setFlagError(errData?.message || 'Failed to update flag');
      }
    } catch (err) {
      setFlagError('Network error: ' + (err?.message || 'Unknown error'));
    } finally {
      setFlagSaving(null);
    }
  };

  const panel = open ? createPortal(
    <div
      ref={panelRef}
      className="thresh-ctrl__panel"
      role="dialog"
      aria-label="Demo controls"
      style={{ top: panelPos.top, right: panelPos.right }}
    >
      <div className="thresh-ctrl__title">Demo Controls</div>

      {/* Thresholds */}
      <div className="thresh-ctrl__section">
        <button type="button" className="thresh-ctrl__section-toggle" onClick={() => toggleSection('thresholds')}>
          <span className="thresh-ctrl__section-title">Step-up Thresholds</span>
          <span className="thresh-ctrl__chevron">{openSections.thresholds ? '▲' : '▼'}</span>
        </button>
        {openSections.thresholds && (
          <>
            <div className="thresh-ctrl__field">
              <label className="thresh-ctrl__label">
                Confirm (consent) $
                <input
                  className="thresh-ctrl__input"
                  type="number"
                  min="1"
                  step="50"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                />
              </label>
              <span className="thresh-ctrl__help">Amount that triggers consent challenge</span>
            </div>
            <div className="thresh-ctrl__field">
              <label className="thresh-ctrl__label">
                MFA step-up $
                <input
                  className="thresh-ctrl__input"
                  type="number"
                  min="1"
                  step="50"
                  value={mfa}
                  onChange={(e) => setMfa(e.target.value)}
                />
              </label>
              <span className="thresh-ctrl__help">Amount that triggers MFA step-up challenge</span>
            </div>
            <button
              type="button"
              className="thresh-ctrl__save"
              onClick={saveThresholds}
              disabled={saving}
            >
              {saving ? 'Saving…' : 'Save Thresholds'}
            </button>
            {status === 'saved' && <span className="thresh-ctrl__ok">✓ Saved</span>}
            {status === 'error' && <span className="thresh-ctrl__err">Error</span>}
          </>
        )}
      </div>

      {/* Per-vertical thresholds */}
      {verticals.length > 0 && (
        <div className="thresh-ctrl__section">
          <button type="button" className="thresh-ctrl__section-toggle" onClick={() => toggleSection('verticalThresholds')}>
            <span className="thresh-ctrl__section-title">Per-Vertical Thresholds</span>
            <span className="thresh-ctrl__chevron">{openSections.verticalThresholds ? '▲' : '▼'}</span>
          </button>
          {openSections.verticalThresholds && (
            <>
              <div className="thresh-ctrl__field">
                <label className="thresh-ctrl__label">
                  Vertical
                  <select
                    className="thresh-ctrl__input"
                    value={selectedVertical}
                    onChange={(e) => setSelectedVertical(e.target.value)}
                  >
                    <option value="">— select —</option>
                    {verticals.map((v) => (
                      <option key={v.id} value={v.id}>{v.displayName}</option>
                    ))}
                  </select>
                </label>
                <span className="thresh-ctrl__help">Override thresholds for this vertical only</span>
              </div>
              {selectedVertical && (
                <>
                  <div className="thresh-ctrl__field">
                    <label className="thresh-ctrl__label">
                      Confirm (consent) $
                      <input
                        className="thresh-ctrl__input"
                        type="number"
                        min="1"
                        step="50"
                        placeholder={confirm}
                        value={vertConfirm}
                        onChange={(e) => setVertConfirm(e.target.value)}
                      />
                    </label>
                    <span className="thresh-ctrl__help">Leave blank to use global default ({confirm})</span>
                  </div>
                  <div className="thresh-ctrl__field">
                    <label className="thresh-ctrl__label">
                      MFA step-up $
                      <input
                        className="thresh-ctrl__input"
                        type="number"
                        min="1"
                        step="50"
                        placeholder={mfa}
                        value={vertMfa}
                        onChange={(e) => setVertMfa(e.target.value)}
                      />
                    </label>
                    <span className="thresh-ctrl__help">Leave blank to use global default ({mfa})</span>
                  </div>
                  <button
                    type="button"
                    className="thresh-ctrl__save"
                    onClick={saveVerticalThresholds}
                    disabled={vertSaving}
                  >
                    {vertSaving ? 'Saving…' : `Save for ${selectedVertical}`}
                  </button>
                  {vertStatus === 'saved' && <span className="thresh-ctrl__ok">✓ Saved</span>}
                  {vertStatus === 'error' && <span className="thresh-ctrl__err">Error</span>}
                </>
              )}
            </>
          )}
        </div>
      )}

      {/* Feature Flags — important flags only */}
      {flags.filter((f) => IMPORTANT_FLAG_IDS.includes(f.id)).length > 0 && (
        <div className="thresh-ctrl__section">
          <button type="button" className="thresh-ctrl__section-toggle" onClick={() => toggleSection('flags')}>
            <span className="thresh-ctrl__section-title">Feature Flags</span>
            <span className="thresh-ctrl__chevron">{openSections.flags ? '▲' : '▼'}</span>
          </button>
          {openSections.flags && flags
            .filter((f) => IMPORTANT_FLAG_IDS.includes(f.id))
            .map((flag) => (
              <div key={flag.id} className="thresh-ctrl__flag-item">
                <label className="thresh-ctrl__checkbox">
                  <input
                    type="checkbox"
                    checked={flag.value === true}
                    onChange={(e) => toggleFlag(flag.id, e.target.checked)}
                    disabled={flagSaving === flag.id}
                  />
                  <span>{FLAG_LABELS[flag.id]}</span>
                </label>
                <span className="thresh-ctrl__help">{FLAG_DESCRIPTIONS[flag.id]}</span>
              </div>
            ))}
        </div>
      )}
    </div>,
    document.body
  ) : null;

  return (
    <div className="thresh-ctrl">
      <button
        ref={btnRef}
        type="button"
        className="thresh-ctrl__toggle dashboard-toolbar-btn"
        title="Demo: Controls (thresholds, flags, MFA/consent)"
        aria-expanded={open}
        onClick={handleToggle}
      >
        Controls
      </button>
      {panel}
    </div>
  );
}
