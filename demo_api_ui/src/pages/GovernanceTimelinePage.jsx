// /governance-timeline — the evidence trail: what this app's BFF recorded, grouped into four lanes
// (Identity & NHI, Authorization, Privilege, Governance), newest first.
//
// Honesty: nothing on this page is simulated. Each row is an event the BFF actually recorded in its
// app-event log (GET /api/app-events, last 100 of a 200-event buffer). The log records what the demo did,
// so a mock-mode run is recorded as an event like any other and carries no "simulated" mark here.
//
// Layout follows the standalone Ping UI Standard (AI-DEMO-Standalone/shared/STANDALONE-UI-PATTERNS.md)
// through the shared primitives (components/pingUi, docs/ping-ui-primitives.md): P2 banner first, P3 frame,
// P4 cards, P5 kv, P7 chips, P9 buttons. P9 "one primary per view": the page has one action, "Refresh
// evidence", which is the primary in every state (loading, loaded, empty, unavailable). While it runs it
// takes aria-disabled, not disabled, so keyboard focus stays on it. The five lane buttons are filters, not
// actions: they are secondaries and show the chosen lane with aria-pressed (page CSS marks it).
// Page CSS keeps only the timeline shape.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './GovernanceTimelinePage.css';
import InlineSpinner from '../components/shared/InlineSpinner';
import PageHeader from '../components/common/PageHeader';
import {
  PingPage, SimBanner, PageFrame, Section, CardGrid, Card, StatusChip, KvList,
} from '../components/pingUi';

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

