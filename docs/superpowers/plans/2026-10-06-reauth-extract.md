# Re-auth / Re-arm / Door-probe Extraction (PR A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Check for and use applicable skills (`regression-guard`, `generate-tests`, `verify-ai-demo2`) before editing.

**Goal:** Move the shared logic of Cursor's silent re-auth after a switch, Re-arm banner and door preflight into pure helpers and `usePrivilegeRouting`, and move the Cursor page onto them with zero behaviour change. (PR B, a later plan, then builds the skin features on top.)

**Architecture:** Page-coupled side effects (sign-in modal, overlay, session flags, `selectedTool`) STAY in `PrivilegeMcpClientPage.jsx`. Only decisions and requests are extracted: `decideAfterSwitch`, `isSilentAuthUrl`, `needsRearm`, `rearmReason`, `probeResultLabel` (pure, `privilegeRouting.js`/`privilegeAuth.js`), `requestAuthStart(request)` (injected request), and `gatewaySession` + preflight state/`probeDoors` in `usePrivilegeRouting`. Each Cursor adoption is its own commit, guarded by the existing Cursor tests plus new characterization tests.

**Tech Stack:** React 19, vitest + @testing-library/react (not jest).

**Spec:** the approved design in the conversation (Phase 3, PR A) and `TECH_DEBT.md` entry `2026-10-05 — Silent re-auth, re-arm and door probing are Cursor-only`.

## Global Constraints
- Work only in `/Users/cmuir/Development/AI-DEMO2/.claude/worktrees/reauth-extract` (branch `worktree-reauth-extract`); never `cd` to the main checkout. `demo_api_ui/node_modules` is already symlinked.
- **Git is broken on this machine** (`/usr/bin/git` needs the Xcode license). Run EVERY git command through the wrapper `/private/tmp/claude-502/-Users-cmuir-Development-AI-DEMO2/3d5609b9-139e-4e3f-baf6-adfa42e5196c/scratchpad/xgit.sh <git args>`. One git invocation per Bash call; no variables in the command. Stage explicitly (`add <files>`), never `add -A`; check `…/xgit.sh rev-parse --abbrev-ref HEAD` prints `worktree-reauth-extract` before each commit.
- **Run tests with the project's own vitest, not the npm wrapper** (its memory guard dies on `ps` here): `cd demo_api_ui && ./node_modules/.bin/vitest run <paths relative to demo_api_ui> > <file> 2>&1`, then read the file; never conclude from a piped exit status; never `npx vitest`.
- Commit trailer LITERALLY `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` whatever model you are.
- `demo_api_ui/src/pages/PrivilegeMcpClientPage.jsx` is protected (REGRESSION_PLAN §0-§1; read them and use the `regression-guard` skill FIRST): behaviour-preserving edits only, each adoption in its own commit, no drive-by cleanup, keep every existing comment that explains WHY, every existing `PrivilegeMcpClientPage.*` test passes UNMODIFIED. Baseline before any edit: the whole `src/pages/__tests__/PrivilegeMcpClientPage` family (record file/test counts; the previous run was 25 files / 111 tests, main has moved so report what you see).
- Emoji allowlist only (`✅` `❌` `⚠️` are allowed). No new CSS in this plan.
- Super Sports is the default vertical for any manual validation.

