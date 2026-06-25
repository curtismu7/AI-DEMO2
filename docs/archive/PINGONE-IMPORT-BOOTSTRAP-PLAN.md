# PingOne Bootstrap In Import — Design Plan

**Status:** Draft for review. **Do not implement until approved.**
**Owner:** curtis · **Author:** Claude · **Date:** 2026-05-09

## 1. Problem statement

`npm run data:import` restores DB files and `.env` from a migration archive but **does not configure PingOne**. After import, four things are missing for a working environment:

1. Two PingOne **applications** (`MCP_GW`, `AGENT`) whose client IDs the demo's MCP gateway and agent service require at startup. Their absence is what's causing today's `Configuration error: Missing required env var: MCP_GW_CLIENT_ID` and `Missing required env var: AGENT_CLIENT_ID` (services on `:3005` and `:3006` exit on launch).
2. A **resource server** (`Super Banking API`) and `banking:*` **custom scopes** — required for RFC 8693 token-exchange demos. Existing bootstrap service explicitly punts on this with a `manualSteps` entry.
3. **Scope mappings** between the apps and the resource server's scopes — currently no mapping logic exists in any script.
4. **Demo user passwords** — `bankadmin` and `bankuser` are created without passwords (PingOne's create-user API doesn't accept them inline).

The existing [`banking_api_server/services/pingoneBootstrapService.js`](banking_api_server/services/pingoneBootstrapService.js) handles **only** the three OIDC apps (admin, user, authorize_worker) and demo user creation. Everything else is "manual steps" or absent.

## 2. Goals

- After `npm run data:import -- archive.tar.gz` completes, a user with valid PingOne management worker credentials can run a single command (or answer a single prompt) to fully provision PingOne for the demo: apps, users, resource server, scopes, mappings.
- Idempotent: re-running on an already-bootstrapped environment is safe and reports `skipped` for existing resources.
- All client IDs and secrets created during bootstrap are **automatically written into `banking_api_server/.env`**, so `./run-demo.sh` works without manual env editing.
- Failure modes produce actionable errors, not partial state with no recovery hint.

## 3. Non-goals (this iteration)

- **Tenant creation, environment creation, or PingOne licensing decisions.** Bootstrap assumes the environment exists and the user has a worker app with `Identity Data Admin` role.
- **Self-service password reset** in the bootstrap flow. Demo passwords are set via Management API after user creation; production-grade flows are not implemented here.
- **Multi-tenant** or **multi-environment** orchestration. One environment per run.
- **Rollback as automatic undo.** Bootstrap reports what was created; user runs the existing `pingone-audit-249.js` or deletes via Admin Console if rollback is needed. (See § 9.)
- **Replacing the `/configure` UI.** That UI continues to be the in-app way to edit creds; bootstrap is the bulk-provision path.

## 4. UX flow (browser-based — revised per direction 2026-05-09)

The CLI does not prompt. After `data:import` and `./run-demo.sh`, the user opens a browser page served by `banking_api_server`. **Only the four PingOne management worker credentials are entered**; everything else (resource server, scopes, apps, mappings, users, passwords) is created automatically server-side.

### 4.1 The flow

```
$ npm run data:import -- ~/banking-export-2026-05-09T13-47-18Z.tar.gz
… restores data files + .env …

Import complete. Next step:
  Start services:        ./run-demo.sh
  Then open in browser:  https://api.pingdemo.com:4000/setup/bootstrap

$ ./run-demo.sh
… services come up …
```

User browser → `https://api.pingdemo.com:4000/setup/bootstrap` →

```
┌─ Super Banking — One-time PingOne Setup ─────────────────────┐
│                                                              │
│  Status: ⚠ PingOne not yet configured                        │
│                                                              │
│  Paste your PingOne Management worker credentials below.     │
│  We'll create the resource server, scopes, apps, users, and  │
│  scope mappings automatically.                               │
│                                                              │
│  Don't have a worker app yet? See the runbook ↗              │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐    │
│  │ PingOne Environment ID  [_____________________]      │    │
│  │ Region                  [com ▾]                       │    │
│  │ Management Client ID    [_____________________]      │    │
│  │ Management Secret       [•••••••••••••••••••] [show] │    │
│  └──────────────────────────────────────────────────────┘    │
│                                                              │
│  [Probe connection]   [Bootstrap PingOne →]                  │
└──────────────────────────────────────────────────────────────┘
```

