# DaVinci Orchestration Showcase — Status

Branch: `worktree-agent-framework-orchestrator` · PR: [#1924](https://github.com/curtismu7/AI-DEMO2/pull/1924)
Spec: `docs/superpowers/specs/2026-08-17-davinci-orchestration-showcase-design.md`
Plan: `docs/superpowers/plans/2026-08-17-davinci-orchestration-showcase.md`

## Why this exists

The original ask was "highlight how DaVinci can do orchestration." A first pass wired DaVinci as a single-connector pass-through to PingOne Authorize — which doesn't actually demonstrate anything a direct API call couldn't do. Research into Okta Workflows / Auth0 Actions / Microsoft Entra ID Governance showed DaVinci's real differentiator is vendor-agnostic multi-system orchestration (350+ connectors spanning identity **and** business/IT systems), visual branching, and flow versioning — none of which shows up in a one-connector flow. This build was redirected to actually chain multiple connector types together, and to make "does this demo need DaVinci to run" an explicit, honest answer: **no**.

## What's built (all code-complete, tested, merged into this branch)

### 1. Transaction step-up — multi-connector DaVinci orchestration
- `demo_api_server/config/davinci.js` — env config (client ID/secret, transaction/login flow IDs, webhook URL)
- `demo_api_server/services/davinciFlowClient.js` — invokes the DaVinci orchestrate API
- `demo_api_server/services/lmdb/davinciEventStore.lmdb.js` + `routes/webhookDavinci.js` (`POST /webhook/davinci`) — receives DaVinci's mid-flow (fraud-alert) and terminal (transaction-decision) callbacks
- `ff_davinci_orchestration` flag (admin panel, default **OFF**) + `confirmChallengeViaDaVinci()` in `transactionConsentChallenge.js` — when ON, a transaction step-up is decided by the DaVinci flow (chains PingOne SSO → Protect risk score → branch → MFA + a Generic HTTP connector alerting a fraud queue → Authorize → HTTP callback to the demo's own audit trail) instead of the hand-coded OTP/MFA state machine
- **Fails closed**: any DaVinci API error, or a non-`PERMIT` decision (including malformed/ambiguous responses), falls back to the existing hand-coded consent flow — a transaction is never blocked or bypassed by a DaVinci outage
- **Off by default**: with the flag off, `routes/transactions.js` calls the original `confirmChallenge()` with byte-for-byte unchanged behavior

### 2. Login — risk-adaptive DaVinci Widget flow
- `demo_api_ui/src/lib/davinciWidgetClient.js` — `@forgerock/davinci-client` SDK wrapper (mirrors the existing `oidcSdkClient.js` pattern)
- `demo_api_ui/src/pages/DavinciLoginPage.jsx` at **`/davinci-login`** — renders the DaVinci flow's collectors live, guards every SDK call with `isSdkError()`
- `demo_api_server/routes/davinciLogin.js` (`GET /api/davinci-demo/config`, `POST /api/davinci-login/callback`) — exchanges the widget's OIDC code for tokens and establishes a real session (mirrors `routes/oauthUser.js`'s customer-login pattern: `exchangeCodeForToken` → `getUserInfo` → existing-user lookup → `session.regenerate()` → session write)
- This is a **new parallel route** — does not touch the protected `routes/oauth.js`/`routes/oauthUser.js`

### 3. Presenter controls — the "run without DaVinci" story
- **"DaVinci Mode" toggle** — agent header → More menu (client-side only, no admin rights needed, mirrors the existing "Movie reel" toggle). Off by default.
- When DaVinci Mode is on, a **"DaVinci Orchestration"** button appears in the same menu → **`/davinci-orchestration`**, a static explainer page (comparison table vs. Okta/Auth0/Entra, the 7-step connector chain, light/dark toggle) that makes **zero live API calls** — safe to show in any demo regardless of whether the DaVinci console setup below has been done.

### 4. Bonus workstream landed on the same branch
`services/agentFrameworkOrchestrator.js` unlocks `llm_framework=auto` — an LLM-backed picker (round-robin fallback) across the demo's 4 interchangeable agent frameworks (langchain/openai_agents/mastra/pydantic_ai), previously hardcoded to langchain-only.

## Verification done

- `demo_api_server`: full suite green (`CI=true npm test -- --forceExit --maxWorkers=4`) — 786/788 suites, 9671/9793 tests, 0 real failures (122 skipped are pre-existing live/integration specs; occasional parallel-load flakes confirmed clean in isolation each time)
- `demo_api_ui`: `npm run build` and `npm run test:unit` both green (363/363 test files)
- Every task went through an independent code review (spec compliance + quality), with fix rounds where real issues were found — see the SDD ledger at `.superpowers/sdd/2026-08-17-davinci-orchestration-showcase/progress.md` for the full trail
- A final whole-branch review caught and fixed 2 Critical + 1 Important cross-cutting issues that no single task's narrow review could see (see "What the final review caught" below)

## What still needs to be done

### 1. DaVinci console setup — manual, not yet done
Nothing in the code above can run against a **live** PingOne environment until someone with DaVinci Studio access:
- Imports/extends `docs/Super_Banking_Transaction_Authorization_DaVinci.json` with the Protect/MFA/HTTP-connector nodes the multi-connector design needs
- Authors the new risk-adaptive login flow (two versions, for the plan's A/B-testing story)
- Generates API credentials and fills in the real values for `PINGONE_DAVINCI_*` / `DAVINCI_WEBHOOK_URL` in `.env`

Full checklist: Task 1 in `docs/superpowers/plans/2026-08-17-davinci-orchestration-showcase.md`. Until this is done, `ff_davinci_orchestration=true` and `/davinci-login` will fail closed / show a "not configured" state — by design, not a bug.

### 2. Known gaps (tracked in `TECH_DEBT.md`, intentionally deferred)
- **`davinciFlowClient.js`'s API token is a placeholder** — sends `client_id:client_secret` as a raw bearer token, which will 401 against a real PingOne environment. Needs a real client_credentials grant (mirror `mfaService.js`'s `_getWorkerToken()` pattern) before pointing at live DaVinci.
- **`davinciLogin.js`'s callback has no ID-token nonce replay verification.** `routes/oauth.js`/`routes/oauthUser.js` both generate a nonce and pass it into their own server-initiated redirect; this route's flow is entirely client-driven by the `@forgerock/davinci-client` SDK, which currently exposes no hook to thread a nonce through. Needs either an SDK update or a documented workaround before this path is considered as hardened as the existing login flows.

### 3. Not requested, not built
- No changes to the MCP tool-authorization DaVinci flow (`docs/Super_Banking_MCP_Tool_Authorization_DaVinci.json`) — explicitly out of scope for this pass.
- The login flow's two DaVinci-side versions (for A/B testing) exist only as a plan item — actually authoring version 2 is part of the manual console setup in item 1 above.

## How to try it once console setup is done

1. Sign in, open the agent dashboard, click **More → DaVinci Mode** to turn it on.
2. Click **More → DaVinci Orchestration** to see the value-prop page (works right now, no setup needed).
3. As an admin, flip `ff_davinci_orchestration` on in the feature-flags panel.
4. Trigger a transfer above the step-up threshold — it now routes through the DaVinci flow instead of the hand-coded OTP screen.
5. Visit `/davinci-login` directly to try the widget-driven login.
