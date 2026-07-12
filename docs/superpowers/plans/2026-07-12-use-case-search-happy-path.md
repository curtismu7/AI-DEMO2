# Use Case Launcher — Search + Happy Path Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a curated "Demo" script section, a search box, and a top-of-page "Happy Path" (PERMIT-outcome) grouping to `UseCaseLauncherPage`, per `docs/superpowers/specs/2026-07-12-use-case-search-happy-path-design.md` and `docs/superpowers/specs/2026-07-12-use-case-demo-section-design.md`.

**Architecture:** Three sequential changes to one React component (`UseCaseLauncherPage.js`) plus its stylesheet and test file. Task 1 introduces the deduped "Happy Path" grid section (**COMPLETE** — commit `9217e0318`, reviewed and approved). Task 2 adds a fixed-order, 12-step "Demo" section above Happy Path, with no dedup against it or any track section. Task 3 layers a client-side search filter on top of both Task 1's and Task 2's sections.

**Tech Stack:** React (function component + hooks), Vitest + `@testing-library/react`, plain CSS (existing `uc-*` BEM-ish class conventions, `var(--color-*)` custom properties).

## Global Constraints

- **Minimal diff** (CLAUDE.md §0): name the component, name the element, change only that. No unrelated cleanup of adjacent code in `UseCaseLauncherPage.js`.
- **Emoji allowlist** (CLAUDE.md §0): only `⚠️ ✅ ❌ 🔐 ✕ ✓ 👤 🔑` are permitted in UI text. No emoji is needed by this feature — do not add any.
- **Worktree required**: all edits happen in `/Users/cmuir/Development/AI-DEMO2/.claude/worktrees/feat+use-case-search-happy-path` on branch `worktree-feat+use-case-search-happy-path`. Stage files explicitly (`git add <path>`), never `git add -A`.
- **Test runner**: this page's tests run under Vitest, not Jest — use `npx vitest run <path>` from `demo_api_ui/`, not `jest`.
- **Baseline**: 16/16 tests passing in `demo_api_ui/src/__tests__/UseCaseLauncherPage.test.js` before Task 1; 18/18 after Task 1 (current state). Each subsequent task below must end with that count strictly increasing and 0 failures.

---

## Task 1: Happy Path grouping (dedup PERMIT-outcome cards above track sections) — COMPLETE

**Status: COMPLETE.** Implemented in commit `9217e0318` on this branch; task review (spec compliance + code quality) returned Approved with no Critical/Important findings. The steps below are kept as a historical record — do not re-run them.

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

## Task 2: Demo section (fixed-order, 12-step presenter script, no dedup)

**Files:**
- Modify: `demo_api_ui/src/pages/UseCaseLauncherPage.js`
- Modify: `demo_api_ui/src/pages/UseCaseLauncherPage.css`
- Test: `demo_api_ui/src/__tests__/UseCaseLauncherPage.test.js`

**Interfaces:**
- Consumes: `useCases`, `UseCaseCard`, `handleRun`, `handleRunAttack`, `setExplainUc`, `handleOpen`, `attackStates`, `chipRun`, `flagMap`, `flagsLoading`, `setFlag` — all already defined in this file, unchanged by this task.
- Produces: module constants `DEMO_USE_CASE_IDS` (ordered array of 12 ids) and `DEMO_LABEL` (string); inside `UseCaseLauncherPage`, a new local variable `demoAll` (array of use-case objects resolved in `DEMO_USE_CASE_IDS` order); a new `UseCaseCard` prop `stepNumber` (optional number, 1-based, renders a step badge when present). Task 3 reads `DEMO_USE_CASE_IDS`, `DEMO_LABEL`, and extends `demoAll` into a filtered `demoVisible`.

**Important — this task's design has NO cross-section dedup** (per `docs/superpowers/specs/2026-07-12-use-case-demo-section-design.md` §3): a use case may render once in Demo, once in Happy Path, and/or once in its track section, simultaneously. This is deliberate, not a bug — Demo is a fixed script that must not be at the mercy of what else happens to qualify for other sections. Three of `DEMO_USE_CASE_IDS`'s ids (`UC1`, `UC2`, `UC11`) already exist in this test file's `MOCK_USE_CASES` fixture and legitimately duplicate once Demo exists — several pre-existing tests query for their title text with a *singular* `getByText`/`getByRole`, which throws once more than one match exists. Step 1 below includes the exact required edits to every affected pre-existing test. Do not "fix" the duplication by adding dedup logic instead — that would contradict the approved design; if a test fails in a way not covered by Step 1's edits, stop and ask rather than inventing dedup.

- [ ] **Step 1: Write the failing/updated tests**

Open `demo_api_ui/src/__tests__/UseCaseLauncherPage.test.js`.

