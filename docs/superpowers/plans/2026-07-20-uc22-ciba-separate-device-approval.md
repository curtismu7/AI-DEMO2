# UC22 CIBA Separate-Device Approval Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When UC22's CIBA step-up fires, automatically open a second browser
tab styled as a branded PingOne approval page — so the presenter visibly
approves "on another device" instead of clicking an inline button next to
the chat that requested it.

**Architecture:** Two new session-gated backend endpoints on the existing
`routes/ciba.js` router (`GET /request/:authReqId`, `POST /deny/:authReqId`),
one new standalone React page (`CibaApprovalPage.js`) routed at
`/ciba-approve`, and small additions to the two existing CIBA-initiate call
sites in `AIAgent.js` that open a blank tab and navigate it once `/initiate`
resolves. No QR code, no new auth mechanism — the new tab shares the same
session cookie as the tab that opened it.

**Tech Stack:** Express (`demo_api_server`), React + `react-router-dom`
(`demo_api_ui`), Jest + Supertest for backend tests, Jest + React Testing
Library for frontend tests.

## Global Constraints

- Emoji allowlist only: `⚠️` `✅` `❌` `🔐` `✕` `✓` `👤` `🔑` `🪟` `📚` — no
  other emoji in any UI text this plan adds.
- No muted modal text — the new page uses solid, high-contrast colors
  (matches `SdkLoginCallback.jsx`'s existing style convention: `#93a4c0` on
  dark background is this codebase's established "info" gray, not a
  low-contrast hint).
- The existing inline "Waiting for CIBA approval" chat bubble and its
  Approve button (`AIAgent.js` ~line 9799-9818) are NOT touched by this
  plan — every task is additive.
- `req.session.cibaRequests[authReqId]` (the existing pending-request
  object) keeps its current shape and existing required fields
  (`initiatedAt`, `expiresAt`, `loginHint`, `scope`, `acr_values`,
  `binding_message`, `simulated`) — new fields are optional additions only.
- Design doc: `docs/superpowers/specs/2026-07-20-uc22-ciba-separate-device-approval-design.md`

---

## File Structure

