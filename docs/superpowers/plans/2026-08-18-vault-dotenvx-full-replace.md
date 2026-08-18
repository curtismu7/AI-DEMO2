# Vault → dotenvx Full Replacement — Implementation Plan (Approach B)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax. Execute tasks **in order** — Task 1 (relocate AEAD) unblocks the vault removal; the vault is deleted **last** (Task 8), after every consumer is off it. This supersedes the earlier `2026-08-18-vault-decoupling.md` (Approach A), which the operator did not select.

**Goal:** Replace the homegrown encrypted vault (`demo_api_server/lib/vault/`) entirely with `@dotenvx/dotenvx` for secret-at-rest + load-into-env, and **drop** the vault's four runtime-only features (admin rotate/unlock routes + UI, web unlock, tamper-evident audit log, runtime secret-write).

**Architecture:** Every service (BFF + agent + gateway + oauth-mcp) loads secrets by calling `@dotenvx/dotenvx`'s programmatic `config()` at startup against its own dotenvx-encrypted `.env`, then keeps its existing allowlist + fail-fast logic. Secrets at rest = ECIES-encrypted values committed in `.env`; the decryption key (`DOTENV_PRIVATE_KEY`) is supplied at runtime via the same channel `VAULT_PASSWORD` used. The `lib/vault` handle/format/audit and all vault plumbing are removed; the vault's AEAD primitives are **relocated** to a neutral module because two unrelated LMDB stores depend on them.

**Tech Stack:** Node ≥ 22; `@dotenvx/dotenvx` (BSD-3-Clause, 2.x, ECIES/secp256k1); node:crypto (retained AES-256-GCM helpers); jest / ts-jest / vitest; docker-compose + native `run.sh` + k8s.

**Spec:** self-contained; grounded in the vault ecosystem map (2026-08-18) and the drop-safety + dotenvx due-diligence report (2026-08-18). Decisions ratified by the operator: **Approach B (full replace), dotenvx, drop the 4 runtime features.**

## Global Constraints

- **Do not rotate live secret VALUES.** Re-encrypting an existing secret's storage into a dotenvx `.env` is fine; regenerating the value is not. (memory: `feedback-do-not-rotate-secrets`.)
- **No secret values in git, argv, or YAML.** dotenvx `.env` holds only ciphertext + the public key (committable); `.env.keys` (holding `DOTENV_PRIVATE_KEY`) stays gitignored; `DOTENV_PRIVATE_KEY` travels via env only, never argv/YAML. gitleaks pre-commit stays on.
- **HARD BLOCKER — keep the AEAD primitives.** `lib/vault/crypto.js` `aeadSeal`/`aeadOpen` are imported by `services/lmdb/delegatedCommerceStore.lmdb.js` and `services/lmdb/sdkDemoTokenStore.lmdb.js` (unrelated to secrets-at-rest). They MUST survive the vault removal — Task 1 relocates them to a neutral module. `deriveKek`/`hkdf`/argon2 are vault-only and go away.
- **Accepted capability loss:** the append-only tamper-evident audit log and vault rollback detection have **no dotenvx equivalent** and are being removed deliberately. This is a real reduction, accepted for a demo. Note it in the removal PR.
- **§1/§4 identity invariant.** The gateway and oauth-mcp must still receive **byte-identical** `PINGONE_MCP_GATEWAY_CLIENT_ID/SECRET` (REGRESSION_PLAN §4). Every service task asserts this.
- **Emoji allowlist** (`⚠️ ✅ ❌ 🔐 ✕ ✓ 👤 🔑 🪟 📚`) in any user-facing copy.

---

## 1. Diligence findings that shape this plan (2026-08-18)

