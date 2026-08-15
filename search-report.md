# Server-side search on the New Relic dashboards

Commit: `b79957c8c` — feat(monitoring): server-side search on New Relic dashboards
Round 2 commit: `65dba266f` — fix(monitoring): strip LIKE wildcards; search per-view field sets
Branch: `worktree-dashboard-search`

## What changed

### BFF — `demo_api_server/routes/newRelicQuery.js`

- `GET /api/newrelic/view/:view` (and the `/pipeline` alias, which shares the
  same handler) now accepts an optional `q` query param.
- `q` is trimmed and truncated to `MAX_SEARCH_LEN = 200` chars before it ever
  reaches query construction — not rejected, truncated, so a caller pasting
  something absurd still gets a working (if shortened) search instead of an
  error.
- The term is applied **only** to the `stream` sub-query, as
  `AND message LIKE '%<escaped term>%'`, appended before `SINCE`. The
  facet/decisions/posture/rules/timeseries sub-queries are untouched — a
  search narrows the event list, it does not rewrite the summary panels
  above it, per the task's instruction.
- `_escapeNrqlLiteral()` backslash-escapes backslashes first, then escapes
  `'` as `\'` — the standard NRQL string-literal escape. This runs *before*
  the existing `JSON.stringify(fullNrqlString)` wrap that embeds the whole
  NRQL string into the GraphQL request body. The two escaping passes serve
  different layers: mine keeps the term from closing the NRQL string early;
  the pre-existing `JSON.stringify` keeps the whole NRQL string from
  breaking the *outer* GraphQL string literal (double-quote/backslash
  escaping). Double quotes in the term need no extra handling — `JSON.stringify`
  already escapes those at the outer layer.
- Absent or empty `q` is a no-op: `search` resolves to `''`, `_searchClause`
  returns `''`, and the built query is byte-for-byte what it was before this
  change.
- The response payload always includes `q`, set to what the server actually
  applied (post-trim/truncate) — not an echo of the raw request param — so
  the client can tell if its term got truncated.
- Cache key changed from `` `${view}:${window}` `` to
  `` `${view}:${window}:${search}` `` — a searched request inside the 20s TTL
  can no longer be served the unsearched payload, or vice versa.

### UI — shared search input in `DashboardShell`

- `DashboardShell` (`demo_api_ui/src/components/dashboard/DashboardShell.jsx`)
  gained a search box that renders next to the window-selector buttons in
  `.dash-head`, opt-in via a new `onSearch` prop (search input only renders
  if the caller passes it). This kept the existing prop shape intact — no
  awkwardness, since `DashboardShell` only has the two callers this task
  touches.
- The shell owns keystroke→debounced-value plumbing (300ms, hand-rolled
  `useRef` + `setTimeout`/`clearTimeout`, no lodash — matches the existing
  debounce pattern already used in `UserSearchDropdown.jsx`). The caller
  only ever sees the settled term via `onSearch(value)`, the same way it
  only ever sees a clicked `window` value via `onWindow`.
- A clear (`✕`) button appears once there's text, and clears + fires
  `onSearch('')` immediately, bypassing the debounce timer so clearing feels
  instant.
- `.dash-search.is-active` (border color change) shows a search is active
  while typing.
- New CSS (`dashboard.css`) reuses the existing `--dash-*` tokens (surface,
  line, ink, accent) already defined on `.dash` — no new `--*-ground` token
  needed since `.dash-search` is an interior control, not a new visual
  ground, same pattern as `.dash-seg`/`.dash-theme`. No new monospace CSS
  was added, so no change was needed to the `uiRegression.test.js` mono
  allowlist.
- `NewRelicDashboard.jsx` / `P1AzDashboard.jsx`: added a `search` state,
  threaded into the fetch URL as `&q=${encodeURIComponent(search)}` when
  non-empty, and into `load`'s `useCallback` deps (same pattern as the
  existing `win` dependency) so a settled search term triggers a fetch and
  resets the 30s poll interval, exactly like a window change does.
- `EventStream.jsx` gained an `emptyMessage` prop. Both dashboards compute
  it from **`data?.q`** (what the server confirms it applied), not the local
  `search` state — so the message is correct even if the debounced client
  value hasn't caught up with what was last fetched. When set:
  `No events match "<term>".` (pipeline) / `No decisions match "<term>".`
  (authorize). When `data.q` is empty, `EventStream` falls back to its
  original `No events in this window.` text — unchanged behavior for the
  no-search case.
