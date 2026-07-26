# Live Workbench: reclaim agent space + make the demo legible — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On `/use-cases/live`, give the agent room and make every run legible to a demo audience — what claim is on trial, whether it held, and where in the token chain it was decided.

**Architecture:** The agent's `.ba-header-tools` element stays one React element; only its DOM parent changes, via `createPortal` into a host node the page registers on `AgentUiModeContext`. Everything else is page-local state plus small presentational components fed by data the page already fetches (`/api/use-cases`) and by two existing observers: `useProofOfEnforcement()` and `tokenChainTraceStore`.

**Tech Stack:** React 18, Vite, vitest + @testing-library/react, plain CSS (no CSS modules on these files).

## Global Constraints

- Work only inside the worktree `/Users/cmuir/Development/AI-DEMO2/.claude/worktrees/worktree-luw-header-hoist-tray`. Prefix every Write/Edit path with it. Never edit the main checkout.
- Stage explicitly with `git add <files>`. Never `git add -A` — the shared index carries a large dirty pile of unrelated data artifacts.
- All commands run from `<worktree>/demo_api_ui` unless stated otherwise.
- Test runner is **vitest**, not jest: `npx vitest run <path>`.
- Emoji allowlist (`REGRESSION_PLAN.md` §0): `⚠️ ✅ ❌ 🔐 ✕ ✓ 👤 🔑 🪟 📚` only. `←` / `→` are arrow glyphs already used in `AdminSideNav.jsx`, not emoji, and are permitted. Introduce nothing else.
- **Invent no demo copy.** Every user-visible string comes from the `/api/use-cases` catalog or `demoScript.js`. Do not write new claims, narration, or outcome labels.
- **Never derive an observed result from an expectation.** Removing exactly that bug is the point of Task 5.
- Do not change: OAuth/login, RFC 8693 token exchange, BFF session handling, role enforcement, HITL consent, ports/hosts, chip dispatch, agent routing, or the behavior of `ScopePicker` / `DemoStepsDropdown` / `Clear progress` / `Sign out`.
- Honour `prefers-reduced-motion: reduce` on every transition or animation this plan adds.
- localStorage key: `luw_demo_script_collapsed`, values `"1"` / `"0"`.
- Commit messages end with: `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`

---

## Completed

**Task 1** — commit `e9e47b010`, review clean. `AgentUiModeContext` gained `toolbarHostEl` / `setToolbarHostEl`; `LiveUseCaseWorkbenchPage` renders and registers `<div className="luw-topbar__agent-tools">` in `.luw-topbar`; new `src/pages/__tests__/LiveUseCaseWorkbenchPage.test.jsx` (2/2).

**Task 2** — commit `bf16f1af6`, review clean. `AIAgent.js` gained a module-scope `MaybePortal({ target, children })` and a two-line wrapper around `.ba-header-tools`; controls portal into the host when registered, render inline otherwise. Chips suite 57/57, nine regression suites 40/40.

---

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `src/pages/LiveUseCaseWorkbenchPage.js` | Route component: drawer state, selection, run handlers, focus orchestration | Modify (Tasks 3-7) |
| `src/pages/LiveUseCaseWorkbenchPage.css` | Route layout: slide-over, rail focus state | Modify (Tasks 3, 7) |
| `src/components/OWASPBadge.jsx` | Shared OWASP badge, extracted from `UseCaseLauncherPage` | Create (Task 4) |
| `src/components/UseCaseProofHeader.jsx` + `.css` | "What this proves" band above the agent | Create (Task 4) |
| `src/components/VerdictPair.jsx` + `.css` | Expected vs Actual chips + match badge | Create (Task 5) |
| `src/components/demoScript.js` | Gains a `findBeat(ucId)` lookup over existing data | Modify (Task 6) |
| `src/components/DemoScriptLauncher.jsx` | Highlights the beat matching page selection | Modify (Task 6) |
| `src/pages/__tests__/LiveUseCaseWorkbenchPage.test.jsx` | Page-level behavior | Modify (Tasks 3, 7) |
| `src/components/__tests__/UseCaseProofHeader.test.jsx` | Proof header | Create (Task 4) |
| `src/components/__tests__/VerdictPair.test.jsx` | Verdict logic | Create (Task 5) |
| `src/components/__tests__/demoScriptBeats.test.js` | Beat lookup | Create (Task 6) |

## Key existing code to reuse — read before writing anything new

- **`useProofOfEnforcement()`** → `{ verdict, history }`. `verdict.state` is one of `'verified'`, `'denied-as-expected'`, `'mismatch'`, `'incomplete'`. It also carries `useCaseId`, `title`, `matchedSteps`, `missingSteps`, `vertical`. It does **not** carry the raw decision string. Source: `src/context/ProofOfEnforcementContext.js:77-128`.
- **`tokenChainTraceStore`** — `subscribe(fn)` returns an unsubscribe and invokes `fn(snapshot)` immediately; `getState()` returns `{ trace, ... }`. The observed decision lives at `trace.authorize.outcome` (specific kind: `DENY` / `STEP_UP` / `HITL_REQUIRED`) and `trace.authorize.decision` (`PERMIT` or a block value). Source: `src/services/tokenChainTrace/tokenChainTraceStore.js:36-37, 98-119`.
- **`OWASPBadge`** at `src/pages/UseCaseLauncherPage.js:250-261` — renders the literal text `OWASP ASI` with threats/sections in the `title` attribute. It is not a per-use-case code string.
- **`policyLabel(outcome)`** at `src/pages/LiveUseCaseWorkbenchPage.js:65-73` — maps an expectedOutcome to `HITL` / `MFA` / `DENY` / `PERMIT`.
- **`DEMO_SCRIPT`** at `src/components/demoScript.js` — `{ acts: [{ title, meta, beats: [{ ucId, action, expected, say }] }] }`, 1:1 with `SECURITY_DEMO_USE_CASE_IDS`.
- **`demo-script` BroadcastChannel** — `DemoScriptLauncher` posts `{ type: 'run', ucId }`; the page already listens at `LiveUseCaseWorkbenchPage.js:218-230`.
- **AdminSideNav collapse idiom** at `src/components/AdminSideNav.jsx:1257-1265` — `←`/`→`, `aria-label`, `title`.

---

### Task 3: Demo Script drawer as a slide-over

Closed is the default demo posture: the grid drops to a single track so the agent spans the full width. Opening slides the drawer in *over* the agent rather than reflowing columns, so the agent never resizes mid-run.

**Files:**
- Modify: `demo_api_ui/src/pages/LiveUseCaseWorkbenchPage.js` (state near line 89; markup at `.luw-body` line 333 and `.luw-drawer` 334-346)
- Modify: `demo_api_ui/src/pages/LiveUseCaseWorkbenchPage.css` (`.luw-body` 20-26, `.luw-drawer` 28-33, `@media (max-width: 860px)` 258-283)
- Modify: `demo_api_ui/src/pages/__tests__/LiveUseCaseWorkbenchPage.test.jsx`

**Interfaces:**
- Consumes: the test file and mock preamble created in Task 1.
- Produces: `.luw-body--drawer-closed` on the body wrapper when shut. Task 7 adds a sibling class to `.luw-run-layout`, not to `.luw-body` — they must not collide.

- [ ] **Step 1: Write the failing tests**

Add `fireEvent` to the existing `@testing-library/react` import at the top of `demo_api_ui/src/pages/__tests__/LiveUseCaseWorkbenchPage.test.jsx`, then append:

```jsx
describe('LiveUseCaseWorkbenchPage — demo script slide-over', () => {
  it('starts open and closes on toggle', () => {
    const { container } = render(<LiveUseCaseWorkbenchPage />);
    expect(container.querySelector('.luw-body')).not.toHaveClass('luw-body--drawer-closed');

    fireEvent.click(screen.getByLabelText('Close demo script'));

    expect(container.querySelector('.luw-body')).toHaveClass('luw-body--drawer-closed');
    expect(screen.getByLabelText('Open demo script')).toBeInTheDocument();
  });

  it('persists the closed state to localStorage', () => {
    render(<LiveUseCaseWorkbenchPage />);
    fireEvent.click(screen.getByLabelText('Close demo script'));
    expect(localStorage.getItem('luw_demo_script_collapsed')).toBe('1');
  });

  it('restores the closed state on mount', () => {
    localStorage.setItem('luw_demo_script_collapsed', '1');
    const { container } = render(<LiveUseCaseWorkbenchPage />);
    expect(container.querySelector('.luw-body')).toHaveClass('luw-body--drawer-closed');
  });

  it('reopens from the edge tab', () => {
    localStorage.setItem('luw_demo_script_collapsed', '1');
    const { container } = render(<LiveUseCaseWorkbenchPage />);
    fireEvent.click(screen.getByLabelText('Open demo script'));
    expect(container.querySelector('.luw-body')).not.toHaveClass('luw-body--drawer-closed');
  });

  it('closes on Escape and on scrim click', () => {
    const { container } = render(<LiveUseCaseWorkbenchPage />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(container.querySelector('.luw-body')).toHaveClass('luw-body--drawer-closed');

    fireEvent.click(screen.getByLabelText('Open demo script'));
    fireEvent.click(container.querySelector('.luw-drawer__scrim'));
    expect(container.querySelector('.luw-body')).toHaveClass('luw-body--drawer-closed');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /Users/cmuir/Development/AI-DEMO2/.claude/worktrees/worktree-luw-header-hoist-tray/demo_api_ui
npx vitest run src/pages/__tests__/LiveUseCaseWorkbenchPage.test.jsx -t "slide-over"
```

Expected: all five FAIL with `Unable to find a label with the text of: Close demo script`.

- [ ] **Step 3: Add the drawer state**

Add next to the other module-scope constants in `LiveUseCaseWorkbenchPage.js` (after `TRACK_LABELS`, around line 34):

```js
const DRAWER_CLOSED_KEY = 'luw_demo_script_collapsed';
```

Inside the component, after the `glanceRecent` state declaration (line 89):

```js
  const [drawerOpen, setDrawerOpen] = useState(() => {
    try {
      return localStorage.getItem(DRAWER_CLOSED_KEY) !== '1';
    } catch {
      return true;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(DRAWER_CLOSED_KEY, drawerOpen ? '0' : '1');
    } catch {
      /* ignore */
    }
  }, [drawerOpen]);

  // Escape closes the slide-over, matching the scrim click.
  useEffect(() => {
    if (!drawerOpen) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setDrawerOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [drawerOpen]);
```

- [ ] **Step 4: Wire the markup**

Change the body wrapper (line 333) to:

```jsx
      <div className={`luw-body${drawerOpen ? '' : ' luw-body--drawer-closed'}`}>
```

Immediately inside it, before `<nav className="luw-drawer"`, add the edge tab and the scrim:

```jsx
        <button
          type="button"
          className="luw-drawer-tab"
          onClick={() => setDrawerOpen(true)}
          aria-label="Open demo script"
          title="Open demo script"
        >
          Demo script <span aria-hidden="true">→</span>
        </button>
        <div
          className="luw-drawer__scrim"
          onClick={() => setDrawerOpen(false)}
          aria-hidden="true"
        />
```

Then add the close control as the first child of `.luw-drawer__head` (line 335):

```jsx
            <button
              type="button"
              className="luw-drawer__toggle"
              onClick={() => setDrawerOpen(false)}
              aria-expanded={drawerOpen}
              aria-label="Close demo script"
              title="Close"
            >
              ←
            </button>
```

Leave the rest of the drawer's contents untouched — the slide-over hides them by transform, not by conditional rendering, so filter state and scroll position survive a close/open cycle.

- [ ] **Step 5: Add the CSS**

In `LiveUseCaseWorkbenchPage.css`, replace the `.luw-body` rule (lines 20-26) with:

```css
.luw-body {
  position: relative;
  display: grid;
  grid-template-columns: 336px 1fr;
  min-height: 0;
  min-width: 0;
  height: 100%;
}

/* Slide-over: closed is the default demo posture. The drawer leaves the grid
   entirely so the agent spans the full width and never resizes mid-run. */
.luw-body--drawer-closed { grid-template-columns: 1fr; }
```

Replace the `.luw-drawer` rule (lines 28-31) with:

```css
.luw-drawer {
  position: absolute;
  inset: 0 auto 0 0;
  width: 336px;
  z-index: 3;
  border-right: 1px solid #e2e8f0;
  background: var(--brand-light-gray, #f8fafc);
  display: flex;
  flex-direction: column;
  min-height: 0;
  transform: translateX(0);
  transition: transform 180ms ease;
}
.luw-body--drawer-closed .luw-drawer { transform: translateX(-100%); }

.luw-drawer__scrim {
  position: absolute;
  inset: 0;
  z-index: 2;
  background: rgba(15, 23, 42, 0.18);
  transition: opacity 180ms ease;
}
.luw-body--drawer-closed .luw-drawer__scrim { opacity: 0; pointer-events: none; }

.luw-drawer-tab {
  position: absolute;
  left: 0;
  top: 14px;
  z-index: 4;
  display: none;
  align-items: center;
  gap: 8px;
  writing-mode: vertical-rl;
  padding: 12px 6px;
  border: 1px solid #cbd5e1;
  border-left: 0;
  border-radius: 0 8px 8px 0;
  background: #fff;
  color: #334155;
  cursor: pointer;
  font: inherit;
  font-size: 0.74rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  box-shadow: 2px 0 6px rgba(15, 23, 42, 0.06);
}
.luw-body--drawer-closed .luw-drawer-tab { display: flex; }

.luw-drawer__toggle {
  position: absolute;
  top: 0.55rem;
  right: 0.5rem;
  width: 26px;
  height: 26px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  background: #fff;
  color: #475569;
  font-size: 0.85rem;
  line-height: 1;
  cursor: pointer;
}
.luw-drawer__toggle:hover { border-color: #94a3b8; color: #0f172a; }

@media (prefers-reduced-motion: reduce) {
  .luw-drawer, .luw-drawer__scrim { transition: none; }
}
```

Add `position: relative;` to `.luw-drawer__head` (line 30 in the original file).

Finally, inside the existing `@media (max-width: 860px)` block, revert the slide-over to static flow so the narrow stacked layout still works — add after that block's `.luw-drawer` rule:

```css
  .luw-drawer {
    position: static;
    width: auto;
    transform: none;
  }
  .luw-drawer__scrim, .luw-drawer-tab { display: none; }
  .luw-body--drawer-closed { grid-template-columns: 1fr; }
```

- [ ] **Step 6: Run tests to verify they pass**

```bash
cd /Users/cmuir/Development/AI-DEMO2/.claude/worktrees/worktree-luw-header-hoist-tray/demo_api_ui
npx vitest run src/pages/__tests__/LiveUseCaseWorkbenchPage.test.jsx
```

Expected: all seven tests in the file PASS (two from Task 1, five from this task).

- [ ] **Step 7: Commit**

```bash
cd /Users/cmuir/Development/AI-DEMO2/.claude/worktrees/worktree-luw-header-hoist-tray
git add demo_api_ui/src/pages/LiveUseCaseWorkbenchPage.js \
        demo_api_ui/src/pages/LiveUseCaseWorkbenchPage.css \
        demo_api_ui/src/pages/__tests__/LiveUseCaseWorkbenchPage.test.jsx
git commit -m "feat(luw): demo script drawer becomes a slide-over

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: "What this proves" panel

A band directly above the agent, driven by the selected use case, visible *before* a run — so the room knows the claim being tested.

**Files:**
- Create: `demo_api_ui/src/components/OWASPBadge.jsx`
- Create: `demo_api_ui/src/components/UseCaseProofHeader.jsx`, `demo_api_ui/src/components/UseCaseProofHeader.css`
- Create: `demo_api_ui/src/components/__tests__/UseCaseProofHeader.test.jsx`
- Modify: `demo_api_ui/src/pages/UseCaseLauncherPage.js:250-261` (delete the local copy, import the shared one)
- Modify: `demo_api_ui/src/pages/LiveUseCaseWorkbenchPage.js` (mount in `.luw-main__stage`)

**Interfaces:**
- Consumes: nothing from Tasks 3, 5-7.
- Produces: `<UseCaseProofHeader uc={selectedUc} beat={beat} />`. Task 6 supplies the `beat` prop; until then the page passes `null` and the presenter line does not render. `OWASPBadge` is the default export of `src/components/OWASPBadge.jsx` with prop `{ owasp }`.

- [ ] **Step 1: Write the failing test**

Create `demo_api_ui/src/components/__tests__/UseCaseProofHeader.test.jsx`:

```jsx
import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';

