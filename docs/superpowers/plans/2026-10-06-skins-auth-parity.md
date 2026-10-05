# Skins Auth Parity (PR B) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Check for and use applicable skills (`regression-guard`, `generate-tests`, `verify-ai-demo2`) before editing.

**Goal:** The Claude Terminal / VS Code / Claude Desktop skins get Cursor's silent re-auth after a switch, the Re-arm banner and a "Check doors" probe, built on the helpers PR A (#862) extracted. No Cursor-page edit.

**Architecture:** `usePrivilegeShellSession` gains `startSignIn` (via `requestAuthStart`), `afterSwitch` driven by `decideAfterSwitch`, `rearm`, and exposes `gatewaySession` / preflight / `probeDoors`. Shared UI parts (`ShellRearmBanner`, `ShellDoorCheck`, tree marks) render them in all three skins. TDD per task.

**Tech Stack:** React 19, vitest + @testing-library/react (not jest).

**Spec:** the approved design in the conversation (Phase 3, PR B) and `TECH_DEBT.md` entry `2026-10-05 — Silent re-auth, re-arm and door probing are Cursor-only` (currently PARTLY RESOLVED).

**Decisions already made by the user:** after a switch to a destination you are already signed into, the skins do NOT auto-list tools (match Cursor; the existing "Load tools" button loads them) — this deliberately changes today's skin behaviour and the existing tests that pin it; "Check doors" is always visible but low-key.

## Global Constraints
- Work only in `/Users/cmuir/Development/AI-DEMO2/.claude/worktrees/skins-auth-parity` (branch `worktree-skins-auth-parity`); never `cd` to the main checkout. `demo_api_ui/node_modules` is already symlinked. `demo_api_ui/src/pages/PrivilegeMcpClientPage.jsx` is NOT touched in this plan.
- **Git is broken on this machine** (`/usr/bin/git` needs the Xcode license). Run EVERY git command through `/private/tmp/claude-502/-Users-cmuir-Development-AI-DEMO2/3d5609b9-139e-4e3f-baf6-adfa42e5196c/scratchpad/xgit.sh <git args>`. One git invocation per Bash call; no variables in the command. Stage explicitly (`add <files>`), never `add -A`; check `…/xgit.sh rev-parse --abbrev-ref HEAD` prints `worktree-skins-auth-parity` before each commit.
- **Run tests with the project's own vitest, not the npm wrapper** (its memory guard dies on `ps` here): `cd demo_api_ui && ./node_modules/.bin/vitest run <paths relative to demo_api_ui> > <file> 2>&1`, then read the file; never conclude from a piped exit status; never `npx vitest`. Every `waitFor` / `findBy*` gets an explicit `{ timeout: 5000 }` (earlier tests flaked under load with the 1 s default). Do NOT `cd` into the main checkout from a worktree session — keep the shell's cwd inside the worktree.
- Commit trailer LITERALLY `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` whatever model you are.
- Emoji allowlist only (`✅` `❌` `⚠️` allowed). New CSS: no colour/background/font-size literals except `var(--font-size-*)` and tokens that exist in `demo_api_ui/src/index.css` (grep first); otherwise `inherit` / `currentColor` / `color-mix(in srgb, currentColor N%, transparent)`; no inline colour styles; no `monospace` literal. Reuse the existing `.pvs-*` classes where they fit.
- Test seams already in use: tests stub `window.location` with `{ ...original, assign }` (restore in `finally`), because `navigateWithOverlay(url, { assign: true })` calls `window.location.assign(url)`; `sessionStorage` key `pvs_silent_signin_tried` is the load-time once-per-tab guard (tests that mount signed-out with `mainAppAuthenticated: true` must set it first to keep the load-time handshake out of the way).
- Super Sports is the default vertical for any manual validation.

