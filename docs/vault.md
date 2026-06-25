# Portable Encrypted Credential Vault

> Phase 269 — single-file, password-decrypted credential store for the
> Super Banking demo. Encrypted at rest, portable across machines, no
> recovery if you lose the password.

This document is the operator-facing reference for the vault. It covers
**why** the vault exists, **what** crypto choices it makes, **how** to
use the CLI, **what** happens if you forget the password (you re-provision —
there is no recovery), how CI runs it, how it behaves on Vercel (it
doesn't — Vercel uses Encrypted Environment Variables instead), the
threat model, and an FAQ for the corner cases that come up in practice.

If you're looking for the code, start at
[`banking_api_server/lib/vault/index.js`](../banking_api_server/lib/vault/index.js)
(library) and
[`banking_api_server/scripts/vault.js`](../banking_api_server/scripts/vault.js)
(CLI).

---

## Table of contents

- [Why a vault?](#why-a-vault)
- [Crypto choices](#crypto-choices)
- [File location](#file-location)
- [CLI usage](#cli-usage)
- [Migration from `.env`](#migration-from-env)
- [Recovery procedure (forgotten password)](#recovery-procedure-forgotten-password)
- [CI handling](#ci-handling)
- [Vercel](#vercel)
- [Threat model summary](#threat-model-summary)
- [Requirement coverage (REQ-VAULT-01..13)](#requirement-coverage)
- [FAQ](#faq)

---

## Why a vault?

This repo's demo runs on a developer laptop, gets cloned by other
developers, gets migrated between machines, and occasionally gets
demoed at conferences. The credentials that make it work — Helix API
keys, PingOne worker secrets, internal HMAC secrets — are not the same
shape as the demo *data* (which is mocked). They are real keys to real
external systems, and a leaked one can be expensive to rotate.

For years, the demo kept these in `banking_api_server/.env`. That works
on a single machine but creates three problems:

1. **`.env` is plaintext.** A casual `cat banking_api_server/.env` while
   sharing a screen leaks every value. There is no story for "show me
   the demo working without exposing my real Helix key."
2. **`.env` is hard to move.** Migrating a demo to a new laptop today
   requires `scp` of a plaintext file or copying through 1Password's
   individual-field editor — neither is great.
3. **`.env` has no integrity story.** A flipped byte in the file
   silently mis-configures the BFF; the operator finds out when the
   PingOne callback comes back with `invalid_client` an hour into the
   conference talk.

The vault fixes all three: contents are encrypted at rest with a
password, the file is portable across machines, and an integrity tag
(AES-256-GCM auth tag + whole-file HMAC) means a flipped byte fails
loudly instead of silently.

**The vault is OPTIONAL.** Existing `.env` workflows continue to work.
Phase 269 adds the vault as a *preferred* secret source; it does not
remove env vars. See the priority order under
[CLI usage → priority](#cli-usage) for the resolution chain.

---

## Crypto choices

These are the load-bearing primitives. Don't change them without
bumping the file-format `VERSION` field and writing a migration —
existing vault files were written with the parameters below and the
library refuses to open files written with anything else.

| Choice | Value | Why |
|---|---|---|
| **KDF** | Argon2id via `argon2` npm package (v0.44.0) | OWASP's current recommendation for password hashing. Memory-hard, side-channel-resistant, GPU-resistant. |
| **KDF parameters** | `memoryCost=65536` (64 MiB), `timeCost=3`, `parallelism=4`, `hashLength=32` | OWASP 2025 recommendation for a developer-laptop threat model. Hash time ~60-300ms; vault open runs once per startup so this cost is acceptable. |
| **AEAD cipher** | AES-256-GCM via `node:crypto.createCipheriv` | Native, audited, used elsewhere in this codebase (`services/configStore.js`). No new heavy dep. 12-byte IV + 16-byte auth tag. |
| **Per-entry DEK** | 32 random bytes from `crypto.randomBytes`, AES-256-GCM wrapped under the KEK | "Per-entry sealing" — adding entry C does not touch the bytes of A and B. Rotating the password re-wraps DEKs; entry value ciphertexts are unchanged. |
| **File integrity** | HMAC-SHA256 over canonical JSON, with HKDF-derived sub-key from KEK + info=`'fileHmac/v1'` | Catches structural tampering between entries (swapped IVs, deleted entries) that per-entry GCM tags would miss. |
| **File magic + version** | ASCII `BNKV` + integer `1` | Allows future format migrations to be detected and rejected with a clear "this vault was written by a newer CLI; upgrade" instead of an opaque AEAD failure. |
| **Atomic writes** | `fs.writeFile(tmp, ...); fs.rename(tmp, final)` with `mode: 0o600` | Crash mid-write leaves the original vault untouched. Same pattern as `data/store.js` `_atomicWrite`. |

These are NOT configurable at runtime. The Argon2 params are
`Object.freeze`'d in [`lib/vault/crypto.js`](../banking_api_server/lib/vault/crypto.js)
specifically so they cannot drift via `process.env.FOO || 65536` patterns.

### Alternatives considered (and rejected)

| Instead of | We could have used | Why we didn't |
|---|---|---|
| AES-256-GCM | XChaCha20-Poly1305 | Node's built-in `chacha20-poly1305` is the 12-byte-nonce IETF variant, not XChaCha20. Getting the 24-byte-nonce variant requires `@noble/ciphers` or `libsodium-wrappers` — a new dep. With per-entry fresh DEKs, GCM's 12-byte random nonce is comfortably safe. |
| Argon2id | scrypt | scrypt is in `node:crypto` core (no extra dep) but Argon2id is the OWASP recommendation and the only KDF with side-channel-resistant tuning across memory + time + parallelism. The phase explicitly chose Argon2id. |
| JSON envelope | Custom binary format | Binary is ~30% smaller but breaks `git diff`, breaks `cat`, breaks the human-grep "is this thing the right shape?" debugging story. JSON wins on tooling compatibility for a single-file portable format. |
| Per-entry DEK | One global key over all entries | Adding an entry would require re-encrypting every other entry. Per-entry DEKs make adds/removes O(1). |

---

## File location

**Default:** `<repo-root>/secrets.vault`

**Override:** `VAULT_PATH=/etc/banking/secrets.vault` (env var) or
`--vault-path /path` (setupFresh CLI).

`.gitignore` already covers `secrets.vault`, `secrets.vault.tmp`, and
`secrets.vault.audit.log` — see lines 56+ of the root `.gitignore` (the
patterns were added in Phase 269 Plan 01).

### Why the repo root and not `~/.config/super-banking/`?

The phase requirement is "portable across machines." A repo-root file
moves with the repo when you `git pull` on a new laptop (after
separately copying the encrypted vault file). A `~/.config/`-style file
is per-user and gets lost during machine migrations. The vault
file *itself* is encrypted at rest, so committing it accidentally is
recoverable (rotate the password, force-push a history rewrite — but
note that `.gitignore` is the primary defense).

### File permissions

The library writes the vault with `mode: 0o600` (owner read/write
only). On a multi-user host, you can verify with:

```bash
ls -l <repo-root>/secrets.vault
# -rw------- ... secrets.vault
```

If the mode is wider (e.g. `0o644`), other local users can read the
encrypted file. They still can't decrypt without the password, but it's
a defense-in-depth weakness. Fix with `chmod 600 secrets.vault`.

---

## CLI usage

All commands run from `banking_api_server/`:

| Command | What it does | Reads stdin? | Writes value to stdout? |
|---|---|---|---|
| `npm run vault:create` | Create an empty vault. Fails if file already exists. | no (never) | no |
| `npm run vault:set <NAME>` | Set/overwrite an entry. Prompts for value (or reads from stdin). | yes (TTY prompt or piped value) | no |
| `npm run vault:get <NAME>` | Print decrypted value to stdout (pipe-friendly). | no | yes (value + `\n`) |
| `npm run vault:list` | Print entry names, one per line. NEVER values. | no | yes (names) |
| `npm run vault:delete <NAME>` | Remove an entry. | no | no |
| `npm run vault:rotate` | Rotate the vault password. Re-wraps all DEKs; entry ciphertexts unchanged. | no | no |
| `npm run vault:migrate-from-env` | Copy selected `.env` secrets into the vault (closed allowlist). See [Migration](#migration-from-env). | no | no |

### Password supply (T-269-06)

The CLI accepts the vault password in two ways:

1. **`VAULT_PASSWORD` env var** — for CI, scripts, or interactive shells
   where you've `export VAULT_PASSWORD=...` once per session. Logged with
   a `⚠️` notice when used non-interactively so it can't be missed.
2. **Interactive TTY prompt** — masked (no echo), via `@inquirer/password`.

After `openVault` / `createVault` returns, the CLI immediately
`delete`s `process.env.VAULT_PASSWORD` to shrink the `/proc/<pid>/environ`
exposure window from "process lifetime" to "~50ms during startup."

### Stdout discipline (T-269-11)

Only `vault:get` (decrypted value + `\n`) and `vault:list` (entry names,
one per line) write to stdout. Banners, warnings, success messages, and
errors all go to **stderr**. This makes `vault:get` pipe-clean:

```bash
export HELIX_API_KEY="$(npm run --silent vault:get HELIX_API_KEY)"
```

### Exit codes

| Code | Meaning |
|---|---|
| 0  | Success |
| 1  | Generic error (missing password, file already exists, password mismatch on rotate) |
| 2  | Entry not found |
| 3  | Auth failed / tampered file (opaque — does NOT distinguish bad password vs corrupt file) |
| 4  | Vault file not found |
| 64 | Unknown subcommand (sysexits `EX_USAGE`) |

### Resolution priority (which secret wins?)

When the BFF or MCP Gateway needs a secret at startup, the resolution
order is:

1. **Vault** (`lib/vault.openVault` reads it at startup, copies into
   in-memory configStore cache with `{persist: false}`) — wins when
   `secrets.vault` exists AND `VAULT_PASSWORD` is set.
2. **`process.env`** — used directly when the vault has no entry for
   the requested key, or when no vault file exists.
3. **`configStore` LMDB** — encrypted at rest with `SESSION_SECRET`;
   used as a fallback for values written via `/setup` or `/admin`.

The vault NEVER overrides values that are explicitly set in `process.env`
*after* vault load — the loader writes to the in-memory cache, not back
to env vars. This makes per-test `process.env.X = 'override'` patterns
continue to work even when a vault is present.

---

## Migration from `.env`

`npm run vault:migrate-from-env` is a one-shot migration tool. It reads
selected secrets from `process.env` (typically loaded via the BFF's
existing dotenv chain) and copies them into the vault.

### Closed allowlist

ONLY these names are migrated. Adding new entries requires a code
change to `banking_api_server/scripts/vault-migrate.js` `ALLOWED_ENV_VARS`:

```
HELIX_API_KEY
PINGONE_ADMIN_CLIENT_SECRET
PINGONE_AI_CORE_CLIENT_SECRET
PINGONE_AI_AGENT_CLIENT_SECRET
PINGONE_MCP_TOKEN_EXCHANGER_CLIENT_SECRET
MCP_GW_CLIENT_SECRET
BFF_INTERNAL_SECRET
CONFIG_ENCRYPTION_KEY
SESSION_SECRET
```

This is the [T-269-23](#threat-model-summary) mitigation: an attacker
who manages to set `LD_PRELOAD` or `NODE_OPTIONS` in your shell cannot
trick the migrate script into copying those into the vault.

### Flags

| Flag | Effect |
|---|---|
| `--dry-run` | Print what WOULD be copied; do not write to the vault |
| `--force` | Overwrite vault entries that already exist (default: skip) |
| `--vault <path>` | Override `VAULT_PATH` env var |

### Sample run

```bash
$ export VAULT_PASSWORD="<your-strong-passphrase>"
$ npm run vault:migrate-from-env -- --dry-run
[migrate-dry] would copy HELIX_API_KEY (length=64 chars)
[migrate-dry] would copy PINGONE_ADMIN_CLIENT_SECRET (length=48 chars)
[migrate] skipping MCP_GW_CLIENT_SECRET (not set in env)
---
[migrate] would copy 2 entries; skipped 0 (already in vault); skipped 7 (not set in env)
```

NOTE: the migrate script NEVER prints the *value* — only the name and
character length. (See [T-269-21](#threat-model-summary).)

### Why no `--remove-from-env` flag?

DELIBERATELY missing. The operator must edit `.env` manually after
verifying the vault contains everything they expect. A half-edited
`.env` is worse than no edit at all — if migration partially fails and
the script auto-deletes the originals, you've lost the only working
copy of the secrets.

---

## Recovery procedure (forgotten password)

⚠️ **There is no password recovery. This is by design.**

A forgotten vault password means the vault is gone. The documented
procedure:

1. Delete `secrets.vault` and `secrets.vault.audit.log`.
2. For each entry that was in the vault, re-provision it from its
   source:
   - `HELIX_API_KEY` → log into the Helix console, issue a new agent
     key, paste into the new vault via `npm run vault:set HELIX_API_KEY`.
   - `PINGONE_ADMIN_CLIENT_SECRET` → log into PingOne, regenerate the
     worker app's secret on the app's Configuration tab, paste into
     the new vault.
   - `MCP_GW_CLIENT_SECRET`, `PINGONE_AI_*_CLIENT_SECRET` → same:
     regenerate in PingOne, paste into the new vault.
   - `SESSION_SECRET`, `CONFIG_ENCRYPTION_KEY` → these are local-only;
     regenerate with `openssl rand -hex 32` and paste. NOTE: rotating
     `SESSION_SECRET` invalidates the encrypted `config.db` at rest —
     you'll need to re-run `setupFresh` or manually re-enter the
     PingOne config.
3. Restart all services (`./run-demo.sh restart`) so the new vault is
   read on next BFF startup.

The CLI prints this warning before any operation that can change the
"what you need to open the vault" (create, set, rotate):

```
⚠️  There is no password recovery. Lose this password and the vault must be
   rebuilt from source secrets (regenerate Helix key, worker secrets, etc.).
```

**No `--admin-recover` flag exists. No `--reset` flag exists. Reject on
sight any PR that adds one.** A recovery backdoor instantly devalues
the vault.

---

## CI handling

CI runners are single-tenant by design — env vars are not exposed to
other PIDs on the same host, so `VAULT_PASSWORD` in the env is fine
there.

### Pattern: vault built in CI, secrets injected from secret store

```yaml
# .github/workflows/deploy.yml (example)
- name: Create vault for deployment
  env:
    VAULT_PASSWORD: ${{ secrets.VAULT_PASSWORD }}
    HELIX_API_KEY: ${{ secrets.HELIX_API_KEY }}
    PINGONE_ADMIN_CLIENT_SECRET: ${{ secrets.PINGONE_ADMIN_CLIENT_SECRET }}
  run: |
    cd banking_api_server
    npm run vault:create
    npm run vault:migrate-from-env
```

### setupFresh.js fail-fast contract (Phase 269 Plan 05 Task 3)

`npm run setup:fresh` invokes the vault setup phase between bootstrap
and Helix. It REFUSES to prompt for the vault password interactively —
Node's built-in readline does not mask password input safely on
`/dev/tty` across all terminals (see [`scripts/setupFresh.js`](../banking_api_server/scripts/setupFresh.js)
`readlineFreeText` comment around line 905 for the historical
rationale).

The operator MUST supply the password one of three ways:

1. `npm run setup:fresh -- --vault-password <pw>` — visible in
   `/proc/<pid>/cmdline` while setup runs (~30s). [T-269-27](#threat-model-summary)
   tradeoff is documented and accepted.
2. `export VAULT_PASSWORD=...; npm run setup:fresh` — env var
   is per-process, not visible in other PIDs' cmdline. PREFERRED on
   shared machines.
3. `npm run setup:fresh -- --skip-vault` — skip the vault setup phase
   entirely. The demo continues to work via `.env` values.

If neither `--vault-password` nor `VAULT_PASSWORD` is set in
**interactive** mode, setupFresh fails fast with a clear error:

```
✗ No vault password supplied. Pass --vault-password <pw> or set
  VAULT_PASSWORD env, otherwise use --skip-vault.
```

In **non-interactive** (CI) mode without those, setupFresh silently
skips the vault phase — matches the `--skip-helix` non-interactive
behavior.

---

## Vercel

The vault is local-dev + self-hosted only. **On Vercel deployments, the
vault load is SKIPPED entirely.**

The loader checks `process.env.VERCEL === '1'` at startup and
short-circuits before any FS access:

```
[vault] Vercel environment detected — skipping vault load (use Encrypted Environment Variables)
```

### Why?

Vercel has no persistent filesystem — `secrets.vault` would have to be
bundled into the deployment artifact, which means it ships with the
code. That's a different threat model: anyone with the build artifact
+ the deployer's `VAULT_PASSWORD` has every secret. Vercel's standard
pattern is **Encrypted Environment Variables** in the project's
Settings page; the BFF already reads from `process.env` so no code
change is needed.

If a future deploy target requires a vault file, bundling-with-rotation
is technically possible — but re-research the threat model before
adopting. See [Plan 04 SUMMARY](../.planning/phases/269-portable-encrypted-credential-vault-single-file-store-for-ap/269-04-SUMMARY.md)
for the gateway's identical bypass.

---

## Threat model summary

These are the threats considered during Phase 269 planning and the
mitigation status. See each plan's `<threat_model>` block for the
detailed STRIDE register.

| ID | Category | Description | Mitigation status | Plan |
|---|---|---|---|---|
| T-269-01 | Spoofing | Offline brute-force of vault password | **mitigated** — Argon2id m=64MiB/t=3/p=4; ~100× slower than scrypt, ~10⁴× slower than SHA-256 | 01 |
| T-269-02 | Tampering | Nonce reuse | **mitigated** — `crypto.randomBytes(12)` for every GCM IV; per-entry fresh DEK | 01 |
| T-269-03 | Tampering | Flipped byte in entry ciphertext | **mitigated** — GCM auth tag catches every byte flip | 01 |
| T-269-04 | Information disclosure | "Recovery" backdoor | **mitigated** — no recovery; documented "lose password = re-provision"; CLI warns before create/set/rotate | 01, 02 |
| T-269-05 | Tampering | Structural change between entries (swapped IVs) | **mitigated** — whole-file HMAC over canonical JSON | 01 |
| T-269-06 | Information disclosure | `VAULT_PASSWORD` leak via `/proc/<pid>/environ` | **mitigated** — `delete process.env.VAULT_PASSWORD` immediately after open | 01, 02, 03, 04 |
| T-269-07 | Side-channel | Timing attack on tag compare | **mitigated** — `node:crypto` GCM tag verification is constant-time; file-HMAC uses `crypto.timingSafeEqual` | 01 |
| T-269-08 | Information disclosure | KEK lifetime longer than needed | **mitigated** — `vault.close()` zeroes KEK and all DEK buffers; called in finally blocks at every consumer | 01, 03, 04 |
| T-269-09 | Information disclosure | Wrong-password vs tampered-file oracle | **mitigated** — opaque error message `vault: open failed (bad password or tampered file)`; loaders log only `err.message`, never `err.stack` | 01, 03 |
| T-269-10 | Information disclosure | Audit log leaks values | **mitigated** — `audit.js` cannot see decrypted values (no require on `./crypto` or `./format`); strict 4-field schema; grep test asserts | 01 |
| T-269-11 | Information disclosure | Banners or success messages on stdout pollute `vault:get` pipes | **mitigated** — stdout discipline: only `vault:get` and `vault:list` write to stdout; everything else stderr | 02 |
| T-269-12 | Tampering | CLI accepts arbitrary entry names | **mitigated** — `NAME_RE = /^[A-Z_][A-Z0-9_]*$/` enforced in `vault.set` | 01, 02 |
| T-269-13 | Information disclosure | Value typed interactively visible on screen | **mitigated** — `@inquirer/password` masks both password AND value prompts in `vault:set` | 02 |
| T-269-14 | Misconfiguration | Vault file exists + `VAULT_PASSWORD` absent silently falls back to weaker config | **mitigated** — BFF and gateway fail fast (exit 1 BEFORE port bind) | 03, 04 |
| T-269-15 | Configuration | Vercel accidentally bundles a vault | **mitigated** — loader short-circuits when `VERCEL=1`; documented bypass | 03, 04 |
| T-269-16 | Tampering | server.js / index.ts diff breaks session / OAuth / HITL | **mitigated** — minimal-diff (21-line whitespace-ignored diff); 38/38 critical regression suite green after wiring | 03, 04 |
| T-269-17 | Tampering | Attacker writes vault entry with `LD_PRELOAD` or `NODE_OPTIONS` | **mitigated** — gateway allowlist regex `/^(MCP_GW_|PROVIDER_|HELIX_|BFF_INTERNAL_)[A-Z0-9_]+$/` blocks system env names | 04 |
| T-269-18 | Information disclosure | Allowlist-prefix lowercase entry | **mitigated** — vault library NAME_RE is uppercase-only; gateway regex also requires uppercase | 04 |
| T-269-19 | Tampering | Gateway depends on argon2 transitively but doesn't declare it | **mitigated** — argon2 resolves via parent-walk through `banking_api_server/node_modules`; verified at runtime + documented in Plan 04 SUMMARY | 04 |
| T-269-20 | Information disclosure | Gateway error path leaks Argon2/KEK/DEK via stack trace | **mitigated** — only `err.message` logged, never `err.stack`; grep test asserts | 04 |
| T-269-21 | Information disclosure | Migration logs the secret value | **mitigated** — migration logs ONLY name + length (`copied HELIX_API_KEY (length=64 chars)`); sentinel-grep test asserts | 05 |
| T-269-22 | Tampering | Accidental overwrite of vault entry on re-run | **mitigated** — default behavior SKIPS when entry exists; `--force` flag required | 05 |
| T-269-23 | Spoofing | Migration accepts arbitrary env var name | **mitigated** — closed `ALLOWED_ENV_VARS` allowlist of 9 specific names; arbitrary `MY_RANDOM` / `LD_PRELOAD` ignored | 05 |
| T-269-24 | Information disclosure | Docs leak placeholders that look real | **mitigated** — all examples use obvious placeholders (`<your-strong-passphrase>`, `s3cret-place-holder`, `xxxx...xxxx`); no real-looking tokens | 05 |
| T-269-25 | Tampering | REGRESSION_PLAN edit silently changes existing rows | **mitigated** — edit is APPEND-ONLY to §1 table; `git diff REGRESSION_PLAN.md \| grep "^-" \| wc -l` returns 0 | 05 |
| T-269-26 | Information disclosure | setupFresh leaks vault password via interactive typing | **mitigated** — `configureVault()` REFUSES to prompt interactively; fail-fast with clear error if no `--vault-password` and no `VAULT_PASSWORD` env in interactive TTY mode | 05 |
| T-269-27 | Information disclosure | `--vault-password` argv visible in `/proc/<pid>/cmdline` | **accepted** — documented tradeoff; operators on shared machines should prefer `export VAULT_PASSWORD=...` (per-process, not visible to other PIDs); CLI `--help` warns | 05 |
| T-269-28 | Tampering | Vault created but secrets NOT migrated → two sources of truth | **mitigated** — `vault:migrate-from-env` runs IMMEDIATELY after `vault:create` in setupFresh; migrate failure fails the whole phase with exit 1 (no half-state) | 05 |
| T-269-29 | Denial of service | Re-run of setupFresh prompts again and overwrites existing vault | **mitigated** — `configureVault` detects existing vault file at the configured path and skips creation; logs `vault present at <path> — skipping creation` | 05 |
| T-269-30 | Tampering | `vault:create` silently overwrites an existing vault | **mitigated** — `cmdCreate` checks `fs.existsSync` BEFORE prompting for password; refuses with exit 1 and an explicit error | 02 |

---

## Requirement coverage

Each Phase 269 requirement (REQ-VAULT-01..13) is satisfied as follows:

| REQ | Description | Where satisfied |
|---|---|---|
| **REQ-VAULT-01** | Cipher choice + justification | `lib/vault/crypto.js` aeadSeal/aeadOpen (AES-256-GCM); this doc "Crypto choices" |
| **REQ-VAULT-02** | KDF + parameters | `lib/vault/crypto.js` `KDF_PARAMS` (Object.freeze'd) |
| **REQ-VAULT-03** | File format / envelope | `lib/vault/format.js` parseEnvelope + canonicalJson + computeFileHmac |
| **REQ-VAULT-04** | Vault location + discovery | `<repo-root>/secrets.vault`; `VAULT_PATH` override; this doc "File location" |
| **REQ-VAULT-05** | CLI shape (create/get/set/list/delete/rotate) | `scripts/vault.js` 6 subcommands + this doc "CLI usage" |
| **REQ-VAULT-06** | Forgotten-password recovery procedure | This doc "Recovery procedure" — re-provision; no backdoor |
| **REQ-VAULT-07** | Audit trail format | `lib/vault/audit.js` NDJSON, plaintext metadata, never values |
| **REQ-VAULT-08** | MCP Gateway integration | `banking_mcp_gateway/src/vault.ts` + `src/index.ts` IIFE wiring (Plan 04) |
| **REQ-VAULT-09** | BFF integration | `banking_api_server/services/vaultLoader.js` + `server.js` IIFE wiring (Plan 03) |
| **REQ-VAULT-10** | CI / non-interactive password handling | `VAULT_PASSWORD` env var; setupFresh fail-fast contract |
| **REQ-VAULT-11** | Vercel / serverless treatment | `VERCEL=1` short-circuits load (Plans 03 + 04) |
| **REQ-VAULT-12** | Test strategy + golden files | `tests/vault/` — 112+ tests, 2 golden fixtures (valid + corrupted-v1) |
| **REQ-VAULT-13** | Validation Architecture (Nyquist) | `269-VALIDATION.md` per-task verification map; critical regression suite green |

---

## FAQ

### Q: What if I forget the password?

A: **There is no recovery.** See [Recovery procedure](#recovery-procedure-forgotten-password).
Delete the vault, re-provision each entry from its source system
(Helix console, PingOne console, etc.), restart services.

### Q: Can I commit `secrets.vault` to git?

A: Not by default — the root `.gitignore` lists `secrets.vault`,
`secrets.vault.tmp`, and `secrets.vault.audit.log` to prevent
accidental commits.

If you intentionally want to commit an encrypted vault for cross-machine
transport (e.g. to your private deploy repo), you *can* — the contents
are AES-256-GCM-encrypted and useless without the password. But:

- Treat the password as a separate secret with its own rotation cadence.
- Anyone with `git log` history + the password has every secret. If the
  password leaks, rotate every entry in the vault AND force-push history
  rewrite to remove the vault file from git's object database.

The `.gitignore` rule is the primary defense. Override deliberately.

### Q: Does `VAULT_PASSWORD` show up in `ps` or `/proc/<pid>/environ`?

A: Only for ~50ms during startup. After `openVault` or `createVault`
returns successfully, the BFF / gateway / CLI immediately calls
`delete process.env.VAULT_PASSWORD`. A `ps auxe` or `/proc/<pid>/environ`
read after that point shows `VAULT_PASSWORD` is gone.

The `--vault-password <pw>` flag to `setupFresh` IS visible in
`/proc/<pid>/cmdline` for the lifetime of the setup process (~30s).
On shared machines prefer `export VAULT_PASSWORD=...` before running
setup:fresh — env vars are per-process and not exposed to other PIDs.

### Q: Why doesn't `setup:fresh` prompt me for the vault password interactively?

A: Node's built-in `readline` does not mask password input on a fresh
`/dev/tty` stream reliably — see
[`scripts/setupFresh.js`](../banking_api_server/scripts/setupFresh.js)
`readlineFreeText` comment around line 905 for the historical
tradeoff. Rather than risk a visible-typing leak (T-269-26), setupFresh
requires the password explicitly via `--vault-password <pw>` or
`VAULT_PASSWORD` env. Use `--skip-vault` if you do not want vault
setup right now.

### Q: What happens if I rotate `SESSION_SECRET` while the vault exists?

A: The vault is **independent** of `SESSION_SECRET`. The vault has its
own password and its own at-rest encryption (Argon2id KEK).

The configStore's encrypted LMDB at-rest layer IS keyed by
`SESSION_SECRET`, but vault entries are loaded with `{persist: false}`
in the BFF startup wiring — they're never written to LMDB. So
rotating `SESSION_SECRET` does not break the vault.

You will, however, need to recover or re-enter any configStore values
that *were* persisted to LMDB (e.g. values entered via `/setup` or
`/admin`). That's an existing constraint of `SESSION_SECRET` rotation
and not new in Phase 269.

### Q: Can the UI access vault contents?

A: No. The BFF is the sole consumer of the vault. Vault values land in
the in-memory configStore cache and are exposed via the existing
configStore API (which already lives behind admin-auth where it
matters). The SPA never sees vault contents directly.

### Q: What about argon2 native-build failures on fresh CI runners?

A: `argon2` is a node-gyp native package — fresh installs need a
working toolchain (Xcode CLT on macOS, build-essentials on Linux). On
machines without that toolchain, `npm install` produces a confusing
build failure. The fallback is `@node-rs/argon2` (Rust binding, no
node-gyp), but that path is documented and not currently wired — open
an issue if you hit this.

### Q: Why is the audit log plaintext?

A: The audit log is *metadata* about access (when, by whom, to what
name) — not the secret values themselves. The whole point of an audit
log is that it's readable without the password. If it were encrypted
with the vault password, anyone debugging a `bad_password` failure
couldn't see prior `open` events, defeating the point.

The audit log writer module (`lib/vault/audit.js`) deliberately does
NOT require `./crypto` or `./format` — it has no path to decrypted
values, enforced by module boundaries. A grep test in `tests/vault/audit.test.js`
asserts that decrypted byte sequences never appear in any audit line.

### Q: How do I rotate the vault password?

A:

```bash
export VAULT_PASSWORD="<current-password>"
export VAULT_NEW_PASSWORD="<new-password>"
npm run vault:rotate
```

In interactive mode, omit `VAULT_NEW_PASSWORD` and the CLI will prompt
for the new password (double-confirm).

The rotate operation **re-wraps every DEK** with a new KEK derived
from the new password. Entry value ciphertexts are UNCHANGED — rotation
is fast and does not touch the bulk of the file.

### Q: Can I have multiple vaults on the same machine?

A: Yes — use `VAULT_PATH=/path/to/other.vault` to point at a different
file. The BFF reads exactly one vault per startup, picked by
`VAULT_PATH` env or the `<repo-root>/secrets.vault` default.

If you need both a "personal dev" vault and a "shared demo" vault on
the same machine, swap between them by setting `VAULT_PATH` in your
shell session before starting services.

---

## Runtime unlock and rotate via /admin/vault

Phase 269.1 adds a web admin surface for unlocking and rotating the
vault **without restarting the BFF**. The CLI (`npm run vault:rotate`)
remains the simpler option when restart is acceptable; the web routes
exist for the hosted-demo case where restart causes user-visible
downtime, or when the operator only has a browser handy.

### When to use the CLI vs. /admin/vault

- **Use the CLI (`npm run vault:rotate`)** when you can restart the BFF
  — simpler, fewer moving parts, and the resulting `VAULT_PASSWORD` env
  is what the next BFF startup already expects.
- **Use `/admin/vault`** when you must rotate without downtime, OR when
  the operator only has browser access to the running BFF (e.g. a
  remote conference demo machine).

### Prerequisites

- Admin login session (PingOne-authenticated session OR a token bearing
  the `banking:admin` scope). The routes are mounted under
  `app.use('/api/admin/vault', authenticateToken, require('./routes/adminVault'))`
  at `banking_api_server/server.js:899` and every handler runs the
  `requireAdmin` middleware.
- Vault file present at `VAULT_PATH || <repo-root>/secrets.vault`.
- Not running on Vercel — see the "Vercel" section above. `/admin/vault`
  routes return 503 `{error:"vault_disabled_serverless"}` when
  `process.env.VERCEL === '1'`.

### Endpoint reference

| Method + Path | Status | Body (success) | Notes |
|---|---|---|---|
| `GET  /api/admin/vault/status` | 200 | `{unlocked, entriesLoaded, vaultFilePresent, vaultPath}` | `vaultPath` is `path.basename(...)` only — full path never leaks (T-269.1-09) |
| `GET  /api/admin/vault/status` | 401 / 403 / 503 | error envelope | unauth / non-admin / Vercel |
| `POST /api/admin/vault/unlock` | 200 | `{ok:true, entriesLoaded:N}` | password NEVER echoed in the response (T-269.1-08) |
| `POST /api/admin/vault/unlock` | 401 | `{error:"unauthorized", message:"vault: open failed (bad password or tampered file)"}` | byte-identical message for `VaultAuthError` AND `VaultIntegrityError` — no enumeration oracle (T-269.1-10) |
| `POST /api/admin/vault/unlock` | 404 | `{error:"vault_file_not_found"}` | vault file absent |
| `POST /api/admin/vault/unlock` | 429 | `{error:"too_many_requests"}` + `Retry-After` header | rate limit — 5 attempts / 5 min keyed by `req.user.sub` |
| `POST /api/admin/vault/rotate` | 200 | `{ok:true, message:"Vault password rotated. Update VAULT_PASSWORD before next BFF restart."}` | |
| `POST /api/admin/vault/rotate` | 400 | `{error:"bad_request"\|"weak_password"\|"same_password"}` | `newPassword` length < 12, or equals `currentPassword` |
| `POST /api/admin/vault/rotate` | 401 | opaque-same-as-unlock | wrong `currentPassword` — `rotate` re-opens the vault with `currentPassword` BEFORE re-wrapping DEKs (defense-in-depth, T-269.1-05) |
| `POST /api/admin/vault/rotate` | 409 | `{error:"rotate_in_progress"}` | module-scoped `rotateInProgress` mutex held by a concurrent call (T-269.1-06) |
| `POST /api/admin/vault/rotate` | 423 | `{error:"vault_locked"}` | `isVaultUnlockedThisProcess() === false` — must unlock first |
| `POST /api/admin/vault/rotate` | 503 | `{error:"vault_disabled_serverless"}` | Vercel guard |

### UI workflow

1. Navigate to `https://api.ping.demo:4000/admin/vault` (or your configured
   host — see CLAUDE.md non-negotiable #5).
2. The page renders three sections: a status card, an unlock form, and
   a rotate form.
3. **Unlock:** type the current password, submit. On success the banner
   reports `Vault unlocked (N entries loaded)` and the status card
   flips `unlocked` from ❌ to ✅.
4. **Rotate:** requires the vault to be unlocked first. Type the
   current password, then the new password twice. On success the banner
   restates the post-rotate env-var warning verbatim.

### Audit trail

Every unlock and rotate writes one NDJSON line to
`<vaultPath>.audit.log` via `lib/vault/audit.js`'s 4-field allowlist
(`op`, `key`, `result`, `caller`). The web routes set `caller:"adminVault"`;
the CLI sets `caller:"vault.js"`. Both rotate-via-CLI and rotate-via-web
therefore appear in the same audit log, distinguished by the `caller`
field for forensic clarity. The audit allowlist physically cannot leak
the password (T-269.1-03).

### Rate limit on unlock

`POST /api/admin/vault/unlock` is throttled to **5 attempts per 5-minute
window per admin session sub** via `express-rate-limit`. The 6th
attempt returns 429 with a `Retry-After` header before the handler
calls `unlockVaultAtRuntime` (so Argon2id is not burned on attempts
that will be rejected anyway). Wait 5 minutes or rotate from a
different admin session to reset.

### Mutex on rotate

`POST /api/admin/vault/rotate` is serialized via a module-scoped
`rotateInProgress` boolean set/cleared in `try/finally`. Two
simultaneous rotate calls → one returns 200, the other returns 409
`rotate_in_progress`. The human retries (this is a single-process demo
BFF; if you need multi-process rotate coordination, that's a different
architecture).

### CSRF posture

The `/api/admin/vault/*` routes inherit the project-wide BFF CSRF
defense: httpOnly session cookie + sameSite=none in production /
sameSite=lax in development + admin PingOne JWT or scope check on
every handler + JSON content-type preflight (browsers refuse
cross-origin POST with JSON body without a CORS preflight that fails
without a proper `Origin`) + no CSRF token middleware. This is the
existing project posture across all `/api/admin/*` routes (see
`banking_api_server/server.js` session cookie config and the admin
route mount pattern at line 896). T-269.1-02 disposition: accept
(existing posture); no new CSRF surface introduced.

### MCP Gateway desync caveat (T-269.1-07)

Phase 269.1's runtime rotate ONLY changes the BFF's view of the vault.
The MCP Gateway (`banking_mcp_gateway`) loads the vault at ITS OWN
startup using ITS OWN `VAULT_PASSWORD` env. After a web-rotate, the
gateway is still operating on the OLD password in its env; on the next
gateway restart it WILL fail to open the vault with
`[gw-vault] startup load failed`.

⚠️ **Operator workflow after a successful /admin/vault rotate:**

1. Confirm the web banner success: *"Vault password rotated"*.
2. Update `VAULT_PASSWORD` in every BFF env AND every gateway env
   — see the "After rotating: update VAULT_PASSWORD before next
   restart" checklist below.
3. Restart the MCP Gateway: `./run-demo.sh stop && ./run-demo.sh`
   (or just the gateway service if you have selective restart wired up).

The gateway does **not** have a `/admin/vault` equivalent in this
phase — it's intentionally out of scope. The gateway is a small,
restart-tolerant service and adding an admin web surface to it has
diminishing returns relative to the operator-facing complexity it
would add.

---

## After rotating: update VAULT_PASSWORD before next restart

⚠️ **This is the single most important post-rotate step. Read it.**

After `POST /api/admin/vault/rotate` returns 200, the vault FILE on
disk is encrypted with the NEW password but the BFF's startup
environment still has the OLD `VAULT_PASSWORD`. The next BFF restart
will fail-fast with:

```
[vault] startup load failed; refusing to start.
```

The web UI banner restates this verbatim — it is not a stylistic
warning, it is the failure mode you will hit if you ignore it.

### Update VAULT_PASSWORD everywhere the BFF + gateway might read it

After a successful rotate, update `VAULT_PASSWORD` in every place that
might run the BFF or MCP Gateway:

1. **`banking_api_server/.env`** (or wherever your shell sources from
   when you run `./run-demo.sh`).
2. **Your pm2 ecosystem file** (`ecosystem.config.js` env block) if
   you use pm2 for service management.
3. **Your secret manager** (1Password, SOPS, direnv `.envrc`,
   `op://Banking/Vault/password` references) if you use one. Update
   the source-of-truth value, not just the local file.
4. **Any CI/CD environment that runs the BFF** (GitHub Actions
   secrets, Vercel build envs — note Vercel deployments skip the
   vault entirely; see the "Vercel" section above).

### How to verify the new password works before next restart

```bash
VAULT_PASSWORD="<new-password>" npm run vault:list
# From banking_api_server/
```

Should print the list of vault entry names. If it fails with
`vault: open failed (bad password or tampered file)`, your
`VAULT_PASSWORD` copy is wrong somewhere — re-check the four places
above before letting the BFF restart.

### Recovery if you forget the new password

You cannot recover the new password. The vault has no backdoor (T-269-04).
Re-provision from source secrets — see the "Recovery procedure
(forgotten password)" section above.

---

*Last updated 2026-05-14 (Phase 269.1 Plan 04).*
