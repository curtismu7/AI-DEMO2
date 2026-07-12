# Use Case Launcher — Search + Happy Path Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a search box and a top-of-page "Happy Path" (PERMIT-outcome) grouping to `UseCaseLauncherPage`, per `docs/superpowers/specs/2026-07-12-use-case-search-happy-path-design.md`.

**Architecture:** Two sequential changes to one React component (`UseCaseLauncherPage.js`) plus its stylesheet and test file. Task 1 introduces the deduped "Happy Path" grid section. Task 2 layers a client-side search filter on top of Task 1's grouping.

**Tech Stack:** React (function component + hooks), Vitest + `@testing-library/react`, plain CSS (existing `uc-*` BEM-ish class conventions, `var(--color-*)` custom properties).

## Global Constraints

- **Minimal diff** (CLAUDE.md §0): name the component, name the element, change only that. No unrelated cleanup of adjacent code in `UseCaseLauncherPage.js`.
- **Emoji allowlist** (CLAUDE.md §0): only `⚠️ ✅ ❌ 🔐 ✕ ✓ 👤 🔑` are permitted in UI text. No emoji is needed by this feature — do not add any.
- **Worktree required**: all edits happen in `/Users/cmuir/Development/AI-DEMO2/.claude/worktrees/feat+use-case-search-happy-path` on branch `worktree-feat+use-case-search-happy-path`. Stage files explicitly (`git add <path>`), never `git add -A`.
- **Test runner**: this page's tests run under Vitest, not Jest — use `npx vitest run <path>` from `demo_api_ui/`, not `jest`.
- **Baseline**: 16/16 tests passing in `demo_api_ui/src/__tests__/UseCaseLauncherPage.test.js` before this work; both tasks below must end with that count strictly increasing and 0 failures.

---

## Task 1: Happy Path grouping (dedup PERMIT-outcome cards above track sections)

**Files:**
- Modify: `demo_api_ui/src/pages/UseCaseLauncherPage.js`
- Modify: `demo_api_ui/src/pages/UseCaseLauncherPage.css`
- Test: `demo_api_ui/src/__tests__/UseCaseLauncherPage.test.js`

**Interfaces:**
- Consumes: existing `TRACK_ORDER`, `TRACK_LABELS`, `PROGRESSIVE_TRUST_STRIP_IDS`, `UseCaseCard`, `ProgressiveTrustDemoStrip` components already defined in this file (see current file for their signatures — unchanged by this task).
- Produces: a new module constant `HAPPY_PATH_LABEL` (string) and, inside `UseCaseLauncherPage`, three new local variables — `happyPath` (array of use-case objects with `expectedOutcome === 'PERMIT'`, excluding `PROGRESSIVE_TRUST_STRIP_IDS` members), `happyPathIds` (`Set` of their ids), and `demoTrackItemsForStrip` (all `track === 'demo'` use cases, unfiltered). Task 2 reads and extends all three.

- [ ] **Step 1: Write the failing tests**

Open `demo_api_ui/src/__tests__/UseCaseLauncherPage.test.js`. Add `within` to the existing `@testing-library/react` import (line 22):

```js
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
```

Then add these two tests inside the existing `describe('UseCaseLauncherPage', ...)` block, immediately before the closing `});` of the file (after the `T6e` test, so after line 412's `});` for that test and before the describe block's own closing `});`):

