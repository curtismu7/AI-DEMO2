# Agent Lifecycle — Live Agent + Token Chain Rail Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure `/agent-lifecycle` into a two-column layout — the four
existing slots on the left, a persistent real `<AIAgent>` widget + live
`<TokenChainTraceRail/>` on the right — so a viewer can watch the agent and
its token chain update live while working through the four steps, matching
the existing `/use-cases/live` page format.

**Architecture:** Reuse the exact mechanism `LiveUseCaseWorkbenchPage.js`
already uses: `useAgentUiMode()`'s `setSurfaceHostEl(el)` registers a DOM
node that the app's single singleton `<AIAgent>` (rendered once near the
top of `App.js`, already portal-based via `createPortal`) portals itself
into. No new agent instance, no new provider, no backend changes — purely a
`AgentLifecyclePage.jsx` + `AgentLifecyclePage.css` restructure, plus the
matching test updates.

**Tech Stack:** React (no hooks destructured — file uses `React.useX`
throughout, matching existing convention), Vitest + Testing Library.

## Global Constraints

- No backend/route changes (per spec: this follow-up is UI-only).
- Do not modify `killSwitchService.js`, `LiveUseCaseWorkbenchPage.js`, or
  `AgentUiModeContext.js` — reuse only, per spec's non-goals.
- Follow the file's existing convention of `React.useState`/`React.useEffect`/
  `React.useCallback` (no destructured hook imports) — don't mix styles
  within one file.
- Emoji allowlist only (REGRESSION_PLAN §0): `⚠️ ✅ ❌ 🔐 ✕ ✓ 👤 🔑 🪟 📚` — n/a
  here, no emoji added.

---

## File Structure

- Modify: `demo_api_ui/src/pages/AgentLifecyclePage.jsx` — remove the inline
  `<TokenChainTraceRail/>` from `ScopedCallSlot`; wrap the four slots in a
  left column; add a right column that registers the agent surface host and
  hosts the persistent rail.
- Modify: `demo_api_ui/src/pages/AgentLifecyclePage.css` — replace the
  single-column `.alp-wrap` rule with a two-column flex layout; add
  `.alp-body`, `.alp-slots`, `.alp-run-layout`, `.alp-agent-host`,
  `.alp-rail-host` (naming mirrors `LiveUseCaseWorkbenchPage.css`'s
  `.luw-run-layout`/`.luw-agent-host`/`.luw-rail-host`).
- Modify: `demo_api_ui/src/pages/__tests__/AgentLifecyclePage.test.jsx` —
  mock `AgentUiModeContext`, assert `setSurfaceHostEl` is called on mount
  and the rail renders on initial load (not just after a slot-2 click).

---

### Task 1: Right-side persistent Agent + Token Chain rail

**Files:**
- Modify: `demo_api_ui/src/pages/AgentLifecyclePage.jsx`
- Modify: `demo_api_ui/src/pages/AgentLifecyclePage.css`
- Test: `demo_api_ui/src/pages/__tests__/AgentLifecyclePage.test.jsx`

**Interfaces:**
- Consumes: `useAgentUiMode()` from `../context/AgentUiModeContext`
  (existing, unchanged) — returns `{ setSurfaceHostEl: (el) => void, ... }`.
  Calling `setSurfaceHostEl(domNode)` makes the app's singleton `<AIAgent>`
  portal into `domNode`; calling it with `null` (or the current cleanup
  pattern below) releases the host so another page can claim it.
- Produces: no new exports — `AgentLifecyclePage` default export keeps the
  same signature (no props), same route (`/agent-lifecycle`), same four
  named slot components internally.

- [ ] **Step 1: Write the failing tests**

Replace the full contents of
`demo_api_ui/src/pages/__tests__/AgentLifecyclePage.test.jsx` with:

```jsx
import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import AgentLifecyclePage from '../AgentLifecyclePage';

vi.mock('../AgentLifecyclePage.css', () => ({}), { virtual: true });
vi.mock('../../services/demoAgentService', () => ({
  callMcpTool: vi.fn(),
}));
vi.mock('../../components/TokenChainTraceRail', () => ({
  default: () => <div data-testid="trace-rail" />,
}));
vi.mock('../../services/controlPlaneApi', () => ({
  getAgents: vi.fn(),
}));
vi.mock('../../services/apiClient', () => ({
  default: { post: vi.fn() },
}));
vi.mock('../../components/KillSwitchConfirmModal', () => ({
  default: ({ isOpen, agentId, onConfirm }) =>
    isOpen ? (
      <button onClick={() => onConfirm(agentId, 'test reason')}>
        ConfirmRevoke
      </button>
    ) : null,
}));
const mockSetSurfaceHostEl = vi.fn();
vi.mock('../../context/AgentUiModeContext', () => ({
  useAgentUiMode: () => ({ setSurfaceHostEl: mockSetSurfaceHostEl }),
}));

import { callMcpTool } from '../../services/demoAgentService';
import { getAgents } from '../../services/controlPlaneApi';
import apiClient from '../../services/apiClient';
import { fireEvent, waitFor } from '@testing-library/react';

// RevokeSlot mounts alongside every other slot and calls getAgents() on
// mount, so every test in this file renders it — give it a safe default
// resolution here; Slot 4's own beforeEach overrides this per-test.
beforeEach(() => {
  getAgents.mockResolvedValue({ live: { id: 'demo-agent' }, demo: [] });
  mockSetSurfaceHostEl.mockClear();
});

describe('AgentLifecyclePage', () => {
  it('renders the title and the registration video slot', () => {
    render(<AgentLifecyclePage />);
    expect(screen.getByText('Agent Lifecycle')).toBeInTheDocument();
    expect(
      screen.getByText(/1\. Register agent \+ scoped consent/),
    ).toBeInTheDocument();
    const video = screen.getByLabelText(
      'Agent registration and consent walkthrough',
    );
    expect(video).toHaveAttribute(
      'src',
      '/media/contractor-lcm-ai-agent.mp4',
    );
  });

  it('registers the agent surface host and renders the persistent rail on load', () => {
    render(<AgentLifecyclePage />);
    expect(screen.getByTestId('trace-rail')).toBeInTheDocument();
    expect(mockSetSurfaceHostEl).toHaveBeenCalled();
    const registeredEl = mockSetSurfaceHostEl.mock.calls
      .map(([el]) => el)
      .find((el) => el);
    expect(registeredEl).toBeInstanceOf(HTMLElement);
    expect(registeredEl).toHaveClass('alp-agent-host');
  });
});

describe('AgentLifecyclePage — Slot 2 scoped MCP call', () => {
  beforeEach(() => {
    callMcpTool.mockReset();
    // Suppress unhandled rejection warnings in this test suite
    vi.stubGlobal('onunhandledrejection', (event) => {
      event.preventDefault();
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('calls list_orders as the agent and renders the result', async () => {
    callMcpTool.mockResolvedValue({
      result: {
        content: [
          { type: 'text', text: JSON.stringify({ orders: [{ id: 'o1' }] }) },
        ],
      },
      tokenEvents: [],
    });
    render(<AgentLifecyclePage />);
    fireEvent.click(screen.getByText('Call list_orders as agent'));
    await waitFor(() =>
      expect(screen.getByText(/"id": "o1"/)).toBeInTheDocument(),
    );
    expect(callMcpTool).toHaveBeenCalledWith(
      'list_orders',
      {},
      { vertical: 'retail' },
    );
    expect(screen.getByTestId('trace-rail')).toBeInTheDocument();
  });

  it('shows an error message when the call fails', async () => {
    callMcpTool.mockRejectedValue(new Error('boom'));
    render(<AgentLifecyclePage />);
    fireEvent.click(screen.getByText('Call list_orders as agent'));
    await waitFor(() => expect(screen.getByText('boom')).toBeInTheDocument());
  });
});

describe('AgentLifecyclePage — Slot 3 step-up on purchase', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => {
    vi.useRealTimers();
    delete global.fetch;
  });

  it('walks checkout -> CIBA pending -> approved -> retried checkout', async () => {
    let pollCount = 0;
    global.fetch = vi.fn((url, opts) => {
      if (url === '/api/mcp/tool') {
        const body = JSON.parse(opts.body);
        if (body.tool !== 'checkout') return Promise.reject(new Error('unexpected tool'));
        // First call: step-up required. Second call (post-approval retry): success.
        if (pollCount === 0) {
          return Promise.resolve({
            status: 428,
            ok: false,
            json: () => Promise.resolve({
              error: 'mcp_step_up_required',
              step_up_method: 'ciba',
            }),
          });
        }
        return Promise.resolve({
          status: 200,
          ok: true,
          json: () => Promise.resolve({ result: { content: [{ type: 'text', text: '{}' }] } }),
        });
      }
      if (url === '/api/auth/ciba/initiate') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ auth_req_id: 'req-1', interval: 1 }),
        });
      }
      if (url === '/api/auth/ciba/poll/req-1') {
        pollCount += 1;
        return Promise.resolve({
          status: 200,
          json: () => Promise.resolve(
            pollCount < 2 ? { status: 'pending' } : { status: 'approved' },
          ),
        });
      }
      return Promise.reject(new Error(`unhandled fetch: ${url}`));
    });

    render(<AgentLifecyclePage />);
    fireEvent.click(screen.getByText('Checkout $600 headphones'));

    await waitFor(() =>
      expect(screen.getByText(/Waiting for push approval/)).toBeInTheDocument(),
    );

    await vi.advanceTimersByTimeAsync(1000); // first poll: pending
    await vi.advanceTimersByTimeAsync(1000); // second poll: approved -> retry

    await waitFor(() =>
      expect(screen.getByText('Checkout completed.')).toBeInTheDocument(),
    );
  });

  it('surfaces an error instead of hanging when checkout rejects', async () => {
    global.fetch = vi.fn(() => Promise.reject(new Error('network down')));

    render(<AgentLifecyclePage />);
    fireEvent.click(screen.getByText('Checkout $600 headphones'));

    await waitFor(() =>
      expect(screen.getByText('network down')).toBeInTheDocument(),
    );
    expect(screen.getByText('Checkout $600 headphones')).toBeEnabled();
  });
});

describe('AgentLifecyclePage — Slot 4 self-service revoke', () => {
  beforeEach(() => {
    getAgents.mockReset().mockResolvedValue({ live: { id: 'demo-agent' }, demo: [] });
    apiClient.post.mockReset().mockResolvedValue({ data: {} });
    callMcpTool.mockReset();
  });

  it('revokes via the kill-switch endpoint and proves the retry fails', async () => {
    callMcpTool.mockRejectedValue(new Error('token revoked'));
    render(<AgentLifecyclePage />);

    await waitFor(() => expect(screen.getByText('Revoke agent access')).toBeEnabled());
    fireEvent.click(screen.getByText('Revoke agent access'));
    fireEvent.click(screen.getByText('ConfirmRevoke'));

    await waitFor(() =>
      expect(apiClient.post).toHaveBeenCalledWith(
        '/api/admin/agent/demo-agent/kill-switch',
        { reason: 'test reason' },
      ),
    );
    await waitFor(() =>
      expect(screen.getByText(/Confirmed revoked — retry failed: token revoked/)).toBeInTheDocument(),
    );
    expect(screen.getByText('View audit trail →')).toHaveAttribute(
      'href',
      '/audit?agentId=demo-agent',
    );
  });
});
```