**1a. Rename two synthetic fixture ids that accidentally collide with real `DEMO_USE_CASE_IDS` entries.** `UC_INSUFFICIENT_SCOPE` and `UC_WRONG_AUD` use arbitrary test-only ids (`'UC12'`, `'UC13'`) that happen to match real catalog ids Demo references for *different* use cases (token-theft-replay, confused-deputy) — rename them so these attack-sim tests stay isolated from Demo:

```js
const UC_INSUFFICIENT_SCOPE = {
  id: 'UC-ATTACK-SCOPE',
  useCaseId: 'insufficient-scope',
```

(replacing the existing `id: 'UC12',` line; leave every other field in this object unchanged)

```js
const UC_WRONG_AUD = {
  id: 'UC-ATTACK-AUD',
  useCaseId: 'wrong-aud',
```

(replacing the existing `id: 'UC13',` line; leave every other field in this object unchanged)

**1b. Update the 9 pre-existing tests that break once `UC1`/`UC2`/`UC11` legitimately render twice** (Demo + their other section). Each edit below is the complete replacement for that `it(...)` block — replace old with new exactly:

Replace:
```js
  it('renders an enabled Run button for chip-type UC', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('Delegated access with proof')).toBeInTheDocument());
    const buttons = screen.getAllByRole('button', { name: /run/i });
    const chipBtn = buttons.find((b) => !b.disabled && !b.title?.includes('A6'));
    expect(chipBtn).toBeDefined();
    expect(chipBtn.disabled).toBe(false);
  });
```
with:
```js
  it('renders an enabled Run button for chip-type UC', async () => {
    renderPage();
    // UC1 now renders in both the Demo section and Happy Path (no cross-section
    // dedup) — assert presence, not a single occurrence.
    await waitFor(() => expect(screen.getAllByText('Delegated access with proof').length).toBeGreaterThan(0));
    const buttons = screen.getAllByRole('button', { name: /run/i });
    const chipBtn = buttons.find((b) => !b.disabled && !b.title?.includes('A6'));
    expect(chipBtn).toBeDefined();
    expect(chipBtn.disabled).toBe(false);
  });
```

Replace:
```js
  it('renders a disabled Run button for attack-type UC', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('Bad client to agent gateway')).toBeInTheDocument());
    const disabledBtn = screen.getByRole('button', { name: /run.*A6/i });
    expect(disabledBtn.disabled).toBe(true);
  });
```
with:
```js
  it('renders a disabled Run button for attack-type UC', async () => {
    renderPage();
    // UC11 now renders in both the Demo section and the Attacks track (no
    // cross-section dedup) — scope the button query to the Attacks section.
    await waitFor(() => expect(screen.getAllByText('Bad client to agent gateway').length).toBeGreaterThan(0));
    const attacksHeading = screen.getByRole('heading', { level: 2, name: /Attacks — malicious/i });
    const attacksSection = attacksHeading.closest('section');
    const disabledBtn = within(attacksSection).getByRole('button', { name: /run.*A6/i });
    expect(disabledBtn.disabled).toBe(true);
  });
```

Within `it('clicking Run on a chip UC POSTs the use case and navigates to /dashboard with state', ...)`, replace only its opening two lines:
```js
    renderPage();
    await waitFor(() => expect(screen.getByText('Delegated access with proof')).toBeInTheDocument());
    const buttons = screen.getAllByRole('button', { name: /^run$/i });
    fireEvent.click(buttons[0]);
```
with:
```js
    renderPage();
    // UC1 now renders in both the Demo section and Happy Path (no cross-section
    // dedup) — assert presence, not a single occurrence. buttons[0] still
    // resolves to a UC1 card either way, since both copies share the same
    // onRun handler and produce the identical POST call below.
    await waitFor(() => expect(screen.getAllByText('Delegated access with proof').length).toBeGreaterThan(0));
    const buttons = screen.getAllByRole('button', { name: /^run$/i });
    fireEvent.click(buttons[0]);
```
(the rest of that test — the `apiClient.post`/`mockNavigate` assertions — stays unchanged; both UC1 copies wire to the identical handler)

