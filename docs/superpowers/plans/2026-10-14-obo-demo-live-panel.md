# OBO Demo: Live-from-Claude Panel, Evidence Card, Diagram, Learning Hub (Plan 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the existing minimal `/obo-demo` page (button + checks list, shipped in #1327) into the full demo: a side-by-side claims card, a "Live from Claude" panel fed by Claude Code's real calls, the `claude mcp add` setup block for the current origin, a ReactFlow diagram of the token swap, and a Learning Hub entry.

**Architecture:** The BFF gains two session-authenticated routes: `GET /api/obo/events` (SSE, delivers only the signed-in user's events from the in-memory `oboEventHub`) and `GET /api/obo/info` (MCP URL + public client id for the setup block). The UI gains a shared `OboEvidenceCard`, a `useOboLive` EventSource hook, an `OboSwapDiagram` (ReactFlow, static, embedded in the page) and integrates them in `OboDemoPage`. A Learning Hub card links to the page.

**Tech Stack:** demo_api_server (CommonJS, Express, jest + supertest), demo_api_ui (React 19, Vite, vitest + Testing Library, `@xyflow/react` v12).

**Spec:** `docs/superpowers/specs/2026-10-14-obo-demo-page-design.md` (sections 3 to 4 and success criterion S3)

## Prerequisites (hard gates; do not start Task 1 until all hold)

1. PR #1328 (OBO MCP endpoint, downstream verifier, event hub use, bootstrap resource) is merged to `main`. This plan adds routes to `routes/obo.js` and edits `services/oboEventHub.js` from that PR.
2. The backend plan's **Task 6 live probe passed**: Claude Code logged in and called `act_on_my_behalf` against `/api/obo/mcp` on the target environment with all 7 checks passing. If the hosted probe failed, stop and revisit the approach (spec Approach B) instead of building the UI.
3. Work in a fresh worktree from `origin/main` (CLAUDE.md requires one). Another session already shipped `OboDemoPage` and `POST /api/obo/run` (#1327); check `git log origin/main -- demo_api_ui/src/pages/OboDemoPage.jsx` for further changes before you start and rebase this plan's file edits onto what is there.

## Global Constraints

- No raw access token in any response body, SSE frame, log line, DOM text or error message. Only decoded claims and 16-char sha256 prefixes (the evidence object already guarantees this).
- Live events are delivered only to the user whose `sub` they were published under; an unauthenticated or token-less session gets 401.
- UI standards (REGRESSION_PLAN.md section 0, THEMING.md): no inline `style={{ }}` for colour/background/font-size; font sizes from the `--font-size-*` scale (floor `--font-size-3xs`, 10px); colours via `--th-*` tokens, never a literal mixed with a token in one rule; dark mode via `:root[data-theme="dark"]` only; emoji only from the allowlist in `demo_api_ui/CLAUDE.md` (do not add any emoji not on it).
- UI tests are vitest (`cd demo_api_ui && npx vitest run <path>`), never jest. BFF tests: `cd demo_api_server && CI=true ALLOW_TEST_NETWORK=1 npx jest <path> --forceExit`.
- Stage files explicitly; never `git add -A`; verify `git branch --show-current` before each commit; commits end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Existing `OboDemoPage` behavior must keep working: the checks list keeps `aria-label="Delegation checks"` and each item renders as `PASS <label>` / `FAIL <label>`; the button is "Run the delegation"; errors render in `role="alert"`.
- `/obo-demo` stays signed-in-only (`"user"` in `demo_api_server/config/auth-requirements.json`; unchanged by this plan, `npm run authz:verify` must still pass).

## Review Focus

- A dead SSE connection throwing inside `oboEventHub.publish` and starving the other subscribers (carried-over deferred finding). Task 1 pins it.
- Another user's session receiving someone else's events. Task 1 pins it (subscribe key is the session token's `sub`).
- The page crashing when `EventSource` is missing (jsdom, older browsers) or when `/api/obo/info` fails. Tasks 2 and 3 pin both.
- Evidence with `act` as a bare string or missing `inbound`/`delegated` blocks (the existing test returns only `checks`): the card must render without throwing. Task 2 pins it.
- Long-lived SSE connections leaking on unmount or route change. Task 2 pins `close()` on unmount.

## File Structure

| File | Responsibility |
|---|---|
| Modify `demo_api_server/services/oboEventHub.js` | Drop a subscriber whose `write` throws; remove empty subscriber sets |
| Modify `demo_api_server/services/oboConfig.js` | Add `claudeClient: { id, callbackPort }` |
| Modify `demo_api_server/routes/obo.js` | Add `eventsHandler` (`GET /events`) and `infoHandler` (`GET /info`) |
| Create `demo_api_ui/src/components/obo/OboEvidenceCard.jsx` + `.css` | Side-by-side user vs delegated claims and the check list |
| Create `demo_api_ui/src/components/obo/useOboLive.js` | EventSource hook, keeps the latest 5 events |
| Create `demo_api_ui/src/components/obo/OboSwapDiagram.jsx` + `.css` | Static ReactFlow diagram of the token swap |
| Modify `demo_api_ui/src/pages/OboDemoPage.jsx` + `.css` | Compose: run button, evidence card, live panel, setup block, diagram |
| Modify `demo_api_ui/src/components/LearningHub.tsx` | Registry entry, card, navigation for OBO |
| Tests next to each file | See each task |

---

### Task 1: BFF events + info routes, and hub hardening

**Files:**
- Modify: `demo_api_server/services/oboEventHub.js`
- Modify: `demo_api_server/services/oboConfig.js`
- Modify: `demo_api_server/routes/obo.js` (add handlers before `module.exports`; export them)
- Test: `demo_api_server/src/__tests__/services/oboEventHub.test.js` (append)
- Test: `demo_api_server/src/__tests__/routes/obo.test.js` (append)

**Interfaces:**
- Consumes: `oboEventHub.subscribe(sub, res) -> unsubscribe()`, `oboEvidence.claims(token)`.
- Produces: `routes/obo.js` additionally exports `eventsHandler(req, res)` and `infoHandler(req, res)`; `getOboConfig().claudeClient = { id: string, callbackPort: number }`; `GET /api/obo/events` (SSE, default `message` events whose data is the evidence JSON); `GET /api/obo/info -> { mcpUrl, clientId, callbackPort }`.

- [ ] **Step 1: Write the failing tests**

Append to `oboEventHub.test.js`:

```js
test('a subscriber whose write throws is dropped and does not starve the others', () => {
  const bad = { write: jest.fn(() => { throw new Error('socket closed'); }) };
  const good = fakeRes();
  hub.subscribe('u1', bad);
  hub.subscribe('u1', good);
  hub.publish('u1', { n: 1 });
  expect(good.write).toHaveBeenCalledWith(`data: ${JSON.stringify({ n: 1 })}\n\n`);
  hub.publish('u1', { n: 2 });
  expect(bad.write).toHaveBeenCalledTimes(1); // dropped after its first failure
  expect(good.write).toHaveBeenCalledTimes(2);
});
```

Append to `routes/obo.test.js` (it already mocks `oboEventHub`, `oboConfig`, `tokenValidationService`; extend the `oboConfig` mock factory so `getOboConfig()` also returns `claudeClient: { id: 'client-1', callbackPort: 7465 }`, and import the handlers):

```js
const { eventsHandler, infoHandler } = require('../../../routes/obo');

const jwtWith = (payload) => ['eyJhbGciOiJSUzI1NiJ9', Buffer.from(JSON.stringify(payload)).toString('base64url'), 's'].join('.');

function fakeRes() {
  return {
    headers: {}, chunks: [], statusCode: 200, body: null, flushed: false,
    setHeader(k, v) { this.headers[k] = v; }, flushHeaders() { this.flushed = true; },
    write(c) { this.chunks.push(c); return true; },
    status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; },
  };
}
function fakeReq(session) {
  const handlers = {};
  return { session, get: () => 'localhost:3001', protocol: 'https', on: (e, f) => { handlers[e] = f; }, fireClose: () => handlers.close && handlers.close() };
}

describe('GET /api/obo/events', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  test('401 without a signed-in session token, and nothing is subscribed', () => {
    const res = fakeRes();
    eventsHandler(fakeReq({}), res);
    expect(res.statusCode).toBe(401);
    expect(hub.subscribe).not.toHaveBeenCalled();
  });

  test('401 when the session token has no readable sub', () => {
    const res = fakeRes();
    eventsHandler(fakeReq({ oauthTokens: { accessToken: 'not-a-jwt' } }), res);
    expect(res.statusCode).toBe(401);
  });

  test('subscribes under the session token sub, streams SSE headers, heartbeats, and cleans up on close', () => {
    const off = jest.fn();
    hub.subscribe.mockReturnValue(off);
    const req = fakeReq({ oauthTokens: { accessToken: jwtWith({ sub: 'u1' }) } });
    const res = fakeRes();
    eventsHandler(req, res);
    expect(res.headers['Content-Type']).toBe('text/event-stream');
    expect(res.headers['X-Accel-Buffering']).toBe('no');
    expect(res.flushed).toBe(true);
    expect(hub.subscribe).toHaveBeenCalledWith('u1', res);
    jest.advanceTimersByTime(20000);
    expect(res.chunks).toContain(': ping\n\n');
    req.fireClose();
    expect(off).toHaveBeenCalled();
    const before = res.chunks.length;
    jest.advanceTimersByTime(60000);
    expect(res.chunks.length).toBe(before); // heartbeat stopped
  });
});

describe('GET /api/obo/info', () => {
  test('401 when signed out', () => {
    const res = fakeRes();
    infoHandler(fakeReq({}), res);
    expect(res.statusCode).toBe(401);
  });
  test('returns the MCP URL for this origin plus the public client id, no secrets', () => {
    const res = fakeRes();
    infoHandler(fakeReq({ oauthTokens: { accessToken: jwtWith({ sub: 'u1' }) } }), res);
    expect(res.body).toEqual({ mcpUrl: expect.stringMatching(/\/api\/obo\/mcp$/), clientId: 'client-1', callbackPort: 7465 });
    expect(JSON.stringify(res.body)).not.toMatch(/secret/i);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd demo_api_server && CI=true ALLOW_TEST_NETWORK=1 npx jest src/__tests__/services/oboEventHub.test.js src/__tests__/routes/obo.test.js --forceExit`
Expected: FAIL (`eventsHandler is not a function`; the throwing subscriber test fails because `publish` throws).

- [ ] **Step 3: Write the implementation**

`services/oboEventHub.js`, replace `publish` and the unsubscribe returned by `subscribe`:

```js
function publish(sub, evidence) {
  const buf = buffers.get(sub) || [];
  buf.push(evidence);
  while (buf.length > BUFFER_MAX) buf.shift();
  buffers.set(sub, buf);
  const line = `data: ${JSON.stringify(evidence)}\n\n`;
  const set = subscribers.get(sub);
  if (!set) return;
  for (const res of [...set]) {
    try { res.write(line); } catch (_e) { set.delete(res); } // dead connection: drop it, keep delivering to the rest
  }
}

function subscribe(sub, res) {
  const set = subscribers.get(sub) || new Set();
  set.add(res);
  subscribers.set(sub, set);
  for (const ev of buffers.get(sub) || []) res.write(`data: ${JSON.stringify(ev)}\n\n`);
  return () => {
    set.delete(res);
    if (!set.size && subscribers.get(sub) === set) subscribers.delete(sub);
  };
}
```

`services/oboConfig.js`, add to the object returned by `getOboConfig()`:

```js
    // Public PKCE app Claude Code logs in with ("Claude Code - Banking Gateway"); a client id is not a secret.
    claudeClient: {
      id: process.env.OBO_CLAUDE_CLIENT_ID || 'c8392dc4-2d82-4e49-92a8-79a78401faf5',
      callbackPort: Number(process.env.OBO_CLAUDE_CALLBACK_PORT || 7465),
    },
```

`routes/obo.js`: add `const { claims } = require('../services/oboEvidence');` next to the other requires (the file already imports `hasTokenLeak` from that module; extend that import instead of adding a second require if it exists), then before `module.exports`:

```js
// Session-authenticated helpers for the /obo-demo page.
function sessionSub(req) {
  const token = req.session?.oauthTokens?.accessToken;
  if (!token || token === '_cookie_session') return null;
  try { return claims(token).sub || null; } catch (_e) { return null; }
}

function eventsHandler(req, res) {
  const sub = sessionSub(req);
  if (!sub) return res.status(401).json({ error: 'Sign in first.' });
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
  res.write(': connected\n\n');
  const off = hub.subscribe(sub, res);
  const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch (_e) { /* closed; the close handler cleans up */ } }, 20000);
  req.on('close', () => { clearInterval(ping); off(); });
  return undefined;
}

function infoHandler(req, res) {
  if (!sessionSub(req)) return res.status(401).json({ error: 'Sign in first.' });
  const { claudeClient } = getOboConfig();
  return res.json({ mcpUrl: `${baseUrl(req)}/api/obo/mcp`, clientId: claudeClient.id, callbackPort: claudeClient.callbackPort });
}

router.get('/events', eventsHandler);
router.get('/info', infoHandler);
```
and change the export to `module.exports = { router, metadataHandler, eventsHandler, infoHandler };`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd demo_api_server && CI=true ALLOW_TEST_NETWORK=1 npx jest src/__tests__/services/oboEventHub.test.js src/__tests__/routes/obo.test.js src/__tests__/hostedAccessGate.test.js --forceExit`
Expected: PASS. (`/api/obo/events` and `/info` are cookie-session routes behind the hosted wall's normal session check; no bypass entry is added.)

- [ ] **Step 5: Commit**

```bash
git branch --show-current
git add demo_api_server/services/oboEventHub.js demo_api_server/services/oboConfig.js demo_api_server/routes/obo.js demo_api_server/src/__tests__/services/oboEventHub.test.js demo_api_server/src/__tests__/routes/obo.test.js
git commit -m "feat(obo): session SSE events and setup info routes; harden the event hub

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Evidence card and live hook (UI)

**Files:**
- Create: `demo_api_ui/src/components/obo/OboEvidenceCard.jsx`
- Create: `demo_api_ui/src/components/obo/OboEvidenceCard.css`
- Create: `demo_api_ui/src/components/obo/useOboLive.js`
- Test: `demo_api_ui/src/components/obo/__tests__/OboEvidenceCard.test.jsx`
- Test: `demo_api_ui/src/components/obo/__tests__/useOboLive.test.jsx`

**Interfaces:**
- Consumes: the evidence object `{ ts, source, sub, inbound:{aud,scope,client_id,sha}, delegated:{aud,scope,sub,act,exp,sha}, downstream, checks:[{id,label,pass}], leak }` (backend `oboEvidence.buildEvidence`); `resolveApiBaseUrl()` from `../../utils/resolveApiBaseUrl`.
- Produces: `OboEvidenceCard({ evidence })` (default export); `useOboLive(enabled) -> evidence[]` (newest first, max 5).

- [ ] **Step 1: Write the failing tests**

```jsx
// demo_api_ui/src/components/obo/__tests__/OboEvidenceCard.test.jsx
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import OboEvidenceCard from "../OboEvidenceCard";

const evidence = {
  source: "claude",
  inbound: { aud: ["mcpgateway.ping.demo"], scope: "mcp:invoke", client_id: "c8392dc4", sha: "aaaaaaaaaaaaaaaa" },
  delegated: { aud: ["obo-demo.ping.demo"], scope: "obo:invoke", sub: "u1", act: { client_id: "f65664b2" }, exp: 1792010389, sha: "bbbbbbbbbbbbbbbb" },
  downstream: { delegated: 200, userToken: 401 },
  checks: [{ id: "sub-preserved", label: "same user", pass: true }, { id: "act-object", label: "act is an object", pass: false }],
};

describe("OboEvidenceCard", () => {
  it("shows the user token and the delegated token side by side, with act as an object", () => {
    render(<OboEvidenceCard evidence={evidence} />);
    expect(screen.getByRole("region", { name: /your token/i })).toHaveTextContent("mcpgateway.ping.demo");
    const delegated = screen.getByRole("region", { name: /delegated token/i });
    expect(delegated).toHaveTextContent("obo-demo.ping.demo");
    expect(delegated).toHaveTextContent('{"client_id":"f65664b2"}');
  });

  it("renders the checks as PASS/FAIL in an accessible list", () => {
    render(<OboEvidenceCard evidence={evidence} />);
    const list = screen.getByRole("list", { name: /delegation checks/i });
    expect(list).toHaveTextContent("PASS same user");
    expect(list).toHaveTextContent("FAIL act is an object");
  });

  it("shows the downstream accept/refuse result", () => {
    render(<OboEvidenceCard evidence={evidence} />);
    expect(screen.getByTestId("obo-downstream")).toHaveTextContent(/delegated: 200/i);
    expect(screen.getByTestId("obo-downstream")).toHaveTextContent(/your token: 401/i);
  });

  it("does not throw when only checks are present (older shape)", () => {
    render(<OboEvidenceCard evidence={{ checks: [{ id: "x", label: "only checks", pass: true }] }} />);
    expect(screen.getByRole("list", { name: /delegation checks/i })).toHaveTextContent("PASS only checks");
    expect(screen.queryByRole("region", { name: /delegated token/i })).toBeNull();
  });

  it("shows a bare-string act as text, not [object Object]", () => {
    const str = { ...evidence, delegated: { ...evidence.delegated, act: "f65664b2" } };
    render(<OboEvidenceCard evidence={str} />);
    expect(screen.getByRole("region", { name: /delegated token/i })).toHaveTextContent("f65664b2");
    expect(document.body.textContent).not.toMatch(/\[object Object\]/);
  });

  it("never prints a JWT-shaped string", () => {
    render(<OboEvidenceCard evidence={evidence} />);
    expect(document.body.textContent).not.toMatch(/eyJ/);
  });
});
```

```jsx
// demo_api_ui/src/components/obo/__tests__/useOboLive.test.jsx
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import useOboLive from "../useOboLive";

class FakeEventSource {
  static instances = [];
  constructor(url, opts) { this.url = url; this.opts = opts; this.closed = false; FakeEventSource.instances.push(this); }
  close() { this.closed = true; }
  emit(data) { this.onmessage?.({ data: JSON.stringify(data) }); }
}

beforeEach(() => { FakeEventSource.instances = []; globalThis.EventSource = FakeEventSource; });
afterEach(() => { delete globalThis.EventSource; });

describe("useOboLive", () => {
  it("opens one credentialed stream and returns events newest first, capped at 5", () => {
    const { result } = renderHook(() => useOboLive(true));
    expect(FakeEventSource.instances).toHaveLength(1);
    expect(FakeEventSource.instances[0].url).toMatch(/\/api\/obo\/events$/);
    expect(FakeEventSource.instances[0].opts).toEqual({ withCredentials: true });
    act(() => { for (let n = 1; n <= 7; n += 1) FakeEventSource.instances[0].emit({ n }); });
    expect(result.current.map((e) => e.n)).toEqual([7, 6, 5, 4, 3]);
  });

  it("ignores a malformed frame without throwing", () => {
    const { result } = renderHook(() => useOboLive(true));
    act(() => { FakeEventSource.instances[0].onmessage({ data: "not json" }); });
    expect(result.current).toEqual([]);
  });

  it("closes the stream on unmount", () => {
    const { unmount } = renderHook(() => useOboLive(true));
    unmount();
    expect(FakeEventSource.instances[0].closed).toBe(true);
  });

  it("opens nothing when disabled", () => {
    renderHook(() => useOboLive(false));
    expect(FakeEventSource.instances).toHaveLength(0);
  });

  it("returns an empty list and does not throw when EventSource is unavailable", () => {
    delete globalThis.EventSource;
    const { result } = renderHook(() => useOboLive(true));
    expect(result.current).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd demo_api_ui && npx vitest run src/components/obo/__tests__`
Expected: FAIL, "Failed to resolve import" for both modules.

- [ ] **Step 3: Write the implementation**

```jsx
// demo_api_ui/src/components/obo/OboEvidenceCard.jsx
import "./OboEvidenceCard.css";

const show = (v) => (v == null ? "n/a" : typeof v === "object" ? JSON.stringify(v) : String(v));
const aud = (v) => (Array.isArray(v) ? v.join(", ") : show(v));

function Claim({ name, value }) {
  return (
    <div className="obo-card__row">
      <dt>{name}</dt>
      <dd>{value}</dd>
    </div>
  );
}

// User token vs delegated token, claims and hashes only. Never renders a raw token.
export default function OboEvidenceCard({ evidence }) {
  const { inbound, delegated, downstream, checks = [] } = evidence || {};
  return (
    <div className="obo-card">
      {inbound && delegated ? (
        <div className="obo-card__pair">
          <section className="obo-card__col" aria-label="Your token">
            <h3 className="obo-card__heading">Your token</h3>
            <dl>
              <Claim name="audience" value={aud(inbound.aud)} />
              <Claim name="scope" value={show(inbound.scope)} />
              <Claim name="client" value={show(inbound.client_id)} />
              <Claim name="hash" value={show(inbound.sha)} />
            </dl>
          </section>
          <section className="obo-card__col" aria-label="Delegated token">
            <h3 className="obo-card__heading">Delegated token</h3>
            <dl>
              <Claim name="sub" value={show(delegated.sub)} />
              <Claim name="act" value={show(delegated.act)} />
              <Claim name="audience" value={aud(delegated.aud)} />
              <Claim name="scope" value={show(delegated.scope)} />
              <Claim name="hash" value={show(delegated.sha)} />
            </dl>
          </section>
        </div>
      ) : null}
      {downstream ? (
        <p className="obo-card__downstream" data-testid="obo-downstream">
          Downstream API: delegated: {downstream.delegated}, your token: {downstream.userToken}
        </p>
      ) : null}
      {checks.length > 0 ? (
        <ul className="obo-card__checks" aria-label="Delegation checks">
          {checks.map((c) => (
            <li key={c.id} className={c.pass ? "obo-card__check obo-card__check--pass" : "obo-card__check obo-card__check--fail"}>
              <span className="obo-card__verdict">{c.pass ? "PASS" : "FAIL"}</span> {c.label}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
```

```css
/* demo_api_ui/src/components/obo/OboEvidenceCard.css */
.obo-card { color: var(--th-text); }
.obo-card__pair { display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem; }
.obo-card__col { border: 1px solid var(--th-border); background: var(--th-bg-card); border-radius: 6px; padding: 0.75rem; min-width: 0; }
.obo-card__heading { font-size: var(--font-size-base); margin: 0 0 0.5rem; }
.obo-card__row { display: flex; gap: 0.5rem; padding: 0.15rem 0; }
.obo-card__row dt { color: var(--th-text-muted); min-width: 4.5rem; }
.obo-card__row dd { margin: 0; overflow-wrap: anywhere; }
.obo-card__downstream { color: var(--th-text-muted); margin: 0.75rem 0 0; }
.obo-card__checks { list-style: none; padding: 0; margin: 0.75rem 0 0; }
.obo-card__check { padding: 0.35rem 0; border-bottom: 1px solid var(--th-border); }
.obo-card__verdict { font-weight: 600; margin-right: 0.5rem; }
.obo-card__check--pass .obo-card__verdict { color: var(--th-status-success-text); }
.obo-card__check--fail .obo-card__verdict { color: var(--th-status-error-text); }
@media (max-width: 40rem) { .obo-card__pair { grid-template-columns: 1fr; } }
```

```js
// demo_api_ui/src/components/obo/useOboLive.js
import { useEffect, useState } from "react";
import { resolveApiBaseUrl } from "../../utils/resolveApiBaseUrl";

const MAX = 5;

// Subscribes to the signed-in user's live OBO events (Claude Code's calls). Newest first.
export default function useOboLive(enabled) {
  const [events, setEvents] = useState([]);
  useEffect(() => {
    if (!enabled || typeof EventSource === "undefined") return undefined;
    let es;
    try { es = new EventSource(`${resolveApiBaseUrl()}/api/obo/events`, { withCredentials: true }); } catch (_e) { return undefined; }
    es.onmessage = (msg) => {
      let ev;
      try { ev = JSON.parse(msg.data); } catch (_e) { return; }
      setEvents((prev) => [ev, ...prev].slice(0, MAX));
    };
    // No onerror handler: the browser reconnects on its own, and the BFF replays the last 5 events on connect.
    return () => { try { es.close(); } catch (_e) { /* already closed */ } };
  }, [enabled]);
  return events;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd demo_api_ui && npx vitest run src/components/obo/__tests__`
Expected: PASS (11 tests).

- [ ] **Step 5: Commit**

```bash
git branch --show-current
git add demo_api_ui/src/components/obo
git commit -m "feat(obo-ui): evidence card (user vs delegated claims) and live events hook

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Swap diagram (ReactFlow)

**Files:**
- Create: `demo_api_ui/src/components/obo/OboSwapDiagram.jsx`
- Create: `demo_api_ui/src/components/obo/OboSwapDiagram.css`
- Test: `demo_api_ui/src/components/obo/__tests__/OboSwapDiagram.test.jsx`

**Interfaces:**
- Consumes: `@xyflow/react` (`ReactFlow`, `ReactFlowProvider`, `Background`). `src/setupTests.js` already stubs `ResizeObserver`, so the flow mounts under jsdom.
- Produces: `OboSwapDiagram()` default export, static (no props).

- [ ] **Step 1: Write the failing test**

```jsx
// demo_api_ui/src/components/obo/__tests__/OboSwapDiagram.test.jsx
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import OboSwapDiagram, { NODES, EDGES } from "../OboSwapDiagram";

describe("OboSwapDiagram", () => {
  it("names the four actors and the refusal of the user token", () => {
    const labels = NODES.map((n) => n.data.label);
    expect(labels).toEqual(["Claude (OAuth client)", "OBO MCP endpoint (BFF)", "PingOne", "Downstream API"]);
    expect(EDGES.some((e) => /401/.test(e.label))).toBe(true);
  });

  it("shows the exchange and the delegated token claims on the edges", () => {
    const text = EDGES.map((e) => e.label).join(" | ");
    expect(text).toMatch(/RFC 8693/);
    expect(text).toMatch(/act/);
  });

  it("mounts with an accessible name and no token text", () => {
    render(<OboSwapDiagram />);
    expect(screen.getByLabelText(/token swap diagram/i)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/eyJ/);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd demo_api_ui && npx vitest run src/components/obo/__tests__/OboSwapDiagram.test.jsx`
Expected: FAIL, "Failed to resolve import ../OboSwapDiagram".

- [ ] **Step 3: Implement**

```jsx
// demo_api_ui/src/components/obo/OboSwapDiagram.jsx
import { Background, BackgroundVariant, ReactFlow, ReactFlowProvider } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import "./OboSwapDiagram.css";

export const NODES = [
  { id: "claude", position: { x: 0, y: 80 }, data: { label: "Claude (OAuth client)" }, className: "obo-node" },
  { id: "mcp", position: { x: 280, y: 80 }, data: { label: "OBO MCP endpoint (BFF)" }, className: "obo-node" },
  { id: "p1", position: { x: 560, y: 0 }, data: { label: "PingOne" }, className: "obo-node obo-node--idp" },
  { id: "api", position: { x: 560, y: 160 }, data: { label: "Downstream API" }, className: "obo-node" },
];

export const EDGES = [
  { id: "e1", source: "claude", target: "mcp", label: "1. user token (aud: gateway)" },
  { id: "e2", source: "mcp", target: "p1", label: "2. RFC 8693 exchange: subject = user, actor = AI Agent" },
  { id: "e3", source: "p1", target: "mcp", label: "3. delegated token: sub = user, act = { client_id }", animated: true },
  { id: "e4", source: "mcp", target: "api", label: "4. delegated token only" },
  { id: "e5", source: "mcp", target: "api", label: "user token here: 401", className: "obo-edge--refused" },
];

export default function OboSwapDiagram() {
  return (
    <div className="obo-diagram" role="img" aria-label="Token swap diagram: the user token is exchanged for a delegated token that only the downstream API accepts">
      <ReactFlowProvider>
        <ReactFlow
          nodes={NODES}
          edges={EDGES}
          fitView
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          panOnDrag={false}
          zoomOnScroll={false}
          proOptions={{ hideAttribution: true }}
        >
          <Background variant={BackgroundVariant.Dots} gap={18} />
        </ReactFlow>
      </ReactFlowProvider>
    </div>
  );
}
```

```css
/* demo_api_ui/src/components/obo/OboSwapDiagram.css */
.obo-diagram { height: 16rem; border: 1px solid var(--th-border); border-radius: 6px; background: var(--th-bg-card); }
.obo-diagram .obo-node { background: var(--th-bg-inset); color: var(--th-text); border: 1px solid var(--th-border-strong); border-radius: 6px; font-size: var(--font-size-sm); padding: 0.5rem 0.75rem; }
.obo-diagram .obo-node--idp { border-color: var(--th-border-strong); }
.obo-diagram .react-flow__edge-text { fill: var(--th-text); font-size: var(--font-size-3xs); }
.obo-diagram .react-flow__edge-path { stroke: var(--th-text-muted); }
.obo-diagram .obo-edge--refused .react-flow__edge-path { stroke: var(--th-status-error-text); stroke-dasharray: 4 3; }
```
(Confirm `--font-size-sm` exists in `src/index.css`; use the nearest scale token above `--font-size-3xs` if not.)

- [ ] **Step 4: Run to verify it passes**

Run: `cd demo_api_ui && npx vitest run src/components/obo/__tests__/OboSwapDiagram.test.jsx`
Expected: PASS (3 tests). If React Flow warns about a zero-size container in jsdom, that is noise from the stubbed `ResizeObserver`; do not silence tests, but if a warning fails `setupTests` console checks, give `.obo-diagram` an explicit `width: 100%` in the test via the component's CSS (already set by block layout) and report.

- [ ] **Step 5: Commit**

```bash
git branch --show-current
git add demo_api_ui/src/components/obo/OboSwapDiagram.jsx demo_api_ui/src/components/obo/OboSwapDiagram.css demo_api_ui/src/components/obo/__tests__/OboSwapDiagram.test.jsx
git commit -m "feat(obo-ui): ReactFlow diagram of the token swap

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Compose the page (run, live panel, setup block, diagram)

**Files:**
- Modify: `demo_api_ui/src/pages/OboDemoPage.jsx`
- Modify: `demo_api_ui/src/pages/OboDemoPage.css`
- Modify: `demo_api_ui/src/pages/__tests__/OboDemoPage.test.jsx`

**Interfaces:**
- Consumes: `OboEvidenceCard`, `useOboLive`, `OboSwapDiagram` (Tasks 2 and 3); `apiClient.get('/api/obo/info') -> { data: { mcpUrl, clientId, callbackPort } }` (Task 1); the existing `apiClient.post('/api/obo/run')`.
- Produces: the finished page. No new exports.

- [ ] **Step 1: Update the tests (keep the three existing tests passing; add four)**

Replace the mock header and add `get` support, then append tests:

```jsx
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor, act } from "@testing-library/react";
import OboDemoPage from "../OboDemoPage";

const post = vi.fn();
const get = vi.fn();
vi.mock("../../services/apiClient", () => ({ default: { post: (...a) => post(...a), get: (...a) => get(...a) } }));

class FakeEventSource {
  static instances = [];
  constructor(url) { this.url = url; FakeEventSource.instances.push(this); }
  close() {}
}

const INFO = { mcpUrl: "https://demo.example/api/obo/mcp", clientId: "client-1", callbackPort: 7465 };

beforeEach(() => {
  post.mockReset();
  get.mockReset().mockResolvedValue({ data: INFO });
  FakeEventSource.instances = [];
  globalThis.EventSource = FakeEventSource;
});
afterEach(() => { delete globalThis.EventSource; });
```
(Keep the three existing `it(...)` blocks unchanged below this header.) Append:

```jsx
  it("shows the exact claude mcp add command for this origin", async () => {
    render(<OboDemoPage />);
    const cmd = await screen.findByTestId("obo-setup-command");
    expect(cmd).toHaveTextContent("claude mcp add --transport http obo-demo https://demo.example/api/obo/mcp");
    expect(cmd).toHaveTextContent("--client-id client-1");
    expect(cmd).toHaveTextContent("--callback-port 7465");
  });

  it("still renders when /api/obo/info fails, with a plain note instead of the command", async () => {
    get.mockRejectedValueOnce(new Error("503"));
    render(<OboDemoPage />);
    expect(await screen.findByText(/setup command is unavailable/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /run the delegation/i })).toBeEnabled();
  });

  it("renders a live event from Claude when one arrives on the stream", async () => {
    render(<OboDemoPage />);
    expect(screen.getByText(/waiting for claude/i)).toBeInTheDocument();
    const evidence = { source: "claude", ts: "2026-10-14T20:00:00Z", checks: [{ id: "x", label: "live check", pass: true }] };
    act(() => { FakeEventSource.instances[0].onmessage({ data: JSON.stringify(evidence) }); });
    const lists = await screen.findAllByRole("list", { name: /delegation checks/i });
    expect(lists.some((l) => l.textContent.includes("PASS live check"))).toBe(true);
    expect(screen.queryByText(/waiting for claude/i)).toBeNull();
  });

  it("includes the token swap diagram", async () => {
    render(<OboDemoPage />);
    expect(await screen.findByLabelText(/token swap diagram/i)).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run to verify the new tests fail and the old ones still pass**

Run: `cd demo_api_ui && npx vitest run src/pages/__tests__/OboDemoPage.test.jsx`
Expected: the 4 new tests FAIL; the 3 existing PASS.

- [ ] **Step 3: Implement**

Replace `OboDemoPage.jsx` with:

```jsx
import { useEffect, useState } from "react";
import apiClient from "../services/apiClient";
import OboEvidenceCard from "../components/obo/OboEvidenceCard";
import OboSwapDiagram from "../components/obo/OboSwapDiagram";
import useOboLive from "../components/obo/useOboLive";
import "./OboDemoPage.css";

// On-behalf-of demo: the BFF runs RFC 8693 delegation and returns evidence only. No raw token is shown here.
export default function OboDemoPage() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [evidence, setEvidence] = useState(null);
  const [info, setInfo] = useState(null);
  const [infoFailed, setInfoFailed] = useState(false);
  const live = useOboLive(true);

  useEffect(() => {
    let alive = true;
    apiClient.get("/api/obo/info")
      .then((r) => { if (alive) setInfo(r.data); })
      .catch(() => { if (alive) setInfoFailed(true); });
    return () => { alive = false; };
  }, []);

  async function run() {
    setBusy(true);
    setError("");
    try {
      const response = await apiClient.post("/api/obo/run");
      setEvidence(response.data);
    } catch (err) {
      setEvidence(null);
      setError(err?.response?.data?.error || "The OBO run failed.");
    } finally {
      setBusy(false);
    }
  }

  const command = info
    ? `claude mcp add --transport http obo-demo ${info.mcpUrl} --client-id ${info.clientId} --callback-port ${info.callbackPort}`
    : null;

  return (
    <div className="obo-demo">
      <h1 className="obo-demo__title">On behalf of the user</h1>
      <p className="obo-demo__lede">
        An agent acts for you through RFC 8693 delegation. The exchange keeps your identity (<code>sub</code>),
        records the agent as <code>act</code>, and issues a token the downstream API accepts. Your own token is
        refused there. The model never sees either token.
      </p>
      <OboSwapDiagram />

      <section className="obo-demo__section" aria-label="Run it yourself">
        <h2 className="obo-demo__heading">Run it yourself</h2>
        <button type="button" className="obo-demo__run" onClick={run} disabled={busy}>
          {busy ? "Running…" : "Run the delegation"}
        </button>
        {error ? <p role="alert" className="obo-demo__error">{error}</p> : null}
        {evidence ? <OboEvidenceCard evidence={evidence} /> : null}
      </section>

      <section className="obo-demo__section" aria-label="Live from Claude">
        <h2 className="obo-demo__heading">Live from Claude</h2>
        {command ? (
          <>
            <p className="obo-demo__hint">Add this server in Claude Code, run <code>/mcp</code> to sign in, then ask it to call <code>act_on_my_behalf</code>.</p>
            <pre className="obo-demo__command" data-testid="obo-setup-command">{command}</pre>
          </>
        ) : infoFailed ? (
          <p className="obo-demo__hint">The setup command is unavailable right now.</p>
        ) : null}
        {live.length === 0 ? (
          <p className="obo-demo__hint">Waiting for Claude to call the tool…</p>
        ) : (
          <OboEvidenceCard evidence={live[0]} />
        )}
      </section>

      <p className="obo-demo__limits">
        Limits: the BFF, which is the MCP server here, briefly holds your token to run the exchange, so
        &quot;the agent&quot; means the model. Live events work with a single BFF replica.
      </p>
    </div>
  );
}
```

Append to `OboDemoPage.css` (do not change existing rules):

```css
.obo-demo__section { margin-top: 1.5rem; }
.obo-demo__heading { font-size: var(--font-size-base); margin: 0 0 0.5rem; }
.obo-demo__hint { color: var(--th-text-muted); margin: 0.25rem 0 0.5rem; }
.obo-demo__command { background: var(--th-bg-inset); border: 1px solid var(--th-border); border-radius: 6px; padding: 0.75rem; overflow-x: auto; white-space: pre-wrap; overflow-wrap: anywhere; }
.obo-demo__limits { color: var(--th-text-muted); margin-top: 1.5rem; font-size: var(--font-size-sm); }
```
Also widen `.obo-demo { max-width: 46rem; ... }` to `max-width: 60rem;` so the two-column card fits.

- [ ] **Step 4: Run to verify all pass, plus the UI gates**

Run: `cd demo_api_ui && npx vitest run src/pages/__tests__/OboDemoPage.test.jsx src/components/obo/__tests__ && npm run build`
Expected: all PASS; the build succeeds. From the repo root: `npm run authz:verify && npm run hygiene:check` (expected OK). Check the page in a browser against a running stack (`npm run serve:worktree here`): signed in, `/obo-demo` shows the diagram, the command, and after a real Claude Code call the live panel fills in. Verify with `getComputedStyle` that colours/fonts resolve from tokens in both light and dark (THEMING.md); a passing build alone is not proof.

- [ ] **Step 5: Commit**

```bash
git branch --show-current
git add demo_api_ui/src/pages/OboDemoPage.jsx demo_api_ui/src/pages/OboDemoPage.css demo_api_ui/src/pages/__tests__/OboDemoPage.test.jsx
git commit -m "feat(obo-ui): live-from-Claude panel, setup command, evidence card and diagram on /obo-demo

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Learning Hub entry

**Files:**
- Modify: `demo_api_ui/src/components/LearningHub.tsx`
- Test: `demo_api_ui/src/components/__tests__/LearningHub.obo.test.tsx` (new)

**Interfaces:**
- Consumes: the Learning Hub's existing card list, `LESSON_REGISTRY`, and navigation map (all in `LearningHub.tsx`).
- Produces: a card labelled "On behalf of the user (OBO)" that navigates to `/obo-demo`.

- [ ] **Step 1: Write the failing test**

First read how an existing Learning Hub test renders the component and copy its harness (`ls demo_api_ui/src/components/__tests__ | grep LearningHub`; open `LearningHubAgent.test.tsx` for the router/provider wrapper and any mocks). Then:

```tsx
// demo_api_ui/src/components/__tests__/LearningHub.obo.test.tsx
// Use the same render harness (router, providers, mocks) as LearningHubAgent.test.tsx.
import { describe, expect, it } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderLearningHub, currentPath } from "./learningHubTestHarness"; // replace with the harness actually used in LearningHubAgent.test.tsx

describe("Learning Hub: OBO", () => {
  it("lists the OBO lesson and opens /obo-demo", () => {
    renderLearningHub();
    fireEvent.click(screen.getByText("On behalf of the user (OBO)"));
    expect(currentPath()).toBe("/obo-demo");
  });
});
```
(If the existing tests render `LearningHub` directly with `MemoryRouter`, inline that setup here and assert with a `<Route path="/obo-demo">` probe instead of the placeholder harness import. The assertion, the label text, and the target path are fixed; only the render harness is copied from the neighbouring test.)

- [ ] **Step 2: Run to verify it fails**

Run: `cd demo_api_ui && npx vitest run src/components/__tests__/LearningHub.obo.test.tsx`
Expected: FAIL (label not found).

- [ ] **Step 3: Implement**

In `LearningHub.tsx`:
1. In `LESSON_REGISTRY`, after the `"Agent-to-Agent (A2A)"` entry add:
   `"On behalf of the user (OBO)": { status: "LIVE", keywords: ["obo", "on behalf of", "delegation", "act claim", "token exchange"] },`
2. In the card list, immediately after the card whose `label` is `"Privilege for AI — A2A"`, add:
   ```js
   {
     label: "On behalf of the user (OBO)",
     description: "An agent acts for the signed-in user through RFC 8693 delegation, never as the user",
     icon: "🔐",
   },
   ```
3. In the navigation map, next to `"Privilege for AI — A2A": () => navigate("/ai-products/privilege-a2a"),` add:
   `"On behalf of the user (OBO)": () => navigate("/obo-demo"),`

- [ ] **Step 4: Run to verify it passes and nothing pinned broke**

Run: `cd demo_api_ui && npx vitest run src/components/__tests__/LearningHub`
Expected: all Learning Hub tests PASS. `LearningHubAgent.test.tsx` pins `toHaveLength(11)` buttons in one state; if that count changes because the new card renders there, update the number only after confirming the new card is the sole cause, and say so in the commit message.

- [ ] **Step 5: Commit**

```bash
git branch --show-current
git add demo_api_ui/src/components/LearningHub.tsx demo_api_ui/src/components/__tests__/LearningHub.obo.test.tsx
git commit -m "feat(obo-ui): Learning Hub entry for on-behalf-of delegation

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Live verification (no code; the finish line)

This task is a user-assisted verification; do not claim the feature done without it.

- [ ] **Step 1:** Full gates from the repo root on the merged tree: `npm run hygiene:check`, `npm run authz:verify`, `cd demo_api_server && CI=true ALLOW_TEST_NETWORK=1 npx jest src/__tests__/services/obo src/__tests__/routes/obo.test.js --forceExit`, `cd demo_api_ui && npx vitest run src/pages/__tests__/OboDemoPage.test.jsx src/components/obo/__tests__ && npm run build`.
- [ ] **Step 2:** Run the stack from the worktree (`npm run serve:worktree here`), sign in, open `/obo-demo`, copy the shown command, register it in Claude Code, sign in via `/mcp`, ask Claude to call `act_on_my_behalf`. Expected: within about 2 seconds the "Live from Claude" panel shows the side-by-side card with `act` as an object and 7 PASS chips; running it from the button shows the same card; no `eyJ` anywhere in the page text.
- [ ] **Step 3:** Open the page as a second signed-in user in another browser profile and confirm the first user's Claude call does not appear there (S3 isolation).
- [ ] **Step 4:** Report results and screenshots to the user. Then push and open the PR (the user merges; the merge command is handed over, not run by an agent).

---

## Self-Review

**Spec coverage:** Section 3 (page): run button (existing), live panel (Tasks 1, 2, 4), copy command for current origin (Tasks 1, 4), shared `OboEvidence` rendering for both paths (Task 2, used twice in Task 4), 7 chips (Task 2), footnote of limits (Task 4), ReactFlow diagram (Task 3), Learning Hub entry (Task 5). Section 2 routes `/api/obo/events` and the info helper (Task 1; `/api/obo/run` already exists from #1327). S3 (live within 2 s, same user only) = Task 1 isolation tests plus Task 6 steps 2 and 3. S4 (no token anywhere) = card test for `eyJ`, diagram test, page assertions. Out of this plan by design: backend (plan 1, PR #1328), HITL, gateway-side exchange.

**Placeholders:** one deliberate hole is Task 5 step 1, where the render harness must be copied from the neighbouring Learning Hub test because it was not read; the label, path and assertion are fixed. Task 3 step 3 asks to confirm one CSS token name exists. Neither blocks the code in the other steps.

**Type consistency:** `OboEvidenceCard({ evidence })`, `useOboLive(enabled) -> evidence[]`, `NODES`/`EDGES` exports, `eventsHandler`/`infoHandler`, `getOboConfig().claudeClient`, `/api/obo/info` response keys (`mcpUrl`, `clientId`, `callbackPort`) are used with identical names in Tasks 1, 2, 3 and 4.