- **Helix key — safe to drop the vault-write.** `configStore.getEffective('helix_api_key')` (`configStore.js:1457-1470`) independently falls back to `HELIX_API_KEY` env (`:1282`) and the `<agentName>.json` keyfile (`helixAgentKeyLoader.js`). The vault-write in `helixKeyMigration.js` is a persistence convenience, never the sole path. Static provisioning: dotenvx-encrypt `HELIX_API_KEY`.
- **Admin routes/UI, web unlock — safe to drop.** `routes/adminVault.js` + `demo_api_ui/src/components/AdminVaultPage.jsx` (routed `App.js:1259-1264`, nav `AdminSideNav.jsx:1014`) are operator plumbing, not a demo tile. `unlockVaultAtRuntime` is called only by the unlock route; no flow needs mid-process unlock once secrets load at process start.
- **Audit log — no external reader**; only internal `highestRecordedSeq()` rollback detection uses it, which dies with the vault. Accepted loss.
- **AEAD blocker** as above (Global Constraints).
- **dotenvx:** BSD-3-Clause, actively maintained (2.21.0, 0 known CVEs). Model: ECIES/secp256k1; `.env` = public key + ciphertext (committable), `.env.keys` = `DOTENV_PRIVATE_KEY` (gitignored). Programmatic `require('@dotenvx/dotenvx').config()` decrypts into `process.env` in-process (drop-in for `dotenv.config()`, already used in `demo_mcp_gateway/src/config.ts:3-4`). Selective encryption via `-K/--key` / `_PLAIN` suffix; programmatic `set()`/`parse()` exist for provisioning.

## 2. Target design

