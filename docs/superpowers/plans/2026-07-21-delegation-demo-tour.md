# Delegation Demo Tour (Plan B) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a dedicated, guided "Delegation Demo" tour (family → user→agent → A2A → workforce) plus a matching 4-stage talk-track script on the delegation page, without disturbing the existing general product tour.

**Architecture:** Parameterize the existing global `DemoTourProvider` so it can drive more than one step list. Add a second exported step array `DELEGATION_TOUR_STEPS`; the provider exposes the *active* `steps` array and selects it via `start(tourKey)`. The already-global `DemoTourModal` renders the active list. A launcher button on the delegation page starts the delegation tour, and the page's inline talk-track panel is refreshed from a family-only script to the full 4-stage arc. This is narration + route + hint only (the tour never automates the app); chips are referenced by `useCaseId`.

**Tech Stack:** React 18, react-router-dom, Vite, Vitest + @testing-library/react.

## Global Constraints

- **Emoji allowlist (REGRESSION_PLAN §0):** only `⚠️` `✅` `❌` `🔐` `✕` `✓` `👤` `🔑` `🪟` `📚` may appear in UI text/code. Everything else is plain text or CSS.
- **Worktree only:** all edits in `/Users/cmuir/Development/AI-DEMO2/.claude/worktrees/delegation-cleanup`. Stage files explicitly (`git add <path>`), never `git add -A`. Verify `git branch --show-current` before each commit.
- **UI build gate:** after any `demo_api_ui/` change the work is not done until `cd demo_api_ui && npm run build` exits `0`.
- **Preserve the general tour:** `start()` with no argument must still run the existing `TOUR_STEPS`. Do not change `TOUR_STEPS` content.
- **Vertical labels:** the delegation page already reads the active vertical's manifest `delegation` block; the tour references those relabels (workforce: "Delegate Access", "Submit Requests", "Approve Expenses") in prose only.
- **Honesty:** stage 4's per-action manager approval is NOT built yet (that is Plan A — manager-as-approver). Stage-4 copy demos the live workforce *grant* and frames the approval as the capstone; it must not claim the approval is live.
- **Node modules in the worktree:** if `demo_api_ui/node_modules` is missing, symlink it from the main checkout before building/testing: `ln -s /Users/cmuir/Development/AI-DEMO2/demo_api_ui/node_modules /Users/cmuir/Development/AI-DEMO2/.claude/worktrees/delegation-cleanup/demo_api_ui/node_modules`.

---

### Task 1: Add `DELEGATION_TOUR_STEPS` and make the provider multi-tour

**Files:**
- Modify: `demo_api_ui/src/context/DemoTourContext.js`
- Test: `demo_api_ui/src/context/__tests__/DemoTourContext.test.jsx` (create)

**Interfaces:**
- Produces: `export const DELEGATION_TOUR_STEPS` (array of `{ title, body, action }`, same shape as `TOUR_STEPS`). `useDemoTour()` return value gains `steps` (the active array); `total` becomes `steps.length`; `start(tourKey?)` accepts `'general'` (default) or `'delegation'`.

- [ ] **Step 1: Write the failing test**

Create `demo_api_ui/src/context/__tests__/DemoTourContext.test.jsx`:

