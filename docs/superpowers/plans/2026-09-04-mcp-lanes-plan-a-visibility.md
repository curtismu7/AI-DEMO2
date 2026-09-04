# MCP Lanes Plan A — Visibility and Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the façade's Privilege door impossible to be silently dead, and give the operator one command and one page panel that tell the truth about every MCP door before a demo starts.

**Architecture:** Three independent surfaces, no new services. The BFF exposes the already-existing `privilegeGatewaySession.status()` through `GET /api/privilege-mcp/state`; the page renders it as a banner with a one-click re-arm that reuses the existing `/auth/start` flow; a new `scripts/check-mcp-preflight.js` CLI probes door reachability from outside the stack, with its pure classification logic in `scripts/lib/` so it is unit-testable without a network. A fourth change fixes a real bug in the façade's `DELETE` handler found during analysis.

**Tech Stack:** Node >= 22 CommonJS (BFF + scripts), Express 4.18, Jest 29.7 + supertest (BFF tests), `node:test` + `node:assert/strict` (script tests), React 19.2 + Vitest 3.2 (UI).

**Spec:** [`docs/superpowers/specs/2026-09-04-mcp-lanes-and-privilege-llm-design.md`](../specs/2026-09-04-mcp-lanes-and-privilege-llm-design.md)

**Scope note:** This is Plan A of three. Plan A covers spec workstreams **W1** (preflight), **W2** (session visibility) and **W7** (the `DELETE` bug). Plan B will cover W8 (door discovery from Privilege), W3 (banking Agentic App) and W4 (LM Studio proof). Plan C will cover W6 (config) and W5 (LLM protection panel). Plan A ships value on its own: after it, you can see the state of every door and recover a dead one in one click.

## Global Constraints

- **Do not change the Privilege transport.** The agent-based deployment with OAuth retained works and is explicitly out of scope (spec §9). No task here touches the gateway, its Helm chart, its mode, or the OAuth dance.
- **Do not change any frozen LLM setting** (resident tiers, `LLAMACPP_MAX_TOKENS`, `REASON_LOOP_TIMEOUT_MS`, `reasoning_effort`). Nothing here requires it.
- `demo_api_server` is **CommonJS** (`'use strict'` + `require`), not ESM.
- BFF error responses use `{ error }`, never `{ message }`.
- UI: **Vitest, not jest.** No TypeScript sources. Modals are `DraggableModal`. HTTP goes through `apiClient` where the file already uses it — `PrivilegeMcpClientPage.jsx` currently uses `global.fetch` for `/api/privilege-mcp/*`; follow the file's existing pattern rather than converting it.
- **Emoji allowlist only** (`REGRESSION_PLAN.md` §0). Allowed here: `⚠️` `✅` `❌`. Everything else is plain text, CSS, or semantic HTML.
- **Theming:** no colour, background, or `font-size` in inline `style={{ }}`. Use `--th-*` tokens in the stylesheet. Minimum font size is `--font-size-3xs` (10px).
- **Worktree required.** Stage explicitly with `git add <files>` — never `git add -A` (jest regenerates hundreds of artifacts). Verify `git branch --show-current` before each commit.
- BFF test command: `CI=true npx jest <paths> --forceExit` run from `demo_api_server/`. `CI=true` is mandatory.

---

### Task 1: Expose the gateway session status in `/state`

The status function already exists and is already correct. Nothing reads it. This task is only the wiring, and it unblocks Tasks 2 and 6.

**Files:**
- Modify: `demo_api_server/routes/privilegeMcpClient.js` (the `res.json({...})` in `GET /state`, around line 1392)
- Test: `demo_api_server/tests/routes/privilegeMcpClient.gatewaySessionState.test.js` (create)

**Interfaces:**
- Consumes: `privilegeGatewaySession.status()` from `services/privilegeGatewaySession.js`, already required at `privilegeMcpClient.js:7`. Returns `{ ready: true }` or `{ ready: false, reason: 'no_session' }` or `{ ready: boolean, reason: 'refreshable' | 'expired' }`.
- Produces: `GET /api/privilege-mcp/state` response gains a top-level `gatewaySession` key with that exact shape. Tasks 2 and 6 read it.

- [ ] **Step 1: Write the failing test**

Create `demo_api_server/tests/routes/privilegeMcpClient.gatewaySessionState.test.js`:

```js
// The façade's privilege-gateway door swaps in a server-side gateway token
// (mcpFacade.js ownsUpstreamAuth). That token is in-memory and single-session,
// so every BFF restart kills it and the door 503s. Nothing surfaced that state,
// which is why the door could be dead with no external signal. /state is where
// the page learns it.
const request = require('supertest');
const app = require('../../server');
const privilegeGatewaySession = require('../../services/privilegeGatewaySession');

const TOKEN_URI = 'https://mcpgw.ai-demo.ping-devops.com/oauth/token';

describe('GET /api/privilege-mcp/state — gatewaySession', () => {
  afterEach(() => privilegeGatewaySession.clear());

  it('reports no_session when no human has signed in', async () => {
    privilegeGatewaySession.clear();

    const res = await request(app).get('/api/privilege-mcp/state').expect(200);

    expect(res.body.gatewaySession).toEqual({ ready: false, reason: 'no_session' });
  });

  it('reports ready once a gateway session is remembered', async () => {
    privilegeGatewaySession.remember({
      accessToken: 'tok', refreshToken: 'refresh', expiresIn: 3600, tokenUri: TOKEN_URI,
    });

    const res = await request(app).get('/api/privilege-mcp/state').expect(200);

    expect(res.body.gatewaySession).toEqual({ ready: true });
  });

  it('reports expired for a lapsed token with no refresh token', async () => {
    // expiresIn of 1s is inside REFRESH_SKEW_MS (60s), so status() already
    // treats it as past its refresh point — no fake timers needed.
    privilegeGatewaySession.remember({
      accessToken: 'tok', refreshToken: null, expiresIn: 1, tokenUri: TOKEN_URI,
    });

    const res = await request(app).get('/api/privilege-mcp/state').expect(200);

    expect(res.body.gatewaySession).toEqual({ ready: false, reason: 'expired' });
  });

  it('reports refreshable for a lapsed token that still has a refresh token', async () => {
    privilegeGatewaySession.remember({
      accessToken: 'tok', refreshToken: 'refresh', expiresIn: 1, tokenUri: TOKEN_URI,
    });

    const res = await request(app).get('/api/privilege-mcp/state').expect(200);

    expect(res.body.gatewaySession).toEqual({ ready: true, reason: 'refreshable' });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd demo_api_server && CI=true npx jest tests/routes/privilegeMcpClient.gatewaySessionState.test.js --forceExit
```

