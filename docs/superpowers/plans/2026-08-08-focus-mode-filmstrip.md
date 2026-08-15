# Focus Mode — Filmstrip (Option C) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: `superpowers:executing-plans` (or `superpowers:subagent-driven-development`). Steps use `- [ ]` checkboxes. Invoke `.claude/skills/regression-guard/` before the first edit — this touches a REGRESSION_PLAN §1 UI area.

**Spec:** [`../specs/2026-08-08-focus-mode-filmstrip-design.md`](../specs/2026-08-08-focus-mode-filmstrip-design.md)
**Supersedes:** [`2026-08-07-focus-mode-dashboard.md`](./2026-08-07-focus-mode-dashboard.md) (Option A)
**Worktree:** `/Users/cmuir/Development/AI-DEMO2/.claude/worktrees/focus-mode-v2` (branch `worktree-focus-mode-v2`), off `main` @ `155feb2a`.
**Tech:** React 19.2, Vite 8, Vitest 3.2 (**not jest**), plain JS/JSX.

**Goal:** `placement: 'middle'` renders the agent full width with a horizontal 17-step token-chain filmstrip below it; clicking a step or a chain-level tab raises one detail sheet.

---

## The constraint that shapes every task

`TokenChainTraceRail.jsx` mounts on ~20 surfaces. **It is not modified.** The filmstrip is a new sibling component over the same store and the same child panels. Any task that finds itself editing the rail has gone wrong — stop and re-read the spec.

---

## Global constraints

- Edits in this worktree only — a hard-block hook denies `Write`/`Edit` in the main checkout.
- `git branch --show-current` must print `worktree-focus-mode-v2` before every commit.
- Stage explicitly (`git add <file>`), never `git add -A`.
- Emoji allowlist only: `⚠️ ✅ ❌ 🔐 ✕ ✓ 👤 🔑 🪟 📚`.
- Test runner is **vitest**: `cd demo_api_ui && npm run test:unit`.
- Build gate: `cd demo_api_ui && npm run build` must exit 0.
- `placement: 'bottom'` and `'none'` branches must be byte-identical after the change.
- `UserDashboard.js` (frozen classic) must have **zero** diff.
- `showBankingInMiddle` state stays declared; its feature-flag `useEffect` stays.

---

## Verified anchors (main @ `155feb2a`)

Re-anchor on string match before editing; do not trust line numbers alone.

| What | Line |
|---|---|
| `middleAgentOpen` useState | 164–165 |
| `setMiddleAgentOpen(true)` (sole setter) | 509 |
| `{agentPlacement === "middle" ? (` | 3511 |
| replaced `<div>` opens | 3512 |
| `splitGridClass(` | 3513 |
| `ud-dashboard-config-strip` slot | 3528 |
| `showBankingInMiddle &&` banking `<main>` | 3566 |
| `!middleAgentOpen &&` float-reserve | 3584 |
| `DashboardTokenRail` | 3598 |
| branch closes `</div>` | 3602 |
| `) : (` | 3603 |
| dead middle FAB block | 3663–3684 |

---

### Task 1: Guards first (all must FAIL except the zero-diff ones)

**Create:** `demo_api_ui/src/__tests__/FocusModeFilmstripGuard.test.js`

- [ ] **Step 1: Write the guard file**

Static-source guards, mirroring `EmbeddedDockLayoutGuard.test.js` (JSDOM renders of the dashboard are not viable here).