Replace:
```js
  it('non-runnable attack UC keeps disabled coming-in-A6.2 button', async () => {
    // UC11 has sim: 'expired-token' which is NOT in RUNNABLE_SIMS
    apiClient.get.mockResolvedValue({
      data: { vertical: 'banking', useCases: [MOCK_USE_CASES[2]] },
    });
    renderPage();
    await waitFor(() => expect(screen.getByText('Bad client to agent gateway')).toBeInTheDocument());
    const btn = screen.getByRole('button', { name: /A6/i });
    expect(btn.disabled).toBe(true);
  });
```
with:
```js
  it('non-runnable attack UC keeps disabled coming-in-A6.2 button', async () => {
    // UC11 has sim: 'expired-token' which is NOT in RUNNABLE_SIMS. UC11 is also
    // a Demo-script id, so with useCases: [MOCK_USE_CASES[2]] alone its card
    // renders twice on the page (Attacks section + Demo section, no dedup) —
    // scope the button query to the Attacks section.
    apiClient.get.mockResolvedValue({
      data: { vertical: 'banking', useCases: [MOCK_USE_CASES[2]] },
    });
    renderPage();
    await waitFor(() => expect(screen.getAllByText('Bad client to agent gateway').length).toBeGreaterThan(0));
    const attacksHeading = screen.getByRole('heading', { level: 2, name: /Attacks — malicious/i });
    const attacksSection = attacksHeading.closest('section');
    const btn = within(attacksSection).getByRole('button', { name: /A6/i });
    expect(btn.disabled).toBe(true);
  });
```

Replace:
```js
  it('shows gate notice and disabled Run for flag-gated UC when flag is OFF', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('A2A delegation')).toBeInTheDocument());
    expect(screen.getAllByText(/ff_a2a_delegation/).length).toBeGreaterThan(0);
    const buttons = screen.getAllByRole('button', { name: /^run$/i });
    const disabledRunBtns = buttons.filter((b) => b.disabled && !b.title?.includes('A6'));
    expect(disabledRunBtns.length).toBeGreaterThan(0);
  });
```
with:
```js
  it('shows gate notice and disabled Run for flag-gated UC when flag is OFF', async () => {
    renderPage();
    // UC2 now renders in both the Demo section and Foundations (no cross-section
    // dedup) — assert presence, not a single occurrence.
    await waitFor(() => expect(screen.getAllByText('A2A delegation').length).toBeGreaterThan(0));
    expect(screen.getAllByText(/ff_a2a_delegation/).length).toBeGreaterThan(0);
    const buttons = screen.getAllByRole('button', { name: /^run$/i });
    const disabledRunBtns = buttons.filter((b) => b.disabled && !b.title?.includes('A6'));
    expect(disabledRunBtns.length).toBeGreaterThan(0);
  });
```

Replace:
```js
  it('non-flag UC still has enabled Run button', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('Delegated access with proof')).toBeInTheDocument());
    const allBtns = screen.getAllByRole('button', { name: /^run$/i });
    const enabledRuns = allBtns.filter((b) => !b.disabled);
    expect(enabledRuns.length).toBeGreaterThan(0);
  });
```
with:
```js
  it('non-flag UC still has enabled Run button', async () => {
    renderPage();
    // UC1 now renders in both the Demo section and Happy Path (no cross-section
    // dedup) — assert presence, not a single occurrence.
    await waitFor(() => expect(screen.getAllByText('Delegated access with proof').length).toBeGreaterThan(0));
    const allBtns = screen.getAllByRole('button', { name: /^run$/i });
    const enabledRuns = allBtns.filter((b) => !b.disabled);
    expect(enabledRuns.length).toBeGreaterThan(0);
  });
```

Replace:
```js
  it('clicking the toggle PATCHes the flag and enables Run', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('A2A delegation')).toBeInTheDocument());
    const toggle = screen.getByRole('switch', { name: /Enable ff_a2a_delegation/i });
    fireEvent.click(toggle);
    expect(apiClient.patch).toHaveBeenCalledWith(
      '/api/admin/feature-flags',
      { updates: { ff_a2a_delegation: true } }
    );
    await waitFor(() => {
      const allBtns = screen.getAllByRole('button', { name: /^run$/i });
      const runForUC2 = allBtns.find((b) => !b.disabled && !b.title?.includes('A6'));
      expect(runForUC2).toBeDefined();
    });
  });
```
with:
```js
  it('clicking the toggle PATCHes the flag and enables Run', async () => {
    renderPage();
    // UC2 now renders in both the Demo section and Foundations (no cross-section
    // dedup), so two identical flag toggles exist — clicking either produces
    // the same PATCH, since flag state is global, not per-card. Click the first.
    await waitFor(() => expect(screen.getAllByText('A2A delegation').length).toBeGreaterThan(0));
    const toggles = screen.getAllByRole('switch', { name: /Enable ff_a2a_delegation/i });
    fireEvent.click(toggles[0]);
    expect(apiClient.patch).toHaveBeenCalledWith(
      '/api/admin/feature-flags',
      { updates: { ff_a2a_delegation: true } }
    );
    await waitFor(() => {
      const allBtns = screen.getAllByRole('button', { name: /^run$/i });
      const runForUC2 = allBtns.find((b) => !b.disabled && !b.title?.includes('A6'));
      expect(runForUC2).toBeDefined();
    });
  });
```