```js
  // ── Happy Path grouping ─────────────────────────────────────────────────
  it('renders a Happy Path section above track sections containing only PERMIT-outcome use cases, deduped from their track', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText(/Happy Paths — successful outcomes/i)).toBeInTheDocument());

    const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    const happyPathIdx = headings.findIndex((h) => /Happy Paths — successful outcomes/i.test(h));
    const foundationsIdx = headings.findIndex((h) => /^Foundations/i.test(h));
    expect(happyPathIdx).toBe(0);
    expect(foundationsIdx).toBeGreaterThan(happyPathIdx);

    // UC1 (expectedOutcome: 'PERMIT') appears exactly once on the page.
    expect(screen.getAllByText('Delegated access with proof')).toHaveLength(1);

    // UC2's outcome is 'PERMIT with act-chain depth', not an exact 'PERMIT' match,
    // so it stays in its original Foundations section, not Happy Path.
    const foundationsHeading = screen.getByRole('heading', { level: 2, name: /^Foundations/i });
    const foundationsSection = foundationsHeading.closest('section');
    expect(within(foundationsSection).getByText('A2A delegation')).toBeInTheDocument();
  });

  it('does not render a Happy Path section when no use case has a PERMIT outcome', async () => {
    apiClient.get.mockResolvedValue({
      data: { vertical: 'banking', useCases: [UC_INSUFFICIENT_SCOPE, UC_WRONG_AUD] },
    });
    renderPage();
    await waitFor(() => expect(screen.getByText('Insufficient scope attack')).toBeInTheDocument());
    expect(screen.queryByText(/Happy Paths — successful outcomes/i)).not.toBeInTheDocument();
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd demo_api_ui && npx vitest run src/__tests__/UseCaseLauncherPage.test.js`
Expected: the two new tests FAIL (heading `/Happy Paths — successful outcomes/i` not found — the component doesn't render it yet); the 16 pre-existing tests still PASS.

- [ ] **Step 3: Update `TRACK_LABELS.foundations` and add `HAPPY_PATH_LABEL`**

In `demo_api_ui/src/pages/UseCaseLauncherPage.js`, replace the `foundations` line inside `TRACK_LABELS` (currently line 28):

```js
  foundations: 'Happy Paths — core delegation and authorization',
```

with:

```js
  foundations: 'Foundations — delegation lifecycle',
```

Immediately after the `TRACK_LABELS` object's closing `};` (currently line 35), add:

```js

const HAPPY_PATH_LABEL = 'Happy Paths — successful outcomes across every track';
```

- [ ] **Step 4: Compute `happyPath`, `happyPathIds`, `demoTrackItemsForStrip`, and dedup `grouped`**

In `UseCaseLauncherPage()`, replace the existing block (currently lines 771–775):

```js
  // Group use cases by track, in TRACK_ORDER order.
  const grouped = TRACK_ORDER.map((track) => ({
    track,
    items: useCases.filter((uc) => uc.track === track),
  }));
```

with:

```js
  // Happy Path: every use case whose outcome is PERMIT, excluding cards that
  // are exclusively surfaced via the Progressive Trust Demo strip (UC24 / Act 1).
  const happyPath = useCases.filter(
    (uc) => uc.expectedOutcome === 'PERMIT' && !PROGRESSIVE_TRUST_STRIP_IDS.has(uc.id)
  );
  const happyPathIds = new Set(happyPath.map((uc) => uc.id));

  // Group use cases by track, in TRACK_ORDER order. Cards already shown in the
  // Happy Path section above are excluded here so each use case renders
  // exactly once on the page.
  const grouped = TRACK_ORDER.map((track) => ({
    track,
    items: useCases.filter((uc) => uc.track === track && !happyPathIds.has(uc.id)),
  }));

  // ProgressiveTrustDemoStrip resolves its Acts by id across the full 'demo'
  // track (Acts 2-5 reference UC1/UC7/UC8/UC22/UC6) — it must stay unaffected
  // by the Happy Path dedup above.
  const demoTrackItemsForStrip = useCases.filter((uc) => uc.track === 'demo');
```

- [ ] **Step 5: Render the Happy Path section and fix the strip's data source**

In the same file, find the JSX block that starts right after `</header>` (currently line 806: `{grouped.map(({ track, items }) => {`). Insert a new block immediately before it:

```jsx
      {happyPath.length > 0 && (
        <section className="uc-track uc-track--happy-path">
          <h2 className="uc-track__heading">{HAPPY_PATH_LABEL}</h2>
          <div className="uc-track__grid">
            {happyPath.map((uc) => (
              <UseCaseCard
                key={uc.id}
                uc={uc}
                onRun={handleRun}
                onRunAttack={handleRunAttack}
                onExplain={setExplainUc}
                onOpen={handleOpen}
                attackState={attackStates[uc.id]}
                chipRunning={chipRun?.id === uc.id && chipRun.state === 'running'}
                chipRunError={chipRun?.id === uc.id && chipRun.state === 'error' ? chipRun.msg : null}
                flagMap={flagMap}
                flagsLoading={flagsLoading}
                setFlag={setFlag}
              />
            ))}
          </div>
        </section>
      )}

```

Then, inside the existing `{grouped.map(...)}` block, find the `ProgressiveTrustDemoStrip` element (currently lines 814–823) and change its `useCases` prop from `items` to `demoTrackItemsForStrip`:

```jsx
            {track === 'demo' && (
              <ProgressiveTrustDemoStrip
                useCases={demoTrackItemsForStrip}
                onRun={handleRun}
                onExplain={setExplainUc}
                chipRun={chipRun}
                flagMap={flagMap}
                flagsLoading={flagsLoading}
                setFlag={setFlag}
              />
            )}
```

- [ ] **Step 6: Add CSS for the Happy Path section**

`UseCaseCard` and `.uc-track__grid`/`.uc-track__heading` are reused as-is, so no new card styling is required. Add a small modifier for potential future distinct styling and to keep the class present in the stylesheet. In `demo_api_ui/src/pages/UseCaseLauncherPage.css`, after the existing `.uc-track__grid` rule (currently lines 62–66), add:

```css
.uc-track--happy-path .uc-track__heading {
  border-bottom-color: var(--color-accent, #2563eb);
}
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `cd demo_api_ui && npx vitest run src/__tests__/UseCaseLauncherPage.test.js`
Expected: PASS — all 16 pre-existing tests plus the 2 new tests (18 total), 0 failures.

If any pre-existing test fails, read the failure carefully before changing test code — Step 4/5 are structured so that `grouped`'s shape (`{track, items}`) and every `UseCaseCard`/`ProgressiveTrustDemoStrip` prop is unchanged except the strip's `useCases` source, so no pre-existing assertion should need edits. Do not "fix" a pre-existing test to make it pass without first understanding why it broke.

- [ ] **Step 8: Commit**

```bash
git add demo_api_ui/src/pages/UseCaseLauncherPage.js demo_api_ui/src/pages/UseCaseLauncherPage.css demo_api_ui/src/__tests__/UseCaseLauncherPage.test.js
git commit -m "$(cat <<'EOF'
feat(use-cases): add deduped Happy Path (PERMIT) grouping to launcher

Every use case with expectedOutcome === 'PERMIT' now renders once, in a
new top-of-page Happy Path section, instead of only inside its track
section. UC24 (Act 1) stays excluded from the grid since it's only
surfaced via the Progressive Trust Demo strip, which now reads from an
unfiltered demo-track list so its Act 2-5 id lookups are unaffected.
EOF
)"
```

---

## Task 2: Search box (client-side filter across Happy Path + track sections)

**Files:**
- Modify: `demo_api_ui/src/pages/UseCaseLauncherPage.js`
- Modify: `demo_api_ui/src/pages/UseCaseLauncherPage.css`
- Test: `demo_api_ui/src/__tests__/UseCaseLauncherPage.test.js`

**Interfaces:**
- Consumes: `happyPath`, `happyPathIds`, `grouped`, `demoTrackItemsForStrip` from Task 1 (same variable names, `happyPath`/`grouped` are further filtered in place by this task).
- Produces: a new pure function `matchesQuery(uc, query) => boolean` (module-level, exported implicitly via component use only — no external export needed) and local state `query`/`setQuery`. No other task depends on these.

- [ ] **Step 1: Write the failing tests**

In `demo_api_ui/src/__tests__/UseCaseLauncherPage.test.js`, add a new mock object after the existing `UC_LINK` constant (after its closing `};`, currently around line 161):

```js
// Demo-track mock for search + Progressive Trust Demo strip interaction tests.
const UC_DEMO_ACT1 = {
  id: 'UC24',
  useCaseId: 'progressive-trust-public-access',
  track: 'demo',
  title: 'Act 1 — Public catalog access',
  buyerStory: 'Users should explore low-risk information before signing in.',
  pingOneSolution: 'PingOne Authorize PERMITs a read-only public tool with no token exchange.',
  trigger: { type: 'chip', text: 'What branches are near me?' },
  expectedOutcome: 'PERMIT',
  evidence: {},
  codeRefs: [],
  maturity: 'works',
  owasp: {},
  whatToSay: 'Low-friction first.',
  advanced: false,
};
```

Then add these tests at the end of the `describe` block (after the Task 1 tests, before the block's closing `});`):

```js
  // ── Search ───────────────────────────────────────────────────────────────
  it('search filters cards across Happy Path and track sections by title', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('Delegated access with proof')).toBeInTheDocument());
    expect(screen.getByText('Bad client to agent gateway')).toBeInTheDocument();

    const search = screen.getByRole('searchbox', { name: /search use cases/i });
    fireEvent.change(search, { target: { value: 'delegated access' } });

    expect(screen.getByText('Delegated access with proof')).toBeInTheDocument();
    expect(screen.queryByText('Bad client to agent gateway')).not.toBeInTheDocument();
    expect(screen.queryByText('A2A delegation')).not.toBeInTheDocument();
    // Attacks section had its only match filtered out — its heading disappears too.
    expect(screen.queryByText(/Attacks — malicious/i)).not.toBeInTheDocument();
  });

  it('search matches by useCaseId substring', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('Delegated access with proof')).toBeInTheDocument());

    const search = screen.getByRole('searchbox', { name: /search use cases/i });
    fireEvent.change(search, { target: { value: 'a2a-delegation' } });

    expect(screen.getByText('A2A delegation')).toBeInTheDocument();
    expect(screen.queryByText('Delegated access with proof')).not.toBeInTheDocument();
  });

  it('search matches by trigger text substring', async () => {
    apiClient.get.mockResolvedValue({
      data: { vertical: 'banking', useCases: [MOCK_USE_CASES[0], UC_INSUFFICIENT_SCOPE] },
    });
    renderPage();
    await waitFor(() => expect(screen.getByText('Delegated access with proof')).toBeInTheDocument());

    const search = screen.getByRole('searchbox', { name: /search use cases/i });
    fireEvent.change(search, { target: { value: 'show my balance' } });

    expect(screen.getByText('Delegated access with proof')).toBeInTheDocument();
    expect(screen.queryByText('Insufficient scope attack')).not.toBeInTheDocument();
  });

  it('clearing the search box restores the full view', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('Delegated access with proof')).toBeInTheDocument());

    const search = screen.getByRole('searchbox', { name: /search use cases/i });
    fireEvent.change(search, { target: { value: 'a2a-delegation' } });
    expect(screen.queryByText('Bad client to agent gateway')).not.toBeInTheDocument();

    fireEvent.change(search, { target: { value: '' } });
    expect(screen.getByText('Delegated access with proof')).toBeInTheDocument();
    expect(screen.getByText('Bad client to agent gateway')).toBeInTheDocument();
  });

  it('shows an empty-state message when the search matches nothing', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('Delegated access with proof')).toBeInTheDocument());

    const search = screen.getByRole('searchbox', { name: /search use cases/i });
    fireEvent.change(search, { target: { value: 'zzz-no-such-use-case' } });

    expect(screen.getByText('No use cases match "zzz-no-such-use-case".')).toBeInTheDocument();
    expect(screen.queryByText(/Happy Paths — successful outcomes/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Foundations/i)).not.toBeInTheDocument();
  });

  it('hides the Progressive Trust Demo strip while searching, restores it when cleared', async () => {
    apiClient.get.mockImplementation((url) => {
      if (url.includes('feature-flags')) {
        return Promise.resolve({
          data: {
            flags: [
              { id: 'ff_a2a_delegation', value: false },
              { id: 'ff_authorize_group_policy', value: false },
              { id: 'ff_dpop', value: false },
              { id: 'ff_rar', value: false },
              { id: 'ciba_enabled', value: false },
            ],
            categories: [],
          },
        });
      }
      return Promise.resolve({ data: { vertical: 'banking', useCases: [UC_DEMO_ACT1] } });
    });
    renderPage();
    await waitFor(() => expect(screen.getByText(/Progressive Trust Demo — Act 1 from here/i)).toBeInTheDocument());

    const search = screen.getByRole('searchbox', { name: /search use cases/i });
    fireEvent.change(search, { target: { value: 'public catalog' } });
    expect(screen.queryByText(/Progressive Trust Demo — Act 1 from here/i)).not.toBeInTheDocument();

    fireEvent.change(search, { target: { value: '' } });
    await waitFor(() => expect(screen.getByText(/Progressive Trust Demo — Act 1 from here/i)).toBeInTheDocument());
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd demo_api_ui && npx vitest run src/__tests__/UseCaseLauncherPage.test.js`
Expected: the 6 new tests FAIL (no `searchbox` role exists yet — `getByRole('searchbox', ...)` throws). The 18 tests from Task 1 still PASS.

- [ ] **Step 3: Add the `matchesQuery` helper**

In `demo_api_ui/src/pages/UseCaseLauncherPage.js`, add this function above the `OWASPBadge` function definition (currently line 207, `function OWASPBadge({ owasp }) {`):

```js
/**
 * Case-insensitive substring match against a use case's searchable fields:
 * id, useCaseId, title, buyerStory, whatToSay, and the trigger's prompt text.
 */
function matchesQuery(uc, query) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const haystack = [uc.id, uc.useCaseId, uc.title, uc.buyerStory, uc.whatToSay, uc.trigger?.text]
    .filter(Boolean)
    .join(' \n ')
    .toLowerCase();
  return haystack.includes(q);
}

```

- [ ] **Step 4: Add `query` state and filter `happyPath`/`grouped`**

In `UseCaseLauncherPage()`, add the state declaration alongside the other `useState` calls (after the `chipRun` declaration, currently line 669):

```js
  const [query, setQuery] = useState('');
```

Then replace the Task-1 block that computed `happyPath` and `grouped` (exact text, comments included, as Task 1 Step 4 wrote it):

```js
  const happyPath = useCases.filter(
    (uc) => uc.expectedOutcome === 'PERMIT' && !PROGRESSIVE_TRUST_STRIP_IDS.has(uc.id)
  );
  const happyPathIds = new Set(happyPath.map((uc) => uc.id));

  // Group use cases by track, in TRACK_ORDER order. Cards already shown in the
  // Happy Path section above are excluded here so each use case renders
  // exactly once on the page.
  const grouped = TRACK_ORDER.map((track) => ({
    track,
    items: useCases.filter((uc) => uc.track === track && !happyPathIds.has(uc.id)),
  }));

  // ProgressiveTrustDemoStrip resolves its Acts by id across the full 'demo'
  // track (Acts 2-5 reference UC1/UC7/UC8/UC22/UC6) — it must stay unaffected
  // by the Happy Path dedup above.
  const demoTrackItemsForStrip = useCases.filter((uc) => uc.track === 'demo');
```

with:

```js
  const happyPathAll = useCases.filter(
    (uc) => uc.expectedOutcome === 'PERMIT' && !PROGRESSIVE_TRUST_STRIP_IDS.has(uc.id)
  );
  const happyPathIds = new Set(happyPathAll.map((uc) => uc.id));
  const happyPath = happyPathAll.filter((uc) => matchesQuery(uc, query));

  const grouped = TRACK_ORDER.map((track) => ({
    track,
    items: useCases
      .filter((uc) => uc.track === track && !happyPathIds.has(uc.id))
      .filter((uc) => matchesQuery(uc, query)),
  }));

  const demoTrackItemsForStrip = useCases.filter((uc) => uc.track === 'demo');

  const isSearching = query.trim().length > 0;
  // Mirrors the demo-track STRIP_IDS exclusion applied at render time, so this
  // check reflects what actually becomes visible, not just what's in `items`.
  const hasAnyResults =
    happyPath.length > 0 ||
    grouped.some(({ track, items }) => {
      const displayItems = track === 'demo'
        ? items.filter((uc) => !PROGRESSIVE_TRUST_STRIP_IDS.has(uc.id))
        : items;
      return displayItems.length > 0;
    });
```

Note: `happyPathIds` is computed from `happyPathAll` (pre-search), so dedup between the Happy Path group and track sections is unaffected by the search query — only which of the already-deduped items are *visible* changes.

- [ ] **Step 5: Add the search input and empty-state message to the JSX**

In the `<header className="uc-launcher__header">` block, immediately after the closing `</p>` of `uc-launcher__subtitle` (currently right before `<div className="uc-launcher__vertical-picker" ...>`), add:

```jsx
        <div className="uc-launcher__search">
          <label htmlFor="uc-search-input" className="uc-launcher__search-label">
            Search use cases
          </label>
          <input
            id="uc-search-input"
            type="search"
            className="uc-launcher__search-input"
            placeholder="Search by title, id, or prompt…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
```

Immediately after the closing `</header>` tag and before the Happy Path section block added in Task 1, add:

```jsx
      {!hasAnyResults && (
        <p className="uc-launcher__empty">No use cases match &quot;{query.trim()}&quot;.</p>
      )}

```

Finally, gate the strip render so it only shows when not searching. Change the `{track === 'demo' && (` line from Task 1 to:

```jsx
            {track === 'demo' && !isSearching && (
```

- [ ] **Step 6: Add CSS for the search box and empty state**

In `demo_api_ui/src/pages/UseCaseLauncherPage.css`, after the `.uc-launcher__vertical-label` rule (currently lines 33–39), add:

```css
.uc-launcher__search {
  margin-top: 1.25rem;
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
}

.uc-launcher__search-label {
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--color-text-secondary, #555);
}

.uc-launcher__search-input {
  width: 100%;
  max-width: 420px;
  padding: 0.5rem 0.75rem;
  border: 1px solid var(--color-border, #e0e0e0);
  border-radius: 6px;
  font-size: 0.95rem;
  background: var(--color-surface, #fff);
  color: var(--color-text-primary, #111);
}

.uc-launcher__search-input:focus {
  outline: 2px solid var(--color-accent, #2563eb);
  outline-offset: 1px;
}

.uc-launcher__empty {
  padding: 1.5rem 0;
  color: var(--color-text-secondary, #555);
  font-style: italic;
}
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `cd demo_api_ui && npx vitest run src/__tests__/UseCaseLauncherPage.test.js`
Expected: PASS — all 18 tests from Task 1 plus the 6 new tests (24 total), 0 failures.

- [ ] **Step 8: Run the full UI suite to check for unrelated regressions**

Run: `cd demo_api_ui && CI=true npx vitest run`
Expected: same pass/fail counts as the pre-work baseline for every file other than `UseCaseLauncherPage.test.js`. If an unrelated file regresses, stop and investigate before continuing — do not proceed with an unexplained new failure.

- [ ] **Step 9: Commit**

```bash
git add demo_api_ui/src/pages/UseCaseLauncherPage.js demo_api_ui/src/pages/UseCaseLauncherPage.css demo_api_ui/src/__tests__/UseCaseLauncherPage.test.js
git commit -m "$(cat <<'EOF'
feat(use-cases): add search box to launcher, filter across sections

Filters Happy Path and track-section cards by id/useCaseId/title/
buyerStory/whatToSay/trigger text. Groups stay intact while searching;
a section with zero matches disappears. Progressive Trust Demo strip
hides while searching (fixed presenter script, not a filterable card)
and reappears when the search box is cleared.
EOF
)"
```

---

## Manual verification (after both tasks)

- [ ] Start the UI dev server (`./run.sh` or existing project convention) and open `/use-cases`.
- [ ] Confirm a "Happy Paths — successful outcomes across every track" section renders first, above "Foundations — delegation lifecycle".
- [ ] Type a partial use case title into the search box and confirm only matching cards remain, with empty sections disappearing.
- [ ] Clear the search box and confirm the full page (including the Progressive Trust Demo strip under the `demo` track) returns.
- [ ] Search for a string that matches nothing and confirm the empty-state message appears.