- **Secret at rest:** per-service dotenvx-encrypted `.env` (each service's `.env` holds only its allowlisted secrets, selectively encrypted; non-secret config stays plaintext). One `DOTENV_PRIVATE_KEY` per service at runtime (distinct per service; same delivery channel as `VAULT_PASSWORD` today).
- **Load path:** each service's `src/vault.ts` (rename → `src/secrets.ts`) calls `dotenvx.config()` then applies its existing prefix allowlist + fail-fast/log semantics. The BFF's `vaultLoader.js` is replaced by a dotenvx load + the existing `configStore` precedence (`.env` already wins over vault/LMDB, so this simplifies).
- **Source of truth:** the plaintext secrets at provisioning time (today's `.env`/keyfile/`setupFresh` inputs) → dotenvx-encrypted `.env` (committable) + `.env.keys` (gitignored). `setupFresh` swaps its `vault:create`/`vault:migrate` step for a `dotenvx encrypt` step.
- **Removed:** `lib/vault/{index,format,audit,errors}.js`; `services/vaultLoader.js`; the vault-write half of `helixKeyMigration.js`; `routes/adminVault.js` + `AdminVaultPage.jsx` + nav entry; `scripts/vault.js` + `scripts/vault-migrate.js` + their npm scripts; `setupFresh` vault step; the two CI argon2 install hacks; `secrets.vault` mount in compose.
- **Kept/relocated:** `aeadSeal`/`aeadOpen` → a neutral module (e.g. `demo_api_server/lib/aead.js`), imported by the two LMDB stores.

## 3. Tasks — each independently shippable, in order

### Task 1: Relocate the AEAD primitives out of `lib/vault` (unblocks removal)

**Files:**
- Create: `demo_api_server/lib/aead.js` (move `aeadSeal`, `aeadOpen` verbatim from `lib/vault/crypto.js`)
- Modify: `services/lmdb/delegatedCommerceStore.lmdb.js:5`, `services/lmdb/sdkDemoTokenStore.lmdb.js:18` (import from `../../lib/aead` instead of `../../lib/vault/crypto`)
- Modify: `lib/vault/crypto.js` (re-export the two helpers from `../aead` so the vault still works during transition — remove in Task 8)
- Test: `demo_api_server/tests/aead.test.js` (round-trip seal/open, bad-key/bad-tag rejection)

**Interfaces:**
- Produces: `aeadSeal(plaintext, key32) -> {iv,tag,ct}`, `aeadOpen({iv,tag,ct}, key32) -> Buffer` — exact current signatures.

- [ ] **Step 1:** Write `tests/aead.test.js` asserting round-trip + tamper rejection against `lib/aead`.
- [ ] **Step 2:** Run it — fails (module absent).
- [ ] **Step 3:** Create `lib/aead.js` with the two helpers moved verbatim; point the two LMDB stores at it; re-export from `lib/vault/crypto.js` for continuity.
- [ ] **Step 4:** Run `tests/aead.test.js` + the two LMDB stores' existing suites + `tests/vault/crypto.test.js` — all PASS.
- [ ] **Step 5:** Commit.

### Task 2: dotenvx-load one service end-to-end (agent) and drop its `lib/vault` require

**Files:**
- Modify: `demo_agent_service/package.json` (+`@dotenvx/dotenvx`)
- Rename/rewrite: `demo_agent_service/src/vault.ts` → dotenvx `config()` + existing `AGENT_|MCP_GW_|PROVIDER_|HELIX_|BFF_INTERNAL_` allowlist + fail-fast; supply `DOTENV_PRIVATE_KEY`, delete it from env after load
- Test: rewrite `demo_agent_service/tests/vault.test.ts` (no sibling require; a dotenvx-encrypted fixture), keep `vault.libUnavailable.test.ts` semantics as "decrypt unavailable/failed"

- [ ] Step 1: failing loader test (allowlist copies `AGENT_*`/`MCP_GW_*`, drops non-allowlisted, deletes key) with NO `require('../../demo_api_server/lib/vault')`.
- [ ] Step 2: run → fails.
- [ ] Step 3: implement dotenvx loader preserving allowlist + fail semantics.
- [ ] Step 4: run loader + libUnavailable tests → PASS.
- [ ] Step 5: run the FULL agent suite WITHOUT installing `demo_api_server` deps → PASS (proves coupling gone).
- [ ] Step 6: commit.

### Task 3: dotenvx-load `demo_mcp_gateway` (allowlist adds `PINGONE_|DEMO_`)

Same shape as Task 2. **Assert the §4 invariant:** the gateway still receives identical `PINGONE_MCP_GATEWAY_CLIENT_ID/SECRET`. **In this PR delete the CI argon2 step `.github/workflows/ci.yml:351-352`** (the gateway test no longer needs the sibling). Note: `config.ts:3-4` already imports plain `dotenv` — switch it to `@dotenvx/dotenvx`. Commit per sub-step.

### Task 4: dotenvx-load `oauth-mcp` (allowlist `MCP_GW_|PINGONE_|PROVIDER_|HELIX_|BFF_INTERNAL_`)

Same shape. **Assert §4:** oauth-mcp introspection client id/secret == gateway exchange client. Commit.

### Task 5: BFF secret loading onto dotenvx; retire `vaultLoader`'s vault path

**Files:**
- Modify: `demo_api_server/server.js` startup (replace `loadVaultIntoConfigStore` with a dotenvx `config()` load; keep the `configStore` precedence — `.env` already wins)
- Modify/retire: `services/vaultLoader.js` (remove the vault-open path; keep `filterVaultForReconcile` only if still referenced, else remove — it no-ops without a vault)
- Modify: `services/helixKeyMigration.js` — remove the `vault.set`/`vault.save` write; keep (or delete) the `configStore.setConfig` persistence. Helix key now resolves via env/keyfile fallback (verified). Ensure `HELIX_API_KEY` is in the BFF's dotenvx `.env`.
- Test: update `tests/vault/bff-startup.test.js`, `helixKeyMigration.test.js`, `configStore-precedence.test.js` to the dotenvx world (they currently assert vault behavior).

- [ ] Test-first each change; assert `BFF_INTERNAL_SECRET` still reaches `process.env` (now directly from the decrypted `.env`, so the old `ENV_EXPORT_ALLOWLIST` bridge is unnecessary — confirm internal-auth routes still read it). Commit per unit.

### Task 6: Remove the admin vault feature (routes + UI + nav)

**Files:**
- Delete: `demo_api_server/routes/adminVault.js`; unmount at `server.js:1431`
- Delete: `demo_api_ui/src/components/AdminVaultPage.jsx`; remove route `App.js:1259-1264`; remove nav `AdminSideNav.jsx:1014`
- Delete: `AdminVaultPage.test.jsx`, `tests/routes/adminVault.integration.test.js`, `adminVault.regression.test.js`
- Verify: `npm run authz:verify` (a removed admin route must not leave a dangling guard), UI build, `App.js` route guards consistent.

- [ ] Grep confirms no remaining reference to `/api/admin/vault` or `AdminVaultPage`. Commit.

### Task 7: Switch provisioning to dotenvx; remove the vault CLIs + setupFresh step

**Files:**
- Modify: `demo_api_server/scripts/refresh-service-envs.js` + `setupFresh.js` — generate each service's dotenvx-encrypted `.env` (selective `-K` on the true secrets) and per-service `.env.keys`; drop the `vault:create`/`vault:migrate` path.
- Delete: `scripts/vault.js`, `scripts/vault-migrate.js`; remove `vault:*` npm scripts from `package.json`.
- Modify: `.gitignore` — ensure `**/.env.keys` and per-service encrypted `.env` handling is correct; remove now-moot `secrets.vault*` ignores or leave as harmless.
- Docs: update `.env.example`, fix the `docker-compose.yml:290-291` "committed" comment (now truly N/A).

- [ ] Test: provisioning produces encrypted `.env` whose decrypted contents equal the intended per-service secret set; `.env.keys` never tracked; gitleaks clean. Commit.

### Task 8: Remove `lib/vault` and the audit log (LAST — after all consumers migrated)

**Files:**
- Delete: `lib/vault/index.js`, `lib/vault/format.js`, `lib/vault/audit.js`, `lib/vault/errors.js`. **Keep `lib/aead.js`** (Task 1). If `lib/vault/crypto.js` now only re-exports AEAD, delete it and repoint any stragglers to `lib/aead.js`.
- Delete: `tests/vault/*` that test the removed library (crypto/format/audit/integration/regression/golden/fixtures); keep `tests/aead.test.js`.
- Modify: `docker-compose.yml` — remove the `./secrets.vault:/secrets.vault:ro` mount (`:294`) and `VAULT_AUDIT_LOG_PATH`.
- Remove: `run.sh`/`run-docker.sh` `vault_preflight` (replace with a dotenvx decrypt preflight if a boot secret-check is wanted).

- [ ] Grep `demo_api_server/lib/vault` across the whole repo → **zero** runtime references. Full BFF suite green. Commit. **This PR carries the "audit-log capability removed" note.**

## 4. Risks & rollback

- **Staged & revertible.** The vault keeps working until Task 8; Tasks 2-7 add dotenvx alongside it. Each service task is an independent PR — revert one without the others.
- **Boot-without-secrets.** Keep per-service fail-fast when secrets are expected; add a dotenvx decrypt preflight to `run.sh`/`run-docker.sh` mirroring today's `vault_preflight`.
- **§4 identity drift** — Tasks 3-4 assert byte-identical gateway/oauth-mcp client id/secret.
- **Key custody.** `.env.keys` gitignored; `DOTENV_PRIVATE_KEY` per service via env only; gitleaks on.
- **Re-provisioning ≠ rotation.** Values copied from existing sources, not regenerated. State in each PR.
- **Audit-log loss** is intentional and irreversible once Task 8 lands — call it out for sign-off in that PR.

## 5. Verification (definition of done)

- `grep -rn "lib/vault" demo_api_server demo_agent_service demo_mcp_gateway oauth-mcp` → only `lib/aead.js` references remain; no `require('.../lib/vault')`.
- All four services boot (native + Docker) and load secrets via dotenvx; gateway + oauth-mcp receive identical PingOne client id/secret; Helix key resolves.
- Both CI argon2 install steps deleted; CI green.
- The two LMDB stores (`delegatedCommerceStore`, `sdkDemoTokenStore`) still encrypt/decrypt via `lib/aead.js`; their suites green.
- Admin vault page/route/nav gone; `authz:verify` + UI build green.
- TECH_DEBT entry flipped; the audit-log capability loss recorded.

## 6. Open decisions (mostly locked; confirm the last two)

1. Scope B, dotenvx, drop 4 features — **RATIFIED.**
2. **Per-service vs one shared encrypted `.env`?** Recommend per-service (least privilege; each gets only its secrets). Confirm.
3. **k8s:** the downstream services get no vault secrets under k8s today. Preserve that (k8s secret delivery is a separate follow-up), or add dotenvx there too? Recommend preserve.