## Review Focus
- Switch outcomes in the skins follow `decideAfterSwitch` exactly: authenticated -> phase `ready`, tools cleared, NO tools/list call; silent -> gate shown, then a `prompt=none` handshake only if `isSilentAuthUrl`, otherwise the gate stays (no navigation); forceReauth (Re-arm) -> non-silent sign-in; manual -> gate, no request.
- `signedIn` is captured BEFORE the switch (`mainAppAuthenticated || phase === "ready"`), not after `afterSwitch` flips the phase.
- `connect()` never navigates to `undefined`: a missing authUrl is a notice, `noAuthRequired` loads tools, `returnTo` is still sent, `onBeforeConnect` still runs before the POST.
- Re-arm banner shows only in `facade` mode with a not-ready session, in every phase; Re-arm switches to Privilege then forces sign-in.
- "Check doors": per-door ✅/❌ + `probeResultLabel`, the empty-result message, the error note; disabled while probing; VS Code shows marks in the side panel; Terminal/Desktop show a list under the route bar.
- No Cursor-page change; existing skin tests only change where the user's "no auto-list" decision requires it, and each such change is called out.

---

### Task 1: `startSignIn` and `connect()` parity

**Files:**
- Modify: `demo_api_ui/src/components/aiFootprintMocks/usePrivilegeShellSession.js`
- Modify: `demo_api_ui/src/components/aiFootprintMocks/__tests__/usePrivilegeShellSession.test.jsx`

**Interfaces:**
- Consumes `requestAuthStart(request, body)` and `isSilentAuthUrl` from `../privilege/privilegeAuth` (PR A).
- Produces (internal to the hook) `startSignIn({ silentOnly = false, returnTo, remember = true } = {}) -> Promise<true | false | undefined>`: `true` navigated, `false` silent bail (not a `prompt=none` URL), `undefined` the door needs no sign-in (a system line is pushed and tools are loaded instead). `remember` runs `beforeConnectRef.current?.()` just before navigating.

- [ ] **Step 1: Failing tests.** Append a `describe("connect parity (startSignIn)")` to `usePrivilegeShellSession.test.jsx` reusing its `wrapper` (router at `/demo/coding-agent`) and the `window.location` stub pattern from the existing connect tests. Cases:
  1. `connect()` POSTs `/api/privilege-mcp/auth/start` with body `{ returnTo: "/demo/coding-agent" }` and calls `window.location.assign` with the authUrl; `onBeforeConnect` ran BEFORE the POST (record call order).
  2. `/auth/start` answers `{}` (no authUrl): `assign` is NOT called, `notice` is `sign-in did not return an authorization URL`, `busy` is false.
  3. `/auth/start` answers `{ noAuthRequired: true }`: `assign` NOT called, a system message `This door needs no sign-in — its upstream owns identity. Loading tools.` is pushed, `POST /api/privilege-mcp/tools/list` is called once, `phase` is `ready`, `busy` is false.
  4. A chat reply `{ authUrl, reply }` (existing `send` path) still results in `/auth/start` + `assign` (keep the existing test; add the returnTo assertion if absent).
