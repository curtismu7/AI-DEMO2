# HANDOFF — Agent hidden under the clinical-split dashboard (2026-07-05)

Status snapshot so the next agent can pick this up without clobbering other
sessions. Written by the token-chain session (branch
`worktree-fix-token-chain-trace-details`, worktree at
`.claude/worktrees/fix-token-chain-trace-details`).

## DONE — merged to origin/main (merge commit `1aaf509df`), do not redo

- **Token Chain trace rail** (embedded + floating, `TokenChainTraceRail`):
  every expanded step now shows live evidence. `buildTraceSteps` accepts BOTH
  token-event vocabularies (1-exchange `agent-actor-token`/`exchanged-token`
  AND 2-exchange `two-ex-*`); error paths feed `err.tokenEvents` into the
  chain (AIAgent catch); typed sends begin a trace (`handleNaturalLanguageInner`
  + `sendAsNlInner`); `beginTrace` preserves sign-in events; gateway denials
  render DENY. Tests: `demo_api_ui npx vitest run src/services/tokenChainTrace`
  (24), REGRESSION_PLAN §4 entry exists.
- **BFF**: PingGateway `X-Gw-Audit-Trail` now survives 401/error paths into
  tokenEvents (`mcpGatewayClient.js` 401 throw + `mcpToolPipeline.js` generic
  error branch; characterization test pins it, 51 pass).
- **P1AZ policy actor-id drift FIXED and imported**: all 7 client ids in the
  live policy's `HasValidActorChain` were retired-env ids. Snapshot
  `snapshots/AI_Demo_Transaction_Authorization_P1AZ.snapshot.json`
  corrected (Token Exchanger `f4dd707d`, AI Agent Actor `71e878ea`, 5
  specialists), user imported it — real P1AZ now PERMITs.
  `snapshots/The_AI-Demo_Transaction_Authorization_P1AZ.snapshot.json`
  (gitignored ad-hoc export in the MAIN checkout) still has stale ids; a
  corrected copy sits next to it as `...FIXED.snapshot.json` in this worktree.
- Verified end-to-end on the Node-gateway path (temporary compose overlay,
  since reverted): full chain green through step 10, accounts returned.

## KNOWN-BROKEN, out of scope here (owned elsewhere)

- **PingGateway Ex#3 onward exchange** fails `invalid_scope` after PERMIT —
  the planned `banking:*` scope-namespace work (docs/superpowers/plans/).
  `ff_mcp_gateway_pinggateway` stays ON (env-pinned in docker-compose.yml:78).
- **origin/main pre-commit gate**: `oauthUser.js authorize scopes ⊇ grant`
  guard fails on main itself (`code:search` granted in manifest by PR #175,
  /authorize request never updated on main — the fix appears to live on the
  unmerged `fix/architectural-improvements` branch).

## OPEN BUG — this is the work to finish

**Symptom:** on /dashboard with `ff_agent_clinical_split` on, the legacy UI
renders first, the clinical Talk/Inspect/Configure UI then covers it, and the
agent ends up invisible ("you see it then it gets hidden"). DOM evidence: the
single `<AIAgent>` renders UNPORTALED under `.App` (`banking-agent-float-root`)
at y≈1400 with viewport ≈1280 (below the fold); `.ac-chat-host` has 0 children.

**Root cause (instrumented, evidence-backed):** BOTH `UserDashboard.js` AND
`UserDashboardPing2026.js` mount on /dashboard during the same load, each
mounting `AgentClinicalHost`/`TalkPane` and dock/middle hosts. All of them call
`setSurfaceHostEl` / `setClinicalSplit` on the shared `AgentUiModeContext`, and
the losing instance's unmount cleanup wipes the winner's registration:
`TalkPane.jsx` cleanup does an UNGUARDED `setClinicalSplit(false)` (line ~35)
and the host-clear races. Console-instrumented setter timeline (2026-07-05)
showed interleaved registrations from UserDashboard.js:1109, TalkPane.jsx:27/33
(two instances), UserDashboardPing2026.js:1134, ending with host cleared and
the agent left with `surfaceHostEl=null`.

**Fix directions (pick after confirming):**
1. Find WHY both dashboard components mount (route wiring — which component
   renders which; likely a flag-async swap rendering legacy first, then
   clinical). Eliminating the double mount fixes the visible old→new flash too.
2. Make registrations ownership-safe: guard `setClinicalSplit(false)` the same
   way the host cleanup is guarded (only clear if this instance still owns it),
   e.g. keep a token/ref of the current owner in context.
3. Related small bug seen while debugging: `ConversationSummaryPanel` spams
   `GET /api/conversations/me/banking/summaries` → 401 ~10x in seconds when the
   session is stale (retry loop; it's supposed to be silent-once).

**Protected area:** REGRESSION_PLAN §1 row "Clinical split dashboard
(ff_agent_clinical_split)" — TalkPane hosts the inline agent, legacy dashboard
with flag OFF must stay unchanged. Run the regression-guard skill; UI build
gate (`cd demo_api_ui && npm run build`) before done.

## Session-coordination notes (avoid clobbering)

- The MAIN checkout is on `fix/architectural-improvements` (another session's
  branch, dirty working tree incl. mcpGatewayClient.js, App.js, gateway route
  files). Do NOT edit/commit there; work in a fresh worktree from origin/main.
- This session's worktree (`.claude/worktrees/fix-token-chain-trace-details`)
  runs a Vite dev server on **https://api.ping.demo:4443** (worktree UI against
  the live BFF :3001) — the fastest way to reproduce/verify; see memory
  "Worktree UI Live Verify" for the .env/symlink recipe. Reproduce the bug
  there: sign in as demoUser, open /dashboard.
- Never bare `git stash` — shared stash stack across sessions (tag + apply by
  SHA + drop).
