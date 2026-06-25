// demo_api_ui/src/pages/AdminThemesPage.jsx
//
// Admin management surface for per-vertical theme zones. Lists every vertical
// with a ThemeZonePanel (grouped per-zone palette picker) + a per-vertical
// "Reset all". See skill: vertical-theme-zones.
import React, { useEffect, useState, useCallback } from 'react';
import ThemeZonePanel from '../components/ThemeZonePanel';
import { useVertical } from '../vertical/useVertical';
import './AdminThemesPage.css';

export default function AdminThemesPage() {
  const { refetch } = useVertical();
  const [verticals, setVerticals] = useState(null); // null = loading
  const [open, setOpen] = useState({});             // verticalId → expanded
  const [nonce, setNonce] = useState({});           // verticalId → remount key (after reset-all)

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
      <h1 className="atp-title">Vertical Themes</h1>
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
              <button type="button" className="atp-reset-all" onClick={() => resetAll(v.id)}>
                Reset all
              </button>
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
