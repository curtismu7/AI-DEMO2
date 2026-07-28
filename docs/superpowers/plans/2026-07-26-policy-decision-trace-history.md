# Policy Decision Trace — Last-Run History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/policy-decision-trace` shows the last policy evaluation from `localStorage` when reached without fresh router state (direct URL / refresh), instead of the current always-blank placeholder, with a once-per-session modal clarifying the data is historical.

**Architecture:** All logic lives in `PolicyDecisionTracePage.jsx` — no changes to `PingOneAuthorizePage.jsx`. On mount: if `location.state` carries a valid `{ policies, result }`, render it (as today) and persist it to `localStorage`. Otherwise, read a prior run back from `localStorage` and render that instead of the placeholder, showing a `DraggableModal` the first time this happens in the tab session (tracked via a `sessionStorage` flag).

**Tech Stack:** React 19.2, react-router-dom (`useLocation`/`useNavigate`), `DraggableModal` (existing shared component), Vitest + Testing Library.

## Global Constraints

- All modals must use `DraggableModal` — no hand-rolled overlay `<div>` (project standing rule, `demo_api_ui/CLAUDE.md`).
- Emoji allowlist only: `⚠️ ✅ ❌ 🔐 ✕ ✓ 👤 🔑 🪟 📚` — no new emoji needed for this feature.
- `npm run test:unit` and `npm run build` must both pass before the work is done (UI build gate).
- Stored payload capped at 500,000 JSON-string characters; over cap, skip the write silently (keep whatever was previously stored).
- `localStorage`/`sessionStorage` access wrapped in try/catch everywhere — never let a storage failure (quota, corrupt JSON, privacy mode) crash the page; always fall back to the existing placeholder behavior.
- No changes to `PingOneAuthorizePage.jsx`.

---

### Task 1: Persist + auto-load last run, with staleness modal

**Files:**
- Modify: `demo_api_ui/src/components/PolicyDecisionTracePage.jsx` (currently 44 lines, full file below is its replacement)
- Test: `demo_api_ui/src/components/__tests__/PolicyDecisionTracePage.test.jsx` (new file)

