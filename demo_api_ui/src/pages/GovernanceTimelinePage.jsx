import { useEffect, useMemo, useState } from 'react';
import './GovernanceTimelinePage.css';
import InlineSpinner from '../components/shared/InlineSpinner';
import PageHeader from '../components/common/PageHeader';

const LANES = [
  { id: 'all', label: 'All activity' },
  { id: 'identity', label: 'Identity & NHI' },
  { id: 'authorization', label: 'Authorization' },
  { id: 'privilege', label: 'Privilege' },
  { id: 'governance', label: 'Governance' },
];

const CATEGORY_LANES = {
  agent: 'identity',
  auth_lifecycle: 'identity',
  oauth: 'identity',
  session: 'identity',
  jwks: 'identity',
  authorize: 'authorization',
  gateway_path: 'authorization',
  token_exchange: 'authorization',
  mcp: 'authorization',
  delegation: 'privilege',
  hitl: 'privilege',
  threshold: 'privilege',
  introspection: 'governance',
  helix: 'governance',
  pingone: 'governance',
  agent_prompt: 'governance',
};

function laneForEvent(event) {
  return CATEGORY_LANES[event?.category] || 'governance';
}

function eventText(event) {
  return event?.message || event?.description || event?.type || 'Lifecycle event recorded';
}

function formatTimestamp(value) {
  if (!value) return 'Time unavailable';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

export default function GovernanceTimelinePage() {
  const [events, setEvents] = useState([]);
  const [activeLane, setActiveLane] = useState('all');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/app-events?limit=100', { credentials: 'include' })
      .then((response) => (response.ok ? response.json() : { events: [] }))
      .then((body) => {
        if (!cancelled) setEvents(Array.isArray(body?.events) ? body.events : []);
      })
      .catch(() => {
        if (!cancelled) setEvents([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  const filteredEvents = useMemo(
    () => activeLane === 'all' ? events : events.filter((event) => laneForEvent(event) === activeLane),
    [activeLane, events],
  );

  return (
    <main className="governance-timeline-page">
      <PageHeader
        eyebrow="Evidence & Governance"
        title="Governance Timeline"
        summary="Follow the evidence from identity and NHI registration through authorization, privilege, and accountable outcomes."
      />

      <nav className="governance-timeline-page__filters" aria-label="Governance timeline lanes">
        {LANES.map((lane) => (
          <button
            key={lane.id}
            type="button"
            className={activeLane === lane.id ? 'is-active' : ''}
            aria-pressed={activeLane === lane.id}
            onClick={() => setActiveLane(lane.id)}
          >
            {lane.label}
          </button>
        ))}
      </nav>

      <section className="governance-timeline-page__timeline" aria-live="polite">
        {loading && <p className="governance-timeline-page__empty"><InlineSpinner label="Loading governance evidence…" /></p>}
        {!loading && filteredEvents.length === 0 && (
          <p className="governance-timeline-page__empty">No evidence is available for this lane yet.</p>
        )}
        {!loading && filteredEvents.map((event, index) => {
          const lane = LANES.find((item) => item.id === laneForEvent(event));
          const useCaseId = event?.useCaseId || event?.metadata?.useCaseId;
          return (
            <article className="governance-timeline-event" key={event?.id || `${event?.timestamp || 'event'}-${index}`}>
              <div className={`governance-timeline-event__marker governance-timeline-event__marker--${lane?.id || 'governance'}`} />
              <div className="governance-timeline-event__content">
                <div className="governance-timeline-event__meta">
                  <span>{lane?.label || 'Governance'}</span>
                  <time dateTime={event?.timestamp}>{formatTimestamp(event?.timestamp)}</time>
                </div>
                <p>{eventText(event)}</p>
                {useCaseId && <span className="governance-timeline-event__use-case">{useCaseId}</span>}
              </div>
            </article>
          );
        })}
      </section>
    </main>
  );
}
