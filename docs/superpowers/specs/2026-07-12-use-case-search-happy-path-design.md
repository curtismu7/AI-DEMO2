# Use Case Launcher — Search + Happy Path grouping

**Date:** 2026-07-12
**Status:** Approved (brainstorming)
**Scope:** `demo_api_ui/src/pages/UseCaseLauncherPage.js` (+ its `.css`), `demo_api_ui/src/__tests__/UseCaseLauncherPage.test.js`

## Problem

`UseCaseLauncherPage` renders ~30 use cases grouped by `track` (`foundations`,
`demo`, `attacks`, `hitl`, `controls`, `learn`, `tools`). Two gaps:

1. No way to find a specific use case without scrolling/scanning every track
   section.
2. No single place to see "the happy path" — cases where the agent action is
   ultimately permitted — across tracks. Today `foundations` is labeled
   "Happy Paths" in `TRACK_LABELS`, but it mixes PERMIT outcomes (`UC1`,
   `UC2`, `UC3`, `UC20`) with non-PERMIT ones (`UC2.5` is
   `DELEGATE_AND_EXECUTE`, `UC19` is `DENY_401`), and PERMIT cases also exist
   outside `foundations` (`UC4`, `UC17`, `UC21`, `UC22`, `UC25`).

## Goals

- Add a search box that filters the visible cards by free text.
- Add a "Happy Path" group above all track sections containing every use
  case whose `expectedOutcome === 'PERMIT'`.
- Each use case appears exactly once on the page (no duplicate cards).

## Non-goals

- Changing the Progressive Trust Demo strip's Act 1–5 behavior.
- Changing vertical switching, flag gating, or attack-sim running.
- Persisting search text across navigation/reload.

## Design

### 1. Happy Path grouping

Compute a `happyPath` array once per `useCases` load:

```js
const happyPath = useCases.filter(
  (uc) => uc.expectedOutcome === 'PERMIT' && !PROGRESSIVE_TRUST_STRIP_IDS.has(uc.id)
);
```

The `PROGRESSIVE_TRUST_STRIP_IDS` exclusion keeps `UC24` (Act 1) out of the
grid, consistent with its existing treatment in the `demo` track section — it
is surfaced only inside `ProgressiveTrustDemoStrip`, never as a standalone
card.

When building each track's `items` (existing `grouped` computation), also
exclude anything now in `happyPath`:

```js
const happyPathIds = new Set(happyPath.map((uc) => uc.id));
const grouped = TRACK_ORDER.map((track) => ({
  track,
  items: useCases.filter((uc) => uc.track === track && !happyPathIds.has(uc.id)),
}));
```

**Exception — `demo` track's strip data stays unfiltered.** The value passed
to `<ProgressiveTrustDemoStrip useCases={items} .../>` must remain the
track-filtered list *before* the happy-path exclusion, because
`resolveProgressiveTrustActs` looks up cards by `id` for its own act map and
must not be affected by this feature. Concretely: compute
`demoTrackItemsForStrip = useCases.filter((uc) => uc.track === 'demo')`
separately and pass that to the strip component; the grid `displayItems` for
the `demo` section itself still applies the happy-path exclusion +
existing `PROGRESSIVE_TRUST_STRIP_IDS` filter as today.

Render order: Happy Path section first (own `<section>`, own heading), then
the existing `grouped.map(...)` unchanged in structure.

**Happy Path heading:** `"Happy Paths — successful outcomes across every track"`.

**Foundations heading update:** since most of its PERMIT content moves out,
change `TRACK_LABELS.foundations` from `'Happy Paths — core delegation and
authorization'` to `'Foundations — delegation lifecycle'`.

An empty Happy Path array (e.g. future catalog edit) simply renders nothing,
same as any other empty track today (`if (items.length === 0) return null`).

### 2. Search box

New controlled input rendered in `uc-launcher__header`, below the subtitle,
above the vertical picker (or alongside it — implementation detail, not
load-bearing). State: `const [query, setQuery] = useState('')`.

Match predicate (case-insensitive substring against a joined haystack):

```js
function matchesQuery(uc, query) {
  if (!query.trim()) return true;
  const q = query.trim().toLowerCase();
  const haystack = [uc.id, uc.useCaseId, uc.title, uc.buyerStory, uc.whatToSay, uc.trigger?.text]
    .filter(Boolean)
    .join(' \n ')
    .toLowerCase();
  return haystack.includes(q);
}
```

Applied as an additional `.filter((uc) => matchesQuery(uc, query))` step on:
- `happyPath` before rendering its grid
- each track's `displayItems` before rendering its grid

Each section keeps its existing `if (items.length === 0) return null` guard,
which now also fires when a search query zeroes out that section — satisfying
"keep groups, hide empty ones."

If **no** section has any matches, render a single top-level empty state
below the header: `No use cases match "<query>".` (styled with existing
`uc-launcher__error`-like treatment, new modifier class
`uc-launcher__empty`).

The Progressive Trust Demo strip is **not** filtered by search — it's a fixed
presenter script, not a browsable catalog grid. It continues to render
whenever the `demo` track section itself is non-empty and un-searched;
concretely, hide the whole strip when `query.trim()` is non-empty (searching
implies "help me find a specific card," not "run the demo script"). This
avoids a half-filtered Act list ever rendering.

### 3. Test coverage additions

Extend `UseCaseLauncherPage.test.js`:
- Happy Path section renders above track sections and contains only
  PERMIT-outcome mock use cases; a PERMIT use case does not also appear in
  its original track section (assert single occurrence).
- Search input filters cards across Happy Path and track sections by title
  substring, by `useCaseId` substring, and by trigger text substring.
- Clearing search restores full view.
- Query matching nothing renders the empty-state message and no track
  headings.
- Searching hides the Progressive Trust Demo strip; clearing search restores
  it.

## Open questions

None outstanding — resolved during brainstorming:
- Happy Path definition: `expectedOutcome === 'PERMIT'`.
- Dedup: cards appear once (Happy Path wins over original track).
- Search fields: id, useCaseId, title, buyerStory, whatToSay, trigger text.
- Search layout: grouped-with-empty-hidden, not flattened.
