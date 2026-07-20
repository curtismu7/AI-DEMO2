# Agent Lifecycle Demo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build one page, `/agent-lifecycle`, that shows an AI agent's full
access lifecycle in the retail vertical: a pre-recorded registration+consent
video, a live scoped MCP call, a live CIBA step-up on a purchase, and a live
self-service revoke that proves the token dies immediately and an audit
entry is created.

**Architecture:** Pure frontend composition. Every capability except
registration already runs end-to-end through existing backend routes
(`POST /api/mcp/tool`, `POST /api/auth/ciba/initiate`+`poll`,
`POST /api/admin/agent/:agentId/kill-switch`, `GET /api/mcp/audit`) — this
page calls them directly instead of through the chat UI. Registration has no
backend equivalent anywhere in the repo, so it's a static video instead.

**Tech Stack:** React (demo_api_ui), Vitest + React Testing Library for unit
tests, existing `apiClient`/`demoAgentService`/`controlPlaneApi` service
modules.

**Visual design:** modeled after abercrombie.com/shop/us/new's homepage —
minimalist luxury retail: white background, black nav/accent, generous
whitespace, bold uppercase tracked headings, solid-black CTA buttons with
white uppercase text. Baked into Task 3's CSS and the `alp-btn` class used by
every action button in Tasks 4–6.

## Global Constraints

- Emoji allowlist only (`REGRESSION_PLAN.md` §0): `⚠️` `✅` `❌` `🔐` `✕` `✓`
  `👤` `🔑` `🪟` `📚`. No other emoji anywhere in new UI copy.
- `AuditPage.js` is a protected UI area per `REGRESSION_PLAN.md` §1 — its
  change here is additive-only (new optional query-param seed), must not
  alter existing behavior when the param is absent.
- No new backend routes. If a task seems to need one, stop — that means a
  wrong assumption slipped in; re-check the spec's "Existing coverage" table.
- Test runner: `cd demo_api_ui && npx vitest run <path>` (Vitest, not Jest,
  despite some files using `jest.fn()` as a compat alias — mirror whichever
  alias the file being edited already uses).

---

### Task 1: Copy the registration walkthrough video asset

**Files:**
- Create: `demo_api_ui/public/media/contractor-lcm-ai-agent.mp4`

**Interfaces:**
- Produces: a static asset served at `/media/contractor-lcm-ai-agent.mp4` by
  the existing dev server / build (anything under `demo_api_ui/public/` is
  served at the site root unchanged) — Task 3's `<video>` element consumes
  this URL.

- [ ] **Step 1: Create the media directory and copy the file**

```bash
mkdir -p demo_api_ui/public/media
cp "/Users/cmuir/Desktop/A&F demo/Contractor_LCM_AI_Agent.mp4" \
   demo_api_ui/public/media/contractor-lcm-ai-agent.mp4
```

- [ ] **Step 2: Verify the copy**

Run: `ls -lh demo_api_ui/public/media/contractor-lcm-ai-agent.mp4`
Expected: a file ~70.7M in size (matches the source file's size — confirms a
full, non-truncated copy).

- [ ] **Step 3: Commit**

```bash
git add demo_api_ui/public/media/contractor-lcm-ai-agent.mp4
git commit -m "$(cat <<'EOF'
feat(agent-lifecycle): add registration walkthrough video asset

Real per-agent PingOne registration doesn't exist in the repo yet;
this pre-recorded walkthrough stands in for it on the new
agent-lifecycle demo page (see docs/superpowers/specs/
2026-07-20-agent-lifecycle-demo-design.md).
EOF
)"
```

Note: this permanently adds ~71MB to git history — confirmed with the user
before this task was written.

---

### Task 2: `AuditPage.js` — seed agent filter from the `agentId` query param

**Files:**
- Modify: `demo_api_ui/src/components/AuditPage.js:119`
- Test: `demo_api_ui/src/components/__tests__/AuditPage.test.jsx`

**Interfaces:**
- Consumes: nothing new — `useSearchParams()` is already imported and used
  at `AuditPage.js:110-111` for the `popout` param.
- Produces: `filterAgentId`'s initial value is now `agentId` query-string
  param if present, else `''` (unchanged default) — Task 6's deep-link
  (`/audit?agentId=demo-agent`) relies on this.

- [ ] **Step 1: Write the failing test**

