# Handoff — 2026-09-26 session: A2A-under-PF routing fix, stack redeploy, academy menu check

> Written for the next agent/session. Check your work against this file; if you
> find something here that is wrong or stale, fix it in place and note it.

---

## 1. Context

Same-day environment (other sessions were active on this repo):

- **PR #328** (`3209d18db`) — A2A hardening: SOT in vault, env-layer provider
  guard, vault dir-bind, and the new
  `demo_api_ui/tests/e2e/a2a-failure-modes.real.spec.js` (FM1/FM2/FM3).
- **`25482c322`** — UC40 local-demo pin: `OAUTH_PROVIDER: pingfederate` forced
  in `docker-compose.yml` `environment:` (overrides env_file).
- **PR #332 / #333** (`1773d75ff`, `b1dafb5ec`) — Command Dock UX + provider
  intent lock (`.demo-provider-intent.json`, pre-commit guard on
  `OAUTH_PROVIDER` edits). **The intent file says `provider: pingone`** with
  reason "A2A requires PingOne-minted act claims".
- The PingFederate local profile (`~/pingfederate-profile`) was **rebuilt on
  2026-09-26 from the `ai-demo-pingfederate-out-classic` volume**. It contains
  only 7 OAuth clients:
  `ai-demo-pf-id-jag, ai-demo-pf-standard-agent-exchanger, ai-demo-spiffe-te,
  ai-demo-pf-standard-actor, ai-demo-pf-admin, ai-demo-pf-user,
  ai-demo-pf-standard-mcp-exchanger`.
  **The 2026-09-22 A2A runtime config is NOT in it** (no
  `a2a-intermediate-*` SP connections, no 11 specialist PF clients, no ATM
  mappings).

## 2. What was done this session

### 2.1 Stack redeployed locally (DONE)
- `./run-docker.sh` clean rebuild after container-name conflicts; all core
  services healthy (UI :4000 → 200, BFF :3001, PF :9031 up).

### 2.2 A2A failure-mode spec run live (2 of 3 GREEN)
`cd demo_api_ui && CI=true PLAYWRIGHT_SKIP_WEBSERVER=1 npx playwright test
tests/e2e/a2a-failure-modes.real.spec.js --config=playwright.real.config.js`

- **FM1 (out-of-allowlist refusal)** ✅ passed
- **FM2 (act-less bearer refused)** ✅ passed
- **FM3 (happy path)** ❌ — root-caused in stages:
  1. Agent1 actor CC mint used the **PingOne UUID client** (`0b412e8b…`)
     against the **PF token endpoint** → `invalid_client`, and repeated
     failures **locked PingOne/PF clients out** ("Client temporarily locked").
  2. After fixing (1): Exchange #1 used the same UUID as **exchanger** →
     same `invalid_client`.
  3. After fixing (2): PF itself rejects —
     `'https://a2a-intermediate-passenger.ping.demo' is not a recognized
     Resource AS audience for id-jag token exchange` — the **PF profile is
     missing the 2026-09-22 A2A SP connections/specialist clients**. This is
     operator-side PF config, not fixable in BFF code.

### 2.3 BFF fix authored + PR open (IN PROGRESS)
- **PR #334** — `fix/a2a-pf-mode-actor-routing` (worktree
  `.claude/worktrees/a2a-pf-routing`, commit `ef3a0d288`):
  - `demo_api_server/services/a2aDelegationService.js`:
    - PF mode mints the agent1 actor via `PF_AI_AGENT_ACTOR_*`
      (ai-demo-pf-standard-actor) with runtime overrides on the SAME
      `oauthService.getAiAgentClientCredentialsToken()` method (DI preserved,
      PingOne path byte-identical).
    - PF mode runs Exchange #1 with `PF_STANDARD_AGENT_EXCHANGE_*`
      (ai-demo-pf-standard-agent-exchanger) via new
      `pfExchangeClientId/pfExchangeClientSecret` in `resolveA2aConfig`.
  - `demo_api_server/tests/a2aProviderSessionGuard.test.js`: PF-mode
    assertions (actor mint uses `pf-actor`, exchange uses
    `pf-agent-exchanger`).
- **Verified locally:** `CI=true npx jest tests/a2a --forceExit` →
  **293/293 green** in the worktree.
