# Banking Agent Architecture Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve the 4 deferred Banking Agent architectural debts (dead code, embeddedFocus parity, AbortController, double-mount) in increasing risk order, one commit per phase.

**Architecture:** Phases 1-3 are localized changes verified by the existing 98-test agent suite + new helper unit tests. Phase 4 replaces the dual-mount with a single lifted `<BankingAgent>` whose `floatShell` is portaled into the active surface host, staged none→bottom→middle→cleanup.

**Tech Stack:** CRA (ES modules + JSX in `.js`), React `createPortal`, Jest via `react-scripts test`. Pure helpers in `banking_api_ui/src/components/bankingAgentSafety.js`.

---

## Source spec

`docs/superpowers/specs/2026-05-18-banking-agent-architecture-hardening-design.md` (committed). Read it if any task is ambiguous.

## Global conventions (every task)

- Repo root: `/Users/curtismuir/Development/banking`. UI dir: `banking_api_ui`.
- Test runner: `cd banking_api_ui && CI=true npx react-scripts test <paths> --watchAll=false`. **Bare `npx jest` is wrong** (skips Babel).
- Build gate: `cd banking_api_ui && npm run build` — must exit 0 ("Compiled with warnings" is OK if warnings are pre-existing; "Failed to compile" is not).
- Full agent suite (run after every phase): `cd banking_api_ui && CI=true npx react-scripts test src/__tests__/BankingAgent.test.js src/__tests__/BankingAgent.safety.test.js src/__tests__/BankingAgent.integration.test.js src/__tests__/BankingAgent.chipRouting.test.js src/context/__tests__/AgentUiModeContext.test.js --watchAll=false` — baseline is 98 in the first four suites + the AgentUiModeContext suite; must not regress.
- **Git hygiene (critical):** the working tree has long-standing unrelated dirty files. Stage ONLY this task's files by explicit pathspec. `BankingAgent.js` additionally has pre-existing dirty hunks at old-side ~5065/~5135 (ERROR_EXPLAINER block) that must NEVER be staged — when committing a `BankingAgent.js` change, filter the diff to your task's hunks via the patch-filter recipe in Appendix A. Always `git diff --cached --stat` and inspect the staged `BankingAgent.js` diff before committing. Commit with `git commit --no-verify` (the pre-commit hook's lint-staged restages files and corrupts scoped commits; `--no-verify` is safe per project memory). After committing run `git show --stat HEAD --format=""` to confirm only intended files landed.
- Emoji rule: only `⚠️` `✅` `❌`. No others anywhere.
- §1 files touched: `BankingAgent.js` (Phases 3,4), `App.js` (Phases 2,4), `UserDashboard.js` (Phases 1,4). Before editing each, state in the commit body / task notes the preserved invariants listed in that phase.

## File Structure

| File | Phase | Responsibility / change |
|---|---|---|
| `banking_api_ui/src/components/SideAgentDock.js` `.css`, `ResponsiveAgentDock.js` | 1 | DELETE (dead) |
| `banking_api_ui/src/hooks/useChatWidget.js` | 1 | DELETE (dead no-op) |
| `banking_api_ui/src/context/AgentUiModeContext.js` | 1 | Remove right/left-dock + dead CustomEvent; safe fallback |
| `banking_api_ui/src/context/__tests__/AgentUiModeContext.test.js` | 1 | Remove dead-mode tests; add fallback test |
| `banking_api_ui/src/components/UserDashboard.js` | 1,4 | Remove dead useChatWidget; (4) middle uses portal host |
| `banking_api_ui/src/components/bankingAgentSafety.js` | 2,3 | Add `resolveEmbeddedFocus`, `isAgentRoute` helpers |
| `banking_api_ui/src/__tests__/BankingAgent.safety.test.js` | 2,3 | Helper unit tests |
| `banking_api_ui/src/components/EmbeddedAgentDock.js` | 2,4 | (2) use helper; (4) expose portal host, drop own `<BankingAgent>` |
| `banking_api_ui/src/App.js` | 2,4 | (2) pass embeddedFocus to float; (4) single lifted mount + portal routing |
| `banking_api_ui/src/services/bankingAgentService.js` | 3 | `callMcpTool` accepts `signal` |
| `banking_api_ui/src/services/bankingAgentLangGraphClientService.js` | 3 | `sendMessage` accepts `signal` |
| `REGRESSION_PLAN.md` | 1,3,4 | §4 entries |

---

## Pre-flight

- [ ] **Step 1: Confirm clean baseline**

Run: `cd /Users/curtismuir/Development/banking/banking_api_ui && npm run build 2>&1 | tail -2 && echo "EXIT=$?"`
Expected: build line + EXIT=0.

- [ ] **Step 2: Baseline suite**

Run: `cd /Users/curtismuir/Development/banking/banking_api_ui && CI=true npx react-scripts test src/__tests__/BankingAgent.test.js src/__tests__/BankingAgent.safety.test.js src/__tests__/BankingAgent.integration.test.js src/__tests__/BankingAgent.chipRouting.test.js src/context/__tests__/AgentUiModeContext.test.js --watchAll=false 2>&1 | tail -6`
Expected: all suites pass; record counts as the regression baseline.

---

## Task 1: Phase 1 — Dead-code removal

**§1 note:** `UserDashboard.js` is §1 (REAUTH_KEY, `middleAgentOpen` init, `fetchUserData` 401, FAB/dock/consent). This task removes ONLY a dead import + a no-op hook call there — no state/effect/handler/route/control-flow line changes. State this in the commit.

**Files:**
- Delete: `banking_api_ui/src/components/SideAgentDock.js`, `banking_api_ui/src/components/SideAgentDock.css`, `banking_api_ui/src/components/ResponsiveAgentDock.js`, `banking_api_ui/src/hooks/useChatWidget.js`
- Modify: `banking_api_ui/src/context/AgentUiModeContext.js`, `banking_api_ui/src/components/UserDashboard.js`
- Test: `banking_api_ui/src/context/__tests__/AgentUiModeContext.test.js`

- [ ] **Step 1: Confirm the files are dead**

Run: `cd /Users/curtismuir/Development/banking && grep -rn 'SideAgentDock\|ResponsiveAgentDock\|useChatWidget\|banking-agent-ui-mode' banking_api_ui/src --include='*.js' --include='*.jsx'`
Expected: `SideAgentDock`/`ResponsiveAgentDock` only in their own files; `useChatWidget` only in `hooks/useChatWidget.js` + `UserDashboard.js:13,516`; `banking-agent-ui-mode` only in `AgentUiModeContext.js:139`. If anything else references them, STOP and report — they are not dead.

- [ ] **Step 2: Delete the orphan files**

```bash
cd /Users/curtismuir/Development/banking
git rm banking_api_ui/src/components/SideAgentDock.js banking_api_ui/src/components/SideAgentDock.css banking_api_ui/src/components/ResponsiveAgentDock.js banking_api_ui/src/hooks/useChatWidget.js
```

- [ ] **Step 3: Remove the dead `useChatWidget` usage from UserDashboard.js**

In `banking_api_ui/src/components/UserDashboard.js` delete the import line (line 13):
```javascript
import useChatWidget from "../hooks/useChatWidget";
```
and delete the call line (line 516, the whole line):
```javascript
  useChatWidget();
```
Change nothing else in the file.

- [ ] **Step 4: Strip right-dock/left-dock + dead CustomEvent from AgentUiModeContext.js**

Make these exact edits in `banking_api_ui/src/context/AgentUiModeContext.js`:

(a) Typedef (line 9) — replace:
```javascript
 * @property {'middle' | 'bottom' | 'none' | 'right-dock' | 'left-dock'} placement — Middle = split column agent; Bottom = dock; none = float-only; right-dock = collapsible right sidebar (width-resizable); left-dock = collapsible left sidebar.
```
with:
```javascript
 * @property {'middle' | 'bottom' | 'none'} placement — Middle = split column agent; Bottom = dock; none = float-only.
```

(b) `syncLegacyString` — delete these two branches entirely (lines 48-55):
```javascript
    if (state.placement === 'right-dock') {
      localStorage.setItem(STORAGE_KEY_LEGACY, 'both');
      return;
    }
    if (state.placement === 'left-dock') {
      localStorage.setItem(STORAGE_KEY_LEGACY, 'both');
      return;
    }
```
(The trailing `localStorage.setItem(STORAGE_KEY_LEGACY, 'both');` fallback at line 56 stays — it now also covers the `middle`+fab case it already covered.)

(c) `readState` — replace the validation block (lines 72-84):
```javascript
      if (
        (p === 'middle' || p === 'bottom' || p === 'none' || p === 'right-dock' || p === 'left-dock') &&
        typeof fab === 'boolean'
      ) {
        if (p === 'none' && !fab) {
          return { placement: 'none', fab: true };
        }
        return { placement: p, fab };
      }
      // Dock types with non-boolean fab default to true
      if ((p === 'right-dock' || p === 'left-dock') && typeof fab !== 'boolean') {
        return { placement: p, fab: true };
      }
```
with:
```javascript
      if ((p === 'middle' || p === 'bottom' || p === 'none') && typeof fab === 'boolean') {
        if (p === 'none' && !fab) {
          return { placement: 'none', fab: true };
        }
        return { placement: p, fab };
      }
      // Any other persisted placement (incl. removed right-dock/left-dock) is
      // unsupported — fall back to a safe rendering mode instead of a no-agent state.
      if (p === 'right-dock' || p === 'left-dock') {
        return { placement: 'bottom', fab: typeof fab === 'boolean' ? fab : true };
      }
```

(d) Delete the dead CustomEvent dispatch in `setAgentUi` (lines 137-143):
```javascript
      try {
        window.dispatchEvent(
          new CustomEvent('banking-agent-ui-mode', { detail: out })
        );
      } catch {
        /* ignore */
      }
```
(Remove the whole block. Nothing listens for this event — verified Step 1.)

(e) Comment block lines 100-106 — replace the `Right-dock` line:
```javascript
 * Right-dock — agent in collapsible right sidebar (width-resizable).
```
delete that single line (leave the surrounding lines).

- [ ] **Step 5: Update AgentUiModeContext.test.js**

In `banking_api_ui/src/context/__tests__/AgentUiModeContext.test.js`, delete the entire `describe("left-dock and right-dock placements", ...)` block (starts ~line 95). Append a new test (inside the top-level describe, or as a new `describe`) proving the safe fallback:

```javascript
describe("removed dock placements fall back safely", () => {
  it("a stored right-dock placement reads back as bottom (never a no-agent state)", () => {
    localStorage.setItem(
      "banking_agent_ui_v2",
      JSON.stringify({ placement: "right-dock", fab: true }),
    );
    render(
      <AgentUiModeProvider>
        <Probe />
      </AgentUiModeProvider>,
    );
    expect(screen.getByTestId("placement")).toHaveTextContent("bottom");
  });
});
```
NOTE: match the existing test file's render/Probe harness. Read the top of the file first; reuse whatever component the existing tests use to read `placement` (the deleted block used a `data-testid="placement"` probe — reuse that exact harness; do not invent a new one).

- [ ] **Step 6: Build + suite**

Run: `cd /Users/curtismuir/Development/banking/banking_api_ui && npm run build 2>&1 | grep -iE "Failed to compile|SideAgentDock|useChatWidget|Compiled"; echo "EXIT=$?"`
Expected: "Compiled with warnings" or success, EXIT=0, no "Failed to compile", no module-not-found for the deleted files.

Run the full agent suite (Global conventions command).
Expected: baseline counts unchanged; `AgentUiModeContext` suite green incl. the new fallback test; the deleted dead-mode describe is gone.

- [ ] **Step 7: Confirm nothing references the deleted symbols**

Run: `cd /Users/curtismuir/Development/banking && grep -rn 'SideAgentDock\|ResponsiveAgentDock\|useChatWidget\|right-dock\|left-dock\|banking-agent-ui-mode' banking_api_ui/src`
Expected: no output.

- [ ] **Step 8: REGRESSION_PLAN §4 entry**

Insert at the TOP of §4 in `REGRESSION_PLAN.md` (above the current newest `### 2026-` entry):

```markdown
### 2026-05-18 — Dead agent-UI code removed (SideAgentDock/ResponsiveAgentDock/right-dock/left-dock/useChatWidget/dead CustomEvent)

**Files changed:**
- Deleted `banking_api_ui/src/components/SideAgentDock.js` `.css`, `ResponsiveAgentDock.js`, `banking_api_ui/src/hooks/useChatWidget.js` — all had zero live references / were hardcoded no-ops.
- `banking_api_ui/src/context/AgentUiModeContext.js` — removed `right-dock`/`left-dock` placement (typedef, `syncLegacyString` branches, `readState`); a stored unknown/removed placement now falls back to `bottom` instead of a state where no agent renders; deleted the `banking-agent-ui-mode` CustomEvent dispatch (no listeners existed).
- `banking_api_ui/src/components/UserDashboard.js` — removed the dead `useChatWidget` import + no-op call (§1 file: no state/effect/handler/route/control-flow changed).
- `banking_api_ui/src/context/__tests__/AgentUiModeContext.test.js` — removed dead-mode tests; added a fallback regression test.

**What was broken:** `right-dock`/`left-dock` were selectable/persistable placements that no component rendered, so a user/scenario persisting them reached a state with no agent UI at all. `SideAgentDock`/`ResponsiveAgentDock`/`useChatWidget`/the `banking-agent-ui-mode` event were dead weight (no references / hardcoded-false guard / no listeners).

**What was fixed:** Dead files deleted; removed placements now degrade to `bottom`.

**Verify:** `grep -rn 'SideAgentDock\|ResponsiveAgentDock\|useChatWidget\|right-dock\|left-dock\|banking-agent-ui-mode' banking_api_ui/src` → empty. `cd banking_api_ui && npm run build` exit 0. AgentUiModeContext suite green incl. the right-dock→bottom fallback test.

**Do not break:** A stale/unknown persisted placement MUST fall back to a rendering mode (`bottom`), never pass through. Do not reintroduce a `banking-agent-ui-mode` listener contract or the localhost `useChatWidget` bridge — hosted builds use the React `BankingAgent`.
```

- [ ] **Step 9: Commit (scoped)**

```bash
cd /Users/curtismuir/Development/banking
git add banking_api_ui/src/context/AgentUiModeContext.js banking_api_ui/src/context/__tests__/AgentUiModeContext.test.js banking_api_ui/src/components/UserDashboard.js REGRESSION_PLAN.md
# the git rm in Step 2 already staged the 4 deletions
git diff --cached --stat
```
Inspect: staged set must be exactly the 4 deletions + the 4 modified files above. UserDashboard.js staged diff must show ONLY the import + the `useChatWidget();` line removed. If anything else appears, `git reset` and re-stage precisely. Then:
```bash
git commit --no-verify -m "refactor(agent): remove dead SideAgentDock/right-dock/useChatWidget/CustomEvent

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
git show --stat HEAD --format=""
```

---

## Task 2: Phase 2 — `embeddedFocus` route-parity

**§1 note:** `App.js` is §1 (BankingAgent FAB / bottom-dock-on-dashboard). Change is additive (one prop). State preserved invariants in commit.

**Files:**
- Modify: `banking_api_ui/src/components/bankingAgentSafety.js`, `banking_api_ui/src/components/EmbeddedAgentDock.js`, `banking_api_ui/src/components/UserDashboard.js`, `banking_api_ui/src/App.js`
- Test: `banking_api_ui/src/__tests__/BankingAgent.safety.test.js`

- [ ] **Step 1: Failing test for the helper**

Append to `banking_api_ui/src/__tests__/BankingAgent.safety.test.js`. First ensure the import line at the top includes `resolveEmbeddedFocus`:
`import { claimPendingNl, clampPanelPosition, makeReentrancyGuard, resolveEmbeddedFocus } from "../components/bankingAgentSafety";`
Then append:
```javascript
describe("resolveEmbeddedFocus — route → agent persona parity (Phase 2)", () => {
  test("config route resolves to 'config'", () => {
    expect(resolveEmbeddedFocus("/config")).toBe("config");
    expect(resolveEmbeddedFocus("/config/")).toBe("config");
  });
  test("dashboard and other routes resolve to 'banking'", () => {
    expect(resolveEmbeddedFocus("/dashboard")).toBe("banking");
    expect(resolveEmbeddedFocus("/")).toBe("banking");
    expect(resolveEmbeddedFocus("/admin")).toBe("banking");
    expect(resolveEmbeddedFocus("/monitoring/api-traffic")).toBe("banking");
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `cd /Users/curtismuir/Development/banking/banking_api_ui && CI=true npx react-scripts test src/__tests__/BankingAgent.safety.test.js -t "resolveEmbeddedFocus" --watchAll=false 2>&1 | tail -6`
Expected: FAIL (`resolveEmbeddedFocus is not a function`).

- [ ] **Step 3: Implement the helper (verbatim port of the dock predicate)**

The current dock predicate is `pathname.replace(/\/$/, '') === '/config'` (`EmbeddedAgentDock.js:103`). Append to `banking_api_ui/src/components/bankingAgentSafety.js`:
```javascript
/**
 * Map a route to the agent's embeddedFocus persona. This is a verbatim port
 * of EmbeddedAgentDock's historical isConfigPage predicate so the bottom
 * dock's behavior is provably unchanged; middle/float now match it.
 */
export function resolveEmbeddedFocus(pathname) {
  const p = typeof pathname === "string" ? pathname.replace(/\/$/, "") : "";
  return p === "/config" ? "config" : "banking";
}
```

- [ ] **Step 4: Run, verify pass**

Run: `cd /Users/curtismuir/Development/banking/banking_api_ui && CI=true npx react-scripts test src/__tests__/BankingAgent.safety.test.js -t "resolveEmbeddedFocus" --watchAll=false 2>&1 | tail -6`
Expected: 2 tests PASS.

- [ ] **Step 5: Use the helper in EmbeddedAgentDock.js**

In `banking_api_ui/src/components/EmbeddedAgentDock.js` add the import (with the existing imports near the top, matching style):
```javascript
import { resolveEmbeddedFocus } from './bankingAgentSafety';
```
Replace line 103:
```javascript
  const isConfigPage = pathname.replace(/\/$/, '') === '/config';
```
with:
```javascript
  const isConfigPage = resolveEmbeddedFocus(pathname) === 'config';
```
(Leave the two `isConfigPage ? ... : ...` aria/label uses unchanged — behavior identical.) Replace the `embeddedFocus={isConfigPage ? 'config' : 'banking'}` prop (line 164) with:
```javascript
            embeddedFocus={resolveEmbeddedFocus(pathname)}
```

- [ ] **Step 6: Use the helper in UserDashboard.js (middle)**

In `banking_api_ui/src/components/UserDashboard.js`: confirm `useLocation` is already imported (it is used elsewhere) and a `pathname` is in scope in the component; if not, add `const { pathname } = useLocation();` near the other hooks. Add the import:
```javascript
import { resolveEmbeddedFocus } from "./bankingAgentSafety";
```
Replace the middle mount prop (line 2673) `embeddedFocus="banking"` with:
```javascript
                embeddedFocus={resolveEmbeddedFocus(pathname)}
```
NOTE: read the component around line 2669 to confirm a `pathname` identifier exists; if the component uses a different name (e.g. `location.pathname`), use that. Do not add a second `useLocation` if one exists.

- [ ] **Step 7: Use the helper in App.js (float mount)**

In `banking_api_ui/src/App.js` add `resolveEmbeddedFocus` import (the file imports many helpers; add alongside, matching style):
```javascript
import { resolveEmbeddedFocus } from "./components/bankingAgentSafety";
```
The float mount (lines 1398-1402) is:
```javascript
              <BankingAgent
                user={user}
                onLogout={logout}
                distinctFloatingChrome
              />
```
Add the prop (a `pathname` is already in scope at App.js:227 `const { pathname } = useLocation();`):
```javascript
              <BankingAgent
                user={user}
                onLogout={logout}
                embeddedFocus={resolveEmbeddedFocus(pathname)}
                distinctFloatingChrome
              />
```

- [ ] **Step 8: Build + full suite**

Run build gate + full agent suite (Global conventions). Expected: EXIT 0; baseline unchanged; `BankingAgent.safety.test.js` now +2 (resolveEmbeddedFocus); EmbeddedAgentDock tests (if any) unchanged — proves no bottom-dock regression.

- [ ] **Step 9: REGRESSION_PLAN §4 entry**

Insert at top of §4:
```markdown
### 2026-05-18 — embeddedFocus route-parity across all 3 agent modes

**Files changed:**
- `banking_api_ui/src/components/bankingAgentSafety.js` — new pure `resolveEmbeddedFocus(pathname)` (verbatim port of EmbeddedAgentDock's `/config` predicate).
- `banking_api_ui/src/components/EmbeddedAgentDock.js` — uses the helper (behavior-identical, deduplicated).
- `banking_api_ui/src/components/UserDashboard.js` (middle) and `banking_api_ui/src/App.js` (float) — `embeddedFocus` now route-derived instead of hardcoded `banking`/omitted.
- `banking_api_ui/src/__tests__/BankingAgent.safety.test.js` — helper tests.

**What was broken:** On `/config`, only the bottom dock showed the setup-assistant persona; middle and float showed the banking persona (wrong assistant).

**What was fixed:** All three modes derive `embeddedFocus` from the same single predicate.

**Verify:** safety suite green incl. resolveEmbeddedFocus; `cd banking_api_ui && npm run build` exit 0; on `/config` all modes present the config persona.

**Do not break:** `resolveEmbeddedFocus` MUST mirror EmbeddedAgentDock's route predicate (`pathname.replace(/\/$/, '') === '/config'`). If the config route changes, change it in the helper only.
```

- [ ] **Step 10: Commit (scoped)**

```bash
cd /Users/curtismuir/Development/banking
git add banking_api_ui/src/components/bankingAgentSafety.js banking_api_ui/src/__tests__/BankingAgent.safety.test.js banking_api_ui/src/components/EmbeddedAgentDock.js banking_api_ui/src/components/UserDashboard.js REGRESSION_PLAN.md
git diff --cached --stat
```
App.js change is a §1 file — stage it via the Appendix A patch-filter (its only Phase-2 hunks are the import + the float mount prop; exclude any unrelated dirty hunks). Inspect staged App.js diff: only the import + the `embeddedFocus` prop line. Then:
```bash
git commit --no-verify -m "fix(agent): route-derive embeddedFocus in all 3 modes (config persona parity)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
git show --stat HEAD --format=""
```

---

## Task 3: Phase 3 — AbortController threading

**§1 note:** `BankingAgent.js` is §1 (FAB, float resize caps, `liveAccounts`, consent). Change is additive (signal plumbing + an abort effect); no FAB/resize/liveAccounts/consent line changes. State this in commit.

**Files:**
- Modify: `banking_api_ui/src/components/bankingAgentSafety.js` (route predicate helper), `banking_api_ui/src/services/bankingAgentService.js`, `banking_api_ui/src/services/bankingAgentLangGraphClientService.js`, `banking_api_ui/src/components/BankingAgent.js`
- Test: `banking_api_ui/src/__tests__/BankingAgent.safety.test.js`

- [ ] **Step 1: Failing test — abort classification helper**

The component needs to know (a) which routes are "agent routes" (don't abort) and (b) that an `AbortError` is silent. Add a tiny pure classifier so it's unit-testable. Append to the safety test file (add `isAbortError` to the import line):
```javascript
import { isAbortError } from "../components/bankingAgentSafety";

describe("isAbortError — silent-cancel classification (Phase 3)", () => {
  test("DOMException AbortError is recognized", () => {
    const e = new DOMException("aborted", "AbortError");
    expect(isAbortError(e)).toBe(true);
  });
  test("a plain error named AbortError is recognized", () => {
    const e = new Error("x");
    e.name = "AbortError";
    expect(isAbortError(e)).toBe(true);
  });
  test("an ordinary error is not an abort", () => {
    expect(isAbortError(new Error("network"))).toBe(false);
    expect(isAbortError(null)).toBe(false);
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `cd /Users/curtismuir/Development/banking/banking_api_ui && CI=true npx react-scripts test src/__tests__/BankingAgent.safety.test.js -t "isAbortError" --watchAll=false 2>&1 | tail -6`
Expected: FAIL (`isAbortError is not a function`).

- [ ] **Step 3: Implement `isAbortError`**

Append to `banking_api_ui/src/components/bankingAgentSafety.js`:
```javascript
/**
 * True for fetch/AbortController cancellation. Such errors are intentional
 * (component unmounted / route changed / superseded send) and must be
 * swallowed silently — never surfaced as a user-facing failure.
 */
export function isAbortError(err) {
  return Boolean(err) && err.name === "AbortError";
}
```

- [ ] **Step 4: Run, verify pass**

Run: `cd /Users/curtismuir/Development/banking/banking_api_ui && CI=true npx react-scripts test src/__tests__/BankingAgent.safety.test.js -t "isAbortError" --watchAll=false 2>&1 | tail -6`
Expected: 3 tests PASS.

- [ ] **Step 5: Add optional `signal` to the service functions**

`banking_api_ui/src/services/bankingAgentService.js` — `callMcpTool` is `export async function callMcpTool(tool, params = {})` (line 77). Change signature to `export async function callMcpTool(tool, params = {}, { signal } = {})` and pass `signal` into every `fetch("/api/mcp/tool", fetchOpts)` in that function — i.e. set `fetchOpts.signal = signal` before each `fetch` call (lines ~179, ~263) so retries also carry it. Do NOT change the retry logic itself, only thread `signal` into `fetchOpts`.

`banking_api_ui/src/services/bankingAgentLangGraphClientService.js` — `sendMessage` is `export async function sendMessage(message, consentId = null)` (line 37). Change to `export async function sendMessage(message, consentId = null, { signal } = {})` and add `signal` to the `fetch(...)` options object inside it.

If either fetch options object is built inline, add `signal,` to it (a bare `signal: undefined` is harmless — `fetch` ignores undefined signals).

- [ ] **Step 6: Wire the AbortController in BankingAgent.js**

Read `banking_api_ui/src/components/BankingAgent.js` around: the import block (~line 77), the ref cluster (~line 1710 where `nlSendGuardRef` lives), the `handleNaturalLanguageInner` / `sendAsNlInner` send sites, the resume effect (~line 6112), and how `callMcpTool`/`sendMessage`/the inline `fetch("/api/banking-agent/nl"...)` are invoked.

(a) Import: add `isAbortError` to the existing `./bankingAgentSafety` import.

(b) Add a controller ref next to `nlSendGuardRef`:
```javascript
  const sendAbortRef = useRef(null);
```

(c) Add a helper inside the component (near `clampDragPosToViewport`, a `useCallback` with `[]` deps) that mints a fresh controller, aborting any prior one:
```javascript
  const beginAbortableSend = useCallback(() => {
    if (sendAbortRef.current) {
      try { sendAbortRef.current.abort(); } catch (_) {}
    }
    const c = new AbortController();
    sendAbortRef.current = c;
    return c.signal;
  }, []);
```

(d) At the start of each real send path — `handleNaturalLanguageInner`, `sendAsNlInner`'s rAF fetch branch, the resume effect's `sendAgentMessage` call, and the `think:`/`reason:` inline fetch — capture `const signal = beginAbortableSend();` once at the top of that send, and:
   - pass `{ signal }` as the new 3rd/extra arg to `callMcpTool(...)` / `sendMessage(...)` calls in that path;
   - for inline `fetch("/api/banking-agent/nl"...)` / `fetch("/api/mcp/tool"...)` calls that currently use `signal: AbortSignal.timeout(15000)`, change to `signal: AbortSignal.any([AbortSignal.timeout(15000), signal])`.
   (`AbortSignal.any` is supported in the project's target browsers/CRA polyfill; if a test environment lacks it, the safety test in Step 8 will catch it and you add a minimal `any` shim in `bankingAgentSafety.js` — only if needed.)

(e) In the `catch` of each of those paths: if `isAbortError(err)` return early WITHOUT calling `reportNlFailure` and WITHOUT adding an error message. In the `finally`: only call `setNlLoading(false)` / append token events if `!signal.aborted` (guard the state writes so an aborted, superseded, or unmounted send does not flip UI state or write the Token Chain). The reentrancy guard `release()` MUST still run unconditionally in the finally (an aborted send must free the guard).

(f) Add an abort-on-unmount-and-route-change effect. Place it near the other geometry/lifecycle effects. Use the existing route signal the component already has (it uses `useLocation`/`searchParams`; find the in-scope `pathname` or `location`):
```javascript
  // Cancel any in-flight agent request when this instance unmounts OR the
  // route changes away from where the request was issued. Prevents state
  // updates on a dead/wrong instance and mis-attributed Token Chain events.
  useEffect(() => {
    return () => {
      if (sendAbortRef.current) {
        try { sendAbortRef.current.abort(); } catch (_) {}
        sendAbortRef.current = null;
      }
    };
  }, [pathname]);
```
NOTE: the cleanup runs on unmount AND whenever `pathname` changes (React runs the previous effect's cleanup before re-running) — that is exactly the "unmount + route-change" scope. If the component's location identifier is not literally `pathname`, use the actual one (e.g. `location.pathname`); do not add a duplicate `useLocation`.

- [ ] **Step 7: Failing integration test — abort is wired + silent + guard releases**

Append to `banking_api_ui/src/__tests__/BankingAgent.safety.test.js`:
```javascript
describe("abort wiring contract (Phase 3)", () => {
  test("a fetch given an aborted signal rejects with AbortError and isAbortError catches it", async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const p = fetch("/never", { signal: ctrl.signal }).catch((e) => e);
    const err = await p;
    expect(isAbortError(err)).toBe(true);
  });
  test("AbortSignal.any aborts when either input aborts", () => {
    const a = new AbortController();
    const b = new AbortController();
    const any = AbortSignal.any([a.signal, b.signal]);
    expect(any.aborted).toBe(false);
    b.abort();
    expect(any.aborted).toBe(true);
  });
});
```

- [ ] **Step 8: Run, verify pass; build; full suite**

Run: `cd /Users/curtismuir/Development/banking/banking_api_ui && CI=true npx react-scripts test src/__tests__/BankingAgent.safety.test.js --watchAll=false 2>&1 | tail -8`
Expected: all safety describes pass (claimPendingNl, clampPanelPosition, makeReentrancyGuard, resolveEmbeddedFocus, isAbortError, abort wiring). If `AbortSignal.any` is undefined in jsdom, add a minimal shim in `bankingAgentSafety.js` (`export function anySignal(signals){...}`) and use it in BankingAgent.js instead of `AbortSignal.any`; re-run.

Run build gate + full agent suite. Expected: EXIT 0; baseline 98 unchanged (no new "state update on unmounted component" should appear; if any test now logs that warning, the guard in 6(e) is wrong — fix before proceeding).

- [ ] **Step 9: Manual smoke**

Start the app (`cd /Users/curtismuir/Development/banking && ./run-bank-local.sh restart api` not needed — UI only; ensure dev server running or use build). Sign in, open the agent, fire a banking command, and immediately navigate away from the dashboard. Expected: no console "Can't perform a React state update on an unmounted component"; no Token Chain event appears attributed after navigation. Record the observation in the commit body.

- [ ] **Step 10: §4 entry + commit (scoped, Appendix A for BankingAgent.js)**

§4 entry at top of §4:
```markdown
### 2026-05-18 — AbortController on the agent send pipeline (no state-on-dead-instance / mis-attributed Token Chain)

**Files changed:**
- `banking_api_ui/src/components/bankingAgentSafety.js` — `isAbortError` (+ optional `anySignal` shim if jsdom lacks `AbortSignal.any`).
- `banking_api_ui/src/services/bankingAgentService.js` / `bankingAgentLangGraphClientService.js` — `callMcpTool` / `sendMessage` accept an optional `{ signal }` forwarded to fetch.
- `banking_api_ui/src/components/BankingAgent.js` — a per-send `AbortController` (ref); fresh per send (aborts the prior); aborted on unmount AND route-change; `AbortError` swallowed silently; `nlLoading`/Token-Chain writes skipped when the signal is already aborted; reentrancy guard still releases on abort.
- `banking_api_ui/src/__tests__/BankingAgent.safety.test.js` — abort classification + wiring tests.

**What was broken:** In-flight NL/MCP calls had no cancellation. On unmount/route-change their handlers ran `setMessages`/`setNlLoading`/`appendTokenEvents` on a dead/wrong instance → React warnings + Token Chain events attributed to a destroyed instance (compounded by the dual-mount; Phase 4 addresses the dual mount itself).

**What was fixed:** One AbortController per send, aborted on unmount + route change; `AbortError` is silent; UI/Token-Chain writes guarded on `signal.aborted`.

**Verify:** safety suite green incl. abort tests; `cd banking_api_ui && npm run build` exit 0; manual: fire a command then navigate away → no unmounted-state-update warning.

**Do not break:** `AbortError` MUST stay silent (never `reportNlFailure`). The abort must NOT double-flip `nlLoading` or write Token Chain when aborted. The reentrancy guard MUST still `release()` on an aborted send. Abort scope is unmount + route-change (the route-change cleanup is load-bearing once Phase 4 makes the instance long-lived).
```
Commit: stage the service files, safety test, REGRESSION_PLAN whole; stage `BankingAgent.js` via Appendix A (Phase-3 hunks only; exclude the pre-existing ~5065/~5135 ERROR_EXPLAINER hunks). Inspect staged BankingAgent.js diff = only the import, `sendAbortRef`, `beginAbortableSend`, the per-send signal wiring, the abort effect. Then:
```bash
git commit --no-verify -m "fix(agent): AbortController on NL/MCP send (unmount + route-change cancel)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
git show --stat HEAD --format=""
```

---

## Task 4: Phase 4 — Double-mount → single instance (HIGH risk, staged)

**§1 note:** touches `App.js` (FAB / bottom-dock-on-dashboard rows) and `BankingAgent.js` (FAB, float resize caps), and `UserDashboard.js` (middle layout) / `EmbeddedAgentDock.js`. Before EACH sub-step state the preserved invariants: FAB visibility semantics, float resize 90% caps, `liveAccounts` hydration, consent/`hitlPendingIntent` gating, REAUTH_KEY, marketing-guest float behavior, bottom-dock-on-dashboard behavior.

**Mechanism:** One `<BankingAgent>` mounts once at a stable point in `App.js`. It accepts a new prop `surfaceHostRef` (a React ref to the DOM node it should portal its `floatShell` into) plus the existing `mode`. When `surfaceHostRef?.current` is set, `BankingAgent` renders `createPortal(floatShell, surfaceHostRef.current)` instead of `createPortal(floatShell, document.body)`. The dock/middle wrappers render an empty host `<div ref={hostRef} />` and publish that ref upward (via `AgentUiModeContext` or an App-level ref registry) instead of rendering their own `<BankingAgent>`.

This task is staged. Commit after EACH of 4a–4d (4 commits). Run build + full suite at each.

### Task 4a: Introduce host-ref portal indirection (float-only, behavioral no-op)

**Files:** `banking_api_ui/src/components/BankingAgent.js`, `banking_api_ui/src/App.js`

- [ ] **Step 1** — In `BankingAgent.js` find the portal return (the analysis cites `if (isInline) return <>{floatShell}</>; return createPortal(floatShell, document.body);` near line 8862). Add an optional prop `surfaceHostRef` to the component signature (default `undefined`). Change the portal return so the float (non-inline) path is:
```javascript
  if (isInline) return <>{floatShell}</>;
  const host =
    surfaceHostRef && surfaceHostRef.current
      ? surfaceHostRef.current
      : document.body;
  return createPortal(floatShell, host);
```
For now NO caller passes `surfaceHostRef`, so `host` is always `document.body` — **behavioral no-op**. Confirm by reading: the float mount in App.js (1398) does not pass it.

- [ ] **Step 2** — Build gate + full agent suite. Expected: identical to baseline (no behavior change — this only adds an unused optional prop + an equivalent default). If anything changes, the portal edit is wrong; fix before committing.

- [ ] **Step 3** — Manual smoke: float mode (placement none) — FAB + panel still work, drag/resize unaffected, conversation works. (This proves the indirection is inert.)

- [ ] **Step 4** — §4 entry (brief: "4a — introduced surfaceHostRef portal indirection, float-only no-op; see 4d for the completed single-instance invariant") and commit `BankingAgent.js` via Appendix A patch-filter (only the signature + portal-return hunk). `git commit --no-verify -m "refactor(agent): surfaceHostRef portal indirection (no-op, prep single-instance)"` + Co-Authored-By trailer.

### Task 4b: Bottom dock = portal host (remove its own `<BankingAgent>`)

**Files:** `banking_api_ui/src/components/EmbeddedAgentDock.js`, `banking_api_ui/src/App.js`

- [ ] **Step 1: Decide the ref-publishing channel.** Add to `AgentUiModeContext` a `surfaceHostRef` (a `useRef(null)` created in the provider) plus `setSurfaceHostEl(el)` that assigns `surfaceHostRef.current = el` and forces a re-render of consumers (store the element in state: `const [surfaceHostEl, setSurfaceHostEl] = useState(null)` and expose both `surfaceHostEl` and `setSurfaceHostEl`). This is the registry the dock/middle publish into and App reads.

- [ ] **Step 2:** In `EmbeddedAgentDock.js`, replace the `<BankingAgent ... />` block (lines 159-167) with a host div that registers itself:
```javascript
          <div
            className="embedded-agent-dock-host"
            ref={(el) => setSurfaceHostEl(el)}
          />
```
where `setSurfaceHostEl` comes from `useContext(AgentUiModeContext)`. Keep all dock chrome (resize/collapse/height/persistence) untouched. Remove the now-unused `BankingAgent` import and the `embeddedFocus`/`isConfigPage`-for-BankingAgent usage IF `isConfigPage` is no longer referenced after removal (it is still used for the aria-label/title at 109/139 — keep those and keep the `isConfigPage` line from Phase 2).

- [ ] **Step 3:** In `App.js`, the single lifted `<BankingAgent>` (currently the float mount at 1398, gated by `showFloatingAgent`) must mount whenever the agent should exist in ANY surface, and receive `surfaceHostRef`. Read App.js 540-580 and 1397-1428. Change the single mount to:
```javascript
            {shouldMountAgent && (
              <BankingAgent
                user={user}
                onLogout={logout}
                embeddedFocus={resolveEmbeddedFocus(pathname)}
                surfaceHostRef={agentSurfaceHostRef}
                distinctFloatingChrome
              />
            )}
```
where `agentSurfaceHostRef` is `{ current: surfaceHostEl }` derived from context (`const { surfaceHostEl } = useContext(...)`; pass `surfaceHostRef={{ current: surfaceHostEl }}`), and `shouldMountAgent` = the existing `showFloatingAgent` OR `hasEmbeddedDockLayout` (i.e. mount the single instance whenever EITHER a dock or a float should show — they now share it). When `placement==='bottom'` and the dock host is registered, `surfaceHostEl` is the dock div → the agent portals into the dock. When float, `surfaceHostEl` is null → portals to `document.body` (4a behavior). Keep `EmbeddedAgentDock` rendered (it now only provides chrome+host). Remove the OLD separate logic that mounted a second `<BankingAgent>` — there must be exactly one `<BankingAgent>` JSX in App.js after this step (plus the standalone `/agent` route mount at 905 which is a separate page — leave it; note it in the §4).

- [ ] **Step 4:** Build + full suite. Manual: placement bottom + fab — exactly ONE agent (in the dock); start a conversation in the dock; toggle fab — no second conversation; the FAB (CSS) just shows/hides over the same instance. placement bottom, no fab — dock only. Float — unchanged.

- [ ] **Step 5:** Verify single instance: temporarily add `window.__baCount = (window.__baCount||0)+1` in BankingAgent's body during dev OR assert via React DevTools that one instance exists in bottom+fab. Remove any temp probe before commit.

- [ ] **Step 6:** §4 entry ("4b — bottom dock is now a portal host of the single instance; no second BankingAgent mounts with bottom+fab"). Commit: `EmbeddedAgentDock.js`, `AgentUiModeContext.js` whole; `App.js` via Appendix A. `git commit --no-verify -m "refactor(agent): bottom dock portals the single BankingAgent instance"` + trailer.

### Task 4c: Middle column = portal host

**Files:** `banking_api_ui/src/components/UserDashboard.js`, `banking_api_ui/src/App.js`

- [ ] **Step 1:** In `UserDashboard.js`, replace the middle `<BankingAgent .../>` block (lines 2669-2677) with a host div registering via context `setSurfaceHostEl`:
```javascript
              <div
                className="ud-dashboard-inline-agent-host"
                ref={(el) => setSurfaceHostEl(el)}
              />
```
(`setSurfaceHostEl` from `useContext(AgentUiModeContext)`.) Keep the surrounding split-column layout, the pop-out button, and `middleAgentOpen` logic (§1) untouched. Remove the now-unused `BankingAgent` import from UserDashboard.js IF nothing else there uses it.

- [ ] **Step 2:** In `App.js`, ensure `shouldMountAgent` also covers `placement==='middle'` on `/dashboard` (it likely already does via the dashboard-route clause; verify against the 4b condition). The single instance now portals into the middle host when middle is active. `splitColumnChrome`/`showPopOut`/`distinctFloatingChrome` props: the single instance can't have per-surface chrome props statically. Pass them as a function of placement: add a small in-render computation in App.js `const agentChrome = surfaceIsMiddle ? { splitColumnChrome: true, showPopOut: true } : {};` (derive `surfaceIsMiddle` from context placement + route) and spread `{...agentChrome}` onto the single `<BankingAgent>`. Keep `distinctFloatingChrome` always (all three modes passed it before).

- [ ] **Step 3:** Build + full suite. Manual: placement middle + fab on /dashboard — one agent in the middle column, pop-out present; switch to float via the toggle — same conversation continues (portal move, not remount); switch to bottom — same conversation in the dock. This cross-surface conversation persistence is the core win — verify it explicitly.

- [ ] **Step 4:** §4 entry ("4c — middle column portals the single instance; conversation persists across middle/bottom/float toggles"). Commit `UserDashboard.js` whole (it is §1 — state invariants: middleAgentOpen/REAUTH_KEY/fetchUserData untouched), `App.js` via Appendix A. `git commit --no-verify -m "refactor(agent): middle column portals the single BankingAgent instance"` + trailer.

### Task 4d: Remove dual-mount remnants; fab = CSS-only; final invariant

**Files:** `banking_api_ui/src/App.js`, `banking_api_ui/src/components/BankingAgent.js` (FAB visibility), `REGRESSION_PLAN.md`

- [ ] **Step 1:** In `App.js`, delete the now-dead branches of the old `showFloatingAgent` that existed solely to force a SECOND instance alongside a dock (the `(Boolean(user) && agentFab && onDashboardAgentRoute)` override clause that overrode `hasEmbeddedDockLayout`). The single mount's `shouldMountAgent` should reduce to: agent should exist on this route for this user (marketing-guest float, or signed-in on a dashboard/dock/monitoring agent route, or placement none). Simplify the boolean; there is exactly one `<BankingAgent>` (plus the `/agent` page route). Read the final `shouldMountAgent` aloud in the commit body and confirm no path yields two.

- [ ] **Step 2:** `fab` becomes pure CSS visibility. In `BankingAgent.js` the FAB button renders when `!isOpen && !isInline` (analysis cite ~6443). FAB visibility must now also respect the context `fab` flag + placement (show the FAB when `placement==='none'` OR `fab===true`; the single instance is always mounted, the FAB is just shown/hidden). Thread `fab`/`placement` (from context, read in App.js) into the single `<BankingAgent>` as a prop `fabVisible` and gate the FAB render on `fabVisible` in addition to the existing `!isOpen && !isInline`. Do NOT change the float panel resize caps or the FAB's existing position/z-index (§1 row "BankingAgent FAB" / "Float panel resize").

- [ ] **Step 3:** Build + full suite. Exhaustive manual matrix — for each `placement ∈ {none,bottom,middle}` × `fab ∈ {true,false}` on `/dashboard`: exactly one `<BankingAgent>`; the FAB shows iff (placement none OR fab true); conversation in the active surface; toggling fab never spawns a second conversation; Token Chain shows events once (no duplicate writer); consent modal still gates a transfer. Record the matrix result in the commit body.

- [ ] **Step 4:** Final §4 entry:
```markdown
### 2026-05-18 — Single BankingAgent instance; surfaces are portal hosts (double-mount eliminated)

**Files changed:** `banking_api_ui/src/App.js` (one lifted `<BankingAgent>`, `shouldMountAgent` simplified, dual-mount override removed), `banking_api_ui/src/components/BankingAgent.js` (`surfaceHostRef` portal target, `fabVisible` prop), `banking_api_ui/src/components/EmbeddedAgentDock.js` / `UserDashboard.js` (render a host div, no own `<BankingAgent>`), `banking_api_ui/src/context/AgentUiModeContext.js` (surface-host registry).

**What was broken:** When `placement≠none && fab`, App.js mounted TWO `<BankingAgent>` instances (dock + float) → split-brain conversation, dual Token-Chain writers (last-writer-wins), 2× session polling, 2× WebSocket churn.

**What was fixed:** Exactly one `<BankingAgent>` mounts (plus the standalone `/agent` page route, which is intentionally separate). Dock/middle/float are portal hosts of that one instance; `fab` is pure CSS visibility. Conversation + Token Chain are unified because there is one instance and one writer.

**Verify:** For every placement×fab combo on /dashboard exactly one instance; conversation persists across dock↔float↔middle toggles; Token Chain events appear once; build exit 0; full agent suite green.

**Do not break:** There MUST be exactly one `<BankingAgent>` instance for the in-app agent (the `/agent` route page is the only other, separate, mount). Surfaces are portal HOSTS — never reintroduce a per-surface `<BankingAgent>`. `fab`/placement only control FAB CSS visibility, never instance count. Preserve FAB position/z-index and float resize 90% caps (§1).
```
Commit `App.js` + `BankingAgent.js` via Appendix A (exclude pre-existing ~5065/~5135 hunks), `REGRESSION_PLAN.md` whole. `git commit --no-verify -m "refactor(agent): single BankingAgent instance, surfaces are portal hosts"` + trailer. `git show --stat HEAD --format=""` — confirm only intended files.

---

## Final verification (after Task 4d)

- [ ] **Step 1:** `cd /Users/curtismuir/Development/banking/banking_api_ui && npm run build 2>&1 | tail -2; echo EXIT=$?` → EXIT 0.
- [ ] **Step 2:** Full agent suite (Global conventions) → baseline + new tests green, no regressions.
- [ ] **Step 3:** `cd /Users/curtismuir/Development/banking && git log --oneline -10` — confirm the phase commits (Phase 1; Phase 2; Phase 3; 4a; 4b; 4c; 4d) are present and scoped.
- [ ] **Step 4:** `git status --porcelain | grep BankingAgent.js` — the pre-existing ~5065/~5135 ERROR_EXPLAINER dirty hunks must STILL be uncommitted in the working tree (never swept into any phase commit). Confirm via `git diff banking_api_ui/src/components/BankingAgent.js | grep -c '^@@'` shows the leftover pre-existing hunks only.

---

## Appendix A — Scoped BankingAgent.js / App.js commit recipe

`BankingAgent.js` (and sometimes `App.js`) carry pre-existing unrelated dirty hunks that must never enter a phase commit. To stage only a task's hunks:

```bash
cd /Users/curtismuir/Development/banking
git reset -q -- <file>            # unstage if needed
git diff -- <file> > /tmp/f.patch
python3 - <<'EOF'
import re
lines=open('/tmp/f.patch').read().splitlines(keepends=True)
he=next(i for i,l in enumerate(lines) if l.startswith('@@'))
header=''.join(lines[:he]); hunks=[]; cur=None
for l in lines[he:]:
    if l.startswith('@@'):
        if cur: hunks.append(cur)
        cur=[l]
    else: cur.append(l)
if cur: hunks.append(cur)
# EDIT THIS SET: the old-side @@ -<start> line numbers of YOUR task's hunks.
KEEP = set()   # e.g. {77, 1710, 2778}
kept = []
for h in hunks:
    old = int(re.match(r'@@ -(\d+)', h[0]).group(1))
    if old in KEEP:
        kept.append(''.join(h))
    else:
        print("EXCLUDING hunk @@ -%d (not in KEEP)" % old)
open('/tmp/keep.patch', 'w').write(header + ''.join(kept))
print("kept", len(kept), "hunks")
EOF
git apply --cached /tmp/keep.patch
git diff --cached -- <file>        # INSPECT: must be ONLY your task's lines
```
Before committing, always inspect `git diff --cached -- banking_api_ui/src/components/BankingAgent.js` and confirm zero ERROR_EXPLAINER / unrelated lines. The known pre-existing contaminant hunks are at old-side ~5065 and ~5135. If unsure which hunks are yours, list headers with `git diff -- <file> | grep -nE '^@@'` and classify by the line numbers your task edited.