| File | Responsibility |
|---|---|
| `demo_api_server/routes/ciba.js` | Modify: `/initiate` gains 3 optional body fields; new `GET /request/:authReqId`; new `POST /deny/:authReqId`; `/poll/:authReqId`'s simulated branch gains a denial check |
| `demo_api_server/src/__tests__/ciba.test.js` | Modify: new `describe` blocks for the 2 new endpoints and the poll-denial branch |
| `demo_api_ui/src/pages/CibaApprovalPage.js` | New: standalone page, fetches pending-request details, renders the branded card, Approve/Deny buttons, result state |
| `demo_api_ui/src/pages/__tests__/CibaApprovalPage.test.js` | New: React Testing Library tests for the page |
| `demo_api_ui/src/routes/PublicRoutes.js` | Modify: import `CibaApprovalPage`, export `CibaApprovalPageRoute()` wrapper (matches `SdkLoginCallbackRoute`'s existing pattern at line 221-223) |
| `demo_api_ui/src/App.js` | Modify: import `CibaApprovalPageRoute`, add `<Route path="/ciba-approve" .../>` |
| `demo_api_ui/src/components/AIAgent.js` | Modify: `runAction`'s CIBA branch (~line 4057-4093) and `handleNlResumeResponse`'s CIBA branch (~line 7002-7033) each open+navigate a tab and send amount/account-label fields |

---

### Task 1: Backend — `/initiate` carries transaction context, new `GET /request/:authReqId`

**Files:**
- Modify: `demo_api_server/routes/ciba.js:84-188` (`/initiate` handler)
- Test: `demo_api_server/src/__tests__/ciba.test.js`

**Interfaces:**
- Consumes: existing `req.session.cibaRequests[authReqId]` object shape (unchanged fields).
- Produces: `req.session.cibaRequests[authReqId]` gains optional `amount`
  (number|null), `fromAccountLabel` (string|null), `toAccountLabel`
  (string|null). New route: `GET /api/auth/ciba/request/:authReqId` →
  `200 {binding_message, amount, from_account_label, to_account_label}` |
  `404 {error:'unknown_request'}` | `410 {error:'request_expired'}`.

- [ ] **Step 1: Write the failing tests**

Add to `demo_api_server/src/__tests__/ciba.test.js`, after the existing
`POST /api/auth/ciba/initiate` describe block's "Successful initiation"
section (after the test ending at line 306, before "sends correct scope and
acr_values to PingOne" at line 308):

```javascript
  it('accepts optional amount/account-label fields and stores them on the pending request', async () => {
    const res = await request(buildApp())
      .post('/api/auth/ciba/initiate')
      .set('x-test-user', USER_HDR)
      .send({
        binding_message: 'Approve $600 transfer',
        amount: 600,
        from_account_label: 'Checking',
        to_account_label: 'Savings',
      });
    expect(res.status).toBe(200);
    // Fields aren't echoed on /initiate's own response — verified via
    // GET /request/:authReqId in the next describe block.
  });
```

Then add a new top-level describe block, after the `POST
/api/auth/ciba/initiate` describe block closes (after line 475, before the
`GET /api/auth/ciba/poll/:authReqId` describe block at line 485):

```javascript
// ═══════════════════════════════════════════════════════════════════════════════
// GET /api/auth/ciba/request/:authReqId
// ═══════════════════════════════════════════════════════════════════════════════

describe('GET /api/auth/ciba/request/:authReqId', () => {
  const pendingWithDetails = {
    cibaRequests: {
      [MOCK_AUTH_REQ_ID]: {
        initiatedAt: Date.now(),
        expiresAt:   Date.now() + 300_000,
        loginHint:   'alice@example.com',
        scope:       'openid profile email',
        acr_values:  '',
        binding_message: 'Approve your banking transaction',
        amount: 600,
        fromAccountLabel: 'Checking',
        toAccountLabel: 'Savings',
      },
    },
  };

  it('returns 401 without authentication', async () => {
    const res = await request(buildApp(pendingWithDetails))
      .get(`/api/auth/ciba/request/${MOCK_AUTH_REQ_ID}`);
    expect(res.status).toBe(401);
  });

  it('returns 404 for an unknown auth_req_id', async () => {
    const res = await request(buildApp({ cibaRequests: {} }))
      .get('/api/auth/ciba/request/no-such-id')
      .set('x-test-user', USER_HDR);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('unknown_request');
  });

  it('returns 410 for an expired request', async () => {
    const expiredSession = {
      cibaRequests: {
        [MOCK_AUTH_REQ_ID]: {
          initiatedAt: Date.now() - 400_000,
          expiresAt:   Date.now() - 100_000,
          binding_message: 'Approve transfer',
        },
      },
    };
    const res = await request(buildApp(expiredSession))
      .get(`/api/auth/ciba/request/${MOCK_AUTH_REQ_ID}`)
      .set('x-test-user', USER_HDR);
    expect(res.status).toBe(410);
    expect(res.body.error).toBe('request_expired');
  });

  it('returns binding_message, amount, and account labels for a pending request', async () => {
    const res = await request(buildApp(pendingWithDetails))
      .get(`/api/auth/ciba/request/${MOCK_AUTH_REQ_ID}`)
      .set('x-test-user', USER_HDR);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      binding_message: 'Approve your banking transaction',
      amount: 600,
      from_account_label: 'Checking',
      to_account_label: 'Savings',
    });
  });

  it('returns null amount/account labels when the request has none (non-UC22 CIBA)', async () => {
    const bare = {
      cibaRequests: {
        [MOCK_AUTH_REQ_ID]: {
          initiatedAt: Date.now(),
          expiresAt:   Date.now() + 300_000,
          binding_message: 'Approve sign-in',
        },
      },
    };
    const res = await request(buildApp(bare))
      .get(`/api/auth/ciba/request/${MOCK_AUTH_REQ_ID}`)
      .set('x-test-user', USER_HDR);
    expect(res.status).toBe(200);
    expect(res.body.amount).toBeNull();
    expect(res.body.from_account_label).toBeNull();
    expect(res.body.to_account_label).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd demo_api_server && CI=true npx jest src/__tests__/ciba.test.js --testPathIgnorePatterns="/node_modules/"`
Expected: FAIL — the new `describe('GET /api/auth/ciba/request/:authReqId')`
block fails with `404` (route doesn't exist, express returns its own 404
JSON) or a connection/route-not-found error, not the asserted statuses.

- [ ] **Step 3: Implement**

In `demo_api_server/routes/ciba.js`, modify the `/initiate` handler
(currently lines 103-105) to also read the three optional fields:

```javascript
  const scope = req.body.scope;
  const acr_values = field('acr_values', 'acrValues') || '';
  let binding_message = field('binding_message', 'bindingMessage');

  // Optional transaction-display context (UC22's separate-device approval
  // page). Purely additive — no validation beyond type coercion, since
  // these only ever populate a display string, never a policy decision.
  const amount = req.body.amount != null ? Number(req.body.amount) : null;
  const fromAccountLabel = field('from_account_label', 'fromAccountLabel') || null;
  const toAccountLabel = field('to_account_label', 'toAccountLabel') || null;
```

Then modify the pending-request object (currently lines 163-171):

```javascript
    req.session.cibaRequests[result.auth_req_id] = {
      initiatedAt: Date.now(),
      expiresAt:   Date.now() + result.expires_in * 1000,
      loginHint,
      scope: scope || PINGONE_OIDC_DEFAULT_SCOPES_SPACE,
      acr_values: acr_values || '',
      binding_message: binding_message || '',
      simulated,
      amount,
      fromAccountLabel,
      toAccountLabel,
    };
```

Add the new route immediately after the `/initiate` handler closes (after
line 188, before the `GET /poll/:authReqId` comment block at line 190):

```javascript
// ---------------------------------------------------------------------------
// GET /api/auth/ciba/request/:authReqId
//
// Display details for the separate-device approval page. Session-gated,
// same ownership model as /poll — this page only ever opens in a new tab
// on the SAME browser (shared session cookie), never a different device.
// ---------------------------------------------------------------------------

router.get('/request/:authReqId', authenticateToken, (req, res) => {
  if (!_cibaEnabled(res)) return;

  const { authReqId } = req.params;
  const pending = req.session.cibaRequests?.[authReqId];

  if (!pending) {
    return res.status(404).json({
      error: 'unknown_request',
      message: 'No pending CIBA request with that ID in this session.',
    });
  }

  if (Date.now() > pending.expiresAt) {
    return res.status(410).json({
      error: 'request_expired',
      message: 'The CIBA authentication request has expired. Please try again.',
    });
  }

  res.json({
    binding_message: pending.binding_message || '',
    amount: pending.amount ?? null,
    from_account_label: pending.fromAccountLabel ?? null,
    to_account_label: pending.toAccountLabel ?? null,
  });
});
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd demo_api_server && CI=true npx jest src/__tests__/ciba.test.js --testPathIgnorePatterns="/node_modules/"`
Expected: PASS — all tests in the file, including the new ones.

- [ ] **Step 5: Commit**

```bash
git add demo_api_server/routes/ciba.js demo_api_server/src/__tests__/ciba.test.js
git commit -m "feat(ciba): add optional transaction context to /initiate + GET /request/:authReqId"
```

---

### Task 2: Backend — `POST /deny/:authReqId` + poll-denial branch

**Files:**
- Modify: `demo_api_server/routes/ciba.js` (add new route after `approve-now`, ~line 345; modify `/poll/:authReqId`'s simulated branch, ~line 215-218)
- Test: `demo_api_server/src/__tests__/ciba.test.js`

**Interfaces:**
- Consumes: `req.session.cibaRequests[authReqId]` (Task 1's shape, plus a new `deniedByUser` boolean flag this task adds).
- Produces: `POST /api/auth/ciba/deny/:authReqId` → `200 {ok:true}` |
  `404 {error:'unknown_request'}`. `/poll/:authReqId`'s simulated branch, once
  `deniedByUser` is set, returns the SAME shape `/poll` already returns for a
  real-PingOne deny: `403 {status:'denied', error:'access_denied', message}`.

- [ ] **Step 1: Write the failing tests**

Add to `demo_api_server/src/__tests__/ciba.test.js`, as a new describe block
right after the `POST /api/auth/ciba/approve-now/:authReqId` describe block
closes (after line 948, before the `POST /api/auth/ciba/notify` describe
block at line 954):

```javascript
// ═══════════════════════════════════════════════════════════════════════════════
// POST /api/auth/ciba/deny/:authReqId
// ═══════════════════════════════════════════════════════════════════════════════

describe('POST /api/auth/ciba/deny/:authReqId', () => {
  it('returns 401 without authentication', async () => {
    const res = await request(
      buildApp({ cibaRequests: { [MOCK_AUTH_REQ_ID]: { simulated: true } } }),
    ).post(`/api/auth/ciba/deny/${MOCK_AUTH_REQ_ID}`);
    expect(res.status).toBe(401);
  });

  it('returns 404 for a non-existent request', async () => {
    const res = await request(buildApp({}))
      .post('/api/auth/ciba/deny/no-such-id')
      .set('x-test-user', USER_HDR);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('unknown_request');
  });

  it('marks a pending request denied, and the next /poll call returns 403 denied', async () => {
    cibaService.isEnabled.mockReturnValue(true);
    cibaSimulatedService.initiateSimulated.mockClear();
    cibaSimulatedService.initiateSimulated.mockReturnValue({
      auth_req_id: 'sim-deny-me', expires_in: 300, interval: 5,
    });
    cibaService.initiateBackchannelAuth.mockRejectedValue(new Error('ECONNREFUSED'));
    cibaSimulatedService.isSimulatedApproved.mockReturnValue(false);

    const agent = request.agent(buildApp());
    await agent.set('x-test-user', USER_HDR).post('/api/auth/ciba/initiate').send({});

    const denyRes = await agent
      .set('x-test-user', USER_HDR)
      .post('/api/auth/ciba/deny/sim-deny-me');
    expect(denyRes.status).toBe(200);
    expect(denyRes.body.ok).toBe(true);

    const pollRes = await agent
      .set('x-test-user', USER_HDR)
      .get('/api/auth/ciba/poll/sim-deny-me');
    expect(pollRes.status).toBe(403);
    expect(pollRes.body.status).toBe('denied');
    expect(pollRes.body.error).toBe('access_denied');
  });

  it('a second poll after denial 404s (request deleted, same as approval)', async () => {
    cibaService.isEnabled.mockReturnValue(true);
    cibaSimulatedService.initiateSimulated.mockClear();
    cibaSimulatedService.initiateSimulated.mockReturnValue({
      auth_req_id: 'sim-deny-twice', expires_in: 300, interval: 5,
    });
    cibaService.initiateBackchannelAuth.mockRejectedValue(new Error('ECONNREFUSED'));
    cibaSimulatedService.isSimulatedApproved.mockReturnValue(false);

    const agent = request.agent(buildApp());
    await agent.set('x-test-user', USER_HDR).post('/api/auth/ciba/initiate').send({});
    await agent.set('x-test-user', USER_HDR).post('/api/auth/ciba/deny/sim-deny-twice');
    await agent.set('x-test-user', USER_HDR).get('/api/auth/ciba/poll/sim-deny-twice');

    const secondPoll = await agent
      .set('x-test-user', USER_HDR)
      .get('/api/auth/ciba/poll/sim-deny-twice');
    expect(secondPoll.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd demo_api_server && CI=true npx jest src/__tests__/ciba.test.js --testPathIgnorePatterns="/node_modules/"`
Expected: FAIL — `POST /deny/:authReqId` doesn't exist yet; the "marks
denied" test's poll assertion also fails since nothing sets `deniedByUser`.

- [ ] **Step 3: Implement**

In `demo_api_server/routes/ciba.js`, modify `/poll/:authReqId`'s simulated
branch (currently lines 215-218):

```javascript
  if (pending.simulated) {
    if (pending.deniedByUser) {
      delete req.session.cibaRequests[authReqId];
      return res.status(403).json({
        status: 'denied',
        error: 'access_denied',
        message: 'The user denied the authentication request.',
      });
    }

    if (!cibaSimulatedService.isSimulatedApproved(pending)) {
      return res.json({ status: 'pending' });
    }
```

Add the new route immediately after `POST /approve-now/:authReqId` closes
(after line 345, before the `POST /cancel/:authReqId` comment block at line
347):

```javascript
// ---------------------------------------------------------------------------
// POST /api/auth/ciba/deny/:authReqId
//
// Explicit user denial from the separate-device approval page — distinct
// from /cancel (give up waiting) or expiry (timed out). Same simulated-only
// constraint as /approve-now: a real bc-authorize request can only be
// denied on its actual out-of-band channel, not through this route.
// ---------------------------------------------------------------------------

router.post('/deny/:authReqId', authenticateToken, (req, res) => {
  const { authReqId } = req.params;
  const pending = req.session.cibaRequests?.[authReqId];

  if (!pending || !pending.simulated) {
    return res.status(404).json({
      error: 'unknown_request',
      message: 'No pending request with that ID eligible for denial.',
    });
  }

  pending.deniedByUser = true;
  req.session.save((saveErr) => {
    if (saveErr) console.error('[CIBA] session save error on deny:', saveErr);
    res.json({ ok: true });
  });
});
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd demo_api_server && CI=true npx jest src/__tests__/ciba.test.js --testPathIgnorePatterns="/node_modules/"`
Expected: PASS — all tests in the file.

- [ ] **Step 5: Commit**

```bash
git add demo_api_server/routes/ciba.js demo_api_server/src/__tests__/ciba.test.js
git commit -m "feat(ciba): add POST /deny/:authReqId and wire denial into /poll"
```

---

### Task 3: Frontend — `CibaApprovalPage.js` + routing

**Files:**
- Create: `demo_api_ui/src/pages/CibaApprovalPage.js`
- Create: `demo_api_ui/src/pages/__tests__/CibaApprovalPage.test.js`
- Modify: `demo_api_ui/src/routes/PublicRoutes.js`
- Modify: `demo_api_ui/src/App.js`

**Interfaces:**
- Consumes: `GET /api/auth/ciba/request/:authReqId` (Task 1),
  `POST /api/auth/ciba/approve-now/:authReqId` (existing),
  `POST /api/auth/ciba/deny/:authReqId` (Task 2). Route param via
  `useSearchParams()`: `authReqId`.
- Produces: default export `CibaApprovalPage` (React component, no props —
  reads `authReqId` from its own URL). `CibaApprovalPageRoute()` wrapper
  export from `PublicRoutes.js` for `App.js` to reference.

- [ ] **Step 1: Write the failing test**

Create `demo_api_ui/src/pages/__tests__/CibaApprovalPage.test.js`:

```javascript
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import CibaApprovalPage from "../CibaApprovalPage";

describe("CibaApprovalPage", () => {
  beforeEach(() => {
    global.fetch = jest.fn();
  });

  function renderAt(search) {
    return render(
      <MemoryRouter initialEntries={[`/ciba-approve${search}`]}>
        <CibaApprovalPage />
      </MemoryRouter>,
    );
  }

  it("renders the pending request's amount and account labels", async () => {
    fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        binding_message: "Approve your banking transaction",
        amount: 600,
        from_account_label: "Checking",
        to_account_label: "Savings",
      }),
    });

    renderAt("?authReqId=sim-abc123");

    expect(await screen.findByText(/\$600/)).toBeInTheDocument();
    expect(screen.getByText(/Checking/)).toBeInTheDocument();
    expect(screen.getByText(/Savings/)).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/auth/ciba/request/sim-abc123"),
      expect.objectContaining({ credentials: "include" }),
    );
  });

  it("shows an expired state on a 410 response", async () => {
    fetch.mockResolvedValueOnce({
      ok: false,
      status: 410,
      json: async () => ({ error: "request_expired" }),
    });

    renderAt("?authReqId=sim-abc123");

    expect(await screen.findByText(/expired/i)).toBeInTheDocument();
  });

  it("Approve calls approve-now and shows an approved result", async () => {
    fetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          binding_message: "Approve your banking transaction",
          amount: 600,
          from_account_label: "Checking",
          to_account_label: "Savings",
        }),
      })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) });

    renderAt("?authReqId=sim-abc123");
    await screen.findByText(/\$600/);

    await userEvent.click(screen.getByRole("button", { name: /approve/i }));

    expect(fetch).toHaveBeenLastCalledWith(
      expect.stringContaining("/api/auth/ciba/approve-now/sim-abc123"),
      expect.objectContaining({ method: "POST", credentials: "include" }),
    );
    expect(await screen.findByText(/approved/i)).toBeInTheDocument();
  });

  it("Deny calls the deny endpoint and shows a denied result", async () => {
    fetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          binding_message: "Approve your banking transaction",
          amount: 600,
          from_account_label: "Checking",
          to_account_label: "Savings",
        }),
      })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) });

    renderAt("?authReqId=sim-abc123");
    await screen.findByText(/\$600/);

    await userEvent.click(screen.getByRole("button", { name: /deny/i }));

    expect(fetch).toHaveBeenLastCalledWith(
      expect.stringContaining("/api/auth/ciba/deny/sim-abc123"),
      expect.objectContaining({ method: "POST", credentials: "include" }),
    );
    expect(await screen.findByText(/denied/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_api_ui && CI=true npx jest src/pages/__tests__/CibaApprovalPage.test.js --testPathIgnorePatterns="/node_modules/"`
Expected: FAIL with `Cannot find module '../CibaApprovalPage'`.

- [ ] **Step 3: Implement `CibaApprovalPage.js`**

```javascript
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";

// UC22's separate-device CIBA approval page. Opened in a new tab by
// AIAgent.js when a CIBA request starts, sharing the same session cookie —
// NOT a QR-code/device-flow page (CIBA's spec has no such concept; see
// docs/superpowers/specs/2026-07-20-uc22-ciba-separate-device-approval-design.md).
const WRAP_STYLE = {
  minHeight: "100vh",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: "#f4f4f5",
  font: '14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif',
};

const CARD_STYLE = {
  width: 320,
  background: "#fff",
  borderRadius: 8,
  boxShadow: "0 2px 16px rgba(0,0,0,.18)",
  overflow: "hidden",
};

const HEADER_STYLE = {
  background: "#022a52",
  padding: "16px 20px",
  color: "#fff",
  fontSize: 15,
  fontWeight: 600,
};

const BODY_STYLE = { padding: 20 };

const DETAIL_BOX_STYLE = {
  background: "#f8f8f8",
  borderRadius: 6,
  padding: 12,
  fontSize: 13,
  color: "#1a1a1a",
  margin: "12px 0",
};

const BUTTON_ROW_STYLE = { display: "flex", gap: 8, marginTop: 16 };

const APPROVE_BUTTON_STYLE = {
  flex: 1,
  padding: "10px 0",
  border: "none",
  borderRadius: 6,
  background: "#0a7c3f",
  color: "#fff",
  fontWeight: 600,
  cursor: "pointer",
};

const DENY_BUTTON_STYLE = {
  flex: 1,
  padding: "10px 0",
  border: "none",
  borderRadius: 6,
  background: "#eee",
  color: "#333",
  fontWeight: 600,
  cursor: "pointer",
};

export default function CibaApprovalPage() {
  const [searchParams] = useSearchParams();
  const authReqId = searchParams.get("authReqId");
  const [status, setStatus] = useState("loading"); // loading | pending | expired | error | approved | denied
  const [details, setDetails] = useState(null);
  const [busy, setBusy] = useState(false);

  const apiBase = process.env.REACT_APP_API_URL || "";

  useEffect(() => {
    if (!authReqId) {
      setStatus("error");
      return;
    }
    let cancelled = false;
    fetch(`${apiBase}/api/auth/ciba/request/${authReqId}`, {
      credentials: "include",
    })
      .then(async (res) => {
        if (cancelled) return;
        if (res.status === 410) {
          setStatus("expired");
          return;
        }
        if (!res.ok) {
          setStatus("error");
          return;
        }
        const data = await res.json();
        setDetails(data);
        setStatus("pending");
      })
      .catch(() => {
        if (!cancelled) setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [authReqId, apiBase]);

  const decide = async (action) => {
    setBusy(true);
    try {
      const endpoint =
        action === "approve"
          ? `${apiBase}/api/auth/ciba/approve-now/${authReqId}`
          : `${apiBase}/api/auth/ciba/deny/${authReqId}`;
      const res = await fetch(endpoint, { method: "POST", credentials: "include" });
      if (res.ok) {
        setStatus(action === "approve" ? "approved" : "denied");
      } else {
        setStatus("error");
      }
    } catch {
      setStatus("error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={WRAP_STYLE}>
      <div style={CARD_STYLE}>
        <div style={HEADER_STYLE}>PingOne Identity Verification</div>
        <div style={BODY_STYLE}>
          {status === "loading" && <div>Loading approval request…</div>}

          {status === "expired" && (
            <div>This approval request has expired. Please try again.</div>
          )}

          {status === "error" && (
            <div>Could not load this approval request. Please try again.</div>
          )}

          {status === "pending" && details && (
            <>
              <div>A sign-in attempt needs your approval.</div>
              <div style={DETAIL_BOX_STYLE}>
                {details.amount != null ? (
                  <>
                    Transfer: ${Number(details.amount).toFixed(2)}
                    <br />
                    {details.from_account_label || "Account"} →{" "}
                    {details.to_account_label || "Account"}
                  </>
                ) : (
                  details.binding_message || "Approve this request"
                )}
              </div>
              <div style={BUTTON_ROW_STYLE}>
                <button
                  type="button"
                  style={APPROVE_BUTTON_STYLE}
                  disabled={busy}
                  onClick={() => decide("approve")}
                >
                  Approve
                </button>
                <button
                  type="button"
                  style={DENY_BUTTON_STYLE}
                  disabled={busy}
                  onClick={() => decide("deny")}
                >
                  Deny
                </button>
              </div>
            </>
          )}

          {status === "approved" && <div>✓ Approved. You can close this tab.</div>}
          {status === "denied" && <div>Denied. You can close this tab.</div>}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd demo_api_ui && CI=true npx jest src/pages/__tests__/CibaApprovalPage.test.js --testPathIgnorePatterns="/node_modules/"`
Expected: PASS — all 4 tests.

- [ ] **Step 5: Wire the route**

In `demo_api_ui/src/routes/PublicRoutes.js`, add the import near the other
page imports (next to `import SdkLoginCallback from "../pages/SdkLoginCallback";`):

```javascript
import CibaApprovalPage from "../pages/CibaApprovalPage";
```

Add the wrapper export next to `SdkLoginCallbackRoute` (after line 223):

```javascript
export function CibaApprovalPageRoute() {
  return <CibaApprovalPage />;
}
```

In `demo_api_ui/src/App.js`, add `CibaApprovalPageRoute` to the import list
from `./routes/PublicRoutes` (alongside `SdkLoginCallbackRoute` at line 154):

```javascript
  CibaApprovalPageRoute,
```

Add the route next to `/sdk-login/callback` (after line 491):

```javascript
                <Route path="/ciba-approve" element={<CibaApprovalPageRoute />} />
```

- [ ] **Step 6: Build check**

Run: `cd demo_api_ui && npm run build`
Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add demo_api_ui/src/pages/CibaApprovalPage.js demo_api_ui/src/pages/__tests__/CibaApprovalPage.test.js demo_api_ui/src/routes/PublicRoutes.js demo_api_ui/src/App.js
git commit -m "feat(ciba): add CibaApprovalPage and /ciba-approve route"
```

---

### Task 4: Frontend — `runAction`'s CIBA branch opens a second tab

**Files:**
- Modify: `demo_api_ui/src/components/AIAgent.js:4057-4093`

**Interfaces:**
- Consumes: `normalized.transaction_amount`, `normalized.amount_threshold`,
  `normalized.fromAccountId || normalized.from_account_id`,
  `normalized.toAccountId || normalized.to_account_id` (already-read fields
  in this exact function, per the existing usage at
  `AIAgent.js:3985-3996`), `liveAccounts` state (existing, shape
  `{id, name, type, balance, accountNumber}` per `normalizeAccountRow` at
  `AIAgent.js:6663-6672`).
- Produces: no new exports — this is a self-contained edit inside `runAction`.

- [ ] **Step 1: Manual verification test (no existing automated coverage for this exact branch)**

This branch has no dedicated unit test today (it's deep inside a large
`runAction` function gated behind live step-up state). Verify manually per
Step 4 below rather than writing a new automated test — consistent with how
this codebase already tests the sibling `handleNlResumeResponse` CIBA branch
(no dedicated test either; see Task 5).

- [ ] **Step 2: Implement**

In `demo_api_ui/src/components/AIAgent.js`, replace the CIBA branch
(currently lines 4057-4094):

```javascript
          if (normalized.step_up_method === "ciba") {
            // Open a blank tab now, before the initiate fetch, so the browser
            // still counts it as close enough to the user's original gesture
            // to avoid a popup block — then navigate it once we have the real
            // URL. If it's blocked anyway (cibaTab is null), the inline
            // "Waiting for CIBA approval" bubble below is a complete fallback
            // on its own; see the design doc's Error handling section.
            const cibaTab = window.open("", "_blank");
            try {
              const apiBase = process.env.REACT_APP_API_URL || "";
              const fromAccountId =
                normalized.fromAccountId || normalized.from_account_id;
              const toAccountId =
                normalized.toAccountId || normalized.to_account_id;
              const fromLabel = liveAccounts?.find((a) => a.id === fromAccountId)?.name;
              const toLabel = liveAccounts?.find((a) => a.id === toAccountId)?.name;
              const initRes = await fetch(`${apiBase}/api/auth/ciba/initiate`, {
                method: "POST",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  binding_message: "Approve your banking transaction",
                  acr_values: normalized.step_up_acr || "",
                  amount: normalized.transaction_amount ?? undefined,
                  from_account_label: fromLabel,
                  to_account_label: toLabel,
                }),
              });
              if (!initRes.ok)
                throw new Error(`CIBA initiation failed: ${initRes.status}`);
              const { auth_req_id, interval } = await initRes.json();
              if (cibaTab) {
                cibaTab.location.href = `/ciba-approve?authReqId=${encodeURIComponent(auth_req_id)}`;
              }
              addMessage(
                "assistant",
                " Waiting for CIBA approval — this normally completes on a separate device. Click Approve to continue now, or it will continue automatically in a few seconds.",
                `ciba-step-${Date.now()}`,
                { showCibaApproveAction: true, cibaAuthReqId: auth_req_id },
              );
              toast.dismiss(toastId);
              agentFlowDiagram.completeMfaChallenge(null); // Pending
              setLoading(false);
              pollCibaStepUp(auth_req_id, (interval || 5) * 1000, actionId, form);
            } catch (err) {
              console.error("[BankingAgent] CIBA initiation failed:", err);
              if (cibaTab) cibaTab.close();
              addMessage(
                "assistant",
                "❌ Could not start CIBA approval. Please try again.",
                `ciba-error-${Date.now()}`,
              );
              toast.dismiss(toastId);
              agentFlowDiagram.completeMfaChallenge(false);
              setLoading(false);
            }
            return;
          }
```

- [ ] **Step 3: Run the existing AIAgent test suites to confirm no regression**

Run: `cd demo_api_ui && CI=true npx jest src/__tests__/BankingAgent src/components/__tests__/AIAgent.chips.test.js --testPathIgnorePatterns="/node_modules/"`
Expected: PASS — same pass count as before this change (this edit doesn't
change any response-shape or message-text assertions these suites check).

- [ ] **Step 4: Manual live verification**

Run the dev stack, trigger a CIBA-eligible transfer through a chip/dashboard
action (not the NL launcher path — that's Task 5). Confirm: a second tab
opens showing the real amount and account labels; approving there resumes
the original tab's transfer exactly as clicking the inline Approve button
does today.

- [ ] **Step 5: Commit**

```bash
git add demo_api_ui/src/components/AIAgent.js
git commit -m "feat(ciba): runAction's CIBA branch opens the separate-device approval tab"
```

---

### Task 5: Frontend — `handleNlResumeResponse`'s CIBA branch opens a second tab

**Files:**
- Modify: `demo_api_ui/src/components/AIAgent.js:7002-7033`

**Interfaces:**
- Consumes: `response.transactionAmount`,
  `response.fromAccountId || response.from_account_id`,
  `response.toAccountId || response.to_account_id` (already-read fields in
  this exact function, per the existing usage at `AIAgent.js:7078-7085`),
  `liveAccounts` state (same as Task 4).
- Produces: no new exports — self-contained edit.

- [ ] **Step 1: Manual verification (see Task 4 Step 1 rationale — no existing dedicated test for this branch)**

- [ ] **Step 2: Implement**

In `demo_api_ui/src/components/AIAgent.js`, replace the CIBA branch
(currently lines 7002-7033):

```javascript
    if (
      response.step_up_method === "ciba" &&
      (response.error === "step_up_required" || response.error === "mcp_step_up_required")
    ) {
      // Same pre-open-then-navigate pattern as runAction's CIBA branch — see
      // that comment for why this reduces (not eliminates) popup blocking.
      const cibaTab = window.open("", "_blank");
      try {
        const apiBase = process.env.REACT_APP_API_URL || "";
        const fromAccountId = response.fromAccountId || response.from_account_id;
        const toAccountId = response.toAccountId || response.to_account_id;
        const fromLabel = liveAccounts?.find((a) => a.id === fromAccountId)?.name;
        const toLabel = liveAccounts?.find((a) => a.id === toAccountId)?.name;
        const initRes = await fetch(`${apiBase}/api/auth/ciba/initiate`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            binding_message: "Approve your banking transaction",
            acr_values: response.step_up_acr || "",
            amount: response.transactionAmount ?? undefined,
            from_account_label: fromLabel,
            to_account_label: toLabel,
          }),
        });
        if (!initRes.ok) throw new Error(`CIBA initiation failed: ${initRes.status}`);
        const { auth_req_id, interval } = await initRes.json();
        if (cibaTab) {
          cibaTab.location.href = `/ciba-approve?authReqId=${encodeURIComponent(auth_req_id)}`;
        }
        addMessage(
          "assistant",
          " Waiting for CIBA approval — this normally completes on a separate device. Click Approve to continue now, or it will continue automatically in a few seconds.",
          `ciba-step-${Date.now()}`,
          { showCibaApproveAction: true, cibaAuthReqId: auth_req_id },
        );
        agentFlowDiagram.completeMfaChallenge(null);
        pollCibaThenResumeNl(auth_req_id, (interval || 5) * 1000, text, useCaseId);
      } catch (err) {
        console.error("[BankingAgent] CIBA initiation failed:", err);
        if (cibaTab) cibaTab.close();
        addMessage("assistant", "❌ Could not start CIBA approval. Please try again.", `ciba-error-${Date.now()}`);
        agentFlowDiagram.completeMfaChallenge(false);
      }
      return;
    }
