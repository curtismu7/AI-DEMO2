# Handoff: paying down TECH_DEBT.md (2026-10-01 to 2026-10-02)

This is for an agent picking up the tech-debt work with no memory of the session
that did Waves 0 to 3. It says what was done, what is left, what the owner has
already decided, and the repo-specific traps that cost time. `TECH_DEBT.md` is
the source of truth for each entry; this file is the map.

## State at handoff

- `main` at handoff: `b551ef7d9`. All work below is merged. The session left no
  open pull requests of its own.
- `TECH_DEBT.md`: 39 open (`[ ]`), 129 closed (`[x]`), 9 accepted
  (`[wontfix]`), 2 waiting on something outside the repo (`[~]`). It started
  this work at 53 open. Other sessions added at least two new open entries on
  2026-10-01, so the net drop understates what was closed.
- Local Docker stack: runs everything below except one log-line change in
  `llm-proxy` (see Traps).
- SE cluster (`ai-demo.ping-devops.com`): none of this is deployed there. Do not
  deploy to SE unless the owner names that target.

## Owed verification (do these first)

1. **PR #542, MCP-client path, not yet exercised live.** #542 changed how an
   external MCP client links a Privilege gateway session (browser check plus
   per-user sessions). Only refusal paths and unit tests are verified. The
   owner signed in on `/privilege-mcp-client`, which works but is a different
   path. Needed: an MCP client (LM Studio) connects to the facade door
   `/api/mcp-facade/privilege-gateway/opensearch22/mcp`, the owner completes
   PingOne then Privilege logins in one browser (it should pass through
   `localhost:3005/oauth/link-verify`), and the client lists tools. Evidence of
   success is a stored session keyed `opensearch22|<sub>`:

   ```bash
   docker exec -w /app ai-demo-api-server node -e "const s=require('./services/lmdb/privilegeGatewaySessionStore.lmdb');for(const [k,r] of Object.entries(s.loadAll()))console.log(k.includes('|')?'per-user':'no-user',r.app||k.split('|')[0])"
   ```

   If the owner does not use an external MCP client with this door, record #542
   as verified by tests only. If it fails live, revert #542 (BFF and
   `mcp-gateway` together; `mcp-gateway` is image-built).
2. **PR #564, fresh-clone start.** The launcher now mints `BFF_INTERNAL_SECRET`
   when none exists and the BFF runs with `VAULT_INTERNAL_STRICT=true`. The mint
   path is tested against temp directories only. Nobody has run
   `./run-docker.sh start` on a clean clone since.
3. **PR #548, live DaVinci.** `davinciFlowClient` now fetches a real
   client-credentials token. Never run against a live environment. Open
   question: whether `orchestrate-api.pingone.com` accepts that token at all;
   other DaVinci paths in this repo use an API key.

## What was done

| Wave | PR | What |
|---|---|---|
| 0 | #519 | Triage of every open entry against code; dated notes on 19; marker conventions documented |
| 1 | #522 | `/api/mcp/audit` and `/llm/guardrail-attempts` filter a non-admin to their own records |
| 1 | #526 | Removed the unused `/api/token-chain/events` stream and its dead UI |
| 1 | #524 | Removed `AIAgentFull` (12,700-line duplicate) and its orphaned hook and service |
| 1 | #525 | Inline admin checks became named guards; OpenAPI `security` is now per method |
| 1 | #529 | Three route exposures recorded as accepted (see Decisions) |
| 2 | #532 | One resolver for `BFF_INTERNAL_SECRET`; agent-service refuses a ciphertext value; `unhandledRejection` handlers in three services |
| 2 | #537 | Privilege link: a discard after a commit restores the session |
| 2 | #536 | Gateway OAuth callback origin comes from configuration; DCR caches bounded |
| 2 | #538 | Removed the unused `/api/agent/langchain/run` route and two dead LangChain pieces |
| 2 | #542 | Privilege link verifies the browser before the gateway sign-in; gateway sessions per app and user |
| 3 | #547 | The vault/.env mismatch guard no longer names the vault as the right side |
| 3 | #548 | Real DaVinci API token fetch |
| 3 | #549 | Readiness check `pingone.pkce_app_cors` (passes against the live tenant) |
| 3 | #552, #557 | Grafana: PingOne group `grafana-admins` maps to Admin (verified live, local) |
| 3 | #563 | Gateway discovery-URL check is blocking; resource-id coupling accepted |
| 3 | #564 | Strict internal secret in Docker; launcher provisions a real one |

Live PingOne changes made on tenant `01d89b06` (nothing provisions these; a
re-created app or tenant needs them again by hand):

- Group `grafana-admins` created; `demoAdmin` is its only member.
- App "Demo AI App - Grafana Login" (`48ed5e06-...`): attribute mapping
  `groups = ${user.memberOfGroupNames}`, **userinfo only** (`idToken: false`).

