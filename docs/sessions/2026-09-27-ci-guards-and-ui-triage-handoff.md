# Handoff — 2026-09-27 session: CI guards landed, UI gate debt triaged & fixed

**Prepared for:** the next agent/session. Check your in-flight work against this
before assuming something is broken or unowned. This covers what the previous
handoffs left open, what was done, and what remains.

**Repo state at writing:** `main` @ `90579a2b7` (other sessions have landed
Privilege demo work on top of mine; no overlap). Working tree: only
step-verification ledger churn + session scratch — nothing of mine outstanding.

This is a point-in-time handoff. The later 2026-09-27 CI revival updates are
summarized in §9; use those notes for the current disposition of open items.

---

## 1. What was merged this session (my PRs)

| PR | Content | Why it matters |
|---|---|---|
| #341 | **ciba test fix** — stale `cibaSimulatedService` mock missing `isLocalSimulationEnabled` + 2 drifted assertions | Root-caused the 120-failure CI batch: `2ed20dd1b` (09-23) reworked `routes/ciba.js` but the test updates were orphaned on an unmerged side branch (`d68b29b08` line). 71/71 green. |
| #347 | **Two guards**: `main-red-alert` CI job + `scripts/check-mock-drift.js` | See §2. |
| #348 | a2aProtocolCards `diagnostic` assertion (stale vs #307) | The mock-drift gate's first live catch. 10/10. |
| #353 | **UI gate debt triage** — 4 real failures fixed (see §3). | Cleared the 4 of 6 full-vitest failures that were genuine main debt. |

Also merged (validated then merged in sequence): #331 (snapshot 155 pin), #337
(PF subset scopes), #334 (A2A PF actor routing + hygiene home-path fix), #325
(CI triggers + vitest heap).

## 2. The two guards — read before touching tests or CI

### 2.1 `main-red-alert` job (in ci.yml)
Runs only on push-to-main, `if: always()`. Aggregates all suite jobs into a
step-summary table and fails with `::error::main is RED` when any is not
success. **Why:** main sat 32-consecutive-runs red with 0 successes because
triggers were broken and nothing watched — the ciba debt accumulated invisibly
for days. If you see this job red, fix or revert before merging further; it is
not noise.

### 2.2 `scripts/check-mock-drift.js`
Static gate for the exact ciba failure shape: a `jest.mock('<module>', () => ({...}))`
object-literal factory missing an export the route/service actually calls
(TypeError inside the route under test, misread as a product bug).

- **Staged mode (default; wired into `hygiene:check` + own CI step):** flags
  only NEW drift — your commit touches the mocked module (or a file calling
  into it) while a test mocking it is not co-changed. Quiet on a clean tree.
- **`--full`:** advisory historical scan — ~2,588 known gaps exist (narrow
  mocks that never hit the missing export on the mocked path). Do NOT wire
  full mode as a gate; flagging those trains everyone to ignore the check.
- Self-tests: `node --test scripts/check-mock-drift.test.js` (3/3), including
  a ciba-shaped regression pin.

## 3. UI full-suite triage (the 6 failures from the 09-26 full run)

All root-caused; four were real debt from 09-25 commits that landed while
main's CI was dead — the exact blindness #347's alert now guards:

1. **emojiAllowlistAppWide** — `5d71bdde1` introduced 🔒 (U+1F512) in
   `SecuritySection.js` and the `buttonRouting.test.js` fixture; §0 allows
   🔐 (U+1F510) only. ArchitectureDiagram comment carried 🖥 ☁. **Fixed:** swapped
   to allowlisted glyphs (🔐 security/lock, 🔧 MCP tool marker), reworded comment.
   *Lesson: the emoji ratchet test reads §0 as SSOT — new UI emoji need the §0
   glyph, not a lookalike.*
2. **useAgentRun.settleReply** — `401850b3a` added failure-cause propagation:
   `completeTrace(false, flowTraceId, message)`; test expected 2 args.
   **Fixed:** expects `'boom'` third arg.
3. **signinAccentTokens** — `2fafb0f5b` A2A flow visualizers define CSS custom
   properties **inline from JSX** (`--lane`, `--actor-color`, `--group-color`);
   the undefined-var scan only read `.css` files. **Fixed:** scan extended to
   JSX inline `style={{ '--x': ... }}` definitions (`sourceFiles()` helper).