```js
const fs = require("fs");
const path = require("path");

const read = (p) => fs.readFileSync(path.resolve(__dirname, p), "utf8");
const p2026  = read("../components/UserDashboardPing2026.js");
const classic = read("../components/UserDashboard.js");
const rail   = read("../components/TokenChainTraceRail.jsx");

describe("Focus Mode filmstrip guard", () => {
  test("TokenChainFilmstrip component exists", () => {
    expect(fs.existsSync(path.resolve(__dirname, "../components/TokenChainFilmstrip.jsx"))).toBe(true);
  });

  test("Ping2026 middle branch renders the filmstrip", () => {
    expect(p2026.includes("TokenChainFilmstrip")).toBe(true);
  });

  test("split3 grid is gone from Ping2026", () => {
    expect(p2026.includes("ud-middle-collapsed")).toBe(false);
  });

  test("agent column keeps ud-agent-column so its CSS still applies", () => {
    expect(p2026.includes("ud-agent-column ud-focus-mode-agent-col")).toBe(true);
  });

  test("agentColumnRef stays attached (handleScrollToAssistant depends on it)", () => {
    expect(p2026.includes("ref={agentColumnRef}")).toBe(true);
  });

  test("config strip slot stays in the middle layout", () => {
    expect(p2026.includes('className="ud-dashboard-config-strip"')).toBe(true);
  });

  test("the removed agent login wall is NOT reintroduced (PR #1450)", () => {
    expect(p2026.includes("ud-dashboard-inline-agent-login-prompt")).toBe(false);
  });

  test("orphaned middleAgentOpen state is gone", () => {
    expect(p2026.includes("middleAgentOpen")).toBe(false);
  });

  // ── zero-diff guards: these must pass BEFORE and AFTER ──
  test("the shared TokenChainTraceRail gains no filmstrip markup", () => {
    expect(rail.includes("ud-focus-mode")).toBe(false);
    expect(rail.includes("TokenChainFilmstrip")).toBe(false);
  });

  test("the frozen classic dashboard gains no Focus Mode markup", () => {
    expect(classic.includes("ud-focus-mode")).toBe(false);
    expect(classic.includes("TokenChainFilmstrip")).toBe(false);
  });
});
```

- [ ] **Step 2: Run them — the first eight MUST FAIL, the last two MUST PASS**

```bash
cd /Users/cmuir/Development/AI-DEMO2/.claude/worktrees/focus-mode-v2/demo_api_ui
npm run test:unit -- FocusModeFilmstripGuard 2>&1 | tail -25
```

If a JSX-usage test already passes, stop — the file was edited and these anchors are stale.

- [ ] **Step 3: Commit** — `git add` the test file only.

---

### Task 2: `TokenChainFilmstrip.jsx`

**Create:** `demo_api_ui/src/components/TokenChainFilmstrip.jsx` + `TokenChainFilmstrip.css`

**Reuses, does not fork:** `tokenChainTraceStore`, `buildTraceSteps` / `buildLiveTokenChainSteps`, `TraceStepCard`, `TraceTokenSummary`, `TraceMcpPanel`, `TraceTrustPanel`, `SimpleStepper`, `DetailedStepper`, `TokenChainDemoTrackTab`, `ClaimDetailsModal`, `TokenLegendModal`, `resolveInspectClaims`, `tokenChainTrust`.

- [ ] **Step 1: Copy the rail's state and subscription wiring**

Read `TokenChainTraceRail.jsx` lines 195–270 and mirror: store subscription, `steps` derivation, `viewMode` (`tctr:view-mode`), `zoom` (`tctr:zoom`, 0.8–1.6 step 0.1), `tab` state, `showTrust`, `mcpDone`, `inspectType`, `legendOpen`, `handleClear`.

Use **distinct localStorage keys** (`tcfs:zoom`, `tcfs:view-mode`) so presenter settings on the filmstrip do not fight the rail's on other pages.

- [ ] **Step 2: Render the chrome**

Header bar (title, `Live|Classic`, `A-`/`%`/`A+`, `Clear`, `Legend`) → chain line with party-coloured dots + `CHAINED` → tab row (`Token Chain · Tokens · MCP {mcpDone} · Trust? · Simple · Detailed · Demo Track`) → section label → filmstrip track.

- [ ] **Step 3: Render the track**