- [ ] **Step 2:** Run the file; cases 2 and 3 FAIL (today `connect` navigates to `undefined` / ignores `noAuthRequired`).
- [ ] **Step 3: Implement.** In `usePrivilegeShellSession.js`: add `import { requestAuthStart, isSilentAuthUrl } from "../privilege/privilegeAuth";` and add, AFTER `push` is defined (callbacks resolve names at call time, so order of definition only matters for hooks' deps arrays — define `startSignIn` right after `push`):
```js
  // Start a sign-in. silentOnly: follow the redirect only when it is a prompt=none URL —
  // returns false (the caller leaves the gate showing) when the gateway cannot do it
  // silently. Returns true after navigating, undefined for a door that needs no sign-in
  // (its tools are loaded instead). `remember` runs onBeforeConnect just before navigating.
  const startSignIn = useCallback(async ({ silentOnly = false, returnTo, remember = true } = {}) => {
    const start = await requestAuthStart(request, { returnTo });
    if (start.kind === "no-auth-required") {
      push("system", "This door needs no sign-in — its upstream owns identity. Loading tools.");
      await listTools();
      return undefined;
    }
    if (silentOnly && !isSilentAuthUrl(start.authUrl)) return false;
    if (remember) beforeConnectRef.current?.();
    navigateWithOverlay(start.authUrl, { message: "Signing in...", assign: true });
    return true;
  }, [push, listTools]);
```
  and replace `connect`:
```js
  const connect = async () => {
    setBusy(true);
    setNotice("");
    try {
      onBeforeConnect?.();
      const started = await startSignIn({ returnTo: location.pathname, remember: false });
      // true: the page is leaving, so busy stays on. undefined: tools were loaded here.
      if (started === undefined) setBusy(false);
    } catch (err) {
      setNotice(errText(err));
      setBusy(false);
    }
  };
```
  `connect` is declared before `push`/`startSignIn` in the file today — move `connect` below `startSignIn` (it is only called from handlers and `send`, never at render). Leave `trySilentSignIn` (the load-time handshake) untouched. Update the existing `send` deps list if `connect` identity matters (it already depends on `connect`).
- [ ] **Step 4:** Run `usePrivilegeShellSession.test.jsx` and the other `src/components/aiFootprintMocks` tests — all PASS (existing "calls onBeforeConnect before posting /auth/start" must still pass unmodified).
- [ ] **Step 5:** Commit: `feat(footprint): skin connect() uses requestAuthStart (noAuthRequired, no navigation to undefined)`.

---

### Task 2: Switch outcomes via `decideAfterSwitch`; silent re-auth after a switch; no auto-list

**Files:**
- Modify: `demo_api_ui/src/components/aiFootprintMocks/usePrivilegeShellSession.js`
- Modify: `demo_api_ui/src/components/aiFootprintMocks/__tests__/usePrivilegeShellSession.test.jsx`

**Interfaces:**
- Consumes Task 1's `startSignIn`; `decideAfterSwitch` from `../privilege/privilegeRouting`.
- Produces: `pickPath(key)` / `pickDoor(url)` unchanged in signature; session state `mainAppAuthenticated` (from `/state`).

- [ ] **Step 1: Failing tests** (new `describe("switch outcomes")`, using a state helper that lets a test choose `oauth.authenticated` and `mainAppAuthenticated`; presets: two Privilege doors `PRIV_A`/`PRIV_B` as in `readyRouted`; set `sessionStorage` `pvs_silent_signin_tried=1` in `beforeEach` and `sessionStorage.clear()` in `afterEach` so the load-time handshake never fires):
  1. Authenticated destination: `pickDoor(PRIV_B)` with `/config` -> `{ oauth: { destinationAuthenticated: true } }`: `tools` is `[]`, `phase` stays `ready`, and `POST /api/privilege-mcp/tools/list` is NOT called (the user decision).
  2. Not signed in anywhere (client unauthenticated, `mainAppAuthenticated: false`), destination unauthenticated: `phase` `signed-out`, NO `/auth/start` post.
  3. Client signed in (`oauth.authenticated: true`), destination unauthenticated, Privilege mode: after `pickDoor` the hook POSTs `/auth/start` with `{ returnTo: "/demo/coding-agent" }`; when it answers an authUrl containing `prompt=none`, `window.location.assign` is called with it, `onBeforeConnect` ran, `phase` is `signed-out`.
  4. Same as 3 but the authUrl has no `prompt=none`: `assign` NOT called, `phase` `signed-out` (the gate stays).
  5. `mainAppAuthenticated: true` but the client is signed out (state `oauth.authenticated: false`): `pickDoor` to an unauthenticated destination -> silent handshake attempted (same assertions as 3).
  6. Door switch in a non-Privilege mode (state `gatewayMode: "direct"`, presets for direct) with a signed-in client and unauthenticated destination: NO `/auth/start` (door switches are silent only in Privilege mode) and `phase` `signed-out`.
  7. Path switch (`pickPath("direct")`) with a signed-in client and unauthenticated destination: silent handshake attempted (path switches are silent in every mode).
  8. During the silent attempt `/auth/start` answers `{ noAuthRequired: true }`: tools are loaded (`tools/list` once) and `phase` ends `ready`.
  9. `/auth/start` rejects (axios-shaped `{ response: { status: 500, data: { error: "boom" } } }`) during the silent attempt: `notice` is `Silent sign-in could not start for this path. Sign in manually to retry. (boom)` and `phase` `signed-out`.
  Update the EXISTING test `pickDoor posts /config, clears tools, then lists tools when authenticated` (in `describe("usePrivilegeShellSession routing")`): it now asserts tools cleared, phase `ready`, and NO `tools/list` call (rename the test accordingly) — this is the one deliberate change to an existing test, caused by the user's decision. Leave `pickDoor to an unauthenticated door shows the sign-in gate with no tools` as is (it must still pass: with `mainAppAuthenticated` absent and the helper's client signed in it would now attempt a silent handshake — read that test; if it signs the client in, set `mainAppAuthenticated`/`oauth.authenticated` so the case stays "nothing to reuse" or adjust its `/auth/start` mock; report exactly what you changed and why).
