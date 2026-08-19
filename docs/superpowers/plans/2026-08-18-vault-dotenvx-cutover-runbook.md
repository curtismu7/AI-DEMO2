# Vault → dotenvx Cutover — Operator Runbook (one-time, DO ON MAIN CHECKOUT)

> Companion to `2026-08-18-vault-dotenvx-full-replace.md`. That plan builds the
> code + tooling (Task 7 tooling half shipped this). **This runbook is the
> one-time secret migration the operator runs by hand** — it moves live secret
> VALUES out of the encrypted `secrets.vault` and into dotenvx-encrypted `.env`
> files. It is deliberately NOT scripted into `run.sh` / `run-docker.sh` / CI.
>
> **Run on the real main checkout** (`/Users/cmuir/Development/AI-DEMO2`), not a
> worktree — the Docker stack bind-mounts the main checkout's files. **Do NOT run
> this in CI or in an agent worktree.**

## What this does / does not do

- **Does:** provision the four `DEMO_*_KEY` service-key names into
  `demo_api_server/.env`, dotenvx-encrypt the true secrets in each service `.env`
  under ONE shared keypair, restart the stack with `DOTENV_PRIVATE_KEY`, and
  validate every service still loads its secrets.
- **Does NOT:** delete the vault, `lib/vault`, the admin vault page, or the vault
  CLIs. That is **Task 8**, done only after this runbook's validation passes. The
  vault keeps working the whole time — this is additive and fully revertible.
- **No rotation.** Every value is COPIED from its existing source. No secret is
  regenerated. (memory: `feedback-do-not-rotate-secrets`.)

## Locked decisions this runbook honors

- Encrypted `.env` and `.env.keys` are **local-only, gitignored** — never
  committed. `**/.env` and `**/.env.keys` are in `.gitignore`.
- **One shared keypair** across all four service `.env` files, so a single
  `DOTENV_PRIVATE_KEY` decrypts them all. Delivered at runtime the same way
  `VAULT_PASSWORD` is today (env only — never argv, never a YAML literal).

---

## BLOCKER — Docker bind-mount requirement (do not skip; found live 2026-08-19)

**Only `demo_api_server` (the BFF) has its source directory bind-mounted into its
container** (`docker-compose.yml`: `./demo_api_server:/app`). `demo_mcp_gateway`,
`demo_agent_service`, and `oauth-mcp` do NOT — their containers have no `.env`
file on disk at all (`docker exec <container> ls /app/.env` → "No such file or
directory").

Each of the four services' dotenvx bootstrap (Tasks 2-5) calls
`@dotenvx/dotenvx`'s `config()`, which reads a physical `.env` file from disk. For
the three un-mounted services this ALWAYS fails
(`☠ [MISSING_ENV_FILE] missing file (.env)`) and silently falls through — the app
then reads whatever Compose's `env_file:` directive already injected as discrete
container env vars. Before this migration that was the real plaintext value
(harmless, matches intent). **After Step B encrypts those services' `.env` files,
`env_file:` injects the literal ciphertext string instead, and the app uses that
ciphertext as if it were the real secret** — every encrypted secret in those three
files breaks silently, not just one. It surfaced live as
`PINGONE_MCP_EXCHANGER_CLIENT_SECRET` failing oauth-mcp's own downstream banking
exchange ("Step 9 token exchange failed... Invalid client credentials") — but that
was one symptom of many; nothing else had been exercised yet to surface the rest.

**This is NOT caught by Step D.1's log-based check** — grepping for a ciphertext
signature in log output only proves a value wasn't PRINTED, not that it decrypted
correctly; a silently-substituted ciphertext credential produces no log signature
at all until something calls PingOne with it and gets `invalid_client`.

**Do not encrypt `demo_mcp_gateway/.env`, `demo_agent_service/.env`, or
`oauth-mcp/.env`** until one of these is true:
- Each service's container bind-mounts its own source directory (mirroring the
  BFF), so `dotenvx.config()` can find a real file — the straightforward fix,
  but changes `docker-compose.yml`'s dev/prod parity for those three services;
  weigh that before doing it as a quick patch.
- Or each service's `.env` file is bind-mounted individually (narrower — one
  extra `volumes:` line per service, no full source-dir mount), mirroring how
  `secrets.vault` is mounted read-only into the BFF today.