Add to `demo_api_ui/src/components/__tests__/AuditPage.test.jsx` (new
`describe` block; the existing file already mocks `useSearchParams` to
return `[new URLSearchParams("")]` at module scope for its other tests —
this new block overrides that mock locally with `vi.mocked`):

```jsx
describe("AuditPage — agentId query-param seeding", () => {
  it("seeds the agent filter and includes it in the initial fetch", async () => {
    const { useSearchParams } = require("react-router-dom");
    useSearchParams.mockReturnValue([new URLSearchParams("agentId=demo-agent")]);

    await renderSettled({ onClose: jest.fn() });

    const calledWithAgentId = global.fetch.mock.calls.some(
      ([url]) => typeof url === "string" && url.includes("agentId=demo-agent"),
    );
    expect(calledWithAgentId).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd demo_api_ui && npx vitest run src/components/__tests__/AuditPage.test.jsx -t "seeds the agent filter"`
Expected: FAIL — no call to `global.fetch` includes `agentId=demo-agent`
(current `filterAgentId` initial state is always `''`).

- [ ] **Step 3: Implement**

In `demo_api_ui/src/components/AuditPage.js`, change line 119:

```js
// before
const [filterAgentId, setFilterAgentId] = useState('');
// after
const [filterAgentId, setFilterAgentId] = useState(() => searchParams.get('agentId') || '');
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd demo_api_ui && npx vitest run src/components/__tests__/AuditPage.test.jsx`
Expected: PASS — all tests in the file, including the pre-existing
title-bar-drag tests (confirms the change didn't break them).

- [ ] **Step 5: Commit**

```bash
git add demo_api_ui/src/components/AuditPage.js demo_api_ui/src/components/__tests__/AuditPage.test.jsx
git commit -m "$(cat <<'EOF'
feat(audit): seed agent filter from agentId query param

Lets a deep link (e.g. /audit?agentId=demo-agent) pre-filter the
audit trail without the user re-selecting it manually. Additive
only — absent param keeps the existing default ('') behavior.
EOF
)"
```

---

### Task 3: `AgentLifecyclePage` skeleton, Slot 1 (video), routing + nav

**Files:**
- Create: `demo_api_ui/src/pages/AgentLifecyclePage.jsx`
- Create: `demo_api_ui/src/pages/AgentLifecyclePage.css`
- Create: `demo_api_ui/src/pages/__tests__/AgentLifecyclePage.test.jsx`
- Modify: `demo_api_ui/src/App.js` (import + route)
- Modify: `demo_api_ui/src/components/AdminSideNav.jsx` (nav entry)

**Interfaces:**
- Consumes: Task 1's `/media/contractor-lcm-ai-agent.mp4` asset.
- Produces: default export `AgentLifecyclePage` (no required props), route
  `/agent-lifecycle`. Later tasks (4–6) add sibling slot components and
  render them inside this same file's top-level `<div className="alp-wrap">`.

- [ ] **Step 1: Write the failing test**

`demo_api_ui/src/pages/__tests__/AgentLifecyclePage.test.jsx`:

```jsx
import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import AgentLifecyclePage from '../AgentLifecyclePage';

vi.mock('../AgentLifecyclePage.css', () => ({}), { virtual: true });

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
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd demo_api_ui && npx vitest run src/pages/__tests__/AgentLifecyclePage.test.jsx`
Expected: FAIL — `Cannot find module '../AgentLifecyclePage'`.

- [ ] **Step 3: Implement the skeleton + Slot 1**

`demo_api_ui/src/pages/AgentLifecyclePage.jsx`:

```jsx
import React from 'react';
import './AgentLifecyclePage.css';

function RegistrationSlot() {
  return (
    <section className="alp-slot alp-slot--video">
      <h2 className="alp-slot__title">1. Register agent + scoped consent</h2>
      <p className="alp-slot__desc">
        A user registers an AI agent and delegates account access via a
        scoped consent screen. Recorded walkthrough (live registration isn't
        built yet):
      </p>
      <video
        className="alp-video"
        src="/media/contractor-lcm-ai-agent.mp4"
        controls
        aria-label="Agent registration and consent walkthrough"
      />
    </section>
  );
}

export default function AgentLifecyclePage() {
  return (
    <div className="alp-wrap">
      <h1 className="alp-title">Agent Lifecycle</h1>
      <p className="alp-subtitle">
        Register, call, step up, and revoke — one AI agent's full access
        lifecycle end to end.
      </p>
      <RegistrationSlot />
    </div>
  );
}
```

`demo_api_ui/src/pages/AgentLifecyclePage.css` — modeled after
abercrombie.com's homepage aesthetic (minimalist luxury retail: white/off-
white background, black nav/accent, generous whitespace, bold uppercase
tracked headings, solid-black CTA buttons with white uppercase text):