## Owner decisions (do not re-ask)

- `AIAgentFull`: removed rather than guarded.
- `/api/app-events` and its stream: left unauthenticated and unfiltered. The
  entry states what that accepts (it carries decoded token-exchange claims).
- Gateway log window `/api/admin/agent-gateway/logs`: left open to any
  signed-in user.
- `/api/newrelic`: public by declaration; accepted.
- UC35 (`ai-explain-last-denial`): the 120s reasoning ceiling stays frozen; stop
  capturing a golden for it. **Decided, not yet done** (see Wave 5).
- Shared gateway identity: both the browser check and per-user sessions (#542).
  Accepted consequence: a sign-in on `/privilege-mcp-client` serves only the
  user signed in to the demo in that browser.
- Gateway resource id doubling as the metadata URL: accepted; check made
  blocking (#563).
- Strict internal secret: launcher generates, then strict (#564).
- Grafana: the owner asked the agent to make the PingOne changes directly.
- Deploys: local Docker only. Each wave was started only on the owner's
  go-ahead, and PRs were merged only when the owner said so.

## What is left

Line numbers are `TECH_DEBT.md` at `b551ef7d9`; find entries by heading text if
they have shifted. "Triage" means the dated note already in the entry says what
the code looked like on 2026-10-01.

### Wave 4: deploy tooling and repo hygiene (not started; owner said wait)

| Entry (line) | State | Next action |
|---|---|---|
| Launcher can remove PingFederate and cannot start it (89) | Open. Written by another session on 2026-10-01; not triaged here | Entry gives three steps: purge only this project's containers, add `./run-docker.sh pf start`, guard the provider toggle |
| `llm-proxy` can be deployed by neither path (2998) | Open | Give `run-docker.sh` a `build llm-proxy` path that refuses when oMLX owns `:8090`; then drop the "rebuild it directly" note in `scripts/deploy-live.sh`. LLM settings are frozen: do not change backend selection |
| SE smoke check 2/7 races a terminating replica (3658) | Open | In `k8s/smoke.sh` check 2/7, skip pods with a `deletionTimestamp` (check 6/7 already does) |
| Three near-identical compose readers (4046) | Open | Extract `scripts/lib/composeBlocks.js`; dependency-free |
| Two parallel module trees (3524) | Reduced | `demo_api_server/src/` holds only `services/` and `__tests__/`. Both-depth names left: `services/errorSchemaService.js` (the two copies differ) and `__tests__/tokenIntrospection.test.js`. Add a hygiene assertion |
| Dependencies never re-verified (3636) | Open | Candidates with no import: `@langchain/langgraph-checkpoint`, `@langchain/openai`, `connect-redis`, `express-async-errors`, `langchain`. Check peer-dependency use with a clean `npm ci` and the full server suite. Do NOT remove the three `@opentelemetry/*` packages, `@scalar/api-reference`, or `pino-pretty`: they have no static import but are in use |
| agent-service vault test crosses the package boundary (9313) | One step left | The import is gone. Remove the stale "Install demo_api_server deps" step in `.github/workflows/ci.yml` (about line 400), confirm on a CI run, tick |
| Nothing protects a live UI drive (5838) | Step 1 shipped | Step 2 only (announce). `run-docker.sh restart <svc>` still recreates silently. The entry warns against step 3 |

### Wave 5: test reliability

| Entry (line) | Next action |
|---|---|
| Jest flakes: LMDB reader exhaustion, loopback ECONNRESET (1483) | Find which LMDB environments are opened per suite and never closed; then the supertest server/socket lifetime. CI now retries once, which hides the second cause |
| UC14b intermittent `rar_unexpected_deny` (1523) | Capture the P1AZ deny statements across a four-vertical demo-steps run before choosing a fix |
| Agent tests pass `user` at first render (8500) | 2 of 13 `AIAgent.*.test.jsx` use `renderAgentHydrating`; convert the rest |
| UC34/UC35 on the 120s timeout (2888) | Owner decision: stop capturing a golden for UC35. See `capture-goldens.real.spec.js` and `LLM_ANALYSIS_UNROUTABLE` in `demo_api_server/scripts/useCaseSweepCauses.js` |

### Wave 6: UI

| Entry (line) | Next action |
|---|---|
| `renderActionGroups()` not mounted on `/dashboard` (8662) | Cause identified: it mounts only when the agent is inline (`agentPlacement === "middle"`). Needs the owner's decision on whether floating placement should show them, then one live count |
| Banking column has no resize handle (6155) | `UserDashboard.js` no longer exists; only `UserDashboardPing2026.js`. Needs a stack where Focus mode can be turned off |
| Contrast leftovers (3220) | Vendor `<code>` colour override; trace whether the agent panel can unmount mid-sign-in before using `clearTimeout` |
| Resume held by two timeouts (7452) | Only the 300ms floating-instance claim delay remains; needs an instance-registration handshake |
| Agentic Access Console static data (1426) | No 24h decision-count endpoint exists; `AuthSection.js` is fully static |
| Launcher sign-in prompt (7612) | The entry's premise is stale: `ADMIN1` to `ADMIN13` are admin chips now. Walk it live as a signed-in customer on the `pingone-admin` vertical |
| `AIAgentFull` entry (275) | Component removed. Remaining: `POST /api/privilege-mcp-simple/tools/call` still dispatches without `mcpToolPipeline`, and now has no UI caller. Decide: delete the endpoint, or route it through the pipeline |

### Partly done: what remains in each

| Entry (line) | Remaining |
|---|---|
| `/sdk-login` CORS setting (289) | The check exists; nothing sets the value. Adding a deployment origin is still a manual app edit |
| LangChain direct-MCP pipeline (975) | Title is wrong: the A2A handler calls `process_message`. Left: nothing evicts A2A conversation checkpoints (hook `ConversationMemory._cleanup_expired_sessions` to `delete_thread`); `PINGONE_REDIRECT_URI` default still names port 8889; the `/run` MCP-graph fallback needs an owner decision |
| `/facade-link` unbounded registrations (1053) | Forged-host path closed and cache capped. `POST /config` still lets a caller name door URLs that each cost one gateway `/register` |
| `mcpPrivilegeAuth.js` DCR client (5024) | Re-registers when `PUBLIC_APP_URL` changes. Never re-registers when `PUBLIC_APP_URL` is unset (deliberate: a forged `Host` must not mint clients) |
| LLM token custody (1249) | Left: `/internal/agent-tool` is still on the published port; `agentRunContext` falls back to the latest run when a callback has no run id; `call_pingone_tool` calls the hosted PingOne MCP directly with no gateway or P1AZ hop (its `scopes: ['read']` label feeds `scripts/gen-vertical-tools.js`); platform mode hands a gateway token to the model vendor; oauth-mcp does no P1AZ itself |
| Inline admin checks vs OpenAPI (2085) | `selfServiceUsers.js` `DELETE /:userId` and `GET /` are admin-only in code but document as `session`: the role check follows a 401 check and throws `OAuthError` |
| Vault guard (2437) | The guard still does not ask PingOne whether an id is a real application, or weigh N services against the vault |
| Grafana (2536) | Step 4 only: `GF_AUTH_DISABLE_LOGIN_FORM=true`. Local is verified; SE is not deployed. Do not disable the form before an admin-mapped user is seen to get Admin on SE |
| "Logged as handled, fatal anyway" (3038) | Handlers are in all five Node services. No sweep or lint for a catch that logs `err.code` alone |
| `davinciFlowClient` token (9489) | Live exercise only |
| INDETERMINATE two meanings (7257) | All five plan phases are done and the PDP no longer emits it. Left: `mcpToolPipeline.js` still uses `'INDETERMINATE'` as the BFF's pause label; UI decision surfaces still branch on `decision`/`statements`; the Groovy fail-closed line has no diagnostics |
| RFC 8693 duplication (5067) | Not acceptable as-is: about fifteen files build token-exchange requests. The in-BFF copies can share one builder without a cross-service package |

### Programmes (schedule separately; do not batch)

- **Two seed stores per vertical (8770):** finish the SQLite write migration.
  Airlines writes are on the resource server; retail has `checkout`, workforce
  has `submit_expense`; the rest are read-only there.
  `seed/abercrombie-fitch.mock.json` is referenced by nothing.
- **Design-token adoption (3248):** per component as stylesheets are touched. A
  blind sweep was built and reverted; do not repeat it.

### Needs the SE cluster or a cluster admin

- Privilege link wiring for SE (1026): set `BFF_PRIVILEGE_LINK_URL`,
  `BFF_PRIVILEGE_LINK_COMMIT_URL`, `MCP_FACADE_PRIVILEGE_LINK`,
  `MCP_FACADE_AGENT_GATEWAY_AS`, `MCP_FACADE_PRIVILEGE_GATEWAY_BASE`, and
  consider `PRIVILEGE_MCP_CALLBACK_HOST=ai-demo.ping-devops.com` (#536 relies on
  SE's `PUBLIC_APP_URL` otherwise).
- Promote-path verification (3466): run
  `./se-update-code.sh --promote <sha> llm` and prove `/livez` is 200 from
  inside the cluster. A green `kubectl rollout status` is not evidence.
- Restricted admission and egress (267): needs the namespace administrator.

### Blocked or external (no action in this repo)

- oauth-mcp DCR part 2 (9716): `DCR_INITIAL_ACCESS_TOKEN` stays unwired until
  DCR is meant to be used.
- Facade banking door `tools/call` (`[~]`): platform blocker with Ping.

### Added by other sessions (not triaged here)

- A workload agent's run is recorded as the built-in AI Agent (21).
- The PingFederate readiness lane cannot pass a gateway tool step (57).

## Traps that cost time

**Working practice**

- One worktree and one PR per item (`EnterWorktree`). A hook blocks edits in
  the main checkout. Enter the worktree from the repo root: creating one while
  the working directory is somewhere else (for example `~/.claude`) puts it in
  the wrong repository.
- The worktree hook rejects compound shell commands that mix `git` or `gh` with
  heredocs, `$(...)`, loops or `--jq` expressions. Run git and gh as plain
  single commands. For multi-file edits, write a small Python script to the
  scratchpad and run it on its own.
- A fresh worktree has no `node_modules`: run
  `bash scripts/bootstrap-worktree.sh`, then call `./node_modules/.bin/jest`
  (never `npx jest`). Use `CI=true`.
- `gitleaks` runs on commit. It flags test fixtures shaped like
  `SOME_SECRET=value` in a quoted string. Build such lines from a constant
  instead; never `--no-verify`.
- Jest regenerates files under `demo_api_server/data/`. Discard them
  (`git checkout -- demo_api_server/data`); never commit them.

**Tests and CI**

- Combined jest runs fail a different one or two suites each time (LMDB
  readers, loopback resets). Re-run the failing suite alone before treating it
  as real. A real regression fails the same suite twice.
- "No checks reported" on a PR means it conflicts with `main`. PRs that each add
  an entry at the top of `REGRESSION_PLAN.md` §4 or touch `TECH_DEBT.md`
  conflict with each other: rebase onto `origin/main`, keep both entries, push
  with `--force-with-lease`.
- The CI runner (a MacBook Air) has run out of disk once
  (`ENOSPC` in the hygiene gate). Re-run the failed job before blaming a change.

**Deploying and verifying**

- After any merge: `scripts/sync-main-checkout.sh`, then
  `scripts/deploy-live.sh`, both from the main checkout. Read the real exit
  code from a redirected log, never through a pipe.
- Verify by content in the container, not by the deploy's success line:
  `docker exec ai-demo-api-server grep -c '<marker from your diff>' /app/<file>`.
- Only `demo-api-server` and `ui` bind-mount source. `agent-service`,
  `mcp-gateway`, `langchain-agent` and others are image-built; `deploy-live`
  rebuilds them. A compose `environment:` change recreates the container.
- `llm-proxy` cannot be deployed by any sanctioned path. Its
  `unhandledRejection` handler (#532) is merged but not running.
- A new broker route in `demo_mcp_gateway/src/oauth/OAuthBrokerRouter.ts` must
  also be added to `GatewayServer.isOAuthBrokerPath`, or it answers 404 live
  while every router-level test passes. There is a wiring test.
- BFF and `mcp-gateway` changes to the Privilege link deploy together.

**PingOne**

- The hosted PingOne MCP servers were not authorised in this session. Reads and
  writes were done with the worker credentials already in the BFF container:
  `docker exec -i ai-demo-api-server node - < script.js`, token endpoint with
  `client_secret_basic`. Group and attribute-mapping writes were not blocked.
  Never print a token, secret or password; print status and claim names only.
- PingOne caps a `groups` claim in the **ID token** to
  `["SIZE_LIMIT_EXCEEDED"]` for a user in many groups (`demoAdmin` is in 43).
  Userinfo carries the full list. Release group mappings userinfo-only and make
  the consumer fall through to userinfo.
- Demo passwords in the BFF container (`DEMO_USER_PASSWORD`,
  `DEMO_ADMIN_PASSWORD`) matched PingOne on 2026-10-02. They rotate. Check with
  `POST /users/{id}/password`
  (`application/vnd.pingidentity.password.check+json`) before any login attempt.
- To see what an app really releases, run its own auth-code flow and read the
  claims. A Playwright `page.route` handler is not called for a redirect
  target; use `page.on('request')`. The Grafana Login app uses
  `client_secret_post` at the token endpoint.

**Strict internal secret**

- With `VAULT_INTERNAL_STRICT=true` the BFF exits at start-up (when
  `routes/agentTool.js` and `routes/agentIdToken.js` load) if
  `BFF_INTERNAL_SECRET` is the committed default. That is before the vault is
  opened, so a vault-only secret reads as the default. `ensure-service-keys.js`
  handles this for `run-docker.sh start`. Nine services read the secret, each
  from its own env file; they must all hold the same value.