// Severity chips only appear for the two severities that need attention; the word is always shown.
const SEVERITY_CHIPS = {
  warning: { tone: 'warn', word: 'Warning' },
  warn: { tone: 'warn', word: 'Warning' },
  error: { tone: 'danger', word: 'Error' },
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
  const [failed, setFailed] = useState(false);
  const alive = useRef(true);
  const request = useRef(0);

  const load = useCallback(() => {
    const id = request.current + 1;
    request.current = id;
    setLoading(true);
    fetch('/api/app-events?limit=100', { credentials: 'include' })
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      })
      .then((body) => {
        if (!alive.current || id !== request.current) return;
        setEvents(Array.isArray(body?.events) ? body.events : []);
        setFailed(false);
      })
      .catch(() => {
        if (!alive.current || id !== request.current) return;
        setFailed(true);
      })
      .finally(() => {
        if (alive.current && id === request.current) setLoading(false);
      });
  }, []);

  useEffect(() => {
    alive.current = true;
    load();
    return () => { alive.current = false; };
  }, [load]);

  const filteredEvents = useMemo(
    () => activeLane === 'all' ? events : events.filter((event) => laneForEvent(event) === activeLane),
    [activeLane, events],
  );

  const laneCounts = useMemo(() => {
    const counts = { identity: 0, authorization: 0, privilege: 0, governance: 0 };
    events.forEach((event) => { counts[laneForEvent(event)] += 1; });
    return counts;
  }, [events]);

  const refresh = () => {
    if (loading) return; // aria-disabled keeps focus; the click is ignored
    load();
  };

  const activeLabel = LANES.find((lane) => lane.id === activeLane)?.label ?? 'All activity';
  const newest = events[0]?.timestamp;

  let status;
  if (loading && events.length === 0) status = { tone: 'neutral', word: 'Loading', text: 'Reading the BFF app-event log.' };
  else if (loading) status = { tone: 'neutral', word: 'Refreshing', text: 'Reading the BFF app-event log again.' };
  else if (failed) {
    status = {
      tone: 'danger',
      word: 'Unavailable',
      text: events.length
        ? 'The refresh failed, so the rows below are from the last successful read.'
        : 'The BFF event log could not be read. Nothing is shown, which does not mean nothing happened.',
    };
  } else if (events.length === 0) status = { tone: 'neutral', word: 'Empty', text: 'The log has no events yet.' };
  else status = { tone: 'ok', word: 'Loaded', text: `Showing ${filteredEvents.length} of ${events.length} events in ${activeLabel}.` };

  return (
    <PingPage className="governance-timeline-page">
      <SimBanner data-testid="gt-banner">
        <strong>RECORDED EVENTS</strong> — nothing on this page is simulated. Every row is an event this app&apos;s
        BFF recorded in its own event log (the 100 most recent). The log records what the demo did, so a run in
        mock mode appears here like any other and is not marked as simulated.
      </SimBanner>
      <PageHeader
        eyebrow="Evidence & Governance"
        title="Governance Timeline"
        summary="Follow the evidence from identity and NHI registration through authorization, privilege, and accountable outcomes."
      />
      <PageFrame>
        <Section
          id="gt-source-h"
          kicker="1 · What was recorded"
          title="The evidence behind the timeline"
          lede="Each event is filed in a lane by its category. Counts cover the events read, not the lane you are viewing."
        >
          <CardGrid>
            <Card title="Event log" data-testid="gt-source">
              <p className="pu-status-line">
                <StatusChip tone={status.tone}>{status.word}</StatusChip>
                {status.text}
              </p>
              <KvList
                items={[
                  { label: 'Source', value: '/api/app-events', mono: true },
                  { label: 'Events read', value: String(events.length) },
                  { label: 'Newest', value: newest ? formatTimestamp(newest) : 'None yet' },
                ]}
              />
              <div className="pu-actions">
                <button
                  type="button"
                  className="pu-btn pu-btn--primary"
                  aria-disabled={loading ? 'true' : undefined}
                  onClick={refresh}
                  data-testid="gt-refresh"
                >
                  {loading ? 'Refreshing…' : 'Refresh evidence'}
                </button>
              </div>
            </Card>
            <Card title="By lane" tone="neutral" data-testid="gt-lanes">
              <KvList items={LANES.slice(1).map((lane) => ({ label: lane.label, value: String(laneCounts[lane.id]) }))} />
              <p className="pu-note">A category the page does not know is filed under Governance.</p>
            </Card>
          </CardGrid>
        </Section>

        <Section id="gt-timeline-h" kicker="2 · Follow the evidence" title="Newest first">
          <div className="governance-timeline-page__filters" role="group" aria-label="Governance timeline lanes">
            {LANES.map((lane) => (
              <button
                key={lane.id}
                type="button"
                className="pu-btn"
                aria-pressed={activeLane === lane.id}
                onClick={() => setActiveLane(lane.id)}
              >
                {lane.label}
              </button>
            ))}
          </div>

          <Card tone="neutral" data-testid="gt-timeline">
            <div className="governance-timeline-page__timeline" aria-live="polite">
              {loading && events.length === 0 && (
                <p className="pu-note pu-empty governance-timeline-page__empty"><InlineSpinner /> <span>Loading governance evidence…</span></p>
              )}
              {!loading && filteredEvents.length === 0 && (
                <p className="pu-note pu-empty governance-timeline-page__empty">
                  {failed && events.length === 0 ? 'The evidence could not be loaded. Use Refresh evidence to try again.' : 'No evidence is available for this lane yet.'}
                </p>
              )}
              {filteredEvents.length > 0 && (
                <ol className="governance-timeline-list">
                  {filteredEvents.map((event, index) => {
                    const lane = LANES.find((item) => item.id === laneForEvent(event));
                    const useCaseId = event?.useCaseId || event?.metadata?.useCaseId;
                    const severity = SEVERITY_CHIPS[event?.severity];
                    return (
                      <li className="governance-timeline-event" key={event?.id || `${event?.timestamp || 'event'}-${index}`}>
                        <span
                          className={`governance-timeline-event__marker governance-timeline-event__marker--${lane?.id || 'governance'}`}
                          aria-hidden="true"
                        />
                        <div className="governance-timeline-event__content">
                          <div className="governance-timeline-event__meta">
                            <StatusChip tone="neutral">{lane?.label || 'Governance'}</StatusChip>
                            {severity && <StatusChip tone={severity.tone}>{severity.word}</StatusChip>}
                            <time className="pu-mono" dateTime={event?.timestamp}>{formatTimestamp(event?.timestamp)}</time>
                          </div>
                          <p>{eventText(event)}</p>
                          {useCaseId && <span className="governance-timeline-event__use-case pu-mono">{useCaseId}</span>}
                        </div>
                      </li>
                    );
                  })}
                </ol>
              )}
            </div>
          </Card>
        </Section>
      </PageFrame>
    </PingPage>
  );
}