```

- [ ] **Step 3: Run the existing AIAgent test suites to confirm no regression**

Run: `cd demo_api_ui && CI=true npx jest src/__tests__/BankingAgent src/components/__tests__/AIAgent.chips.test.js --testPathIgnorePatterns="/node_modules/"`
Expected: PASS — same pass count as before.

- [ ] **Step 4: Manual live verification**

Run UC22 from `/use-cases` (the launcher path, which is what routes through
`handleNlResumeResponse`). Confirm: a second tab opens automatically showing
the real $600 / Checking → Savings details; approving there resumes the
original tab's transfer.

- [ ] **Step 5: Full-suite regression check + UI build gate**

Run: `cd demo_api_server && CI=true npx jest --testPathIgnorePatterns="/node_modules/"`
Expected: same pass/fail counts as the pre-existing baseline (only
`tests/real/*` suites fail, on the pre-existing `skipIfNoSession` gap —
unrelated to this feature).

Run: `cd demo_api_ui && npm run build`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add demo_api_ui/src/components/AIAgent.js
git commit -m "feat(ciba): handleNlResumeResponse's CIBA branch opens the separate-device approval tab"
```

---

## Self-Review Notes

- **Spec coverage:** Goal (second tab, branded page) → Tasks 3-5. Non-goals
  (no QR, inline bubble untouched, no real-CIBA behavior change) → verified
  by construction (no QR code anywhere in this plan; Tasks 4-5 only add
  code, never remove the existing `addMessage`/`showCibaApproveAction`
  calls). Architecture's 2 new endpoints → Tasks 1-2. Error handling
  (popup blocked, expired, double-decision) → `cibaTab` null-checks in
  Tasks 4-5, `expired`/404 states in Task 3's page and Task 1-2's tests.
  Testing section → covered per-task. Files touched table → matches this
  plan's File Structure table (with `PublicRoutes.js` named explicitly,
  refining the design doc's "App.js" shorthand per its own noted open risk).
- **Placeholder scan:** no TBD/TODO; every step has complete code.
- **Type consistency:** `authReqId` used consistently as the route param
  name across Tasks 1-2 (backend) and Task 3 (frontend `useSearchParams`
  key) and Tasks 4-5 (query string key) — verified no `auth_req_id` vs
  `authReqId` mismatch in the new frontend-facing surface (the existing
  backend response already returns both casings for other callers; this
  plan's new frontend code only ever reads `auth_req_id` from
  `/initiate`'s response, matching the existing `pollCibaStepUp`/
  `pollCibaThenResumeNl` calls it sits next to).
