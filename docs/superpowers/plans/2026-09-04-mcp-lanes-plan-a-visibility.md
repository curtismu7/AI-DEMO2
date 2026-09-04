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

- [x] **Step 1: Write the failing test** — DONE

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

    // Specific wording, not /gateway session/i — that also matches the button.
    expect(await screen.findByText(/gateway session not established/i)).toBeInTheDocument();
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

  // The load-bearing behaviour: re-arm must go through PRIVILEGE mode.
  // privilegeMcpClient.js only remembers the gateway session when the token
  // exchange hit the real gateway's token endpoint. A Façade-mode sign-in mints
  // a broker token that is deliberately not remembered, so re-arming without
  // the mode switch would authenticate and arm nothing — a dead-end button.
  it("re-arm switches to privilege mode before authenticating", async () => {
    mockState({ gatewayMode: "facade", gatewaySession: { ready: false, reason: "expired" } });
    const base = global.fetch;
    const posted = [];
    global.fetch = vi.fn((url, init) => {
      const u = String(url);
      if (u.endsWith("/api/privilege-mcp/config")) {
        posted.push(JSON.parse(init.body));
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ oauth: { authenticated: false } }),
        });
      }
      if (u.endsWith("/api/privilege-mcp/auth/start")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ authUrl: "https://as.test/authorize?x=1" }),
        });
      }
      return base(url, init);
    });

    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: /re-arm gateway session/i }));

    await vi.waitFor(() => {
      expect(posted.some((b) => b.gatewayMode === "privilege")).toBe(true);
    });
  });
});
```

- [x] **Step 2: Run the test to verify it fails** — DONE (reverting only the JSX fails the 2 positive tests; the 2 negative ones pass vacuously by design)

```bash
cd demo_api_ui && npx vitest run src/pages/__tests__/PrivilegeMcpClientPage.gatewaySession.test.jsx
```

Expected: FAIL — no element matching `/re-arm gateway session/i`.

Note: if `npx vitest` reports `PASS (0)` or pulls a different vitest, run `npm run test:unit -- src/pages/__tests__/PrivilegeMcpClientPage.gatewaySession.test.jsx` instead. In a worktree `npx` can fetch the wrong binary and report zero tests as green.

- [x] **Step 3: Render the banner** — DONE

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
  // process, and the gateway offers no client_credentials grant — only a human
  // browser sign-in can mint a new one.
  //
  // It MUST be a Privilege-mode sign-in. privilegeMcpClient.js only remembers
  // the gateway session when the token exchange hit the real gateway's own
  // token endpoint (tokenOrigin === gatewayOrigin). A Façade-mode sign-in mints
  // a token from OUR broker, whose resource identifier collides by name with
  // the real gateway's, and is deliberately NOT remembered — so re-arming from
  // Façade mode would authenticate successfully and arm nothing.
  const rearmGatewaySession = useCallback(() => switchGatewayMode("privilege"), [switchGatewayMode]);
```

`switchGatewayMode` already posts `/config` with the new mode and then redirects to `/auth/start`'s `authUrl`, which is exactly the flow needed. Do not call `/auth/start` directly.

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

- [x] **Step 4: Style it with theme tokens** — DONE

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
  border: 1px solid var(--th-status-warning-border);
  border-radius: 6px;
  background: var(--th-status-warning-bg);
  color: var(--th-status-warning-text);
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
  background: var(--th-bg-card);
  color: var(--th-text);
  cursor: pointer;
}