```css
.alp-wrap {
  max-width: 1040px;
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

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd demo_api_ui && npx vitest run src/pages/__tests__/AgentLifecyclePage.test.jsx`
Expected: PASS.

- [ ] **Step 5: Wire the route in `App.js`**

Add the import near the existing `DelegationPage` import
(`demo_api_ui/src/App.js:47`):

```js
// after: import DelegationPage from "./components/DelegationPage";
import AgentLifecyclePage from "./pages/AgentLifecyclePage";
```

Add the route immediately after the existing `/delegation` route
(`demo_api_ui/src/App.js:1262-1274`):

```jsx
                            <Route
                              path="/delegation"
                              element={
                                user ? (
                                  <DelegationPage
                                    user={user}
                                    onLogout={logout}
                                  />
                                ) : (
                                  <Navigate to="/" replace />
                                )
                              }
                            />
                            <Route
                              path="/agent-lifecycle"
                              element={
                                user ? (
                                  <AgentLifecyclePage />
                                ) : (
                                  <Navigate to="/" replace />
                                )
                              }
                            />
```

- [ ] **Step 6: Add the nav entry in `AdminSideNav.jsx`**

Add immediately after the existing "Family Delegation" entry
(`demo_api_ui/src/components/AdminSideNav.jsx:440-445`):

```js
    {
      label: "Family Delegation",
      path: "/delegation",
      icon: "usr",
      customerOnly: true,
    },
    {
      label: "Agent Lifecycle",
      path: "/agent-lifecycle",
      icon: "agt",
      customerOnly: true,
    },
```

- [ ] **Step 7: Manual verification**

Run the local stack (`./run-docker.sh` or existing dev workflow), log in,
navigate to `/agent-lifecycle` directly and via the new nav entry. Confirm
the page renders and the video plays.

- [ ] **Step 8: Commit**

```bash
git add demo_api_ui/src/pages/AgentLifecyclePage.jsx \
        demo_api_ui/src/pages/AgentLifecyclePage.css \
        demo_api_ui/src/pages/__tests__/AgentLifecyclePage.test.jsx \
        demo_api_ui/src/App.js \
        demo_api_ui/src/components/AdminSideNav.jsx
git commit -m "$(cat <<'EOF'
feat(agent-lifecycle): add page skeleton, video slot, routing + nav

/agent-lifecycle mirrors the /delegation route/nav pattern. Slot 1
(register + consent) is the pre-recorded video from the previous
commit; slots 2-4 land in follow-up commits.
EOF
)"
```

---

### Task 4: Slot 2 — scoped MCP call

**Files:**
- Modify: `demo_api_ui/src/pages/AgentLifecyclePage.jsx`
- Modify: `demo_api_ui/src/pages/__tests__/AgentLifecyclePage.test.jsx`

**Interfaces:**
- Consumes: `callMcpTool(tool, params, opts)` from
  `demo_api_ui/src/services/demoAgentService.js` (existing, signature
  `(tool: string, params = {}, { vertical, useCaseId, signal, onTokenEvent } = {}) => Promise<{ result, tokenEvents }>`,
  resolves on success, throws `Error` with `.code`/`.statusCode` on failure).
  `TokenChainTraceRail` (default export, no required props) from
  `demo_api_ui/src/components/TokenChainTraceRail.jsx`.
- Produces: nothing new consumed by later tasks — Slot 2 is self-contained.

- [ ] **Step 1: Write the failing test**

Add to `demo_api_ui/src/pages/__tests__/AgentLifecyclePage.test.jsx` (top of
file, alongside the existing mocks):

```jsx
vi.mock('../../services/demoAgentService', () => ({
  callMcpTool: vi.fn(),
}));
vi.mock('../../components/TokenChainTraceRail', () => ({
  default: () => <div data-testid="trace-rail" />,
}));

import { callMcpTool } from '../../services/demoAgentService';
import { fireEvent, waitFor } from '@testing-library/react';
```

