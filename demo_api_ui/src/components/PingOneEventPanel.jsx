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

export default function PingOneEventPanel() {
  const [events, setEvents] = useState([]);
  const [expanded, setExpanded] = useState(null);
  const hasFetched = useRef(false);

  useEffect(() => {
    if (hasFetched.current) return;
    hasFetched.current = true;
    fetch('/api/pingone-events?limit=50')
      .then((r) => (r.ok ? r.json() : { events: [] }))
      .then((data) => setEvents(data.events || []))
      .catch(() => {});
  }, []);

  const { events: streamEvents } = useActivityLog({ enabled: true });
  const prevStreamLen = useRef(0);
  useEffect(() => {
    if (streamEvents.length === prevStreamLen.current) return;
    const newOnes = streamEvents.slice(prevStreamLen.current);
    prevStreamLen.current = streamEvents.length;
    const p1Events = newOnes.filter((e) => e.tag === 'pingone/event');
    if (p1Events.length === 0) return;
    setEvents((prev) => [...p1Events, ...prev].slice(0, 200));
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
          {events.map((ev) => (
            <div
              key={ev.eventId}
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
