// demo_api_ui/src/components/ActivityLogPanel.js
/**
 * Activity Log tab content — live event stream from /api/app-events/stream.
 *
 * Toolbar:  Live/Reconnecting status · Pause · Resume · Clear
 * Filters:  Category pills (15 categories, all-on by default)
 * List:     Newest-first rows; click to expand metadata JSON
 * Flow:     agent/flow-start and agent/flow-end render as demo bookend dividers
 */
import React, { useState, useEffect, useRef } from 'react';
import { useActivityLog, ALL_CATEGORIES } from '../hooks/useActivityLog';
import './ActivityLogPanel.css';
import PingOneEventPanel from './PingOneEventPanel';

function severityIcon(severity) {
  if (severity === 'error') return '❌';
  if (severity === 'warning' || severity === 'warn') return '⚠️';
  return '✅';
}

/**
 * Returns 'start' | 'end' | null for agent transaction bookend tags.
 * @param {object} event
 * @returns {'start'|'end'|null}
 */
export function flowBoundaryKind(event) {
  const tag = event?.tag;
  if (tag === 'agent/flow-start') return 'start';
  if (tag === 'agent/flow-end') return 'end';
  return null;
}

/** Short id fragment for demo callouts (not a secret). */
function shortCorr(event) {
  const id = event?.correlationId || event?.flowId || event?.metadata?.runId || '';
  return typeof id === 'string' && id.length > 8 ? id.slice(0, 8) : id;
}

const FlowDivider = React.memo(function FlowDivider({ event }) {
  const kind = flowBoundaryKind(event);
  if (!kind) return null;
  const corr = shortCorr(event);
  const ts = new Date(event.timestamp);
  const timeStr = isNaN(ts.getTime()) ? '' : ts.toTimeString().slice(0, 8);
  const label = kind === 'start' ? 'Agent flow start' : 'Agent flow end';
  return (
    <div
      className={`alp-flow-divider alp-flow-divider--${kind}`}
      role="separator"
      aria-label={label}
      data-testid={kind === 'start' ? 'alp-flow-start' : 'alp-flow-end'}
    >
      <span className="alp-flow-divider__label">{label}</span>
      {corr ? <span className="alp-flow-divider__corr">{corr}</span> : null}
      {timeStr ? <span className="alp-flow-divider__time">{timeStr}</span> : null}
      {event.message ? (
        <span className="alp-flow-divider__msg" title={event.message}>
          {event.message.replace(/^Agent flow (start|end)\s*[—-]\s*/i, '')}
        </span>
      ) : null}
    </div>
  );
});

const EventRow = React.memo(function EventRow({ event }) {
  const [expanded, setExpanded] = useState(false);
  const boundary = flowBoundaryKind(event);

  if (boundary) {
    return <FlowDivider event={event} />;
  }

  const ts = new Date(event.timestamp);
  const timeStr = isNaN(ts.getTime())
    ? '--:--:--'
    : ts.toTimeString().slice(0, 8);

  const detail =
    event.metadata != null
      ? JSON.stringify(event.metadata, null, 2)
      : event.tag
      ? JSON.stringify({ tag: event.tag }, null, 2)
      : null;

  return (
    <div className={`alp-card alp-cat-border--${event.category || 'unknown'}`}>
      <button
        type="button"
        className={`alp-card-header${detail ? ' alp-card-header--expandable' : ''}`}
        onClick={() => detail && setExpanded((v) => !v)}
      >
        <span className={`alp-pill alp-cat--${event.category || 'unknown'}`}>
          {event.category || 'unknown'}
        </span>
        <span className="alp-row-sev">{severityIcon(event.severity)}</span>
        <span className="alp-card-msg" title={event.message}>
          {event.message}
        </span>
        <span className="alp-row-time">{timeStr}</span>
        {detail && (
          <span className={`alp-row-expand-icon${expanded ? ' alp-row-expand-icon--open' : ''}`}>▶</span>
        )}
      </button>
      {expanded && detail && (
        <div className="alp-row-detail">
          <pre>{detail}</pre>
        </div>
      )}
    </div>
  );
});