`Probe connection` calls `POST /api/setup/bootstrap/probe` with the four creds; backend obtains a management token and lists `/v1/environments/{id}/applications` to confirm reachability. UI shows ✓/✗ inline.

`Bootstrap PingOne →` shows a confirmation summary of the 12-step plan, then on confirm posts `POST /api/setup/bootstrap/run` which **streams progress** back as SSE. Each event is one of:

- `step_start { index, title }`
- `step_done { index, action: 'created' | 'skipped' | 'failed', name, id?, error? }`
- `complete { writtenEnvKeys: [...], summary: {...} }`
- `fatal { phase, message }`

UI renders a live checklist of all 12 steps (greyed → spinner → ✓/skipped/✗). On `complete`, UI shows:

```
✓ PingOne bootstrap complete

Created:    1 resource server, 4 scopes, 5 applications, 2 users, 6 scope mappings
.env added: PINGONE_ADMIN_CLIENT_ID, PINGONE_ADMIN_CLIENT_SECRET,
            PINGONE_USER_CLIENT_ID, PINGONE_USER_CLIENT_SECRET,
            PINGONE_AUTHORIZE_WORKER_CLIENT_ID, PINGONE_AUTHORIZE_WORKER_CLIENT_SECRET,
            MCP_GW_CLIENT_ID, MCP_GW_CLIENT_SECRET,
            AGENT_CLIENT_ID, AGENT_CLIENT_SECRET

→ Restart services so the new env vars take effect:  ./run-demo.sh restart
```

On any `fatal` or `step_done { action: 'failed' }`, UI surfaces the error inline with the partial-resource list (§ 9 rollback hint shown verbatim) and a **Retry** button (re-runs from where it failed, leveraging idempotency).

### 4.2 Why server-side, not CLI

- Single source of truth for "PingOne not yet configured" state — same `/api/setup/status` endpoint can drive a banner anywhere in the app.
- Mgmt secret never touches the user's clipboard history or shell scrollback (paste field only, not a TTY echo).
- SSE streaming gives a much better UX than batched CLI output for a 12-step run that takes 10–30 seconds.
- Reusable for "re-bootstrap" if the user ever wipes PingOne and wants to recreate without re-importing.

### 4.3 What the CLI still does

- `npm run pingone:bootstrap -- --probe` (existing) — unchanged, stays as a smoke test for the management worker creds in `.env`.
- `npm run pingone:bootstrap-from-import` (NEW) — non-interactive variant that reads `banking_api_server/bootstrap.config.json` (gitignored) and runs the same 12-step plan **without** the browser. For CI and scripting. Optional — not part of the primary flow.

## 5. Architecture changes

### 5.1 Files to create

- **`banking_api_server/services/pingoneBootstrapService.js`** — extend, do not replace. Add:
  - `ensureResourceServer(manifest, token, apiRoot)` — creates resource server if absent, returns its id.
  - `ensureScopes(manifest, resourceServerId, token, apiRoot)` — creates each `banking:*` scope, returns `{ name → id }`.
  - `ensureScopeMappings(appId, scopeIds, token, apiRoot)` — POSTs to `/applications/{id}/grants` with the resource-server-scoped grant payload. Idempotent (PingOne returns 409 on duplicate; treat as `skipped`).
  - `ensureUserPassword(userId, password, token, apiRoot)` — `PUT /users/{id}/password` with `forceChange=false` for demo users.
  - Extend `runPingOneBootstrap` to call all of the above in order, append per-step results to `result.steps`.
- **`banking_api_server/scripts/bootstrapPostImport.js`** — new orchestrator. Wraps:
  1. Prompt user for mgmt creds (or read non-interactive config).
  2. Probe Management API.
  3. Print plan.
  4. Confirm.
  5. Run `runPingOneBootstrap`.
  6. Patch the resulting client IDs/secrets into `banking_api_server/.env`.