- Or the bootstrap is changed to decrypt from `process.env` directly (dotenvx
  supports a `processEnv` option — see `demo_api_server/services/dotenvxBootstrap.js`
  for the pattern already probed) rather than requiring a file, so Compose's
  `env_file:`-injected ciphertext can be decrypted in place without a physical
  file on disk.

Until one of these ships and is verified (per-service, with an actual functional
call that exercises a real credential — not just log absence), **the BFF is the
only service where dotenvx encryption is safe to enable.** The other three stay
on plaintext `.env`, which is the current live state as of 2026-08-19 (rolled
back after the live incident this section documents).

---

## Preconditions

```bash
cd /Users/cmuir/Development/AI-DEMO2          # MAIN checkout (not a worktree)
git branch --show-current                     # expect: main, clean or nearly so

# The vault must still exist and VAULT_PASSWORD must decrypt it (source of the
# four key values). run.sh/run-docker.sh auto-load VAULT_PASSWORD from
# demo_api_server/.env; export it here too for the manual steps below.
export VAULT_PASSWORD='<the vault password>'  # do NOT paste into shared logs
node demo_api_server/scripts/vault.js list    # prints entry NAMES only (never values)
```

Take a safety copy of every file this runbook mutates (all gitignored, so this is
just local insurance):

```bash
for f in demo_api_server demo_agent_service demo_mcp_gateway oauth-mcp; do
  [ -f "$f/.env" ] && cp "$f/.env" "$f/.env.bak-precutover"
done
```

`.env.bak*` is gitignored, so these backups can never be committed.

---

## Step A — provision the four service keys into `demo_api_server/.env`

The four `DEMO_*_KEY` values live only in the vault today (the real value is under
`DEMO_API_RESOURCE_SERVER_KEY`; the other three carry the same value). The updated
provisioning script copies that value into `demo_api_server/.env` under all four
names **without printing it**:

```bash
node demo_api_server/scripts/ensure-service-keys.js
```

It resolves the existing value (demo_api_server/.env → root `.env` →
vault, in that order), REUSES it verbatim (mints only on a truly fresh setup),
and writes all four names. It prints only a summary line — never the value.

Verify the four names are now present (this shows only that they exist, and that
they all match — it does not reveal the value beyond your own terminal):

```bash
grep -E '^(DEMO_API_RESOURCE_SERVER_KEY|DEMO_MCP_RESOURCE_SERVER_KEY|DEMO_INVEST_SERVICE_KEY|DEMO_MORTGAGE_SERVICE_KEY)=' \
  demo_api_server/.env | cut -d= -f1
```

<details>
<summary>Manual fallback (if you must copy by hand rather than via the script)</summary>

Reads the vault value into a shell var and upserts each name; the value never
reaches the terminal. Requires `VAULT_PASSWORD` exported.

```bash
cd demo_api_server
key="$(node scripts/vault.js get DEMO_API_RESOURCE_SERVER_KEY)"
for n in DEMO_API_RESOURCE_SERVER_KEY DEMO_MCP_RESOURCE_SERVER_KEY \
         DEMO_INVEST_SERVICE_KEY DEMO_MORTGAGE_SERVICE_KEY; do
  if grep -qE "^$n=" .env; then
    tmp="$(mktemp)"; sed "s|^$n=.*|$n=$key|" .env > "$tmp" && mv "$tmp" .env
  else
    printf '%s=%s\n' "$n" "$key" >> .env
  fi
done
unset key; cd ..
```
</details>

### Step A.2 — confirm every OTHER encrypt-list secret is already in its `.env`

`vault-migrate.js`'s allowlist is the set of true secrets. Almost all of them are
already plaintext in the relevant service `.env` (bootstrap writes them there; the
vault was a copy). Confirm nothing that should be encrypted lives ONLY in the
vault. Compare names:

```bash
# Names the vault holds:
node demo_api_server/scripts/vault.js list | sort > /tmp/vault-names.txt
# Names the encrypt step will target (from the tooling's single source of truth):
node -e 'const {SECRET_NAMES}=require("./demo_api_server/scripts/dotenvx-encrypt-envs");console.log(SECRET_NAMES.join("\n"))' | sort > /tmp/encrypt-names.txt
comm -23 /tmp/vault-names.txt /tmp/encrypt-names.txt   # in vault, NOT in encrypt list (review)
```