- [ ] **Step 2:** Run; the new tests FAIL.
- [ ] **Step 3: Implement.** Add state `const [mainAppAuthenticated, setMainAppAuthenticated] = useState(false);` and in the load effect right after `hydrate(data);` add `setMainAppAuthenticated(Boolean(data.mainAppAuthenticated));`. Import `decideAfterSwitch`. Replace `afterSwitch`, `pickPath`, `pickDoor`:
```js
  // What a path/door switch does next is decided by decideAfterSwitch (shared with the
  // Cursor page). `signedIn` is captured by the caller BEFORE the switch: afterSwitch
  // itself flips `phase`.
  const afterSwitch = useCallback(async (result, failPrefix, { kind, signedIn, forceReauth = false }) => {
    if (!result.ok) {
      setNotice(`${failPrefix}: ${errText(result.error)}`);
      return;
    }
    if (result.llm) return;
    setTools([]);
    const destinationAuthenticated =
      result.saved?.oauth?.destinationAuthenticated ?? result.saved?.oauth?.authenticated;
    const outcome = decideAfterSwitch({
      kind,
      destinationAuthenticated,
      mode: routing.gatewayMode,
      forceReauth,
      signedIn,
    });
    // Choosing a path or door is not a request to probe it: the destination's tools are
    // loaded with the Load tools button, as on the Cursor page.
    if (outcome === "authenticated") {
      setPhase("ready");
      return;
    }
    setPhase("signed-out");
    if (outcome === "manual") return;
    try {
      await startSignIn({ silentOnly: outcome === "silent", returnTo: location.pathname });
    } catch (err) {
      setNotice(
        outcome === "silent"
          ? `Silent sign-in could not start for this path. Sign in manually to retry. (${errText(err)})`
          : errText(err),
      );
    }
  }, [routing.gatewayMode, startSignIn, location.pathname]);

  const pickPath = useCallback(async (key) => {
    setBusy(true);
    setNotice("");
    const signedIn = mainAppAuthenticated || phase === "ready";
    try {
      await afterSwitch(await routing.selectPath(key), "Gateway switch failed", { kind: "path", signedIn });
    } finally {
      setBusy(false);
    }
  }, [afterSwitch, routing.selectPath, mainAppAuthenticated, phase]);

  const pickDoor = useCallback(async (url) => {
    setBusy(true);
    setNotice("");
    const signedIn = mainAppAuthenticated || phase === "ready";
    try {
      await afterSwitch(await routing.selectDoor(url), "Failed to switch door", { kind: "door", signedIn });
    } finally {
      setBusy(false);
    }
  }, [afterSwitch, routing.selectDoor, mainAppAuthenticated, phase]);
```
  (An `llm:` path key still returns early via `result.llm` before any of this.)