export default function ActivityLogPanel({ enabled }) {
  const {
    events,
    isPaused,
    newCount,
    activeFilters,
    toggleFilter,
    setAllFilters,
    pause,
    resume,
    clear,
    resetNewCount,
    availableUseCaseIds,
    activeUseCaseFilters,
    toggleUseCaseFilter,
    clearUseCaseFilter,
  } = useActivityLog({ enabled });

  const [activeTab, setActiveTab] = useState('activity');

  // Reset pause count whenever this panel becomes active.
  useEffect(() => {
    if (enabled) resetNewCount();
  }, [enabled, resetNewCount]);

  // Track connection health: starts false, goes live on first event, drops
  // to reconnecting if no events for >35s.
  const [isLive, setIsLive] = useState(false);
  const lastEventTime = useRef(null);

  useEffect(() => {
    if (events.length > 0) {
      lastEventTime.current = Date.now();
      setIsLive(true);
    }
  }, [events]);

  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => {
      if (lastEventTime.current !== null) {
        setIsLive(Date.now() - lastEventTime.current < 35000);
      }
    }, 5000);
    return () => clearInterval(id);
  }, [enabled]);

  const allOn = activeFilters.size === ALL_CATEGORIES.length;

  return (
    <div className="alp-root">
      <header className="alp-intro">
        <h1>Application Activity &amp; PingOne Events</h1>
        <p>
          This is the signed-in user&apos;s application activity across the demo products:
          agent runs, token exchange, authorization, gateway, MCP, consent, and transaction events.
          The Activity Log is populated by the BFF&apos;s <code>/api/app-events</code> history and live SSE stream;
          it is not a direct PingOne webhook. Use the PingOne Events tab for events received from PingOne integrations.
        </p>
      </header>
      {/* Toolbar */}
      <div className="alp-toolbar">
        <span className={`alp-status ${isLive ? 'alp-status--live' : 'alp-status--reconnecting'}`}>
          <span className="alp-status-dot" />
          {isLive ? 'Live' : 'Connecting…'}
        </span>

        {isPaused ? (
          <button type="button" className="alp-btn" onClick={resume}>
            Resume{newCount > 0 ? ` (+${newCount})` : ''}
          </button>
        ) : (
          <button type="button" className="alp-btn" onClick={pause}>
            Pause
          </button>
        )}

        <button type="button" className="alp-btn" onClick={clear}>
          Clear
        </button>
      </div>

      {/* Tab selector */}
      <div className="activity-log-panel__tabs">
        <button
          type="button"
          className={activeTab === 'activity' ? 'tab-btn tab-btn--active' : 'tab-btn'}
          onClick={() => setActiveTab('activity')}
        >
          Activity Log
        </button>
        <button
          type="button"
          className={activeTab === 'pingone' ? 'tab-btn tab-btn--active' : 'tab-btn'}
          onClick={() => setActiveTab('pingone')}
        >
          PingOne Events
        </button>
      </div>

      {activeTab === 'activity' && (
        <>
          {/* Category filter pills */}
          <div className="alp-filters">
            <button
              type="button"
              className="alp-filter-all"
              onClick={() => setAllFilters(!allOn)}
            >
              {allOn ? 'Deselect all' : 'Select all'}
            </button>
            {ALL_CATEGORIES.map((cat) => (
              <button
                type="button"
                key={cat}
                className={`alp-pill alp-cat--${cat}${activeFilters.has(cat) ? '' : ' alp-pill--off'}`}
                onClick={() => toggleFilter(cat)}
              >
                {cat}
              </button>
            ))}
          </div>

          {/* Use-case filter pills */}
          {availableUseCaseIds.length > 0 && (
            <div className="alp-filters alp-uc-filters">
              <span className="alp-filter-label">Use case:</span>
              <button
                type="button"
                className="alp-filter-all"
                onClick={clearUseCaseFilter}
                disabled={activeUseCaseFilters === null}
              >
                All
              </button>
              {availableUseCaseIds.map((ucId) => (
                <button
                  type="button"
                  key={ucId}
                  className={`alp-pill${activeUseCaseFilters && !activeUseCaseFilters.has(ucId) ? ' alp-pill--off' : ''}`}
                  onClick={() => toggleUseCaseFilter(ucId)}
                >
                  {ucId}
                </button>
              ))}
            </div>
          )}

          {/* Event list */}
          <div className="alp-list">
            {events.length === 0 ? (
              <div className="alp-empty">
                {isPaused
                  ? 'Paused — resume to see new events'
                  : 'No recent history yet — run a demo action (login, agent chip, MCP call) to populate this log.'}
              </div>
            ) : (
              events.map((event) => (
                <EventRow
                  key={event.id || `${event.timestamp}-${event.category}-${event.message}`}
                  event={event}
                />
              ))
            )}
          </div>
        </>
      )}

      {activeTab === 'pingone' && <PingOneEventPanel />}
    </div>
  );
}
