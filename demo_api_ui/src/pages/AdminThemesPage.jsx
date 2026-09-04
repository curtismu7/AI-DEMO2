// demo_api_ui/src/pages/AdminThemesPage.jsx
//
// Admin management surface for per-vertical theme zones. Lists every vertical
// with a ThemeZonePanel (grouped per-zone palette picker) + a per-vertical
// "Reset all". See skill: vertical-theme-zones.
import React, { useEffect, useState, useCallback } from 'react';
import ThemeZonePanel from '../components/ThemeZonePanel';
import ThemeToggle from '../components/common/ThemeToggle';
import { useVertical } from '../vertical/useVertical';
import { cssVarsFromBrand } from '../config/themeZones';
import './AdminThemesPage.css';

export default function AdminThemesPage() {
  const { refetch } = useVertical();
  const [verticals, setVerticals] = useState(null); // null = loading
  const [open, setOpen] = useState({});             // verticalId → expanded
  const [nonce, setNonce] = useState({});           // verticalId → remount key (after reset-all / brandfetch apply)
  const [brandDomain, setBrandDomain] = useState({}); // verticalId → domain input
  const [brandStatus, setBrandStatus] = useState({});  // verticalId → 'loading' | 'error' | message string

  const fetchBrand = useCallback(async (id) => {
    const domain = (brandDomain[id] || '').trim();
    if (!domain) return;
    setBrandStatus((s) => ({ ...s, [id]: 'loading' }));
    try {
      const res = await fetch(`/api/verticals/${id}/brandfetch`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setBrandStatus((s) => ({ ...s, [id]: body.error || `failed (${res.status})` }));
        return;
      }
      const cssVars = cssVarsFromBrand(body.primary, body.accent || body.primary);
      await fetch(`/api/admin/vertical-themes/${id}`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cssVars }),
      });
      if (body.logoPath) {
        await fetch(`/api/verticals/${id}/overlay`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: 'identity.logoPath', value: body.logoPath }),
        });
      }
      setNonce((n) => ({ ...n, [id]: (n[id] || 0) + 1 })); // remount panel → re-fetch picker state
      setBrandStatus((s) => ({ ...s, [id]: `applied${body.fontName ? ` — font: ${body.fontName}` : ''}` }));
      refetch();
    } catch {
      setBrandStatus((s) => ({ ...s, [id]: 'failed' }));
    }
  }, [brandDomain, refetch]);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/verticals/list', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => { if (!cancelled) setVerticals(Array.isArray(data) ? data : []); })
      .catch(() => { if (!cancelled) setVerticals([]); });
    return () => { cancelled = true; };
  }, []);

  const resetAll = useCallback(async (id) => {
    try {
      await fetch(`/api/admin/vertical-themes/${id}`, { method: 'DELETE', credentials: 'include' });
      setNonce((n) => ({ ...n, [id]: (n[id] || 0) + 1 })); // force panel remount → re-fetch picker state
      refetch(); // re-pull /me so applyThemeTokens clears the active vertical's live :root overrides
    } catch { /* ignore */ }
  }, [refetch]);

  return (
    <div className="admin-themes-page">
      <div className="atp-header-row">
        <h1 className="atp-title">Vertical Themes</h1>
        <ThemeToggle />
      </div>
      <p className="atp-sub">
        Pick a palette per zone for each vertical. Changes apply live for the active
        vertical and persist per-vertical. Unset zones use the vertical&rsquo;s default.
      </p>

      {verticals === null && (
        <div className="atp-skeleton-list" aria-hidden="true">
          {[0, 1, 2].map((i) => <div key={i} className="atp-skeleton-row" />)}
        </div>
      )}

      {verticals && verticals.length === 0 && (
        <div className="atp-empty">No verticals available.</div>
      )}

      {verticals && verticals.map((v) => {
        const expanded = !!open[v.id];
        return (
          <section key={v.id} className="atp-vertical">
            <div className="atp-vertical-head">
              <button
                type="button"
                className="atp-vertical-toggle"
                aria-expanded={expanded}
                onClick={() => setOpen((o) => ({ ...o, [v.id]: !o[v.id] }))}
              >
                <span className="atp-caret">{expanded ? '▾' : '▸'}</span>
                <span className="atp-vertical-name">{v.displayName || v.id}</span>
              </button>
              <div className="atp-brandfetch-controls">
                <input
                  type="text"
                  placeholder="Domain (e.g. united.com)"
                  value={brandDomain[v.id] || ''}
                  onChange={(e) => setBrandDomain((d) => ({ ...d, [v.id]: e.target.value }))}
                  className="atp-brandfetch-input"
                />
                <button
                  type="button"
                  className="atp-reset-all"
                  onClick={() => fetchBrand(v.id)}
                  disabled={brandStatus[v.id] === 'loading' || !(brandDomain[v.id] || '').trim()}
                >
                  {brandStatus[v.id] === 'loading' ? 'Fetching…' : 'Fetch from Brandfetch'}
                </button>
                {brandStatus[v.id] && brandStatus[v.id] !== 'loading' && (
                  <span className="atp-brandfetch-status">{brandStatus[v.id]}</span>
                )}
                <button type="button" className="atp-reset-all" onClick={() => resetAll(v.id)}>
                  Reset all
                </button>
              </div>
            </div>
            {expanded && (
              <div className="atp-vertical-body">
                <ThemeZonePanel key={`${v.id}:${nonce[v.id] || 0}`} verticalId={v.id} />
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