**This only catches secrets that were vault-resident.** Live run 2026-08-18: this
comparison came back clean, but a direct sweep of the four `.env` files for
secret-shaped NAMES (`*_SECRET`, `*_KEY`, `*_TOKEN`) turned up ~25 real secrets
(LLM provider keys, A2A client secrets, encryption master keys) that were added
to `.env` directly over time and were **never** migrated into the vault — so this
vault-vs-encrypt-list diff alone could not have found them. `ADDITIONAL_SECRET_NAMES`
in `dotenvx-encrypt-envs.js` now covers those explicitly. If re-running this
runbook after more secrets have been added, ALSO sweep for new secret-shaped
names not yet on `SECRET_NAMES`:

```bash
node -e '
const {SECRET_NAMES} = require("./demo_api_server/scripts/dotenvx-encrypt-envs");
const fs = require("fs");
const files = ["demo_api_server/.env","demo_agent_service/.env","demo_mcp_gateway/.env","oauth-mcp/.env"];
const secretLike = /(_SECRET|_KEY|_TOKEN|_PASSWORD|PASSWORD)$/i;
const encryptSet = new Set(SECRET_NAMES);
for (const f of files) {
  for (const line of fs.readFileSync(f, "utf8").split("\n")) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (!m) continue;
    const [, name, val] = m;
    if (!secretLike.test(name) || val.trim() === "" || val.startsWith("encrypted:") || encryptSet.has(name)) continue;
    console.log(`${f}: ${name} is plaintext and not on the encrypt list`);
  }
}
'
```

Names it turns up are worth a quick judgment call, not an automatic add: `DOTENV_PUBLIC_KEY`
should stay plaintext by design, `VAULT_PASSWORD` belongs to the vault (not this
file's own ciphertext), and any intentionally-public demo credential (the
`DEMO_*_PASSWORD` trio) doesn't need protecting.

**Known dotenvx limitation, live 2026-08-18:** encrypting the SAME plaintext
value under multiple different key names failed to decrypt at the real ~65-name,
4-file scale (`ensure-service-keys.js`'s four `DEMO_*_KEY` aliases, all one
value) — `[DECRYPTION_FAILED]`, dotenvx cites
[dotenvx/dotenvx#757](https://github.com/dotenvx/dotenvx/issues/757). A minimal
repro (one file, 3 duplicate names) did NOT reproduce it, so this is
scale/interaction-specific, not a blanket "never duplicate a value" rule. Those
four names are excluded from encryption in `DOTENVX_DUP_VALUE_BUG_EXCLUDED_NAMES`
(`dotenvx-encrypt-envs.js`) and stay plaintext — the same protection they had
before this migration, not a regression. Revisit if dotenvx fixes #757, or if a
future duplicate-value secret is added and needs the same treatment.

For any secret that exists in the vault but not yet in the service `.env` that
loads it (watch for `HELIX_API_KEY` in particular — it may be persisted via
configStore rather than `.env`), add it to that service's `.env` from the vault
using the same no-print pattern as the fallback above, then continue.

---

## Step B — encrypt the true secrets under one shared keypair

```bash
npm --prefix demo_api_server run secrets:encrypt
```

This runs `demo_api_server/scripts/dotenvx-encrypt-envs.js`, which:

- Encrypts ONLY the true secret names in each of `demo_api_server/.env`,
  `demo_agent_service/.env`, `demo_mcp_gateway/.env`, `oauth-mcp/.env` (non-secret
  config stays plaintext and diff-reviewable).
- Uses ONE shared keypair — the first file generates it, the rest are seeded with
  the same `DOTENV_PUBLIC_KEY`, so one private key decrypts all four.
- Writes the private key to the gitignored repo-root `.env.keys` as
  `DOTENV_PRIVATE_KEY=…`.

### Step B.2 — prove nothing sensitive is staged

```bash
git status --porcelain            # expect: NO .env or .env.keys listed (all gitignored)
git check-ignore demo_api_server/.env .env.keys demo_mcp_gateway/.env oauth-mcp/.env demo_agent_service/.env
# each path should echo back (i.e. is ignored)
gitleaks protect --staged --no-banner || true   # belt-and-suspenders; nothing secret should be staged
```

If any `.env` or `.env.keys` shows as trackable, STOP and fix `.gitignore` before
going further.

---

## Step C — restart the stack with `DOTENV_PRIVATE_KEY` set

**How the key actually reaches each container (Docker mode).** `.env.keys` is
delivered as a SECOND `env_file:` entry on each of the four secret-loading
services in `docker-compose.yml`, alongside their existing `./<service>/.env`
entry:

```yaml
env_file:
  - path: ./demo_api_server/.env
    required: true
  - path: ./.env.keys
    required: false
```

This is deliberately **not** a compose `environment:` entry — `environment:`
always overrides `env_file:` for the same key, even on a day the key doesn't yet
exist in the env_file, which is exactly the footgun `scripts/check-fresh-clone-
hygiene.js`'s `compose-env-shadow` check exists to catch (PR #911/#914: the same
pattern silently zeroed a different secret in production). It is also
deliberately **not** a line inside each service's own `.env`: that file is the
ciphertext `DOTENV_PRIVATE_KEY` decrypts, so writing the key into the same file
it decrypts would defeat encryption-at-rest — a leaked `.env` would carry its own
decryption key. `.env.keys` stays a separate, gitignored file for exactly this
reason (same separation `VAULT_PASSWORD`, living in `demo_api_server/.env`, keeps
from the SEPARATE `secrets.vault` file it decrypts — never itself).