- **`config/pingone-bootstrap.manifest.example.json`** — extend existing manifest with:
  - `resourceServer.scopes` list (4 scopes — already partially there).
  - `applications.mcp_gateway` and `applications.agent_service` (new — both `WORKER` type).
  - `scopeMappings` map: `{ admin_oidc: ["banking:admin", "banking:accounts:read", ...], user_oidc: [...] }`.
  - `demoUserPasswords` map: `{ bankadmin: "<placeholder>", bankuser: "<placeholder>" }`. Real passwords come from prompt or non-interactive config, not the manifest.
- **`PINGONE-BOOTSTRAP-RUNBOOK.md`** — operator-facing doc covering: prerequisites (worker app role), what gets created, where secrets land, how to clean up.

### 5.2 Files to modify

- **`banking_api_server/scripts/importMigrationBundle.js`** — at the end of import (after "Import complete" but before "Next steps"), prompt: `Run PingOne bootstrap now? [y/N]`. On `y`, exec `bootstrapPostImport.js`. Skip prompt if `--no-bootstrap` flag.
- **`banking_api_server/package.json`** — add `"pingone:bootstrap-from-import": "node scripts/bootstrapPostImport.js"`. Keep existing `"pingone:bootstrap"` for the manifest-only / dry-run path.
- **`README.md`** — Path B § 4 grows to mention bootstrap step. Path A § 4 mentions bootstrap as alternative to `/configure` UI.
- **`CLAUDE.md`** — add a row to the env-quirks section about how mgmt-worker creds reach bootstrap.

### 5.3 Dependencies to add

- A small interactive-prompt lib. **Don't** add a heavy dep like `inquirer`. Use Node's built-in `readline` (stdin/stdout). Hidden input for secrets via `process.stdin.setRawMode(true)` + manual `*` echo. ~50 LOC, no new package.

## 6. Phasing (suggested execution order — each phase is independently mergeable)

| Phase | Scope | Verifiable outcome | Approx. LOC |
|---|---|---|---|
| 1 | Manifest extension + `ensureResourceServer` + `ensureScopes` + tests for both | `npm run pingone:bootstrap -- --probe` lists new steps; running with valid creds creates resource server + 4 scopes (idempotent on rerun) | ~150 |
| 2 | `ensureScopeMappings` + manifest `scopeMappings` block + tests | After phase 2, admin app has `banking:admin` mapped; user app has `banking:accounts:read`+`banking:transactions:read` | ~120 |
| 3 | Add `mcp_gateway` and `agent_service` apps to manifest + creation logic + tests | After phase 3, `:3005` and `:3006` start cleanly because their `*_CLIENT_ID` env vars are populated | ~80 |
| 4 | `ensureUserPassword` + interactive prompt for demo passwords + tests | After phase 4, `bankadmin` / `bankuser` can log in to `/configure` UI without admin-set password | ~100 |
| 5 | `bootstrapPostImport.js` orchestrator + `.env` patching + readline prompt for mgmt creds + tests | Single command after import provisions everything; `.env` has all 5 client_id/secret pairs | ~200 |
| 6 | Wire into `importMigrationBundle.js` (`Run bootstrap now?` prompt) + README/CLAUDE.md/runbook docs | `npm run data:import -- archive.tar.gz` walks user end-to-end | ~80 |

Each phase ships behind a feature flag (`PINGONE_BOOTSTRAP_PHASE=N`) until phase 6 lands and removes the flag. This lets you ship phases incrementally without breaking the existing `npm run pingone:bootstrap` flow.

## 7. Secrets handling

- **Mgmt-worker secret never persisted to disk**. It lives in process memory for the duration of the bootstrap run. After run completes, only the *created* client IDs/secrets are written to `.env` — mgmt secret is discarded.
- **`.env` writes are atomic**: write to `.env.tmp`, fsync, rename. Backup existing `.env` to `.env.pre-bootstrap.{timestamp}` first.
- **Logs scrub secrets**. The bootstrap result object passed through console.log goes through a `redactSecrets` filter that masks `client_secret`, `password`, anything matching `/secret/i` in keys.
- **Non-interactive config file** is gitignored via the existing `.env` pattern. New entry in `.gitignore`: `bootstrap.config.json`.