Replace:
```js
  it('flag-gated Run is disabled while flags are loading', async () => {
    apiClient.get.mockImplementation((url) => {
      if (url.includes('feature-flags')) {
        return new Promise(() => {}); // never resolves = loading
      }
      return Promise.resolve({ data: { vertical: 'banking', useCases: MOCK_USE_CASES } });
    });
    renderPage();
    await waitFor(() => expect(screen.getByText('A2A delegation')).toBeInTheDocument());
    const allBtns = screen.getAllByRole('button', { name: /^run$/i });
    const disabledFlagBtns = allBtns.filter((b) => b.disabled && !b.title?.includes('A6'));
    expect(disabledFlagBtns.length).toBeGreaterThan(0);
  });
```
with:
```js
  it('flag-gated Run is disabled while flags are loading', async () => {
    apiClient.get.mockImplementation((url) => {
      if (url.includes('feature-flags')) {
        return new Promise(() => {}); // never resolves = loading
      }
      return Promise.resolve({ data: { vertical: 'banking', useCases: MOCK_USE_CASES } });
    });
    renderPage();
    // UC2 now renders in both the Demo section and Foundations (no cross-section
    // dedup) — assert presence, not a single occurrence.
    await waitFor(() => expect(screen.getAllByText('A2A delegation').length).toBeGreaterThan(0));
    const allBtns = screen.getAllByRole('button', { name: /^run$/i });
    const disabledFlagBtns = allBtns.filter((b) => b.disabled && !b.title?.includes('A6'));
    expect(disabledFlagBtns.length).toBeGreaterThan(0);
  });
```

Replace (Task 1's own test — Demo now renders first, above Happy Path, changing this test's ordering and occurrence-count assumptions):
```js
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
```
with:
```js
  it('renders a Happy Path section above track sections containing only PERMIT-outcome use cases, deduped from their track', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText(/Happy Paths — successful outcomes/i)).toBeInTheDocument());

    // The Demo section (Task 2) now renders first, above Happy Path — check
    // relative order rather than assuming Happy Path is the first heading.
    const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    const demoIdx = headings.findIndex((h) => /Demo — a scripted walkthrough/i.test(h));
    const happyPathIdx = headings.findIndex((h) => /Happy Paths — successful outcomes/i.test(h));
    const foundationsIdx = headings.findIndex((h) => /^Foundations/i.test(h));
    expect(demoIdx).toBe(0);
    expect(happyPathIdx).toBeGreaterThan(demoIdx);
    expect(foundationsIdx).toBeGreaterThan(happyPathIdx);

    // UC1 (expectedOutcome: 'PERMIT') is also Demo script step 1 — it renders
    // once in Demo and once in Happy Path (no cross-section dedup between the
    // two), and is still excluded from Foundations (dedup is only between
    // Happy Path and track sections, unaffected by Demo membership).
    expect(screen.getAllByText('Delegated access with proof')).toHaveLength(2);

    // UC2's outcome is 'PERMIT with act-chain depth', not an exact 'PERMIT' match,
    // so it stays in its original Foundations section, not Happy Path.
    const foundationsHeading = screen.getByRole('heading', { level: 2, name: /^Foundations/i });
    const foundationsSection = foundationsHeading.closest('section');
    expect(within(foundationsSection).getByText('A2A delegation')).toBeInTheDocument();
  });
```

**1c. Add the new Demo-specific tests.** Add these at the end of the `describe` block, after the "Happy Path grouping" tests and before the block's closing `});`:

```js
  // ── Demo section ─────────────────────────────────────────────────────────
  it('renders a Demo section first, above Happy Path, with cards in script order regardless of input order', async () => {
    // Deliberately out of DEMO_USE_CASE_IDS order (UC11 first) to prove the
    // section renders by script order, not by input array order.
    apiClient.get.mockResolvedValue({
      data: { vertical: 'banking', useCases: [MOCK_USE_CASES[2], MOCK_USE_CASES[0], MOCK_USE_CASES[1]] },
    });
    renderPage();
    await waitFor(() => expect(screen.getByText(/Demo — a scripted walkthrough/i)).toBeInTheDocument());

    const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    const demoIdx = headings.findIndex((h) => /Demo — a scripted walkthrough/i.test(h));
    const happyPathIdx = headings.findIndex((h) => /Happy Paths — successful outcomes/i.test(h));
    expect(demoIdx).toBe(0);
    expect(happyPathIdx).toBeGreaterThan(demoIdx);

    const demoSection = screen.getByRole('heading', { level: 2, name: /Demo — a scripted walkthrough/i }).closest('section');
    const demoCardIds = within(demoSection).getAllByText(/^UC(1|2|11)$/).map((el) => el.textContent);
    expect(demoCardIds).toEqual(['UC1', 'UC2', 'UC11']);
  });

  it('shows the correct 1-based script step number on each Demo card', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText(/Demo — a scripted walkthrough/i)).toBeInTheDocument());
    const demoSection = screen.getByRole('heading', { level: 2, name: /Demo — a scripted walkthrough/i }).closest('section');
    // UC1, UC2, UC11 are DEMO_USE_CASE_IDS[0], [1], [9] → Step 1, Step 2, Step 10.
    expect(within(demoSection).getByText('Step 1')).toBeInTheDocument();
    expect(within(demoSection).getByText('Step 2')).toBeInTheDocument();
    expect(within(demoSection).getByText('Step 10')).toBeInTheDocument();
  });

  it('a use case in both Demo and Happy Path renders once per section, not deduped', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText(/Demo — a scripted walkthrough/i)).toBeInTheDocument());
    // UC1 qualifies for both Demo (script step 1) and Happy Path (PERMIT) — no
    // cross-section dedup, so it renders twice total.
    expect(screen.getAllByText('Delegated access with proof')).toHaveLength(2);
  });

  it('a flag-gated Demo step shows the gate UI', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText(/Demo — a scripted walkthrough/i)).toBeInTheDocument());
    const demoSection = screen.getByRole('heading', { level: 2, name: /Demo — a scripted walkthrough/i }).closest('section');
    // UC2 (Step 2) is maturity 'flag:ff_a2a_delegation'.
    expect(within(demoSection).getByText(/ff_a2a_delegation/)).toBeInTheDocument();
  });

  it('does not render a Demo section when none of its script ids are present', async () => {
    apiClient.get.mockResolvedValue({ data: { vertical: 'banking', useCases: [UC_LINK] } });
    renderPage();
    await waitFor(() => expect(screen.getByText('RAG code search')).toBeInTheDocument());
    expect(screen.queryByText(/Demo — a scripted walkthrough/i)).not.toBeInTheDocument();
  });
```

- [ ] **Step 2: Run tests to verify the expected failures**