New test:

```jsx
describe('AgentLifecyclePage — Slot 2 scoped MCP call', () => {
  beforeEach(() => callMcpTool.mockReset());

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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd demo_api_ui && npx vitest run src/pages/__tests__/AgentLifecyclePage.test.jsx -t "Slot 2"`
Expected: FAIL — `Unable to find an element with the text: Call list_orders as agent`.

- [ ] **Step 3: Implement `ScopedCallSlot`**

In `demo_api_ui/src/pages/AgentLifecyclePage.jsx`, add imports and the new
component, and render it after `<RegistrationSlot />`:

```jsx
import React from 'react';
import './AgentLifecyclePage.css';
import { callMcpTool } from '../services/demoAgentService';
import TokenChainTraceRail from '../components/TokenChainTraceRail';

// ...RegistrationSlot unchanged...

function ScopedCallSlot() {
  const [status, setStatus] = React.useState('idle'); // idle | loading | done | error
  const [orders, setOrders] = React.useState(null);
  const [error, setError] = React.useState(null);

  const run = React.useCallback(async () => {
    setStatus('loading');
    setError(null);
    try {
      const { result } = await callMcpTool('list_orders', {}, { vertical: 'retail' });
      const text = result?.content?.[0]?.text;
      const parsed = text ? JSON.parse(text) : result;
      setOrders(parsed?.orders ?? parsed ?? []);
      setStatus('done');
    } catch (err) {
      setError(err.message || 'Call failed');
      setStatus('error');
    }
  }, []);

  return (
    <section className="alp-slot">
      <h2 className="alp-slot__title">2. Agent calls MCP with a scoped, revocable token</h2>
      <p className="alp-slot__desc">
        Calls the retail <code>list_orders</code> tool through the same RFC
        8693 token-exchange + gateway path every chip click uses.
      </p>
      <button className="alp-btn" type="button" onClick={run} disabled={status === 'loading'}>
        {status === 'loading' ? 'Calling…' : 'Call list_orders as agent'}
      </button>
      {status === 'done' && (
        <pre className="alp-result">{JSON.stringify(orders, null, 2)}</pre>
      )}
      {status === 'error' && <p className="alp-error">{error}</p>}
      <TokenChainTraceRail />
    </section>
  );
}

export default function AgentLifecyclePage() {
  return (
    <div className="alp-wrap">
      <h1 className="alp-title">Agent Lifecycle</h1>
      <p className="alp-subtitle">
        Register, call, step up, and revoke — one AI agent's full access
        lifecycle end to end.
      </p>
      <RegistrationSlot />
      <ScopedCallSlot />
    </div>
  );
}
```

Note on the `list_orders` result shape: `parsed?.orders ?? parsed ?? []`
defensively handles both a `{orders:[...]}` object and (if the wire shape
turns out flatter than expected) an already-unwrapped value — confirm the
actual shape in Step 5's live check and simplify this line if it turns out
one form never occurs.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd demo_api_ui && npx vitest run src/pages/__tests__/AgentLifecyclePage.test.jsx`
Expected: PASS — all Slot 1 and Slot 2 tests.

- [ ] **Step 5: Manual/live verification**

Against the running local stack, click "Call list_orders as agent" on
`/agent-lifecycle`. Confirm: the token-chain rail updates with a live
exchange trace, and the rendered JSON matches the logged-in user's actual
retail orders. If the raw response shape differs from what Step 3 assumed
(check the Network tab's `/api/mcp/tool` response body), adjust the
`parsed?.orders ?? parsed ?? []` line to match and re-run Step 4.

- [ ] **Step 6: Commit**

```bash
git add demo_api_ui/src/pages/AgentLifecyclePage.jsx demo_api_ui/src/pages/__tests__/AgentLifecyclePage.test.jsx
git commit -m "$(cat <<'EOF'
feat(agent-lifecycle): add slot 2 — scoped MCP call

