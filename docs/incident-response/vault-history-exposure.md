# Incident: vault ciphertext and its password are both public in git history

**Status:** open — remediation is operator-executed, not automated.
**Found:** 2026-08-02, during a full vault code review.
**Scope:** every credential held in `secrets.vault` on or before 2026-07-28.

Sibling runbook: [vault-secret-exposure.md](vault-secret-exposure.md) covers a
leaked *value*. This one covers the *whole vault* being decryptable by anyone.

---

## 1. What is exposed

`curtismu7/AI-DEMO2` is a **public** repository. Two things are reachable from
`origin/main` today, and together they are sufficient to decrypt the vault:

| Artifact | Blob / commit | Note |
|---|---|---|
| `secrets.vault` ciphertext | `ec9f0a68` at `147d3ecd` | 2026-07-28, "resync secrets.vault with the rotated credentials" |
| `secrets.vault` ciphertext | `03722a5c` at `8a4a031f` | 2026-07-04 |
| `VAULT_PASSWORD` cleartext | parent of `441eb756` | hardcoded fallback in `e2e-use-cases-test.js` |

`f82259f3` (#1101) untracked the vault and `441eb756` (#1104) removed the
password literal. **Neither rewrote history.** Removing a file in a later commit
does not unpublish the blob — it is still served by GitHub, still clonable, and
still resolvable by SHA even after a later force-push, because forks and
retained objects keep it alive.

Reproduce the exposure (safe, read-only):

```bash
git merge-base --is-ancestor 147d3ecd origin/main && echo "ciphertext still on main"
git ls-tree 147d3ecd -- secrets.vault      # blob is present
git show 441eb756^:e2e-use-cases-test.js   # password fallback is present
```

## 2. What this is not

- Not a code defect. The vault's crypto is sound — Argon2id (m=64 MiB, t=3,
  p=4), AES-256-GCM per entry, wrapped DEKs, whole-file HMAC. A correct cipher
  does not help when the key is published beside the ciphertext.
- Not fixed by rotating `VAULT_PASSWORD` alone. The old ciphertext stays
  decryptable with the old password forever. Rotation protects *future*
  contents; only rotating the **credentials inside** the vault helps.
- Not fixed by `git rm`. See above.

## 3. Remediation order

Do these in order. Steps 1-2 are the ones that actually reduce risk; step 3 is
cleanup that limits future casual discovery.

### Step 1 — treat every vault credential as disclosed

Enumerate what was in the vault as of 2026-07-28 and rotate each at its source
of truth. Names only (values never leave the vault):

```bash
node demo_api_server/scripts/vault.js list
```

Expect PingOne client secrets, gateway/introspection credentials, and the demo
backend service keys. For each, rotate in the owning system, then write the new
value into the vault via stdin (never argv — argv is visible in `ps` and shell
history):

```bash
printf '%s' "$NEW_VALUE" | node demo_api_server/scripts/vault.js set SOME_CLIENT_SECRET
```

PingOne specifics — regenerate is `POST` with the `vnd` content type; enable and
disable are a `PUT` of the full object; propagate by **value**, not by reference.
See [pingone-secret-rotation](../../.claude/skills/) notes before touching the
console.

### Step 2 — change `VAULT_PASSWORD` itself

The old one is public. After step 1, rotate the password so future writes are
sealed under a key that was never published:

```bash
node demo_api_server/scripts/vault.js rotate     # prompts, masked
```

Then update `demo_api_server/.env` and every consumer environment
(`docker-compose.yml` env_file, `k8s/03-secrets.yaml`, the SE cluster secret).
`rotate()` is **not** a revocation primitive: anyone holding a pre-rotation copy
of the file can still open it with the old password, which is precisely why
step 1 comes first.

### Step 3 — history purge (optional, does not undo disclosure)

Purging raises the effort needed to find the blobs; it does not make them
unfindable, and it invalidates every existing clone and open PR.

```bash
git filter-repo --path secrets.vault --invert-paths
git filter-repo --path e2e-use-cases-test.js --replace-text <(echo 'literal==>REDACTED')
```

Then force-push. Note `.husky/pre-push` blocks force-pushes to `main` — a prior
force-push silently dropped 11 PRs. Coordinate before overriding it, and ask
GitHub Support to expire the cached blobs; forks retain them regardless.

## 4. Prevention already in place

- `.gitignore` covers `/secrets.vault`, `/secrets.vault.audit.log`, and (as of
  this change) `/secrets.vault*.tmp` — the in-flight envelope written by
  `save()` is complete ciphertext and was previously un-ignored.
- `e2e-use-cases-test.js` now requires `PINGONE_TEST_PASSWORD` from the
  environment and exits if it is unset — no literal fallback.

## 5. What must not regress

- Never `git add` `secrets.vault`, its audit log, or any `secrets.vault*.tmp`.
- Never reintroduce a password literal as a `process.env.X || 'literal'`
  fallback. That pattern is what published the key.
- Keep `VAULT_PASSWORD` distinct from the demo account password. Sharing one
  string meant a credential intended to be demoable doubled as the vault key.