Because delivery is via `env_file:`, nothing needs to be exported into the shell
that runs `docker compose up` — Compose reads `.env.keys` off disk directly, the
same way it already reads each service's own `.env`. `run-docker.sh`'s
`dotenvx_preflight` only VERIFIES `.env.keys` decrypts the encrypted `.env`
before `up` (fail-fast, mirroring `vault_preflight`) — it does not need to (and
no longer does) export the key for compose interpolation.

Docker (recreate so env changes take effect — a plain `restart` re-uses baked env):

```bash
./run-docker.sh start          # dotenvx_preflight verifies .env.keys, then `up -d`
# or, for just the four secret services:
# ./run-docker.sh build demo-api-server mcp-server mcp-gateway agent-service
```

Native mode reaches the key differently (there is no compose `env_file:` to lean
on): `run.sh` auto-loads `DOTENV_PRIVATE_KEY` from `.env.keys` into the shell and
exports it directly to each `npm start` it launches — the same channel
`VAULT_PASSWORD` already uses for native processes.

```bash
./run.sh                       # [DOTENVX] preflight lines confirm the key decrypts
```

Expected new log lines: `[DOTENVX] Auto-loaded DOTENV_PRIVATE_KEY from …` and
`[DOTENVX] encrypted .env verified — DOTENV_PRIVATE_KEY decrypts it.`

---

## Step D — VALIDATE (before any Task 8 vault deletion)

**D.1 — each service loaded its secrets (not ciphertext) — BEHAVIORAL, from
logs.** Do NOT use `docker exec ... printenv` here: container-level env is the
RAW ciphertext BY DESIGN after the cutover — compose `env_file:` injects the
encrypted `.env` verbatim at container creation, and decryption happens inside
each Node process, never propagating back to the container env. A printenv-style
check therefore fails forever on a perfectly healthy stack (this exact false
alarm happened live on 2026-08-18). Validate what the processes DO instead:

```bash
# 1. The incident signature must be ABSENT: no service may log a ciphertext
#    value as if it were a secret (2026-08-18: `user_secret=encr...`,
#    `collector.encrypted:...` from New Relic, `Decryption failed` from
#    ConfigStore).
for c in ai-demo-api-server ai-demo-mcp-gateway ai-demo-agent-service ai-demo-mcp-server; do
  echo "== $c =="
  docker logs "$c" --since 5m 2>&1 \
    | grep -iE 'encrypted:[A-Za-z0-9+/]{8}|collector\.encrypted|Decryption failed|DECRYPTION_FAILED' \
    && echo "FAIL: ciphertext reached application code" \
    || echo "OK: no ciphertext in application log lines"
done

# 2. POSITIVE evidence the BFF decrypt bootstrap ran (not just absence of errors):
docker logs ai-demo-api-server --since 5m 2>&1 | grep '\[dotenvx\] bootstrap'
# expect: "[dotenvx] bootstrap: decrypted .env applied — N value(s) set, ..."

# 3. The login flow reads a REAL secret: sign in at local.ping-devops.com:4000,
#    then confirm the masked secret prefix is not ciphertext:
docker logs ai-demo-api-server --since 5m 2>&1 | grep '\[oauth/user/login\] env_id='
# The `user_secret=` field must NOT read `encr...` — that is the first 4 chars
# of `encrypted:...` through the log mask, and was the live incident's tell.
```

Any hit in check 1, a missing bootstrap line in check 2, or `user_secret=encr...`
in check 3 means the key did not reach that container — recheck Step C. (Do not
print the decrypted values themselves.)

