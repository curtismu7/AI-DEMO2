# Activity Log Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an "Activity Log" tab to the existing Token Chain modal that streams live app events from all 15 categories in real time, with per-category filter pills, pause/clear/expand controls.

**Architecture:** Wrap the modal body in a two-tab switcher (`TokenChain` | `Activity Log`); the Activity Log tab is a new `ActivityLogPanel` component backed by a `useActivityLog` hook that consumes the existing public SSE endpoint `/api/app-events/stream`. No backend changes required.

**Tech Stack:** React (CRA), plain CSS modules, `EventSource` browser API, existing `useAppEventsSSE` hook (extended/wrapped — do not duplicate EventSource logic).

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Modify | `demo_api_ui/src/components/TokenChainModal.js` | Add tab bar; route between TokenChainDisplay and ActivityLogPanel |
| Create | `demo_api_ui/src/hooks/useActivityLog.js` | EventSource lifecycle via `useAppEventsSSE`, ring buffer (200 events), filter state, pause/clear, unread count |
| Create | `demo_api_ui/src/components/ActivityLogPanel.js` | Toolbar + category filter pills + scrollable event rows + click-to-expand |
| Create | `demo_api_ui/src/components/ActivityLogPanel.css` | Scoped styles for the panel |

---

## Task 1: `useActivityLog` hook

**Files:**
- Create: `demo_api_ui/src/hooks/useActivityLog.js`

The hook wraps `useAppEventsSSE` (which already manages the EventSource for `/api/app-events/stream`) and adds: a 200-event ring buffer, category filter state, pause flag, clear action, and unread-count tracking.

- [ ] **Step 1: Create the hook**

Create `demo_api_ui/src/hooks/useActivityLog.js` with this exact content:

```js
// demo_api_ui/src/hooks/useActivityLog.js
/**
 * Manages live app-event state for the Activity Log tab.
 *
 * - Wraps useAppEventsSSE (handles EventSource lifecycle).
 * - Maintains a 200-event ring buffer (newest first).
 * - Per-category filter: 15 known categories, all active by default.
 * - Pause: stops prepending to visible list but keeps SSE open.
 * - Clear: empties visible list; new events continue.
 * - newCount: events received while isPaused or tab is not focused (for badge).
 *
 * @param {{ enabled: boolean }} opts
 *   enabled — connect SSE only when the modal is open AND this tab is active.
 */
import { useState, useCallback, useRef } from 'react';
import { useAppEventsSSE } from './useAppEventsSSE';

export const ALL_CATEGORIES = [
  'oauth',
  'token_exchange',
  'mcp',
  'delegation',
  'hitl',
  'authorize',
  'gateway_path',
  'threshold',
  'introspection',
  'helix',
  'agent',
  'agent_prompt',
  'session',
  'jwks',
  'auth_lifecycle',
];

const MAX_EVENTS = 200;

export function useActivityLog({ enabled = false } = {}) {
  const [events, setEvents] = useState([]);
  const [isPaused, setIsPaused] = useState(false);
  const [newCount, setNewCount] = useState(0);
  const [activeFilters, setActiveFiltersState] = useState(
    () => new Set(ALL_CATEGORIES),
  );

  // Keep a ref to avoid stale closures inside the SSE callback.
  const isPausedRef = useRef(isPaused);
  isPausedRef.current = isPaused;

  const handleEvent = useCallback((event) => {
    if (isPausedRef.current) {
      setNewCount((n) => n + 1);
      return;
    }
    setEvents((prev) => {
      const next = [event, ...prev];
      return next.length > MAX_EVENTS ? next.slice(0, MAX_EVENTS) : next;
    });
    setNewCount((n) => n + 1);
  }, []);

  useAppEventsSSE(handleEvent, { enabled });

  const pause = useCallback(() => setIsPaused(true), []);

  const resume = useCallback(() => {
    setIsPaused(false);
    setNewCount(0);
  }, []);

  const clear = useCallback(() => {
    setEvents([]);
    setNewCount(0);
  }, []);

  const resetNewCount = useCallback(() => setNewCount(0), []);

  const toggleFilter = useCallback((category) => {
    setActiveFiltersState((prev) => {
      const next = new Set(prev);
      if (next.has(category)) {
        next.delete(category);
      } else {
        next.add(category);
      }
      return next;
    });
  }, []);

  const setAllFilters = useCallback((enabled) => {
    setActiveFiltersState(enabled ? new Set(ALL_CATEGORIES) : new Set());
  }, []);

  // Apply category filter for display.
  const filteredEvents = events.filter((e) => activeFilters.has(e.category));

  return {
    events: filteredEvents,
    isPaused,
    newCount,
    activeFilters,
    toggleFilter,
    setAllFilters,
    pause,
    resume,
    clear,
    resetNewCount,
  };
}
```

