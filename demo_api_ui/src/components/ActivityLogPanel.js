// demo_api_ui/src/components/ActivityLogPanel.js
/**
 * Activity Log tab content — live event stream from /api/app-events/stream.
 *
 * Toolbar:  Live/Reconnecting status · Pause · Resume · Clear
 * Filters:  Category pills (15 categories, all-on by default)
 * List:     Newest-first rows; click to expand metadata JSON
 */
import React, { useState, useEffect, useRef } from 'react';
import { useActivityLog, ALL_CATEGORIES } from '../hooks/useActivityLog';
import './ActivityLogPanel.css';

function severityIcon(severity) {
  if (severity === 'error') return '❌';
  if (severity === 'warning' || severity === 'warn') return '⚠️';
  return '✅';
}

const EventRow = React.memo(function EventRow({ event }) {
  const [expanded, setExpanded] = useState(false);

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
              : 'No events yet. Recent activity loads on open; new events appear live.'}
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
    </div>
  );
}