Calls the retail list_orders tool via the existing callMcpTool /
/api/mcp/tool path (same one every chip click uses) and renders the
live token-exchange trace via TokenChainTraceRail.
EOF
)"
```

---

### Task 5: Slot 3 — step-up (CIBA) on a purchase

**Files:**
- Modify: `demo_api_ui/src/pages/AgentLifecyclePage.jsx`
- Modify: `demo_api_ui/src/pages/__tests__/AgentLifecyclePage.test.jsx`

**Interfaces:**
- Consumes: raw `fetch('/api/mcp/tool', ...)` (not `callMcpTool` — it drops
  the `step_up_method` field this slot needs), `fetch('/api/auth/ciba/initiate', ...)`,
  `fetch('/api/auth/ciba/poll/:authReqId', ...)` — all existing routes, no
  changes.
- Produces: nothing consumed by later tasks — self-contained.

- [ ] **Step 1: Write the failing test**

Add to `demo_api_ui/src/pages/__tests__/AgentLifecyclePage.test.jsx`:

```jsx
describe('AgentLifecyclePage — Slot 3 step-up on purchase', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => {
    vi.useRealTimers();
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
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd demo_api_ui && npx vitest run src/pages/__tests__/AgentLifecyclePage.test.jsx -t "Slot 3"`
Expected: FAIL — `Unable to find an element with the text: Checkout $600 headphones`.

- [ ] **Step 3: Implement `StepUpSlot`**

Add to `demo_api_ui/src/pages/AgentLifecyclePage.jsx`, rendered after
`<ScopedCallSlot />`:

```jsx
function StepUpSlot() {
  const [phase, setPhase] = React.useState('idle'); // idle | checking-out | waiting-approval | approved | error
  const [message, setMessage] = React.useState('');
  const timerRef = React.useRef(null);

  const postCheckout = React.useCallback(async () => {
    const res = await fetch('/api/mcp/tool', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tool: 'checkout',
        params: { product: 'Headphones', amount: 600 },
        useCaseId: 'ciba-out-of-band-approval',
        vertical: 'retail',
      }),
    });
    const body = await res.json().catch(() => ({}));
    return { status: res.status, ok: res.ok, body };
  }, []);

  const pollCiba = React.useCallback((authReqId, intervalMs) => {
    timerRef.current = setTimeout(async () => {
      const res = await fetch(`/api/auth/ciba/poll/${authReqId}`, { credentials: 'include' });
      if (res.status === 403 || res.status === 404 || res.status === 410) {
        setPhase('error');
        setMessage('CIBA approval was denied or expired.');
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (data.status === 'approved') {
        setMessage('Approved — retrying checkout…');
        const retry = await postCheckout();
        if (retry.ok) {
          setPhase('approved');
          setMessage('Checkout completed.');
        } else {
          setPhase('error');
          setMessage(retry.body.message || `Retry failed: HTTP ${retry.status}`);
        }
        return;
      }
      pollCiba(authReqId, intervalMs);
    }, intervalMs);
  }, [postCheckout]);

  const runCheckout = React.useCallback(async () => {
    setPhase('checking-out');
    setMessage('');
    const { status, ok, body } = await postCheckout();
    if (status === 428 && body.error === 'mcp_step_up_required' && body.step_up_method === 'ciba') {
      const initRes = await fetch('/api/auth/ciba/initiate', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ binding_message: 'Approve your $600 headphones purchase' }),
      });
      const { auth_req_id, interval } = await initRes.json();
      setPhase('waiting-approval');
      setMessage(`Waiting for push approval (auth_req_id: ${auth_req_id})…`);
      pollCiba(auth_req_id, (interval || 5) * 1000);
      return;
    }
    if (!ok) {
      setPhase('error');
      setMessage(body.message || body.error_description || `HTTP ${status}`);
      return;
    }
    setPhase('approved');
    setMessage('Checkout completed.');
  }, [postCheckout, pollCiba]);

  React.useEffect(() => () => clearTimeout(timerRef.current), []);

  const busy = phase === 'checking-out' || phase === 'waiting-approval';

  return (
    <section className="alp-slot">
      <h2 className="alp-slot__title">3. Step-up approval on a sensitive purchase</h2>
      <p className="alp-slot__desc">
        Checks out $600 of headphones with the same agent-scoped path — above
        the retail step-up threshold, so PingOne Authorize requires a CIBA
        push approval before the purchase completes.
      </p>
      <button className="alp-btn" type="button" onClick={runCheckout} disabled={busy}>
        {busy ? 'Processing…' : 'Checkout $600 headphones'}
      </button>
      {message && <p className="alp-slot__status">{message}</p>}
    </section>
  );
}
```

And in `AgentLifecyclePage`:

```jsx
      <RegistrationSlot />
      <ScopedCallSlot />
      <StepUpSlot />
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd demo_api_ui && npx vitest run src/pages/__tests__/AgentLifecyclePage.test.jsx`
Expected: PASS — all Slot 1, 2, and 3 tests.

- [ ] **Step 5: Manual/live verification**

Against the running local stack with CIBA enabled (`ff_ciba` / `CIBA_ENABLED`
per existing setup), click "Checkout $600 headphones". Confirm the 428
carries `step_up_method: 'ciba'`, the push/simulated-approval flow completes,
and the retried checkout succeeds. If CIBA isn't configured in the current
environment, confirm `cibaSimulatedService.js`'s fallback still produces an
`auth_req_id` the poll loop can approve (per existing UC22 demo behavior).

- [ ] **Step 6: Commit**

```bash
git add demo_api_ui/src/pages/AgentLifecyclePage.jsx demo_api_ui/src/pages/__tests__/AgentLifecyclePage.test.jsx
git commit -m "$(cat <<'EOF'
feat(agent-lifecycle): add slot 3 — CIBA step-up on purchase

