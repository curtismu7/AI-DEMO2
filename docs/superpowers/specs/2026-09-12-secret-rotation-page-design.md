# Secret Rotation page — design

**Date:** 2026-09-12
**Status:** design approved in chat; implementation plan not yet written

## Why

Rotating a PingOne client secret in this repo is currently a hand-run runbook. It
is easy to get wrong in ways that look like something else: the regenerate call
403s on the wrong verb and 415s on the wrong content-type, the old secret dies
instantly with no grace period, a `CLIENT_SECRET_POST` app returns 401 to a Basic
verification probe so a *good* rotation reads as a bad one, and `.env` edits do
nothing until containers are **recreated** rather than restarted. Getting any step
wrong leaves the stack authenticating with a dead credential.

The 2026-09-12 `LLM-bak.json` incident — a live `env_admin` key published in a
public repo — is exactly the case this serves: an operator needs to rotate a
named app *now* and have every consumer updated without hand-editing eleven files.

## What this is

An **operator tool**, not a demo feature. Real rotation against real apps,
accepting brief downtime as the cost. It is not designed to be shown to a customer
on a call and does not need a sandbox target.

## Decisions

| Decision | Choice |
| --- | --- |
| Audience | Operator tool (real rotation) |
| Steps owned | Rotate → vault → `.env` → recreate containers → patch k8s secrets |
| Worker app | **Hard-excluded** — never appears in the list |
| k8s | In scope, same pass as local |
| Execution model | CLI does the work; page launches it **detached** and tails its log |
| Secret display | **Masked only** (`••••••••` + short SHA-256 fingerprint). The raw value is never shown, never returned to the browser |
| Confirmation | Required, explicit, before the irreversible call |

### Why CLI-first

The page runs inside the BFF. Step 4 recreates containers — and when the rotated
app is one `ai-demo-api-server` itself authenticates with, that step **kills the
process performing the rotation**, immediately after PingOne has destroyed the old
secret. An in-process design loses its completion signal at precisely the moment
the operator needs to know whether the vault write landed.

Running the work in a detached CLI makes the rotation survive its own container
recreate, keeps it usable when the UI is down (the likely state during an
incident), and makes the whole chain testable without a browser.

### Why masked-with-fingerprint

The raw value in the DOM is a live credential on a screen that may be shared. A
mask alone, though, tells the operator nothing about *which* value landed. The
existing runbook verifies propagation with `docker exec <c> printenv KEY | shasum`,
so surfacing a short SHA-256 fingerprint makes the result checkable against that
command without exposing the secret.

`••••••••` is already this repo's mask convention, and there is an existing helper
to reuse rather than reinvent: `demo_api_server/services/configStore.js:1558-1567`
returns stored config "with secrets replaced by `••••••••`", and
`demo_api_ui/src/components/McpGatewayConfig.jsx:674` states the user-facing
contract — "`••••` means the value is set".

## Components

### New

- **`demo_api_server/services/pingOneSecretRotation.js`**
  - `regenerateClientSecret(appId)` → `POST /v1/environments/{envId}/applications/{appId}/secret`
    with `Content-Type: application/vnd.pingidentity.secret.regenerate+json`.
    `PUT` returns 403; `application/json` returns 415. Response is `{ secret }`.
    Auth via the existing `getManagementToken()`.
  - `verifySecret(app, secret)` → token-endpoint probe. Chooses body-post vs Basic
    from the app's `tokenEndpointAuthMethod`; a `CLIENT_SECRET_POST` app 401s on
    Basic and that is **not** a failure. Reads `invalid_client` as FAIL,
    `invalid_scope` / `unauthorized_client` as PASS (credential accepted, failing
    later on scope or grant type).
  - `fingerprint(secret)` → first 8 hex of SHA-256, for display and log lines.
  - Never logs, returns, or stringifies the raw value.

- **`scripts/rotate-app-secret.js`** — the orchestrator (see Ordering below).

- **`demo_api_server/routes/secretRotation.js`** — admin-gated:
  - `GET  /api/admin/secret-rotation/apps` — rotatable apps only
  - `POST /api/admin/secret-rotation/start` — spawns the CLI detached, returns a run id
  - `GET  /api/admin/secret-rotation/runs/:id` — tails that run's log

- **`demo_api_ui/src/pages/SecretRotationPage.jsx`** (+ `.css`) — `InspectorShell`
  layout, `apiClient` for BFF calls, confirmation via `DraggableModal`.

### Reused, not rebuilt

- `lib/vault/index.js` — `openVault()` → `set(name, value)` → `await save()`. A real
  programmatic write path already exists; only the CLI uses it today.