```jsx
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import {
  DemoTourProvider,
  useDemoTour,
  DELEGATION_TOUR_STEPS,
  TOUR_STEPS,
} from "../DemoTourContext";

function Probe() {
  const t = useDemoTour();
  return (
    <div>
      <span data-testid="total">{t.total}</span>
      <span data-testid="title">{t.steps[t.step]?.title}</span>
      <button onClick={() => t.start("delegation")}>deleg</button>
      <button onClick={() => t.start()}>gen</button>
    </div>
  );
}

describe("DELEGATION_TOUR_STEPS", () => {
  it("has the 4-stage arc (intro + 4 stages) pointing at real routes", () => {
    expect(DELEGATION_TOUR_STEPS).toHaveLength(5);
    expect(DELEGATION_TOUR_STEPS[0].title).toMatch(/Prove who/i);
    expect(DELEGATION_TOUR_STEPS[1].title).toMatch(/Family/i);
    expect(DELEGATION_TOUR_STEPS[1].action.route).toBe("/delegation");
    expect(DELEGATION_TOUR_STEPS[4].title).toMatch(/Workforce/i);
  });
});

describe("DemoTourProvider multi-tour", () => {
  it("defaults to the general tour and switches to the delegation tour", () => {
    render(
      <DemoTourProvider>
        <Probe />
      </DemoTourProvider>,
    );
    expect(screen.getByTestId("total").textContent).toBe(String(TOUR_STEPS.length));
    fireEvent.click(screen.getByText("deleg"));
    expect(screen.getByTestId("total").textContent).toBe(String(DELEGATION_TOUR_STEPS.length));
    expect(screen.getByTestId("title").textContent).toMatch(/Prove who/i);
    fireEvent.click(screen.getByText("gen"));
    expect(screen.getByTestId("total").textContent).toBe(String(TOUR_STEPS.length));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_api_ui && CI=true npx vitest run src/context/__tests__/DemoTourContext.test.jsx`
Expected: FAIL — `DELEGATION_TOUR_STEPS` is `undefined` (not exported yet) and `t.steps` is `undefined`.

- [ ] **Step 3: Add `DELEGATION_TOUR_STEPS` after the `TOUR_STEPS` array**

In `demo_api_ui/src/context/DemoTourContext.js`, immediately after the closing `];` of `TOUR_STEPS` (before `const DemoTourContext = createContext(null);`), insert:

```js
export const DELEGATION_TOUR_STEPS = [
  {
    title: "Delegation Demo — Prove who's acting for me",
    body: "A four-stage story: one person hands authority to progressively more autonomous actors — a spouse, an AI agent, that agent's specialist, and an employee under a manager. Every time, Ping proves who is acting and with exactly what authority, via RFC 8693 token exchange and the act claim.",
    action: { label: "Open Family Delegation", route: "/delegation" },
  },
  {
    title: "Stage 1 — Family (human to human)",
    body: "Maya grants her spouse scoped access to her accounts — no shared password. The delegate logs in as themselves; their token carries an act claim proving they act on Maya's behalf, limited to the scopes she granted. One click revokes it.",
    action: {
      label: "Grant Account Access",
      route: "/delegation",
      hint: "In 'Grant Account Access', enter an email, check View Accounts + View Balances, click Grant Access — then show the Live Token Chain.",
    },
  },
  {
    title: "Stage 2 — User to AI agent",
    body: "Maya authorizes the AI agent once (may_act). When it calls a banking tool, the BFF exchanges her token for a delegated agent token carrying act={agent}. The agent cannot exceed the granted scope, and high-value writes still stop for her consent.",
    action: {
      label: "Go to the agent",
      route: "/dashboard",
      hint: "Use the 'show my balance' chip (use-case delegated-access-with-proof), then a ~$300 transfer to trigger the HITL consent gate. Watch the Token Chain.",
    },
  },
  {
    title: "Stage 3 — Agent to agent (A2A)",
    body: "The generalist agent hands off to a specialist sub-agent. Ping mints a nested-act token so the specialist inherits only what the handoff granted — the full chain Maya to agent to specialist is in the token, evaluated at each hop.",
    action: {
      label: "Go to the agent",
      route: "/dashboard",
      hint: "Requires ff_a2a_delegation ON. Use the 'hand off to a specialist' chip (use-case a2a-delegation) and read the nested act chain in the Token Chain.",
    },
  },
  {
    title: "Stage 4 — Workforce (grant now, approval next)",
    body: "The same primitive in the enterprise: switch to the Workforce vertical and a manager grants an employee standing scope — the Delegate Access page relabels automatically (Submit Requests, Approve Expenses). Per-action manager approval of high-value expenses — separation of duties — is the next capability being built on top of this grant.",
    action: {
      label: "Open Delegate Access",
      route: "/delegation",
      hint: "Switch the active vertical to Workforce, then grant a colleague — that grant is live today. The per-action manager approval is the roadmap capstone (manager-as-approver work), not yet wired.",
    },
  },
];
```