Page-local checkout -> initiate -> poll -> retry sequence, copied
from AIAgent.js's existing inline CIBA handling (not extracted as a
shared hook — out of scope for this page). Reuses the existing
retail checkout gate and CIBA routes unchanged.
EOF
)"
```

---

### Task 6: Slot 4 — self-service revoke, retry-proof, audit link

**Files:**
- Modify: `demo_api_ui/src/pages/AgentLifecyclePage.jsx`
- Modify: `demo_api_ui/src/pages/__tests__/AgentLifecyclePage.test.jsx`

**Interfaces:**
- Consumes: `getAgents()` from `demo_api_ui/src/services/controlPlaneApi.js`
  (existing, `() => Promise<{ live: { id, ... } | null, demo: [...] }>`);
  `apiClient` default export from `demo_api_ui/src/services/apiClient.js`
  (existing, axios-like `.post(url, body)`); `KillSwitchConfirmModal` default
  export from `demo_api_ui/src/components/KillSwitchConfirmModal.jsx`
  (existing, props `{ isOpen, agentId, onConfirm(agentId, reason), onCancel }`);
  `callMcpTool` (already imported in Task 4).
- Produces: nothing consumed elsewhere — final slot.

- [ ] **Step 1: Write the failing test**

Add to `demo_api_ui/src/pages/__tests__/AgentLifecyclePage.test.jsx`:

```jsx
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

import { getAgents } from '../../services/controlPlaneApi';
import apiClient from '../../services/apiClient';
```

```jsx
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

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd demo_api_ui && npx vitest run src/pages/__tests__/AgentLifecyclePage.test.jsx -t "Slot 4"`
Expected: FAIL — `Unable to find an element with the text: Revoke agent access`.

- [ ] **Step 3: Implement `RevokeSlot`**

Add to `demo_api_ui/src/pages/AgentLifecyclePage.jsx`:

```jsx
import { getAgents } from '../services/controlPlaneApi';
import apiClient from '../services/apiClient';
import KillSwitchConfirmModal from '../components/KillSwitchConfirmModal';

// ...RegistrationSlot, ScopedCallSlot, StepUpSlot unchanged...

