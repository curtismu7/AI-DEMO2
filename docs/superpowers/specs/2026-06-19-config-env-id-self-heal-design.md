# Config store env-id self-heal — design

**Date:** 2026-06-19
**Status:** Approved (design); pending implementation plan
**Author:** Curtis Muir (with Claude Code)

## Problem

The BFF resolves config through `configStore.getEffective(key)`, whose precedence is
**cache (Vault > LMDB) → env (`.env`/process.env) → committed defaults → FIELD_DEFS default**
(`demo_api_server/services/configStore.js`). The cache is populated at boot from the
container's **own internal LMDB** (not the host `data/persistent/lmdb` mount) and from the
**Vault** (`secrets.vault`, injected via `vaultLoader` → `setRaw(persist:false)`).

Because a stored LMDB/Vault row outranks `.env`, when the PingOne **environment changes**
(new `PINGONE_ENVIRONMENT_ID`) the credentials, audiences, and resource URIs from the
*previous* environment persist in LMDB/Vault and silently shadow the corrected `.env`.

This actually happened (2026-06-19): a stale LMDB row
`PINGONE_MCP_TOKEN_EXCHANGER_CLIENT_ID = f4dd707d…` (a Token Exchanger app from a
rebuilt/old PingOne env, since deleted) shadowed the correct `.env` value `d3f8fead…`.
The exchanger secret still resolved from `.env` (d3f8fead's secret), so PingOne received a
mismatched id+secret pair → `invalid_client` → the RFC 8693 Exchange #2 actor token failed
→ users saw *"The actor token is invalid or expired."* on every agent tool call.

There is currently **no reconciliation** between `.env`, the configStore cache, LMDB, and the
Vault on an environment change. Keeping all four in sync relies on operator discipline, which
is the exact gap that caused the bug.

## Goal

On boot, automatically detect a PingOne env change and reconcile all four stores so the new
`.env` wins — with **no operator discipline** required, and **zero behavior change** on a
normal restart where the env is unchanged.

### Non-goals

- No destructive write to the `secrets.vault` file (re-bootstrap owns vault rotation).
- No change to `getEffective` precedence for the general case (env-agnostic keys keep the
  "Vault/LMDB/Config-UI overrides `.env`" model).
- Not a multi-environment runtime switcher; this reconciles a single active env at boot.

## Approach (selected)

**Auto self-heal on boot, driven by a reserved env-id stamp, with an explicit per-key
`envScoped` flag, neutralizing stale Vault env-scoped keys non-destructively.**

Selected over: (a) hooking only the bootstrap/provision script (leaves a bare-`.env`-edit gap),
and (b) a manual admin action (relies on memory — the same gap). Vault handling selected over
"only purge LMDB" (stale vault secrets would still shadow, since Vault outranks `.env`) and over
"flip precedence for envScoped keys" (wider blast radius on the override model).

## Architecture

### Component 1 — `envScoped` classification (dedicated registry)

Classification lives in a **dedicated registry** in `envReconcile.js`, NOT as a flag on
`FIELD_DEFS`. This is deliberate: `FIELD_DEFS` is not the full key universe — env-scoped
credentials also resolve only through `configStore`'s `envFallbackMap`, and env-scoped secrets
live in the **Vault** with no `FIELD_DEFS` entry (e.g. `pingone_ai_agent_client_secret` is a
vault entry but not a `FIELD_DEFS` key). A flag on `FIELD_DEFS` could not reach those, so a stale
vault secret would survive the purge.

```text
// envReconcile.js — canonical lowercase key names
ENV_SCOPED_KEYS   = Set([...])  // wrong if the PingOne env_id changes → purge
ENV_AGNOSTIC_KEYS = Set([...])  // survives an env change → keep
isEnvScoped(key)  = ENV_SCOPED_KEYS.has(normalize(key))
```

Rule: *"would this value be wrong if the PingOne env_id changed?"*

- **`ENV_SCOPED_KEYS`** — `pingone_environment_id`, `pingone_region`, `pingone_base_url`;
  every PingOne app credential pair (admin, user, management/mgmt, worker, ai_agent,
  mcp exchanger, mcp gateway, authorize worker, A2A specialists, copilot, gw_introspection);
  all `pingone_resource_*` / `*_audience` URIs; decision-endpoint ids, policy id,
  mfa policy id, DaVinci/ACR policy ids; `oauth_*` endpoints (embed the env id);
  introspection endpoint/client; `admin_population_id`; `pingone_root_domain`;
  `pingone_mcp_environment_id`; `pingone_authorization_code_client_id`.
- **`ENV_AGNOSTIC_KEYS`** — all `ff_*` flags; thresholds (`confirm_threshold_usd`,
  `mfa_threshold_usd`, `step_up_*`); `marketing_*` / UI prefs / admin skin; `llm_framework`,
  `agent_mode`, `agent_external_wiring`, `lmstudio_*`, `anthropic_api_key`; `session_secret`;
  deployment URLs (`mcp_server_url`, `mcp_gateway_http_url`, `mcp_pinggateway_url`,
  `frontend_*`, `public_app_url`); internal shared secrets (`bff_internal_secret`,
  `hitl_internal_secret`); intent/cache/JWKS/debug config; role mappings (`admin_role`,
  `user_role`, `admin_username`); demo creds/hints.

**Boundary calls (confirmed):**
- `helix_*` (base_url/api_key/environment_id/agent_id) → **`ENV_AGNOSTIC_KEYS`** (Helix is a
  separate environment from the PingOne env_id; a PingOne switch shouldn't wipe a valid Helix
  agent — re-bootstrap rewrites them from `.env` anyway).
- `*_token_endpoint_auth_method` → **`ENV_AGNOSTIC_KEYS`** (behavioral, not identity).

**Safety net (completeness guard):** a unit test asserts that **every** key drawn from all three
sources — `FIELD_DEFS` keys, `configStore` `envFallbackMap` keys, and the current Vault entry
names — appears in exactly one of `ENV_SCOPED_KEYS` / `ENV_AGNOSTIC_KEYS`. A new (or vault-only)
key that is unclassified fails CI rather than silently surviving a purge it should not. A small
`IGNORED_KEYS` set covers pure infra keys (`vault_password`, `vault_path`, the `__seeded_env_id`
stamp) that are neither.

### Component 2 — Env-id stamp + mismatch verdict

- Reserve a non-`FIELD_DEFS` LMDB key `__seeded_env_id` holding the env id the store was last
  seeded for.
- A synchronous, idempotent `computeEnvReconcileVerdict()` reads the current env id
  (`process.env.PINGONE_ENVIRONMENT_ID`) and compares to the stamp. It returns one of:
  - `noop` — stamp equals current env id (normal restart).
  - `reconcile` — stamp present and differs, **or** stamp absent while any `envScoped` LMDB
    row exists (heals today's legacy drift on first deploy of this feature).
  - `skip-warn` — current env id empty/missing (never purge blindly; log a warning).
  - `stamp-only` — fresh store, no `envScoped` rows; write the stamp, purge nothing.
- The verdict is memoized so configStore init and `vaultLoader` see the same answer regardless
  of call order.

### Component 3 — LMDB purge (on `reconcile`)

In `_initialize()`, after `_loadFromLmdb()` and **before** `_seedFromEnv()`:
- For every LMDB row whose key satisfies `isEnvScoped(key)`: `_lmdbConfig.remove(key)`
  and evict `this._cache[KEY]`.
- Write `__seeded_env_id = <current env id>`.
- `_seedFromEnv()` then reseeds the cleared keys from `.env` (the values that changed).

### Component 4 — Vault neutralization (on `reconcile`)

`vaultLoader.loadVaultIntoConfigStore()` consults `computeEnvReconcileVerdict()`. On
`reconcile`, it **filters `envScoped` keys out of the `setRaw(persist:false)` payload** — stale
vault secrets never enter the cache, so `.env` wins. The `secrets.vault` **file is not
modified**. A later re-bootstrap refreshes the vault with the new env's secrets.

### Component 5 — Reconcile record + observability surfaces

The reconcile pass produces **one canonical record** that every surface reads (DRY — no surface
recomputes or re-formats):

```text
EnvReconcileRecord = {
  verdict,        // 'reconcile' | 'noop' | 'skip-warn' | 'stamp-only'
  fromEnvId,      // previous stamp (or null)
  toEnvId,        // current PINGONE_ENVIRONMENT_ID
  purgedKeys,     // string[] of envScoped key NAMES purged (never values)
  vaultDropped,   // string[] of envScoped vault key NAMES neutralized
  at,             // ISO timestamp
}
```

It is held in memory as `configStore.lastEnvReconcile` and fanned out to four surfaces:

1. **Prominent startup banner** — on `reconcile` (and `skip-warn`), emit a boxed,
   high-visibility log block (same boxed style as the existing `[session-store]` / startup
   banners) showing `from → to` env id, verdict, and the purged + vault-dropped key names.
   `noop` logs a single quiet info line.
2. **Health/status endpoint field** — expose `lastEnvReconcile` on the admin config status
   response (`GET /api/admin/config`) so monitoring/UI can detect an auto-heal without scraping
   logs. The field is the record above (names only — consistent with `getMasked()` never
   leaking secret values).
3. **Admin UI surfacing** — the `/config` admin page reads `lastEnvReconcile` and, when the last
   boot's verdict was `reconcile`, renders a dismissible notice listing what changed
   (operator-facing confirmation where config is managed).
4. **Persisted reconcile audit log** — append every `reconcile` / `skip-warn` record to the
   durable activity NDJSON via `appEventService.logEvent('config', …)` (it already
   `fs.appendFileSync`s to `logs/activity.ndjson`), so env-change history survives restarts and
   is queryable after the fact. (Note: `exchangeAuditStore` is an in-memory ring buffer — NOT the
   durable surface; `appEventService` is.)

All four surfaces derive from the single `EnvReconcileRecord`: the durable `appEventService`
NDJSON line and the in-memory `configStore.lastEnvReconcile` (read by the status endpoint + admin
UI) are two projections of the same record — no separate audit store is introduced.

## Data flow / ordering

```text
boot
 └─ configStore._initialize()
     ├─ _loadFromLmdb()                 # loads all rows incl. stale envScoped
     ├─ verdict = computeEnvReconcileVerdict(process.env.PINGONE_ENVIRONMENT_ID, stamp)
     ├─ if reconcile:                    # Component 3
     │     remove envScoped LMDB rows + evict cache; write __seeded_env_id
     │   if stamp-only: write __seeded_env_id
     │   if skip-warn: log warning, do nothing
     ├─ publish EnvReconcileRecord       # Component 5: banner + lastEnvReconcile + NDJSON audit
     └─ _seedFromEnv()                   # reseeds envScoped from .env

vaultLoader.loadVaultIntoConfigStore()   # Component 4 (server startup)
 ├─ verdict = computeEnvReconcileVerdict(...)   # memoized — same answer
 └─ setRaw(filter(vaultData, drop envScoped iff reconcile), {persist:false})
```

The only ordering constraint: the verdict must be computed (and identical) before vault secrets
are cached. Memoization in `computeEnvReconcileVerdict()` guarantees this regardless of which
of configStore-init / vaultLoader runs first.

## Error handling & observability

- `skip-warn` (env id empty) → `console.warn` + an `appEvent('config','warn', …)`; no mutation.
- Every `reconcile` emits an audit `appEvent('config','warn','env-id change detected — reconciled
  N envScoped keys', { fromEnvId, toEnvId, count, keys })` (key **names** only, never values).
- LMDB `remove` failures are caught per-key and logged; reconcile is best-effort and never
  blocks boot (matches existing `_seedFromEnv` / `_loadFromLmdb` fail-soft behavior).
- Stamp write failure → logged; next boot retries the verdict (idempotent).

## Testing

**Unit**
- Verdict matrix: match→`noop`; differ→`reconcile`; absent+envScoped rows→`reconcile`;
  fresh/no rows→`stamp-only`; empty current env→`skip-warn`.
- Completeness guard: every key from `FIELD_DEFS` + `envFallbackMap` + current Vault entry names
  is in exactly one of `ENV_SCOPED_KEYS` / `ENV_AGNOSTIC_KEYS` (or the `IGNORED_KEYS` infra set).
- Vault filter: drops `envScoped` keys on `reconcile`, keeps them on `noop`.
- Reconcile purges only `envScoped` LMDB rows; env-agnostic rows (a feature flag, a threshold,
  `session_secret`) survive.
- `EnvReconcileRecord` shape: on `reconcile` it carries `purgedKeys` + `vaultDropped` (names
  only, **no values**); is exposed as `configStore.lastEnvReconcile`; and is the single source
  the banner/status/audit derive from. Assert no secret value appears in the record or the
  `GET /api/admin/config` payload.
- Durable audit: a `reconcile` appends exactly one NDJSON line; `noop` appends none.

**Integration (the `f4dd707d` repro)**
- Seed LMDB with `PINGONE_MCP_TOKEN_EXCHANGER_CLIENT_ID = <old-env id>` and a stamp of the old
  env; set `.env` `PINGONE_ENVIRONMENT_ID` + exchanger id to the new env; boot.
- Assert `getEffective('pingone_mcp_token_exchanger_client_id')` returns the `.env` (new) value.
- Assert an env-agnostic key set via the config path survived.

**Regression**
- Matching stamp → no LMDB `remove` calls, no vault filtering, identical resolution to today.

## Rollout notes

- First deploy carrying this feature will, on the existing stores, see `stamp absent +
  envScoped rows` → run the one-time `reconcile`, healing current drift (including the original
  bug) and writing the initial stamp. Operators should expect env-scoped values to snap to
  `.env` on that first boot. Env-scoped overrides intentionally set via the `/config` UI (not
  in `.env`) would be dropped — acceptable, since env credentials are `.env`/bootstrap-owned.
- No host data migration; the container's internal LMDB is reconciled in place.
