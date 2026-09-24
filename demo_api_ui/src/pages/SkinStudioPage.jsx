// demo_api_ui/src/pages/SkinStudioPage.jsx
//
// One admin page for a vertical's skin: Theme (per-zone palettes),
// Logo (upload/remove), and Duplicate (clone with skin config). Consolidates
// what previously lived in AdminThemesPage + the VerticalEditorPage's clone
// modal. Theme picks still go through ThemeZonePanel; logo through the T3
// logo endpoints; duplicate through /clone with cloneOverlay/cloneTheme.
import React, { useEffect, useState, useCallback } from 'react';
import apiClient from '../services/apiClient';
import ThemeZonePanel from '../components/ThemeZonePanel';
import LogoUploader from '../vertical/AdminEditor/LogoUploader';
import { useVertical } from '../vertical/useVertical';
import { useThemeOptional } from '../context/ThemeContext';
import { cssVarsFromBrand } from '../config/themeZones';
import './SkinStudioPage.css';

const ID_REGEX = /^[a-z][a-z0-9-]*$/;

export default function SkinStudioPage() {
  const { refetch } = useVertical();
  const { darkMode, toggleDarkMode } = useThemeOptional();
  const [verticals, setVerticals] = useState(null); // null = loading
  const [selected, setSelected] = useState(null);
  const [tab, setTab] = useState('theme');
  const [nonce, setNonce] = useState(0); // remount ThemeZonePanel after reset/brandfetch

  // Duplicate form state
  const [newId, setNewId] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [cloneOverlay, setCloneOverlay] = useState(true);
  const [cloneTheme, setCloneTheme] = useState(true);
  const [dupStatus, setDupStatus] = useState(null); // 'busy' | message string
  const [brandDomain, setBrandDomain] = useState('');
  const [brandStatus, setBrandStatus] = useState(null);

  useEffect(() => {
    let cancelled = false;
    apiClient.get('/api/verticals/list')
      .then((res) => {
        if (cancelled) return;
        const list = Array.isArray(res.data) ? res.data : [];
        setVerticals(list);
        if (list.length && selected === null) setSelected(list[0].id);
      })
      .catch(() => { if (!cancelled) setVerticals([]); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const current = verticals && verticals.find((v) => v.id === selected);

  const resetAll = useCallback(async (id) => {
    try {
      await apiClient.delete(`/api/admin/vertical-themes/${id}`);
      setNonce((n) => n + 1);
      refetch();
    } catch { /* ignore */ }
  }, [refetch]);

  const fetchBrand = useCallback(async (id) => {
    const domain = brandDomain.trim();
    if (!domain) return;
    setBrandStatus('loading');
    try {
      const res = await apiClient.post(`/api/verticals/${id}/brandfetch`, { domain });
      const body = res.data || {};
      const cssVars = cssVarsFromBrand(body.primary, body.accent || body.primary);
      await apiClient.put(`/api/admin/vertical-themes/${id}`, { cssVars });
      if (body.logoPath) {
        await apiClient.post(`/api/verticals/${id}/overlay`, {
          path: 'identity.logoPath', value: body.logoPath,
        });
      }
      setNonce((n) => n + 1);
      setBrandStatus(`applied${body.fontName ? ` — font: ${body.fontName}` : ''}`);
      refetch();
    } catch (err) {
      setBrandStatus(err?.response?.data?.error || 'failed');
    }
  }, [brandDomain, refetch]);

  const duplicate = useCallback(async (e) => {
    e.preventDefault();
    setDupStatus(null);
    if (!ID_REGEX.test(newId)) {
      setDupStatus('id must be lowercase letters/numbers/hyphens, starting with a letter');
      return;
    }
    if (!displayName.trim()) {
      setDupStatus('display name required');
      return;
    }
    if ((verticals || []).some((v) => v.id === newId)) {
      setDupStatus('id already exists');
      return;
    }
    setDupStatus('busy');
    try {
      await apiClient.post(`/api/verticals/${selected}/clone`, {
        newId, displayName: displayName.trim(), cloneOverlay, cloneTheme,
      });
      setDupStatus(`Created ${newId} — it now appears in the vertical switcher`);
      setNewId('');
      setDisplayName('');
      const res = await apiClient.get('/api/verticals/list');
      setVerticals(Array.isArray(res.data) ? res.data : []);
      refetch();
    } catch (err) {
      setDupStatus(err?.response?.data?.error || 'duplicate failed');
    }
  }, [selected, newId, displayName, cloneOverlay, cloneTheme, verticals, refetch]);

  const existingIds = (verticals || []).map((v) => v.id);

  return (
    <div className="skin-studio">
      <button
        type="button"
        onClick={toggleDarkMode}
        className="ss-theme-toggle"
        title="Switch this page between light and dark"
        aria-pressed={darkMode}
      >
        {darkMode ? '☀️ Light mode' : '🌙 Dark mode'}
      </button>
      <h1 className="ss-title">Skin Studio</h1>
      <p className="ss-sub">
        One place per vertical: colors, logo, and duplicate. Theme changes apply
        live; logo and duplicate take effect immediately after save.
      </p>

      {verticals === null && <div className="ss-empty">Loading verticals…</div>}
      {verticals && verticals.length === 0 && <div className="ss-empty">No verticals available.</div>}

      {verticals && verticals.length > 0 && (
        <div className="ss-layout">
          <nav className="ss-vertical-list" aria-label="Verticals">
            {verticals.map((v) => (
              <button
                key={v.id}
                type="button"
                className={`ss-vertical-item${v.id === selected ? ' ss-vertical-list__item--on' : ''}`}
                aria-pressed={v.id === selected}
                onClick={() => { setSelected(v.id); setDupStatus(null); }}
              >
                {v.displayName || v.id}
              </button>
            ))}
          </nav>

          <section className="ss-workbench">
            <h2 className="ss-vertical-name">{current ? (current.displayName || selected) : ''}</h2>
            <div className="ss-tabs" role="tablist">
              {[
                ['theme', 'Theme'],
                ['logo', 'Logo'],
                ['duplicate', 'Duplicate'],
              ].map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={tab === id}
                  className={`ss-tab${tab === id ? ' ss-tab--on' : ''}`}
                  onClick={() => setTab(id)}
                >
                  {label}
                </button>
              ))}
            </div>

            {tab === 'theme' && (
              <div className="ss-tab-body">
                <div className="ss-brandfetch">
                  <input
                    type="text"
                    placeholder="Domain (e.g. united.com)"
                    value={brandDomain}
                    onChange={(e) => setBrandDomain(e.target.value)}
                    className="ss-brandfetch-input"
                  />
                  <button
                    type="button"
                    className="ss-action"
                    disabled={brandStatus === 'busy' || !brandDomain.trim()}
                    onClick={() => fetchBrand(selected)}
                  >
                    {brandStatus === 'busy' ? 'Fetching…' : 'Fetch from Brandfetch'}
                  </button>
                  {brandStatus && brandStatus !== 'busy' && (
                    <span className="ss-brandfetch-status">{brandStatus}</span>
                  )}
                  <button type="button" className="ss-action" onClick={() => resetAll(selected)}>
                    Reset all
                  </button>
                </div>
                <ThemeZonePanel key={`${selected}:${nonce}`} verticalId={selected} />
              </div>
            )}

            {tab === 'logo' && (
              <div className="ss-tab-body">
                <LogoUploader verticalId={selected} onLogoChanged={refetch} />
              </div>
            )}

            {tab === 'duplicate' && (
              <form className="ss-duplicate ss-tab-body" onSubmit={duplicate}>
                <p className="ss-duplicate-intro">
                  Creates a new vertical from <strong>{selected}</strong>.
                  {cloneTheme && ' Colors and logo are copied.'}
                  {cloneOverlay && ' Runtime edits are copied.'}
                </p>
                <label className="ss-field">
                  New id (lowercase, hyphens)
                  <input
                    value={newId}
                    onChange={(e) => setNewId(e.target.value)}
                    placeholder={existingIds.includes(`${selected}-copy`) ? 'id taken' : `e.g. ${selected}-copy`}
                  />
                  {newId && existingIds.includes(newId) && (
                    <span className="ss-error">id already exists</span>
                  )}
                </label>
                <label className="ss-field">
                  Display name
                  <input
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder={current ? `${current.displayName} copy` : 'Display name'}
                  />
                </label>
                <label className="ss-check">
                  <input type="checkbox" checked={cloneOverlay} onChange={(e) => setCloneOverlay(e.target.checked)} />
                  Copy runtime edits (overrides)
                </label>
                <label className="ss-check">
                  <input type="checkbox" checked={cloneTheme} onChange={(e) => setCloneTheme(e.target.checked)} />
                  Copy colors and logo
                </label>
                <button type="submit" className="ss-action ss-action--primary" disabled={dupStatus === 'busy'}>
                  {dupStatus === 'busy' ? 'Creating…' : 'Duplicate'}
                </button>
                {dupStatus && dupStatus !== 'busy' && (
                  <div className="ss-duplicate-status" role="status">{dupStatus}</div>
                )}
              </form>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
