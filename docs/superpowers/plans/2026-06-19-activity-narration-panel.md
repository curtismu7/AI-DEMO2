# "What's Happening" Activity Narration Panel — Implementation Plan (Phase 1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a floating, plain-English "What's happening" panel that narrates the AI agent's work for demo viewers — fed entirely by the SSE state the agent already streams, with zero changes to the agent runtime.

**Architecture:** A new React context (`ActivityNarrativeContext`) holds a list of per-request narration "steps". A pure mapper module turns the already-accumulated agent state (`aguiState.toolCalls`, `aguiState.authorizeDecisions`, `aguiState.error`, `aguiState.lastOutcome`, `aguiState.hitlPending`) into friendly sentences. AIAgent.js wires these in using the existing `useNewItems` pattern plus one reconcile effect, mounts a floating panel (mirroring `FloatingTokenChainPanel`), and adds a header toggle. A single backend flag entry makes the feature toggleable.

**Tech Stack:** React (CRA-style, function components + hooks), Vitest + @testing-library/react, `createPortal`, `useDraggablePanel`. Node/Express backend `configStore.js` for the feature flag.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-06-19-activity-narration-panel-design.md`. Every task implicitly serves it.
- **Worktree only.** Stage explicitly (`git add <files>`); never `git add -A`. Verify `git branch --show-current` before each commit.
- **No emojis in product code/UI copy** (regression-guard §0). Status icons use text glyphs already used in the codebase (`▸ ▾ ✕`) and CSS, not emoji.
- **UI build gate must stay green:** `cd demo_api_ui && npm run build` exits 0.
- **Controls use the `Check` component** (`variant="switch"`, class `ba-header-toggle-label`) — the app control standard. Do not hand-roll a checkbox.
- **Vertical-aware copy:** the institution noun comes from `useVertical().pageManifest.identity.displayName` (e.g. "Bank", "Clinic", "Store"); never hardcode "bank".
- **Feature flag `ff_activity_narration`, default `'true'`.** When the flag resolves false the panel, header toggle, and all narration taps are inert.
- **Test runner:** `cd demo_api_ui && npx vitest run <path>` for a single file. `jest` is aliased to `vi` in `src/setupTests.js`.
- **One assumption to confirm during Task 3:** the obligation type strings on an authorize decision. The mapper matches defensively (`/step.?up|mfa|ciba/i` → step-up; `/consent|hitl|approval/i` → HITL). Before Task 7's manual verification, log one real `STATE_SNAPSHOT.authorizeDecisions` entry and confirm the regexes hit; adjust the fixture + regex if the real `type` strings differ.

---

### Task 1: Register the `ff_activity_narration` feature flag (backend)

**Files:**
- Modify: `demo_api_server/services/configStore.js:211` (insert after the `ff_agui_enabled` entry)

**Interfaces:**
- Produces: a public flag `ff_activity_narration` (string `'true'`/`'false'`) surfaced by `GET /api/admin/feature-flags` as `{ id: 'ff_activity_narration', value: <bool> }`, and togglable via the admin page.

- [ ] **Step 1: Add the flag entry**

In `demo_api_server/services/configStore.js`, the registry currently reads (lines 210–211):

```js
  ff_agent_results_panel:    { public: true, default: 'false' }, // Floating Results Panel in Banking Agent (off by default)
  ff_agui_enabled:           { public: true, default: 'true'  }, // AG-UI streaming agent via POST /api/agent/run
```

Insert a new line immediately after the `ff_agui_enabled` line:

```js
  ff_agui_enabled:           { public: true, default: 'true'  }, // AG-UI streaming agent via POST /api/agent/run
  ff_activity_narration:     { public: true, default: 'true'  }, // "What's happening" plain-English activity narration panel
```

- [ ] **Step 2: Verify the flag is served**

Run (from repo root, with the BFF running):

```bash
curl -s http://localhost:3001/api/admin/feature-flags | grep -o 'ff_activity_narration'
```

Expected: prints `ff_activity_narration`. If the server is not running, instead confirm by grep:

```bash
grep -n "ff_activity_narration" demo_api_server/services/configStore.js
```

Expected: one match on the inserted line.

- [ ] **Step 3: Commit**

```bash
git add demo_api_server/services/configStore.js
git commit -m "feat(flags): register ff_activity_narration feature flag"
```

---

### Task 2: Activity vocabulary module (`activityVocab.js`)

**Files:**
- Create: `demo_api_ui/src/components/activity/activityVocab.js`
- Test: `demo_api_ui/src/components/activity/__tests__/activityVocab.test.js`

**Interfaces:**
- Produces:
  - `renderTemplate(key: string, vars?: { institution?: string, phrase?: string }) → string` — substitutes `{institution}` / `{phrase}` tokens; unknown `{token}` left as-is; unknown `key` returns `''`.
  - `toolPhrase(toolName: string) → { running: string, done: string }` — friendly verb pair for a tool; falls back to a humanized name for unknown tools.
  - `TEMPLATES` (object, exported for tests).

- [ ] **Step 1: Write the failing test**

Create `demo_api_ui/src/components/activity/__tests__/activityVocab.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { renderTemplate, toolPhrase } from '../activityVocab';