## Review Focus
- Exact equivalence including the throw behaviours: `new URL(authUrl)` is only evaluated when `silentOnly` (an invalid URL throws into the caller's catch there, and is navigated to otherwise); `saved.oauth?...` in the path switch throws on a null `/config` body while the door switch uses `saved?.oauth?...`; the noAuthRequired check comes BEFORE the missing-authUrl check.
- `decideAfterSwitch` is a pure table: path switch -> `authenticated | silent | forceReauth | manual`; door switch -> `silent | authenticated | manual` (silent only in `privilege` mode).
- The three `startAuthRedirect` call sites (`switchGatewayMode` silent + forceReauth, `switchDoor` silent, `startAuth`) behave identically, including the returned `true | false | undefined`.
- Preflight state moves into the hook but Cursor's rendering, `Inspect`-only gating, 12-door cap note and empty-result message are unchanged.
- Re-arm banner shows only in `facade` mode with a not-ready session; wording `expired` vs `not established` unchanged.

---

### Task 1: Characterization tests for the gaps (green on the UNMODIFIED page)

**Files:**
- Create: `demo_api_ui/src/pages/__tests__/PrivilegeMcpClientPage.authFlowCharacterization.test.jsx`

Do NOT edit `PrivilegeMcpClientPage.jsx` or any existing test. Read `PrivilegeMcpClientPage.doorSwitchReauth.test.jsx`, `.gatewaySession.test.jsx`, `.preflight.test.jsx` and `.directSignIn.test.jsx` first and copy their harness (global `fetch` mock returning `{ok, status, text: async () => JSON}`; `MemoryRouter`; mocked `apiClient`). The existing tests already pin: door switch (silent, manual, live token), path switch (silent Direct, manual, cannot start), Re-arm banner shown/hidden by mode and readiness, re-arm flows, preflight probe/error/empty, silent auto-connect on load. Audit them, then add ONLY tests for what is NOT pinned. Known gap: `/auth/start` answering `{ noAuthRequired: true }` (see `startAuthRedirect`, ~L894): the page appends the system line `This door needs no sign-in — its upstream owns identity. Loading tools.`, fetches tools (`POST /api/privilege-mcp/tools/list`), and does NOT navigate or show the overlay.

- [ ] **Step 1:** Write tests (each with its own `fetch` routing). Required: (a) `noAuthRequired` via the Sign in button path (`startAuth`): the system line appears, `tools/list` is called, `window.location.assign`/overlay navigation never happens. (b) Re-arm banner wording: `gatewaySession: {ready:false, reason:"expired"}` shows `Gateway session expired.`; `{ready:false}` (no/other reason) shows `Gateway session not established.`. (c) Preflight row text: an `ok` result shows `<n> tools`; a failed result with `status` and `error` shows `<status> <error>` trimmed; a failed result with neither shows `failed` (copy the preflight test's way of reaching Inspect view). (d) `startAuthRedirect` with `silentOnly` and a NON-`prompt=none` authUrl (door switch while signed in): no navigation, the sign-in modal text `The gateway cannot silently authorize this door from the current session. Sign in to connect it.` appears — only add this if the existing `doorSwitchReauth` test "keeps manual sign-in available when a silent Privilege flow is unavailable" does not already assert that exact text; say which you found.
- [ ] **Step 2:** Run the new file against the UNMODIFIED page: all PASS (run it 3 times; every `waitFor`/`findBy*` gets an explicit `{ timeout: 5000 }` — an earlier safety-net test flaked under load with the default 1 s). If a test fails because the TEST is wrong, fix the test, never the page.
- [ ] **Step 3:** Prove they bite: temporarily alter one literal per test in the page (e.g. the noAuthRequired line text, `'expired'`, `'failed'`), confirm the matching tests FAIL, restore (`xgit.sh status --short` must show the page unmodified).
- [ ] **Step 4:** Commit only the new file: `test(privilege): characterize noAuthRequired, re-arm wording, preflight labels, silent-bail text`.

---

### Task 2: Pure helpers and hook state (no Cursor edit yet)

**Files:**
- Modify: `demo_api_ui/src/components/privilege/privilegeRouting.js` (append `decideAfterSwitch`, `needsRearm`, `rearmReason`, `probeResultLabel`)
- Create: `demo_api_ui/src/components/privilege/privilegeAuth.js` (`requestAuthStart`, `isSilentAuthUrl`)
- Modify: `demo_api_ui/src/components/privilege/usePrivilegeRouting.js` (gatewaySession state; preflight state + `probeDoors`)
- Create/Modify tests: `demo_api_ui/src/components/privilege/__tests__/privilegeRouting.test.js` (append), `…/privilegeAuth.test.js`, `…/usePrivilegeRouting.test.jsx` (append)

**Interfaces:**
- Produces from `privilegeRouting.js`:
  - `decideAfterSwitch({ kind, destinationAuthenticated, mode, forceReauth = false, signedIn }) -> 'authenticated'|'silent'|'forceReauth'|'manual'`
  - `needsRearm(mode, session) -> boolean`; `rearmReason(session) -> 'expired'|'not established'`
  - `probeResultLabel(r) -> string`
- Produces from `privilegeAuth.js`: `requestAuthStart(request) -> Promise<{kind:'no-auth-required'} | {kind:'redirect', authUrl:string}>`; `isSilentAuthUrl(authUrl) -> boolean` (throws on an invalid URL, like `new URL`).
- Produces from the hook (`usePrivilegeRouting({ request })`): `gatewaySession`, `setGatewaySession` (and `hydrate` sets it to `s.gatewaySession || null`); `preflight` (`null | result[]`), `preflightBusy`, `preflightError`, `probeDoors()`.

- [ ] **Step 1: Failing tests**

```js
// append to privilegeRouting.test.js
import { decideAfterSwitch, needsRearm, rearmReason, probeResultLabel } from "../privilegeRouting";

describe("decideAfterSwitch", () => {
  it.each([
    // [kind, destinationAuthenticated, mode, forceReauth, signedIn, expected]
    ["path", true, "direct", false, true, "authenticated"],
    ["path", true, "direct", false, false, "authenticated"],
    ["path", false, "direct", false, true, "silent"],
    ["path", false, "direct", false, false, "manual"],
    ["path", true, "privilege", true, true, "forceReauth"],
    ["path", false, "privilege", true, false, "forceReauth"],
    ["door", false, "privilege", false, true, "silent"],
    ["door", false, "privilege", false, false, "manual"],
    ["door", false, "direct", false, true, "manual"],
    ["door", false, "facade", false, true, "manual"],
    ["door", true, "privilege", false, true, "authenticated"],
    ["door", true, "direct", false, false, "authenticated"],
  ])("%s dest=%s mode=%s force=%s signedIn=%s -> %s", (kind, destinationAuthenticated, mode, forceReauth, signedIn, expected) => {
    expect(decideAfterSwitch({ kind, destinationAuthenticated, mode, forceReauth, signedIn })).toBe(expected);
  });

  it("treats an undefined destinationAuthenticated as not authenticated", () => {
    expect(decideAfterSwitch({ kind: "door", destinationAuthenticated: undefined, mode: "privilege", signedIn: false })).toBe("manual");
  });
});

describe("needsRearm / rearmReason", () => {
  it("is true only for facade mode with a not-ready session", () => {
    expect(needsRearm("facade", { ready: false })).toBe(true);
    expect(needsRearm("facade", { ready: true })).toBe(false);
    expect(needsRearm("facade", null)).toBe(false);
    expect(needsRearm("privilege", { ready: false })).toBe(false);
    expect(needsRearm("direct", { ready: false })).toBe(false);
  });
  it("words the reason", () => {
    expect(rearmReason({ ready: false, reason: "expired" })).toBe("expired");
    expect(rearmReason({ ready: false })).toBe("not established");
    expect(rearmReason({ ready: false, reason: "other" })).toBe("not established");
  });
});

describe("probeResultLabel", () => {
  it("says the tool count for an ok door", () => {
    expect(probeResultLabel({ ok: true, tools: 3 })).toBe("3 tools");
  });
  it("joins status and error for a failed door, trimmed", () => {
    expect(probeResultLabel({ ok: false, status: 401, error: "Unauthorized" })).toBe("401 Unauthorized");
    expect(probeResultLabel({ ok: false, error: "boom" })).toBe("boom");
    expect(probeResultLabel({ ok: false, status: 502 })).toBe("502");
  });
  it("falls back to 'failed' when there is nothing to say", () => {
    expect(probeResultLabel({ ok: false })).toBe("failed");
  });
});
```
```js
// demo_api_ui/src/components/privilege/__tests__/privilegeAuth.test.js
import { requestAuthStart, isSilentAuthUrl } from "../privilegeAuth";

describe("requestAuthStart", () => {
  it("POSTs /auth/start and returns the redirect", async () => {
    const request = vi.fn().mockResolvedValue({ authUrl: "https://auth.example/a?x=1" });
    await expect(requestAuthStart(request)).resolves.toEqual({ kind: "redirect", authUrl: "https://auth.example/a?x=1" });
    expect(request).toHaveBeenCalledWith("/auth/start", { method: "POST" });
  });
  it("reports a door that needs no sign-in, before checking for an authUrl", async () => {
    const request = vi.fn().mockResolvedValue({ noAuthRequired: true });
    await expect(requestAuthStart(request)).resolves.toEqual({ kind: "no-auth-required" });
  });
  it("throws when sign-in returns no authorization URL", async () => {
    await expect(requestAuthStart(vi.fn().mockResolvedValue({}))).rejects.toThrow("sign-in did not return an authorization URL");
    await expect(requestAuthStart(vi.fn().mockResolvedValue(null))).rejects.toThrow("sign-in did not return an authorization URL");
  });
  it("lets a request failure propagate", async () => {
    const boom = new Error("nope");
    await expect(requestAuthStart(vi.fn().mockRejectedValue(boom))).rejects.toBe(boom);
  });
});

describe("isSilentAuthUrl", () => {
  it("is true only for prompt=none", () => {
    expect(isSilentAuthUrl("https://auth.example/a?prompt=none&x=1")).toBe(true);
    expect(isSilentAuthUrl("https://auth.example/a?prompt=login")).toBe(false);
    expect(isSilentAuthUrl("https://auth.example/a")).toBe(false);
  });
  it("throws on an invalid URL, like new URL", () => {
    expect(() => isSilentAuthUrl("not a url")).toThrow();
  });
});
```
and append to `usePrivilegeRouting.test.jsx` (reuse its `setup`/constants; `renderHook`, `act`):
```jsx
describe("usePrivilegeRouting gatewaySession and door probing", () => {
  it("hydrates gatewaySession and defaults it to null", () => {
    const { result } = setup(vi.fn());
    expect(result.current.gatewaySession).toBeNull();
    act(() => result.current.hydrate({ ...STATE, gatewaySession: { ready: false, reason: "expired" } }));
    expect(result.current.gatewaySession).toEqual({ ready: false, reason: "expired" });
  });

  it("probeDoors posts every preset url and stores the results", async () => {
    const request = vi.fn().mockResolvedValue({ results: [{ url: FAC_A, ok: true, tools: 3 }] });
    const { result } = setup(request);
    await act(async () => { await result.current.probeDoors(); });
    expect(request).toHaveBeenCalledWith("/doors/probe", { method: "POST", body: { urls: [PRIV_A, PRIV_B, FAC_A] } });
    expect(result.current.preflight).toEqual([{ url: FAC_A, ok: true, tools: 3 }]);
    expect(result.current.preflightBusy).toBe(false);
    expect(result.current.preflightError).toBe("");
  });

  it("stores [] when the response has no results array", async () => {
    const { result } = setup(vi.fn().mockResolvedValue({}));
    await act(async () => { await result.current.probeDoors(); });
    expect(result.current.preflight).toEqual([]);
  });

  it("surfaces a failed probe as an error and clears results", async () => {
    const { result } = setup(vi.fn().mockRejectedValue(new Error("Not authenticated.")));
    await act(async () => { await result.current.probeDoors(); });
    expect(result.current.preflight).toBeNull();
    expect(result.current.preflightError).toBe("Not authenticated.");
  });

  it("prefers the server's error text from an axios-shaped failure", async () => {
    const { result } = setup(vi.fn().mockRejectedValue({ message: "Request failed", response: { data: { error: "Not authenticated." } } }));
    await act(async () => { await result.current.probeDoors(); });
    expect(result.current.preflightError).toBe("Not authenticated.");
  });

  it("falls back to 'Preflight failed'", async () => {
    const { result } = setup(vi.fn().mockRejectedValue({}));
    await act(async () => { await result.current.probeDoors(); });
    expect(result.current.preflightError).toBe("Preflight failed");
  });
});
```
- [ ] **Step 2:** Run the three files; verify FAIL (missing exports / module).
- [ ] **Step 3: Implement**

```js
// append to demo_api_ui/src/components/privilege/privilegeRouting.js
/**
 * How a path or door switch should authenticate, given what /config reported.
 * Pure: the caller performs the side effects. `signedIn` = the main app OR this
 * client already has a session to reuse.
 *  - path: authenticated | silent | forceReauth | manual
 *  - door: silent (Privilege mode only) | authenticated | manual
 */
export function decideAfterSwitch({ kind, destinationAuthenticated, mode, forceReauth = false, signedIn }) {
  if (kind === 'door') {
    if (!destinationAuthenticated && mode === 'privilege' && signedIn) return 'silent';
    return destinationAuthenticated ? 'authenticated' : 'manual';
  }
  if (destinationAuthenticated && !forceReauth) return 'authenticated';
  if (!forceReauth && signedIn) return 'silent';
  if (forceReauth) return 'forceReauth';
  return 'manual';
}

/** The Façade relay token dies with the BFF process; Re-arm applies only there. */
export function needsRearm(mode, session) {
  return mode === 'facade' && Boolean(session) && !session.ready;
}

export function rearmReason(session) {
  return session.reason === 'expired' ? 'expired' : 'not established';
}

/** One /doors/probe result as the row's trailing text. */
export function probeResultLabel(r) {
  return r.ok ? `${r.tools} tools` : `${r.status || ''} ${r.error || ''}`.trim() || 'failed';
}
```
```js
// demo_api_ui/src/components/privilege/privilegeAuth.js
// Sign-in start shared by the Cursor page and the footprint skins. The request is
// injected (Cursor's fetch api() vs the skins' axios adapter); every side effect
// (overlay, flags, navigation, modal) stays with the caller.

/**
 * POST /auth/start. A door with no authorization server needs no sign-in; a start
 * with no authUrl is a misconfigured door or a changed body shape and throws, so
 * the caller's catch reports it instead of navigating to the string "undefined".
 */
export async function requestAuthStart(request) {
  const data = await request('/auth/start', { method: 'POST' });
  if (data?.noAuthRequired) return { kind: 'no-auth-required' };
  if (!data?.authUrl) throw new Error('sign-in did not return an authorization URL');
  return { kind: 'redirect', authUrl: data.authUrl };
}

/** True when the authUrl is a prompt=none (silent) attempt. Throws on an invalid URL. */
export function isSilentAuthUrl(authUrl) {
  return new URL(authUrl).searchParams.get('prompt') === 'none';
}
```
In `usePrivilegeRouting.js` add (next to the other state): `const [gatewaySession, setGatewaySession] = useState(null); const [preflight, setPreflight] = useState(null); const [preflightError, setPreflightError] = useState(''); const [preflightBusy, setPreflightBusy] = useState(false);`, in `hydrate`: `setGatewaySession(s.gatewaySession || null);`, and:
```js
  // Probes the OTHER configured doors with this identity (/doors/probe skips the
  // selected door and caps the fan-out). Goes through `request` so a 401 arrives as
  // an Error carrying the server's message instead of a body with no `results` that
  // would render as an empty list — a failed preflight that looks like a clean one.
  const probeDoors = useCallback(async () => {
    setPreflightBusy(true);
    setPreflightError('');
    setPreflight(null);
    try {
      const urls = presets.map((p) => p.url).filter(Boolean);
      const data = await request('/doors/probe', { method: 'POST', body: { urls } });
      setPreflight(Array.isArray(data.results) ? data.results : []);
    } catch (err) {
      setPreflightError(err?.response?.data?.error || err?.message || 'Preflight failed');
    } finally {
      setPreflightBusy(false);
    }
  }, [presets, request]);
```
and add `gatewaySession, setGatewaySession, preflight, setPreflight, preflightError, setPreflightError, preflightBusy, setPreflightBusy, probeDoors` to the returned object.
- [ ] **Step 4:** Run the three files (PASS) + `src/components/privilege` + ratchets `src/components/__tests__/themingRatchet.test.js src/__tests__/emojiAllowlistAppWide.test.js src/__tests__/emojiAllowlistSync.test.js`.
- [ ] **Step 5:** Commit: `feat(privilege): decideAfterSwitch, requestAuthStart, needsRearm, probeResultLabel and routing-hook preflight/gatewaySession state`.

---

### Task 3: Cursor adopts `decideAfterSwitch` (own commit)

**Files:** Modify `demo_api_ui/src/pages/PrivilegeMcpClientPage.jsx` ONLY.

**Interfaces:** Consumes `decideAfterSwitch` from `../components/privilege/privilegeRouting` (add to the existing import).

- [ ] **Step 1:** Baseline: run `PrivilegeMcpClientPage.authFlowCharacterization.test.jsx` and the whole `src/pages/__tests__/PrivilegeMcpClientPage` family; record counts.
- [ ] **Step 2:** In `switchGatewayMode`, keep `const destinationAuthenticated = saved.oauth?.destinationAuthenticated ?? saved.oauth?.authenticated;` and every comment. Replace the three consecutive `if` blocks and the trailing manual block with a branch on the outcome (the BODIES of the silent and forceReauth blocks and the long comments stay byte-for-byte):
```js
      const outcome = decideAfterSwitch({
        kind: 'path',
        destinationAuthenticated,
        forceReauth,
        signedIn: mainAppAuthenticated || authenticated,
      });
      if (outcome === 'authenticated') { /* original: setAuthenticated(true); setTools([]); setSelectedTool(null); return; */ }
      if (outcome === 'silent') { /* original silent block body, ending in return; */ }
      if (outcome === 'forceReauth') { /* original forceReauth block body, ending in return; */ }
      // outcome === 'manual': original trailing block (setAuthenticated(false); setTools([]); setSelectedTool(null);)
```
- [ ] **Step 3:** In `switchDoor`, keep `const destinationAuthenticated = saved?.oauth?.destinationAuthenticated ?? saved?.oauth?.authenticated;` and replace the silent `if` condition and the trailing `setAuthenticated(Boolean(...))` with:
```js
      const outcome = decideAfterSwitch({
        kind: 'door',
        destinationAuthenticated,
        mode: gatewayMode,
        signedIn: mainAppAuthenticated || authenticated,
      });
      if (outcome === 'silent') { /* original silent block body, ending in return; */ }
      setAuthenticated(outcome === 'authenticated');
      /* original: setTools([]); setSelectedTool(null); and its comment */
```
(the original second `setAuthenticated(Boolean(saved?.oauth?.destinationAuthenticated ?? saved?.oauth?.authenticated))` is replaced by `outcome === 'authenticated'`, which equals `Boolean(destinationAuthenticated)`.)
- [ ] **Step 4:** Re-run the same tests: identical counts, zero test edits (`xgit.sh diff --stat` shows ONE file). `cd demo_api_ui && npm run build` (redirect, read). Write in the report a statement-by-statement equivalence argument for both functions.
- [ ] **Step 5:** Commit only the page: `refactor(privilege): Cursor switch functions decide the post-switch auth via decideAfterSwitch (no behaviour change)`.

---

### Task 4: Cursor adopts `requestAuthStart` / `isSilentAuthUrl` (own commit)

**Files:** Modify `demo_api_ui/src/pages/PrivilegeMcpClientPage.jsx` ONLY.

- [ ] **Step 1:** Baseline as in Task 3.
- [ ] **Step 2:** Replace the body of `startAuthRedirect` (~L894-921), keeping every comment, with:
```js
  const startAuthRedirect = async ({ silentOnly = false } = {}) => {
    const start = await requestAuthStart(api);
    // An ungated door (mcpFacade.js DOORS.banking) has no authorization server
    // ... (keep the original comment)
    if (start.kind === 'no-auth-required') {
      appendChat('system', 'This door needs no sign-in — its upstream owns identity. Loading tools.');
      await refreshTools();
      return;
    }
    if (silentOnly && !isSilentAuthUrl(start.authUrl)) {
      requestSignIn('The gateway cannot silently authorize this door from the current session. Sign in to connect it.');
      return false;
    }
    // ... (keep the original "Clicking Sign in is explicit intent..." comment)
    writeSessionFlag(SILENT_DOOR_SWITCH_KEY, true);
    navigateWithOverlay(start.authUrl, { message: 'Signing in...' });
    return true;
  };
```
  and `import { requestAuthStart, isSilentAuthUrl } from '../components/privilege/privilegeAuth';`. The order noAuthRequired -> missing authUrl (inside `requestAuthStart`) -> silent check -> flag -> navigate must be identical to the original; return values `undefined | false | true` identical; none of the three call sites changes.
- [ ] **Step 3:** Re-run the same tests (identical counts, zero test edits, ONE file in the diff), build, equivalence argument in the report.
- [ ] **Step 4:** Commit only the page: `refactor(privilege): Cursor startAuthRedirect uses requestAuthStart (no behaviour change)`.

---

### Task 5: Cursor adopts the hook's preflight (own commit)

**Files:** Modify `demo_api_ui/src/pages/PrivilegeMcpClientPage.jsx` ONLY.

- [ ] **Step 1:** Baseline as in Task 3 (the preflight test file must be in it).
- [ ] **Step 2:** Delete the page's `useState`s for `preflight`, `preflightError`, `preflightBusy` (~L300-302) and the `runPreflight` `useCallback` (~L1050), and take them from the existing hook call: add `preflight, preflightError, preflightBusy, probeDoors` to the destructured `usePrivilegeRouting({ request: api })` result and use `probeDoors` where `runPreflight` was (`onClick={probeDoors}`; or `probeDoors: runPreflight` in the destructure to keep the diff to the declaration). Keep the long comment above `runPreflight` (it now lives in the hook; delete the page copy). In the row JSX replace the inline label expression with `probeResultLabel(r)` (import it with the other routing helpers) — `{r.ok ? `${r.tools} tools` : ...}` -> `{probeResultLabel(r)}`. Nothing else in the rail changes (Inspect-only gating, error note, empty-result note).
- [ ] **Step 3:** Re-run the same tests, build, equivalence argument (state hooks moved, `presets` closure identical, error message source identical for `api()` errors because `err.response` is undefined there).
- [ ] **Step 4:** Commit only the page: `refactor(privilege): Cursor preflight state and probe live in usePrivilegeRouting (no behaviour change)`.

---

### Task 6: Cursor adopts `gatewaySession` + `needsRearm` (own commit)

**Files:** Modify `demo_api_ui/src/pages/PrivilegeMcpClientPage.jsx` ONLY.

- [ ] **Step 1:** Baseline as in Task 3 (the gatewaySession test file must be in it).
- [ ] **Step 2:** Delete `const [gatewaySession, setGatewaySession] = useState(null);` (~L298); take `gatewaySession, setGatewaySession` from the hook destructure (the page's `/state` effect keeps calling `setGatewaySession(s.gatewaySession || null)` unchanged). Replace the banner condition `gatewayMode === 'facade' && gatewaySession && !gatewaySession.ready && (` with `needsRearm(gatewayMode, gatewaySession) && (` and the inline reason text `{gatewaySession.reason === 'expired' ? 'expired' : 'not established'}` with `{rearmReason(gatewaySession)}`. Keep every comment above it. Import `needsRearm, rearmReason`.
- [ ] **Step 3:** Re-run the same tests, build, equivalence argument.
- [ ] **Step 4:** Commit only the page: `refactor(privilege): Cursor re-arm banner uses needsRearm/rearmReason (no behaviour change)`.

---

### Task 7: TECH_DEBT, gates

**Files:** Modify `TECH_DEBT.md`

- [ ] **Step 1:** Read the entry `### [ ] 2026-10-05 — Silent re-auth, re-arm and door probing are Cursor-only`. It stays UNCHECKED (PARTLY RESOLVED). Append a **PARTLY RESOLVED 2026-10-06 (branch `worktree-reauth-extract`)** block (match the file's convention): the shared logic is now extracted — `decideAfterSwitch`, `requestAuthStart`/`isSilentAuthUrl`, `needsRearm`/`rearmReason`, `probeResultLabel` and `gatewaySession`/preflight state + `probeDoors` in the routing hook, with Cursor moved onto them and no behaviour change; what is NOT done: the skins do not yet use them (that is the follow-up PR), and the page-coupled side effects (sign-in modal, overlay, session flags, `selectedTool`) deliberately stay in Cursor.
- [ ] **Step 2:** Gates (redirect to files, read them): `src/components/privilege src/components/aiFootprintMocks src/pages/__tests__/PrivilegeMcpClientPage src/pages/__tests__/FootprintLiveShellPage.sessionSurvives.test.jsx src/pages/__tests__/AiFootprintShellPages.test.js` plus ratchets `src/components/__tests__/themingRatchet.test.js src/components/__tests__/testConventionsRatchet.test.js src/__tests__/uiRegression.test.js src/__tests__/emojiAllowlistAppWide.test.js src/__tests__/emojiAllowlistSync.test.js`, then `cd demo_api_ui && npm run build`. All green; zero edits to existing tests.
- [ ] **Step 3:** Commit: `docs(tech-debt): note the re-auth/re-arm/probe logic is extracted; skins still pending`. Do NOT push, open a PR, merge or deploy.