Expected: FAIL — `res.body.gatewaySession` is `undefined`, so every assertion fails with "expected undefined to equal ...".

- [ ] **Step 3: Add the key to the `/state` response**

In `demo_api_server/routes/privilegeMcpClient.js`, inside the `res.json({ ... })` of `GET /state`, add one line immediately after the `oauth:` line:

```js
    oauth: { authenticated: Boolean(session.oauth.accessToken), source: session.oauth.source || null, expiresAt: session.oauth.expiresAt, scope: session.oauth.scope || '' },
    // The façade's privilege-gateway door runs on a server-side gateway token
    // that dies with the process (services/privilegeGatewaySession.js). Ship its
    // state so the page can say so instead of the door failing silently.
    gatewaySession: privilegeGatewaySession.status(),
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd demo_api_server && CI=true npx jest tests/routes/privilegeMcpClient.gatewaySessionState.test.js --forceExit
```

Expected: PASS, 4 tests.

- [ ] **Step 5: Run the neighbouring `/state` suite to check nothing regressed**

```bash
cd demo_api_server && CI=true npx jest tests/routes/privilegeMcpClient.state.test.js --forceExit
```

Expected: PASS, 6 tests.

- [ ] **Step 6: Commit**

```bash
git add demo_api_server/routes/privilegeMcpClient.js demo_api_server/tests/routes/privilegeMcpClient.gatewaySessionState.test.js
git commit -m "feat(privilege-mcp): report gateway session state from /state"
```

---

### Task 2: Gateway session banner and one-click re-arm on the page

**Files:**
- Modify: `demo_api_ui/src/pages/PrivilegeMcpClientPage.jsx`
- Modify: `demo_api_ui/src/pages/PrivilegeMcpClientPage.css`
- Test: `demo_api_ui/src/pages/__tests__/PrivilegeMcpClientPage.gatewaySession.test.jsx` (create)

**Interfaces:**
- Consumes: `state.gatewaySession` from Task 1 — `{ ready: boolean, reason?: 'no_session' | 'refreshable' | 'expired' }`.
- Produces: nothing other tasks depend on. Task 6 renders in the same panel area but reads `/state` itself.

**Design note:** the banner shows only when the session is **not** ready, and only in `facade` mode — that is the only mode whose door uses the server-side token. Showing it in `direct` or `privilege` mode would be noise, because those modes carry the caller's own bearer.

- [ ] **Step 1: Write the failing test**

Create `demo_api_ui/src/pages/__tests__/PrivilegeMcpClientPage.gatewaySession.test.jsx`:

```jsx
// demo_api_ui/src/pages/__tests__/PrivilegeMcpClientPage.gatewaySession.test.jsx
// Façade mode relays through a server-side gateway token that dies with the BFF
// process. When it is gone the door 503s and, before this banner, nothing on the
// page said so — the operator saw an unexplained failure in LM Studio instead.
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import PrivilegeMcpClientPage from "../PrivilegeMcpClientPage";

vi.mock("../../services/apiClient", () => ({
  default: {
    get: vi.fn(() => new Promise(() => {})),
    post: vi.fn(() => new Promise(() => {})),
  },
}));

function stateBody({ gatewayMode, gatewaySession }) {
  return JSON.stringify({
    config: { mcpUrl: "https://example.test/mcp", clientId: "", scopes: "openid" },
    gatewayMode,
    gatewayConfigs: {},
    oauth: { authenticated: true },
    mainAppAuthenticated: true,
    tools: [],
    presets: [],
    gatewaySession,
  });
}

function mockState(opts) {
  global.fetch = vi.fn((url) => {
    if (String(url).endsWith("/api/privilege-mcp/state")) {
      return Promise.resolve({ ok: true, status: 200, text: async () => stateBody(opts) });
    }
    return new Promise(() => {});
  });
}

beforeEach(() => {
  global.EventSource = class {
    addEventListener() {}
    close() {}
  };
});

function renderPage() {
  render(
    <MemoryRouter initialEntries={["/privilege-mcp-client"]}>
      <PrivilegeMcpClientPage />
    </MemoryRouter>,
  );
}

describe("gateway session banner", () => {
  it("warns and offers re-arm in facade mode when there is no gateway session", async () => {
    mockState({ gatewayMode: "facade", gatewaySession: { ready: false, reason: "no_session" } });
    renderPage();

    expect(await screen.findByText(/gateway session/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /re-arm gateway session/i })).toBeInTheDocument();
  });

  it("stays hidden in facade mode when the session is ready", async () => {
    mockState({ gatewayMode: "facade", gatewaySession: { ready: true } });
    renderPage();

    await screen.findByTitle("Settings");
    expect(screen.queryByRole("button", { name: /re-arm gateway session/i })).not.toBeInTheDocument();
  });

  it("stays hidden in privilege mode even with no gateway session — that mode carries the caller's own bearer", async () => {
    mockState({ gatewayMode: "privilege", gatewaySession: { ready: false, reason: "no_session" } });
    renderPage();

    await screen.findByTitle("Settings");
    expect(screen.queryByRole("button", { name: /re-arm gateway session/i })).not.toBeInTheDocument();
  });

  it("re-arm posts to /auth/start and follows the returned authUrl", async () => {
    mockState({ gatewayMode: "facade", gatewaySession: { ready: false, reason: "expired" } });
    const base = global.fetch;
    global.fetch = vi.fn((url, init) => {
      if (String(url).endsWith("/api/privilege-mcp/auth/start")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ authUrl: "https://as.test/authorize?x=1" }),
        });
      }
      return base(url, init);
    });
    const assign = vi.fn();
    delete window.location;
    window.location = { href: "", assign };

    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: /re-arm gateway session/i }));

    await vi.waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/privilege-mcp/auth/start"),
        expect.objectContaining({ method: "POST" }),
      );
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd demo_api_ui && npx vitest run src/pages/__tests__/PrivilegeMcpClientPage.gatewaySession.test.jsx
```

