// demo_api_ui/src/components/ThemeZonePanel.js
//
// Admin-only per-zone palette picker for a single vertical. Renders one swatch
// row per zone (grouped), persists picks via /api/admin/vertical-themes, and
// refetches /me so the change applies live. Shared by VerticalSwitcher (config
// variant) and the admin Themes page. See skill: vertical-theme-zones.
import React, { useEffect, useState, useCallback } from 'react';
import { PALETTES } from '../config/designSystems';
import { THEME_ZONES, ZONE_GROUPS, resolveZoneCssVars, matchPaletteForZone } from '../config/themeZones';
import { useVertical } from '../vertical/useVertical';
import './ThemeZonePanel.css';

export default function ThemeZonePanel({ verticalId }) {
  const { refetch } = useVertical();
  const [overrides, setOverrides] = useState({});
  const [toast, setToast] = useState(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/admin/vertical-themes', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : {}))
      .then((data) => { if (!cancelled) setOverrides((data && data[verticalId]) || {}); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [verticalId]);

  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  const persist = useCallback((method, body) =>
    fetch(`/api/admin/vertical-themes/${verticalId}`, {
      method,
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then(() => refetch()), [verticalId, refetch]);

  const applyPalette = async (zone, palette) => {
    const cssVars = resolveZoneCssVars(zone, palette);
    setOverrides((prev) => ({ ...prev, ...cssVars })); // optimistic
    try { await persist('PUT', { cssVars }); setToast(`${palette.name} applied to ${zone.label}`); } catch { /* keep optimistic */ }
  };

  const resetZone = async (zone) => {
    setOverrides((prev) => {
      const next = { ...prev };
      zone.vars.forEach((v) => delete next[v]);
      return next;
    });
    try { await persist('DELETE', { vars: zone.vars }); setToast(`${zone.label} reset to default`); } catch { /* keep optimistic */ }
  };

  // Roving arrow-key focus within a swatch row.
  const onRowKeyDown = (e) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const buttons = Array.from(e.currentTarget.querySelectorAll('button'));
    const i = buttons.indexOf(document.activeElement);
    if (i === -1) return;
    e.preventDefault();
    const n = e.key === 'ArrowRight' ? (i + 1) % buttons.length : (i - 1 + buttons.length) % buttons.length;
    buttons[n].focus();
  };

  return (
    <div className="theme-zone-panel">
      {ZONE_GROUPS.map((group) => (
        <div key={group} className="tzp-group">
          <div className="tzp-group-label">{group}</div>
          {THEME_ZONES.filter((z) => z.group === group).map((zone) => {
            const selected = matchPaletteForZone(zone, overrides);
            return (
              <div key={zone.key} className="tzp-row">
                <span className="tzp-zone-label">{zone.label}</span>
                <div className="tzp-swatches" role="group" aria-label={zone.label} onKeyDown={onRowKeyDown}>
                  {PALETTES.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      className={`tzp-swatch${selected === p.id ? ' tzp-swatch--on' : ''}`}
                      style={{ background: p.swatchColor }}
                      title={p.name}
                      aria-label={`${zone.label}: ${p.name}`}
                      aria-pressed={selected === p.id}
                      onClick={() => applyPalette(zone, p)}
                    />
                  ))}
                  <button
                    type="button"
                    className="tzp-swatch tzp-swatch--reset"
                    title={`Reset ${zone.label} to default`}
                    aria-label={`Reset ${zone.label} to default`}
                    onClick={() => resetZone(zone)}
                  >
                    ↺
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      ))}
      {toast && <div className="tzp-toast" role="status" aria-live="polite">{toast}</div>}
    </div>
  );
}
