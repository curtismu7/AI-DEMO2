# AI-DEMO2 Session Report — 2026-09-26 (A2A hardening + provider-flip war)

**Prepared for:** cross-agent review. Check your in-flight work against this before assuming something is broken or unowned.

**Repo state at writing:** `main` @ `f720806cc` (#336). Working tree has ONE uncommitted change (see §6 — not mine, review it).

---

## 1. What was broken (the incident chain)

### The headline failure
`show my sensitive passenger record` (UC2 A2A delegation) failed with a generic
`a2a_unauthorized` for ~40+ minutes, repeatedly, all day.

**Root causes, in the order they were found:**

| # | Root cause | Symptom |
|---|-----------|---------|
| 1 | PingOne resource "Super Banking A2A MCP Gateway" audience attribute had drifted to its display NAME (`Super Banking A2A MCP Gateway`) instead of the URI `mcpgateway-a2a.ping.demo` | Every Exchange #2 token minted with the NAME-form aud; gateways rejected it (wrong-aud) |
| 2 | **OAuth provider flip-flop war.** `oauth_provider` was flipped to `pingfederate` by: (a) `OAUTH_PROVIDER=pingfederate` inside `demo_api_server/.env` (env **outranks** LMDB in `getEffective()` — this silently undid every `setRaw` repair on every restart), (b) `docker-compose.yml` `environment:` pin, (c) the admin toggle (legit runtime flips from a concurrent UC40 session). PingFederate tokens carry **no `act` claim** → the A2A bearer gate rejected every hop with `act chain depth 0, expected exactly 1` → `a2a_unauthorized` | Every banking/A2A login demo broke after each flip; repairs looked like they worked, then "came back" |
| 3 | **Vault file-bind breakage.** The compose mount `./secrets.vault:/secrets.vault:ro` went permanently stale (ENOENT) the first time the vault was saved — vault saves use tmp+rename, replacing the inode the file bind pointed at | "SOT is failing"; vault unreadable from the container until recreate |
| 4 | **PingOne repair script used PATCH** — `PATCH /resources/{id}` returns a *misleading 403* on this entity even for a principal that CAN write it | Hours lost believing the worker principal lacked RBAC; the fix was PUT-with-full-object |
| 5 | **Demo-steps drawer scrim ate all clicks** in `chain-hops-visible` e2e — the drawer DEFAULTS OPEN when its localStorage key is null (`readStoredDemoStepsOpen` returns true for null) | Flaky test, looked like a chain failure |
| 6 | **PF demo-step specs stale** — `pf-idjag-run-mode` expected the provider toggle to navigate to `/logout`; the component's actual contract is clear-session + `window.location.reload()` | 1 red test that was a spec bug, not a product bug |
| 7 | **Cryptic failure surfaces** — every failure mode above surfaced as the same generic `a2a_unauthorized` | 40 minutes to diagnose each recurrence |

## 2. What was fixed (PRs, all merged to `main`)

### A2A chain itself
- **#295** — node-gateway pin for A2A tokens (route by token aud, not code path)
- **#296** — end-to-end aud-drift tolerance; UC2 smoke spec; gate rows; deploy verify
- **#300** — gate `bff:code-drift` uses mtime staleness (bind-mounted `/app` makes md5 useless)
- **#301** — aud re-split must not shatter a multi-word drift NAME
- **#307** — wire-refusal `diagnostic` field (specialist refusals carry a "Why:"); live aud-form gate row; Brave key single-sourced
- **#309** — `scripts/pingone/fix-a2a-resource-audience.js` operator repair script
- **#316** — repair script corrected: **PUT with the full object**, not PATCH (PATCH 403 is a lie on this entity). Verified live: audience now `mcpgateway-a2a.ping.demo`
- **#317** — NAME-form aud tolerance REMOVED everywhere (3 compose services, `mcpGatewayClient.js` pin, `mcpToolPipeline.js` detection) — source is fixed, tolerance no longer needed

### Provider flip-flop hardening
- **#328** — `bff:oauth-provider` gate row reads the **container env layer** and names `.env` as the cause when env is the culprit; vault **directory bind** (`/:/repo` + `VAULT_PATH=/repo/secrets.vault`) replaces the file bind; `demo_api_server/.env` reset to `OAUTH_PROVIDER=pingone`
- **#333** — `.demo-provider-intent.json` (committed SSOT for the intended provider, currently `pingone` per Option A) + `scripts/pingone/demo-provider-lock.js` (show/set/verify) + **pre-commit hook that BLOCKS any OAUTH_PROVIDER edit in `.env`/`docker-compose.yml` unless the same commit updates the intent file** + `provider-lock` health-gate row + `npm run demo:provider-lock` / `demo:provider-verify`
- **#335** — `run-docker.sh provider_lock_preflight`: every BFF-inclusive start names intent/.env/compose drift loudly (soft warn — runtime admin flips stay legitimate)

### SOT (single source of truth) in the vault
- **#328** — `A2A_AUTHORIZE_SOT` entry in `secrets.vault` (v1): all audiences (a2aGateway `mcpgateway-a2a.ping.demo`, agentGateway `agentgateway.ping.demo`, mcpGateway, mcpServer, 11 specialist intermediates), act-chain contract (hop bearer = depth 1, gateway bearer = depth 2, actor must be the generalist `0b412e8b…`, tenant claim `a2aTenantId`), exchanger client IDs + auth methods (POST, not Basic — Basic gets `invalid_client`), the 5-check bearer-gate order, and repair notes (PUT-not-PATCH; provider-flip failure mode)
- Regenerate: `node scripts/pingone/write-a2a-sot.js` (host-side — the container CANNOT save the vault, `/` is not writable by appuser)
- Gate row `a2a:sot` verifies it every run

### Failure-mode + demo-step test coverage
- **#328** — `demo_api_ui/tests/e2e/a2a-failure-modes.real.spec.js`: FM1 out-of-allowlist tool refused WITH the allowlist named (never cryptic), FM2 act-less bearer refused by the wire gate (never leaks data), FM3 happy path stays green after probes
- **#328** — `chain-hops-visible.real.spec.js`: closes the default-open demo-steps drawer before input clicks
- **#328** — `pf-idjag-run-mode.spec.js`: matches the toggle's reload contract (8/8 pass)
- **#329 (other agent)** — OIDC-only scopes for PF login (user + admin) + scope guard test
- **#330** — Command Dock dashboard mode + draggable Demo Controls pill (other agent); `Mission Control UC40` spec updated for the dock pill
- Auto-repair: gate row `a2a:resource-audience` now **auto-attempts the one-PUT repair** when drift reappears and re-probes (`DEMO_HEALTH_GATE_NO_AUTOREPAIR=1` to opt out) — #335
- `run-docker.sh provider_lock_preflight` — every BFF-inclusive start names provider drift with the exact remediation command — #335

### Test evidence (measured, not assumed)
- A2A unit suites: **112/112** (10 suites) then 66/66 re-run post-merge
- Step verification: **752/752** across 18 suites (646 fixtures, 11 verticals, 30+ UCs per banking vertical)
- UC2 A2A e2e (real browser login, full chain): **passing** — user-token → agent1-actor → exchange1 → wire → exchange2 (URI-form aud) → tool-dispatched
- Failure-mode e2es: **3/3**
- PF login specs: 3/3 real + 8/8 mock
- Health gate: **36 checks** — 35/36 or 36/36 depending on the other session's UC40 window state (see §5)

## 3. Safeguard matrix (why each failure class can't happen silently again)

| Threat | Control | Where |
|---|---|---|
| Provider flip via `.env`/compose | pre-commit BLOCKS OAUTH_PROVIDER edits unless intent file updated same commit | #333 |
| Provider drift at stack start | `provider_lock_preflight` in run-docker.sh names the layer + fix | #335 |
| Provider drift at runtime | `bff:oauth-provider` + `provider-lock` gate rows name the exact layer | #328/#333 |
| PingOne audience drifts again | gate AUTO-REPAIRS via PUT and re-probes | #335 |
| Vault save breaks mount | directory bind; SOT row verifies vault readability | #328 |
| Cryptic A2A errors | failure-mode e2es + wire-refusal diagnostics | #328/#307 |
| SOT loss/corruption | vault-backed, regenerable, gate-verified | #328 |
| Silent test staleness | gate rows assert CONTRACTS (drawer-open default, toggle reload) not just HTTP 200s | #328 |

## 4. Current live state (at time of writing)

- Stack: 26 containers up, UI 200 on `https://local.ping-devops.com:4000`
- `main` @ `f720806cc` — all of the above merged
- Live provider: **pingfederate** (the other session's UC40 window; compose pin was REMOVED in #336 — "restore pre-run login provider after UC40")
- Gate: 3 expected failures while PF is live (`bff:oauth-provider`, `provider-lock`, `a2a:deep-probe`) — each row names the exact layer and fix. Under pingone: **36/36**

## 5. ⚠️ OPEN ITEMS — check these against your work

1. **UNCOMMITTED, UNOWNED (in the shared main checkout):**
   `demo_api_server/services/pfStandardTokenExchangeService.js` — a `sameScopes()` change from exact-equality to SUBSET semantics (PF policy issues a superset of requested scopes; exact equality failed every PF exchange with "intermediate scope mismatch"). The comment is dated 2026-09-26 and looks deliberate. **Decide: commit it (with a test) or discard it.** Do not leave it dangling — it will silently ride into someone else's commit.

2. **`.demo-provider-intent.json` says `pingone`; the live stack runs `pingfederate`** (UC40 window, compose pin removed in #336 but LMDB still carries PF). The `provider-lock` gate row will keep flagging this until either the LMDB value is flipped back to pingone (admin toggle or `setRaw`) or the intent file is updated to pingfederate with a reason. Per Option A agreed today: **pingone is the default** — flip back before the next banking/A2A demo.

3. **`pf-idjag-run-mode` spec: 7/8** — `Mission Control UC40` fails intermittently on `demo-steps-trigger` visibility after #330's Demo Controls pill rework. The trigger now lives inside the floating dock; the spec clicks the pill first, but visibility is flaky. Worth a look if you touch that surface.

4. **`bff:code-drift` gate row** will flag any BFF source edit that lands after the container started — recreate `demo-api-server` after pulling. That row being red means "running node ≠ disk", not "code wrong".

5. **OrbStack instability** — the daemon stalled/dropped sockets ~4× today (symptom: `docker ps` hangs, e2e webServer timeouts, `net::ERR_CONNECTION_REFUSED` on a healthy-looking stack). Recovery that worked every time: `orb shutdown` → `orb start` → wait for the socket → `docker compose up -d`. If e2e runs die with EMPTY_RESPONSE/timeouts, suspect OrbStack first, not the code.

## 6. Housekeeping notes for whoever touches the tree next

- The shared main checkout gets **switched to other branches by concurrent sessions** — always `git branch --show-current` before assuming you're on `main`, and never `git checkout -- .` / `reset --hard` without checking whose work is in flight (destroyed at least one in-flight change today by doing this).
- `.claude/tmp/`, `gate*.log`, `deploy.log` at repo root are session scratch — safe to delete.
- Worktrees under `.claude/worktrees/` were all cleaned up (only other-session ones remain).
- The 632 modified `step-verification`/`token-chains` ledger files seen earlier were **test-run artifacts**, not source changes — do not bulk-commit them.

## 7. Commands you'll want

```bash
# Provider state + drift
node scripts/pingone/demo-provider-lock.js show
npm run demo:provider-verify

# Full gate (36 checks)
DEMO_HEALTH_GATE_FULL=1 node scripts/check-demo-health-gate.js

# A2A repair (idempotent; PUT not PATCH)
node scripts/pingone/fix-a2a-resource-audience.js
node scripts/pingone/write-a2a-sot.js

# Regenerate SOT after contract changes
node scripts/pingone/write-a2a-sot.js

# Focused A2A tests
cd demo_api_server && CI=true npx jest tests/a2a* --forceExit
cd demo_api_ui && CI=true PLAYWRIGHT_SKIP_WEBSERVER=1 PLAYWRIGHT_BASE_URL=https://local.ping-devops.com:4000 \
  npx playwright test --config=playwright.real.config.js tests/e2e/a2a-failure-modes.real.spec.js

# PF login steps (mock)
CI=true PLAYWRIGHT_SKIP_WEBSERVER=1 PLAYWRIGHT_BASE_URL=https://local.ping-devops.com:4000 \
  npx playwright test --config=playwright.config.js tests/e2e/pf-idjag-run-mode.spec.js
```

## 8. Suggested next steps (not started)

1. Resolve §5.1 (the uncommitted `sameScopes` subset change — commit with a test or discard).
2. Flip the live provider back to pingone per Option A and confirm 36/36.
3. Stabilize the `Mission Control UC40` spec against the dock pill.
4. Consider a `run-docker.sh` post-start hook that auto-runs the health gate so "clear to demo" is the default, not a manual step.
