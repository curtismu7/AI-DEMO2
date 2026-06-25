# Runbook: Vault / Secret Exposure

`VAULT_PASSWORD` was exposed (committed, logged, shared, shoulder-surfed), or a
stored secret (OAuth client secret, Helix key, API key) leaked. Because the
vault password decrypts **all** vaulted secrets, a leaked `VAULT_PASSWORD` is the
highest-impact incident here.

**Default severity:** SEV-1 for `VAULT_PASSWORD` or any client secret; SEV-2 for a
single low-impact API key.

See [README.md](README.md) for first-response and evidence-capture steps.

---

## How secrets are stored

- **Vault** (`services/vaultLoader.js`): an encrypted-at-rest file at `VAULT_PATH`
  (default `secrets.vault` at repo root). `VAULT_PASSWORD` is the unlock factor.
  At boot, `loadVaultIntoConfigStore()` decrypts entries into configStore
  **in memory only** (`setRaw(data, {persist:false})` — never written to LMDB) and
  then deletes `VAULT_PASSWORD` from `process.env` and zeroes key material in
  `vault.close()`. The encrypted file is safe in `ls`/`git diff`; the **password
  is the secret**.
- **configStore / LMDB** (`services/configStore.js`): runtime config; secret
  values are encrypted (AES-256-GCM) using `CONFIG_ENCRYPTION_KEY` (or
  `SESSION_SECRET`) before write. A bootstrap allowlist (`session_secret`,
  `config_encryption_key`, `vault_password`, …) is **env-only, never** persisted.
- **`.env`**: plaintext runtime env (local dev / bootstrap). Anything here is
  unencrypted by definition.

So "what leaked, and from where" decides scope: vault password = everything in
the vault; `CONFIG_ENCRYPTION_KEY` = everything encrypted in LMDB; a single
client secret = just that client.

## 1. Detect / confirm

- **Where did it leak?** Git history, a log/error body, a shared `.env`, a
  screenshot. For git, treat the secret as compromised the moment it was pushed —
  rotation is required even after a force-push/removal.
- **What does it unlock?** `VAULT_PASSWORD` → all vault entries.
  `CONFIG_ENCRYPTION_KEY`/`SESSION_SECRET` → all LMDB-encrypted secrets **and**
  session integrity. A single client secret → that PingOne app only.
- **Read the vault audit trail** for unexpected unlock/rotate activity (records
  `op`/`key`/`result`/`caller`, never values): `{VAULT_PATH}.audit.log`.
- **Check vault state** (no secret values exposed):
  ```bash
  curl -sk https://api.ping.demo:3001/api/admin/vault/status \
    -H 'Authorization: Bearer <ADMIN_SESSION>'
  # { unlocked, entriesLoaded, vaultFilePresent, vaultPath:<basename> }
  ```

## 2. Contain & rotate (the response *is* rotation — assume the secret is burned)

### a) `VAULT_PASSWORD` leaked → rotate the vault password
`POST /api/admin/vault/rotate` re-encrypts the vault under a new password
(`routes/adminVault.js`; re-verifies `currentPassword` first, serialized by a
mutex):
```bash
curl -sk -X POST https://api.ping.demo:3001/api/admin/vault/rotate \
  -H 'Authorization: Bearer <ADMIN_SESSION>' -H 'Content-Type: application/json' \
  -d '{"currentPassword":"<OLD>","newPassword":"<NEW-STRONG>"}'
```
Then update `VAULT_PASSWORD` everywhere it's configured (deployment secrets /
local `.env`) and restart. **Rotating the password re-encrypts the file but does
NOT change the underlying secrets** — if the password was exposed long enough
that the *contents* may have been read, also rotate the contents (next steps).

### b) A specific secret leaked → rotate it at the source
The vaulted value is only a copy; the authority is the source system:
- **PingOne client secret** → regenerate in the PingOne console; update the value
  in the vault/`.env`; restart. `scripts/rebuild-pingone.sh` does a full PingOne
  reprovision if multiple secrets are affected or state is broken.
- **Helix key / API keys** → rotate at the provider, update the stored value.
- After updating, the value flows back into configStore on the next boot/unlock.

### c) `CONFIG_ENCRYPTION_KEY` / `SESSION_SECRET` leaked
Rotate the key in the environment and restart. Note: changing the encryption key
makes existing LMDB-encrypted secret values unreadable — plan to **re-enter**
those secrets (re-unlock the vault, which rewrites them) and expect all sessions
to invalidate (sessions are signed with `SESSION_SECRET`).

### d) Lock down access in the meantime
- The unlock endpoint is already throttled (5 attempts / 5 min per admin in
  `routes/adminVault.js`) — confirm no brute-force in the vault audit log.
- If the leak vector is still open (a live log sink, a shared file), close it
  before rotating so the new secret doesn't leak the same way.

## 3. Eradicate

- Confirm the **old** `VAULT_PASSWORD` no longer unlocks: it should fail
  `openVault()` (rotate already re-verified the new one).
- Confirm rotated source secrets: old PingOne client secret rejected at the token
  endpoint; new one works.
- Remove the secret from wherever it leaked (purge the log, scrub git history /
  rotate regardless, delete the shared file).

## 4. Recover

- Restart services with the new `VAULT_PASSWORD` / keys; verify boot loads the
  vault (`vault/status` → `unlocked:true`, expected `entriesLoaded`).
- Verify dependent flows work with rotated secrets (OAuth login, token exchange,
  Helix/LLM calls).
- If sessions were invalidated (key rotation), users simply re-authenticate.

## 5. Post-incident

Run the [README post-incident checklist](README.md#post-incident-checklist-all-incidents).
Vault-specific:
- [ ] Every secret reachable by the leaked credential rotated — not just the one
      you saw exposed (a leaked `VAULT_PASSWORD` means **all** vault entries).
- [ ] Leak vector closed and verified (git scrubbed, log sink fixed).
- [ ] If a code path emitted a secret (logged, returned in a response), add a test
      + `REGRESSION_LOG.md` entry. Secrets must never appear in logs or audit
      records — the vault audit deliberately stores only `op`/`key`/`result`/`caller`.