`display:flex; overflow-x:auto`. One card per step: lane label, title (2-line clamp), status dot, index. `aria-pressed` reflects selection. Empty state when no steps: *"Run an agent flow to build the token chain."*

- [ ] **Step 4: Render the sheet**

One sheet, `max-height: 78%`. Step selected → `<TraceStepCard step={step} onInspect={...} defaultOpen useCase={proofUseCase} />`. Tab selected (non-chain) → that tab's existing panel component, unchanged.

- [ ] **Step 5: Modals** — mount `ClaimDetailsModal` and `TokenLegendModal` exactly as the rail does.

- [ ] **Step 6: Commit.**

---

### Task 3: Replace the middle branch in `UserDashboardPing2026.js`

- [ ] **Step 1: Re-confirm anchors**

```bash
cd /Users/cmuir/Development/AI-DEMO2/.claude/worktrees/focus-mode-v2
grep -n 'agentPlacement === "middle"\|splitGridClass\|ud-float-reserve\|middleAgentOpen\|DashboardTokenRail\|ud-dashboard-config-strip' demo_api_ui/src/components/UserDashboardPing2026.js
```

- [ ] **Step 2: Replace lines 3512–3602** (the `middle` true-branch only — not the `?` or the `) : (`)

```jsx
<div className="ud-focus-mode-layout">
  <section
    className="ud-agent-column ud-focus-mode-agent-col"
    ref={agentColumnRef}
    aria-label="AI banking assistant"
    data-testid="dashboard-agent-column"
    id="main-dashboard-content"
    tabIndex={-1}
  >
    <div className="ud-dashboard-config-strip" ref={toolbarHostRef} />
    <div className="embedded-banking-agent ud-dashboard-inline-agent">
      {/* Host stays mounted so the BankingAgent portal target's ref always
          attaches. Do NOT add a `{!user && …}` login prompt here — PR #1450
          (f1a8cb21) removed it deliberately; App.js owns guest gating now. */}
      <div className="ud-dashboard-inline-agent-host" ref={middleHostRefCb} />
    </div>
    {/* biome-ignore lint/a11y/noStaticElementInteractions: pointer-only drag; height handle remains keyboard-reachable. */}
    <div
      className="ud-agent-column__resize-handle"
      onMouseDown={onAgentWidthResizeMouseDown}
      role="separator"
      aria-orientation="vertical"
      aria-label="Drag to resize assistant width"
      data-testid="dashboard-agent-column-resize"
    />
  </section>

  <TokenChainFilmstrip />
</div>
```

Traceable changes: grid wrapper → flex column; `id`/`tabIndex` become unconditional (exactly one skip-link target must remain, and the banking `<main>` that held them is gone); banking `<main>` removed; `!middleAgentOpen` float-reserve removed; `DashboardTokenRail` + `ExchangeModeToggle` + `TokenChainTraceRail` replaced by `<TokenChainFilmstrip />`; `ud-agent-column` **kept**.

The vertical `ud-middle-resize-handle` is dropped — the agent now owns full height and there is nothing below it to resize against. `onMiddleResizeMouseDown` / `middleHeight` become orphans; delete only if `grep` shows no other readers.

- [ ] **Step 3: Add the import** — `import TokenChainFilmstrip from "./TokenChainFilmstrip";`

- [ ] **Step 4: Delete the dead FAB (3663–3684)**

The `{agentPlacement === "middle" && !middleAgentOpen && (…)}` block. Unreachable: `middleAgentOpen` initialises to `agentPlacement === "middle"` and is only ever set `true`.

- [ ] **Step 5: Remove orphaned state**

```bash
grep -n "middleAgentOpen" demo_api_ui/src/components/UserDashboardPing2026.js
```

Expect no matches after deleting the `useState` (164) and the `setMiddleAgentOpen(true)` call (509 — remove **only that line**, the surrounding effect also sets `dashboardLayout`). **If any read remains, stop and report — do not delete.**