describe('renderTemplate', () => {
  it('substitutes the institution token', () => {
    expect(renderTemplate('deny', { institution: 'Clinic' }))
      .toBe("The Clinic said no — that action isn't allowed.");
  });

  it('falls back to "service" when institution is missing', () => {
    expect(renderTemplate('permit')).toBe('The service approved the request.');
  });

  it('returns empty string for an unknown key', () => {
    expect(renderTemplate('nope', { institution: 'Bank' })).toBe('');
  });

  it('substitutes the phrase token for tool steps', () => {
    expect(renderTemplate('toolRunning', { phrase: 'Reading your balance' }))
      .toBe('Reading your balance…');
  });
});

describe('toolPhrase', () => {
  it('maps a known tool to a verb pair', () => {
    expect(toolPhrase('get_balance')).toEqual({ running: 'Reading your balance', done: 'Read your balance' });
  });

  it('humanizes an unknown tool name', () => {
    expect(toolPhrase('list_recent_orders'))
      .toEqual({ running: 'Working on list recent orders', done: 'Finished list recent orders' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_api_ui && npx vitest run src/components/activity/__tests__/activityVocab.test.js`
Expected: FAIL — `Failed to resolve import "../activityVocab"`.

- [ ] **Step 3: Write the implementation**

Create `demo_api_ui/src/components/activity/activityVocab.js`:

```js
/**
 * activityVocab.js — plain-English templates for the "What's happening" panel.
 *
 * Templates use {institution} (the vertical's display noun) and {phrase}
 * (a tool verb) tokens. This is the only place demo copy lives.
 */

export const TEMPLATES = {
  identity:   "Confirming it's really you…",
  delegation: 'The assistant is acting as you — allowed to look, not to move money.',
  permit:     'The {institution} approved the request.',
  deny:       "The {institution} said no — that action isn't allowed.",
  stepUp:     'The {institution} wants you to approve this on your phone first.',
  hitl:       'This needs your explicit OK before it can continue.',
  error:      "That didn't work — the assistant is trying another way.",
  toolRunning:'{phrase}…',
  toolDone:   '{phrase}',
  answer:     "Done — here's your answer.",
};

/** Substitute {institution}/{phrase} tokens. Unknown key → ''. Missing institution → 'service'. */
export function renderTemplate(key, vars = {}) {
  const tpl = TEMPLATES[key];
  if (tpl == null) return '';
  const institution = vars.institution || 'service';
  return tpl
    .replace(/\{institution\}/g, institution)
    .replace(/\{phrase\}/g, vars.phrase != null ? vars.phrase : '');
}

/** Friendly verb pair for known banking-style tools; humanized fallback otherwise. */
const TOOL_PHRASES = {
  get_balance:       { running: 'Reading your balance',        done: 'Read your balance' },
  list_transactions: { running: 'Looking up your transactions', done: 'Looked up your transactions' },
  transfer_funds:    { running: 'Setting up your transfer',     done: 'Set up your transfer' },
  deposit:           { running: 'Recording your deposit',       done: 'Recorded your deposit' },
  withdraw:          { running: 'Recording your withdrawal',    done: 'Recorded your withdrawal' },
};

export function toolPhrase(toolName) {
  if (toolName && TOOL_PHRASES[toolName]) return TOOL_PHRASES[toolName];
  const human = String(toolName || 'the task').replace(/[_-]+/g, ' ').trim();
  return { running: `Working on ${human}`, done: `Finished ${human}` };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd demo_api_ui && npx vitest run src/components/activity/__tests__/activityVocab.test.js`
Expected: PASS (6 assertions).

- [ ] **Step 5: Commit**

```bash
git add demo_api_ui/src/components/activity/activityVocab.js demo_api_ui/src/components/activity/__tests__/activityVocab.test.js
git commit -m "feat(activity): add activity narration vocabulary module"
```

---

### Task 3: Pure narration mapper (`activityNarration.js`)

**Files:**
- Create: `demo_api_ui/src/components/activity/activityNarration.js`
- Test: `demo_api_ui/src/components/activity/__tests__/activityNarration.test.js`

**Interfaces:**
- Consumes: `renderTemplate`, `toolPhrase` from `./activityVocab`.
- A `Step` is `{ key: string, text: string, status: 'running'|'done'|'failed', tone: 'neutral'|'security'|'error' }`.
- Produces:
  - `reconcileToolSteps(toolCalls: Array<{id,name,status}>) → Step[]` — one step per tool call, `status` from the tool call.
  - `authorizeDecisionToStep(decision, institution: string) → Step` — maps PERMIT/DENY + obligations.
  - `errorStep(institution: string) → Step`.
  - `identityStep() → Step`, `delegationStep() → Step`, `answerStep() → Step`.

- [ ] **Step 1: Write the failing test**

Create `demo_api_ui/src/components/activity/__tests__/activityNarration.test.js`:

```js
import { describe, it, expect } from 'vitest';
import {
  reconcileToolSteps,
  authorizeDecisionToStep,
  errorStep,
  identityStep,
  delegationStep,
} from '../activityNarration';

describe('reconcileToolSteps', () => {
  it('maps a running tool call to a present-tense running step', () => {
    const steps = reconcileToolSteps([{ id: 't1', name: 'get_balance', status: 'running' }]);
    expect(steps).toEqual([
      { key: 'tool:t1', text: 'Reading your balance…', status: 'running', tone: 'neutral' },
    ]);
  });

  it('maps a done tool call to a past-tense done step', () => {
    const steps = reconcileToolSteps([{ id: 't1', name: 'get_balance', status: 'done' }]);
    expect(steps).toEqual([
      { key: 'tool:t1', text: 'Read your balance', status: 'done', tone: 'neutral' },
    ]);
  });
});

describe('authorizeDecisionToStep', () => {
  it('narrates a PERMIT', () => {
    const step = authorizeDecisionToStep({ id: 'a1', decision: 'PERMIT' }, 'Bank');
    expect(step).toEqual({ key: 'authz:a1', text: 'The Bank approved the request.', status: 'done', tone: 'security' });
  });

  it('narrates a DENY', () => {
    const step = authorizeDecisionToStep({ id: 'a2', decision: 'DENY' }, 'Bank');
    expect(step.text).toBe("The Bank said no — that action isn't allowed.");
    expect(step.status).toBe('failed');
    expect(step.tone).toBe('security');
  });

  it('narrates a step-up obligation regardless of decision', () => {
    const step = authorizeDecisionToStep(
      { id: 'a3', decision: 'PERMIT', obligations: [{ type: 'gateway_step_up_required' }] },
      'Bank',
    );
    expect(step.text).toBe('The Bank wants you to approve this on your phone first.');
    expect(step.tone).toBe('security');
  });

  it('narrates a HITL/consent obligation', () => {
    const step = authorizeDecisionToStep(
      { id: 'a4', decision: 'PERMIT', obligations: [{ type: 'hitl_consent_required' }] },
      'Bank',
    );
    expect(step.text).toBe('This needs your explicit OK before it can continue.');
  });
});

describe('fixed steps', () => {
  it('identity and delegation are neutral running/done', () => {
    expect(identityStep()).toEqual({ key: 'identity', text: "Confirming it's really you…", status: 'done', tone: 'neutral' });
    expect(delegationStep().key).toBe('delegation');
    expect(errorStep('Bank').tone).toBe('error');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_api_ui && npx vitest run src/components/activity/__tests__/activityNarration.test.js`
Expected: FAIL — cannot resolve `../activityNarration`.

- [ ] **Step 3: Write the implementation**

Create `demo_api_ui/src/components/activity/activityNarration.js`:

```js
/**
 * activityNarration.js — pure mappers from agent state to plain-English steps.
 * No React, no side effects. A Step is:
 *   { key, text, status: 'running'|'done'|'failed', tone: 'neutral'|'security'|'error' }
 */
import { renderTemplate, toolPhrase } from './activityVocab';

const STEP_UP_RE = /step.?up|mfa|ciba/i;
const HITL_RE = /consent|hitl|approval/i;

/** One step per tool call; present tense while running, past tense when done. */
export function reconcileToolSteps(toolCalls = []) {
  return toolCalls.map((tc) => {
    const phrase = toolPhrase(tc.name);
    const done = tc.status === 'done';
    return {
      key: `tool:${tc.id}`,
      text: done
        ? renderTemplate('toolDone', { phrase: phrase.done })
        : renderTemplate('toolRunning', { phrase: phrase.running }),
      status: done ? 'done' : 'running',
      tone: 'neutral',
    };
  });
}

/** Map an authorize decision (+ obligations) to a security-tone step. */
export function authorizeDecisionToStep(decision, institution) {
  const obligations = Array.isArray(decision?.obligations) ? decision.obligations : [];
  const types = obligations.map((o) => String(o?.type || o || ''));
  const key = `authz:${decision?.id ?? 'unknown'}`;

  if (types.some((t) => STEP_UP_RE.test(t))) {
    return { key, text: renderTemplate('stepUp', { institution }), status: 'running', tone: 'security' };
  }
  if (types.some((t) => HITL_RE.test(t))) {
    return { key, text: renderTemplate('hitl', { institution }), status: 'running', tone: 'security' };
  }
  const verdict = String(decision?.decision || '').toUpperCase();
  if (verdict === 'DENY') {
    return { key, text: renderTemplate('deny', { institution }), status: 'failed', tone: 'security' };
  }
  return { key, text: renderTemplate('permit', { institution }), status: 'done', tone: 'security' };
}

export function errorStep(institution) {
  return { key: 'error', text: renderTemplate('error', { institution }), status: 'failed', tone: 'error' };
}

export function identityStep() {
  return { key: 'identity', text: renderTemplate('identity'), status: 'done', tone: 'neutral' };
}

export function delegationStep() {
  return { key: 'delegation', text: renderTemplate('delegation'), status: 'done', tone: 'neutral' };
}

export function answerStep() {
  return { key: 'answer', text: renderTemplate('answer'), status: 'done', tone: 'neutral' };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd demo_api_ui && npx vitest run src/components/activity/__tests__/activityNarration.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add demo_api_ui/src/components/activity/activityNarration.js demo_api_ui/src/components/activity/__tests__/activityNarration.test.js
git commit -m "feat(activity): add pure narration mapper"
```

---

### Task 4: Narrative context (`ActivityNarrativeContext.js`)

**Files:**
- Create: `demo_api_ui/src/context/ActivityNarrativeContext.js`
- Test: `demo_api_ui/src/context/__tests__/ActivityNarrativeContext.test.js`

**Interfaces:**
- A `Request` is `{ id: number, prompt: string, steps: Step[], status: 'running'|'done'|'failed', collapsed: boolean }`.
- Produces (context value from `useActivityNarrative()`):
  - `requests: Request[]`
  - `startRequest(prompt: string)` — collapses all prior requests, pushes a new running request seeded with `identityStep()` + `delegationStep()`.
  - `upsertStep(step: Step)` — add or replace (by `step.key`) a step on the current (last) request. No-op if no current request.
  - `finishRequest(status: 'done'|'failed')` — set current request status; flip any lingering `running` steps to `done`.
  - `reset()` — clear all requests.
- Also exports `ActivityNarrativeProvider` and `useActivityNarrativeOptional()` (returns `null` outside a provider, for safe consumption in tests/non-agent pages).

- [ ] **Step 1: Write the failing test**

Create `demo_api_ui/src/context/__tests__/ActivityNarrativeContext.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { ActivityNarrativeProvider, useActivityNarrative } from '../ActivityNarrativeContext';

const wrapper = ({ children }) => <ActivityNarrativeProvider>{children}</ActivityNarrativeProvider>;

describe('ActivityNarrativeContext', () => {
  it('startRequest seeds identity + delegation and collapses prior requests', () => {
    const { result } = renderHook(() => useActivityNarrative(), { wrapper });
    act(() => result.current.startRequest('pay rent'));
    act(() => result.current.startRequest('check balance'));

    expect(result.current.requests).toHaveLength(2);
    expect(result.current.requests[0].collapsed).toBe(true);
    expect(result.current.requests[1].collapsed).toBe(false);
    expect(result.current.requests[1].prompt).toBe('check balance');
    expect(result.current.requests[1].steps.map((s) => s.key)).toEqual(['identity', 'delegation']);
  });

  it('upsertStep adds then replaces a step by key on the current request', () => {
    const { result } = renderHook(() => useActivityNarrative(), { wrapper });
    act(() => result.current.startRequest('check balance'));
    act(() => result.current.upsertStep({ key: 'tool:t1', text: 'Reading your balance…', status: 'running', tone: 'neutral' }));
    expect(result.current.requests[0].steps.at(-1).status).toBe('running');

    act(() => result.current.upsertStep({ key: 'tool:t1', text: 'Read your balance', status: 'done', tone: 'neutral' }));
    const toolSteps = result.current.requests[0].steps.filter((s) => s.key === 'tool:t1');
    expect(toolSteps).toHaveLength(1);
    expect(toolSteps[0].status).toBe('done');
  });

  it('finishRequest flips lingering running steps to done and sets status', () => {
    const { result } = renderHook(() => useActivityNarrative(), { wrapper });
    act(() => result.current.startRequest('check balance'));
    act(() => result.current.upsertStep({ key: 'tool:t1', text: 'Reading…', status: 'running', tone: 'neutral' }));
    act(() => result.current.finishRequest('done'));
    expect(result.current.requests[0].status).toBe('done');
    expect(result.current.requests[0].steps.every((s) => s.status !== 'running')).toBe(true);
  });

  it('reset clears all requests', () => {
    const { result } = renderHook(() => useActivityNarrative(), { wrapper });
    act(() => result.current.startRequest('x'));
    act(() => result.current.reset());
    expect(result.current.requests).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_api_ui && npx vitest run src/context/__tests__/ActivityNarrativeContext.test.js`
Expected: FAIL — cannot resolve `../ActivityNarrativeContext`.

- [ ] **Step 3: Write the implementation**

Create `demo_api_ui/src/context/ActivityNarrativeContext.js`:

```js
/**
 * ActivityNarrativeContext — holds the per-request plain-English narration
 * shown in the "What's happening" panel. Ephemeral (no persistence).
 */
import React, { createContext, useContext, useCallback, useRef, useState } from 'react';
import { identityStep, delegationStep } from '../components/activity/activityNarration';

const ActivityNarrativeContext = createContext(null);

export function ActivityNarrativeProvider({ children }) {
  const [requests, setRequests] = useState([]);
  const idRef = useRef(0);

  const startRequest = useCallback((prompt) => {
    idRef.current += 1;
    const next = {
      id: idRef.current,
      prompt: prompt || '',
      steps: [identityStep(), delegationStep()],
      status: 'running',
      collapsed: false,
    };
    setRequests((prev) => [...prev.map((r) => ({ ...r, collapsed: true })), next]);
  }, []);

  const upsertStep = useCallback((step) => {
    if (!step || !step.key) return;
    setRequests((prev) => {
      if (prev.length === 0) return prev;
      const reqs = prev.slice();
      const cur = { ...reqs[reqs.length - 1] };
      const steps = cur.steps.slice();
      const idx = steps.findIndex((s) => s.key === step.key);
      if (idx === -1) steps.push(step);
      else steps[idx] = step;
      cur.steps = steps;
      reqs[reqs.length - 1] = cur;
      return reqs;
    });
  }, []);

  const finishRequest = useCallback((status) => {
    setRequests((prev) => {
      if (prev.length === 0) return prev;
      const reqs = prev.slice();
      const cur = { ...reqs[reqs.length - 1] };
      cur.status = status || 'done';
      cur.steps = cur.steps.map((s) => (s.status === 'running' ? { ...s, status: 'done' } : s));
      reqs[reqs.length - 1] = cur;
      return reqs;
    });
  }, []);

  const reset = useCallback(() => setRequests([]), []);

  const value = { requests, startRequest, upsertStep, finishRequest, reset };
  return <ActivityNarrativeContext.Provider value={value}>{children}</ActivityNarrativeContext.Provider>;
}

export function useActivityNarrative() {
  const ctx = useContext(ActivityNarrativeContext);
  if (!ctx) throw new Error('useActivityNarrative must be used within ActivityNarrativeProvider');
  return ctx;
}

export function useActivityNarrativeOptional() {
  return useContext(ActivityNarrativeContext);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd demo_api_ui && npx vitest run src/context/__tests__/ActivityNarrativeContext.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add demo_api_ui/src/context/ActivityNarrativeContext.js demo_api_ui/src/context/__tests__/ActivityNarrativeContext.test.js
git commit -m "feat(activity): add ActivityNarrative context"
```

---

### Task 5: Floating panel (`ActivityNarrativePanel.jsx` + `.css`)

**Files:**
- Create: `demo_api_ui/src/components/activity/ActivityNarrativePanel.jsx`
- Create: `demo_api_ui/src/components/activity/ActivityNarrativePanel.css`
- Test: `demo_api_ui/src/components/activity/__tests__/ActivityNarrativePanel.test.jsx`

**Interfaces:**
- Consumes: `useActivityNarrativeOptional()` (reads `requests`), `useDraggablePanel` (positioning), props `{ isOpen: boolean, onClose: () => void }`.
- Renders a portal dialog. Each request is a group: header line `You asked: <prompt>` plus a one-line summary when `collapsed` (`<n> steps · <status>`), or the full step list when expanded. Each step shows a status glyph (`⟳` running, `✓` done, `✕` failed) and its text. Returns `null` when `!isOpen` or no provider.

- [ ] **Step 1: Write the failing test**

Create `demo_api_ui/src/components/activity/__tests__/ActivityNarrativePanel.test.jsx`:

```jsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ActivityNarrativeProvider, useActivityNarrative } from '../../../context/ActivityNarrativeContext';
import ActivityNarrativePanel from '../ActivityNarrativePanel';
import { act } from '@testing-library/react';

function Harness() {
  const ctx = useActivityNarrative();
  // expose for the test via window
  window.__act = ctx;
  return <ActivityNarrativePanel isOpen onClose={() => {}} />;
}

describe('ActivityNarrativePanel', () => {
  it('renders nothing when closed', () => {
    const { container } = render(
      <ActivityNarrativeProvider>
        <ActivityNarrativePanel isOpen={false} onClose={() => {}} />
      </ActivityNarrativeProvider>,
    );
    expect(container.querySelector('.anp-card')).toBeNull();
  });

  it('renders the current request expanded with its steps', () => {
    render(
      <ActivityNarrativeProvider>
        <Harness />
      </ActivityNarrativeProvider>,
    );
    act(() => {
      window.__act.startRequest('check balance');
      window.__act.upsertStep({ key: 'tool:t1', text: 'Reading your balance…', status: 'running', tone: 'neutral' });
    });
    expect(screen.getByText('You asked: check balance')).toBeInTheDocument();
    expect(screen.getByText('Reading your balance…')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_api_ui && npx vitest run src/components/activity/__tests__/ActivityNarrativePanel.test.jsx`
Expected: FAIL — cannot resolve `../ActivityNarrativePanel`.

- [ ] **Step 3: Write the CSS**

Create `demo_api_ui/src/components/activity/ActivityNarrativePanel.css`:

```css
/* "What's happening" activity narration panel — plain-English demo story. */
.anp-card {
  display: flex;
  flex-direction: column;
  background: #ffffff;
  border: 1px solid #d7dce5;
  border-radius: 10px;
  box-shadow: 0 12px 32px rgba(16, 24, 40, 0.18);
  overflow: hidden;
}
.anp-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  background: linear-gradient(135deg, #1a73e8, #2b59c3);
  color: #fff;
  cursor: grab;
  user-select: none;
}
.anp-title { font-weight: 600; font-size: 13px; }
.anp-btn {
  background: rgba(255, 255, 255, 0.18);
  border: none; color: #fff; border-radius: 6px;
  width: 24px; height: 24px; cursor: pointer; font-size: 13px;
}
.anp-body { padding: 10px 12px; overflow-y: auto; flex: 1; }
.anp-request { margin-bottom: 12px; }
.anp-request-head { font-weight: 600; font-size: 12px; color: #1a2b4a; margin-bottom: 4px; }
.anp-summary { font-size: 12px; color: #475467; }
.anp-step { display: flex; gap: 8px; align-items: baseline; font-size: 13px; padding: 2px 0; color: #1a2b4a; }
.anp-step--security .anp-step-text { color: #8a4b00; }
.anp-step--error .anp-step-text { color: #b42318; }
.anp-glyph { width: 14px; text-align: center; flex: none; }
.anp-glyph--running { color: #1a73e8; }
.anp-glyph--done { color: #12805c; }
.anp-glyph--failed { color: #b42318; }
```

- [ ] **Step 4: Write the component**

Create `demo_api_ui/src/components/activity/ActivityNarrativePanel.jsx`:

```jsx
import React from 'react';
import { createPortal } from 'react-dom';
import { useDraggablePanel } from '../../hooks/useDraggablePanel';
import { useActivityNarrativeOptional } from '../../context/ActivityNarrativeContext';
import '../../styles/draggablePanel.css';
import './ActivityNarrativePanel.css';

const GLYPH = { running: '⟳', done: '✓', failed: '✕' }; // ⟳ ✓ ✕

function StepRow({ step }) {
  return (
    <div className={`anp-step anp-step--${step.tone}`}>
      <span className={`anp-glyph anp-glyph--${step.status}`} aria-hidden="true">{GLYPH[step.status]}</span>
      <span className="anp-step-text">{step.text}</span>
    </div>
  );
}

function RequestGroup({ request }) {
  const summary = `${request.steps.length} steps · ${request.status}`;
  return (
    <div className="anp-request">
      <div className="anp-request-head">You asked: {request.prompt}</div>
      {request.collapsed
        ? <div className="anp-summary">{summary}</div>
        : request.steps.map((s) => <StepRow key={s.key} step={s} />)}
    </div>
  );
}

export default function ActivityNarrativePanel({ isOpen, onClose }) {
  const ctx = useActivityNarrativeOptional();
  const { pos, size, handleDragStart, createResizeHandler } = useDraggablePanel(
    () => ({ x: Math.max(20, window.innerWidth - 540), y: Math.max(60, 80) }),
    { w: 360, h: 480 },
    { storageKey: 'anp-pos', minW: 280, minH: 200 },
  );

  if (!isOpen || !ctx) return null;

  return createPortal(
    <div
      className="anp-card"
      style={{ position: 'fixed', left: pos.x, top: pos.y, width: size.w, height: size.h, zIndex: 9979 }}
      role="dialog"
      aria-label="What's happening"
    >
      <div className="anp-header" onPointerDown={handleDragStart} title="Drag to move">
        <span className="anp-title">What's happening</span>
        <button type="button" className="anp-btn" onClick={onClose} title="Close" aria-label="Close activity panel">
          {'✕'}
        </button>
      </div>
      <div className="anp-body">
        {ctx.requests.length === 0
          ? <div className="anp-summary">The story of each request will appear here as the assistant works.</div>
          : ctx.requests.map((r) => <RequestGroup key={r.id} request={r} />)}
      </div>
      <div className="drp-resize-handles">
        <div className="drp-resize-handle drp-resize-handle--se" onMouseDown={createResizeHandler('se')} />
      </div>
    </div>,
    document.body,
  );
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd demo_api_ui && npx vitest run src/components/activity/__tests__/ActivityNarrativePanel.test.jsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add demo_api_ui/src/components/activity/ActivityNarrativePanel.jsx demo_api_ui/src/components/activity/ActivityNarrativePanel.css demo_api_ui/src/components/activity/__tests__/ActivityNarrativePanel.test.jsx
git commit -m "feat(activity): add floating What's-happening panel"
```

---

### Task 6: Mount the provider in the app tree

**Files:**
- Modify: `demo_api_ui/src/App.js` (wrap the agent subtree, near where `TokenChainProvider` is mounted in `AppWithAuth`, around lines 347–349)

**Interfaces:**
- Consumes: `ActivityNarrativeProvider` from `./context/ActivityNarrativeContext`.
- Produces: the narrative context is available to `AIAgent` (which renders inside `AppWithAuth`).

- [ ] **Step 1: Add the import**

In `demo_api_ui/src/App.js`, alongside the existing context imports, add:

```js
import { ActivityNarrativeProvider } from './context/ActivityNarrativeContext';
```

- [ ] **Step 2: Wrap the subtree**

Find where `TokenChainProvider` wraps its children in `AppWithAuth` (around line 347). Wrap the same children with `ActivityNarrativeProvider` directly inside `TokenChainProvider` so both are available to `AIAgent`:

```jsx
<TokenChainProvider activePath={/* existing prop */}>
  <ActivityNarrativeProvider>
    {/* existing children unchanged */}
  </ActivityNarrativeProvider>
</TokenChainProvider>
```

(Keep the existing `activePath` prop and children exactly as they were — only the wrapping element is added.)

- [ ] **Step 3: Verify the build compiles**

Run: `cd demo_api_ui && npm run build`
Expected: exit 0, no new errors.

- [ ] **Step 4: Commit**

```bash
git add demo_api_ui/src/App.js
git commit -m "feat(activity): mount ActivityNarrativeProvider in app tree"
```

---

### Task 7: Wire narration into AIAgent + header toggle + panel mount

**Files:**
- Modify: `demo_api_ui/src/components/AIAgent.js` — imports, flag state, `sendAsNlInner`, the `useNewItems`/effect block (near lines 1542–1559), the header toggles (near line 5902), and the panel mount (near line 8181).

**Interfaces:**
- Consumes: `useActivityNarrative()`, `reconcileToolSteps`, `authorizeDecisionToStep`, `errorStep`, `answerStep` (`../components/activity/activityNarration`), `useVertical()` (already imported, line 211), the existing `aguiState`, `useNewItems` (already imported, line 88).

- [ ] **Step 1: Add imports**

Near the other component imports in `AIAgent.js`, add:

```js
import { useActivityNarrative } from "../context/ActivityNarrativeContext";
import { reconcileToolSteps, authorizeDecisionToStep, errorStep, answerStep } from "./activity/activityNarration";
import ActivityNarrativePanel from "./activity/ActivityNarrativePanel";
```

- [ ] **Step 2: Add flag state + visibility state**

The component already fetches `/api/admin/feature-flags` (lines 1478–1488). Add a state and parse the new flag there. First add the state near the other flag states (e.g. next to `aguiEnabled`'s state):

```js
const [activityNarrationEnabled, setActivityNarrationEnabled] = useState(true);
const [showActivityPanel, setShowActivityPanel] = useState(false);
```

Then, inside the existing `.then((data) => { ... })` block at lines 1480–1487, add:

```js
const actFlag = data?.flags?.find((f) => f.id === "ff_activity_narration");
if (actFlag != null) setActivityNarrationEnabled(Boolean(actFlag.value));
```

- [ ] **Step 3: Grab the institution noun + the context**

Near the top of the component body (after the existing `useVertical()` call at line 211, and near `useAgentState` at line 568), add:

```js
const activity = useActivityNarrative();
```

Derive the institution noun where the wiring effects live (it is recomputed each render, which is fine):

```js
const activityInstitution = (pageManifest?.identity?.displayName) || 'service';
```

- [ ] **Step 4: Start a request when one is sent**

In `sendAsNlInner` (line 4323), inside the `if (aguiEnabled) { ... }` branch, right after `addMessage('user', text);` (line 4335), add:

```js
if (activityNarrationEnabled) activity.startRequest(text);
```

- [ ] **Step 5: Add the narration taps**

Immediately after the existing authorize-decision `useNewItems` block (line 1559), add a parallel block:

```js
// Activity narration — friendly per-step story (mirrors the useNewItems pattern above).
const onNewAuthorizeNarration = useCallback((newDecisions) => {
  for (const d of newDecisions) activity.upsertStep(authorizeDecisionToStep(d, activityInstitution));
}, [activity, activityInstitution]);
useNewItems(aguiState.authorizeDecisions, aguiEnabled && activityNarrationEnabled, onNewAuthorizeNarration);

// Tool calls update in place (status running→done), so reconcile on every change rather than on growth.
useEffect(() => {
  if (!(aguiEnabled && activityNarrationEnabled)) return;
  for (const step of reconcileToolSteps(aguiState.toolCalls)) activity.upsertStep(step);
}, [aguiEnabled, activityNarrationEnabled, aguiState.toolCalls, activity]);

// Error → friendly recovery step.
useEffect(() => {
  if (!(aguiEnabled && activityNarrationEnabled) || !aguiState.error) return;
  activity.upsertStep(errorStep(activityInstitution));
}, [aguiEnabled, activityNarrationEnabled, aguiState.error, activity, activityInstitution]);

// Run finished → close the story.
useEffect(() => {
  if (!(aguiEnabled && activityNarrationEnabled) || !aguiState.lastOutcome) return;
  const failed = aguiState.lastOutcome?.type === 'error';
  if (!failed) activity.upsertStep(answerStep());
  activity.finishRequest(failed ? 'failed' : 'done');
}, [aguiEnabled, activityNarrationEnabled, aguiState.lastOutcome, activity]);
```

- [ ] **Step 6: Add the header toggle**

Immediately before the existing Token Chain `Check` toggle (line 5902–5911), add a sibling toggle, gated by the flag:

```jsx
{activityNarrationEnabled && (
  <Check
    variant="switch"
    className="ba-header-toggle-label"
    checked={showActivityPanel}
    onChange={(e) => setShowActivityPanel(e.target.checked)}
    title="What's happening — plain-English story of what the assistant is doing"
  >
    What's happening
  </Check>
)}
```

- [ ] **Step 7: Mount the panel**

Next to the `TokenChainModal` mount (line 8181), add:

```jsx
<ActivityNarrativePanel
  isOpen={activityNarrationEnabled && showActivityPanel}
  onClose={() => setShowActivityPanel(false)}
/>
```

- [ ] **Step 8: Build gate**

Run: `cd demo_api_ui && npm run build`
Expected: exit 0, no errors.

- [ ] **Step 9: Manual verification (the success criteria)**

Confirm the assumption from Global Constraints before trusting the security copy: with the app running and `ff_agui_enabled` + `ff_activity_narration` on, send an agent request that triggers an authorize decision, and in the browser devtools log one `aguiState.authorizeDecisions` entry to confirm the `obligations[].type` strings match the step-up/HITL regexes (adjust `activityNarration.js` + its test fixture if not).

Then walk the demo flow and verify:
- Toggling "What's happening" in the agent header shows/hides the floating panel.
- Sending a request shows `You asked: <prompt>`, then identity + delegation lines, tool steps flipping `⟳ → ✓`, and a final "Done — here's your answer."
- A denied/step-up action shows the security-tone sentence.
- Prior requests collapse to a `<n> steps · done` summary when a new request starts.
- Setting `ff_activity_narration` to `false` in the admin flags page removes the header toggle and panel.

- [ ] **Step 10: Run the full unit suite for the new code**

Run: `cd demo_api_ui && npx vitest run src/components/activity src/context/__tests__/ActivityNarrativeContext.test.js`
Expected: all PASS.

- [ ] **Step 11: Commit**

```bash
git add demo_api_ui/src/components/AIAgent.js
git commit -m "feat(activity): wire narration panel into agent (taps, toggle, mount)"
```

---

## Self-Review Notes

- **Spec coverage:** voice/tense (Task 2/3), vertical-aware institution (Task 2 `renderTemplate` + Task 7 `activityInstitution`), hybrid source frontend-first (Tasks 3/7 derive from existing `aguiState`; backend `ACTIVITY_STEP` deferred to Phase 2), floating panel (Task 5), all four moment types — happy path (Task 3 tool/identity/answer), security decisions (Task 3 `authorizeDecisionToStep`), delegation (Task 3 `delegationStep`), errors (Task 3 `errorStep`) — accumulate + auto-collapse (Task 4), feature flag (Task 1 + Task 7 gates), header toggle (Task 7).
- **Deferred to Phase 2 (not in this plan, per spec):** backend `ACTIVITY_STEP` event + `onActivityStep` interleaving. **Phase 3 (optional):** per-step deep-link into the token panel.
- **Type consistency:** `Step` shape `{key,text,status,tone}` is identical across Tasks 3–5; `Request` shape `{id,prompt,steps,status,collapsed}` identical across Tasks 4–5; context method names (`startRequest`/`upsertStep`/`finishRequest`/`reset`) identical across Tasks 4, 7.
- **One open assumption** (obligation `type` strings) is called out in Global Constraints and verified in Task 7 Step 9 before relying on the security copy.
