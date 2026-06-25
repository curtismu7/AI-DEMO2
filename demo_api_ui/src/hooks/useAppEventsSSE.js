// banking_api_ui/src/hooks/useAppEventsSSE.js
/**
 * Subscribe to live app events via SSE (/api/app-events/stream).
 * Calls onEvent(event) for each new event pushed by the server.
 * Falls back to silent no-op if EventSource is unavailable.
 *
 * @param {(event: object) => void} onEvent
 * @param {{ category?: string, severity?: string, enabled?: boolean }} [opts]
 */
import { useEffect, useRef } from 'react';

export function useAppEventsSSE(onEvent, opts = {}) {
  const { category, severity, enabled = true } = opts;
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  useEffect(() => {
    if (!enabled || typeof EventSource === 'undefined') return;

    const params = new URLSearchParams();
    if (category) params.set('category', category);
    if (severity) params.set('severity', severity);
    const url = `/api/app-events/stream${params.toString() ? `?${params}` : ''}`;

    let es;
    try {
      es = new EventSource(url);
    } catch (_) {
      return;
    }

    const handle = (ev) => {
      try {
        const data = JSON.parse(ev.data);
        onEventRef.current(data);
      } catch (_) {}
    };

    // The server emits NAMED 'app-event' SSE messages (event: app-event), which
    // do not trigger onmessage. Listen for both so named events are delivered.
    es.onmessage = handle;
    es.addEventListener('app-event', handle);

    es.onerror = (err) => {
      if (err.eventPhase === EventSource.CLOSED) {
        console.debug(`[AppEventsSSE] Stream closed: ${url}`);
      } else {
        console.warn(`[AppEventsSSE] Stream error on ${url}:`, err.message);
      }
    };

    return () => {
      try { es.removeEventListener('app-event', handle); } catch (_) {}
      try { es.close(); } catch (_) {}
    };
  }, [enabled, category, severity]); // eslint-disable-line react-hooks/exhaustive-deps
}