- [ ] **Step 4: Parameterize the provider**

In the same file, replace the `DemoTourProvider` body. Find the current provider (starts `export function DemoTourProvider({ children }) {` and contains `const [step, setStep] = useState(0);`). Replace the whole function down to its closing `}` with:

```js
const TOURS = { general: TOUR_STEPS, delegation: DELEGATION_TOUR_STEPS };

export function DemoTourProvider({ children }) {
  const [activeKey, setActiveKey] = useState("general");
  const [step, setStep] = useState(0);
  const [isOpen, setIsOpen] = useState(false);

  const steps = TOURS[activeKey] || TOUR_STEPS;
  const total = steps.length;

  const start = useCallback((tourKey = "general") => {
    setActiveKey(TOURS[tourKey] ? tourKey : "general");
    setStep(0);
    setIsOpen(true);
  }, []);

  const next = useCallback(() => {
    setStep((s) => Math.min(s + 1, total - 1));
  }, [total]);

  const prev = useCallback(() => {
    setStep((s) => Math.max(s - 1, 0));
  }, []);

  const close = useCallback(() => {
    setIsOpen(false);
  }, []);

  const goTo = useCallback((n) => {
    setStep(Math.max(0, Math.min(n, total - 1)));
  }, [total]);

  const value = useMemo(
    () => ({ step, total, steps, isOpen, start, next, prev, close, goTo }),
    [step, total, steps, isOpen, start, next, prev, close, goTo],
  );

  return (
    <DemoTourContext.Provider value={value}>
      {children}
    </DemoTourContext.Provider>
  );
}
```

Leave the `useDemoTour` hook and any exports below it unchanged.

- [ ] **Step 5: Run test to verify it passes**

Run: `cd demo_api_ui && CI=true npx vitest run src/context/__tests__/DemoTourContext.test.jsx`
Expected: PASS (2 files? no — 1 file, 2 test cases pass).

- [ ] **Step 6: Commit**

```bash
cd /Users/cmuir/Development/AI-DEMO2/.claude/worktrees/delegation-cleanup
git add demo_api_ui/src/context/DemoTourContext.js demo_api_ui/src/context/__tests__/DemoTourContext.test.jsx
git commit -m "feat(tour): add DELEGATION_TOUR_STEPS + multi-tour provider

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Render the active tour in the modal

**Files:**
- Modify: `demo_api_ui/src/components/tour/DemoTourModal.js`
- Test: `demo_api_ui/src/components/tour/__tests__/DemoTourModal.test.jsx` (create)

**Interfaces:**
- Consumes: `useDemoTour().steps` (from Task 1).

- [ ] **Step 1: Write the failing test**

Create `demo_api_ui/src/components/tour/__tests__/DemoTourModal.test.jsx`:

```jsx
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { DemoTourProvider, useDemoTour } from "../../../context/DemoTourContext";
import DemoTourModal from "../DemoTourModal";

function Launch({ tour }) {
  const t = useDemoTour();
  return <button onClick={() => t.start(tour)}>launch</button>;
}

function renderTour(tour) {
  return render(
    <MemoryRouter>
      <DemoTourProvider>
        <Launch tour={tour} />
        <DemoTourModal />
      </DemoTourProvider>
    </MemoryRouter>,
  );
}