The only changes from the current file: the new `mockSetSurfaceHostEl` +
`vi.mock('../../context/AgentUiModeContext', ...)` block, `mockSetSurfaceHostEl.mockClear()`
in the top `beforeEach`, and the new
`'registers the agent surface host and renders the persistent rail on load'`
test. Everything else is byte-for-byte the existing file (so the other four
describe blocks keep passing unmodified against the new component).

- [ ] **Step 2: Run the tests to verify the new one fails**

```bash
cd demo_api_ui && npx vitest run src/pages/__tests__/AgentLifecyclePage.test.jsx
```

Expected: the new `'registers the agent surface host...'` test FAILS with
`mockSetSurfaceHostEl` not called (component doesn't call `useAgentUiMode()`
yet) — every other test still PASSES unchanged.

- [ ] **Step 3: Implement — remove the inline rail from Slot 2**

In `demo_api_ui/src/pages/AgentLifecyclePage.jsx`, remove the closing
`<TokenChainTraceRail />` line from `ScopedCallSlot`'s JSX (it currently
sits right before the closing `</section>`, after the `alp-error` block):

```jsx
      {status === 'error' && <p className="alp-error">{error}</p>}
    </section>
  );
}
```

(i.e. delete the `<TokenChainTraceRail />` line that was between
`{status === 'error' && ...}` and `</section>`.)

- [ ] **Step 4: Implement — add the right-column agent + rail host**

Add the import and replace the default export at the bottom of
`demo_api_ui/src/pages/AgentLifecyclePage.jsx`:

```jsx
import { useAgentUiMode } from '../context/AgentUiModeContext';
```

(add alongside the existing imports at the top of the file, after the
`KillSwitchConfirmModal` import)

```jsx
export default function AgentLifecyclePage() {
  const { setSurfaceHostEl } = useAgentUiMode();
  const [agentHostEl, setAgentHostEl] = React.useState(null);
  const agentHostRef = React.useCallback((node) => setAgentHostEl(node), []);

  React.useEffect(() => {
    setSurfaceHostEl(agentHostEl);
    return () => setSurfaceHostEl((cur) => (cur === agentHostEl ? null : cur));
  }, [agentHostEl, setSurfaceHostEl]);

  return (
    <div className="alp-wrap">
      <h1 className="alp-title">Agent Lifecycle</h1>
      <p className="alp-subtitle">
        Register, call, step up, and revoke — one AI agent's full access
        lifecycle end to end.
      </p>
      <div className="alp-body">
        <div className="alp-slots">
          <RegistrationSlot />
          <ScopedCallSlot />
          <StepUpSlot />
          <RevokeSlot />
        </div>
        <div className="alp-run-layout">
          <div className="alp-agent-host" ref={agentHostRef} />
          <div className="alp-rail-host">
            <TokenChainTraceRail />
          </div>
        </div>
      </div>
    </div>
  );
}
```

