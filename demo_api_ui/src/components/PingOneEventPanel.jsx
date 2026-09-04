// demo_api_ui/src/components/PingOneEventPanel.jsx
import React, { useState, useEffect, useRef } from 'react';
import { useActivityLog } from '../hooks/useActivityLog';
import './PingOneEventPanel.css';

function statusIcon(status) {
  if (status === 'SUCCESS') return '✅';
  if (status === 'FAILED' || status === 'FAILURE') return '❌';
  return '⚠️';
}

function relativeTime(ts) {
  if (!ts) return '';
  const diff = Date.now() - new Date(ts).getTime();
  if (diff < 60000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  return new Date(ts).toLocaleTimeString();
}

// Live SSE entries come from appEventService.logEvent (webhookPingOne.js) with
// eventId/eventType/actorId/status nested under `metadata`, while the initial
// /api/pingone-events history fetch returns them flat. Normalize to the flat
// shape so both sources render the same label and dedup on the same eventId.
function normalizeStreamEvent(e) {
  return {
    eventId: e.metadata?.eventId ?? e.id,
    eventType: e.metadata?.eventType ?? null,
    actorId: e.metadata?.actorId ?? null,
    status: e.metadata?.status ?? null,
    timestamp: e.metadata?.timestamp ?? e.timestamp,
  };
}

export default function PingOneEventPanel() {
  const [events, setEvents] = useState([]);
  const [expanded, setExpanded] = useState(null);
  const hasFetched = useRef(false);

  useEffect(() => {
    if (hasFetched.current) return;
    hasFetched.current = true;
    fetch('/api/pingone-events?limit=50')
      .then((r) => (r.ok ? r.json() : { events: [] }))
      .then((data) => {
        const history = data.events || [];
        // Merge, don't replace: a live SSE event can land in `events` before
        // this fetch resolves, and a plain setEvents(history) would silently
        // drop it since it predates the REST snapshot.
        setEvents((prev) => {
          const seen = new Set(history.map((e) => e.eventId));
          const liveOnly = prev.filter((e) => e.eventId != null && !seen.has(e.eventId));
          return [...liveOnly, ...history].slice(0, 200);
        });
      })
      .catch(() => {});
  }, []);

  // useActivityLog's list is newest-first and capped at 200 (a ring buffer),
  // not an ever-growing append-only array — so "new since last render" can't
  // be found by index/length. Re-derive the pingone-tagged subset each time
  // and dedup by eventId against what's already shown instead.
  const { events: streamEvents } = useActivityLog({ enabled: true });
  useEffect(() => {
    const seenInBatch = new Set();
    const p1Events = streamEvents
      .filter((e) => e.tag === 'pingone/event')
      .map(normalizeStreamEvent)
      .filter((e) => {
        if (e.eventId == null || seenInBatch.has(e.eventId)) return false;
        seenInBatch.add(e.eventId);
        return true;
      });
    if (p1Events.length === 0) return;
    setEvents((prev) => {
      const seen = new Set(prev.map((e) => e.eventId));
      const fresh = p1Events.filter((e) => !seen.has(e.eventId));
      if (fresh.length === 0) return prev;
      return [...fresh, ...prev].slice(0, 200);
    });
  }, [streamEvents]);

  return (
    <div className="pingone-event-panel">
      <div className="pingone-event-panel__header">
        <span className="pingone-event-panel__title">PingOne Events</span>
        <span className="pingone-event-panel__badge">{events.length}</span>
      </div>
      {events.length === 0 ? (
        <div className="pingone-event-panel__empty">No events received yet</div>
      ) : (
        <div className="pingone-event-panel__list">
          {events.map((ev, idx) => (
            <div
              key={ev.eventId ?? ev.id ?? idx}
              className="pingone-event-panel__row"
              onClick={() => setExpanded((p) => (p === ev.eventId ? null : ev.eventId))}
            >
              <span className="pingone-event-panel__icon">
                {statusIcon(ev.status)}
              </span>
              <span className="pingone-event-panel__body">
                <span className="pingone-event-panel__type">
                  {ev.eventType || 'event'}
                </span>
                {ev.actorId && (
                  <span className="pingone-event-panel__meta">{ev.actorId}</span>
                )}
              </span>
              <span className="pingone-event-panel__time">
                {relativeTime(ev.timestamp)}
              </span>
              {expanded === ev.eventId && (
                <div className="pingone-event-panel__detail">
                  {JSON.stringify(ev, null, 2)}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