Expected: FAIL — no element matching `/re-arm gateway session/i`.

Note: if `npx vitest` reports `PASS (0)` or pulls a different vitest, run `npm run test:unit -- src/pages/__tests__/PrivilegeMcpClientPage.gatewaySession.test.jsx` instead. In a worktree `npx` can fetch the wrong binary and report zero tests as green.

- [ ] **Step 3: Render the banner**

First confirm `useCallback` and `useState` are already imported at the top of the file — this page is large and already uses both, but check rather than assume:

```bash
cd demo_api_ui && head -5 src/pages/PrivilegeMcpClientPage.jsx
```

If `useCallback` is missing, add it to the existing `import { ... } from "react"` line.

In `PrivilegeMcpClientPage.jsx`, add state for the session (alongside the existing `gatewayMode` state, near line 150):

```jsx
  const [gatewaySession, setGatewaySession] = useState(null);
```

Where `/state` is consumed (the same handler that calls `setGatewayMode`), add:

```jsx
      setGatewaySession(saved.gatewaySession || null);
```

Add the re-arm handler next to the existing `switchGatewayMode`:

```jsx
  // The façade's gateway leg is a server-side token that dies with the BFF
  // process. The gateway offers no client_credentials grant, so only a human
  // browser sign-in can mint a new one — this is that sign-in, one click.
  const rearmGatewaySession = useCallback(async () => {
    const res = await fetch(`${API_BASE}/auth/start`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const data = JSON.parse(await res.text());
    if (data.authUrl) window.location.href = data.authUrl;
  }, []);
```

Render the banner just above the tools panel, gated on façade mode:

```jsx
      {gatewayMode === "facade" && gatewaySession && !gatewaySession.ready && (
        <div className="cur-gw-session-warn" role="status">
          <span className="cur-gw-session-warn__icon" aria-hidden="true">⚠️</span>
          <span>
            Gateway session {gatewaySession.reason === "expired" ? "expired" : "not established"}.
            Façade mode relays on a server-side token that does not survive a restart.
          </span>
          <button type="button" className="cur-gw-session-warn__btn" onClick={rearmGatewaySession}>
            Re-arm gateway session
          </button>
        </div>
      )}
```

- [ ] **Step 4: Style it with theme tokens**

Append to `demo_api_ui/src/pages/PrivilegeMcpClientPage.css`:

```css
/* Gateway session warning — facade mode only. Tokens, not literals: this page
   is themed and a hard-coded amber goes muddy in dark mode. */
.cur-gw-session-warn {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 0.75rem;
  margin: 0 0 0.75rem;
  border: 1px solid var(--th-warn-border, var(--th-border));
  border-radius: 6px;
  background: var(--th-warn-bg, var(--th-surface-2));
  color: var(--th-text);
  font-size: var(--font-size-xs);
}

.cur-gw-session-warn__icon {
  flex: 0 0 auto;
}

.cur-gw-session-warn__btn {
  margin-left: auto;
  flex: 0 0 auto;
  padding: 0.25rem 0.6rem;
  border: 1px solid var(--th-border);
  border-radius: 4px;
  background: var(--th-surface);
  color: var(--th-text);
  cursor: pointer;
}

.cur-gw-session-warn__btn:hover {
  background: var(--th-surface-2);
}
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
cd demo_api_ui && npm run test:unit -- src/pages/__tests__/PrivilegeMcpClientPage.gatewaySession.test.jsx
```

Expected: PASS, 4 tests.

- [ ] **Step 6: Verify the theme tokens actually resolve**

The `--th-warn-*` tokens may not exist. Confirm before committing:

```bash
cd demo_api_ui && grep -rn "th-warn-bg\|th-warn-border" src/styles src/theme | head
```

If they do not exist, the `var(--th-…, fallback)` second argument already covers it — leave as written. If they do exist, drop the fallbacks.

- [ ] **Step 7: Build gate**

```bash
cd demo_api_ui && npm run build
```

Expected: build succeeds. A green test run is not the gate; the build is.

- [ ] **Step 8: Commit**

```bash
git add demo_api_ui/src/pages/PrivilegeMcpClientPage.jsx demo_api_ui/src/pages/PrivilegeMcpClientPage.css demo_api_ui/src/pages/__tests__/PrivilegeMcpClientPage.gatewaySession.test.jsx
git commit -m "feat(privilege-mcp): warn and offer re-arm when the gateway session is dead"
```

---

### Task 3: Fix `DELETE` for multi-app façade doors

**Files:**
- Modify: `demo_api_server/routes/mcpFacade.js:871-887` (the `router.delete` handler)
- Test: `demo_api_server/tests/routes/mcpFacade.multiApp.test.js` (extend)

**Interfaces:**
- Consumes: `door.upstreamFor(app)` (defined `mcpFacade.js:192`), `privilegeGatewaySession.getAccessToken()`.
- Produces: nothing other tasks depend on.