- [ ] **Step 6: Prune unused imports** — check `splitGridClass`, `DashboardTokenRail`, `ExchangeModeToggle`, `TokenChainTraceRail` for remaining uses in this file; remove from the import block only those with none, or the build lints.

- [ ] **Step 7: Guards pass**

```bash
cd demo_api_ui && npm run test:unit -- FocusModeFilmstripGuard 2>&1 | tail -20
```

- [ ] **Step 8: Full suite + build**

```bash
npm run test:unit 2>&1 | tail -20
npm run build 2>&1 | tail -20
```

Note: `UserDashboardPing2026.test.js` mocks `splitGridClass`; if unused the mock is inert but harmless — leave it.

- [ ] **Step 9: Prove the untouched paths**

```bash
git diff --stat -- demo_api_ui/src/components/UserDashboard.js          # must be empty
git diff --stat -- demo_api_ui/src/components/TokenChainTraceRail.jsx   # must be empty
git diff -- demo_api_ui/src/components/UserDashboardPing2026.js | grep -c "rd2-page-grid\|rd2-right-rail"  # must be 0
```

- [ ] **Step 10: Commit.**

---

### Task 4: Live verification

Static guards cannot prove a layout renders.

- [ ] **Step 1:** Enable `ff_customer_skin_ping2026` via `/api/admin/feature-flags` (admin session required; OFF by default).
- [ ] **Step 2:** Serve the worktree UI on :4443 (symlink `node_modules` + `certs`) so the Docker-bound main checkout is undisturbed.
- [ ] **Step 3:** Sign in at `https://local.ping-devops.com:4000` (passkey `rp.id` requires that host) and set placement to `middle`.

Confirm with a screenshot each:

- [ ] Agent fills the width and height; no banking column
- [ ] Config strip renders directly above the agent panel
- [ ] Filmstrip shows every step, horizontally scrollable
- [ ] Clicking a step raises the sheet with full `TraceStepCard` detail
- [ ] Each of the seven tabs renders its panel in the sheet
- [ ] `Live/Classic`, zoom, `Clear`, `Legend` all behave
- [ ] Skip link reaches `main-dashboard-content`
- [ ] `/monitoring/token-chain` still renders the **vertical** rail, unchanged
- [ ] Flag OFF → classic dashboard renders exactly as before

- [ ] **Step 4:** Turn the flag back off unless shipping with the new skin on.

---

## Known blocker for demo content (not for this layout work)

As of 2026-08-08, **no agent tool call succeeds in the running stack**:

| Vertical | Result | runId |
|---|---|---|
| banking | `Insufficient scope for tool 'get_my_accounts'` | `22458dcf-382c-478d-84a8-d0fd77e0e232` |
| banking | `Insufficient scope for tool 'get_my_transactions'` | `3800bdaf-bc6b-4287-a47c-a711702aa0a7` |
| sports | `Insufficient scope for tool 'get_my_accounts'` | `2d24193b-26f9-4a0d-abc2-28abea2beada` |
| insurance | `Insufficient scope for tool 'get_my_accounts'` | `703828c1-2a9d-4e48-81e1-6418ffc6d42c` |
| retail | `delegate_to_specialist` → `gateway_policy_denied` | `4753ed2a-0437-4af6-9f01-39c36af224b8` |

In every banking case the chain is green through `gw-introspection: valid` and `gw-authorize: permit`, then the MCP hop refuses: the delegated token carries `gateway:mcp:invoke` (authority to reach the gateway's MCP endpoint) but not the banking read scope the tool needs.

Separately, the agent **refuses transfers outright** — "I'm sorry, but I can't help with that", `toolsCalled: []`, across three phrasings.

Neither blocks this layout work: the filmstrip renders whatever the store holds, and a denied chain is a legitimate thing to display. They do block capturing a fully successful chain for demo screenshots.
