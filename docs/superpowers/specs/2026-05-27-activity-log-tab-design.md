# Activity Log Tab in Token Chain Modal — Design Spec

**Date:** 2026-05-27  
**Status:** Approved  
**Inspired by:** `id4ai-pingsoftware-acp-main` — Dev Tools sidebar with OAuth Token Flow + Telemetry panels

---

## Background

The reference app (`id4ai-pingsoftware-acp-main`) exposes a collapsible "Dev Tools" right sidebar showing:
- **OAuth Token Flow** — live JWT token events (count badge, collapsible panel)
- **Telemetry** — OTel trace spans with timeline visualization

Our app already has a much richer event infrastructure:
- `appEventService.js` — 200-event ring buffer with 15 named categories (oauth, mcp, delegation, hitl, introspection, token_exchange, gateway_path, threshold, helix, authorize, agent, agent_prompt, session, jwks, auth_lifecycle)
- An existing SSE endpoint: `GET /api/admin/app-events/stream`
- A `TokenChainModal` — draggable, resizable floating modal showing RFC 8693 token inspection

**Gap:** No live, readable activity stream showing all event categories in one place during a demo interaction.

---

## What We're Building

A second tab — **Activity Log** — inside the existing `TokenChainModal`. The two tabs live behind a tab bar at the top of the modal body:

- **Token Chain tab** (existing): RFC 8693 token inspection, JWT claims, delegation, introspection — unchanged
- **Activity Log tab** (new): Real-time event stream from `appEventService`, filterable by all 15 categories, with pause/clear/expand controls

The `DraggableModal` chrome (title bar, drag, resize, pop-out, close) is shared by both tabs unchanged.

---

## Architecture

### Data Flow

```
appEventService (ring buffer, pub/sub)
    │
    ▼
GET /api/admin/app-events/stream   ← existing SSE endpoint, admin.js
    │  (text/event-stream, JSON lines)
    │
    ▼
useActivityLog hook (EventSource lifecycle, ring buffer, filter state)
    │
    ▼
ActivityLogPanel component (toolbar + filter pills + event rows)
    │
    ▼
TokenChainModal (tab bar: "Token Chain" | "Activity Log")
```

No backend changes required. The SSE endpoint already exists and emits all 15 categories.

### Auth

The Activity Log tab is only accessible inside the agent dashboard (authenticated session required). The existing session cookie is sent with the EventSource connection automatically. No auth changes needed.

---

## Component Structure

```
TokenChainModal (modified)
  └── DraggableModal (existing, unchanged chrome)
        └── [Tab Bar: "Token Chain" | "Activity Log · ●N"]
              ├── Tab: Token Chain → TokenChainDisplay (unchanged)
              └── Tab: Activity Log → ActivityLogPanel (new)
```

### New Files

| File | Purpose |
|------|---------|
| `demo_api_ui/src/components/ActivityLogPanel.js` | Activity Log tab content — toolbar, filter pills, event rows |
| `demo_api_ui/src/components/ActivityLogPanel.css` | Scoped styles for this component |
| `demo_api_ui/src/hooks/useActivityLog.js` | EventSource lifecycle, ring buffer, filter state, pause/clear |

### Modified Files

| File | Change |
|------|--------|
| `demo_api_ui/src/components/TokenChainModal.js` | Add tab bar; render `ActivityLogPanel` or `TokenChainDisplay` based on active tab |

---

## `useActivityLog` Hook

```js
const {
  events,          // AppEvent[] — filtered subset, newest-first, max 200
  isLive,          // bool — SSE connection is open and healthy
  isPaused,        // bool — appending paused (connection stays open)
  newCount,        // number — events received since tab was last visible (for tab badge)
  activeFilters,   // Set<string> — categories currently shown
  toggleFilter,    // (category: string) => void
  setAllFilters,   // (enabled: boolean) => void — select all / deselect all
  pause,           // () => void
  resume,          // () => void
  clear,           // () => void — clears visible list, does not close SSE
} = useActivityLog({ enabled }); // enabled: modal is open AND Activity tab is active
```

**Lifecycle:**
- When `enabled` becomes `true`: open `EventSource('/api/admin/app-events/stream')`
- When `enabled` becomes `false`: close EventSource, keep event buffer in memory
- On SSE error: set `isLive = false`, schedule retry after 5 seconds
- Ring buffer: keep last 200 events; oldest trimmed on overflow

---

## UI Layout

### Tab Bar (inside DraggableModal, above content)