**The bug:** `DELETE` is registered only for `/:door/mcp`, so a client tearing down a session on `/mcp-facade/privilege-gateway/opensearch/mcp` gets a 404. When it does match the bare path it calls `req.door.upstream()`, ignoring `req.params.app`, and forwards the caller's bearer rather than the gateway token — so a door with `ownsUpstreamAuth` tears down the *default* app using the *wrong* credential.

- [ ] **Step 1: Write the failing test**

Append to `demo_api_server/tests/routes/mcpFacade.multiApp.test.js`:

```js
const privilegeGatewaySession = require('../../services/privilegeGatewaySession');

describe('DELETE on a multiApp door', () => {
  const realFetch = global.fetch;

  afterEach(() => {
    global.fetch = realFetch;
    privilegeGatewaySession.clear();
  });

  // privilege-gateway is the only multiApp door and it sets ownsUpstreamAuth,
  // so the handler needs a gateway token before it will call upstream at all.
  function armGatewaySession() {
    privilegeGatewaySession.remember({
      accessToken: 'gw-token',
      refreshToken: 'gw-refresh',
      expiresIn: 3600,
      tokenUri: 'https://mcpgw.ai-demo.ping-devops.com/oauth/token',
    });
  }

  it('routes the app segment to the matching upstream instead of 404ing', async () => {
    armGatewaySession();
    const seen = [];
    global.fetch = jest.fn(async (url, init) => {
      seen.push({ url: String(url), method: init?.method, auth: init?.headers?.authorization });
      return { status: 200, headers: new Map(), text: async () => '' };
    });

    await request(app)
      .delete('/mcp-facade/privilege-gateway/opensearch/mcp')
      .set('mcp-session-id', 'sess-1')
      .expect(200);

    expect(seen).toHaveLength(1);
    expect(seen[0].method).toBe('DELETE');
    expect(seen[0].url).toContain('/opensearch/mcp');
    // The door owns its upstream auth: the gateway token, not the caller's.
    expect(seen[0].auth).toBe('Bearer gw-token');
  });

  it('tears down locally and does not call upstream when no gateway session exists', async () => {
    privilegeGatewaySession.clear();
    global.fetch = jest.fn();

    await request(app)
      .delete('/mcp-facade/privilege-gateway/opensearch/mcp')
      .set('mcp-session-id', 'sess-2')
      .expect(200);

    // A missing gateway session is not a reason to fail a teardown — the local
    // entry is dropped and the upstream session lapses on its own.
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('rejects an app segment on a door that takes none', async () => {
    await request(app)
      .delete('/mcp-facade/banking/nope/mcp')
      .expect(404);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd demo_api_server && CI=true npx jest tests/routes/mcpFacade.multiApp.test.js --forceExit
```

Expected: FAIL — the first new test gets 404 because the route is not registered for the app path.

- [ ] **Step 3: Fix the handler**

Replace the `router.delete('/:door/mcp', ...)` handler in `demo_api_server/routes/mcpFacade.js` with:

```js
// Both shapes, same as POST: a multiApp door's teardown must reach the app the
// client actually used. Registering only the bare path 404'd every app-scoped
// DELETE, and resolving with upstream() tore down the DEFAULT app instead.
router.delete(['/:door/mcp', '/:door/:app/mcp'], async (req, res) => {
  if (req.door.localHandler) {
    // Stateless upstream (see pingoneAdminLocalHandler) — nothing to tear
    // down but this door's own local session-tracking entry.
    sessions.delete(req.get('mcp-session-id'));
    return res.status(200).end();
  }
  const upstreamUrl = req.params.app && req.door.upstreamFor
    ? req.door.upstreamFor(req.params.app)
    : req.door.upstream();
  // A door that owns its upstream auth must use the gateway token here too —
  // forwarding the caller's bearer would present the wrong credential.
  let headers = forwardHeaders(req, null);
  if (req.door.ownsUpstreamAuth) {
    const upstreamToken = await privilegeGatewaySession.getAccessToken();
    if (!upstreamToken) {
      sessions.delete(req.get('mcp-session-id'));
      // The local entry is gone and the upstream session will lapse on its own;
      // a missing gateway session is not a reason to fail a teardown.
      return res.status(200).end();
    }
    headers = { ...headers, authorization: `Bearer ${upstreamToken}` };
  }
  try {
    const upstream = await fetch(upstreamUrl, { method: 'DELETE', headers, ...fetchOpts(upstreamUrl) });
    sessions.delete(req.get('mcp-session-id'));
    return res.status(upstream.status).end();
  } catch (err) {
    return res.status(502).json({ error: 'upstream_unavailable', message: err.message });
  }
});
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd demo_api_server && CI=true npx jest tests/routes/mcpFacade.multiApp.test.js --forceExit
```

Expected: PASS.

- [ ] **Step 5: Run the whole façade suite — this handler is shared by every door**

```bash
cd demo_api_server && CI=true npx jest tests/routes/mcpFacade --forceExit
```

Expected: PASS across `mcpFacade.test.js`, `mcpFacade.multiApp.test.js`, `mcpFacade.privilegeGatewayDoor.test.js`, `mcpFacadeAuditDoor.test.js`, `mcpFacadeDirectSiblingDoors.test.js`, `mcpFacadeModernHeaders.test.js`, `mcpFacadeOpensearchDoor.test.js`.

- [ ] **Step 6: Commit**

```bash
git add demo_api_server/routes/mcpFacade.js demo_api_server/tests/routes/mcpFacade.multiApp.test.js
git commit -m "fix(mcp-facade): route DELETE to the app segment and use the gateway token"
```

---

### Task 4: Preflight classification library

The network part of a preflight cannot be unit-tested. The decision part can, and that is where the bugs live: deciding whether a 401 means "healthy, wants auth" or "broken". This task builds only the pure part.

**Files:**
- Create: `scripts/lib/preflightRows.js`
- Test: `scripts/check-mcp-preflight.test.js` (create)