describe("DemoTourModal active-tour rendering", () => {
  it("shows the delegation tour intro when the delegation tour is started", () => {
    renderTour("delegation");
    fireEvent.click(screen.getByText("launch"));
    expect(screen.getByText(/Prove who's acting for me/i)).toBeInTheDocument();
  });

  it("shows the general tour intro when no tour key is given", () => {
    renderTour(undefined);
    fireEvent.click(screen.getByText("launch"));
    expect(screen.getByText(/AI Agent Security Demo/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_api_ui && CI=true npx vitest run src/components/tour/__tests__/DemoTourModal.test.jsx`
Expected: FAIL — the modal still reads `TOUR_STEPS[step]`, so the delegation intro ("Prove who's acting for me") never renders.

- [ ] **Step 3: Point the modal at the active step list**

In `demo_api_ui/src/components/tour/DemoTourModal.js`:

Change the import line
```js
import { useDemoTour, TOUR_STEPS } from '../../context/DemoTourContext';
```
to
```js
import { useDemoTour } from '../../context/DemoTourContext';
```

Change the hook destructure
```js
  const { step, total, isOpen, next, prev, close } = useDemoTour();
```
to
```js
  const { step, total, steps, isOpen, next, prev, close } = useDemoTour();
```

Change the current-step lookup
```js
  const current = TOUR_STEPS[step];
```
to
```js
  const current = steps[step];
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd demo_api_ui && CI=true npx vitest run src/components/tour/__tests__/DemoTourModal.test.jsx`
Expected: PASS (2 test cases).

- [ ] **Step 5: Commit**

```bash
cd /Users/cmuir/Development/AI-DEMO2/.claude/worktrees/delegation-cleanup
git add demo_api_ui/src/components/tour/DemoTourModal.js demo_api_ui/src/components/tour/__tests__/DemoTourModal.test.jsx
git commit -m "feat(tour): modal renders the active tour's step list

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Launcher + 4-stage talk track on the delegation page

**Files:**
- Modify: `demo_api_ui/src/components/DelegationPage.js`

**Interfaces:**
- Consumes: `useDemoTour().start('delegation')` (Task 1).

- [ ] **Step 1: Import the tour hook**

In `demo_api_ui/src/components/DelegationPage.js`, below the existing import
```js
import { useVertical } from '../vertical/useVertical';
```
add:
```js
import { useDemoTour } from '../context/DemoTourContext';
```

- [ ] **Step 2: Add the launcher in the page header**

In the `DelegationPage` component, find where the derived labels are declared (the block starting `const { pageManifest } = useVertical();`). Immediately after `const GranteeLabel = ...;` add:

```js
  const tour = useDemoTour();
```

Then in the gradient page header, find the subtitle paragraph:
```jsx
          <p style={{ color: 'rgba(255,255,255,0.75)', fontSize: 14, margin: '6px 0 0' }}>
            {pageDescription}
          </p>
```
and insert, directly after that `</p>`:
```jsx
          <button
            type="button"
            onClick={() => tour.start('delegation')}
            style={{
              marginTop: 14, background: 'rgba(255,255,255,0.16)', color: '#fff',
              border: '1px solid rgba(255,255,255,0.4)', borderRadius: 8,
              padding: '8px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
            }}
          >
            Run guided delegation demo
          </button>
```

- [ ] **Step 3: Replace the talk-track script with the 4-stage arc**

In `DemoTalkTrackPanel`, replace the intro paragraph and the six-item array with the 4-stage arc. Find the block from
```jsx
          <p style={{ ...S.muted, marginBottom: 16 }}>
            Use this script when showing the delegation page to prospects. The goal is to connect the
```
through the end of the `.map(step => (...))` closing `))}` and replace the intro paragraph text and the array literal with:

Intro paragraph (replace the text only):
```jsx
          <p style={{ ...S.muted, marginBottom: 16 }}>
            Use this script to run the four-stage delegation story — one primitive, four escalating
            actors. Each stage ends on a "here's the proof" beat in the Live Token Chain, so you can
            stop after any stage.
          </p>
```

Array literal (replace the six existing objects with these five):
```jsx
          {[
            {
              num: 1,
              heading: 'Set the scene — one primitive, four actors',
              text: 'Open this page. Frame the through-line before touching anything.',
              quote: 'Maya hands authority to more and more autonomous actors — her spouse, an AI agent, that agent\'s specialist, then an employee under a manager. Every time, the question is the same: can we prove who is acting, and with what authority?',
            },
            {
              num: 2,
              heading: 'Stage 1 — Family (human to human)',
              text: 'In "Grant Account Access", grant a family member View Accounts + View Balances. Show the Live Token Chain.',
              quote: 'No shared password. The delegate logs in as themselves; their token carries an act claim proving they act on Maya\'s behalf, limited to exactly the scopes she granted. One click revokes it.',
            },
            {
              num: 3,
              heading: 'Stage 2 — User to AI agent',
              text: 'Go to the agent. Ask "show my balance", then attempt a ~$300 transfer to trigger the consent gate.',
              quote: 'Maya authorizes the agent once with may_act. Ping exchanges her token for a delegated one carrying act={agent}. It cannot exceed the granted scope, and high-value writes still stop for her consent.',
            },
            {
              num: 4,
              heading: 'Stage 3 — Agent to agent (A2A)',
              text: 'With ff_a2a_delegation on, use the "hand off to a specialist" chip. Read the nested act chain.',
              quote: 'The specialist inherits only what the handoff granted. The full chain — Maya to agent to specialist — is in the token, and Authorize evaluates every link. No ambient authority, even between agents.',
            },
            {
              num: 5,
              heading: 'Stage 4 — Workforce (grant now, approval next)',
              text: 'Switch the vertical to Workforce. A manager grants a colleague standing scope — that grant is live today. Per-action manager approval of a high-value expense is the capability being built next.',
              quote: 'Same primitive in your workforce: least privilege from the grant we can show now. Separation of duties — a per-action manager approval — is the next thing we are wiring on top of it. Same tokens, same proof, now for employees.',
            },
          ].map(step => (
```

Leave the surrounding `<div key={step.num} ...>` render body and the "Key objection" callout unchanged.

- [ ] **Step 4: Run the tour context + modal tests (guard against regressions)**

Run: `cd demo_api_ui && CI=true npx vitest run src/context/__tests__/DemoTourContext.test.jsx src/components/tour/__tests__/DemoTourModal.test.jsx`
Expected: PASS (all cases).

- [ ] **Step 5: Run the UI build gate**

Run: `cd demo_api_ui && npm run build`
Expected: exit `0` (the `mkcert TLS files missing` warning is non-fatal).

- [ ] **Step 6: Manual verification (drive the real UI)**

- Start the app (or the worktree UI per the "Worktree UI Live Verify" memory).
- Open `/delegation`, click **Run guided delegation demo** — the modal opens on "Delegation Demo — Prove who's acting for me", Step 1 of 5.
- Click Next through all 5 stages; confirm the Stage 1 action links to `/delegation` and Stage 2/3 to `/dashboard`.
- Open the **Demo Talk Track** panel — confirm it shows the five arc steps, not the old family-only script.
- Open the general tour from the Education bar ("Guided Demo Tour") — confirm it still shows the original security-demo steps (unchanged).

- [ ] **Step 7: Commit**

```bash
cd /Users/cmuir/Development/AI-DEMO2/.claude/worktrees/delegation-cleanup
git add demo_api_ui/src/components/DelegationPage.js
git commit -m "feat(delegation): guided delegation tour launcher + 4-stage talk track

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Out of scope (belongs to Plan A — manager-as-approver)

- The live per-action manager approval for stage 4 (distinct approver principal, approver-vs-subject session/audit model, cross-session approval, purpose-built manager/employee demo users). Stage 4 here demos the workforce *grant* only.
- When Plan A lands, update the Stage-4 tour step + talk-track step to point at the live approval flow.

## Self-Review

- **Spec coverage:** the 4-stage arc from the spec (`2026-07-21-delegation-demo-scenarios-design.md`) is represented as tour steps + talk-track steps; stage 4's approval is explicitly deferred to Plan A per the spec's Phase-2 note. Modular-exit framing is preserved ("stop after any stage").
- **Placeholder scan:** none — every step shows the exact code/commands.
- **Type consistency:** `steps`/`total`/`start(tourKey)` names match across Task 1 (provider), Task 2 (modal consumer), and Task 3 (launcher). `DELEGATION_TOUR_STEPS` length (5) is asserted in Task 1 and depended on nowhere else by a hardcoded number.