This is the same mount/cleanup pattern `LiveUseCaseWorkbenchPage.js` uses
(`setSurfaceHostEl(agentHostEl)` on change, release-if-still-mine on
cleanup) — copied verbatim so behavior matches an already-proven page.

- [ ] **Step 5: Implement — two-column CSS**

Replace the full contents of `demo_api_ui/src/pages/AgentLifecyclePage.css`
with:

```css
.alp-wrap {
  max-width: 1400px;
  margin: 0 auto;
  padding: 48px 24px 80px;
  background: #fff;
  color: #1a1a1a;
  font-family: Helvetica, Arial, sans-serif;
}
.alp-title {
  font-size: 32px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  margin-bottom: 8px;
}
.alp-subtitle {
  color: #555;
  margin-bottom: 40px;
  font-size: 15px;
}
.alp-body { display: flex; gap: 2rem; align-items: flex-start; flex-wrap: wrap; }
.alp-slots { flex: 1 1 480px; min-width: 320px; max-width: 640px; }
.alp-run-layout {
  flex: 1 1 380px;
  min-width: 320px;
  display: flex;
  flex-direction: column;
  gap: 1rem;
  position: sticky;
  top: 24px;
}
.alp-agent-host { overflow: visible; }
.alp-rail-host { min-width: 0; }
.alp-slot {
  border-top: 1px solid #1a1a1a;
  padding: 32px 0;
  margin-bottom: 0;
}
.alp-slot__title {
  font-size: 15px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  margin-bottom: 10px;
}
.alp-slot__desc { color: #555; margin-bottom: 16px; font-size: 14px; line-height: 1.5; }
.alp-slot__status { margin-top: 14px; font-size: 14px; }
.alp-video { width: 100%; display: block; }
.alp-btn {
  background: #1a1a1a;
  color: #fff;
  border: none;
  padding: 14px 28px;
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  cursor: pointer;
}
.alp-btn:disabled { background: #999; cursor: not-allowed; }
.alp-result {
  background: #f7f6f4;
  padding: 16px;
  overflow-x: auto;
  font-size: 13px;
  margin-top: 16px;
}
.alp-error { color: #b3261e; margin-top: 10px; font-size: 14px; }
.alp-audit-link {
  display: inline-block;
  margin-top: 16px;
  color: #1a1a1a;
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  text-decoration: underline;
}
```

(Only `.alp-wrap`'s `max-width` changed from `1040px` to `1400px`, and
`.alp-body`/`.alp-slots`/`.alp-run-layout`/`.alp-agent-host`/`.alp-rail-host`
are new — every other rule is unchanged from the current file.)

- [ ] **Step 6: Run the tests to verify they pass**

```bash
cd demo_api_ui && npx vitest run src/pages/__tests__/AgentLifecyclePage.test.jsx
```

Expected: all tests PASS (the pre-existing five plus the new one).

- [ ] **Step 7: Live-verify in the running stack**

Per the `verify`/`webapp-testing` skills — log in as `demoUser`
(`DEMO_USER_USERNAME`/`DEMO_USER_PASSWORD` in `demo_api_server/.env`)
against `https://local.ping-devops.com:4000`, navigate to
`/agent-lifecycle`, and confirm:
1. The real `<AIAgent>` widget renders in the right column (not just an
   empty `.alp-agent-host` div).
2. `<TokenChainTraceRail/>` renders in the right column, persistent across
   all four slots (not just visible after clicking slot 2).
3. Clicking "Call list_orders as agent" (slot 2) updates the rail live in
   the right column with the 12-step pipeline (the PingOne "Demo AI App -
   AI Agent Actor" app was already re-enabled live during design — confirm
   it's still enabled; if `502`/`actor_token_invalid` reappears, that's the
   same app disabled again, not a regression in this change).
4. Page layout: slots on the left, agent + rail on the right, both columns
   visible without horizontal scroll at a normal desktop width (~1400px+).

- [ ] **Step 8: Commit**

```bash
cd demo_api_ui && git add src/pages/AgentLifecyclePage.jsx src/pages/AgentLifecyclePage.css src/pages/__tests__/AgentLifecyclePage.test.jsx
git commit -m "feat(agent-lifecycle): move Agent + Token Chain rail to a persistent right column"
```

---

## Verification Checklist (maps to spec Revision 2)

- [x] Slot 2's 502 root-caused and fixed live (PingOne app re-enabled) —
  already done during design, no code task needed.
- [ ] Left column: four slots, unchanged logic (Task 1, Steps 3-4).
- [ ] Right column: persistent real `<AIAgent>` + `<TokenChainTraceRail/>`,
  visible across all slots (Task 1, Steps 4-5, verified Step 7).
- [ ] Inline rail removed from slot 2 (Task 1, Step 3).
- [ ] No backend changes (confirmed — plan touches only 3 frontend files).
