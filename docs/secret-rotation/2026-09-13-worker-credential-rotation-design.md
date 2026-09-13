# Worker credential rotation — design

**Date:** 2026-09-13
**Status:** design approved in chat; implementation plan not yet written
**Extends:** `docs/secret-rotation/2026-09-12-secret-rotation-page-design.md` (the
original design's "Worker app: **Hard-excluded**" decision and its "Out of
scope: Rotating the worker credential itself" line are both superseded by
this doc for the one credential this covers — every other guardrail in that
doc is unchanged and still applies)

## Why

After the rotatable-apps list grew from 5 to 20 (`PINGONE_ADMIN_CLIENT_ID` and
the rest — see git history for `getRotatableVaultKeyMap()`), the one PingOne
app still permanently unreachable through this tool is `Demo AI App -
Introspection Worker` (`PINGONE_WORKER_CLIENT_ID` /
`PINGONE_WORKER_CLIENT_SECRET`) — the credential `isWorkerApp()` hard-excludes
because it is the identity the rotation tool itself (and nearly every other
PingOne-Management-API caller in this repo) authenticates with.

## Investigation: what actually breaks, and what doesn't

Two design rounds happened in chat before this doc. The first ("flip the
`||` precedence at every consumer so a vault write wins over `process.env`")
was approved, then found to be **incorrect** on closer reading of
`services/configStore.js`'s `getEffective()`:

```js
// getEffective(key), both branches (BOOTSTRAP_ALLOWLIST and "everything else"):
const envVal = readEnv();       // checks process.env FIRST, unconditionally
if (envVal) return envVal;
const stored = readStored();    // vault/LMDB only reached if process.env is EMPTY
if (stored) return stored;
```

`getEffective()` itself checks `process.env` before the vault, for every key,
regardless of how a *caller* orders its own `||` chain. Reordering
`process.env.X || configStore.getEffective(y)` to
`configStore.getEffective(y) || process.env.X` is a no-op: `getEffective(y)`
returns the same `process.env.X` value either way. This also means an earlier
in-chat claim — that the 15 newly-added apps don't need a restart because
their consumers read them "live via configStore" — was wrong. They need a
restart the same as every app in this tool always has; the CLI's own "to
finish on the host: `./run-docker.sh restart ...`" message was never optional.

**What this means for scope:** the 20+ files that read
`PINGONE_WORKER_CLIENT_ID`/`SECRET` (`services/pingOneAuthorizeService.js`,
`pingOneClientService.js`, `pingOneUserService.js`,
`pingOneGroupProvisionService.js`, `twoExchangeReconciler.js`,
`routes/health.js`, `routes/mcpPingOneAdminAuth.js`, etc.) need **no changes**.
They already resolve the credential correctly for their situation (some via
`configStore.getEffective`, some via raw `process.env`, one —
`pingOneClientService.resolveWorkerCredentials()` — via `configStore.get()`
directly, which genuinely does check the vault-owned cache first, unlike
`getEffective()`) and all of them pick up a rotated secret exactly the way
every other rotated app's consumers do: on the next container recreate. The
worker is not special to them.

The worker *is* special in exactly one place: **inside the same CLI run that
rotates it.** `scripts/lib/rotateAppSecretCli.js`'s `main()` calls
`vaultSet()` (writes the new secret to the vault) and then
`propagateServiceEnvs()` (`scripts/refresh-service-envs.js`'s `main()`), which
mints its own fresh PingOne worker token to re-derive the other 11 services'
`.env` files. That token mint reads `PINGONE_WORKER_CLIENT_ID`/`SECRET` via
`parseEnv(API_ENV)` — the raw, not-yet-restarted `.env` file — which at this
point in the run still holds the secret PingOne just invalidated. That one
call would fail with `invalid_client`, and (per the existing, unrelated
"propagation is non-fatal" design) get logged as `PROPAGATION INCOMPLETE`
rather than crash the run — but the other 11 services' `.env` files would
then genuinely not get re-derived in this pass, for a rotation that most needs
them to.

## Decisions

| Decision | Choice |
| --- | --- |
| Scope | One function, one file: `scripts/refresh-service-envs.js`'s `main()` worker-token resolution |
| The 20+ other consumer files | **Unchanged** — no precedence flip, no `configStore` rewiring |
| Restart requirement | **Unchanged and still required** — same as every other app in this tool. Not a gap being closed; the worker was never going to be restart-free |
| What's actually new | The rotation CLI's own worker-token lookup becomes vault-first (`loadVaultSecrets`, already used elsewhere in this file), so `propagateServiceEnvs()` succeeds within the same run that rotated the worker |
| UI warning | Stronger copy specifically for the worker: rotating it, until the restart happens, breaks every PingOne-Management-API call in the whole demo — not just the one app, unlike every other rotation |
| `isWorkerApp()` | Removed from `routes/secretRotation.js`'s `/apps` filter; the worker joins the direct-mapping mechanism the other 15 apps already use |

## The fix

`scripts/refresh-service-envs.js` `main()`, around the existing lines:

```js
const apiVars = parseEnv(API_ENV);
const envId  = apiVars.PINGONE_ENVIRONMENT_ID;
const region = apiVars.PINGONE_REGION || 'com';
const workerId     = apiVars.PINGONE_WORKER_CLIENT_ID;
const workerSecret = apiVars.PINGONE_WORKER_CLIENT_SECRET;
```

`workerSecret` changes to prefer a vault entry over the `.env` value, using
the same `loadVaultSecrets()` helper this file already calls for
`INTENT_TOKEN_SECRET`/`BFF_INTERNAL_SECRET`:

```js
const vaultWorker = await loadVaultSecrets(['PINGONE_WORKER_CLIENT_SECRET']);
const workerSecret = vaultWorker.PINGONE_WORKER_CLIENT_SECRET || apiVars.PINGONE_WORKER_CLIENT_SECRET;
```

`loadVaultSecrets()` already fails soft (returns `{}` on any vault error), so
a fresh clone with no vault, or a vault that has never had this key set,
falls through to today's `apiVars` behavior unchanged. `workerId` is left
alone — rotating the *secret* never changes the app's `clientId`.

`getRotatableVaultKeyMap()`'s own worker-token acquisition (used by `/apps`
and `/start`'s preflight, both of which run *before* any rotation) is
**unchanged** — at that point in time the `.env` secret is still the live
one, so there is nothing to fix there.

## Removing the exclusion

- `PINGONE_WORKER_CLIENT_ID` → `PINGONE_WORKER_CLIENT_SECRET` joins
  `DIRECT_VAULT_KEY_ENV_PAIRS` in `refresh-service-envs.js`, resolved through
  the same `directVaultKeyMap()`/`listAllApps()` id-lookup path as the other
  15 direct apps.
- `routes/secretRotation.js`'s `GET /apps` drops its
  `.filter((a) => !isWorkerApp(a))` line. `isWorkerApp()` itself
  (`demo_api_server/services/pingOneSecretRotation.js`) stays — it is still
  correct, general-purpose logic, just no longer called from this one call
  site. (Grep before deleting: confirm nothing else imports it before
  removing the function itself, in case a future change wants to reintroduce
  a different kind of guard.)

## UI warning copy

`demo_api_ui/src/pages/SecretRotationPage.jsx`'s confirm modal currently says,
for every app:

> This cannot be undone. **{name}**'s current secret dies immediately, and
> every consumer fails until propagation completes.

For the worker specifically, "every consumer" undersells it — it is not one
app's consumers, it is every PingOne-Management-API call anywhere in the
demo (provisioning, group/user management, PingOne Authorize, health checks,
admin auth) until `demo-api-server` is restarted. Add a worker-specific
branch to that warning naming this explicitly, so an operator confirming the
rotation knows the blast radius before they click through — not a new
mechanism, just copy that tells the truth for this one app.

## Testing

- `refresh-service-envs.js` `main()`: a test proving the worker token mint
  prefers a vault-supplied `PINGONE_WORKER_CLIENT_SECRET` over a conflicting
  `.env` value (mock `loadVaultSecrets`), and a test proving the existing
  `.env`-only behavior is unchanged when the vault has nothing for this key.
- `refreshServiceEnvsRotatableKeys.test.js`: the existing `'EXCLUDES the
  worker'` test's *assertion* inverts — from "must never appear" to "appears,
  keyed by both id and clientId, via the direct map" — since it is no longer
  testing a safety boundary, note in the test's own comment why the
  assertion flipped rather than silently deleting the old test's intent.
- `routes/secretRotation.js` test: `GET /apps` includes the worker app when
  `getRotatableVaultKeyMap()` returns it (no `isWorkerApp` filter left to
  test at this call site).
- No test touches the 20+ other consumer files — this design makes no claim
  about their behavior changing, so there is nothing new to prove there.

## Out of scope

- Any change to how the 20+ other worker-credential consumers resolve it —
  investigated and found already correct for their situation; touching them
  would be adding risk for no behavioral gain.
- Making the worker (or any app) rotatable **without** a subsequent restart —
  not possible without moving those consumers off `process.env` entirely onto
  a live, per-request vault read, which the first design round proposed and
  the second round explicitly declined as disproportionate to the actual gap.
- Any change to `demo_api_server/.env` itself (no write-back, no dotenvx
  rewrite) — the vault-first fix above only touches `refresh-service-envs.js`'s
  own in-memory resolution for one CLI run; the physical `.env` file is
  updated the same way it always has been, by a human re-running the
  encrypted-env bootstrap after a rotation, or on the demo's next fresh
  provision.
