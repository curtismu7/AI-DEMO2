import React, { useCallback, useEffect, useState } from 'react';

/**
 * Admin editor for the weather-mcp deny list, shown on the Weather MCP page
 * beside the Allowed-region dropdown.
 *
 * Adding a city geocodes it server-side ONCE and stores coordinates alongside
 * the name, because the gateway sees two call shapes: a demo chip sends
 * `city_name`, but a typed prompt sends `latitude`/`longitude` (the agent
 * resolves the name via weather-mcp's search_location first). A name-only deny
 * would pass every scripted chip and then fail on the first typed city — so the
 * coordinates are the point, and the UI says so rather than hiding it.
 */
export default function WeatherBlocklistControl() {
  const [cities, setCities] = useState(null);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/weather-blocklist', { credentials: 'include' });
      if (!res.ok) return;
      const data = await res.json();
      setCities(Array.isArray(data.cities) ? data.cities : []);
    } catch (_) {
      /* leave the list unknown rather than claiming it is empty */
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const add = useCallback(
    async (e) => {
      e.preventDefault();
      const city = input.trim();
      if (!city || busy) return;
      setBusy(true);
      setError(null);
      try {
        const res = await fetch('/api/weather-blocklist', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ city }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(data.error || `Could not add ${city}.`);
        } else {
          setCities(data.cities || []);
          setInput('');
        }
      } catch (err) {
        setError(err.message || 'Could not reach the server.');
      } finally {
        setBusy(false);
      }
    },
    [input, busy],
  );

  const remove = useCallback(async (label) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/weather-blocklist/${encodeURIComponent(label)}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) setError(data.error || `Could not remove ${label}.`);
      else setCities(data.cities || []);
    } catch (err) {
      setError(err.message || 'Could not reach the server.');
    } finally {
      setBusy(false);
    }
  }, []);

  return (
    <div className="wbl">
      <ul className="wbl__list">
        {cities === null ? (
          <li className="wbl__empty">Loading…</li>
        ) : cities.length === 0 ? (
          <li className="wbl__empty">
            No cities blocked — every location passes while this mode is selected.
          </li>
        ) : (
          cities.map((c) => (
            <li key={c.label} className="wbl__item">
              <span className="wbl__label">{c.label}</span>
              <span className="wbl__coords">
                {Number(c.lat).toFixed(3)}, {Number(c.lon).toFixed(3)}
              </span>
              <button
                type="button"
                className="wbl__remove"
                onClick={() => remove(c.label)}
                disabled={busy}
                aria-label={`Remove ${c.label}`}
              >
                ✕
              </button>
            </li>
          ))
        )}
      </ul>

      <form className="wbl__add" onSubmit={add}>
        <label className="wbl__srlabel" htmlFor="wbl-city">
          City to block
        </label>
        <input
          id="wbl-city"
          type="text"
          className="wbl__input"
          placeholder="Denver, CO"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={busy}
        />
        <button type="submit" className="wbl__btn" disabled={busy || !input.trim()}>
          {busy ? 'Working…' : 'Block city'}
        </button>
      </form>

      {error ? (
        <p className="wbl__error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
