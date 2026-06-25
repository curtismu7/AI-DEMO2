# Agent Panel Layout Fixes — Design Spec

**Date:** 2026-05-25  
**Status:** Approved  
**Approach:** A — Minimal targeted fixes  

---

## Problem Statement

Three bugs in `BankingAgent.js` affect all layout modes (floating, embedded dock, inline/agent page):

1. **Start Over not visible** — The Start Over button, Dashboard nav button, and chips footer are siblings of `ba-bottom` in the `ba-right-col` flex column but sit *outside* `ba-bottom`. Because `ba-right-col` has `overflow: hidden`, these elements are clipped when the panel is short (e.g., embedded dock at 520px default height or small viewports).

2. **Messages column does not scroll / is capped** — `.banking-agent-messages` has `max-height: 40vh` hardcoded in CSS. This cap conflicts with the flex layout: the messages container stops growing at 40vh while the remaining siblings (Start Over, nav, chips) are pushed off screen. The parent flex chain already constrains height correctly without this cap.

3. **No guaranteed scroll-to-bottom on response** — The scroll `useEffect` fires synchronously with the React render cycle. `scrollHeight` is not always updated at that point (especially during streaming). The last message may not be visible after the agent responds.

---

## Scope

**In scope:**
- Fix visibility of Start Over button, Dashboard nav button, chips footer
- Remove `max-height: 40vh` cap from messages container
- Make scroll-to-bottom reliable via `requestAnimationFrame`

**Out of scope:**
- Any refactoring of `EmbeddedAgentDock.js`, `AgentPage.js`, `FloatingPanel.jsx`
- Any changes to routes, auth, token chain, MCP, or session logic
- Marketing page stability (`/marketing` paths untouched)

---

## Files Changed

| File | Change |
|------|--------|
| `demo_api_ui/src/components/BankingAgent.js` | Fix 1: move Start Over + nav + chips inside `ba-bottom`; Fix 3: wrap scroll in `requestAnimationFrame` |
| `demo_api_ui/src/components/BankingAgent.css` | Fix 1: add `flex-direction: column; align-items: stretch` to `.ba-bottom`; Fix 2: remove `max-height: 40vh` from `.banking-agent-messages` |

---

## Fix 1 — Start Over / Nav / Chips always visible

### Root cause
Start Over (`ba-start-over-btn`), Dashboard nav (`ba-left-auth-btn`), and chips footer (`ba-chips-footer`) are rendered as direct children of `ba-right-col`, *after* `ba-bottom`. Because `ba-right-col` is `overflow: hidden` and flex, anything that doesn't fit is silently clipped.

### Fix
Move all three elements inside `ba-bottom`, below the existing `ba-input-row`. `ba-bottom` already has `flex-shrink: 0` so it is never clipped.

Update `.ba-bottom` in CSS:
```css
.ba-bottom {
  /* existing properties unchanged */
  flex-direction: column;   /* stack input-row, start-over, nav, chips vertically */
  align-items: stretch;     /* full-width children */
  gap: 0;                   /* manage spacing via child margins */
}
```

Remove the inline `margin`/`width` styles from the Start Over button (they were compensating for being outside `ba-bottom`'s padding — no longer needed inside it).

### Layout after fix
```
ba-right-col
├── banking-agent-messages   (flex: 1, scrollable)
└── ba-bottom                (flex-shrink: 0)
    ├── ba-input-row         (prompt input + Send)
    ├── ba-start-over-btn    (conditional: messages.length > 0)
    ├── ba-left-auth-btn     (conditional: isLoggedIn + not marketing page)
    └── ba-chips-footer      (always)
```

---

## Fix 2 — Messages fill available height

### Root cause
```css
.banking-agent-messages {
  max-height: 40vh;   /* ← this line */
}
```
The messages container stops growing at 40vh regardless of panel height. The parent flex chain (`ba-right-col → ba-body → .banking-agent-panel`) constrains height correctly — `min-height: 0` on `.banking-agent-messages` already handles the embedded-dock shrink case the comment describes.

### Fix
Remove the single line `max-height: 40vh;` from `.banking-agent-messages`. Keep all other properties unchanged (`flex: 1`, `min-height: 0`, `overflow-y: auto`, etc.).

---

## Fix 3 — Reliable scroll-to-bottom

### Root cause
```js
useEffect(() => {
  if (!isOpen) return;
  const el = messagesContainerRef.current;
  if (el) el.scrollTop = el.scrollHeight;
}, [messages, isOpen, loading, nlLoading]);
```
`el.scrollHeight` reads the DOM before the browser has painted new content. During streaming (where `nlLoading` stays `true` and message content is appended), the scroll fires before the new text is in the layout.

### Fix
Wrap the scroll assignment in `requestAnimationFrame` so it fires after the browser paints:

```js
useEffect(() => {
  if (!isOpen) return;
  const el = messagesContainerRef.current;
  if (!el) return;
  const raf = requestAnimationFrame(() => {
    el.scrollTop = el.scrollHeight;
  });
  return () => cancelAnimationFrame(raf);
}, [messages, isOpen, loading, nlLoading]);
```

Dependency array unchanged. The `cancelAnimationFrame` cleanup prevents a stale scroll if the component unmounts or deps change before the frame fires.

---

## Success Criteria

1. Start Over button and prompt input are always visible without scrolling the outer panel, at all panel heights including embedded dock default (520px) and small viewports.
2. Messages fill all available vertical space in the panel — no 40vh cap.
3. After an agent response completes (or during streaming), the latest message is visible at the bottom of the messages area without manual scrolling.

---

## Regression Checklist

- [ ] `cd demo_api_ui && npm run build` exits 0
- [ ] Floating panel: prompt input and Start Over both visible with long conversation
- [ ] Embedded dock: prompt input and Start Over both visible at 520px dock height
- [ ] Inline/Agent page: same as above
- [ ] After agent response: last message auto-scrolls into view
- [ ] Start Over clears conversation correctly
- [ ] Dashboard nav button still works
- [ ] Chips footer still visible