.cur-gw-session-warn__btn:hover {
  background: var(--th-bg-hover);
}
```

- [x] **Step 5: Run the test to verify it passes** — DONE, 7 tests (4 planned + 3 error-path)

```bash
cd demo_api_ui && npm run test:unit -- src/pages/__tests__/PrivilegeMcpClientPage.gatewaySession.test.jsx
```

Expected: PASS, 4 tests.

- [x] **Step 6: Verify the theme tokens actually resolve** — DONE, and they did not

`--th-warn-bg`/`--th-warn-border` do not exist; nor do `--th-surface`/`--th-surface-2`.
The only grep hit was a stale comment in `EnterpriseMcpDemoPage.css` listing invented
names. The real tokens, defined in **both** the light and dark blocks of `src/index.css`,
are `--th-status-warning-{bg,border,text}`, `--th-bg-card`, `--th-bg-hover`,
`--th-status-error`, `--font-size-2xs`. Step 4 above is corrected to use them with no
fallbacks. **Any later task styling this page must grep `src/index.css` for the
definition before using a `--th-*` name** — never trust a name quoted in another page's
comment.

- [x] **Step 7: Build gate** — DONE, `npm run build` exit 0

```bash
cd demo_api_ui && npm run build
```

Expected: build succeeds. A green test run is not the gate; the build is.

- [x] **Step 8: Commit** — DONE

**Hardening added beyond the plan (error handling).** Three defects the plan's happy
path did not cover, all fixed at the shared function rather than at the banner:

1. `window.location.href = data.authUrl` appeared at **five** call sites with no guard.
   A 200 with no `authUrl` navigated the browser to the literal string `"undefined"` —
   blank page, nothing logged. All five now go through `startAuthRedirect()`, which
   throws instead.
2. `switchGatewayMode` returned early when `saved.oauth?.authenticated` — so re-arm
   would switch mode, arm nothing, and say nothing whenever a restored token slot
   outlived the gateway-session singleton. Re-arm now passes `{ forceReauth: true }`,
   which skips that shortcut. This is Ruling 5's dead-end button by a second route.
3. The mode was set optimistically and never reverted on failure, so a failed switch
   left the UI claiming a mode the BFF rejected — and unmounted the façade-only banner,
   taking the error with it. The catch now restores the previous mode and config, and
   returns the message so the banner renders it inline (`role="alert"`).

The button is `disabled` while a switch is in flight.

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

- [x] **Step 1: Write the failing test** — DONE

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

- [x] **Step 2: Run the test to verify it fails** — DONE, 5 of 6 new tests red

```bash
cd demo_api_server && CI=true npx jest tests/routes/mcpFacade.multiApp.test.js --forceExit
```

Expected: FAIL — the first new test gets 404 because the route is not registered for the app path.

- [x] **Step 3: Fix the handler** — DONE

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

- [x] **Step 4: Run the test to verify it passes** — DONE, 14/14

```bash
cd demo_api_server && CI=true npx jest tests/routes/mcpFacade.multiApp.test.js --forceExit
```

Expected: PASS.

- [x] **Step 5: Run the whole façade suite — this handler is shared by every door** — DONE, 7 suites / 79 tests

```bash
cd demo_api_server && CI=true npx jest tests/routes/mcpFacade --forceExit
```

Expected: PASS across `mcpFacade.test.js`, `mcpFacade.multiApp.test.js`, `mcpFacade.privilegeGatewayDoor.test.js`, `mcpFacadeAuditDoor.test.js`, `mcpFacadeDirectSiblingDoors.test.js`, `mcpFacadeModernHeaders.test.js`, `mcpFacadeOpensearchDoor.test.js`.

- [x] **Step 6: Commit** — DONE

**Two deviations from the plan as written.**

1. *Test style.* The plan mocked `global.fetch`. `mcpFacade.multiApp.test.js` does not
   work that way — it stands up a real `http` server and asserts on `seenPath`. The new
   tests follow the file's convention (extended with `seenMethod`/`seenAuth`), so they
   exercise the real `fetch` + `fetchOpts` path rather than a stub of it. The plan's
   `armGatewaySession()` helper was unnecessary: the file's `beforeEach` already arms
   the session, and `remember()` takes no `refreshToken` for this purpose.
2. *`sessions.delete` moved to a `finally`.* The original deleted the local entry only
   after a resolved `fetch`, so a 502 left the entry behind — the client has torn down
   its side and will never retry, leaking a slot out of the bounded session map for the
   life of the process. Covered by the sixth test, which points the gateway base at a
   dead port.

Also added beyond the plan's three cases: an invalid-app-name DELETE (proving
`router.param('app')`'s traversal guard covers the new route shape, not just POST) and
a bare-door teardown that was already green and stays as the regression guard.

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

- [x] **Step 1: Write the failing test** — DONE

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

- [x] **Step 2: Run the test to verify it fails** — DONE, module not found

```bash
node --test scripts/check-mcp-preflight.test.js
```

Expected: FAIL — `Cannot find module './lib/preflightRows'`.

- [x] **Step 3: Write the library** — DONE

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

- [x] **Step 4: Run the test to verify it passes** — DONE, 14 tests / 3 suites, 0 fail

```bash
node --test scripts/check-mcp-preflight.test.js
```

Expected: PASS, 13 tests.

- [x] **Step 5: Commit** — DONE

**Three cases added beyond the plan, all of them false-green guards** — the same
"a green probe is not a correct probe" failure this plan exists to prevent:

- `exitCodeFor([])` returned **0**, because `[].every()` is true. A door config that
  resolved to zero rows would have reported a clean preflight. It now returns 1, and
  `renderTable([])` says `no doors probed` instead of printing an empty string that
  reads like a clean run.
- `classifyProbe()` / `classifyProbe({})` — a probe that produced no status at all is
  classified `down`, not silently anything else.
- `classifyProbe({ error })` handles an `Error` as well as a string. A rejected `fetch`
  carries an Error, and `String(err)` would have prefixed every note with `Error: `;
  the message is now taken from `.message`. **Task 5 must pass the error through as it
  comes** — no pre-stringifying.

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

- [x] **Step 1: Write the CLI** — DONE

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

- [x] **Step 2: Add the npm script** — DONE

In root `package.json`, add to `"scripts"`:

```json
    "demo:preflight": "node scripts/check-mcp-preflight.js",
