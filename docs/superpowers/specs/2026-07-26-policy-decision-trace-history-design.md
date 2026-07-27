# Policy Decision Trace — last-run history + staleness modal

**Date:** 2026-07-26
**Status:** design, awaiting user approval

## Why

`/policy-decision-trace` only renders when reached via a client-side `navigate()`
from the "Open policy decision trace" button on PingOne Authorize, which passes
`{ policies, result }` as router state. A direct URL hit or a page refresh loses
that state — React Router state does not survive reload — so the page falls
back to a "No decision trace loaded" placeholder even though a real decision was
just evaluated moments earlier. There is currently no way to get back to that
data without re-running Evaluate.

## What it does

1. **Persist the last run.** Whenever `PolicyDecisionTracePage` receives fresh
   `{ policies, result }` via `location.state`, it writes
   `{ policies, result, savedAt: Date.now() }` to
   `localStorage["policyDecisionTrace.lastRun"]` (survives browser/tab restarts,
   not just the current session — per user preference over sessionStorage).
2. **Auto-load history when there's no fresh state.** If `location.state` is
   absent, read that key back. If present, render the tree from the stored
   data instead of the placeholder. If absent (first-ever visit, or storage was
   cleared), the placeholder is unchanged.
3. **Staleness modal.** Fires only on the historical-load path (a fresh nav is
   live by definition, so it never fires there). Uses the project's
   `DraggableModal`. Copy: "You're viewing your last policy evaluation from
   PingOne Authorize, saved `<savedAt, localized>`. This may not reflect the
   current policy configuration." with a button "Go to PingOne Authorize" that
   navigates to `/pingone-authorize?tab=guided`. Dismissing sets
   `sessionStorage["policyDecisionTrace.historyModalSeen"] = "1"`; the modal is
   skipped for the rest of that tab's session, and reappears in a new
   tab/session even though the underlying `localStorage` data persists longer.

No changes to `PingOneAuthorizePage.jsx` — the read/write and modal all live in
`PolicyDecisionTracePage.jsx` plus one new small modal component/usage.

## Components & changes

### `demo_api_ui/src/components/PolicyDecisionTracePage.jsx`

- Add a `LAST_RUN_KEY = "policyDecisionTrace.lastRun"` constant and a
  `MODAL_SEEN_KEY = "policyDecisionTrace.historyModalSeen"` constant.
- Add a small serialize-with-cap helper (co-located, not a shared util — single
  call site):

  ```js
  const MAX_STORED_BYTES = 500_000; // ~500KB JSON string length

  function saveLastRun(policies, result) {
    try {
      const payload = JSON.stringify({ policies, result, savedAt: Date.now() });
      if (payload.length > MAX_STORED_BYTES) return; // skip: unexpectedly large
      localStorage.setItem(LAST_RUN_KEY, payload);
    } catch {
      // quota exceeded or storage unavailable — skip silently, keep old value
    }
  }

  function loadLastRun() {
    try {
      const raw = localStorage.getItem(LAST_RUN_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || !Array.isArray(parsed.policies) || !parsed.result) return null;
      return parsed;
    } catch {
      return null; // corrupt JSON — treat as absent
    }
  }
  ```

- On mount: if `location.state` has a valid `{ policies, result }`, call
  `saveLastRun` (fire-and-forget) and render as today (`isHistorical = false`).
  Otherwise call `loadLastRun()`; if it returns data, render from it
  (`isHistorical = true`); otherwise keep the existing placeholder branch
  unchanged.
- When `isHistorical` and `sessionStorage[MODAL_SEEN_KEY]` is not set, open the
  staleness modal on mount; closing it sets that flag.

### New: staleness modal markup (inline in the same file, or a tiny
`PolicyDecisionStaleModal.jsx` if the JSX grows past a few lines) — wraps
`DraggableModal`, per the standing "all modals use DraggableModal" rule.

## Edge cases

- **Corrupt/missing localStorage JSON** → `loadLastRun()` returns `null` on any
  parse failure or shape mismatch → treated as "no history," falls to the
  existing placeholder. No throw reaches the render path.
- **Oversized payload** → capped at 500KB (JSON string length) before
  `setItem`; over cap, the write is skipped and whatever was previously stored
  (if anything) is left in place. This is comfortably above the expected size
  (a ~98-node policy tree plus one decision result — tens of KB), so it only
  guards against unexpected runaway growth, not normal operation.
- **Full/blocked storage** (`QuotaExceededError`, privacy mode, etc.) →
  `setItem` wrapped in try/catch; failure is silent (no user-facing error, no
  crash) since this is a best-effort convenience feature, not a critical path.
- **Modal reappearing** — dismiss flag is `sessionStorage`-scoped (per tab
  session) while the underlying trace data is `localStorage`-scoped (longer
  lived); a new tab/session will show the modal again the first time it loads
  historical data, even though the same stored run is still being displayed.
  This is intentional: the point of the modal is "you're not looking at a live
  decision," which is worth re-surfacing each session even if the same stale
  data persists across restarts.

## Success criteria

- Visiting `/policy-decision-trace` directly (no router state) after a prior
  Evaluate run in this browser shows that run's tree, not the placeholder.
- A brand-new browser profile / cleared storage still shows the existing
  "No decision trace loaded" placeholder — unchanged behavior.
- The staleness modal appears exactly once per tab session when history loads,
  and not at all when the page is reached via a fresh Evaluate → "Open policy
  decision trace" navigation.
- An oversized or corrupted stored payload never crashes the page — it falls
  back to the placeholder or the previous valid stored value.
- UI build gate (`npm run build`) passes; emoji allowlist respected (no new
  emoji needed); modal uses `DraggableModal`.

## Out of scope

- Any change to `PingOneAuthorizePage.jsx` or its Evaluate flow.
- Multi-run history (list of past runs) — only the single most recent run is
  kept, per the original ask ("last run").
- Server-side persistence / cross-device sync — this is client-local
  (`localStorage`), scoped to one browser.
- The comment-only admin-wording fix on `authorize.js` (`/evaluate-endpoint`,
  `/endpoints/:id/recording`) — already applied separately, unrelated to this
  feature.

## Test plan

- Unit: `PolicyDecisionTracePage` — (a) fresh `location.state` renders tree and
  writes `localStorage`; (b) no state + valid stored run renders tree
  (historical) and shows the modal once; (c) no state + no stored run shows the
  placeholder; (d) corrupt stored JSON falls back to placeholder; (e) oversized
  payload is not written (mock `Date.now`/craft a payload over the cap, assert
  `setItem` not called or prior value retained).
- Live: run an Evaluate on `/pingone-authorize`, open the trace, refresh the
  trace page directly — tree + modal appear; dismiss modal, refresh again —
  tree appears without the modal (same tab session).