**Interfaces:**
- Produces, both consumed by Task 5:
  - `classifyProbe({ status, error })` → `{ state: 'ok' | 'auth' | 'down' | 'unreachable', note: string }`
  - `renderTable(rows)` → `string`, where `rows` is `Array<{ label: string, url: string, state: string, note: string }>`
  - `exitCodeFor(rows)` → `0 | 1`

**Classification rules, and why:**
- `200` → `ok`.
- `401` → `auth`, **not** an error. Every Privilege door 401s before routing; that is a healthy door demanding a token. Treating it as failure would make the whole table red.
- `403` → `down` with the note "policy denied or lapsed" — a real problem worth surfacing, since a lapsed policy is the most common cause.
- `404` → `down`, "no such door or app".
- `502`/`503`/`504` → `down`, "upstream or rollout" — on SE this is frequently a deploy in flight rather than a defect, so the note says so.
- network error → `unreachable`, carrying the error text.
- **`auth` counts as pass** for the exit code. An unauthenticated preflight can prove reachability, DNS and TLS; it cannot prove authorization. Claiming otherwise would be the "green probe is not a correct probe" failure.

- [ ] **Step 1: Write the failing test**

Create `scripts/check-mcp-preflight.test.js`:

```js
#!/usr/bin/env node
/**
 * Tests for the MCP door preflight's pure decision logic.
 * Run: node --test scripts/check-mcp-preflight.test.js
 *
 * node:test rather than jest, matching the other root-level gates: this file
 * sits at the repo root where CI installs no jest.
 *
 * The classification is the part worth pinning. A 401 from the Privilege AI
 * Gateway is a HEALTHY door demanding a token — the gateway 401s before it
 * routes, so even a nonexistent app answers 401. Calling that a failure paints
 * every row red; calling it a full pass would claim an authorization proof this
 * probe cannot make. It is its own state.
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { classifyProbe, renderTable, exitCodeFor } = require('./lib/preflightRows');

describe('classifyProbe', () => {
  it('treats 200 as ok', () => {
    assert.equal(classifyProbe({ status: 200 }).state, 'ok');
  });

  it('treats 401 as auth, not a failure — the gateway 401s before routing', () => {
    assert.equal(classifyProbe({ status: 401 }).state, 'auth');
  });

  it('treats 403 as down and names a lapsed policy as the likely cause', () => {
    const row = classifyProbe({ status: 403 });
    assert.equal(row.state, 'down');
    assert.match(row.note, /polic/i);
  });

  it('treats 404 as down', () => {
    assert.equal(classifyProbe({ status: 404 }).state, 'down');
  });

  it('treats 502 as down and names a rollout as a possible cause', () => {
    const row = classifyProbe({ status: 502 });
    assert.equal(row.state, 'down');
    assert.match(row.note, /rollout|upstream/i);
  });

  it('treats a network error as unreachable and keeps the message', () => {
    const row = classifyProbe({ error: 'getaddrinfo ENOTFOUND nope.test' });
    assert.equal(row.state, 'unreachable');
    assert.match(row.note, /ENOTFOUND/);
  });
});

describe('exitCodeFor', () => {
  it('passes when every row is ok or auth', () => {
    assert.equal(exitCodeFor([{ state: 'ok' }, { state: 'auth' }]), 0);
  });

  it('fails when any row is down', () => {
    assert.equal(exitCodeFor([{ state: 'ok' }, { state: 'down' }]), 1);
  });

  it('fails when any row is unreachable', () => {
    assert.equal(exitCodeFor([{ state: 'unreachable' }]), 1);
  });
});

describe('renderTable', () => {
  it('renders one line per row including the label and the state', () => {
    const out = renderTable([
      { label: 'Direct — banking', url: 'https://a.test/mcp', state: 'ok', note: '' },
      { label: 'Privilege — brave', url: 'https://b.test/mcp', state: 'down', note: 'policy' },
    ]);
    assert.match(out, /Direct — banking/);
    assert.match(out, /Privilege — brave/);
    assert.match(out, /down/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
node --test scripts/check-mcp-preflight.test.js
```

Expected: FAIL — `Cannot find module './lib/preflightRows'`.

- [ ] **Step 3: Write the library**

Create `scripts/lib/preflightRows.js`:

```js
'use strict';

/*
 * Pure decision logic for the MCP door preflight (scripts/check-mcp-preflight.js).
 * Split out so it can be tested without a network.
 *
 * The load-bearing judgement is what a 401 means. The Privilege AI Gateway
 * answers 401 BEFORE it routes, so a nonexistent app name returns 401 exactly
 * like a real one — verified live 2026-09-04. An unauthenticated probe can
 * therefore prove DNS, TLS and reachability, and nothing about authorization.
 * `auth` is its own state for that reason: it passes the gate, and it never
 * claims the door actually works for a real caller.
 */

const PASSING = new Set(['ok', 'auth']);

/** @returns {{state: 'ok'|'auth'|'down'|'unreachable', note: string}} */
function classifyProbe({ status, error } = {}) {
  if (error) return { state: 'unreachable', note: String(error).slice(0, 160) };
  if (status === 200) return { state: 'ok', note: '' };
  if (status === 401) return { state: 'auth', note: 'reachable; wants a token' };
  if (status === 403) return { state: 'down', note: 'forbidden — policy denied or lapsed' };
  if (status === 404) return { state: 'down', note: 'no such door or app' };
  if (status === 502 || status === 503 || status === 504) {
    return { state: 'down', note: `${status} — upstream down or a rollout in flight` };
  }
  return { state: 'down', note: `unexpected status ${status}` };
}

const MARK = { ok: '✅', auth: '✅', down: '❌', unreachable: '❌' };

function renderTable(rows) {
  const width = rows.reduce((w, r) => Math.max(w, r.label.length), 0);
  return rows
    .map((r) => {
      const mark = MARK[r.state] || '❌';
      const note = r.note ? `  ${r.note}` : '';
      return `${mark} ${r.label.padEnd(width)}  ${r.state.padEnd(11)}${note}`;
    })
    .join('\n');
}

function exitCodeFor(rows) {
  return rows.every((r) => PASSING.has(r.state)) ? 0 : 1;
}

module.exports = { classifyProbe, renderTable, exitCodeFor };
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
node --test scripts/check-mcp-preflight.test.js
```