- [ ] **Step 2: Commit**

```bash
cd /Users/curtismuir/Development/AI-Demo
git add demo_api_ui/src/hooks/useActivityLog.js
git commit -m "feat(activity-log): add useActivityLog hook

Ring buffer, filter state, pause/clear, unread count.
Wraps existing useAppEventsSSE — no EventSource duplication.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 2: `ActivityLogPanel` CSS

**Files:**
- Create: `demo_api_ui/src/components/ActivityLogPanel.css`

- [ ] **Step 1: Create the CSS file**

Create `demo_api_ui/src/components/ActivityLogPanel.css` with this exact content:

```css
/* ─── Activity Log Panel ──────────────────────────────────────────────────── */
.alp-root {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  font-size: 13px;
  background: #ffffff;
  color: #0f172a;
}

/* ─── Toolbar ──────────────────────────────────────────────────────────────── */
.alp-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-bottom: 1px solid #e2e8f0;
  flex-shrink: 0;
  flex-wrap: wrap;
}

.alp-status {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  font-weight: 600;
  padding: 3px 8px;
  border-radius: 99px;
  user-select: none;
}

.alp-status--live {
  background: #dcfce7;
  color: #166534;
}

.alp-status--reconnecting {
  background: #fef9c3;
  color: #854d0e;
}

.alp-status-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: currentColor;
}

.alp-status--live .alp-status-dot {
  animation: alp-pulse 1.8s ease-in-out infinite;
}

@keyframes alp-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.35; }
}