- **CI:** run `36275882363` was still `queued` when the session paused —
  **poll `gh pr checks 334` and merge when green**. Nothing merged yet.

### 2.4 /academy/identity double-menu (CLOSED — not reproducible)
- DOM probes: exactly one `header.topnav`; iframe topbar hidden via
  `data-embedded="true"` + `?embedded=1`.
- Live screenshot at `local.ping-devops.com:4000/academy/identity` shows a
  single dark top nav + left sidebar. No double menu at any width tried.

### 2.5 Lost-work incident from earlier today (context, resolved)
- An earlier session's uncommitted work was destroyed by `git reset --hard`;
  PR #328 (merged by another session) restored all of it. The stale worktree
  `e2e-a2a-fixes` and branch were deleted. Nothing outstanding.

## 3. What is next

1. **Merge PR #334** once CI is green (poll `gh pr checks 334`). Low risk:
   PingOne path untouched, DI preserved, 293 a2a tests green locally.
2. **FM3 cannot pass under the CURRENT PF profile** — to prove
   A2A-under-PF end-to-end, the operator must reproduce the 2026-09-22 PF
   runtime config in PF admin (see `REGRESSION_PLAN.md` §4 entry
   "UC2 delegation under PingFederate (PRs #148/#153/#157/#158)"):
   - 12 A2A SP connections (`a2a-intermediate-*` + A2A gateway) with TE
     processor policy (id-jag subject, access_token actor, nested-act
     expression `{"sub": actor.client_id, "act": subject.act}`)
   - 11 specialist Agent-2 PF clients with the BFF's own secrets
   - ATM `aud`/`sub` extended attributes; JWT processor allowed-audiences;
     `a2a_tenant_id` extended attribute on all SP connections.
   Alternatively run FM3 with provider=pingone (matches
   `.demo-provider-intent.json`).
3. **Compose pin vs intent file conflict** — `docker-compose.yml` still pins
   `OAUTH_PROVIDER: pingfederate` while the intent file says `pingone`. The
   #333 pre-commit guard allows unpinning as long as the same commit keeps the
   intent file consistent. Decide with the UC40 owner; don't silently flip.
4. **Client lockout residue** — repeated 401s today triggered "Client
   temporarily locked" on PingOne apps. If you hit sudden lockouts, wait ~10
   min or check which client is being minted with which secret before retrying.
5. **Regenerated step-verification ledgers** — this session ran the
   step-verification suites once (752/752 green, `step-verification:check`
   OK). If `git status` shows `checkedAt` churn in
   `demo_api_server/data/step-verification/`, it is runtime churn — do NOT
   commit it.

## 4. Key files

| File | Role |
|---|---|
| `demo_api_server/services/a2aDelegationService.js` | Exchange #1/#2 chain; this session's fix (PR #334) |
| `demo_api_server/services/pfStandardTokenExchangeService.js` | PF two-exchange config + `getActorToken` (reference) |
| `demo_api_server/services/oauthService.js` | `getAiAgentClientCredentialsToken(runtime)` — accepts `{clientId, clientSecret, authMethod, actorScope, tokenEndpoint}` overrides (line ~947) |
| `demo_api_ui/tests/e2e/a2a-failure-modes.real.spec.js` | FM1/FM2/FM3 live spec (from #328) |
| `docker-compose.yml` (~line 305) | UC40 `OAUTH_PROVIDER: pingfederate` pin |
| `.demo-provider-intent.json` | Provider intent SSOT (says pingone) |
| `scripts/pingfederate/README.md` | PF profile recovery path |
| `REGRESSION_PLAN.md` §4 (2026-09-22 entry) | Full list of PF A2A runtime config that must exist in PF admin |

## 5. Quick verify commands

```bash
# A2A unit suites (no stack needed)
cd demo_api_server && CI=true npx jest tests/a2a --forceExit

# Live failure-mode spec (stack up + E2E env)
cd demo_api_ui && CI=true PLAYWRIGHT_SKIP_WEBSERVER=1 \
  npx playwright test tests/e2e/a2a-failure-modes.real.spec.js \
  --config=playwright.real.config.js

# Provider intent / health gate
npm run demo:provider-verify
npm run demo:health-gate    # 34/35 with the PF pin; failing row = bff:oauth-provider

# Stack
./run-docker.sh status
```