Run: `cd demo_api_ui && npx vitest run src/__tests__/UseCaseLauncherPage.test.js`
Expected: the 5 new Demo tests FAIL (no "Demo — a scripted walkthrough" heading exists yet). The 9 edited pre-existing tests FAIL too (e.g. `getAllByText(...).toHaveLength(2)` currently sees only 1 occurrence — Demo doesn't exist yet). Every other test still PASSes.

- [ ] **Step 3: Add `DEMO_USE_CASE_IDS` and `DEMO_LABEL` constants**

In `demo_api_ui/src/pages/UseCaseLauncherPage.js`, add immediately after the `HAPPY_PATH_LABEL` line (`const HAPPY_PATH_LABEL = 'Happy Paths — successful outcomes across every track';`):

```js
const DEMO_LABEL = 'Demo — a scripted walkthrough';
```

Add immediately after the `PROGRESSIVE_TRUST_STRIP_IDS` line (`const PROGRESSIVE_TRUST_STRIP_IDS = new Set(['UC24']);`):

```js

/**
 * Fixed presenter script for the Demo section, in display order. No dedup
 * against Happy Path or track sections — see design spec §3: a use case may
 * legitimately render once here and again in another section.
 */
const DEMO_USE_CASE_IDS = ['UC1', 'UC2', 'UC2.5', 'UC8', 'UC7', 'UC6', 'UC10', 'UC5', 'UC13', 'UC11', 'UC12', 'UC20'];
```

- [ ] **Step 4: Add the `stepNumber` prop to `UseCaseCard`**

Change the `UseCaseCard` function signature from:

```js
function UseCaseCard({ uc, onRun, onRunAttack, onExplain, onOpen, attackState, chipRunning, chipRunError, flagMap, flagsLoading, setFlag }) {
```

to:

```js
function UseCaseCard({ uc, stepNumber, onRun, onRunAttack, onExplain, onOpen, attackState, chipRunning, chipRunError, flagMap, flagsLoading, setFlag }) {
```

Then, inside its returned JSX, change the card header block from:

```jsx
      <div className="uc-card__header">
        <span className="uc-card__id">{uc.id}</span>
        <h3 className="uc-card__title">{uc.title}</h3>
        {uc.advanced && <span className="uc-card__advanced-label">Advanced</span>}
        <OWASPBadge owasp={uc.owasp} />
      </div>
```

to:

```jsx
      <div className="uc-card__header">
        <span className="uc-card__id">{uc.id}</span>
        {stepNumber != null && <span className="uc-card__step">Step {stepNumber}</span>}
        <h3 className="uc-card__title">{uc.title}</h3>
        {uc.advanced && <span className="uc-card__advanced-label">Advanced</span>}
        <OWASPBadge owasp={uc.owasp} />
      </div>
```

- [ ] **Step 5: Compute `demoAll` and render the Demo section**

In `UseCaseLauncherPage()`, add immediately after the `demoTrackItemsForStrip` line (`const demoTrackItemsForStrip = useCases.filter((uc) => uc.track === 'demo');`):

```js

  // Demo: fixed-order presenter script (12 ids). No dedup against Happy Path
  // or track sections — see design spec §3.
  const demoAll = DEMO_USE_CASE_IDS
    .map((id) => useCases.find((uc) => uc.id === id))
    .filter(Boolean);
```

Then, in the JSX, insert a new section immediately after the `</header>` closing tag and immediately before the existing `{happyPath.length > 0 && (` block (Demo renders first, above Happy Path):

```jsx
      {demoAll.length > 0 && (
        <section className="uc-track uc-track--demo-script">
          <h2 className="uc-track__heading">{DEMO_LABEL}</h2>
          <div className="uc-track__grid">
            {demoAll.map((uc) => (
              <UseCaseCard
                key={uc.id}
                uc={uc}
                stepNumber={DEMO_USE_CASE_IDS.indexOf(uc.id) + 1}
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

- [ ] **Step 6: Add CSS for the step badge and Demo heading accent**

In `demo_api_ui/src/pages/UseCaseLauncherPage.css`, immediately after the `.uc-track--happy-path .uc-track__heading { ... }` rule, add:

```css

.uc-track--demo-script .uc-track__heading {
  border-bottom-color: var(--color-accent, #2563eb);
}
```

Immediately after the `.uc-card__id { ... }` rule, add:

```css

.uc-card__step {
  font-size: 0.7rem;
  font-weight: 700;
  letter-spacing: 0.03em;
  text-transform: uppercase;
  color: var(--color-accent, #2563eb);
  border: 1px solid var(--color-accent, #2563eb);
  padding: 0.1rem 0.4rem;
  border-radius: 999px;
}
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `cd demo_api_ui && npx vitest run src/__tests__/UseCaseLauncherPage.test.js`
Expected: PASS — every test in the file passes, 0 failures. Count them in the output and report the exact total in your report file.

- [ ] **Step 8: Commit**

```bash
git add demo_api_ui/src/pages/UseCaseLauncherPage.js demo_api_ui/src/pages/UseCaseLauncherPage.css demo_api_ui/src/__tests__/UseCaseLauncherPage.test.js
git commit -m "$(cat <<'EOF'
feat(use-cases): add curated Demo script section to launcher

Adds a fixed 12-step presenter script (Demo), rendered above Happy
Path, independent of Happy Path's PERMIT membership and of the
pre-existing Progressive Trust Demo track/strip. No dedup: a use case
may render in Demo and also in Happy Path and/or its track section.
Updates pre-existing tests whose fixtures (UC1/UC2/UC11) now
legitimately duplicate across sections; renames two unrelated
synthetic test ids (UC12/UC13) that accidentally collided with real
Demo-referenced catalog ids.
EOF
)"
```

---

## Task 3: Search box (client-side filter across Demo + Happy Path + track sections)

**Files:**
- Modify: `demo_api_ui/src/pages/UseCaseLauncherPage.js`
- Modify: `demo_api_ui/src/pages/UseCaseLauncherPage.css`
- Test: `demo_api_ui/src/__tests__/UseCaseLauncherPage.test.js`

**Interfaces:**
- Consumes: `happyPath`, `happyPathIds`, `grouped`, `demoTrackItemsForStrip`, `demoAll`, `DEMO_USE_CASE_IDS`, `DEMO_LABEL` from Tasks 1–2 (same variable/constant names; `happyPath`/`grouped`/`demoAll` are further filtered in place by this task).
- Produces: two new pure functions, `matchesQuery(uc, query) => boolean` and `getDisplayItems(track, items) => array` (both module-level, used only within this file — no external export needed), a new local variable `demoVisible` (Demo's members after search filtering, same order as `demoAll`), and local state `query`/`setQuery`. No other task depends on these.

**Important:** every one of this task's own planned search tests (Step 1 below) uses fixtures that overlap with `DEMO_USE_CASE_IDS` (the same `MOCK_USE_CASES` collision Task 2 handled) — the test code below already accounts for this; do not write a naive singular-`getByText` version and then debug it, the fix is already baked into the test bodies given here.

- [ ] **Step 1: Write the failing tests**

In `demo_api_ui/src/__tests__/UseCaseLauncherPage.test.js`, add a new mock object after the existing `UC_LINK` constant (after its closing `};`, currently around line 161):

```js
// Demo-track mock for search + Progressive Trust Demo strip interaction tests.
// id 'UC24' is not a DEMO_USE_CASE_IDS member, so it never duplicates into Demo.
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

Then add these tests at the end of the `describe` block (after the Task 2 "Demo section" tests, before the block's closing `});`):

```js
  // ── Search ───────────────────────────────────────────────────────────────
  it('search filters cards across Demo, Happy Path, and track sections by title', async () => {
    renderPage();
    // UC1 and UC11 are both DEMO_USE_CASE_IDS members, so with the default
    // MOCK_USE_CASES fixture each renders twice pre-search (Demo + its other
    // section) — assert presence, not a single occurrence.
    await waitFor(() => expect(screen.getAllByText('Delegated access with proof').length).toBeGreaterThan(0));
    expect(screen.getAllByText('Bad client to agent gateway').length).toBeGreaterThan(0);

    const search = screen.getByRole('searchbox', { name: /search use cases/i });
    fireEvent.change(search, { target: { value: 'delegated access' } });

    // Only UC1 matches — it still renders twice (Demo + Happy Path, no dedup
    // between those two), but UC11 and UC2 are fully filtered out everywhere.
    expect(screen.getAllByText('Delegated access with proof').length).toBeGreaterThan(0);
    expect(screen.queryByText('Bad client to agent gateway')).not.toBeInTheDocument();
    expect(screen.queryByText('A2A delegation')).not.toBeInTheDocument();
    // Attacks section had its only match filtered out — its heading disappears too.
    expect(screen.queryByText(/Attacks — malicious/i)).not.toBeInTheDocument();
  });

  it('search matches by useCaseId substring', async () => {
    renderPage();
    await waitFor(() => expect(screen.getAllByText('Delegated access with proof').length).toBeGreaterThan(0));

    const search = screen.getByRole('searchbox', { name: /search use cases/i });
    fireEvent.change(search, { target: { value: 'a2a-delegation' } });

    // UC2 matches by useCaseId and still renders twice (Demo + Foundations).
    expect(screen.getAllByText('A2A delegation').length).toBeGreaterThan(0);
    expect(screen.queryByText('Delegated access with proof')).not.toBeInTheDocument();
  });

  it('search matches by trigger text substring', async () => {
    apiClient.get.mockResolvedValue({
      data: { vertical: 'banking', useCases: [MOCK_USE_CASES[0], UC_INSUFFICIENT_SCOPE] },
    });
    renderPage();
    // UC_INSUFFICIENT_SCOPE's id was renamed off any DEMO_USE_CASE_IDS entry in
    // Task 2, so only UC1 (a Demo id) duplicates here.
    await waitFor(() => expect(screen.getAllByText('Delegated access with proof').length).toBeGreaterThan(0));

    const search = screen.getByRole('searchbox', { name: /search use cases/i });
    fireEvent.change(search, { target: { value: 'show my balance' } });

    expect(screen.getAllByText('Delegated access with proof').length).toBeGreaterThan(0);
    expect(screen.queryByText('Insufficient scope attack')).not.toBeInTheDocument();
  });

  it('clearing the search box restores the full view', async () => {
    renderPage();
    await waitFor(() => expect(screen.getAllByText('Delegated access with proof').length).toBeGreaterThan(0));

    const search = screen.getByRole('searchbox', { name: /search use cases/i });
    fireEvent.change(search, { target: { value: 'a2a-delegation' } });
    expect(screen.queryByText('Bad client to agent gateway')).not.toBeInTheDocument();

    fireEvent.change(search, { target: { value: '' } });
    expect(screen.getAllByText('Delegated access with proof').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Bad client to agent gateway').length).toBeGreaterThan(0);
  });

  it('shows an empty-state message when the search matches nothing', async () => {
    renderPage();
    await waitFor(() => expect(screen.getAllByText('Delegated access with proof').length).toBeGreaterThan(0));

    const search = screen.getByRole('searchbox', { name: /search use cases/i });
    fireEvent.change(search, { target: { value: 'zzz-no-such-use-case' } });

    expect(screen.getByText('No use cases match "zzz-no-such-use-case".')).toBeInTheDocument();
    expect(screen.queryByText(/Demo — a scripted walkthrough/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Happy Paths — successful outcomes/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Foundations/i)).not.toBeInTheDocument();
  });

  it('search filters the Demo section independently, preserving script order', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText(/Demo — a scripted walkthrough/i)).toBeInTheDocument());

    const search = screen.getByRole('searchbox', { name: /search use cases/i });
    fireEvent.change(search, { target: { value: 'a2a-delegation' } });

    // Only UC2 (useCaseId 'a2a-delegation') matches — Demo narrows to just its
    // Step 2 card; UC1's Step 1 and UC11's Step 10 cards disappear from Demo.
    const demoSection = screen.getByRole('heading', { level: 2, name: /Demo — a scripted walkthrough/i }).closest('section');
    expect(within(demoSection).getByText('Step 2')).toBeInTheDocument();
    expect(within(demoSection).queryByText('Step 1')).not.toBeInTheDocument();
    expect(within(demoSection).queryByText('Step 10')).not.toBeInTheDocument();
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
Expected: the 7 new tests FAIL (no `searchbox` role exists yet — `getByRole('searchbox', ...)` throws). The 23 tests from Tasks 1–2 still PASS.

- [ ] **Step 3: Add the `matchesQuery` and `getDisplayItems` helpers**

In `demo_api_ui/src/pages/UseCaseLauncherPage.js`, add these two functions above the `OWASPBadge` function definition (currently line 207, `function OWASPBadge({ owasp }) {`):

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

/**
 * A track's grid cards, minus any use case exclusively surfaced via the
 * Progressive Trust Demo strip (UC24 / Act 1 in the 'demo' track).
 */
function getDisplayItems(track, items) {
  return track === 'demo'
    ? items.filter((uc) => !PROGRESSIVE_TRUST_STRIP_IDS.has(uc.id))
    : items;
}

```

- [ ] **Step 4: Add `query` state; filter `happyPath`/`grouped`/`demoAll`; compute `demoVisible` and extend `hasAnyResults`**

In `UseCaseLauncherPage()`, add the state declaration alongside the other `useState` calls (after the `chipRun` declaration):

```js
  const [query, setQuery] = useState('');
```

Then replace the Task-1+2 block that computed `happyPath`, `grouped`, `demoTrackItemsForStrip`, and `demoAll` (exact text, comments included, as Tasks 1 and 2 wrote it):

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

  // Demo: fixed-order presenter script (12 ids). No dedup against Happy Path
  // or track sections — see design spec §3.
  const demoAll = DEMO_USE_CASE_IDS
    .map((id) => useCases.find((uc) => uc.id === id))
    .filter(Boolean);
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

  const demoAll = DEMO_USE_CASE_IDS
    .map((id) => useCases.find((uc) => uc.id === id))
    .filter(Boolean);
  const demoVisible = demoAll.filter((uc) => matchesQuery(uc, query));

  const isSearching = query.trim().length > 0;
  // getDisplayItems mirrors the demo-track STRIP_IDS exclusion applied at
  // render time, so this reflects what actually becomes visible, not just
  // what's in `items`.
  const hasAnyResults =
    demoVisible.length > 0 ||
    happyPath.length > 0 ||
    grouped.some(({ track, items }) => getDisplayItems(track, items).length > 0);
```

Note: `happyPathIds` is computed from `happyPathAll` (pre-search), so dedup between the Happy Path group and track sections is unaffected by the search query — only which of the already-deduped items are *visible* changes. `demoAll` stays the full unfiltered script list (its order/membership never changes); `demoVisible` is the only thing search affects.

- [ ] **Step 5: Add the search input and empty-state message; filter the Demo section; fix track-section display and strip visibility**

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

Immediately after the closing `</header>` tag and before the Demo section block added in Task 2, add:

```jsx
      {!hasAnyResults && (
        <p className="uc-launcher__empty">No use cases match &quot;{query.trim()}&quot;.</p>
      )}

```

Next, in the Demo section block added in Task 2, replace its guard and its `.map` call:

```jsx
      {demoAll.length > 0 && (
```

with:

```jsx
      {demoVisible.length > 0 && (
```

and:

```jsx
            {demoAll.map((uc) => (
```

with:

```jsx
            {demoVisible.map((uc) => (
```

Next, replace the pre-existing inline `displayItems` computation inside the `{grouped.map(({ track, items }) => {` block (unmodified since before Task 1 — the three lines right after that opening line and the `if (items.length === 0) return null;` guard):

```jsx
        const displayItems = track === 'demo'
          ? items.filter((uc) => !PROGRESSIVE_TRUST_STRIP_IDS.has(uc.id))
          : items;
```

with:

```jsx
        const displayItems = getDisplayItems(track, items);
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
Expected: PASS — all 23 tests from Tasks 1–2 plus the 7 new tests (30 total), 0 failures.

- [ ] **Step 8: Run the full UI suite to check for unrelated regressions**

Run: `cd demo_api_ui && CI=true npx vitest run`
Expected: same pass/fail counts as the pre-work baseline for every file other than `UseCaseLauncherPage.test.js`. If an unrelated file regresses, stop and investigate before continuing — do not proceed with an unexplained new failure.

- [ ] **Step 9: Commit**

```bash
git add demo_api_ui/src/pages/UseCaseLauncherPage.js demo_api_ui/src/pages/UseCaseLauncherPage.css demo_api_ui/src/__tests__/UseCaseLauncherPage.test.js
git commit -m "$(cat <<'EOF'
feat(use-cases): add search box to launcher, filter across all sections

Filters Demo, Happy Path, and track-section cards by id/useCaseId/
title/buyerStory/whatToSay/trigger text. Groups stay intact while
searching; a section with zero matches disappears. Progressive Trust
Demo strip hides while searching (fixed presenter script, not a
filterable card) and reappears when the search box is cleared.
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