## 8. Idempotency rules

| Resource | Lookup key | On duplicate |
|---|---|---|
| Resource server | `name` exact match in `/resources` | Skip; reuse existing id |
| Scope | `(resourceServerId, name)` exact match | Skip |
| Application | `name` exact match in `/applications` | Skip; **do not** rotate secret |
| Scope mapping | `(applicationId, scopeId)` in `/applications/{id}/grants` | Skip |
| User | `username` exact match | Skip create; do not overwrite password unless `--reset-passwords` flag |
| Password set | n/a | Always sets if `--reset-passwords`; otherwise only on freshly-created user |

Re-running bootstrap on a fully-provisioned environment should produce all-`skipped` rows and exit 0. This is the contract that makes the script safe to re-run after a partial failure.

## 9. Rollback

No automatic rollback — by design. Reasons:

1. PingOne resources created early in a run may already be in use by manual edits the user made; auto-deleting would destroy that work.
2. Half-rolled-back state is worse than no rollback.

Instead, on failure the script prints:

```
Bootstrap failed at step N. Resources created so far:
  - Resource server "Super Banking API" (id: …)
  - Scope banking:accounts:read (id: …)
  - Application "Super Banking — MCP Gateway" (id: …, client_id: …)

To clean up: open PingOne Admin Console > Applications/Resources, or run
  node scripts/pingone-audit-249.js --delete-by-name "Super Banking — *"
```

The audit script (`scripts/pingone-audit-249.js`) already exists and lists/deletes by name pattern; we'll extend it with a `--delete-by-name` flag in phase 5 if it doesn't already have one.

## 10. Testing strategy

- **Unit tests** (Jest, in `banking_api_server/tests/`) for each `ensure*` function, mocking `axios` to PingOne API endpoints. Cover happy path, 409 idempotency, 4xx error paths.
- **Integration test** in `bootstrapPostImport.test.js`: full run against a mock PingOne fixture (using `nock` or a minimal Express stand-in). Validates the 12-step plan executes in order and `.env` is patched correctly.
- **Manual E2E** against a real PingOne dev tenant — checklist in the runbook. Run before each phase merges.
- **Idempotency test**: run bootstrap twice in a row in the integration test; second run must produce all-`skipped` rows.

## 11. Open questions for the reviewer

1. **Demo user passwords** — generate per-install (write to `.env` for reference, like `BANKADMIN_DEFAULT_PASSWORD=…`) or read from non-interactive config? Recommendation: prompt during bootstrap, write to `.env` so the user can find it later.
2. **MCP_GW and Agent client TYPE** — both should be `application_type: 'service'` (PingOne `WORKER`) with `client_credentials` grant. Confirm this matches what the gateway/agent actually use at runtime, or whether they use authorization_code on behalf of an end user.
3. **Region selection** — manifest has `publicUrlTemplate` but no region. Add `region` to manifest, or always prompt? Recommendation: prompt (most users won't think about this until something fails).
4. **`scopeMappings` in manifest vs derived** — should the mapping be hard-coded in the manifest (current proposal), or derived from per-scope `appliesTo` arrays in the scopes block (more flexible but more code)?
5. **Phase 3 priority** — given today's blocking failure is `MCP_GW_CLIENT_ID` and `AGENT_CLIENT_ID`, should phase 3 ship *first* even though it logically comes after phase 1+2? Recommendation: yes — ship phase 3 standalone first as the smallest fix to today's pain, then phases 1+2+4+5+6 in the order shown.

## 12. What I'd like before writing any code

A reply confirming:
- [ ] Scope (the 6 phases above are the right cut)
- [ ] UX flow (§ 4) — prompt content, plan-then-confirm, `[y/N]`
- [ ] Phase order (start with phase 3 to unblock today's failure?)
- [ ] Answers to § 11 open questions (or "use your judgement")
- [ ] Anything missing from non-goals (§ 3)

Once approved, I'll start phase 3 (or phase 1 — whichever you prefer), write tests first, and surface a draft PR per phase for incremental review.
