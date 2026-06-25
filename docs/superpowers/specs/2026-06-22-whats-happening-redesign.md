# What's Happening — Event Stream Panel Redesign

**Date:** 2026-06-22  
**Status:** Design Approved  
**Author:** Curtis Muir

---

## Overview

"What's Happening" is a real-time event stream panel that narrates the technical flow of an agent request in plain English with technical details. It shows users what the system is doing step-by-step: user input → agent reasoning → tool calls → token exchanges → results.

**Current State:** The feature is unreliable and lacks a toggle to show/hide.

**Goal:** Build a robust, always-on-timeline event stream with a toggle, chronological ordering, auto-scroll behavior, and full history retention.

---

## Requirements

### Functional Requirements

1. **Event Capture** — Backend emits structured events for every step in the request flow
2. **Event Stream Rendering** — Frontend displays events chronologically in a scrollable panel
3. **Auto-Scroll Behavior** — Panel scrolls to latest event; user can scroll back without interruption
4. **Toggle Control** — On/off switch in UI to show/hide the panel
5. **History Retention** — All events remain visible; user can scroll back through full history
6. **Plain English + Technical Details** — Each event has both a user-friendly explanation and technical metadata (RFC specs, token info, etc.)
7. **Request Grouping** — Events for the same request are visually linked via `requestId`
8. **Error Handling** — If event capture fails, graceful degradation (show what we have, warn user)

### Non-Functional Requirements

1. **Reliability** — No crashes when events are missing or malformed
2. **Performance** — Panel remains responsive with 100+ events (use virtualization if needed)
3. **No Data Loss** — History persists until user clears it manually or session ends

---

## Architecture

### Three-Layer System

#### Layer 1: Event Capture (Backend)

**Location:** `demo_api_server/` — middleware, routes, and services  
**Responsibility:** Emit structured events as the request flows through the system

Event sources:
- **User Request Step:** Agent route receives request (emit `user_request`)
- **Agent Thinking:** Agent begins reasoning (emit `agent_thinking`)
- **Tool Calls:** Each tool call to MCP, API, or database (emit `tool_call`)
- **Token Exchange:** RFC 8693 exchanges happen (emit `token_exchange`)
- **Result:** Agent returns response (emit `result`)
- **Errors:** Any failure (emit `error`)

**Implementation:** 
- Create `services/eventEmitter.js` — centralized event emission
- Each event is JSON with required fields: `id`, `timestamp`, `type`, `plainEnglish`, `technicalDetails`, `severity`, `requestId`
- Emit via WebSocket or append to response payload (TBD based on current architecture)

#### Layer 2: Event Stream Manager (Frontend Context)

**Location:** `demo_api_ui/src/context/EventStreamContext.js`  
**Responsibility:** Manage event queue, auto-scroll logic, persistence

State:
- `events: Event[]` — all events in order
- `isOpen: boolean` — panel visible/hidden
- `requestId: string` — current request ID (for grouping)

Actions:
- `addEvent(event)` — append event, trigger auto-scroll
- `togglePanel()` — show/hide
- `clearHistory()` — wipe all events
- `pauseAutoScroll()` / `resumeAutoScroll()` — let user manually scroll without auto-jumping

#### Layer 3: Event Stream Panel UI

**Location:** `demo_api_ui/src/components/EventStreamPanel.jsx`  
**Responsibility:** Render the event timeline

Structure:
- **Header:** Toggle switch (on/off) + Clear History button
- **Timeline:** Scrollable container with Event Cards
- **Event Card:** Timestamp | Event Type Badge | Plain English headline | Collapsible technical details

Styling:
- Event type colors: `user_request` (blue), `agent_thinking` (purple), `tool_call` (green), `token_exchange` (orange), `result` (teal), `error` (red)
- Left border on each card matches event type color
- Responsive: stack vertically on mobile, side panel on desktop

---

## Event Data Model

```typescript
interface Event {
  id: string;                    // UUID, unique per event
  timestamp: string;             // ISO 8601 timestamp
  type: EventType;               // see enum below
  plainEnglish: string;          // User-friendly explanation (1-2 sentences)
  technicalDetails: {
    rfc?: string;                // e.g., "RFC 8693", "RFC 6749"
    section?: string;            // e.g., "§3.1"
    details: string;             // Technical metadata (tokens, audiences, etc.)
  };
  severity: "info" | "warning" | "error";
  requestId: string;             // Links multiple events to the same request
  metadata?: Record<string, any>; // Additional context (optional)
}

enum EventType {
  USER_REQUEST = "user_request",
  AGENT_THINKING = "agent_thinking",
  TOOL_CALL = "tool_call",
  TOKEN_EXCHANGE = "token_exchange",
  RESULT = "result",
  ERROR = "error"
}
```

---

## UI Layout

### Three Display Modes with Toggles

