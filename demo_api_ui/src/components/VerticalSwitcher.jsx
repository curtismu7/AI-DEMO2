// banking_api_ui/src/components/VerticalSwitcher.jsx
import { useState, useEffect } from 'react';
import { useVertical } from '../vertical/useVertical';
import ThemeZonePanel from './ThemeZonePanel';
import './VerticalSwitcher.css';

/**
 * Dropdown/pill selector for switching between demo verticals (Banking, Retail, Workforce).
 * Can be placed in the top nav or on the Config page.
 */
export default function VerticalSwitcher({ variant = 'nav' }) {
  const { activeId } = useVertical();
  const [verticals, setVerticals] = useState([]);
  const [switching, setSwitching] = useState(false);

  useEffect(() => {
    // GET /api/verticals/list returns { id, displayName, tagline, theme }
    fetch('/api/verticals/list', { credentials: 'include' })
      .then(r => r.ok ? r.json() : [])
      .then(data => setVerticals(Array.isArray(data) ? data : []))
      .catch(() => {});
    // Re-fetch on vertical-list-changed (clone / delete) so the switcher stays
    // in sync without a full reload.
    const onListChanged = () => {
      fetch('/api/verticals/list', { credentials: 'include' })
        .then(r => r.ok ? r.json() : [])
        .then(data => setVerticals(Array.isArray(data) ? data : []))
        .catch(() => {});
    };
    window.addEventListener('vertical-list-changed', onListChanged);
    return () => window.removeEventListener('vertical-list-changed', onListChanged);
  }, []);

  const handleSwitch = async (id) => {
    if (id === activeId || switching) return;
    setSwitching(true);
    try {
      await fetch('/api/verticals/active', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      setSwitching(false);
    } catch {
      setSwitching(false);
    }
  };

  const getPrimaryColor = (v) => {
    return v.theme?.cssVars?.['--app-primary-red'] || '#6b7280';
  };

  if (verticals.length < 2) return null;

  if (variant === 'config' || variant === 'pills') {
    return (
      <div className={`vertical-switcher vertical-switcher--config${variant === 'pills' ? ' vertical-switcher--pills' : ''}`}>
        <div className="vertical-switcher__pills">
          {verticals.map(v => {
            const primaryColor = getPrimaryColor(v);
            return (
              <button
                type="button"
                key={v.id}
                className={`vertical-switcher__pill${v.id === activeId ? ' vertical-switcher__pill--active' : ''}`}
                onClick={() => handleSwitch(v.id)}
                disabled={switching}
                style={v.id === activeId ? { borderColor: primaryColor, background: `${primaryColor}10` } : undefined}
              >
                <span
                  className="vertical-switcher__dot"
                  style={{ background: primaryColor }}
                  aria-hidden="true"
                >
                  {' '}
                </span>
                <span className="vertical-switcher__label">{v.displayName}</span>
                {variant === 'config' && (
                  <span className="vertical-switcher__tagline">{v.tagline}</span>
                )}
              </button>
            );
          })}
        </div>
        {variant === 'config' && activeId && (
          <div className="vertical-switcher__themes">
            <div className="vertical-switcher__themes-title">Theme — {activeId}</div>
            <ThemeZonePanel verticalId={activeId} />
          </div>
        )}
      </div>
    );
  }

  // Nav variant — compact dropdown
  return (
    <div className="vertical-switcher vertical-switcher--nav">
      <select
        className="vertical-switcher__select"
        value={activeId || 'banking'}
        onChange={(e) => handleSwitch(e.target.value)}
        disabled={switching}
        aria-label="Switch demo vertical"
      >
        {verticals.map(v => (
          <option key={v.id} value={v.id}>{v.displayName}</option>
        ))}
      </select>
    </div>
  );
}