```
┌─────────────────────────────────────────────────────┐
│  Token Chain                              [─] [×]  │  ← DraggableModal title bar (unchanged)
├─────────────────────────────────────────────────────┤
│  [Token Chain]   [Activity Log  ●3]                │  ← tab bar
├─────────────────────────────────────────────────────┤
│  (tab content)                                     │
└─────────────────────────────────────────────────────┘
```

- `●N` badge on Activity Log tab counts unread events (resets when tab is focused)
- Active tab underlined; inactive tab has hover state

### Activity Log Tab Layout

```
┌─────────────────────────────────────────────────────┐
│  [● Live]  [Pause]  [Clear]          [Filter ▾]    │  ← toolbar row
│  ┌──────────────────────────────────────────────┐  │
│  │ [oauth] [mcp] [delegation] [hitl] [+11 more] │  │  ← category filter pills
│  └──────────────────────────────────────────────┘  │
├─────────────────────────────────────────────────────┤
│  14:32:01  [mcp]        ✅  Tool call: get_accounts  │
│  14:32:00  [exchange]   ✅  Token exchanged for alice │
│  14:31:59  [oauth]      ℹ   Authorization code recv  │
│  ▶ 14:31:58  [hitl]    ⚠️  Consent required (expand)│  ← click-to-expand row
│    { "toolName": "transfer", "threshold": 500 }      │
│  ...                                                │
└─────────────────────────────────────────────────────┘
```

### Event Row Fields

| Field | Source | Display |
|-------|--------|---------|
| Timestamp | `event.timestamp` | `HH:mm:ss` |
| Category | `event.category` | Coloured pill (fixed palette, one colour per category) |
| Severity | `event.severity` | `✅` info · `⚠️` warning · `❌` error |
| Message | `event.message` | Plain text, truncated at ~80 chars |
| Metadata | `event.metadata` | Hidden; revealed by clicking row → monospace JSON block |

### Category Pill Colours

Each of the 15 categories gets a distinct background colour from a fixed CSS palette (no emoji, CSS only):

| Category | Colour |
|----------|--------|
| oauth | blue |
| mcp | indigo |
| token_exchange | violet |
| delegation | purple |
| hitl | amber |
| authorization / authorize | orange |
| gateway_path | teal |
| threshold | rose |
| introspection | cyan |
| helix | green |
| agent | sky |
| agent_prompt | lime |
| session | slate |
| jwks | zinc |
| auth_lifecycle | gray |

### Visual Design Rules

- Background: white (matches `TokenChainDisplay`)
- Font: `font-mono text-sm` for event rows; `text-xs` for timestamps and badges
- No new CSS libraries; scoped in `ActivityLogPanel.css`
- Scrollable event list; newest events prepended at the top
- "Reconnecting…" indicator replaces "● Live" badge when connection is lost
- Only permitted emojis: `✅` `⚠️` `❌`

---

## Error Handling

| Condition | Behaviour |
|-----------|-----------|
| SSE connection error | `isLive = false`; show "Reconnecting…" in toolbar; retry after 5s |
| 401 Unauthorized from SSE endpoint | Show "Not authenticated" message in panel; no retry |
| Stream closed unexpectedly | Same as connection error |
| Tab hidden / modal closed | EventSource closed; buffer preserved in memory |
| Ring buffer overflow (>200) | Oldest events trimmed silently |

---

## Success Criteria

1. Token Chain tab renders identically to today — no visual or functional regression
2. "Activity Log" tab appears in the modal tab bar with an unread-count badge
3. Events stream live when the Activity Log tab is visible; EventSource closes when tab is hidden or modal closes
4. All 15 categories have filter pills; toggling a pill hides/shows matching events
5. "Select all / Deselect all" via the Filter button
6. Pause/Resume stops/resumes appending without disconnecting the SSE
7. Clear empties the visible list; new events continue to appear after clear
8. Clicking a row expands metadata JSON in a monospace block below the row
9. Lost connection shows "Reconnecting…" and auto-retries after 5 seconds
10. `cd demo_api_ui && npm run build` exits 0

---

## What We're NOT Building

- No changes to `TokenChainDisplay` or existing token chain behaviour
- No new backend routes or services
- No new tests (manual verification via live demo interaction is sufficient)
- No admin page — this is a modal tab, not a navigation destination
- No download/export of events
- No search/text-filter (category filter only)

---

## Files Touched Summary

```
demo_api_ui/src/components/TokenChainModal.js     (modified — add tab bar)
demo_api_ui/src/components/ActivityLogPanel.js    (new)
demo_api_ui/src/components/ActivityLogPanel.css   (new)
demo_api_ui/src/hooks/useActivityLog.js           (new)
```

Backend: no changes.