Expected: PASS, 13 tests.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/preflightRows.js scripts/check-mcp-preflight.test.js
git commit -m "feat(preflight): pure classification for MCP door probes"
```

---

### Task 5: The preflight CLI

**Files:**
- Create: `scripts/check-mcp-preflight.js`
- Modify: `package.json` (add one script)

**Interfaces:**
- Consumes: `classifyProbe`, `renderTable`, `exitCodeFor` from `scripts/lib/preflightRows.js` (Task 4).
- Produces: `npm run demo:preflight -- --target local|se`, exit 0 when every row is `ok` or `auth`.

- [ ] **Step 1: Write the CLI**

Create `scripts/check-mcp-preflight.js`:

```js
#!/usr/bin/env node
'use strict';

/*
 * Is every MCP door actually answering, right now?
 *
 *   npm run demo:preflight -- --target se
 *   npm run demo:preflight -- --target local
 *
 * Run this before a demo. It probes each door's RFC 9728 metadata endpoint,
 * which is unauthenticated, so a red row is infrastructure — DNS, TLS, a dead
 * pod, a rollout in flight — not a policy question.
 *
 * What it deliberately does NOT prove: that a real caller can invoke a tool.
 * The Privilege gateway 401s before routing (see lib/preflightRows.js), so
 * authorization can only be checked with a token. The page's own preflight
 * panel does that half, using the operator's live session.
 */

const { classifyProbe, renderTable, exitCodeFor } = require('./lib/preflightRows');

const TARGETS = {
  local: {
    // The BFF, not the UI. Both /mcp-facade (server.js:1433) and
    // /api/privilege-mcp (server.js:1240) are mounted on the BFF, which serves
    // :3001; nothing proxies /mcp-facade on :4000. The mkcert cert covers
    // `localhost`, so this needs no /etc/hosts entry.
    facadeBase: 'https://localhost:3001',
    gatewayBase: 'https://mcpgw.ai-demo.ping-devops.com',
  },
  se: {
    facadeBase: 'https://ai-demo.ping-devops.com',
    gatewayBase: 'https://mcpgw.ai-demo.ping-devops.com',
  },
};

// Façade doors worth checking before a demo. Dark doors (agentless, agent,
// agent-cmuir) are omitted on purpose — they point at torn-down infrastructure
// by design (TECH_DEBT.md 2026-09-01) and would be permanently red.
const FACADE_DOORS = ['agent-gateway', 'opensearch', 'brave', 'banking', 'privilege-gateway'];

// Agentic Apps registered on the AI Gateway. Hardcoded here on purpose for now:
// Plan B (W8) replaces this with the console inventory, and this list is what
// that change is measured against.
const GATEWAY_APPS = ['opensearch22', 'opensearch', 'brave'];

const TIMEOUT_MS = 15000;

