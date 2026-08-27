# Vault-Backed Secrets for K8s Deployments — Design

## Context

`demo_api_server` already has a vault-aware config reader (`configStore.js`),
resolving values in the order `.env` (`process.env`) > vault (`secrets.vault`,
encrypted, `demo_api_server/scripts/vault.js`) > LMDB. But `k8s/create-secrets.sh`
— the script that materializes every service's secrets into K8s Secrets for
the SE/AWS deployment — is vault-blind. It reads each service's `.env` file
directly (`secret_from_envfile()`, with `dotenvx` decryption for
`encrypted:...`-prefixed values) and pushes whatever it finds, verbatim, into
a K8s `Secret` via `kubectl apply`.

This repo has 7 such calls, one per service, each sourcing a different `.env`
file: `ai-demo-secrets` (`demo_api_server/.env`), `gateway-secrets`
(`demo_mcp_gateway/.env`), `mcp-secrets` (`oauth-mcp/.env`), `hitl-secrets`
(`demo_hitl_service/.env`), `langchain-secrets` (`langchain_agent/.env`),
`agent-secrets` (`demo_agent_service/.env`), `ping-gateway-secrets`
(`ping-gateway/.env`).

**Incident (2026-08-25):** `GW_INTROSPECTION_CLIENT_ID`/`SECRET` and
`PINGONE_MCP_GATEWAY_CLIENT_ID`/`SECRET` were declared with *different*
values in `demo_mcp_gateway/.env` vs `demo_api_server/.env`. In K8s, the
`authz-server` container's `envFrom` lists `gateway-secrets` first and
`ai-demo-secrets` last — "later wins on key collisions" — so the stale
`demo_api_server/.env` copy silently overrode the correct one, breaking live
PingOne token introspection and RFC 8693 exchange on the SE cluster. This is
the same failure class documented in
`project-vault-configstore-invalid-client-incident` (2026-08-21) for the
local/Docker path, which `configStore.js`'s `.env` > vault precedence already
defends against there — but K8s has no equivalent defense at all, because it
never consults the vault.

## Goal

Collapse from N independent, unsynchronized `.env` files down to the vault as
the single source of truth for secret *values*, for both local/Docker and
K8s/SE deployment targets — without requiring runtime code changes in any
service. `demo_mcp_gateway`, `demo_authz_server`, `oauth-mcp`,
`demo_hitl_service`, `langchain_agent` (Python), `demo_agent_service`, and
`ping-gateway` all continue reading plain `process.env` / `os.environ`
exactly as today.

## Non-goals

- Live secret rotation without a redeploy (the vault is read at
  `create-secrets.sh` deploy time, matching how it's already used locally —
  not a running-pod live-reload capability).
- Porting vault-reading capability into any service's runtime (Approach B,
  rejected — see Approaches below).
- Changing the local/Docker resolution order (`.env` > vault > LMDB stays as
  documented; this design is additive for K8s, not a change to local dev).

## Approaches considered

**A — Deploy-time only (chosen).** `create-secrets.sh` becomes vault-aware:
for each key it's about to push, if the key is secret-shaped, its value comes
from the vault, never from `.env`. `.env` still tells the script which key
*names* exist per service; it just stops being a source of secret *values*.
No app code changes anywhere.

**B — Runtime delivery to every pod.** Mount `secrets.vault` + `VAULT_PASSWORD`
into every pod; either port a vault-reading client into every language
(a real Python port needed for `langchain_agent`) or run a shared
init-container that decrypts once into an env file the entrypoint sources.
Rejected: touches every deployment manifest's volumes/entrypoint, needs a
cross-language story, and buys nothing this repo's actual usage pattern
needs (the vault isn't rotated live today).

**C — Hybrid (A now, B later if live rotation ever becomes a real
requirement).** Not pursued now; A's mechanism doesn't preclude adding B
later if needed.

## Design

### `.env` vs. vault — what lives where

Going forward, `.env` files hold **non-secret** values only: client IDs,
resource URIs, ports, feature flags. This matches existing precedent already
in the repo (`demo_api_server/.env`'s own comment: *"MCP Gateway app client
id (value is dotenvx-encrypted — a historical artifact; client ids aren't
normally secret)"*). Actual secret material — `*_SECRET`, `*_KEY`,
`*_PASSWORD`, and any explicitly-flagged exception (e.g.
`HITL_INTERNAL_SECRET`, which already matches the `*_SECRET` shape) — lives
only in the vault.

### `create-secrets.sh` changes

`secret_from_envfile(secret_name, env_file)` changes its value-resolution
step: for each declared key name (still discovered by scanning `env_file` as
today), decide secret-shaped vs. not by name pattern. Non-secret-shaped keys
resolve from `.env` exactly as today (including the existing `encrypted:`
dotenvx path, for the rare non-secret value that's still wrapped that way).
Secret-shaped keys resolve via `node scripts/vault.js get <NAME>` instead —
`.env`'s value for that key, if any, is ignored entirely (no fallback; see
Non-goals).

`VAULT_PASSWORD` is already read once per `create-secrets.sh` run (from
`demo_api_server/.env`) for namespace derivation elsewhere in the script;
reused here for vault lookups too, not a new secret-delivery path.

### Guard-rail against recurrence

While scanning each `.env` file, if a secret-shaped key is found with a
**non-empty** value that **differs from the vault's current value** for that
name, `create-secrets.sh` warns loudly (or fails, matching the fail-closed
choice below) — this is exactly the shape of tonight's incident, caught at
push time going forward instead of silently shadowing.

### Error handling

Fail closed: if a vault lookup errors for a key the script expects to find
there (missing entry, wrong password, vault unreachable), abort the deploy
with a clear message rather than pushing an empty or stale value. Matches
this repo's existing fail-closed convention (e.g.
`GatewayIntrospectionClient`'s "introspection is never skipped").

### Testing

No jest/pytest suite covers `create-secrets.sh` today (it's a deploy-time
shell script), and this design doesn't change that. Add a `--check`/`--dry-run`
mode to the modified value-resolution path that reports, per key, whether it
resolved from `.env` or vault — without pushing anything — used to verify the
one-time migration is complete before cutover, and as a repeatable sanity
check afterward.

## Migration

One-time move of every currently secret-shaped value, across all 7 `.env`
files, into the vault — using the existing `vault-migrate.js` tooling if its
current shape already supports this, extended if not (the implementation
plan reads its source before committing to exact steps, rather than assuming
behavior here). After migration, each `.env` file is trimmed to non-secret
lines only.

## Open questions for the implementation plan

- Exact secret-shaped name pattern (`*_SECRET|*_KEY|*_PASSWORD` plus an
  explicit allowlist) — enumerate precisely against all 7 `.env` files during
  planning, not assumed here.
- Whether the guard-rail (mismatched `.env` vs. vault value) warns or hard-fails
  the deploy — lean fail-closed per this repo's convention, confirm during
  planning.