- `NewRelicDashboard.jsx`'s existing `hasNoTraffic` collapse (which replaces
  the whole card grid with a single "no traffic" message) is driven by
  `totalEvents` from the **unfiltered** funnel query, not by the search-
  filtered stream — so a search that matches nothing still shows the
  facet/sparkline/category panels with real data, and only the "Recent
  events" table shows the distinct no-matches message. No code change was
  needed for this — it fell out of "search only touches `stream`."

## One thing worth flagging

`P1AzDashboard`'s stream table (`STREAM_COLUMNS`) doesn't display the raw
`message` field — only `decision`, `ruleName`, `amount`, `type`, etc. Search
still filters on `message` there (per the task's instruction to apply search
identically on both dashboards' stream query), and the live check below
confirms it does narrow results (8 → 4 rows for "DENY"). But a user won't
see *why* a row matched, since the matched text isn't a visible column. I
left this as-is rather than deviating from the spec, but flagging it as a
possible follow-up (e.g. surfacing `message` as a tooltip or hidden-but-
searchable column) if it turns out to be confusing in practice.

## Tests

### BFF — `cd demo_api_server && CI=true npx jest tests/newRelicQuery.test.js`

```
Test Suites: 1 passed, 1 total
Tests:       28 passed, 28 total
```

New cases added (9), covering: absent/empty `q` unchanged (no `LIKE` in the
query, `q: ''` in the response); term reaches only the `stream` sub-query
for both `pipeline` and `authorize` (funnel/decisions/posture/rules/
timeseries assert no `LIKE`); an apostrophe is escaped and cannot break the
NRQL literal (asserted directly on the generated query text — the doubled-
backslash form the escaping produces once wrapped by the existing
`JSON.stringify`, plus a negative assertion that the *unescaped* broken form
never appears); a double quote needs no extra handling; an over-long term is
truncated to 200 chars (not rejected) and the reported `q` reflects the
truncated value; the cache does not cross-serve a searched payload to an
unsearched request or vice versa.

### UI — `cd demo_api_ui && npx vitest run <the 4 target paths>`

```
✓ src/components/dashboard/__tests__/EventStream.test.jsx (6 tests)
✓ src/__tests__/uiRegression.test.js (43 tests)
✓ src/components/dashboard/__tests__/DashboardShell.test.jsx (17 tests)
✓ src/components/__tests__/P1AzDashboard.test.jsx (16 tests)
✓ src/components/__tests__/NewRelicDashboard.test.jsx (19 tests)

Test Files  5 passed (5)
     Tests  101 passed (101)
```

New `DashboardShell` cases: no input renders without `onSearch`; input
renders with `onSearch`; several keystrokes (fake timers) fire `onSearch`
exactly once with the final value; active/clear-button state; clearing
fires immediately and the pending debounced call from prior typing does not
also fire afterward. All keystroke/click interactions use `fireEvent`, never
raw `.click()`.

New `NewRelicDashboard`/`P1AzDashboard` cases (mirrored across both):
typing → debounced request carries `q`; several keystrokes → exactly one
extra request, not one per keystroke; clearing → restores the unsearched
request URL; a `q`-bearing empty-stream payload renders the distinct
"no matches" message and *not* the generic empty message; a `q`-less
empty-stream payload renders the generic message and *not* the "no matches"
one.

No `act()` warnings in any run.

### Build — `cd demo_api_ui && npm run build`

```
✓ built in 1.79s
```
Exit 0.

## Live verification

Ran the actual (unmocked) route module against the real NerdGraph endpoint,
using `NR_USER_API_KEY` / `NR_ACCOUNT_ID` from `demo_api_server/.env` (key
never printed). Script and its output are not part of the diff — this was a
one-off check, not a repo artifact.

| Case | Window | Result |
|---|---|---|
| Unsearched baseline (`pipeline`) | 30m | 200, `q: ""`, 50 rows (LIMIT cap) |
| `q=PingOne` (`pipeline`) | 30m | 200, `q: "PingOne"`, 50 rows — sample message `PingOne USER.ACCESS_ALLOWED: SUCCESS` |
| `q=MCP` (`pipeline`) | 30m | 200, `q: "MCP"`, **10 rows** — sample message `MCP tool call → get_my_accounts` (clear narrowing vs. the 50-row baseline) |
| `q=zzz-nonexistent-term-xyz123` (`pipeline`) | 30m | 200, `q` echoed, **0 rows**, no error |
| `q=PingOne's` (apostrophe, `pipeline`) | 30m | **200**, `q: "PingOne's"`, 0 rows — no NRQL syntax error |
| Unsearched baseline (`authorize`) | 14d | 200, `q: ""`, 8 rows |
| `q=DENY` (`authorize`) | 14d | 200, `q: "DENY"`, **4 rows** (narrowed from 8) |
| `q=it's` (apostrophe, `authorize`) | 14d | **200**, `q: "it's"`, 0 rows — no NRQL syntax error |

Both the matching-term case (`MCP`: 50→10 rows) and the non-matching case
(0 rows, no error) behave as expected, and both apostrophe cases return a
clean 200 with an empty result set rather than a 502/NRQL syntax error —
the escaping holds against live data, not just the mocked unit tests.

## Verify checklist

- ✅ BFF: `CI=true npx jest tests/newRelicQuery.test.js` — 28/28 pass
- ✅ UI: target vitest paths — 101/101 pass, no `act()` warnings
- ✅ UI build: exit 0
- ✅ Live NerdGraph: matching/non-matching/apostrophe all behave correctly
- ✅ Every changed line traces to the request; staged explicitly (no `git add -A`)
- ✅ Emoji allowlist respected (only `✕` used, for the clear button)

---

# Round 2 — review fixes

Commit `65dba266f`. Two Important findings, both addressed; one Minor comment
fix folded in.

## Finding 1 — LIKE wildcard metacharacters (`%`, `_`) were not neutralized

### What I checked before picking a fix

The review named `%`/`_` explicitly and warned against fabricating an
`ESCAPE` clause that NRQL silently ignores. Rather than guess, I checked
what NRQL actually supports, in three ways, live against the account:

1. **Docs (New Relic + GitHub docs-website source)**: `LIKE` documented
   with `%` as a wildcard; no `ESCAPE` clause documented; `_` not mentioned
   at all as a wildcard.
2. **Tried an `ESCAPE` clause live**:
   `... LIKE '%M\%P%' ESCAPE '\' ...` — NerdGraph rejected it outright:
   `NRQL Syntax Error: Error at line 1 position 78, unexpected 'ESCAPE'`.
   Confirms NRQL has no `ESCAPE` clause at all — using one would have been
   exactly the "looks correct, does nothing" trap the review warned about
   (worse: here it doesn't even silently no-op, it 502s every search).
3. **Tried `position()`/`substring()` as a wildcard-free alternative**,
   live, in both `SELECT` and `WHERE`: `SELECT position('MCP', message) ...`
   returned `null` for every row, and
   `WHERE position(message, 'MCP') > 0` returned `count: 0` against a
   window where a plain `LIKE '%MCP%'` returned `count: 2`. The functions
   parse (no syntax error) but don't evaluate usably against `Log` data in
   this account — a real example of a construct that looks right and does
   nothing, confirming the review's warning generalizes beyond `ESCAPE`.
4. **Tested `_` empirically**: `LIKE '%M_P%'` against a window containing
   `"MCP tool call"` (M, C, P — exactly the 3 characters `_` would need to
   span) returned `count: 0`, while the `%`-wildcard equivalent
   (`LIKE '%M%P%'`) returned a nonzero count in the same window. This is
   live evidence NRQL's `LIKE` does **not** treat `_` as a single-char
   wildcard here (matches the docs' silence on it).

### The fix

Given no working literal-match construct exists, I stripped `%` and `_`
from the term before it ever reaches `LIKE` (`_stripLikeMetacharacters` in
`newRelicQuery.js`). `_` is stripped defensively even though live testing
didn't show it behaving as a wildcard in this account — relying on one
account's undocumented behavior never changing felt like the same kind of
unverified guess the review was steering away from, and stripping it costs
nothing. **Honest limitation, stated plainly**: a caller can no longer
search for a literal `%` or `_` — there is no NRQL construct that lets them.
Stripping happens once, in `_handleView`, as part of the same
trim → strip → truncate pipeline that produces the canonical `search`
value — so the reported `q` in the response always reflects what actually
reached the query, consistent with how truncation was already reported. A
term that is *only* metacharacters (e.g. `"%%%"`) normalizes to `''`,
which is treated identically to no search at all.

### Live proof (this round)

| Case | Result |
|---|---|
| `q=M%25P` (`M%P`, pipeline, 30m) | `q: "MP"` (stripped), **1 row** — a message containing literal "mp" (inside "pro**mp**t") |
| `q=MCP` (pipeline, 30m, same window) | `q: "MCP"`, 2 rows — for comparison; the `M%P` case above did **not** inherit this "contains M...P" wildcard match, proving `%` no longer acts as a wildcard |
| `q=50%25` (`50%`, pipeline, 30m) | `q: "50"` (stripped), **0 rows** — searches for literal "50", not "starts with 50" |

The `M%P` case is the direct proof the review asked for: before this fix,
the same input produced `count: 8`/`9` against a nearly-identical window
(round-1 exploratory probe) because `%M%P%` matched anything containing "M"
eventually followed by "P". After the fix it searches for the literal
substring "MP" and returns exactly the rows that contain it — a real,
bounded, explainable result instead of an accidental "match everything."

## Finding 2 — authorize searched `message`, a field it never displays

### The fix

Made the searched field set per-view, built into the same server-side
registry (`_likeClause(fields, search)` takes an array of columns and OR's
them together, still on the `stream` query only, still with the same
escaping):

- `pipeline` → `message` (unchanged — it's the one free-text column
  `NewRelicDashboard`'s stream table renders).
- `authorize` → `ruleName`, `decision`, `type` — the columns
  `P1AzDashboard`'s stream table actually renders. `message` is no longer
  searched there.

The client still sends only a term (`q`); the server alone decides which
fields it's compared against, per view. No client-facing shape changed.

### Live proof (this round)

Live rule attribution happened to be empty in the current 14-day window
(`rules: []`— NRQL only emits attributed-decision rows, and none were
attributed at check time), so I verified against `decision` and `type`
instead — both in the new searched set and both rendered in the table:

| Case | Result |
|---|---|
| Baseline, unsearched (`authorize`, 14d) | `q: ""`, 8 rows |
| `q=DENY` (a visible `decision` value) | `q: "DENY"`, **4 rows** (narrowed from 8, all with `decision: "DENY"`) |
| `q=transfer` (a visible `type` value) | `q: "transfer"`, 8 rows (every row in this window happens to be a transfer) |
| `q=gate permitted` (`message`-only text — this is literally the log message logged for a permitted decision, e.g. `"Authorize gate permitted — get_my_accounts"`) | `q: "gate permitted"`, **0 rows** |

The last row is the direct proof: before this fix, searching for text that
only exists in `message` (like `"gate permitted"`) would have matched those
decisions even though no visible column shows why. After the fix it
correctly returns 0 — `message` is no longer part of the authorize search.

## Minor — fixed the wrong `SINCE` comment

`newRelicQuery.js:38` said the search "only narrows the stream query's
SINCE window further" — search has nothing to do with `SINCE`. Reworded to
describe what's actually true: the stream query already carries its own
WHERE scope (e.g. `category='authorize'`), and a search can only narrow
that further, never remove or loosen an existing condition.

## Not fixed (per review instruction)

`DashboardShell`'s `inputValue` resync trap (`DashboardShell.jsx:24`) — left
as-is; latent only, no consumer resets `search` externally.

## Tests

### BFF — `cd demo_api_server && CI=true npx jest tests/newRelicQuery.test.js`

```
Test Suites: 1 passed, 1 total
Tests:       32 passed, 32 total
```

4 new cases beyond round 1: a literal `%` is stripped, not left as a
wildcard (asserted on generated query text — `M%P` → `(message LIKE
'%MP%')`, and the wildcard-widened form `%M%P%` never appears); a literal
`_` is stripped too; an all-metacharacter term normalizes to `''` (same as
no search); the two field-set tests the review asked for — pipeline's
stream query is unchanged (`(message LIKE '%PingOne%')`) and authorize's
stream query references `ruleName`/`decision`/`type` OR'd together and
explicitly does **not** contain `message LIKE`.

### UI — unchanged from round 1 (no UI files touched this round)

```
✓ src/components/dashboard/__tests__/EventStream.test.jsx (6 tests)
✓ src/components/dashboard/__tests__/DashboardShell.test.jsx (17 tests)
✓ src/__tests__/uiRegression.test.js (43 tests)
✓ src/components/__tests__/NewRelicDashboard.test.jsx (19 tests)
✓ src/components/__tests__/P1AzDashboard.test.jsx (16 tests)

Test Files  5 passed (5)
     Tests  101 passed (101)
```

No `act()` warnings.

### Build — `cd demo_api_ui && npm run build`

```
✓ built in 1.99s
```
Exit 0.

## Round-2 verify checklist

- ✅ BFF: 32/32 pass (28 round-1 + 4 new)
- ✅ UI: 101/101 pass, no `act()` warnings (unchanged — no UI files touched)
- ✅ UI build: exit 0
- ✅ Live: `%` term proven non-wildcard (`M%P` → literal "MP", 1 explainable row); `50%` → literal "50", 0 rows
- ✅ Live: authorize search on a visible `decision`/`type` value narrows results; a `message`-only term (`"gate permitted"`) now correctly returns 0
- ✅ No `ESCAPE` clause used (confirmed live that NRQL rejects one) — the report states the honest limitation instead
- ✅ Staged explicitly (`git add demo_api_server/routes/newRelicQuery.js demo_api_server/tests/newRelicQuery.test.js`), no `git add -A`
- ✅ `fireEvent` used throughout (no UI test changes this round, but round-1 tests already comply)
- ✅ No new dependencies
