// demo_api_ui/src/components/LearningLogLearnPane.js
/**
 * Learn mode body for Learning Log — live app-events with severity,
 * category, and correlation coloring.
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useActivityLog, ALL_CATEGORIES } from "../hooks/useActivityLog";
import {
  categoryColor,
  correlationTint,
  resolveCorrelationId,
  severityStyle,
} from "../utils/learningLogColors";
import "./ActivityLogPanel.css";
import "./LearningLogLearnPane.css";

function LearnEventRow({ event, correlationFilter, onCorrelationClick }) {
  const [expanded, setExpanded] = useState(false);
  const corr = resolveCorrelationId(event);
  const sev = severityStyle(event.severity);
  const catColor = categoryColor(event.category);
  const tint = correlationTint(corr);
  const ts = new Date(event.timestamp);
  const timeStr = Number.isNaN(ts.getTime())
    ? "--:--:--"
    : ts.toTimeString().slice(0, 8);

  const detail =
    event.metadata != null
      ? JSON.stringify(event.metadata, null, 2)
      : event.tag
        ? JSON.stringify({ tag: event.tag }, null, 2)
        : null;

  return (
    <div
      className="ll-learn-row"
      style={{
        borderLeftColor: sev.stripe,
        background: tint || undefined,
      }}
    >
      <button
        type="button"
        className={`ll-learn-row__header${detail ? " ll-learn-row__header--expandable" : ""}`}
        onClick={() => detail && setExpanded((v) => !v)}
      >
        <span className="ll-learn-row__time">{timeStr}</span>
        <span
          className="ll-learn-row__sev"
          style={{ backgroundColor: sev.badge }}
          title={event.severity || "info"}
        >
          {sev.glyph || (event.severity || "info").slice(0, 1).toUpperCase()}
        </span>
        <span
          className="ll-learn-row__cat"
          style={{ color: catColor, borderColor: catColor }}
        >
          {event.category || "unknown"}
        </span>
        <span className="ll-learn-row__msg">{event.message}</span>
        {corr && (
          <button
            type="button"
            className="ll-learn-row__corr"
            title="Filter by correlation id"
            onClick={(e) => {
              e.stopPropagation();
              onCorrelationClick(corr);
            }}
          >
            {corr.slice(0, 8)}
            {correlationFilter === corr ? " (on)" : ""}
          </button>
        )}
      </button>
      {expanded && detail && (
        <pre className="ll-learn-row__detail">{detail}</pre>
      )}
    </div>
  );
}

/**
 * @param {{ enabled?: boolean }} props
 */
export default function LearningLogLearnPane({ enabled = true }) {
  const {
    events,
    isPaused,
    newCount,
    activeFilters,
    toggleFilter,
    pause,
    resume,
    clear,
    resetNewCount,
  } = useActivityLog({ enabled });

  useEffect(() => {
    if (enabled) resetNewCount();
  }, [enabled, resetNewCount]);

  const [isLive, setIsLive] = useState(false);
  const lastEventTime = useRef(null);
  useEffect(() => {
    if (events.length > 0) {
      lastEventTime.current = Date.now();
      setIsLive(true);
    }
  }, [events]);
  useEffect(() => {
    if (!enabled) return undefined;
    const id = setInterval(() => {
      if (lastEventTime.current != null) {
        setIsLive(Date.now() - lastEventTime.current < 35000);
      }
    }, 5000);
    return () => clearInterval(id);
  }, [enabled]);

  const [correlationFilter, setCorrelationFilter] = useState(null);
  const [search, setSearch] = useState("");

  const visible = useMemo(() => {
    let list = events || [];
    if (correlationFilter) {
      list = list.filter((e) => resolveCorrelationId(e) === correlationFilter);
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(
        (e) =>
          (e.message || "").toLowerCase().includes(q) ||
          (e.category || "").toLowerCase().includes(q) ||
          String(resolveCorrelationId(e) || "")
            .toLowerCase()
            .includes(q),
      );
    }
    return list;
  }, [events, correlationFilter, search]);

  return (
    <div className="ll-learn alp-root">
      <div className="alp-toolbar">
        <span
          className={`alp-status ${isLive ? "alp-status--live" : "alp-status--reconnecting"}`}
        >
          <span className="alp-status-dot" />
          {isLive ? "Live" : "Connecting…"}
        </span>
        {isPaused ? (
          <button type="button" className="alp-btn" onClick={resume}>
            Resume{newCount > 0 ? ` (+${newCount})` : ""}
          </button>
        ) : (
          <button type="button" className="alp-btn" onClick={pause}>
            Pause
          </button>
        )}
        <button type="button" className="alp-btn" onClick={clear}>
          Clear
        </button>
        {correlationFilter && (
          <button
            type="button"
            className="alp-btn"
            onClick={() => setCorrelationFilter(null)}
          >
            Clear correlation filter
          </button>
        )}
        <span className="alp-spacer" />
        <input
          className="ll-learn-search"
          type="search"
          placeholder="Search events…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      <div className="alp-filters">
        {ALL_CATEGORIES.map((cat) => (
          <button
            key={cat}
            type="button"
            className={`alp-filter-pill${activeFilters.has(cat) ? " alp-filter-pill--on" : ""}`}
            style={
              activeFilters.has(cat)
                ? { borderColor: categoryColor(cat), color: categoryColor(cat) }
                : undefined
            }
            onClick={() => toggleFilter(cat)}
          >
            {cat}
          </button>
        ))}
      </div>
      <div className="ll-learn-list">
        {visible.length === 0 ? (
          <p className="ll-learn-empty">
            No events yet — run a demo action (login, agent chip, or MFA) and
            the story of what happened will appear here.
          </p>
        ) : (
          visible.map((ev) => (
            <LearnEventRow
              key={ev.id}
              event={ev}
              correlationFilter={correlationFilter}
              onCorrelationClick={(id) =>
                setCorrelationFilter((prev) => (prev === id ? null : id))
              }
            />
          ))
        )}
      </div>
    </div>
  );
}