vi.mock('../UseCaseProofHeader.css', () => ({}), { virtual: true });

import UseCaseProofHeader from '../UseCaseProofHeader';

const UC = {
  id: 'UC1',
  title: 'Delegated access with proof',
  buyerStory: 'The agent acts for a named human, provably, at every hop.',
  whatToSay: 'show my balance',
  owasp: { threats: ['T1'], sections: ['S2'] },
};

describe('UseCaseProofHeader', () => {
  it('renders the claim, the phrase to say, and the OWASP badge', () => {
    render(<UseCaseProofHeader uc={UC} beat={null} />);
    expect(screen.getByText(UC.title)).toBeInTheDocument();
    expect(screen.getByText(UC.buyerStory)).toBeInTheDocument();
    expect(screen.getByText(/show my balance/)).toBeInTheDocument();
    expect(screen.getByText('OWASP ASI')).toBeInTheDocument();
  });

  it('renders nothing when no use case is selected', () => {
    const { container } = render(<UseCaseProofHeader uc={null} beat={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('omits the OWASP badge when the use case has none', () => {
    render(<UseCaseProofHeader uc={{ ...UC, owasp: null }} beat={null} />);
    expect(screen.queryByText('OWASP ASI')).toBeNull();
  });

  it('falls back to the trigger text when whatToSay is absent', () => {
    render(
      <UseCaseProofHeader
        uc={{ ...UC, whatToSay: null, trigger: { type: 'chip', text: 'show my accounts' } }}
        beat={null}
      />,
    );
    expect(screen.getByText(/show my accounts/)).toBeInTheDocument();
  });

  it('renders no presenter line without a beat', () => {
    render(<UseCaseProofHeader uc={UC} beat={null} />);
    expect(screen.queryByText(/Presenter line/i)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/cmuir/Development/AI-DEMO2/.claude/worktrees/worktree-luw-header-hoist-tray/demo_api_ui
npx vitest run src/components/__tests__/UseCaseProofHeader.test.jsx
```

Expected: FAIL — `Failed to resolve import "../UseCaseProofHeader"`.

- [ ] **Step 3: Extract the shared OWASP badge**

Create `demo_api_ui/src/components/OWASPBadge.jsx` with the body moved verbatim from `UseCaseLauncherPage.js:250-261`:

```jsx
/**
 * OWASP ASI badge — threats/sections surface in the tooltip, not the label.
 * Shared by the use-case launcher and the live workbench proof header.
 * @param {{ owasp?: { threats?: string[], sections?: string[] } }} props
 */
export default function OWASPBadge({ owasp }) {
  if (!owasp || (!owasp.threats?.length && !owasp.sections?.length)) return null;
  const title = [
    owasp.threats?.length  ? `Threats: ${owasp.threats.join(', ')}`   : '',
    owasp.sections?.length ? `Sections: ${owasp.sections.join(', ')}` : '',
  ].filter(Boolean).join(' — ');
  return (
    <span className="uc-owasp-badge" title={title}>
      OWASP ASI
    </span>
  );
}
```

In `UseCaseLauncherPage.js`, delete the local `OWASPBadge` function (lines 250-261) and add `import OWASPBadge from '../components/OWASPBadge';` alongside the other component imports. The `.uc-owasp-badge` CSS stays in `UseCaseLauncherPage.css`; `UseCaseProofHeader.css` must not redefine it.

- [ ] **Step 4: Write the component**

Create `demo_api_ui/src/components/UseCaseProofHeader.jsx`:

```jsx
import OWASPBadge from './OWASPBadge';
import './UseCaseProofHeader.css';

/**
 * The claim on trial for the selected use case, shown above the agent so an
 * audience knows what is being proved before anything runs. Every string comes
 * from the use-case catalog or the demo script — nothing is authored here.
 *
 * @param {{
 *   uc: object|null,
 *   beat: { say?: string }|null,
 * }} props
 */
export default function UseCaseProofHeader({ uc, beat }) {
  if (!uc) return null;
  const phrase = uc.whatToSay || uc.trigger?.text || '';
  return (
    <div className="ucph" data-testid="uc-proof-header">
      <div className="ucph__top">
        <span className="ucph__id">{uc.id}</span>
        <p className="ucph__title">{uc.title}</p>
        <OWASPBadge owasp={uc.owasp} />
      </div>
      {uc.buyerStory && <p className="ucph__claim">{uc.buyerStory}</p>}
      {phrase && (
        <p className="ucph__say">
          <span className="ucph__k">Say this</span>
          {phrase}
        </p>
      )}
      {beat?.say && (
        <p className="ucph__presenter">
          <span className="ucph__k">Presenter line</span>
          {beat.say}
        </p>
      )}
    </div>
  );
}
```

Create `demo_api_ui/src/components/UseCaseProofHeader.css`:

```css
/* UseCaseProofHeader.css — claim band above the live-workbench agent. */
.ucph {
  background: #fff;
  border: 1px solid #e2e8f0;
  border-left: 4px solid #0f766e;
  border-radius: 10px;
  padding: 12px 14px;
}
.ucph__top { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.ucph__id {
  font-size: 0.7rem;
  font-weight: 800;
  letter-spacing: 0.06em;
  color: #0f766e;
  background: #f0fdfa;
  border: 1px solid #99f6e4;
  border-radius: 5px;
  padding: 2px 7px;
}
.ucph__title { font-size: 0.98rem; font-weight: 700; margin: 0; }
.ucph__claim { margin: 0.5rem 0 0; font-size: 0.85rem; color: #334155; }
.ucph__k {
  display: block;
  margin-bottom: 3px;
  font-size: 0.66rem;
  font-weight: 800;
  letter-spacing: 0.07em;
  text-transform: uppercase;
  color: #64748b;
}
.ucph__say {
  margin: 0.6rem 0 0;
  font-size: 0.95rem;
  font-weight: 700;
  color: #0f172a;
  background: #f1f5f9;
  border-radius: 8px;
  padding: 8px 11px;
}
.ucph__presenter {
  margin: 0.55rem 0 0;
  padding-left: 10px;
  border-left: 3px solid #cbd5e1;
  font-size: 0.84rem;
  font-style: italic;
  color: #475569;
}
.ucph__presenter .ucph__k { font-style: normal; color: #94a3b8; }
```

- [ ] **Step 5: Mount it on the page**

In `LiveUseCaseWorkbenchPage.js`, add `import UseCaseProofHeader from '../components/UseCaseProofHeader';` with the other component imports. Derive the selected use case next to the other derived values in the component body:

```js
  const selectedUc = useCases.find((u) => u.id === selectedId) || null;
```

Then render it as the first child of `.luw-main__stage`, directly above `.luw-run-layout`:

```jsx
          <UseCaseProofHeader uc={selectedUc} beat={null} />
```

- [ ] **Step 6: Run tests to verify they pass**

```bash
cd /Users/cmuir/Development/AI-DEMO2/.claude/worktrees/worktree-luw-header-hoist-tray/demo_api_ui
npx vitest run src/components/__tests__/UseCaseProofHeader.test.jsx \
  src/pages/__tests__/LiveUseCaseWorkbenchPage.test.jsx \
  src/__tests__/UseCaseLauncherPage.test.js
```

Expected: all PASS. The launcher suite is included because Task 4 removes its local `OWASPBadge`.

- [ ] **Step 7: Commit**

```bash
cd /Users/cmuir/Development/AI-DEMO2/.claude/worktrees/worktree-luw-header-hoist-tray
git add demo_api_ui/src/components/OWASPBadge.jsx \
        demo_api_ui/src/components/UseCaseProofHeader.jsx \
        demo_api_ui/src/components/UseCaseProofHeader.css \
        demo_api_ui/src/components/__tests__/UseCaseProofHeader.test.jsx \
        demo_api_ui/src/pages/UseCaseLauncherPage.js \
        demo_api_ui/src/pages/LiveUseCaseWorkbenchPage.js
git commit -m "feat(luw): what-this-proves header above the agent

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Expected vs Actual verdict

Replaces the `Policy` cell in `.luw-glance`, which today is assigned from `uc.expectedOutcome` and therefore cannot disagree with the expectation — it looks like a result and proves nothing.

**Files:**
- Create: `demo_api_ui/src/components/VerdictPair.jsx`, `demo_api_ui/src/components/VerdictPair.css`
- Create: `demo_api_ui/src/components/__tests__/VerdictPair.test.jsx`
- Modify: `demo_api_ui/src/pages/LiveUseCaseWorkbenchPage.js` (glance markup; delete both `setGlancePolicy` calls at lines 140 and 162 and the `glancePolicy` state)

**Interfaces:**
- Consumes: `selectedUc` from Task 4.
- Produces: `<VerdictPair expected={string} actual={string|null} state={string|null} running={boolean} />` where `state` is a `verdict.state` value. Task 7 reads the same `verdict` and `trace.authorize` and must not re-derive the match judgement itself.

**Critical correctness note.** The comparison rules are subtle and already implemented and tested in `computeVerdict` (`DENIED_LIKE_OUTCOMES`, `EXPECTED_OUTCOME_FAMILY`). This component must **not** re-implement them. It takes the match judgement from `verdict.state` and only *displays* the observed decision string. Deriving `actual` from `expected` in any form is the bug being removed.

- [ ] **Step 1: Write the failing test**

Create `demo_api_ui/src/components/__tests__/VerdictPair.test.jsx`:

```jsx
import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';

vi.mock('../VerdictPair.css', () => ({}), { virtual: true });

import VerdictPair from '../VerdictPair';

describe('VerdictPair', () => {
  it('shows no result before a run', () => {
    render(<VerdictPair expected="PERMIT" actual={null} state={null} running={false} />);
    expect(screen.getByTestId('verdict-expected')).toHaveTextContent('PERMIT');
    expect(screen.getByTestId('verdict-actual')).toHaveTextContent('—');
    expect(screen.queryByTestId('verdict-match')).toBeNull();
  });

  it('shows a running state without claiming a result', () => {
    render(<VerdictPair expected="PERMIT" actual={null} state={null} running />);
    expect(screen.getByTestId('verdict-actual')).toHaveTextContent('Running');
    expect(screen.queryByTestId('verdict-match')).toBeNull();
  });

  it('marks a verified run as matched', () => {
    render(<VerdictPair expected="PERMIT" actual="PERMIT" state="verified" running={false} />);
    expect(screen.getByTestId('verdict-match')).toHaveTextContent('matched');
  });

  it('marks a denied-as-expected run as matched', () => {
    render(<VerdictPair expected="DENY" actual="DENY" state="denied-as-expected" running={false} />);
    expect(screen.getByTestId('verdict-actual')).toHaveTextContent('DENY');
    expect(screen.getByTestId('verdict-match')).toHaveTextContent('matched');
  });

  it('does not claim success on a mismatch', () => {
    render(<VerdictPair expected="DENY" actual="PERMIT" state="mismatch" running={false} />);
    const match = screen.getByTestId('verdict-match');
    expect(match).toHaveTextContent('not proven');
    expect(match).not.toHaveTextContent('matched');
  });

  it('reports an incomplete run as unproven, not as a pass', () => {
    render(<VerdictPair expected="DENY" actual={null} state="incomplete" running={false} />);
    expect(screen.getByTestId('verdict-actual')).toHaveTextContent('Unproven');
    expect(screen.getByTestId('verdict-match')).toHaveTextContent('not proven');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/cmuir/Development/AI-DEMO2/.claude/worktrees/worktree-luw-header-hoist-tray/demo_api_ui
npx vitest run src/components/__tests__/VerdictPair.test.jsx
```

Expected: FAIL — `Failed to resolve import "../VerdictPair"`.

- [ ] **Step 3: Write the component**

Create `demo_api_ui/src/components/VerdictPair.jsx`:

```jsx
import './VerdictPair.css';

/** Chip tone per outcome label. Unknown labels render neutral. */
function toneOf(label) {
  const t = String(label || '').toUpperCase();
  if (t === 'PERMIT') return 'permit';
  if (t === 'DENY') return 'deny';
  if (t === 'HITL' || t === 'HITL_REQUIRED' || t === 'MFA' || t === 'STEP_UP') return 'hitl';
  if (t === 'UNPROVEN') return 'unproven';
  return 'none';
}

/**
 * Expected vs observed outcome for the selected use case.
 *
 * `actual` is the decision observed on the token chain; `state` is the verdict
 * computed by ProofOfEnforcementContext. The match judgement comes from `state`
 * alone — this component never compares `expected` to `actual` itself, because
 * the real comparison rules (deny-like families, block kinds) live in
 * computeVerdict and are tested there.
 *
 * @param {{
 *   expected: string,
 *   actual: string|null,
 *   state: 'verified'|'denied-as-expected'|'mismatch'|'incomplete'|null,
 *   running: boolean,
 * }} props
 */
export default function VerdictPair({ expected, actual, state, running }) {
  const incomplete = state === 'incomplete';
  const actualLabel = running ? 'Running…' : incomplete ? 'Unproven' : actual || '—';
  const matched = state === 'verified' || state === 'denied-as-expected';
  const showMatch = !running && Boolean(state);

  return (
    <div className="verdict">
      <span className="verdict__side">
        <span className="verdict__k">Expected</span>
        <span className={`verdict__chip verdict__chip--${toneOf(expected)}`} data-testid="verdict-expected">
          {expected || '—'}
        </span>
      </span>
      <span className="verdict__side">
        <span className="verdict__k">Actual</span>
        <span
          className={`verdict__chip verdict__chip--${running ? 'running' : incomplete ? 'unproven' : toneOf(actual)}`}
          data-testid="verdict-actual"
        >
          {actualLabel}
        </span>
      </span>
      {showMatch && (
        <span
          className={`verdict__match verdict__match--${matched ? 'ok' : 'bad'}`}
          data-testid="verdict-match"
        >
          {matched ? '✅ matched' : '⚠️ not proven'}
        </span>
      )}
    </div>
  );
}
```

Create `demo_api_ui/src/components/VerdictPair.css`:

```css
/* VerdictPair.css — expected vs observed outcome, live workbench glance strip. */
.verdict { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.verdict__side { display: flex; align-items: baseline; gap: 7px; }
.verdict__k {
  font-size: 0.62rem;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.07em;
  color: #64748b;
}
.verdict__chip {
  font-size: 0.95rem;
  font-weight: 800;
  letter-spacing: 0.02em;
  padding: 3px 11px;
  border-radius: 7px;
  border: 1px solid transparent;
}
.verdict__chip--permit   { background: #dcfce7; color: #166534; border-color: #86efac; }
.verdict__chip--deny     { background: #fee2e2; color: #991b1b; border-color: #fca5a5; }
.verdict__chip--hitl     { background: #ffedd5; color: #9a3412; border-color: #fdba74; }
.verdict__chip--unproven { background: #fef9c3; color: #854d0e; border-color: #fde047; }
.verdict__chip--running  { background: #e0e7ff; color: #3730a3; border-color: #a5b4fc; }
.verdict__chip--none     { background: #e2e8f0; color: #64748b; border-color: #cbd5e1; }
.verdict__match { font-size: 0.78rem; font-weight: 800; padding: 3px 9px; border-radius: 999px; }
.verdict__match--ok  { background: #dcfce7; color: #166534; }
.verdict__match--bad { background: #fffbeb; color: #92400e; }
```

- [ ] **Step 4: Feed it real observed data on the page**

In `LiveUseCaseWorkbenchPage.js`:

Add imports:

```js
import VerdictPair from '../components/VerdictPair';
import { useProofOfEnforcement } from '../context/ProofOfEnforcementContext';
```

Subscribe to the observed decision next to the other state:

```js
  const { verdict } = useProofOfEnforcement();
  const [authorizeSeen, setAuthorizeSeen] = useState(null);

  // The observed decision, read straight off the token-chain trace. Never
  // derived from uc.expectedOutcome — that was the bug this replaces.
  useEffect(() => tokenChainTraceStore.subscribe((snap) => {
    const az = snap?.trace?.authorize;
    setAuthorizeSeen(az ? (az.outcome || az.decision || null) : null);
  }), []);
```

Delete the `glancePolicy` state declaration, the `setGlancePolicy(policyLabel(uc.expectedOutcome));` line in `handleRunChip` (line 140), and the `setGlancePolicy('DENY');` line in `handleRunAttack` (line 162). Leave `policyLabel` — it is still used for the Expected side.

Replace the middle `.luw-glance__cell` (the `Policy` cell) with:

```jsx
            <div className="luw-glance__cell">
              <span className="luw-glance__label">Verdict</span>
              <VerdictPair
                expected={policyLabel(selectedUc?.expectedOutcome)}
                actual={authorizeSeen}
                state={verdict?.state || null}
                running={runState?.state === 'running'}
              />
            </div>
```

Add `useProofOfEnforcement` to the page test's mock preamble so the existing page tests keep rendering:

```jsx
vi.mock('../../context/ProofOfEnforcementContext', () => ({
  useProofOfEnforcement: () => ({ verdict: null, history: [] }),
}));
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd /Users/cmuir/Development/AI-DEMO2/.claude/worktrees/worktree-luw-header-hoist-tray/demo_api_ui
npx vitest run src/components/__tests__/VerdictPair.test.jsx \
  src/pages/__tests__/LiveUseCaseWorkbenchPage.test.jsx
```

Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
cd /Users/cmuir/Development/AI-DEMO2/.claude/worktrees/worktree-luw-header-hoist-tray
git add demo_api_ui/src/components/VerdictPair.jsx \
        demo_api_ui/src/components/VerdictPair.css \
        demo_api_ui/src/components/__tests__/VerdictPair.test.jsx \
        demo_api_ui/src/pages/LiveUseCaseWorkbenchPage.js \
        demo_api_ui/src/pages/__tests__/LiveUseCaseWorkbenchPage.test.jsx
git commit -m "feat(luw): expected vs observed verdict replaces the expectation-fed policy cell

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Teleprompter beat sync

**Files:**
- Modify: `demo_api_ui/src/components/demoScript.js` (append a lookup; do not touch `DEMO_SCRIPT`)
- Create: `demo_api_ui/src/components/__tests__/demoScriptBeats.test.js`
- Modify: `demo_api_ui/src/pages/LiveUseCaseWorkbenchPage.js`
- Modify: `demo_api_ui/src/components/DemoScriptLauncher.jsx`

**Interfaces:**
- Consumes: `UseCaseProofHeader`'s `beat` prop (Task 4).
- Produces: `findBeat(ucId)` exported from `demoScript.js`, returning `{ ucId, action, expected, say }` or `null`. The page posts `{ type: 'select', ucId }` on the existing `demo-script` BroadcastChannel; the launcher must ignore message types it does not recognise, as it already does for `run`.

- [ ] **Step 1: Write the failing test**

Create `demo_api_ui/src/components/__tests__/demoScriptBeats.test.js`:

```js
import { DEMO_SCRIPT, findBeat } from '../demoScript';

describe('findBeat', () => {
  it('finds a beat by use-case id', () => {
    const beat = findBeat('UC1');
    expect(beat).toBeTruthy();
    expect(beat.ucId).toBe('UC1');
    expect(typeof beat.say).toBe('string');
    expect(beat.say.length).toBeGreaterThan(0);
  });

  it('returns null for a use case outside the script', () => {
    expect(findBeat('UC999')).toBeNull();
    expect(findBeat(null)).toBeNull();
  });

  it('covers every beat declared in DEMO_SCRIPT', () => {
    const all = DEMO_SCRIPT.acts.flatMap((a) => a.beats).filter((b) => b.ucId);
    all.forEach((b) => { expect(findBeat(b.ucId)).toEqual(b); });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/cmuir/Development/AI-DEMO2/.claude/worktrees/worktree-luw-header-hoist-tray/demo_api_ui
npx vitest run src/components/__tests__/demoScriptBeats.test.js
```

Expected: FAIL — `findBeat is not a function`.

- [ ] **Step 3: Add the lookup**

Append to `demo_api_ui/src/components/demoScript.js`, after the `DEMO_SCRIPT` export:

```js
/** Flat ucId -> beat index, derived from DEMO_SCRIPT. No content duplicated. */
const BEAT_BY_UC_ID = DEMO_SCRIPT.acts
  .flatMap((act) => act.beats || [])
  .reduce((acc, beat) => {
    if (beat.ucId) acc[beat.ucId] = beat;
    return acc;
  }, {});

/**
 * The 15-min script beat for a use case, or null when it is not in the script.
 * @param {string|null|undefined} ucId
 */
export function findBeat(ucId) {
  return (ucId && BEAT_BY_UC_ID[ucId]) || null;
}
```

- [ ] **Step 4: Show the presenter line and broadcast selection**

In `LiveUseCaseWorkbenchPage.js`, import the lookup:

```js
import { findBeat } from '../components/demoScript';
```

Derive the beat next to `selectedUc` and pass it through, replacing the `beat={null}` placeholder from Task 4:

```js
  const selectedBeat = findBeat(selectedId);
```

```jsx
          <UseCaseProofHeader uc={selectedUc} beat={selectedBeat} />
```

Broadcast the selection so a popped-out teleprompter follows along. Add next to the existing channel listener:

```js
  // Mirror selection to the teleprompter (in-page modal or 2nd-screen pop-out)
  // over the same channel it already uses to send us `run` messages.
  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined' || !selectedId) return undefined;
    const channel = new BroadcastChannel('demo-script');
    channel.postMessage({ type: 'select', ucId: selectedId });
    return () => channel.close();
  }, [selectedId]);
```

- [ ] **Step 5: Highlight the beat in the launcher**

In `DemoScriptLauncher.jsx`, track the active beat and mark it. Add state and a listener:

```jsx
  const [activeUcId, setActiveUcId] = useState(null);

  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return undefined;
    const channel = new BroadcastChannel('demo-script');
    const onMsg = (e) => {
      if (e.data?.type !== 'select' || !e.data.ucId) return;
      setActiveUcId(e.data.ucId);
    };
    channel.addEventListener('message', onMsg);
    return () => { channel.removeEventListener('message', onMsg); channel.close(); };
  }, []);
```

Change the beat wrapper at line 84 to carry the active class and a ref-based scroll:

```jsx
      <div
        className={`dsl-beat${b.ucId && b.ucId === activeUcId ? ' dsl-beat--active' : ''}`}
        key={key}
        ref={(node) => {
          if (node && b.ucId && b.ucId === activeUcId) {
            node.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
          }
        }}
      >
```

Add to `DemoScriptLauncher.css`:

```css
.dsl-beat--active {
  background: #f0fdfa;
  border-left: 4px solid #0f766e;
  padding-left: 0.6em;
}
```

- [ ] **Step 6: Run tests to verify they pass**

```bash
cd /Users/cmuir/Development/AI-DEMO2/.claude/worktrees/worktree-luw-header-hoist-tray/demo_api_ui
npx vitest run src/components/__tests__/demoScriptBeats.test.js \
  src/components/__tests__/UseCaseProofHeader.test.jsx \
  src/pages/__tests__/LiveUseCaseWorkbenchPage.test.jsx
```

Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
cd /Users/cmuir/Development/AI-DEMO2/.claude/worktrees/worktree-luw-header-hoist-tray
git add demo_api_ui/src/components/demoScript.js \
        demo_api_ui/src/components/__tests__/demoScriptBeats.test.js \
        demo_api_ui/src/components/DemoScriptLauncher.jsx \
        demo_api_ui/src/components/DemoScriptLauncher.css \
        demo_api_ui/src/pages/LiveUseCaseWorkbenchPage.js
git commit -m "feat(luw): sync the teleprompter beat to workbench selection

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Token Chain takes focus when a run completes

The token chain is the proof, so when the agent finishes it should own the room. On completion the rail grows, the decisive hop scrolls into view and pulses, the observed outcome pins to the top of the rail, and the result is announced politely. Focus is **not** stolen. The emphasis persists until the next run starts.

**THE RAIL'S DETAIL IS THE DEMO. This task is strictly additive.** The rail already renders, and must keep rendering unchanged in every state including focus: the `Token Chain` / `MCP` / `Trust` tabs, the run story, the per-step `TraceStepCard` `<details>` cards with their narrative, "Why this run", decision block, scope diff, key/value rows and RFC citations, `TraceTokenSummary`, the "Exchange Mode Details" accordion, and the `ClaimDetailsModal` / `TokenLegendModal` inspect paths. Do not hide, collapse, replace, summarise, truncate, virtualise, or reorder any of it. Do not swap a step card for the verdict chip. If a change would remove or shorten anything the rail shows today, it is out of scope — stop and report instead.

**Files:**
- Modify: `demo_api_ui/src/pages/LiveUseCaseWorkbenchPage.js`
- Modify: `demo_api_ui/src/pages/LiveUseCaseWorkbenchPage.css`
- Modify: `demo_api_ui/src/components/TraceStepCard.jsx` (add one `data-step-id` attribute — nothing else)
- Modify: `demo_api_ui/src/pages/__tests__/LiveUseCaseWorkbenchPage.test.jsx`

**Interfaces:**
- Consumes: `authorizeSeen`, `verdict`, `runState` from Task 5.
- Produces: `.luw-run-layout--rail-focus` on `.luw-run-layout`. This is a different element from Task 3's `.luw-body--drawer-closed`; the two must not be applied to the same node. `TraceStepCard` gains `data-step-id={step.id}` on its root `<details>`, which the page uses to locate the decisive step.

**Measured starting point — do not regress it.** `.luw-rail-host` is already the larger pane at `flex: 1.25 1 480px` with `overflow: auto` and `display: flex; flex-direction: column` (`LiveUseCaseWorkbenchPage.css:263-270`). Focus must **increase** its share. Never write a rigid `flex: 0 0 <n>` here — that drops grow/shrink and can make the rail *narrower* than its resting state at some widths, which is the opposite of this task's purpose.

- [ ] **Step 1: Write the failing tests**

Append to `demo_api_ui/src/pages/__tests__/LiveUseCaseWorkbenchPage.test.jsx`:

```jsx
describe('LiveUseCaseWorkbenchPage — token chain focus', () => {
  it('does not emphasize the rail before a run', () => {
    const { container } = render(<LiveUseCaseWorkbenchPage />);
    expect(container.querySelector('.luw-run-layout'))
      .not.toHaveClass('luw-run-layout--rail-focus');
  });

  it('exposes a polite live region that is empty before a run', () => {
    const { container } = render(<LiveUseCaseWorkbenchPage />);
    const live = container.querySelector('[aria-live="polite"]');
    expect(live).not.toBeNull();
    expect(live).toHaveTextContent('');
  });

  it('does not move DOM focus into the rail', () => {
    render(<LiveUseCaseWorkbenchPage />);
    expect(document.activeElement).toBe(document.body);
  });
});
```

The emphasis-on-completion path is driven by the `verdict` from context. Add a second describe that overrides the mock to simulate a settled verdict — place this at the very end of the file, and add a mutable mock object to the preamble by replacing the Task 5 `ProofOfEnforcementContext` mock with:

```jsx
const mockProof = { verdict: null, history: [] };
vi.mock('../../context/ProofOfEnforcementContext', () => ({
  useProofOfEnforcement: () => mockProof,
}));
```

Then:

```jsx
describe('LiveUseCaseWorkbenchPage — rail focus on a settled verdict', () => {
  afterEach(() => { mockProof.verdict = null; });

  it('emphasizes the rail and announces the result once a verdict lands', () => {
    mockProof.verdict = { useCaseId: 'uc1', title: 'x', state: 'denied-as-expected', matchedSteps: [], missingSteps: [] };
    const { container } = render(<LiveUseCaseWorkbenchPage />);
    expect(container.querySelector('.luw-run-layout'))
      .toHaveClass('luw-run-layout--rail-focus');
    expect(container.querySelector('[aria-live="polite"]')).toHaveTextContent(/Run complete/i);
  });

  it('does not claim a match when the verdict is incomplete', () => {
    mockProof.verdict = { useCaseId: 'uc1', title: 'x', state: 'incomplete', matchedSteps: [], missingSteps: ['authorize-decision'] };
    const { container } = render(<LiveUseCaseWorkbenchPage />);
    const live = container.querySelector('[aria-live="polite"]');
    expect(live).toHaveTextContent(/not proven/i);
    expect(live).not.toHaveTextContent(/matched/i);
  });

  it('keeps the token chain rail mounted and intact in the focus state', () => {
    mockProof.verdict = { useCaseId: 'uc1', title: 'x', state: 'verified', matchedSteps: [], missingSteps: [] };
    render(<LiveUseCaseWorkbenchPage />);
    // The rail is mocked in this suite, so this asserts the focus state does not
    // unmount or replace it. The real guarantee that its detail is untouched is
    // the rail-detail regression test below plus Task 8's live walkthrough.
    expect(screen.getByTestId('trace-rail')).toBeInTheDocument();
  });
});
```

Add one more regression test in a separate file, `demo_api_ui/src/components/__tests__/TraceStepCard.stepId.test.jsx`, pinning the single attribute this task adds and proving the card still renders its body:

```jsx
import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';

import TraceStepCard from '../TraceStepCard';

const step = {
  id: 'authorize-decision',
  status: 'ok',
  lane: 'MCP',
  title: 'Authorize decision',
  detail: { narrative: 'PingOne Authorize evaluated the request.' },
};

describe('TraceStepCard', () => {
  it('exposes a stable data-step-id for the workbench to target', () => {
    const { container } = render(<TraceStepCard step={step} onInspect={() => {}} />);
    const card = container.querySelector('[data-step-id="authorize-decision"]');
    expect(card).not.toBeNull();
    expect(card).toHaveClass('tctr-step');
    expect(card).toHaveAttribute('data-status', 'ok');
  });

  it('still renders its narrative body — the attribute is additive only', () => {
    render(<TraceStepCard step={step} onInspect={() => {}} defaultOpen />);
    expect(screen.getByText(/PingOne Authorize evaluated the request/)).toBeInTheDocument();
  });
});
```

If `TraceStepCard`'s real prop shape differs from the `step` object above, adjust the fixture to match the shape the component actually consumes — read the component and its two existing test files (`TraceStepCard.teaching.test.jsx`, `TraceStepCard.defaultOpen.test.jsx`) for a correct fixture rather than guessing. Do not change the component to fit the test.

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /Users/cmuir/Development/AI-DEMO2/.claude/worktrees/worktree-luw-header-hoist-tray/demo_api_ui
npx vitest run src/pages/__tests__/LiveUseCaseWorkbenchPage.test.jsx -t "focus"
```

Expected: the live-region and rail-focus tests FAIL (no `[aria-live]` node, no focus class).

- [ ] **Step 3: Derive the focus state**

In `LiveUseCaseWorkbenchPage.js`, add next to the Task 5 state:

```js
  const running = runState?.state === 'running';
  // The rail owns the room once a verdict settles, and keeps it until the next
  // run starts. Emphasis is visual only — DOM focus is never moved.
  const railFocus = !running && Boolean(verdict?.state);
  const verdictMatched = verdict?.state === 'verified' || verdict?.state === 'denied-as-expected';
  const announcement = railFocus
    ? `Run complete. ${verdictMatched ? 'Outcome matched.' : 'Outcome not proven.'}`
    : '';
```

- [ ] **Step 4: Wire the markup**

Add the live region and the focus class inside `.luw-main__stage`, replacing the opening `<div className="luw-run-layout">`:

```jsx
          <p className="luw-sr-only" aria-live="polite">{announcement}</p>
          <div className={`luw-run-layout${railFocus ? ' luw-run-layout--rail-focus' : ''}`}>
```

Pin the observed outcome to the top of the rail. It is added **above** `<TokenChainTraceRail />`, which stays mounted and unmodified — nothing the rail renders is removed, replaced, or wrapped:

```jsx
              <div className="luw-rail-host">
                {railFocus && (
                  <div className="luw-rail-verdict" data-testid="rail-verdict">
                    {verdict?.state === 'incomplete' ? 'Unproven' : (authorizeSeen || '—')}
                  </div>
                )}
                <TokenChainTraceRail />
              </div>
```

Add `data-step-id` to `TraceStepCard` so the page can find the decisive card. In `demo_api_ui/src/components/TraceStepCard.jsx:152`, change:

```jsx
    <details className="tctr-step" data-status={step.status} open={defaultOpen}>
```

to:

```jsx
    <details className="tctr-step" data-status={step.status} data-step-id={step.id} open={defaultOpen}>
```

That is the **only** permitted change to `TraceStepCard.jsx`. Do not alter its rendering, its `<details>` open behavior, or any of its body content.

Scroll the decisive step into view and pulse it once the verdict settles. Add to `LiveUseCaseWorkbenchPage.js`:

```js
  // Bring the authorize decision into view and pulse it — the rail is the proof,
  // so the eye should land on the step that decided the outcome. Purely additive:
  // no rail content is hidden, collapsed, or reordered.
  useEffect(() => {
    if (!railFocus) return undefined;
    const card = document.querySelector('[data-step-id="authorize-decision"]');
    if (!card) return undefined;
    card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    card.classList.add('luw-step-pulse');
    const t = setTimeout(() => card.classList.remove('luw-step-pulse'), 2400);
    return () => clearTimeout(t);
  }, [railFocus]);
```

If no element matches `[data-step-id="authorize-decision"]` — which is exactly the `incomplete` case, where no authorize step was observed — the effect does nothing. That is correct: there is no decisive hop to point at, and the `Unproven` chip already says so.

- [ ] **Step 5: Add the CSS**

Append to `LiveUseCaseWorkbenchPage.css`, before the `@media (max-width: 1200px)` block:

```css
/* Token Chain takes the room once a verdict settles, and keeps it until the
   next run. Emphasis is size + a pulse on the decisive hop — never a dimming
   scrim, which reads as a hang on a projector, and never hiding rail detail. */
.luw-rail-host { transition: flex-grow 260ms ease, flex-basis 260ms ease, box-shadow 260ms ease; }

/* Resting state is `flex: 1.25 1 480px`. Focus only ever GROWS the rail — keep
   grow/shrink live so it stays responsive; a rigid `flex: 0 0 <n>` here can end
   up narrower than the resting state at some widths. */
.luw-run-layout--rail-focus .luw-rail-host {
  flex: 2.2 1 640px;
  box-shadow: 0 0 0 3px rgba(15, 118, 110, 0.12);
}

/* Sticky so it stays readable while the presenter scrolls the chain — it must
   never replace or push out the rail's own content. */
.luw-rail-verdict {
  position: sticky;
  top: 0;
  z-index: 1;
  padding: 8px 12px;
  border-bottom: 1px solid #e2e8f0;
  font-size: 0.95rem;
  font-weight: 800;
  letter-spacing: 0.03em;
  color: #0f172a;
  background: #f8fafc;
}

/* One-shot pulse on the step that decided the outcome. */
@keyframes luwStepPulse {
  0%   { box-shadow: 0 0 0 0 rgba(15, 118, 110, 0.45); }
  70%  { box-shadow: 0 0 0 12px rgba(15, 118, 110, 0); }
  100% { box-shadow: 0 0 0 0 rgba(15, 118, 110, 0); }
}
.luw-step-pulse { animation: luwStepPulse 1100ms ease-out 2; }

.luw-sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

@media (prefers-reduced-motion: reduce) {
  .luw-rail-host { transition: none; }
  .luw-step-pulse { animation: none; }
}
```

Inside the existing `@media (max-width: 1200px)` block, where the agent and rail already stack full-width, neutralise the widening — matching the closed-state selector's specificity so it actually wins:

```css
  .luw-rail-host,
  .luw-run-layout--rail-focus .luw-rail-host { flex: 1 1 100%; }
```

- [ ] **Step 6: Run tests to verify they pass**

```bash
cd /Users/cmuir/Development/AI-DEMO2/.claude/worktrees/worktree-luw-header-hoist-tray/demo_api_ui
npx vitest run src/pages/__tests__/LiveUseCaseWorkbenchPage.test.jsx
```

Expected: every test in the file PASSES.

- [ ] **Step 7: Commit**

```bash
cd /Users/cmuir/Development/AI-DEMO2/.claude/worktrees/worktree-luw-header-hoist-tray
git add demo_api_ui/src/pages/LiveUseCaseWorkbenchPage.js \
        demo_api_ui/src/pages/LiveUseCaseWorkbenchPage.css \
        demo_api_ui/src/pages/__tests__/LiveUseCaseWorkbenchPage.test.jsx
git commit -m "feat(luw): token chain takes focus when a run completes

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Build gate and live verification

No code changes unless a gate fails. This task is the evidence the work is done.

**Files:** none expected.

**Interfaces:** consumes Tasks 3-7; produces verification evidence.

- [ ] **Step 1: Run the full UI test suite**

```bash
cd /Users/cmuir/Development/AI-DEMO2/.claude/worktrees/worktree-luw-header-hoist-tray/demo_api_ui
npx vitest run 2>&1 | tail -40
```

Expected: no new failures versus baseline. If a suite fails, confirm whether it also fails on `origin/main` before attributing it to this work.

- [ ] **Step 2: Run the build gate**

```bash
cd /Users/cmuir/Development/AI-DEMO2/.claude/worktrees/worktree-luw-header-hoist-tray/demo_api_ui
npm run build 2>&1 | tail -20
```

Expected: build succeeds.

- [ ] **Step 3: Confirm the diff is scoped**

```bash
cd /Users/cmuir/Development/AI-DEMO2/.claude/worktrees/worktree-luw-header-hoist-tray
git diff origin/main --stat -- demo_api_ui/src
git diff origin/main -- demo_api_ui/src/components/AIAgent.js
```

Expected: the `AIAgent.js` diff shows only the destructure change, the `MaybePortal` helper, and the two wrapper lines — nothing inside `ba-header-tools`.

- [ ] **Step 4: Verify live**

Open `https://local.ping-devops.com:4443/use-cases/live` (the running worktree UI instance) and sign in. Sign-in only works on the `local.ping-devops.com` host.

1. Controls render as one full-width bar above all three columns; the agent column header keeps only the status dot, "Super Banking Assistant", "Customer · Demo".
2. Every control still works: change Routing, flip Token Chain, open Demo steps, toggle Agent scope Read/Write, click Clear progress.
3. Drawer closes — agent spans the full width, edge tab remains. Reopens over the agent; scrim click and `Escape` both close it; the agent does not resize.
4. Reload — drawer state persists both ways.
5. Select a step without running it: the proof header names the claim, the phrase to say, the OWASP ASI badge, and the presenter line. Verdict reads `—`.
6. Run **UC1** (`show my balance`) — Expected `PERMIT`, Actual `PERMIT`, matched; the rail widens, the authorize hop is in view, the rail head shows `PERMIT`.
7. Run **UC6** (`transfer $2500`) — Expected `DENY`, Actual `DENY`, matched. Confirm it reads as a deliberate pass, not a failure.
8. Produce an `incomplete` verdict (e.g. a read that never reaches the authorize gate) and confirm Actual reads `Unproven` with `⚠️ not proven` — never a claimed pass.
9. Pop out the teleprompter (🪟) to a second window; changing selection on the page highlights and scrolls to the matching beat there.
10. `/dashboard` and the floating agent still render their header controls inline, unchanged.

- [ ] **Step 5: Record the result**

Report which of the ten live checks passed, quoting any failure exactly. Do not claim completion without this evidence.

---

### Task 9: Design doc — what the MCP Inspector can borrow from this work

**Deliverable is a document, not code.** Write a design doc; change no component. It ships inside this branch's PR so the thinking is reviewed alongside the work it derives from.

**Files:**
- Create: `docs/superpowers/specs/2026-07-26-mcp-inspector-legibility-design.md`

**Interfaces:** consumes the shipped behavior of Tasks 3-7; produces a spec another plan can execute later.

**Why there is something to borrow.** The MCP Inspector (`src/components/McpInspector.js`, ~862 lines, plus `PingOneMcpInspector.js` and `McpInspectorPage.jsx`) is the same shape as the live workbench: a tool list on the left, a parameter form in the middle, tabbed output on the right. It already tracks `selectedTool`, `lastInvoke`, `lastTiming`, `outputTab` and `mcpHistory`. It shares the `InspectorShell` component set in `src/components/shared/` (`InspectorShell.jsx`, `InspectorTabs.jsx`, `InspectorListItem.jsx`, `InspectorReplayBar.jsx`), and the repo has an `inspector-template` skill describing that layout as the standard for tool/list-detail pages.

- [ ] **Step 1: Read the current inspector before proposing anything**

Read, and record what each already does so the doc proposes nothing that exists:

```bash
cd /Users/cmuir/Development/AI-DEMO2/.claude/worktrees/worktree-luw-header-hoist-tray/demo_api_ui
```

- `src/components/McpInspector.js` — state, output tabs, history, error/step-up handling
- `src/components/McpInspectorPage.jsx`
- `src/components/shared/InspectorShell.jsx`, `InspectorTabs.jsx`, `InspectorReplayBar.jsx`
- `.claude/skills/inspector-template/SKILL.md` (repo root) — the existing convention this must not contradict

Also read what shipped in this plan, since that is the source material: `src/components/UseCaseProofHeader.jsx`, `src/components/VerdictPair.jsx`, and the slide-over and rail-focus sections of `src/pages/LiveUseCaseWorkbenchPage.{js,css}`.

- [ ] **Step 2: Write the doc**

Cover each candidate below with: what it would do in the inspector, which shipped component or pattern it reuses, what new data (if any) it needs, whether it belongs in `InspectorShell` (benefiting every inspector page) or only in the MCP inspector, and an honest cost/benefit. Reject the ones that do not earn their place — a doc that recommends everything is not a design.

1. **Collapsible tool list (slide-over).** Direct lift of Task 3. The inspector's left tool tree has the same problem the Demo Script drawer had: it is fixed-width and always present, squeezing the output pane where the interesting content is. Note whether this belongs in `InspectorShell` so all inspector pages get it.
2. **Expected vs Actual for tool calls.** The inspector shows what came back but has no notion of what *should* have come back, so a policy DENY looks the same as a failure. State plainly whether the inspector has, or could have, a source of expectation — a tool's declared scope requirement, a saved profile, a replay of a prior call from `mcpHistory`. **If no honest expectation source exists, say so and drop the idea** rather than inventing one; a fabricated expectation would recreate exactly the bug Task 5 removed.
3. **Authorize decision surfaced as a first-class outcome.** MCP tool calls traverse the same authorize gate the workbench visualises. Assess whether the inspector's response tab already carries that decision, and whether a `VerdictPair`-style chip (reused, not reimplemented) would make a DENY read as policy rather than breakage.
4. **Token chain for the invoked call.** The workbench pairs every run with `TokenChainTraceRail`. Evaluate adding a token-chain tab to the inspector's existing `InspectorTabs`, including whether `tokenChainTraceStore` is even populated on an inspector-initiated call — check, do not assume.
5. **Result focus on completion.** Task 7's pattern: on completion, grow the output pane, scroll the decisive element into view, pulse it once, announce via `aria-live`, no focus stealing, persist until the next invocation. Assess fit for a tool that returns instantly versus one that takes seconds.
6. **"What this tool proves" header.** The inspector already has each tool's `description` from `tools/list`. Judge whether a `UseCaseProofHeader`-style band adds anything beyond what the parameter form already shows, and reject it if not.

Include a short "explicitly not recommended" section listing what you rejected and why — that is the most useful part of the doc for whoever executes it.

Every claim about current inspector behavior must cite `file:line`. Do not describe behavior you have not read.

- [ ] **Step 3: Commit**

```bash
cd /Users/cmuir/Development/AI-DEMO2/.claude/worktrees/worktree-luw-header-hoist-tray
git add docs/superpowers/specs/2026-07-26-mcp-inspector-legibility-design.md
git commit -m "docs(spec): what the MCP inspector can borrow from the live workbench

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: Push, open a PR, and merge

**Gated on Task 8.** Do not start until Task 8's full suite, build gate, and live walkthrough have all passed and been recorded. If any live check failed, stop and report instead of merging.

**Files:** none.

- [ ] **Step 1: Confirm the branch is ready**

```bash
cd /Users/cmuir/Development/AI-DEMO2/.claude/worktrees/worktree-luw-header-hoist-tray
git branch --show-current   # must be worktree-worktree-luw-header-hoist-tray
git status --porcelain      # must be empty
git log --oneline origin/main..HEAD
```

- [ ] **Step 2: Run the CI jobs locally**

GitHub Actions is billing-blocked in this repo — jobs die in seconds with zero steps, so a red check is not a real signal. The gate is local. `CI=true` is REQUIRED: without it, jest's worker count differs and several supertest suites flake.

```bash
cd /Users/cmuir/Development/AI-DEMO2/.claude/worktrees/worktree-luw-header-hoist-tray
CI=true npm test 2>&1 | tail -30
npm run topology:verify 2>&1 | tail -20
```

`topology:verify` false-fails 6/7 if `demo_mcp_gateway` dependencies are not installed — install them first if that is the failure you see, rather than treating it as a real break.

- [ ] **Step 3: Push and open the PR**

```bash
cd /Users/cmuir/Development/AI-DEMO2/.claude/worktrees/worktree-luw-header-hoist-tray
git push -u origin worktree-worktree-luw-header-hoist-tray
```

Open the PR with a body covering: the two problems solved (agent space, demo legibility), the task list with commit SHAs, the `Policy`-cell correctness bug removed in Task 5, the deferred minors from the ledger, and the live-verification results from Task 8. End the body with:

```
🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

- [ ] **Step 4: Merge**

CI cannot pass while Actions is billing-blocked, so the merge needs `--admin`. Do not use `--delete-branch`: it collides with the worktree that still has this branch checked out.

```bash
gh pr merge --admin --squash
```

- [ ] **Step 5: Verify the merge landed**

```bash
cd /Users/cmuir/Development/AI-DEMO2/.claude/worktrees/worktree-luw-header-hoist-tray
git fetch origin
git log --oneline origin/main -5
```

Confirm the squashed commit is on `origin/main`. Report the merge commit SHA and the PR number.

---

## Self-Review

**Spec coverage**

| Requirement | Task |
|---|---|
| Toolbar host + portal | Tasks 1-2 (complete) |
| Slide-over drawer, persistence, Escape/scrim, edge tab | Task 3 |
| "What this proves" panel, shared OWASPBadge | Task 4 |
| Expected vs Actual, removal of the expectation-fed Policy cell | Task 5 |
| Teleprompter beat sync | Task 6 |
| Token Chain focus on completion, aria-live, no focus steal, persists to next run | Task 7 |
| Build gate + live walkthrough | Task 8 |

**Corrections made against the source while writing this plan:**
- `verdict.state` has four values, including `mismatch` — the earlier design listed only three. Task 5 handles all four.
- `OWASPBadge` renders the literal text `OWASP ASI` with detail in `title`; it is not a per-use-case code like "LLM06". Task 4's test asserts the real string.
- `verdict` carries no raw decision string, so Task 5 reads the observed decision from `trace.authorize.outcome || trace.authorize.decision` and takes only the match judgement from `verdict.state`.

**Placeholder scan:** no TBD/TODO; every code step carries literal code; no "similar to Task N" references.

**Type consistency:** `findBeat(ucId)` is defined in Task 6 and consumed as `selectedBeat` there; Task 4 ships `UseCaseProofHeader` with a `beat` prop that Task 4 passes as `null` and Task 6 fills — a deliberate two-stage handoff, stated in both tasks' Interfaces. `authorizeSeen` and `verdict` are introduced in Task 5 and reused in Task 7. `.luw-body--drawer-closed` (Task 3) and `.luw-run-layout--rail-focus` (Task 7) apply to different elements, stated in both. `DRAWER_CLOSED_KEY` resolves to `luw_demo_script_collapsed` in the implementation and in every test assertion.