async function probe(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal, redirect: 'manual' });
    return { status: res.status };
  } catch (err) {
    return { error: err.name === 'AbortError' ? `timeout after ${TIMEOUT_MS}ms` : err.message };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Read the façade's gateway-session state from /state (not auth-gated) and turn
 * it into a row. A dead session is the single most likely reason the Privilege
 * façade door fails in LM Studio, and it is invisible from the outside.
 */
async function gatewaySessionRow(facadeBase) {
  const label = 'Façade gateway session';
  const url = `${facadeBase}/api/privilege-mcp/state`;
  try {
    const res = await fetch(url);
    if (!res.ok) {
      return { label, url, state: 'down', note: `/state returned ${res.status}` };
    }
    const body = await res.json();
    const s = body.gatewaySession;
    if (!s) {
      return { label, url, state: 'down', note: '/state has no gatewaySession — is Plan A Task 1 deployed?' };
    }
    if (s.ready) {
      return { label, url, state: 'ok', note: s.reason === 'refreshable' ? 'lapsed but refreshable' : 'armed' };
    }
    return {
      label,
      url,
      state: 'down',
      note: `${s.reason} — sign in once at /privilege-mcp-client to re-arm`,
    };
  } catch (err) {
    return { label, url, state: 'unreachable', note: String(err.message).slice(0, 160) };
  }
}

async function main() {
  const argv = process.argv.slice(2);
  const idx = argv.indexOf('--target');
  const targetName = idx >= 0 ? argv[idx + 1] : 'se';
  const target = TARGETS[targetName];
  if (!target) {
    console.error(`Unknown target "${targetName}". Use one of: ${Object.keys(TARGETS).join(', ')}`);
    process.exit(2);
  }

  const checks = [
    ...FACADE_DOORS.map((door) => ({
      label: `Façade — ${door}`,
      url: `${target.facadeBase}/mcp-facade/${door}/.well-known/oauth-protected-resource`,
    })),
    ...GATEWAY_APPS.map((app) => ({
      label: `Privilege — ${app}`,
      url: `${target.gatewayBase}/${app}/mcp`,
    })),
    {
      label: 'Broker AS metadata',
      url: `${target.facadeBase}/.well-known/oauth-authorization-server`,
    },
  ];

  const rows = [];
  for (const check of checks) {
    const result = await probe(check.url);
    rows.push({ ...check, ...classifyProbe(result) });
  }

  // The gateway session is the thing most likely to be quietly dead before a
  // demo: it lives in BFF memory and does not survive a restart. /state is not
  // auth-gated, so the CLI can read it without a session of its own.
  rows.push(await gatewaySessionRow(target.facadeBase));

  console.log(`\nMCP preflight — target ${targetName}\n`);
  console.log(renderTable(rows));

  const code = exitCodeFor(rows);
  console.log(
    code === 0
      ? '\nAll doors answering. "reachable; wants a token" is a pass — this probe is unauthenticated.\n'
      : '\n⚠️  One or more doors are down. On SE, check for a rollout in flight before treating it as a defect.\n',
  );
  process.exit(code);
}

main();
```

- [ ] **Step 2: Add the npm script**

In root `package.json`, add to `"scripts"`:

```json
    "demo:preflight": "node scripts/check-mcp-preflight.js",
```

- [ ] **Step 3: Run it against SE**

```bash
npm run demo:preflight -- --target se
```

Expected: a table of ten rows — five façade doors `ok` (their metadata endpoint is unauthenticated), three Privilege apps `auth`, the broker AS `ok`, and the gateway-session row, which will be `down` with `no_session` unless somebody has signed in since the last BFF restart. That last row being red on a fresh deploy is the correct result, not a bug.

**Deliberately not covered by this CLI, and why:**
- **The LLM lanes** (spec W1) — they need the virtual keys, which Plan C wires up. Add those rows in Plan C.
- **Pod readiness on SE** — left as the manual `kubectl` check in Step 4 rather than shelling out from Node, so the script has no `kubectl` dependency and runs anywhere.
- **The cross-namespace OpenSearch backend** — only reachable from inside the cluster, so an external probe cannot see it. The `Façade — opensearch` row covers it transitively.

**Do not pipe this command.** `cmd | tail` exits with `tail`'s status, so a failing preflight would read as exit 0. If you need to capture output, redirect to a file and read the file.

- [ ] **Step 4: Record the real result**

Paste the actual table into the commit message or the PR. If a row is red, confirm whether a rollout is in flight before treating it as a defect:

```bash
kubectl --context us -n ping-devops-cmuir get pods --sort-by=.status.startTime | tail -8
```

Note: `kubectl get pods -l app=demo-api-server` returns nothing — that label does not exist on this deployment. Use the unfiltered listing.

- [ ] **Step 5: Run it against local**

The local stack serves mkcert certificates. Node does **not** use the macOS system trust store — it ships its own CA bundle — so `fetch` rejects mkcert with `unable to verify the first certificate` even though a browser and `curl` both accept it. Point Node at the mkcert root:

```bash
NODE_EXTRA_CA_CERTS="$(mkcert -CAROOT)/rootCA.pem" npm run demo:preflight -- --target local
```

Expected: the same shape as the SE run. If the local Docker stack is not running, every façade row is `unreachable` — that is correct behaviour, not a bug in the script.

Do **not** work around this with `NODE_TLS_REJECT_UNAUTHORIZED=0`. It disables verification for every request the process makes, which would turn a real TLS failure into a silent pass — the exact class of false green this whole preflight exists to prevent.

- [ ] **Step 5b: Document the local invocation**

Add the `NODE_EXTRA_CA_CERTS` form to the CLI's header comment so the next person does not rediscover it:

```js
 *   npm run demo:preflight -- --target se
 *   NODE_EXTRA_CA_CERTS="$(mkcert -CAROOT)/rootCA.pem" npm run demo:preflight -- --target local
```

- [ ] **Step 6: Re-run the unit tests**

```bash
node --test scripts/check-mcp-preflight.test.js
```

Expected: PASS, 13 tests.

- [ ] **Step 7: Commit**

```bash
git add scripts/check-mcp-preflight.js package.json
git commit -m "feat(preflight): npm run demo:preflight for local and SE targets"
```

---

### Task 6: Preflight panel on the page

The CLI proves reachability. This panel proves the authenticated half, using the operator's live session and the door probe endpoint that already exists.

**Files:**
- Modify: `demo_api_ui/src/pages/PrivilegeMcpClientPage.jsx`
- Modify: `demo_api_ui/src/pages/PrivilegeMcpClientPage.css`
- Test: `demo_api_ui/src/pages/__tests__/PrivilegeMcpClientPage.preflight.test.jsx` (create)

**Interfaces:**
- Consumes: `state.presets` (`Array<{ label, mode, url }>`) and `state.gatewaySession` from `/state`; `POST /api/privilege-mcp/doors/probe` with `{ urls: string[] }` returning `{ results: Array<{ url, ok, tools?, status?, error? }> }`.
- Produces: nothing other tasks depend on.

**Note on the existing endpoint:** `/doors/probe` caps the fan-out at 12 URLs and skips the currently-selected door (`u !== session.config.mcpUrl`). Both are fine here — the current door's state is already visible on the page.

- [ ] **Step 1: Write the failing test**

Create `demo_api_ui/src/pages/__tests__/PrivilegeMcpClientPage.preflight.test.jsx`:

```jsx
// demo_api_ui/src/pages/__tests__/PrivilegeMcpClientPage.preflight.test.jsx
// The CLI preflight proves doors are reachable. It cannot prove a real caller
// can invoke a tool, because the gateway 401s before routing. This panel does
// that half with the operator's own session, via the existing /doors/probe.
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import PrivilegeMcpClientPage from "../PrivilegeMcpClientPage";

vi.mock("../../services/apiClient", () => ({
  default: { get: vi.fn(() => new Promise(() => {})), post: vi.fn(() => new Promise(() => {})) },
}));

const PRESETS = [
  { label: "Privilege — opensearch", mode: "privilege", url: "https://gw.test/opensearch/mcp" },
  { label: "Privilege — brave", mode: "privilege", url: "https://gw.test/brave/mcp" },
];

beforeEach(() => {
  global.EventSource = class {
    addEventListener() {}
    close() {}
  };
  global.fetch = vi.fn((url) => {
    if (String(url).endsWith("/api/privilege-mcp/state")) {
      return Promise.resolve({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            config: { mcpUrl: "https://gw.test/opensearch22/mcp", clientId: "", scopes: "" },
            gatewayMode: "privilege",
            gatewayConfigs: {},
            oauth: { authenticated: true },
            mainAppAuthenticated: true,
            tools: [],
            presets: PRESETS,
            gatewaySession: { ready: true },
          }),
      });
    }
    if (String(url).endsWith("/api/privilege-mcp/doors/probe")) {
      return Promise.resolve({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            results: [
              { url: PRESETS[0].url, ok: true, tools: 7 },
              { url: PRESETS[1].url, ok: false, status: 403, error: "Forbidden" },
            ],
          }),
      });
    }
    return new Promise(() => {});
  });
});