```

- [x] **Step 3: Run it against SE** — DONE

```bash
npm run demo:preflight -- --target se
```

Expected: a table of ten rows — five façade doors `ok` (their metadata endpoint is unauthenticated), three Privilege apps `auth`, the broker AS `ok`, and the gateway-session row, which will be `down` with `no_session` unless somebody has signed in since the last BFF restart. That last row being red on a fresh deploy is the correct result, not a bug.

**Deliberately not covered by this CLI, and why:**
- **The LLM lanes** (spec W1) — they need the virtual keys, which Plan C wires up. Add those rows in Plan C.
- **Pod readiness on SE** — left as the manual `kubectl` check in Step 4 rather than shelling out from Node, so the script has no `kubectl` dependency and runs anywhere.
- **The cross-namespace OpenSearch backend** — only reachable from inside the cluster, so an external probe cannot see it. The `Façade — opensearch` row covers it transitively.

**Do not pipe this command.** `cmd | tail` exits with `tail`'s status, so a failing preflight would read as exit 0. If you need to capture output, redirect to a file and read the file.

- [x] **Step 4: Record the real result** — DONE

SE (`npm run demo:preflight -- --target se`), exit 1:

```
✅ Façade — agent-gateway      ok
✅ Façade — opensearch         ok
✅ Façade — brave              ok
✅ Façade — banking            ok
✅ Façade — privilege-gateway  ok
✅ Privilege — opensearch22    auth         reachable; wants a token
✅ Privilege — opensearch      auth         reachable; wants a token
✅ Privilege — brave           auth         reachable; wants a token
✅ Broker AS metadata          ok
❌ Façade gateway session      down         /state has no gatewaySession — is Plan A Task 1 deployed?
```

The red row is **correct and expected**, not a defect and not a rollout: Task 1's
`/state` key is on this unmerged branch. Verified rather than assumed —
`git branch --contains 5dcd4144d` names only `worktree-mcp-lanes-privilege-llm-spec`,
and the live local `/state` returns `[config, gatewayConfigs, gatewayMode,
mainAppAuthenticated, mcp, oauth, policy, presets, tools, user]` with no
`gatewaySession`. It goes green once this branch merges and deploys. No kubectl
check was needed — nine rows answering rules out a rollout in flight.

Paste the actual table into the commit message or the PR. If a row is red, confirm whether a rollout is in flight before treating it as a defect:

```bash
kubectl --context us -n ping-devops-cmuir get pods --sort-by=.status.startTime | tail -8
```

Note: `kubectl get pods -l app=demo-api-server` returns nothing — that label does not exist on this deployment. Use the unfiltered listing.

- [x] **Step 5: Run it against local** — DONE, identical shape, exit 1

The plan's warning was right and I initially got this wrong: the first version of the
CLI set `NODE_TLS_REJECT_UNAUTHORIZED=0` for the local target. Replaced with the
`NODE_EXTRA_CA_CERTS` form before commit, and the local table is unchanged under real
certificate verification — so the green rows are green on their merits.

The local stack serves mkcert certificates. Node does **not** use the macOS system trust store — it ships its own CA bundle — so `fetch` rejects mkcert with `unable to verify the first certificate` even though a browser and `curl` both accept it. Point Node at the mkcert root:

```bash
NODE_EXTRA_CA_CERTS="$(mkcert -CAROOT)/rootCA.pem" npm run demo:preflight -- --target local
```

Expected: the same shape as the SE run. If the local Docker stack is not running, every façade row is `unreachable` — that is correct behaviour, not a bug in the script.

Do **not** work around this with `NODE_TLS_REJECT_UNAUTHORIZED=0`. It disables verification for every request the process makes, which would turn a real TLS failure into a silent pass — the exact class of false green this whole preflight exists to prevent.

- [x] **Step 5b: Document the local invocation** — DONE, and enforced rather than only
documented: the `local` target exits 2 with the correct command line when
`NODE_EXTRA_CA_CERTS` is unset, instead of printing ten `unreachable` rows that look
like a dead stack. An unknown `--target` also exits 2.

Add the `NODE_EXTRA_CA_CERTS` form to the CLI's header comment so the next person does not rediscover it:

```js
 *   npm run demo:preflight -- --target se
 *   NODE_EXTRA_CA_CERTS="$(mkcert -CAROOT)/rootCA.pem" npm run demo:preflight -- --target local
```

- [x] **Step 6: Re-run the unit tests** — DONE, 14 pass / 0 fail

```bash
node --test scripts/check-mcp-preflight.test.js
```

Expected: PASS, 13 tests.

- [x] **Step 7: Commit** — DONE

Deviations, all closing silent-failure paths:

- `main()` gets a `.catch` that exits 2. An unhandled rejection can exit 0 under some
  Node configurations — the same false green the classification guards close.
- Argument parsing is strict. `--targt se` used to fall through to the default and
  probe SE while the operator believed they had asked for something else; unknown or
  extra arguments now exit 2 naming the offender. Verified: `--targt se` → 2,
  `--target` with no value → 2, `--target se extra` → 2 naming only `extra`.
- The `/state` reader takes its note from `err.message || err.cause?.message`, never
  `String(err.message)`, which renders the literal note `undefined` for an error that
  carries none.

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