4. **TenantReadinessStrip + formatters** — pass in isolation AND in the group;
   fail only under full-suite cross-file pollution. Not product bugs. No change.

**Verified:** triage group 7 suites → 119/119 (3 skipped) together;
`npm run build` ✓; BFF: ciba 81/81, a2aProtocolCards 10/10, A2A 293/293.

## 4. Known-failure ledger (do NOT re-diagnose from scratch)

| Symptom | Cause | Status |
|---|---|---|
| `OAuthProviderToggle.idJagReset.test.jsx` red | Broken by #330/#332 dock work (09-26), pre-existing | **OPEN — needs its own fix** |
| Full vitest `--pool=forks.singleFork` shows "Found multiple elements" | DOM bleed between test files sharing one fork; test-isolation artifact, not product. Same family as the OOM #325 patched | **OPEN — test-infra debt**; a `setupFiles` between-test DOM cleanup would close it |
| Remote CI jobs stuck "queued" for hours, telemetry lags, ghost failure records with no failing step | Self-hosted runner churn + network throttling; runner logs show jobs executing and renewing leases while GitHub shows queued. Restart via `launchctl stop/start actions.runner.cmuir_pingcorp-AI-DEMO2.cmuir-dev-mac` helps when the Worker wedges on `spawnclient` | **Environment, not code.** Local verification is the source of truth. Playwright-mcp (1.64α) also fights the runner for the download cache |
| Playwright cache | Was 554M with an orphaned revision-1234 install; cleaned and reinstalled. NOTE: `chromium-1217` is a **symlink** to the real `chromium-1234` dir — deleting the 1234 dirs breaks 1.59.1's alias. Both launch-verified now (headless 151 + chrome channel 154) | Resolved |

## 5. Guardrails that exist now (do not undo)