.alp-btn {
  padding: 3px 10px;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  background: #f8fafc;
  color: #475569;
  font-size: 12px;
  cursor: pointer;
  transition: background 0.15s;
}
.alp-btn:hover { background: #f1f5f9; }

.alp-spacer { flex: 1; }

/* ─── Filter bar ───────────────────────────────────────────────────────────── */
.alp-filters {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border-bottom: 1px solid #e2e8f0;
  flex-shrink: 0;
  flex-wrap: wrap;
}

.alp-filter-all {
  padding: 2px 8px;
  border: 1px solid #cbd5e1;
  border-radius: 99px;
  background: #f1f5f9;
  color: #475569;
  font-size: 11px;
  cursor: pointer;
  white-space: nowrap;
}
.alp-filter-all:hover { background: #e2e8f0; }

.alp-pill {
  padding: 2px 8px;
  border: 1.5px solid transparent;
  border-radius: 99px;
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;
  white-space: nowrap;
  transition: opacity 0.12s;
}
.alp-pill--off {
  opacity: 0.35;
  filter: grayscale(0.6);
}

/* ─── Per-category pill colours ────────────────────────────────────────────── */
.alp-cat--oauth         { background: #dbeafe; color: #1e40af; border-color: #93c5fd; }
.alp-cat--mcp           { background: #ede9fe; color: #4c1d95; border-color: #c4b5fd; }
.alp-cat--token_exchange{ background: #f3e8ff; color: #6b21a8; border-color: #d8b4fe; }
.alp-cat--delegation    { background: #fae8ff; color: #86198f; border-color: #e879f9; }
.alp-cat--hitl          { background: #fef3c7; color: #92400e; border-color: #fcd34d; }
.alp-cat--authorize     { background: #ffedd5; color: #9a3412; border-color: #fdba74; }
.alp-cat--gateway_path  { background: #ccfbf1; color: #0f766e; border-color: #5eead4; }
.alp-cat--threshold     { background: #ffe4e6; color: #9f1239; border-color: #fda4af; }
.alp-cat--introspection { background: #cffafe; color: #164e63; border-color: #67e8f9; }
.alp-cat--helix         { background: #dcfce7; color: #14532d; border-color: #86efac; }
.alp-cat--agent         { background: #e0f2fe; color: #075985; border-color: #7dd3fc; }
.alp-cat--agent_prompt  { background: #ecfccb; color: #365314; border-color: #bef264; }
.alp-cat--session       { background: #f1f5f9; color: #334155; border-color: #94a3b8; }
.alp-cat--jwks          { background: #f4f4f5; color: #3f3f46; border-color: #a1a1aa; }
.alp-cat--auth_lifecycle{ background: #f9fafb; color: #374151; border-color: #9ca3af; }

/* ─── Event list ───────────────────────────────────────────────────────────── */
.alp-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}

.alp-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: #94a3b8;
  font-size: 13px;
  padding: 32px;
  text-align: center;
}

/* ─── Event row ────────────────────────────────────────────────────────────── */
.alp-row {
  display: flex;
  flex-direction: column;
  border-bottom: 1px solid #f1f5f9;
  cursor: pointer;
  transition: background 0.1s;
}
.alp-row:hover { background: #f8fafc; }
.alp-row--expanded { background: #f8fafc; }

.alp-row-main {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
}

.alp-row-time {
  font-family: "SF Mono", "Fira Code", "Fira Mono", monospace;
  font-size: 11px;
  color: #94a3b8;
  flex-shrink: 0;
  width: 62px;
}

.alp-row-cat {
  flex-shrink: 0;
}

.alp-row-sev {
  flex-shrink: 0;
  font-size: 12px;
}

.alp-row-msg {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  color: #1e293b;
}

.alp-row-expand-icon {
  flex-shrink: 0;
  font-size: 10px;
  color: #94a3b8;
  transition: transform 0.15s;
}
.alp-row--expanded .alp-row-expand-icon {
  transform: rotate(90deg);
}

/* ─── Metadata expand ──────────────────────────────────────────────────────── */
.alp-row-detail {
  padding: 0 12px 8px 12px;
}

.alp-row-detail pre {
  margin: 0;
  padding: 8px 10px;
  background: #f1f5f9;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  font-family: "SF Mono", "Fira Code", "Fira Mono", monospace;
  font-size: 11px;
  color: #1e293b;
  white-space: pre-wrap;
  word-break: break-all;
  max-height: 200px;
  overflow-y: auto;
}
```

- [ ] **Step 2: Commit**

```bash
cd /Users/curtismuir/Development/AI-Demo
git add demo_api_ui/src/components/ActivityLogPanel.css
git commit -m "feat(activity-log): add ActivityLogPanel CSS

15-category colour palette, toolbar, filter pills, event rows.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 3: `ActivityLogPanel` component

**Files:**
- Create: `demo_api_ui/src/components/ActivityLogPanel.js`

- [ ] **Step 1: Create the component**

Create `demo_api_ui/src/components/ActivityLogPanel.js` with this exact content:

```js
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

// ─── Severity display ─────────────────────────────────────────────────────────
function severityIcon(severity) {
  if (severity === 'error') return '❌';
  if (severity === 'warning' || severity === 'warn') return '⚠️';
  return '✅';
}

// ─── Category pill (reused in filter bar + event row) ────────────────────────
function CategoryPill({ category, className = '' }) {
  const cls = `alp-pill alp-cat--${category} ${className}`.trim();
  return <span className={cls}>{category}</span>;
}

// ─── Single event row ─────────────────────────────────────────────────────────
function EventRow({ event }) {
  const [expanded, setExpanded] = useState(false);

  const ts = new Date(event.timestamp);
  const timeStr = isNaN(ts)
    ? '--:--:--'
    : ts.toTimeString().slice(0, 8); // HH:mm:ss

  const detail =
    event.metadata != null
      ? JSON.stringify(event.metadata, null, 2)
      : event.tag
      ? JSON.stringify({ tag: event.tag }, null, 2)
      : null;

  return (
    <div
      className={`alp-row${expanded ? ' alp-row--expanded' : ''}`}
      onClick={() => detail && setExpanded((v) => !v)}
    >
      <div className="alp-row-main">
        <span className="alp-row-time">{timeStr}</span>
        <span className="alp-row-cat">
          <CategoryPill category={event.category || 'unknown'} />
        </span>
        <span className="alp-row-sev">{severityIcon(event.severity)}</span>
        <span className="alp-row-msg" title={event.message}>
          {event.message}
        </span>
        {detail && (
          <span className="alp-row-expand-icon">▶</span>
        )}
      </div>
      {expanded && detail && (
        <div className="alp-row-detail">
          <pre>{detail}</pre>
        </div>
      )}
    </div>
  );
}

// ─── Main panel ───────────────────────────────────────────────────────────────
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
  } = useActivityLog({ enabled });

  // Reset unread count whenever this panel is mounted/enabled.
  const resetRef = useRef(resetNewCount);
  resetRef.current = resetNewCount;
  useEffect(() => {
    if (enabled) resetRef.current();
  }, [enabled]);

  // Track whether the SSE is connected. useAppEventsSSE auto-reconnects on error,
  // so we rely on event activity as a proxy: if an event arrived in the last 30s
  // we consider ourselves "live". For the initial state we show "live" optimistically.
  const [isLive, setIsLive] = useState(true);
  const lastEventTime = useRef(Date.now());

  // Update lastEventTime whenever a new event arrives (events array changes).
  useEffect(() => {
    if (events.length > 0) {
      lastEventTime.current = Date.now();
      setIsLive(true);
    }
  }, [events]);

  // Poll every 5s to detect a dead connection (no events for >35s).
  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => {
      const age = Date.now() - lastEventTime.current;
      setIsLive(age < 35000);
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
          {isLive ? 'Live' : 'Reconnecting…'}
        </span>

        {isPaused ? (
          <button className="alp-btn" onClick={resume}>
            Resume {newCount > 0 ? `(+${newCount})` : ''}
          </button>
        ) : (
          <button className="alp-btn" onClick={pause}>
            Pause
          </button>
        )}

        <button className="alp-btn" onClick={clear}>
          Clear
        </button>
      </div>

      {/* Category filter pills */}
      <div className="alp-filters">
        <button
          className="alp-filter-all"
          onClick={() => setAllFilters(!allOn)}
        >
          {allOn ? 'Deselect all' : 'Select all'}
        </button>
        {ALL_CATEGORIES.map((cat) => (
          <button
            key={cat}
            className={`alp-pill alp-cat--${cat}${activeFilters.has(cat) ? '' : ' alp-pill--off'}`}
            onClick={() => toggleFilter(cat)}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* Event list */}
      <div className="alp-list">
        {events.length === 0 ? (
          <div className="alp-empty">
            {isPaused
              ? 'Paused — resume to see new events'
              : 'Waiting for events…'}
          </div>
        ) : (
          events.map((event) => (
            <EventRow key={event.id || `${event.timestamp}-${event.category}`} event={event} />
          ))
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify the component imports resolve**

```bash
cd /Users/curtismuir/Development/AI-Demo/demo_api_ui
npm run build 2>&1 | grep -E "ERROR|error|Cannot find" | head -20
```

Expected: no import errors (build may fail on other things but import errors would show here).

- [ ] **Step 3: Commit**

```bash
cd /Users/curtismuir/Development/AI-Demo
git add demo_api_ui/src/components/ActivityLogPanel.js
git commit -m "feat(activity-log): add ActivityLogPanel component

Toolbar (live/pause/clear), 15-category filter pills, event rows
with click-to-expand metadata JSON. Uses useActivityLog hook.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 4: Wire tabs into `TokenChainModal`

**Files:**
- Modify: `demo_api_ui/src/components/TokenChainModal.js`

- [ ] **Step 1: Replace `TokenChainModal.js`**

The current file (31 lines) is a thin wrapper. We add a tab bar and local tab state. Replace the entire file with:

```js
// demo_api_ui/src/components/TokenChainModal.js
import React, { useState } from 'react';
import DraggableModal from './DraggableModal';
import TokenChainDisplay from './TokenChainDisplay';
import ActivityLogPanel from './ActivityLogPanel';

/**
 * Token Chain modal — draggable, resizable, pop-out.
 *
 * Two tabs:
 *   Token Chain  — RFC 8693 token inspection (unchanged)
 *   Activity Log — live /api/app-events/stream event feed
 *
 * credentialPath: each token-chain event carries a credentialPath field added in Phase 266.
 * TokenChainDisplay handles per-segment colour/badge rendering automatically.
 */

const TAB_TOKEN_CHAIN = 'tokenChain';
const TAB_ACTIVITY_LOG = 'activityLog';

const tabBarStyle = {
  display: 'flex',
  borderBottom: '2px solid #e2e8f0',
  background: '#f8fafc',
  flexShrink: 0,
};

function tabStyle(active) {
  return {
    padding: '8px 16px',
    fontSize: '13px',
    fontWeight: active ? 700 : 500,
    color: active ? '#1e40af' : '#64748b',
    borderBottom: active ? '2px solid #1e40af' : '2px solid transparent',
    marginBottom: '-2px',
    cursor: 'pointer',
    background: 'none',
    border: 'none',
    borderBottom: active ? '2px solid #1e40af' : '2px solid transparent',
    outline: 'none',
    whiteSpace: 'nowrap',
  };
}

export default function TokenChainModal({ isOpen, onClose }) {
  const [activeTab, setActiveTab] = useState(TAB_TOKEN_CHAIN);

  function handleTabClick(tab) {
    setActiveTab(tab);
  }

  return (
    <DraggableModal
      isOpen={isOpen}
      onClose={onClose}
      title="Token Chain"
      defaultWidth={700}
      defaultHeight={720}
      storageKey="ba-token-chain-modal"
      footer={null}
      closeOnPopout
      zIndex={10000}
    >
      {/* Tab bar */}
      <div style={tabBarStyle}>
        <button
          style={tabStyle(activeTab === TAB_TOKEN_CHAIN)}
          onClick={() => handleTabClick(TAB_TOKEN_CHAIN)}
        >
          Token Chain
        </button>
        <button
          style={tabStyle(activeTab === TAB_ACTIVITY_LOG)}
          onClick={() => handleTabClick(TAB_ACTIVITY_LOG)}
        >
          Activity Log
        </button>
      </div>

      {/* Tab content — keep both mounted so SSE doesn't restart on tab switch */}
      <div style={{ display: activeTab === TAB_TOKEN_CHAIN ? 'flex' : 'none', flex: 1, minHeight: 0, flexDirection: 'column' }}>
        <TokenChainDisplay hideHeader />
      </div>
      <div style={{ display: activeTab === TAB_ACTIVITY_LOG ? 'flex' : 'none', flex: 1, minHeight: 0, flexDirection: 'column' }}>
        <ActivityLogPanel enabled={isOpen} />
      </div>
    </DraggableModal>
  );
}
```

> **Note on `enabled` prop:** We pass `enabled={isOpen}` so the SSE connection opens when the modal opens (regardless of which tab is active). This means events start accumulating immediately and are available when the user switches to the Activity Log tab. The SSE closes when the modal closes.

- [ ] **Step 2: Full build check**

```bash
cd /Users/curtismuir/Development/AI-Demo/demo_api_ui
npm run build 2>&1 | tail -20
```

Expected: exit 0, no errors. If there are errors, fix them before proceeding.

- [ ] **Step 3: Commit**

```bash
cd /Users/curtismuir/Development/AI-Demo
git add demo_api_ui/src/components/TokenChainModal.js
git commit -m "feat(activity-log): wire Activity Log tab into TokenChainModal

Two-tab switcher (Token Chain / Activity Log). Activity Log tab
shows ActivityLogPanel with live SSE stream. Token Chain tab
unchanged. SSE opens when modal opens (not just when tab active).

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 5: Manual verification

- [ ] **Step 1: Start the app**

```bash
cd /Users/curtismuir/Development/AI-Demo && ./run.sh
```

Wait for the API (`:3001`) and UI (`:4000`) to be ready.

- [ ] **Step 2: Open the app and trigger events**

1. Navigate to `https://api.ping.demo:4000` and log in as a demo user
2. Open the Token Chain modal (click the Token Chain button in the agent dashboard)
3. Click the "Activity Log" tab — should show "Waiting for events…" with the Live indicator
4. Trigger a banking tool call via the agent chat (e.g. ask "show my accounts")
5. Observe events appearing in real time: expect categories like `mcp`, `token_exchange`, `delegation`

- [ ] **Step 3: Verify filter pills**

1. Click the `mcp` pill to deselect it — `mcp` events should disappear from the list
2. Click it again — they should reappear
3. Click "Deselect all" — list should empty
4. Click "Select all" — all events should return

- [ ] **Step 4: Verify pause/resume/clear**

1. Click "Pause" — new events stop appearing
2. Trigger another tool call — events should NOT appear in the list (counter shows in Resume button)
3. Click "Resume" — events should start flowing again
4. Click "Clear" — list empties; new events continue to appear

- [ ] **Step 5: Verify click-to-expand**

1. Click any event row that has metadata — a JSON block should appear below it
2. Click again — it should collapse

- [ ] **Step 6: Verify Token Chain tab is unaffected**

1. Switch back to "Token Chain" tab — all existing token chain content should render normally
2. The token exchange chain, JWT inspector, and delegation display should be unchanged

- [ ] **Step 7: Final build confirmation**

```bash
cd /Users/curtismuir/Development/AI-Demo/demo_api_ui
npm run build
echo "Exit: $?"
```

Expected: `Exit: 0`

---

## Success Criteria Checklist

- [ ] Token Chain tab renders identically to before — no visual or functional regression
- [ ] "Activity Log" tab appears in the modal tab bar
- [ ] Events stream live when modal is open; EventSource closes when modal closes
- [ ] All 15 categories have filter pills; toggling hides/shows matching events
- [ ] "Select all / Deselect all" toggles all filters at once
- [ ] Pause stops appending; Resume button shows count of paused events; Resume restores flow
- [ ] Clear empties the visible list; new events continue after clear
- [ ] Clicking a row with metadata shows expandable JSON block
- [ ] `npm run build` exits 0