function RevokeSlot() {
  const [agentId, setAgentId] = React.useState(null);
  const [showModal, setShowModal] = React.useState(false);
  const [revoked, setRevoked] = React.useState(false);
  const [retryResult, setRetryResult] = React.useState('');

  React.useEffect(() => {
    getAgents()
      .then((data) => setAgentId(data?.live?.id || 'demo-agent'))
      .catch(() => setAgentId('demo-agent'));
  }, []);

  const confirmRevoke = React.useCallback(async (id, reason) => {
    try {
      await apiClient.post(`/api/admin/agent/${id}/kill-switch`, { reason });
    } catch (_) {
      // A 401 here is expected once the session dies mid-request — the
      // retry below is the real proof, not this call's own success.
    }
    setShowModal(false);
    setRevoked(true);
    try {
      const { result } = await callMcpTool('list_orders', {}, { vertical: 'retail' });
      setRetryResult(`Unexpected: call still succeeded (${JSON.stringify(result)})`);
    } catch (err) {
      setRetryResult(`Confirmed revoked — retry failed: ${err.message}`);
    }
  }, []);

  return (
    <section className="alp-slot">
      <h2 className="alp-slot__title">4. Self-service revoke</h2>
      <p className="alp-slot__desc">
        Revokes this agent's access via the same kill-switch the AI Control
        Plane page uses. This ends your own session — real kill-switch
        semantics, not a simulation.
      </p>
      <button
        className="alp-btn"
        type="button"
        onClick={() => setShowModal(true)}
        disabled={!agentId || revoked}
      >
        {revoked ? 'Revoked' : 'Revoke agent access'}
      </button>
      <KillSwitchConfirmModal
        isOpen={showModal}
        agentId={agentId}
        onConfirm={confirmRevoke}
        onCancel={() => setShowModal(false)}
      />
      {retryResult && <p className="alp-slot__status">{retryResult}</p>}
      {revoked && (
        <a
          className="alp-audit-link"
          href={`/audit?agentId=${agentId}`}
          target="_blank"
          rel="noreferrer"
        >
          View audit trail →
        </a>
      )}
    </section>
  );
}
```

And in `AgentLifecyclePage`:

```jsx
      <RegistrationSlot />
      <ScopedCallSlot />
      <StepUpSlot />
      <RevokeSlot />
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd demo_api_ui && npx vitest run src/pages/__tests__/AgentLifecyclePage.test.jsx`
Expected: PASS — all Slot 1–4 tests.

- [ ] **Step 5: Manual/live verification**

Against the running local stack: walk slots 1–3 first (so there's a real
token in play), then click "Revoke agent access" on slot 4. Confirm: the
retry proof message appears, and — after logging back in (the session just
died, matching `ControlPlaneRoster.jsx`'s existing "live" row behavior) —
`/audit?agentId=demo-agent` shows the kill-switch event pre-filtered with no
manual re-selection needed.

- [ ] **Step 6: Full-suite regression check**

Run: `cd demo_api_ui && npx vitest run src/pages/__tests__/AgentLifecyclePage.test.jsx src/components/__tests__/AuditPage.test.jsx src/__tests__/ControlPlaneRoster.test.jsx`
Expected: PASS — confirms Task 2's `AuditPage` change and this page's new
code don't regress the existing `ControlPlaneRoster` kill-switch flow they
both build on.

- [ ] **Step 7: Commit**

```bash
git add demo_api_ui/src/pages/AgentLifecyclePage.jsx demo_api_ui/src/pages/__tests__/AgentLifecyclePage.test.jsx
git commit -m "$(cat <<'EOF'
feat(agent-lifecycle): add slot 4 — self-service revoke + audit link

Reuses the existing AI Control Plane kill-switch endpoint and
KillSwitchConfirmModal. Retries slot 2's call inline as live proof
of revocation, then deep-links to /audit?agentId=... (Task 2's
query-param seed) to show the resulting audit entry.
EOF
)"
```

---

## Self-Review

**Spec coverage:**
1. Registration + consent screen → Task 1 (video) + Task 3 Slot 1. ✓
2. Scoped, revocable MCP call → Task 4 Slot 2. ✓
3. Human step-up (CIBA) on a sensitive action → Task 5 Slot 3. ✓
4. Self-service revoke, immediate failure, audit entry → Task 6 Slot 4
   (revoke + retry-proof) + Task 2 (audit deep-link). ✓
5. Routing/nav so the page is reachable → Task 3 Steps 5–6. ✓

**Placeholder scan:** No TBD/TODO markers. Two spots are explicitly flagged
as needing live confirmation rather than pretending false certainty (the
`list_orders` result-parsing line in Task 4, and CIBA config in Task 5) —
each has real, working defensive code plus a concrete manual-verification
step, not a stub.

**Type/interface consistency:** `callMcpTool` signature matches between Task
4's import and Task 6's reuse. `agentId` flows consistently as a string from
`getAgents()` → `RevokeSlot` state → `KillSwitchConfirmModal` prop →
`apiClient.post` URL → audit link query param. `StepUpSlot`'s `postCheckout`
→ `pollCiba` → `runCheckout` dependency chain is linear (no circular
`useCallback` references).