**D.2 — the service-key bridge serves a real key.** The BFF's internal bridge
resolves `DEMO_API_RESOURCE_SERVER_KEY` from the (now decrypted) env. It requires
the shared internal secret header; compare the served value's hash to the one in
`demo_api_server/.env` rather than printing it:

```bash
SEC="$(grep -E '^BFF_INTERNAL_SECRET=' demo_api_server/.env | cut -d= -f2- | tr -d '"'"'"'"'"')"
curl -sk -H "x-internal-gateway-secret: $SEC" \
  'https://api.ping.demo:3001/internal/vault/service-key?name=DEMO_API_RESOURCE_SERVER_KEY' \
  | grep -q '"value"' && echo "bridge OK (served a value)" || echo "bridge FAILED"
```

`404 key_unset` here means `DEMO_API_RESOURCE_SERVER_KEY` did not decrypt into the
BFF — fix before proceeding.

**D.3 — §4 identity invariant: the gateway's exchange client is still the client
oauth-mcp introspects — FUNCTIONAL, not printenv.** `docker exec ... printenv`
comparisons prove nothing after the cutover: both containers' env holds the RAW
ciphertext BY DESIGN (identical ciphertext would even false-PASS while
decrypting to different or garbage values, and the decrypted values never appear
in container env). Prove the identity pair the way it is actually used — one
introspected gateway call end-to-end:

1. Sign in at `local.ping-devops.com:4000` (Super Sports) and run one
   gateway-routed agent chip (e.g. the transfer chip — the same one D.4 uses).
   It must complete with real data — not "Insufficient scope", not "Gateway
   Policy Denied", not a 401 toast.

2. Confirm from both sides' logs that introspection worked during that window:

```bash
# Gateway side — no introspection/auth failures:
docker logs ai-demo-mcp-gateway --since 5m 2>&1 \
  | grep -iE '\[GatewayIntrospection\]|invalid_client' \
  || echo "OK: no introspection failures logged"

# oauth-mcp side (mcp-server) — no rejected-token errors:
docker logs ai-demo-mcp-server --since 5m 2>&1 \
  | grep -iE 'invalid_client|introspect[a-z]* (fail|error)|401' \
  || echo "OK: no introspection failures logged"
```

If the identity pair diverged, the tool call in step 1 fails: oauth-mcp
introspects the gateway's exchanged token as a DIFFERENT PingOne client, PingOne
returns `active: false`, and every gateway tool call 401s. That failing call —
not a printenv hash — is the §4 regression signal. STOP and reconcile before
Task 8.

**D.4 — smoke the demo.** Sign in on `local.ping-devops.com:4000`, run an
agent chip that exercises the gateway (e.g. a Super Sports transfer), and a
mortgage/invest apikey-dispatch chip (proves the `DEMO_*_KEY` bridge). All must
behave exactly as before the cutover.

Only when D.1–D.4 all pass is it safe to proceed to **Task 8** (remove `lib/vault`,
the vault CLIs, the admin vault page, the compose `secrets.vault` mount, and the
`vault_preflight`).

---

## Rollback

The vault is untouched by this runbook, so rollback is just "stop using dotenvx
secrets and let the vault supply them again":

```bash
# 1. Restore the pre-cutover plaintext .env files.
for f in demo_api_server demo_agent_service demo_mcp_gateway oauth-mcp; do
  [ -f "$f/.env.bak-precutover" ] && mv "$f/.env.bak-precutover" "$f/.env"
done
# 2. Remove the shared private key so the dotenvx preflight becomes a no-op again.
rm -f .env.keys
# 3. Recreate the stack (VAULT_PASSWORD still decrypts the still-present vault).
./run-docker.sh start        # or ./run.sh
```

Because the encrypted `.env` files and `.env.keys` were never committed, no git
revert is involved. The four `DEMO_*_KEY` names left in `demo_api_server/.env` are
harmless (the vault path still provides the value); remove them only if you want
the file byte-identical to before.

## Notes

- The two legacy names `DEMO_INVEST_SERVICE_KEY` / `DEMO_MORTGAGE_SERVICE_KEY` are
  provisioned for a lossless copy but are read by no runtime code today (only
  `scripts/rename-services.sh` maps the former). They can be pruned once confirmed
  unused everywhere.
- k8s secret delivery is a separate follow-up (plan §6, item 3) — this runbook
  covers native + Docker only.
