import React, { useCallback, useEffect, useRef, useState } from 'react';
import InlineSpinner from './shared/InlineSpinner';

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
  // Polite, visible announcement of the last add / remove, or of what is missing when the
  // add button is pressed with nothing typed.
  const [status, setStatus] = useState('');
  const inputRef = useRef(null);
  const listRef = useRef(null);
  // Index of the row just removed: focus goes to the row now in its place, else the input.
  const focusIndexRef = useRef(null);

  useEffect(() => {
    const idx = focusIndexRef.current;
    if (idx === null) return;
    focusIndexRef.current = null;
    const buttons = listRef.current ? listRef.current.querySelectorAll('.wbl__remove') : [];
    const target = buttons.length ? buttons[Math.min(idx, buttons.length - 1)] : inputRef.current;
    target?.focus();
  }, [cities]);

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
      if (busy) return;
      if (!city) {
        setStatus('Enter a city to block first, for example Denver, CO.');
        return;
      }
      setBusy(true);
      setError(null);
      setStatus('');
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
          setStatus(`Blocked ${city}. ${(data.cities || []).length} blocked.`);
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
    if (busy) return;
    setBusy(true);
    setError(null);
    setStatus('');
    try {
      const res = await fetch(`/api/weather-blocklist/${encodeURIComponent(label)}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) setError(data.error || `Could not remove ${label}.`);
      else {
        // The removed row's button is gone: keep keyboard focus on the page, not on <body>.
        focusIndexRef.current = Math.max(0, (cities || []).findIndex((c) => c.label === label));
        setCities(data.cities || []);
        setStatus(`Removed ${label}. ${(data.cities || []).length} blocked.`);
      }
    } catch (err) {
      setError(err.message || 'Could not reach the server.');
    } finally {
      setBusy(false);
    }
  }, [busy, cities]);

  return (
    <div className="wbl">
      <ul className="wbl__list" ref={listRef}>
        {cities === null ? (
          <li className="wbl__empty"><InlineSpinner label="Loading…" /></li>
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
                className="pu-btn wbl__remove"
                onClick={() => remove(c.label)}
                aria-disabled={busy ? 'true' : undefined}
                aria-label={`Remove ${c.label}`}
              >
                ✕
              </button>
            </li>
          ))
        )}
      </ul>

      <form className="wbl__add" onSubmit={add}>
        <label className="pu-label wbl__label" htmlFor="wbl-city">
          City to block
        </label>
        <input
          id="wbl-city"
          type="text"
          className="wbl__input"
          placeholder="Denver, CO"
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            setStatus('');
          }}
          aria-describedby="wbl-status"
          ref={inputRef}
          readOnly={busy}
        />
        <button
          type="submit"
          className="pu-btn wbl__btn"
          aria-disabled={busy || !input.trim() ? 'true' : undefined}
        >
          {busy ? 'Working…' : 'Block city'}
        </button>
      </form>

      <div id="wbl-status" className="wbl__status" role="status">
        {status}
      </div>

      {error ? (
        <p className="wbl__error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