All modes are **floating windows** (don't take up page space). Users can switch between three positioning styles:

#### Mode 1: Embedded (Default Position)
- Floating window positioned at a default location (top-right corner)
- Fixed size (~340px × 500px)
- Best for: Quick reference without dragging it around
- Toggle: Close button (✕)

#### Mode 2: Float (Draggable & Resizable)
- Floating window that user can drag by header to reposition
- User can resize by dragging corner handle
- User can pop out to a separate browser window
- Best for: Flexible positioning, secondary monitor, multi-window workflows
- Toggle: Pop-out button (⬈), close button (✕)

#### Mode 3: Bottom (Docked Sheet)
- Floating window docked to the bottom of the screen
- Fixed height (~300px), spans full width
- User can expand upward or collapse
- Best for: Quick access to latest events, secondary monitor
- Toggle: Expand button (⬆), close button (✕)

### Mode Switcher
- Radio buttons in the top toolbar let users switch between all three modes
- Selection persists during the session
- Separate checkbox to show/hide the panel in any mode

### Event Card Layout

```
┌─────────────────────────────────────────────┐
│ 18:30:42  [TOOL CALL]                       │ ← timestamp + badge
│ Called /accounts to fetch user accounts     │ ← plain English
│                                             │
│ ▼ Details (collapsed by default)            │
│   RFC 6750: Bearer token validation         │
│   Token audience: banking_resource_server   │
│   Response: 2 accounts found                │
└─────────────────────────────────────────────┘
```

### Event Card Layout

```
┌─────────────────────────────────────────────┐
│ 18:30:42  [TOOL CALL]                       │ ← timestamp + badge
│ Called /accounts to fetch user accounts     │ ← plain English
│                                             │
│ ▼ Technical Details (collapsed by default)  │
│   RFC 6750: Bearer token validation         │
│   Token audience: banking_resource_server   │
│   Response: 2 accounts found                │
└─────────────────────────────────────────────┘
```

---

## Behavior & Interactions

### Auto-Scroll

- When a new event arrives, panel scrolls to bottom automatically
- **Only if user hasn't manually scrolled up** — detect scroll position and pause auto-scroll if user is viewing older events
- Resume auto-scroll when user scrolls to bottom
- Visual indicator: "New events below" link if user is viewing history while new events arrive

### History Management

- Events append indefinitely (no max limit initially)
- Clear History button wipes all events and resets
- Clear happens only on explicit user action (no auto-clear)
- Session persistence: cleared on page reload or session end

### Request Grouping

- Each request gets a unique `requestId`
- Visual divider between requests (e.g., light gray line with timestamp "Request started at 18:30:00")
- Events for the same request share the `requestId` field

### Error Handling

- **Missing event fields:** Use defaults; log warning to console
- **Malformed event:** Show error event in stream ("Event rendering failed")
- **Event capture fails:** Panel shows "Not receiving events" message; user can dismiss
- **Panel crashes:** Graceful fallback to collapsed state; no full-page crash

---

## Implementation Phases

### Phase 1: Backend Event Capture

- [ ] Create `services/eventEmitter.js` with event emission logic
- [ ] Identify all request-flow checkpoints (user input, agent reasoning, tool calls, token exchange, result)
- [ ] Emit events at each checkpoint with structured data
- [ ] Test event emission with manual request

### Phase 2: Frontend Context & State Management

- [ ] Create `EventStreamContext.js` with event queue + auto-scroll logic
- [ ] Create `useEventStream()` hook for consuming events
- [ ] Implement toggle, clearHistory, and auto-scroll pause/resume

### Phase 3: UI Component

- [ ] Create `EventStreamPanel.jsx` with event cards + styling
- [ ] Add toggle switch to dashboard toolbar
- [ ] Connect panel to context
- [ ] Test rendering with mock events

### Phase 4: Integration & Testing

- [ ] Wire backend event emitter to frontend via WebSocket/payload
- [ ] End-to-end test: make a request and verify event stream
- [ ] Test history retention, auto-scroll, toggle, error states

### Phase 5: Polish

- [ ] Responsive design (mobile, tablet, desktop)
- [ ] Accessibility (keyboard navigation, screen reader support)
- [ ] Performance optimization if event count grows

---

## Success Criteria

1. ✅ Feature is **reliable** — no crashes with 100+ events
2. ✅ Events display **chronologically** with **auto-scroll** to latest
3. ✅ User can **scroll back** through history without interruption
4. ✅ **Toggle** shows/hides the panel
5. ✅ Each event shows **plain English** + **technical details**
6. ✅ **Request grouping** is clear visually
7. ✅ Feature works **end-to-end** with live agent requests

---

## Open Questions / TBD

1. **Event Transport:** WebSocket (real-time) vs. polling (simpler) vs. append to response (no streaming)? Current architecture already has WebSocket for token chain; recommend reuse.
2. **Max Events:** Should we cap history size (e.g., keep last 500 events) to prevent memory bloat?
3. **Event Persistence:** Should history survive page reload, or clear on reload?
4. **Mobile Layout:** Right sidebar won't work on mobile; should it be bottom sheet instead?

---

## References

- Current implementation: `demo_api_ui/src/components/NarrativePanel.js` (reference for existing structure)
- Token Chain Context: `demo_api_ui/src/context/TokenChainContext.js` (reference for context pattern)
- RFC 8693: Token Exchange (relevant technical detail)
- RFC 6750: Bearer Token Usage
