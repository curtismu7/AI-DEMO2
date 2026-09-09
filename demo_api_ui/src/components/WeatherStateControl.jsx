import React, { useState, useEffect, useCallback, useRef } from 'react';

const FLAG_ID = 'ff_weather_mcp_allowed_state';
// The flag's registered default (routes/featureFlags.js). UC30/UC31 in the
// Demo Steps script assume it: Austin permits, Miami denies.
const DEFAULT_STATE = 'texas';
const OPTIONS = [
  { value: 'texas', label: 'Texas' },
  { value: 'michigan', label: 'Michigan' },
  { value: 'any', label: 'Any (no restriction)' },
  { value: 'any-except-blocked', label: 'Any except blocked cities' },
];

/**
 * Inline admin control for the weather-mcp showcase capability card: which US
 * state the Agent Gateway currently allows through /mcp/weather. Reads and
 * writes ff_weather_mcp_allowed_state via the existing feature-flags API —
 * self-contained, no shared state with the rest of the Capability Tour page.
 */
export default function WeatherStateControl() {
  const [value, setValue] = useState(DEFAULT_STATE);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  // Last value this control successfully saved during this visit. The flag is
  // live and sticky: a presenter who flipped it to "Any" for UC32 and moved on
  // left UC31 (Miami) permitting on the next pass of the script until someone
  // ran reset-demo. Leaving the page puts the policy back to its default.
  const savedRef = useRef(null);

  useEffect(() => () => {
    if (savedRef.current && savedRef.current !== DEFAULT_STATE) {
      fetch('/api/admin/feature-flags', {
        method: 'PATCH',
        credentials: 'include',
        keepalive: true,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ updates: { [FLAG_ID]: DEFAULT_STATE } }),
      }).catch(() => { /* best-effort — reset-demo remains the backstop */ });
    }
  }, []);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/feature-flags', { credentials: 'include' });
      if (!res.ok) return;
      const data = await res.json();
      const flag = (data.flags || []).find((f) => f.id === FLAG_ID);
      if (flag && flag.value) setValue(flag.value);
    } catch (_) {
      // silent — control just keeps its default
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleChange = async (e) => {
    const next = e.target.value;
    const prev = value;
    setValue(next);
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/feature-flags', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ updates: { [FLAG_ID]: next } }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      const confirmed = (data.flags || []).find((f) => f.id === FLAG_ID);
      if (confirmed) setValue(confirmed.value);
      savedRef.current = confirmed ? confirmed.value : next;
    } catch (err) {
      setValue(prev);
      setError(`Failed to save: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="weather-state-control">
      <label className="weather-state-control__label">
        Allowed state
        <select value={value} onChange={handleChange} disabled={saving}>
          {OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </label>
      {error && <span className="weather-state-control__error">{error}</span>}
    </div>
  );
}
