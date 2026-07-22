import React, { useState, useEffect, useCallback } from 'react';

const FLAG_ID = 'ff_weather_mcp_allowed_state';
const OPTIONS = [
  { value: 'texas', label: 'Texas' },
  { value: 'michigan', label: 'Michigan' },
  { value: 'any', label: 'Any (no restriction)' },
];

/**
 * Inline admin control for the weather-mcp showcase capability card: which US
 * state the Agent Gateway currently allows through /mcp/weather. Reads and
 * writes ff_weather_mcp_allowed_state via the existing feature-flags API —
 * self-contained, no shared state with the rest of the Capability Tour page.
 */
export default function WeatherStateControl() {
  const [value, setValue] = useState('texas');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

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