function renderPage() {
  render(
    <MemoryRouter initialEntries={["/privilege-mcp-client"]}>
      <PrivilegeMcpClientPage />
    </MemoryRouter>,
  );
}

describe("preflight panel", () => {
  it("probes every preset door and shows tool counts and failures", async () => {
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: /run preflight/i }));

    expect(await screen.findByText(/7 tools/i)).toBeInTheDocument();
    expect(await screen.findByText(/Forbidden/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd demo_api_ui && npm run test:unit -- src/pages/__tests__/PrivilegeMcpClientPage.preflight.test.jsx
```

Expected: FAIL — no "Run preflight" button.

- [ ] **Step 3: Implement the panel**

Add state near the other page state in `PrivilegeMcpClientPage.jsx`:

```jsx
  const [preflight, setPreflight] = useState(null);
  const [preflightBusy, setPreflightBusy] = useState(false);
```

Add the handler beside `rearmGatewaySession`:

```jsx
  // Reuses /doors/probe — it already initializes an MCP session per URL with
  // the operator's token and returns a tool count, which is the only honest
  // proof a door works for a real caller.
  const runPreflight = useCallback(async () => {
    setPreflightBusy(true);
    try {
      const urls = presets.map((p) => p.url).filter(Boolean);
      const res = await fetch(`${API_BASE}/doors/probe`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ urls }),
      });
      const data = JSON.parse(await res.text());
      setPreflight(data.results || []);
    } finally {
      setPreflightBusy(false);
    }
  }, [presets]);
```

Render it (place it above the tools panel, below the gateway session banner from Task 2):

```jsx
      <div className="cur-preflight">
        <button type="button" className="cur-preflight__run" onClick={runPreflight} disabled={preflightBusy}>
          {preflightBusy ? "Probing…" : "Run preflight"}
        </button>
        {preflight && (
          <ul className="cur-preflight__list">
            {preflight.map((r) => (
              <li key={r.url} className={r.ok ? "cur-preflight__row--ok" : "cur-preflight__row--bad"}>
                <span aria-hidden="true">{r.ok ? "✅" : "❌"}</span>
                <span className="cur-preflight__url">{r.url}</span>
                <span>{r.ok ? `${r.tools} tools` : `${r.status || ""} ${r.error || ""}`.trim()}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
```

- [ ] **Step 4: Style it**

Append to `PrivilegeMcpClientPage.css`:

```css
/* Preflight panel — token-based like the rest of this page. */
.cur-preflight {
  margin: 0 0 0.75rem;
}

.cur-preflight__run {
  padding: 0.3rem 0.7rem;
  border: 1px solid var(--th-border);
  border-radius: 4px;
  background: var(--th-surface);
  color: var(--th-text);
  cursor: pointer;
}

.cur-preflight__run:disabled {
  cursor: default;
  opacity: 0.7;
}

.cur-preflight__list {
  list-style: none;
  margin: 0.5rem 0 0;
  padding: 0;
  font-size: var(--font-size-xs);
}

.cur-preflight__list li {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.2rem 0;
  color: var(--th-text);
}

.cur-preflight__url {
  flex: 1 1 auto;
  overflow-wrap: anywhere;
}

.cur-preflight__row--bad {
  color: var(--th-danger, var(--th-text));
}
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
cd demo_api_ui && npm run test:unit -- src/pages/__tests__/PrivilegeMcpClientPage.preflight.test.jsx
```

Expected: PASS.

- [ ] **Step 6: Run the whole page suite — this file has 14 existing specs**

```bash
cd demo_api_ui && npm run test:unit -- src/pages/__tests__/PrivilegeMcpClientPage
```

Expected: PASS across all of them.

- [ ] **Step 7: Build gate**

```bash
cd demo_api_ui && npm run build
```

Expected: build succeeds.

- [ ] **Step 8: Commit**

```bash
git add demo_api_ui/src/pages/PrivilegeMcpClientPage.jsx demo_api_ui/src/pages/PrivilegeMcpClientPage.css demo_api_ui/src/pages/__tests__/PrivilegeMcpClientPage.preflight.test.jsx
git commit -m "feat(privilege-mcp): preflight panel probing every preset door"
```

---

## Final verification

- [ ] **Server tests for everything touched**

```bash
cd demo_api_server && CI=true npx jest tests/routes/privilegeMcpClient tests/routes/mcpFacade --forceExit
```

- [ ] **Script tests**

```bash
node --test scripts/check-mcp-preflight.test.js
```

- [ ] **UI tests and the build gate**

```bash
cd demo_api_ui && npm run test:unit && npm run build
```

- [ ] **Live preflight against both targets, results pasted, not summarised**

```bash
npm run demo:preflight -- --target se
npm run demo:preflight -- --target local
```

- [ ] **The one manual check this plan exists for**

1. Restart the BFF (locally: `docker restart ai-demo-api-server`).
2. Open `/privilege-mcp-client` and switch to Façade mode.
3. Confirm the warning banner appears saying the gateway session is not established.
4. Click **Re-arm gateway session**, complete the PingOne sign-in.
5. Confirm the banner disappears and **Run preflight** shows the façade door returning a tool count.

Before and after any live UI drive, pin the stack generation — another session recreating the stack mid-run looks exactly like an application bug:

```bash
gen="$(npm run -s stack:generation)"
# ... drive the UI ...
npm run -s stack:generation -- --check "$gen"
```

A non-zero `--check` means the run is void, not that you found a defect.