- `.demo-provider-intent.json` + pre-commit block on `OAUTH_PROVIDER` edits
  (#333) — provider pin in compose/`.env` is **forbidden**; toggle +
  `restorePreRunProvider` own it (#336).
- Fresh-clone hygiene includes the mock-drift gate (#347).
- Pre-commit blocks source commits from the shared main checkout — commit from
  a worktree. (I hit this hook myself; it works.)
- `write-a2a-sot.js` REPO is `__dirname`-derived (#334) — don't reintroduce
  absolute home paths; `npm run hygiene:check` fails on them.

## 5b. ⚠️ Process slip to learn from (mine, disclosed)

While merging the UI triage, I committed from the **shared main checkout's
main branch** (shell cwd confusion between repo root and worktree) and pushed
directly, bypassing the worktree protocol. Damage assessed: the commit contained
exactly the 5 intended files and was merged via PR #353, so no clobber occurred
— but this is the failure mode the worktree protocol exists to prevent. The
hook only guards `git commit`; direct `git push` of an already-made commit
slips past it. **When working here: verify `git branch --show-current` before
every commit AND push.**

## 6. Remaining work at handoff time (ordered; see §9 for later status)

1. **`OAuthProviderToggle.idJagReset.test.jsx`** — fix the known failure
   (dock work broke it 09-26; likely a selector/mock update).
2. **Remote CI drain** — the run for 2734d1280+ was still pending at session
   end (runner renewing leases; see §4 row 3). When it completes, the
   `main-red-alert` job gives the first trustworthy green/red on main. If it
   stays wedged >2h, restart the runner service (command in §4).
3. **DOM-pollution cleanup** — add between-test DOM cleanup to
   `src/setupTests.js` so full runs stop showing phantom "multiple elements"
   failures; then the `singleFork`-only OOM workaround can be revisited.
4. **UC40 PF exchange chain** — `UnresolvableKeyException` in PF's
   `aiDemoPfAccessSubjectProcessor` (JWKS self-fetch inside the container).
   See `UC40-PF-IDJAG-SESSION-HANDOFF.md` §4 — still the active blocker for
   the full UC40 live run. (Another session's docs commit on 09-27 claims it
   resolved — verify by running the chain, not by the doc.)
5. **Provider state** — `.demo-provider-intent.json` says `pingone`; verify
   live LMDB agrees before the next banking/A2A demo:
   `npm run demo:provider-verify`.

## 7. Commands that worked this session

```bash
# Mock-drift gate (staged + advisory full)
node scripts/check-mock-drift.js
node scripts/check-mock-drift.js --full

# Focused UI triage group (all green together now)
cd demo_api_ui && CI=true ./node_modules/.bin/vitest run \
  src/__tests__/emojiAllowlistAppWide.test.js \
  src/__tests__/signinAccentTokens.test.js \
  src/components/__tests__/buttonRouting.test.js \
  src/components/__tests__/ArchitectureDiagram.completeness.test.js \
  src/hooks/__tests__/useAgentRun.settleReply.test.js \
  src/utils/__tests__/formatters.test.js \
  src/__tests__/TenantReadinessStrip.test.jsx

# Full UI suite (needs big heap; singleFork shows pollution artifacts —
# prefer threads pool for signal):
NODE_OPTIONS='--max-old-space-size=16384' CI=true ./node_modules/.bin/vitest run \
  --pool=threads --poolOptions.threads.maxThreads=4 --reporter=dot
# → 679 files: 672 pass, 6 fail (5 fixed via #353; OAuthProviderToggle known)

# BFF focused
cd demo_api_server && CI=true ./node_modules/.bin/jest a2aProtocolCards ciba.test.js ciba.managerApproval --forceExit -w 2
cd demo_api_server && CI=true ./node_modules/.bin/jest tests/a2a --forceExit -w 2   # 293/293

# Playwright browser check (1.59.1; 1217 symlinks to 1234)
cd demo_api_ui && node -e "(async()=>{const {chromium}=require('@playwright/test');const b=await chromium.launch();console.log('OK',b.version());await b.close();})()"

# Runner restart when wedged
launchctl stop actions.runner.cmuir_pingcorp-AI-DEMO2.cmuir-dev-mac
launchctl start actions.runner.cmuir_pingcorp-AI-DEMO2.cmuir-dev-mac
```

## 8. Cross-session hazards observed today (shared machine)

- Multiple sessions push to main concurrently; my push accidentally carried
  another session's pending docs commit (docs-only, harmless — but it rode
  along because the shared checkout's branch state was mid-flight). Branch-
  check before push.
- `node_modules/.bin` in `demo_api_server` was wiped mid-session by another
  process's npm activity — if jest/jest-cli "disappears", re-run
  `npm install` in the service before assuming a toolchain problem.
- `npm run build` must be run from `demo_api_ui/`, not repo root (root has no
  build script; a bare `npm run build` error at root is cwd, not breakage).

## 9. Follow-up from later 2026-09-27 sessions

This section updates the operational status in §6 and the full-suite snapshot
in §7. See [CI Revival — Final Status](2026-09-27-ci-revival-final-status.md)
and [CI Revival — Status Handoff](2026-09-27-ci-green-status.md) for the run
IDs, timestamps, and supporting detail.

- **Main CI completion remains unverified.** The later status notes record no
  completed, uncancelled main run. Cancelled or checkout-failed jobs did not
  reach test steps, so they prove neither a test failure nor a pass. Let queued
  PR runs drain, then watch one main run through completion and record its
  required-check results. Keep image-build and scheduled live-canary outcomes
  separate from the CI test workflow.
- **The UI failure count in §7 is historical.** PR #353 fixed four real
  failures from that run. Later notes still report an intermittent
  `createCitationResolver` timeout and a full-suite hang from stray Vitest
  workers. They do not record a resolution for
  `OAuthProviderToggle.idJagReset.test.jsx`; the single-fork DOM bleed also
  remains test-infrastructure debt. Rerun these surfaces before treating the
  older failure list as current.
- **The UC40 key-resolution blocker is resolved in the later handoff.**
  [UC40-PF-IDJAG-SESSION-HANDOFF.md](../../UC40-PF-IDJAG-SESSION-HANDOFF.md)
  records a live two-exchange/API run with 13 token-chain events and explains
  that the `UnresolvableKeyException` came from using an ID token in test data.
  A browser-level UC40 run remains unverified; the downstream
  `gw-backend-exchange: deny` hop is listed there as non-blocking.
- **Provider state still needs a live check.** The later UC40 handoff reports
  local PingFederate config while `.demo-provider-intent.json` specifies
  `pingone`. Run `npm run demo:provider-verify` before relying on the active
  provider value.