- `demo_api_server/scripts/refresh-service-envs.js` — already the propagation half.
  It re-derives all 12 service `.env` files by **pulling each app's current secret
  from PingOne** (`getAppSecret`, line 265), so alias keys
  (`TE_CLIENT_SECRET` = `MCP_GW_CLIENT_SECRET` = …) resolve by construction rather
  than by matching old values. Handles dotenvx encryption and `.env.keys`.
  **Change required:** its orchestration lives in an unexported `main()`; export it
  (e.g. `propagateServiceEnvs`) so the CLI calls it instead of shelling out.
- `demo_api_server/services/agentBuilderService.js:119 listApplicationsRaw()` — the
  only lister that surfaces `tokenEndpointAuthMethod`, which is how the page filters
  to apps that actually have a rotatable secret. (Note `pingOneClientService
  .listOidcApplicationsRaw()` filters by OIDC protocol and returns a *different*
  set; this design uses the `agentBuilderService` one deliberately.)
- `run-docker.sh restart <svc>` for the recreate; `k8s/create-secrets.sh`'s
  `kubectl patch` for the cluster.

## Ordering

Everything fallible runs **before** the irreversible call, so a preflight failure
leaves the world untouched.

1. **Preflight — abort with nothing changed if any fails**
   - target is not the worker (hard deny-list)
   - target's `tokenEndpointAuthMethod` implies a secret exists
   - vault opens **and is writable** (prove the write path before rotating)
   - service `.env` files are writable
   - `docker` reachable if `--restart`; `kubectl` context reachable if `--k8s`
2. **Rotate** — irreversible from here; the old secret is dead immediately
3. **Vault write** — `set` + `save`, first, because it is the hardest to recover
4. **Propagate** — `propagateServiceEnvs()` re-derives the service `.env` files
5. **Verify** — token-endpoint probe per the `invalid_scope`-is-a-pass rule
6. **Recreate** — `./run-docker.sh restart <svc>` (a plain `docker restart` keeps
   the old value, because Compose resolves `env_file` at container-create time)
7. **k8s** — `kubectl patch` the corresponding secret

## Secret handling rules

- **Never in argv.** `execFileSync` echoes argv in its error message; that behaviour
  previously leaked three plaintext secrets into a transcript and forced a
  re-rotation. Vault writes pass the value on **stdin**.
- Never written to the run log, the HTTP response, or the browser.
- Only the mask and the fingerprint cross a process or network boundary.

## Confirmation UX

Modeled on `demo_api_ui/src/components/KillSwitchConfirmModal.jsx`, the repo's
existing destructive-action precedent: `DraggableModal`, two-stage (arm, then
confirm), a required structured reason, and explicit "this cannot be undone" copy.
The modal names the target app and states plainly that the current secret dies
immediately and every consumer breaks until propagation completes. No
typed-confirmation-string pattern exists in this repo, so this design does not
invent one.

## Wiring (three sources of truth + guard)

Adding the page touches all of these, and `npm run authz:verify` fails if they
disagree:

- `demo_api_ui/src/components/AdminSideNav.jsx` — the rendered entry
- `demo_api_ui/src/config/navStructureCatalog.js` — the group listing
  (`navStructureCatalog.drift.test.js` asserts these two match exactly)
- `demo_api_server/config/auth-requirements.json` — `"/secret-rotation": "admin"`
- `demo_api_ui/src/App.js` — the `<Route>` wrapped in `<RequireAdminLogin>`

## Failure modes

| Failure | Behaviour |
| --- | --- |
| Preflight fails | Abort. Nothing rotated, nothing written. |
| Rotate fails | Abort. Old secret still valid. |
| Vault write fails after rotate | Stack is down on this app. The log says so explicitly and names the recovery: re-run the rotation (regenerating again is always available). The raw value is deliberately **not** offered as a recovery path. |
| Propagation fails | Vault already holds the new value; log names the remaining `.env` files. |
| Verify fails with `invalid_client` | Real failure — surfaced loudly. |
| Verify fails with `invalid_scope` | **Pass.** Treated as success, with a log line saying why. |
| Restart/k8s fails | Rotation itself succeeded; log gives the exact command to finish by hand. |

## Testing

- `regenerateClientSecret` sends the regenerate content-type and `POST` (guards the
  403/415 traps).
- `verifySecret` maps `invalid_scope` → pass and `invalid_client` → fail, and picks
  body-post for a `CLIENT_SECRET_POST` app.
- Preflight refuses the worker app.
- Preflight refuses when the vault cannot be opened, **before** any rotate call is
  issued (assert the rotate function was never called).
- No test fixture contains a real secret; assertions are on call shape and masking.

Runner: jest in `demo_api_server`, scoped per the repo's "scoped by default" rule.

## Out of scope

- Rotating the worker credential itself.
- Scheduled/automatic rotation.
- Rewriting history or any remediation of already-leaked values — that is
  `docs/incident-response/`'s job, and rotation at source is the only real fix.