**Interfaces:**
- Consumes: `PolicyDecisionTree` (default export, unchanged props `{ policies, result, floating }`) from `./PolicyDecisionTree`; `DraggableModal` (default export, unchanged props) from `./DraggableModal`; `useLocation`/`useNavigate` from `react-router-dom`.
- Produces: `PolicyDecisionTracePage` default export — same zero-prop signature as today (it's a route element, no props passed by the router). No other file imports anything new from this one.

This is one task because the read path, write path, and modal are three tightly-coupled pieces of the same 44-line component — splitting them would mean re-reviewing the same file three times with no independently-shippable middle state (e.g. "write but don't read yet" isn't useful on its own).

- [ ] **Step 1: Write the failing tests**

Create `demo_api_ui/src/components/__tests__/PolicyDecisionTracePage.test.jsx`:

```jsx
// demo_api_ui/src/components/__tests__/PolicyDecisionTracePage.test.jsx
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import PolicyDecisionTracePage from '../PolicyDecisionTracePage';

let mockLocationState = null;
const mockNavigate = vi.fn();
vi.mock('react-router-dom', () => ({
  useLocation: () => ({ state: mockLocationState }),
  useNavigate: () => mockNavigate,
}));

vi.mock('../PolicyDecisionTree', () => ({
  __esModule: true,
  default: ({ policies, result }) => (
    <div data-testid="policy-decision-tree">
      {policies.length} nodes / {result.decision}
    </div>
  ),
}));

const POLICIES = [{ id: 'ps-1', kind: 'POLICY_SET', name: 'Root', children: [] }];
const RESULT = { decision: 'PERMIT', raw: { statements: [] } };
const LAST_RUN_KEY = 'policyDecisionTrace.lastRun';
const MODAL_SEEN_KEY = 'policyDecisionTrace.historyModalSeen';

beforeEach(() => {
  mockLocationState = null;
  mockNavigate.mockClear();
  localStorage.clear();
  sessionStorage.clear();
});

test('fresh nav state renders the tree and persists it to localStorage', () => {
  mockLocationState = { policies: POLICIES, result: RESULT };
  render(<PolicyDecisionTracePage />);

  expect(screen.getByTestId('policy-decision-tree')).toHaveTextContent('1 nodes / PERMIT');
  expect(screen.queryByText(/Viewing a saved decision/)).not.toBeInTheDocument();

  const stored = JSON.parse(localStorage.getItem(LAST_RUN_KEY));
  expect(stored.policies).toEqual(POLICIES);
  expect(stored.result).toEqual(RESULT);
  expect(typeof stored.savedAt).toBe('number');
});

test('no nav state but a stored run renders history and shows the staleness modal', () => {
  localStorage.setItem(LAST_RUN_KEY, JSON.stringify({ policies: POLICIES, result: RESULT, savedAt: 123 }));
  render(<PolicyDecisionTracePage />);

  expect(screen.getByTestId('policy-decision-tree')).toHaveTextContent('1 nodes / PERMIT');
  expect(screen.getByText(/Viewing a saved decision/)).toBeInTheDocument();
});

test('dismissing the modal marks it seen so it does not reopen this session', () => {
  localStorage.setItem(LAST_RUN_KEY, JSON.stringify({ policies: POLICIES, result: RESULT, savedAt: 123 }));
  const { unmount } = render(<PolicyDecisionTracePage />);
  fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
  expect(screen.queryByText(/Viewing a saved decision/)).not.toBeInTheDocument();
  expect(sessionStorage.getItem(MODAL_SEEN_KEY)).toBe('1');
  unmount();

  render(<PolicyDecisionTracePage />);
  expect(screen.queryByText(/Viewing a saved decision/)).not.toBeInTheDocument();
  expect(screen.getByTestId('policy-decision-tree')).toBeInTheDocument();
});

test('the "Go to PingOne Authorize" button navigates there and dismisses the modal', () => {
  localStorage.setItem(LAST_RUN_KEY, JSON.stringify({ policies: POLICIES, result: RESULT, savedAt: 123 }));
  render(<PolicyDecisionTracePage />);
  fireEvent.click(screen.getByRole('button', { name: 'Go to PingOne Authorize' }));
  expect(mockNavigate).toHaveBeenCalledWith('/pingone-authorize?tab=guided');
  expect(screen.queryByText(/Viewing a saved decision/)).not.toBeInTheDocument();
});

test('no nav state and no stored run shows the placeholder', () => {
  render(<PolicyDecisionTracePage />);
  expect(screen.getByText('No decision trace loaded')).toBeInTheDocument();
  expect(screen.queryByTestId('policy-decision-tree')).not.toBeInTheDocument();
});

test('corrupt stored JSON falls back to the placeholder', () => {
  localStorage.setItem(LAST_RUN_KEY, '{not valid json');
  render(<PolicyDecisionTracePage />);
  expect(screen.getByText('No decision trace loaded')).toBeInTheDocument();
});

test('an oversized payload is not written to localStorage', () => {
  const hugeResult = { decision: 'PERMIT', raw: { statements: [], big: 'x'.repeat(600_000) } };
  mockLocationState = { policies: POLICIES, result: hugeResult };
  render(<PolicyDecisionTracePage />);
  expect(localStorage.getItem(LAST_RUN_KEY)).toBeNull();
});

test('a full/blocked localStorage does not crash the page', () => {
  const setItemSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('QuotaExceededError');
  });
  mockLocationState = { policies: POLICIES, result: RESULT };
  render(<PolicyDecisionTracePage />);
  expect(screen.getByTestId('policy-decision-tree')).toHaveTextContent('1 nodes / PERMIT');
  setItemSpy.mockRestore();
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd demo_api_ui && npx vitest run src/components/__tests__/PolicyDecisionTracePage.test.jsx`
Expected: FAIL — `PolicyDecisionTracePage` doesn't yet read `localStorage`, so every historical/persistence assertion fails (e.g. "Unable to find an element with the text: Viewing a saved decision", stored value `null`).

- [ ] **Step 3: Replace `PolicyDecisionTracePage.jsx` with the full implementation**

```jsx
import React, { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import PolicyDecisionTree from './PolicyDecisionTree';
import DraggableModal from './DraggableModal';
import './PingOneMcpInspector.css';
import './KillSwitchConfirmModal.css';

// ---------------------------------------------------------------------------
// Policy Decision Trace — full-page view of the P1AZ decision path.
//
// Reached from the "Open policy decision trace" button on PingOne Authorize
// (which navigates here with { policies, result } in router state). Direct
// URL hits and page refreshes lose that router state, so this page falls
// back to the last run persisted in localStorage, with a one-time-per-tab
// modal clarifying the data may be stale.
// ---------------------------------------------------------------------------

const LAST_RUN_KEY = 'policyDecisionTrace.lastRun';
const MODAL_SEEN_KEY = 'policyDecisionTrace.historyModalSeen';
const MAX_STORED_CHARS = 500_000; // ~500KB JSON string length cap

function isValidTrace(policies, result) {
  return Array.isArray(policies) && policies.length > 0 && !!result;
}

function saveLastRun(policies, result) {
  try {
    const payload = JSON.stringify({ policies, result, savedAt: Date.now() });
    if (payload.length > MAX_STORED_CHARS) return;
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
    if (!parsed || !isValidTrace(parsed.policies, parsed.result)) return null;
    return parsed;
  } catch {
    return null; // corrupt JSON — treat as absent
  }
}

function hasSeenModalThisSession() {
  try {
    return sessionStorage.getItem(MODAL_SEEN_KEY) === '1';
  } catch {
    return false;
  }
}

function markModalSeen() {
  try {
    sessionStorage.setItem(MODAL_SEEN_KEY, '1');
  } catch {
    // ignore — worst case the modal reappears next mount
  }
}

export default function PolicyDecisionTracePage() {
  const location = useLocation();
  const navigate = useNavigate();
  const stateFromNav = location.state || {};
  const freshTrace = isValidTrace(stateFromNav.policies, stateFromNav.result);

  const [historical, setHistorical] = useState(null);
  const [showStaleModal, setShowStaleModal] = useState(false);

  useEffect(() => {
    if (freshTrace) {
      saveLastRun(stateFromNav.policies, stateFromNav.result);
      return;
    }
    const stored = loadLastRun();
    if (stored) {
      setHistorical(stored);
      if (!hasSeenModalThisSession()) {
        setShowStaleModal(true);
      }
    }
    // Intentionally mount-only: this page instance corresponds to one nav;
    // location.state doesn't change without a fresh mount of this route.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const policies = freshTrace ? stateFromNav.policies : historical?.policies;
  const result = freshTrace ? stateFromNav.result : historical?.result;
  const hasTrace = isValidTrace(policies, result);

  const savedAtLabel = useMemo(() => {
    if (!historical || freshTrace) return '';
    try {
      return new Date(historical.savedAt).toLocaleString();
    } catch {
      return '';
    }
  }, [historical, freshTrace]);

  const closeStaleModal = () => {
    setShowStaleModal(false);
    markModalSeen();
  };

  const goToAuthorize = () => {
    closeStaleModal();
    navigate('/pingone-authorize?tab=guided');
  };

  return (
    <div className="p1mcp-page">
      <div className="p1mcp-topbar">
        <h1>Policy Decision Trace</h1>
        <div className="p1mcp-topbar__right">
          <button
            className="p1mcp-topbar__btn"
            onClick={() => navigate('/pingone-authorize?tab=guided')}
          >
            Back to PingOne Authorize
          </button>
        </div>
      </div>
      {hasTrace ? (
        <div style={{ padding: '20px', overflow: 'auto', flex: 1 }}>
          <PolicyDecisionTree policies={policies} result={result} />
        </div>
      ) : (
        <div style={{ padding: '40px', textAlign: 'center', color: '#64748b', fontSize: '13px' }}>
          <p style={{ marginBottom: '8px', fontWeight: 600, color: '#0f172a' }}>No decision trace loaded</p>
          <p>Run an evaluation on PingOne Authorize, then open the trace from there.</p>
        </div>
      )}
      <DraggableModal
        isOpen={showStaleModal}
        onClose={closeStaleModal}
        title="Viewing a saved decision"
        defaultWidth={460}
        defaultHeight={280}
        storageKey="policy-decision-stale-modal"
        minWidth={360}
        minHeight={220}
        footer={
          <>
            <button className="dm-close-btn" onClick={closeStaleModal} type="button">
              Dismiss
            </button>
            <button className="ksm-confirm-btn" onClick={goToAuthorize} type="button">
              Go to PingOne Authorize
            </button>
          </>
        }
      >
        <div className="dm-scroll">
          <p>
            You&apos;re viewing your last policy evaluation from PingOne Authorize,
            saved {savedAtLabel}. This may not reflect the current policy
            configuration.
          </p>
        </div>
      </DraggableModal>
    </div>
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd demo_api_ui && npx vitest run src/components/__tests__/PolicyDecisionTracePage.test.jsx`
Expected: PASS — all 8 tests green.

- [ ] **Step 5: Run the full unit suite and the build gate**

Run: `cd demo_api_ui && npm run test:unit && npm run build`
Expected: both exit 0. `test:unit` must stay green for every pre-existing suite too (this task touches no other file, so no regression is expected, but this is the project's required gate before calling any UI change done).

- [ ] **Step 6: Commit**

```bash
git add demo_api_ui/src/components/PolicyDecisionTracePage.jsx demo_api_ui/src/components/__tests__/PolicyDecisionTracePage.test.jsx
git commit -m "$(cat <<'EOF'
feat(ui): auto-load last policy decision trace from localStorage

/policy-decision-trace only rendered when reached via a fresh
navigate() with router state, so a direct URL hit or refresh always
fell back to the blank placeholder even right after evaluating. Now
it persists the last run to localStorage and reloads it when there is
no fresh state, with a once-per-tab-session modal clarifying the data
may be stale.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Post-plan verification

- [ ] Manual live check (per the spec's test plan): run an Evaluate on `/pingone-authorize`, open the trace, refresh the trace page directly — tree + modal appear; dismiss modal, refresh again — tree appears without the modal (same tab session).
- [ ] Confirm `REGRESSION_PLAN.md` §0 emoji allowlist is respected (no new emoji added) and the modal is `DraggableModal`-based, per `.claude/skills/regression-guard/`.