- [ ] **Step 4:** Run the whole `src/components/aiFootprintMocks` directory + `src/pages/__tests__/FootprintLiveShellPage.sessionSurvives.test.jsx`: all PASS (state which existing tests you changed: only the one named above, plus any forced by Step 1's note).
- [ ] **Step 5:** Commit: `feat(footprint): skins re-authenticate silently after a switch via decideAfterSwitch; no auto-list`.

---

### Task 3: Re-arm and door-probe plumbing in the session

**Files:**
- Modify: `demo_api_ui/src/components/aiFootprintMocks/usePrivilegeShellSession.js`
- Modify: `demo_api_ui/src/components/aiFootprintMocks/__tests__/usePrivilegeShellSession.test.jsx`

**Interfaces:**
- Consumes `needsRearm`, `rearmReason` from `../privilege/privilegeRouting`; the routing hook's `gatewaySession`, `preflight`, `preflightBusy`, `preflightError`, `probePresetDoors` (PR A).
- Produces on the session object: `needsRearm: boolean`, `rearmReason: string | null`, `rearm(): Promise<void>`, `probeDoors(): Promise<void>` (= the hook's `probePresetDoors`); and four more fields on `routing`: `gatewaySession`, `preflight`, `preflightBusy`, `preflightError`.

- [ ] **Step 1: Failing tests** (`describe("re-arm and door probing")`, same helpers):
  1. State `gatewayMode: "facade"`, `gatewaySession: { ready: false, reason: "expired" }`: `needsRearm` is `true`, `rearmReason` is `"expired"`, `routing.gatewaySession` equals the state value. With `reason` missing -> `"not established"`. With `ready: true` or mode `privilege` -> `needsRearm` false and `rearmReason` null.
  2. `rearm()` (facade, client signed in): POSTs `/api/privilege-mcp/config` with body containing `gatewayMode: "privilege"`; then, because `forceReauth`, POSTs `/auth/start` with `{ returnTo: "/demo/coding-agent" }` EVEN when `/config` reports the destination authenticated, and calls `assign` with the authUrl (a NON-`prompt=none` URL is still followed — Re-arm is an explicit click). `busy` is true during, and `false` if `/auth/start` fails (notice carries the error).
  3. `probeDoors()` POSTs `/api/privilege-mcp/doors/probe` with `{ urls: [<every preset url>] }` and `routing.preflight` equals the returned `results`; a rejected probe sets `routing.preflightError` to the server's `error` text.
- [ ] **Step 2:** Run; FAIL.
- [ ] **Step 3: Implement.** Import `needsRearm as needsRearmFor, rearmReason as rearmReasonFor` (avoid shadowing the returned names). Add:
```js
  const rearm = useCallback(async () => {
    setBusy(true);
    setNotice("");
    const signedIn = mainAppAuthenticated || phase === "ready";
    try {
      // Re-arming must go through Privilege mode (a Façade sign-in arms nothing) and must
      // sign in even when /config reports a restored token — the gateway session is dead.
      await afterSwitch(await routing.selectPath("privilege"), "Gateway switch failed", {
        kind: "path",
        signedIn,
        forceReauth: true,
      });
    } finally {
      setBusy(false);
    }
  }, [afterSwitch, routing.selectPath, mainAppAuthenticated, phase]);
```
  and in the returned object: `needsRearm: needsRearmFor(routing.gatewayMode, routing.gatewaySession)`, `rearmReason: needsRearmFor(...) ? rearmReasonFor(routing.gatewaySession) : null`, `rearm`, `probeDoors: routing.probePresetDoors`, and extend the `routing` facade with `gatewaySession`, `preflight`, `preflightBusy`, `preflightError`.
- [ ] **Step 4:** Run the `aiFootprintMocks` directory (PASS). **Step 5:** Commit: `feat(footprint): skin session exposes re-arm and door probing`.

---

### Task 4: Re-arm banner in all three skins

**Files:**
- Modify: `demo_api_ui/src/components/aiFootprintMocks/ShellParts.jsx` (add `ShellRearmBanner`; render it from `ShellGate`)
- Modify: `demo_api_ui/src/components/aiFootprintMocks/PrivilegeShellViews.css`
- Modify: `demo_api_ui/src/components/aiFootprintMocks/__tests__/ShellViews.test.jsx`

**Interfaces:** Consumes the session fields from Task 3. Produces `ShellRearmBanner({ session })`: renders nothing unless `session.needsRearm`; else `<div className="pvs-rearm" role="status"><span aria-hidden="true">⚠️</span> Gateway session {rearmReason}. <button type="button" onClick={session.rearm} disabled={session.busy}>{busy ? "Re-arming…" : "Re-arm"}</button></div>`.

- [ ] **Step 1: Failing tests.** Extend `makeSession` defaults with `needsRearm: false, rearmReason: null, rearm: vi.fn(), probeDoors: vi.fn()` and `routing` fields `gatewaySession: null, preflight: null, preflightBusy: false, preflightError: ""`. Tests: for each of Terminal / VS Code / Desktop and for phases `ready`, `signed-out` and `loading`: with `needsRearm: true, rearmReason: "expired"` the text `Gateway session expired.` and a `Re-arm` button show; clicking it calls `session.rearm`; with `needsRearm: false` neither shows; with `busy: true` the button reads `Re-arming…` and is disabled; `rearmReason: "not established"` words accordingly.
- [ ] **Step 2:** FAIL. **Step 3:** Implement `ShellRearmBanner` and render `<ShellRearmBanner session={session} />` in `ShellGate` right after the notice, before the phase blocks (all phases). CSS: `.pvs-rearm { display:flex; gap:6px; align-items:center; flex-wrap:wrap; padding:6px 8px; border:1px solid color-mix(in srgb, currentColor 30%, transparent); border-radius:4px; }` and extend the existing button/focus rules (`.pvs-gate-foot button` etc.) to `.pvs-rearm button`.
- [ ] **Step 4:** Run `ShellViews.test.jsx` + ratchets `src/components/__tests__/themingRatchet.test.js src/__tests__/uiRegression.test.js src/__tests__/emojiAllowlistAppWide.test.js src/__tests__/emojiAllowlistSync.test.js` (PASS, no pin raised). **Step 5:** Commit: `feat(footprint): Re-arm banner in the Terminal, VS Code and Claude Desktop skins`.

---

### Task 5: "Check doors" in all three skins

**Files:**
- Modify: `demo_api_ui/src/components/aiFootprintMocks/ShellParts.jsx` (add `ShellDoorCheck`; use it in `ShellRoutingBar`; marks + button in `ShellRoutingTree`)
- Modify: `demo_api_ui/src/components/aiFootprintMocks/PrivilegeShellViews.css`
- Modify: `demo_api_ui/src/components/aiFootprintMocks/__tests__/ShellViews.test.jsx`

**Interfaces:** Consumes `session.probeDoors` and `session.routing.preflight*` (Task 3), `doorName`, `probeResultLabel`.

- [ ] **Step 1: Failing tests.**
  - `ShellRoutingBar` (render via `ShellTerminalView` and `ShellDesktopView`, plus the signed-out gate): a `Check doors` button is present and calls `session.probeDoors`; while `preflightBusy` it reads `Probing…` and is disabled (also disabled while `session.busy` or `session.thinking`); with `preflight: [{url: ".../other/mcp", ok: true, tools: 3}, {url: ".../x/mcp", ok: false, status: 401, error: "Unauthorized"}]` rows show `other`, `3 tools`, `x`, `401 Unauthorized` with ✅ / ❌ marks (aria-hidden marks; assert the row text); `preflight: []` shows `No other doors to probe. The selected door is skipped; add a preset for another one.`; `preflightError: "Not authenticated."` shows it with `role="alert"`; nothing is shown when `preflight` is `null` and there is no error.
  - `ShellRoutingTree` (VS Code side panel): a `Check doors` button under the Door group calls `session.probeDoors` and is disabled while busy/thinking/probing; after a probe, each door item whose url has a result carries a mark (`✅ ` / `❌ ` before the name) and a `title` equal to `probeResultLabel(r)`; the empty-result and error notes show under the group; doors without a result are unmarked (existing tree tests keep passing unmodified).
- [ ] **Step 2:** FAIL. **Step 3: Implement.** In `ShellParts.jsx` import `probeResultLabel` from `../privilege/privilegeRouting` and add:
```jsx
const NO_OTHER_DOORS = "No other doors to probe. The selected door is skipped; add a preset for another one.";

// "Check doors": probes the OTHER configured doors with this identity (/doors/probe skips the
// selected door and caps the fan-out), so the presenter can see why a door refuses them.
function DoorCheckButton({ session }) {
  const { preflightBusy } = session.routing;
  return (
    <button
      type="button"
      className="pvs-doorcheck__btn"
      onClick={session.probeDoors}
      disabled={preflightBusy || session.busy || session.thinking}
    >
      {preflightBusy ? "Probing…" : "Check doors"}
    </button>
  );
}

function DoorCheckNotes({ routing }) {
  return (
    <>
      {routing.preflightError ? <p className="pvs-note" role="alert">{routing.preflightError}</p> : null}
      {routing.preflight && routing.preflight.length === 0 ? <p className="pvs-note">{NO_OTHER_DOORS}</p> : null}
    </>
  );
}

export function ShellDoorCheck({ session }) {
  const { routing } = session;
  return (
    <div className="pvs-doorcheck">
      <DoorCheckButton session={session} />
      <DoorCheckNotes routing={routing} />
      {routing.preflight && routing.preflight.length > 0 ? (
        <ul className="pvs-probe">
          {routing.preflight.map((r) => (
            <li key={r.url}>
              <span aria-hidden="true">{r.ok ? "✅" : "❌"}</span> <span>{doorName(r.url) || r.url}</span>{" "}
              <span>{probeResultLabel(r)}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
```
  `ShellRoutingBar` returns a fragment `<><div className="pvs-routing">…existing…</div><ShellDoorCheck session={session} /></>`. In `ShellRoutingTree` add `const probeByUrl = new Map((routing.preflight || []).map((r) => [r.url, r]));`, render each door item label as `{mark}{name}` where `mark` is `"✅ "`/`"❌ "` when `probeByUrl.get(url)` exists, set `title={probeResultLabel(r)}` on that button, and under the Door group render `<DoorCheckButton session={session} />` and `<DoorCheckNotes routing={routing} />`. (The `item()` helper in the tree takes an optional `title`/`mark`; keep `aria-pressed` and the accessible-name test for unprobed doors exact.) CSS: `.pvs-doorcheck { display:flex; flex-direction:column; gap:4px; }`, `.pvs-doorcheck__btn` styled like the other small buttons (extend the existing selector lists, including `:focus-visible` and `:disabled`), `.pvs-probe { margin:0; padding-left:0; list-style:none; font-size:var(--font-size-2xs); }`, tree-side button spacing via the existing `.pvs-tree` rules.
- [ ] **Step 4:** Run `ShellViews.test.jsx`, the whole `aiFootprintMocks` directory and the ratchets (PASS). **Step 5:** Commit: `feat(footprint): Check doors in the Terminal, VS Code and Claude Desktop skins`.

---

### Task 6: Page-level test, TECH_DEBT, gates

**Files:**
- Modify: `demo_api_ui/src/pages/__tests__/FootprintLiveShellPage.sessionSurvives.test.jsx` (append)
- Modify: `TECH_DEBT.md`

- [ ] **Step 1: Page-level tests** (reuse `renderAt`-style helpers from the existing `describe("VS Code side panel routing")`; every wait `{ timeout: 5000 }`; stub `window.location.assign`; set `sessionStorage` `pvs_silent_signin_tried=1`): (a) VS Code skin, client signed in, click door `other` in the side panel with `/config` -> `{ oauth: { destinationAuthenticated: false } }` and `/auth/start` -> an authUrl with `prompt=none`: `/auth/start` is POSTed with `{ returnTo: "/demo/vscode-copilot" }` and `assign` is called; (b) same with a non-silent authUrl: no `assign`, the Sign in button is shown; (c) facade state with a dead gateway session: the `Gateway session expired.` banner shows on the coding skin and VS Code, and clicking `Re-arm` POSTs `/config` with `gatewayMode: "privilege"`; (d) `Check doors` in the VS Code side panel posts `/doors/probe` and a ✅ mark appears on the probed door.
- [ ] **Step 2: TECH_DEBT.** Entry `### [ ] 2026-10-05 — Silent re-auth, re-arm and door probing are Cursor-only`: tick it (`[x]`) and append a **RESOLVED 2026-10-06 (branch `worktree-skins-auth-parity`)** block (match the file's convention): what it turned out to be (the shared decisions/requests were extractable; the page-coupled side effects were not), the fix (PR A extracted the helpers and moved Cursor onto them; this PR moved the skins onto them: `startSignIn`, `afterSwitch` via `decideAfterSwitch`, `rearm`, `probeDoors`, banner and Check doors UI), and what intentionally differs per surface (Cursor shows a sign-in modal + overlay + session flags; the skins show the gate; the skins do not auto-list tools after a switch, matching Cursor; Cursor's door preflight is Inspect-only, the skins' Check doors is always visible).
- [ ] **Step 3: Gates** (redirect to files, read them): `src/components/aiFootprintMocks src/components/privilege src/pages/__tests__/FootprintLiveShellPage.sessionSurvives.test.jsx src/pages/__tests__/AiFootprintShellPages.test.js src/pages/__tests__/PrivilegeMcpClientPage` plus ratchets `src/components/__tests__/themingRatchet.test.js src/components/__tests__/testConventionsRatchet.test.js src/__tests__/uiRegression.test.js src/__tests__/emojiAllowlistAppWide.test.js src/__tests__/emojiAllowlistSync.test.js`, then `cd demo_api_ui && npm run build`. All green. Confirm `xgit.sh diff --stat <base>..HEAD -- demo_api_ui/src/pages/PrivilegeMcpClientPage.jsx` is empty (no Cursor edit).
- [ ] **Step 4:** Commit: `test(footprint): page-level silent re-auth, Re-arm and Check doors; docs(tech-debt): resolve the Cursor-only re-auth entry`. Do NOT push, open a PR, merge or deploy.
