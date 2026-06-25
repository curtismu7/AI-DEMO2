# Import Plan — Export & Import Scripts

> **Status:** Draft — 2026-05-09  
> **Scope:** `scripts/exportMigrationBundle.js` and `scripts/importMigrationBundle.js` — full analysis, implementation spec, and acceptance criteria.  
> **Parent:** [migration-onboarding-plan.md](migration-onboarding-plan.md)

---

## 0. Goal

A user on Machine A runs one command to produce a self-contained archive. They copy it to Machine B and run one command. Machine B starts the app immediately — no manual `.env` editing, no config re-entry, no OAuth errors caused by a mismatched encryption key.

**Success definition:** `npm start` on Machine B passes `GET /api/health/readiness` returning `configured: true` and `userOAuthConfigured: true` within 30 seconds of the import completing. This endpoint is added by migration-onboarding-plan.md §3a — it must be shipped before the import script's health-check step is useful.

---

## 1. What needs to move between machines

### 1a. Persistence layer analysis

The app has three distinct persistence layers that require different treatment:

**Layer 1 — LMDB databases** (LMDB environment at `data/persistent/lmdb/`)

| File | Contents | Encryption | Lock behaviour |
|------|----------|------------|----------------|
| `config.db` | All 252 configStore keys (credentials, feature flags, endpoints) | AES-256-GCM, key derived from `CONFIG_ENCRYPTION_KEY` (preferred) or `SESSION_SECRET` (fallback) | Written on every config change — highest contention |
| `banking.db` | Banking transactions, account records | None | Written on demo data operations |
| `delegations.db` | RFC 8693 token delegation records | None | Written during agent token exchange |
| `demoAccounts.db` | Demo account seed data | None | Rarely written |

`configStore.js` uses `lmdb` with memory-mapped access.

- LMDB supports concurrent readers via memory-mapping. Export opens the environment in read-only mode.
- Import **must** refuse to run while the server is up. LMDB write transactions hold exclusive locks; extracting over an active environment produces corruption.

**Layer 2 — JSON flat files** (`data/persistent/*.json`)

| File | Contents |
|------|----------|
| `users.json` | Demo user profiles |
| `accounts.json` | Demo bank accounts |
| `transactions.json` | Transaction history |
| `activityLogs.json` | Audit trail |

Plain JSON, no encryption. Safe to copy at any time — worst case is a torn write that leaves one file slightly stale, which is acceptable for demo data.

**Layer 3 — Files to explicitly exclude**

| File | Path | Reason to exclude |
|------|------|-------------------|
| `sessions.db` | `data/sessions.db` | Express session tokens are machine-bound. Copying them makes old sessions appear valid on Machine B but they will fail JWT re-validation, producing confusing 401s on every request. Users log in fresh after import. **Note:** `sessions.db` lives at `data/sessions.db`, not `data/persistent/sessions.db` — it will NOT appear in the `data/persistent/*.db` scan. The explicit skip in the import extraction step is still correct defensive coding in case the archive was hand-assembled. |
| `runtimeData.json` | `data/runtimeData.json` | Ephemeral in-memory store snapshot. Regenerated from `bootstrapData.json` on startup — including it would overwrite the freshly-imported persistent data with a stale snapshot. |
| `runtimeData.json.bak` | `data/runtimeData.json.bak` | Same reason. |
| `bootstrapData.json` | `data/bootstrapData.json` | One-way export snapshot from `exportBootstrapData.js`. The source of truth after import is `data/persistent/` — the bootstrap file is irrelevant. |

### 1b. The `.env` file and `PINGONE_SESSION_SECRET`

`config.db` is encrypted with AES-256-GCM. The encryption key is derived from `PINGONE_SESSION_SECRET` in the process environment. This value lives only in `.env` — it is not stored anywhere in the database (it cannot be, since it is the key that protects the database).

**If the encryption key on Machine B differs from Machine A:**
- `configStore.ensureInitialized()` will fail to decrypt stored values.
- `configStore.getEffective()` silently returns empty string for every secret field.
- The app starts but every OAuth call fails — no obvious error points to the real cause.
- This is the highest-risk silent failure in the entire migration.

The encryption key is resolved in priority order: `CONFIG_ENCRYPTION_KEY` → `SESSION_SECRET` → dev fallback. The `.env` must carry whichever of these was active when `config.db` was written on Machine A.

**Decision: bundle `.env` in the archive.**

The archive includes `banking_api_server/.env`. The import script writes it to disk before starting the health check. The user gets a working app immediately.

**Security implications and mitigations:**

| Risk | Mitigation |
|------|-----------|
| Archive file containing secrets is shared insecurely | Export script prints a bold warning: treat this file like your `.env` — do not commit to git or upload publicly |
| Archive stored in an insecure location | Not in scope to enforce; documented as user responsibility |
| `.env` on Machine B already exists with different values | Import script backs up the existing `.env` to `.env.pre-import-<timestamp>` before overwriting |
| Archive was created without a `.env` present | Export script warns and continues — import script detects missing `.env` in archive and prints instructions |

### 1c. Complete file manifest

```
banking-export-<timestamp>.tar.gz
├── manifest.json                     (metadata, version, file list)
├── .env                              (full banking_api_server/.env)
├── persistent/
│   ├── config.db
│   ├── banking.db
│   ├── delegations.db
│   ├── demoAccounts.db
│   ├── users.json
│   ├── accounts.json
│   ├── transactions.json
│   └── activityLogs.json
```

---

## 2. Export script

**File:** `banking_api_server/scripts/exportMigrationBundle.js`  
**npm script:** `"data:export": "node scripts/exportMigrationBundle.js"`  
**Usage:** `npm run data:export` or `npm run data:export -- --out ./my-export.tar.gz`

### 2a. Step-by-step logic

```
Step 0 — Package pre-flight (NEW)
  Same checks as import script Step 0 (tar loadable, lmdb or lmdb loadable,
  native binary architecture match). Exit 1 with the same remediation messages if any check fails.
  Print: "✓ Package pre-flight passed"

Step 1 — Resolve output path
  argv includes --out <path>  → use that path
  BANKING_EXPORT_PATH set     → use that
  default                     → ./banking-export-<ISO-timestamp>.tar.gz
  Verify parent directory is writable; exit 1 with EACCES message if not.

Step 2 — Check server status
  GET http://localhost:${process.env.PORT || 3001}/api/health/live
    200 returned → server is UP
      Log: "Server is running — opening databases read-only (safe)"
      Set dbOpenOptions = { readonly: true }
    Connection refused → server is DOWN
      Set dbOpenOptions = {}  (normal open)
    Any other error → treat as DOWN, log warning

Step 3 — Probe all .db files
  For each .db file in the manifest:
    Attempt: new Database(filePath, dbOpenOptions)
    If throws → log warning "Could not open <file>: <error>" and remove from manifest
    Otherwise → db.close() immediately (we only needed to verify it opens)

Step 4 — Probe all .json files
  For each .json file:
    fs.existsSync → if missing, log warning and remove from manifest
    (Do not parse — just confirm readable)

Step 5 — Collect .env
  Check if banking_api_server/.env exists
    If yes  → include in archive as .env
    If no   → log warning "No .env file found — archive will not include environment variables.
               The app will not start on the destination without a .env file."
              continue (do not abort — user may want data-only export)

Step 6 — Build manifest.json
  {
    version: 2,
    exportedAt: new Date().toISOString(),
    sourceNodeVersion: process.version,
    sourcePlatform: process.platform,
    files: [<remaining files after probing>],
    hasEnv: <boolean>,
    skipped: [
      'sessions.db — machine-bound Express sessions',
      'runtimeData.json — ephemeral in-memory snapshot'
    ]
  }

Step 7 — Create archive
  Use Node built-ins: fs, zlib, tar (node:stream pipeline)
  No child_process, no shell exec, no external tar binary dependency.
  Write to a temp file first; rename to final path atomically on success.
  If disk full mid-write → temp file cleanup; exit 1 with "Disk full" message.

Step 8 — Print summary
  ✓ Archive: ./banking-export-2026-05-09T10-00-00.tar.gz  (4.2 MB)
  
  Included:
    .env                        (2.1 KB)
    persistent/config.db        (48 KB)
    persistent/banking.db       (312 KB)
    persistent/delegations.db   (8 KB)
    persistent/demoAccounts.db  (24 KB)
    persistent/users.json       (12 KB)
    persistent/accounts.json    (8 KB)
    persistent/transactions.json (64 KB)
    persistent/activityLogs.json (18 KB)
  
  Skipped:
    sessions.db       (machine-bound Express sessions)
    runtimeData.json  (ephemeral in-memory snapshot)
  
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  SECURITY: This archive contains your .env and all
  database secrets. Treat it like your .env file:
    - Do NOT commit to git
    - Do NOT upload to public storage
    - Transfer via secure channel (scp, encrypted USB, etc.)
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### 2b. Dependencies

- `lmdb` — already in `package.json`, used only for read-only probe open/close
- `tar` — **must be added** to `banking_api_server/package.json` (`npm install tar`). The `tar` npm package is not a Node built-in and is not currently installed. It provides a cross-platform streaming tar API and avoids spawning a shell `tar` process.
- `node:zlib`, `node:stream`, `node:fs`, `node:path`, `node:os` — Node built-ins, no new packages beyond `tar`

---

## 3. Import script

**File:** `banking_api_server/scripts/importMigrationBundle.js`  
**npm script:** `"data:import": "node scripts/importMigrationBundle.js"`  
**Usage:** `npm run data:import -- ./banking-export-2026-05-09T10-00-00.tar.gz`

### 3a. Step-by-step logic

```
Step 0 — Package pre-flight (NEW)
  Run from banking_api_server/ directory.
  
  Check 1 — node_modules present
    If ./node_modules/ does not exist:
      Print: "node_modules not found. Running npm install..."
      spawnSync('npm', ['install'], { stdio: 'inherit', cwd: __dirname + '/..' })
      If exit code !== 0 → exit 1: "npm install failed. Fix the error above and retry."
  
  Check 2 — tar module loadable
    try { require('tar') } catch
      → exit 1:
        "Required package 'tar' is not installed.
         Run:  cd banking_api_server && npm install
         Then retry the import."
  
  Check 3 — lmdb or lmdb loadable
    try { require('lmdb') } catch
      try { require('lmdb') } catch
        → exit 1:
          "Neither lmdb nor lmdb is available.
           Run:  cd banking_api_server && npm install && npm rebuild lmdb
           Then retry the import."
      → warn:
          "lmdb failed to load (native binary may need rebuild).
           Falling back to lmdb built-in.
           If import health check fails, run:
             cd banking_api_server && npm rebuild lmdb"
  
  Check 4 — lmdb native binary architecture match
    If lmdb loaded successfully:
      try { const db = new Database(':memory:'); db.close(); }
      catch (e if e.message includes 'wrong architecture' or 'invalid ELF')
        → exit 1:
          "lmdb native binary is built for a different CPU/Node version.
           Run:  cd banking_api_server && npm rebuild lmdb
           Then retry the import."
  
  Print: "✓ Package pre-flight passed"

Step 1 — Validate arguments
  Require argv includes a .tar.gz path; exit 1 with usage string if missing:
    Usage: npm run data:import -- <path-to-archive.tar.gz>

Step 2 — Check server is stopped
  GET http://localhost:${process.env.PORT || 3001}/api/health/live
    200 → exit 1:
      "The server is running. Stop it before importing:
         ./run-demo.sh stop   (or: npm stop)
       Reason: lmdb holds an exclusive write lock.
       Importing with the server running will corrupt config.db."
    Connection refused → proceed
    Other error → treat as stopped, log warning, proceed

Step 3 — Verify archive and extract manifest
  Extract ONLY manifest.json from the archive (do not write other files yet).
  Validate manifest:
    version === 2         → OK
    version === 1         → warn "Old archive format — .env not included. You will need to
                             copy .env manually after import." Set hasEnv = false. Continue.
    version missing       → exit 1: "Not a valid banking export archive"
    files array missing   → exit 1: "Corrupt manifest: files array not found"

Step 4 — Warn if .env is absent from archive
  If manifest.hasEnv === false:
    Print:
      "This archive does not contain a .env file.
       After import completes, copy your .env manually to banking_api_server/.env
       making sure PINGONE_SESSION_SECRET matches the source machine.
       Without it, config.db will be unreadable and the app will not start correctly."
    Pause 3 seconds (let the user read it) then continue.
    Do NOT abort — data files are still worth importing.

Step 5 — Create backup of existing data
  Timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  backupDir = data/backups/pre-import-<timestamp>/
  
  fs.mkdirSync(backupDir, { recursive: true })
  
  For each file currently in data/persistent/:
    fs.copyFileSync(src, path.join(backupDir, filename))
    If any copy throws → print:
      "Backup failed on <file>: <error>
       Aborting — no files in data/persistent/ have been changed.
       Fix the error and retry."
      exit 1
  
  If banking_api_server/.env exists:
    fs.copyFileSync('.env', '.env.pre-import-<timestamp>')
    (backup existing .env before overwriting)

Step 6 — Extract all files
  Extract the full archive:
    persistent/* → data/persistent/
    .env         → banking_api_server/.env   (overwrites if exists — backup already made)
    manifest.json → data/persistent/manifest-last-import.json  (audit trail)
  
  Explicitly verify each extracted file exists after extraction.
  If any file is missing post-extract → print which files are missing and exit 1.
  
  Do NOT extract sessions.db even if present in archive (skip silently).
  Do NOT extract runtimeData.json even if present in archive (skip silently).

Step 7 — Post-import health check
  Load configStore fresh (clear any module cache first):
    delete require.cache[require.resolve('../services/configStore')]
    const configStore = require('../services/configStore')
  
  try {
    await configStore.ensureInitialized()
    const configured = configStore.isConfigured()
    const userConfigured = configStore.isUserOAuthConfigured()
    
    if (configured && userConfigured) {
      print: "✓ Config OK: environment_id, admin_client_id, and user_client_id are all set"
    } else if (configured) {
      print: "⚠ Config partial: environment_id and admin_client_id set, but user_client_id missing"
    } else {
      print: "⚠ Config incomplete: environment_id or admin_client_id missing"
    }
  } catch (err) {
    print:
      "✗ Config failed to initialize: <err.message>
      
       Most likely cause: CONFIG_ENCRYPTION_KEY or SESSION_SECRET in the imported .env
       does not match the key used to encrypt config.db on the source machine.
       
       This should not happen if the .env was bundled with this archive.
       If you modified .env after importing, restore it from:
         banking_api_server/.env.pre-import-<timestamp>
       
       To rollback all data:
         cp data/backups/pre-import-<timestamp>/* data/persistent/
         cp .env.pre-import-<timestamp> .env"
    exit 1
  }

Step 8 — Print completion summary
  ✓ Import complete
  
  Data files:
    ✓ persistent/config.db
    ✓ persistent/banking.db
    ✓ persistent/delegations.db
    ✓ persistent/demoAccounts.db
    ✓ persistent/users.json
    ✓ persistent/accounts.json
    ✓ persistent/transactions.json
    ✓ persistent/activityLogs.json
  
  Environment:
    ✓ .env written  (previous backed up to .env.pre-import-<timestamp>)
     — OR —
    ⚠ .env not in archive — copy manually before starting
  
  Backup saved to: data/backups/pre-import-<timestamp>/
  Config status:   OK / PARTIAL / INCOMPLETE
  
  Next steps:
    1. Start the server:  ./run-demo.sh
    2. Visit /configure   — page will show "Import verified" if config is OK
  
  To rollback:
    cp data/backups/pre-import-<timestamp>/* data/persistent/
    cp .env.pre-import-<timestamp> .env
```

### 3b. Dependencies

Same as export: `lmdb` (health check), `tar` (extraction), Node built-ins. No additional packages beyond `tar` added in §2b.

---

## 4. package.json additions

In `banking_api_server/package.json`, add to the **scripts** section:

```json
"data:export": "node scripts/exportMigrationBundle.js",
"data:import": "node scripts/importMigrationBundle.js",
"data:preflight": "node scripts/importMigrationBundle.js --preflight-only"
```

`data:preflight` runs only Step 0 (package checks) and exits — useful for verifying the machine is ready before the user locates the archive file.

Add to the **dependencies** section:

```json
"tar": "^7.5.15"
```

**Why `banking_api_server/package.json` and not the root:** The scripts run from inside `banking_api_server/` via `npm run data:export`. Node's `require('tar')` walks up from `banking_api_server/node_modules/` — it will find the root-level `tar` if a root `npm install` was run, but this is fragile on a fresh clone where only `banking_api_server/` dependencies are installed. Declaring it explicitly in `banking_api_server/package.json` makes the dependency self-contained.

> Note: `tar ^7.5.15` is already present in the root `package.json`. Pin the same major version here for consistency.

---

## 5. Tests

**File:** `banking_api_server/scripts/__tests__/migrationBundle.test.js`

| Test | What it verifies |
|------|-----------------|
| Export creates valid archive | `.tar.gz` exists, `manifest.json` inside has version 2 and files array |
| Export manifest excludes sessions.db | `manifest.files` does not contain `sessions.db` |
| Export includes .env when present | Archive contains `.env` entry |
| Export warns but continues when .env missing | stdout contains warning; archive still created; `manifest.hasEnv === false` |
| Export opens .db files read-only when server is up | Mock port check to return 200; verify `{ readonly: true }` is passed to Database constructor |
| Import refuses when server is running | Mock port check to return 200; verify exit 1 with write-lock message |
| Import creates backup before writing | Verify `data/backups/pre-import-*/` created and contains original files |
| Import writes .env to disk | Verify `banking_api_server/.env` exists and contains expected keys after import |
| Import backs up existing .env | Verify `.env.pre-import-<timestamp>` exists if .env was present before import |
| Import health check catches AES mismatch | Mock `configStore.ensureInitialized()` to throw; verify exit 1 with SESSION_SECRET message and rollback instructions |
| Import with corrupt archive exits 1 | Pass a truncated `.tar.gz`; verify non-zero exit with useful message |
| Import with v1 archive (no .env) warns and continues | manifest.version = 1; verify warning printed but import proceeds |
| Import skips sessions.db even if present in archive | Include `sessions.db` in test archive; verify it is NOT written to `data/` |

---

## 6. Acceptance criteria

1. `npm run data:export` creates a `.tar.gz` containing `manifest.json`, `.env`, and all 8 `data/persistent/` files.
2. `sessions.db` and `runtimeData.json` are absent from the archive.
3. Export stdout prints the security warning block.
4. Export succeeds with server running (read-only open) and with server stopped (normal open).
5. `npm run data:import -- <path>` with server running → exits 1 before touching any file.
6. Import creates `data/backups/pre-import-<timestamp>/` containing all pre-import files.
7. Import writes the bundled `.env` to `banking_api_server/.env`; backs up any existing `.env` first.
8. After import on a clean machine: `configStore.isConfigured()` returns `true` in the health check step.
9. After import with a valid archive, running `npm start` reaches `GET /api/health/readiness` (added in migration-onboarding-plan.md §3a) returning `configured: true` and `userOAuthConfigured: true`.
10. Import with wrong or missing `SESSION_SECRET` → exits 1 with the rollback command printed — not a silent app startup failure.
11. Import with a corrupt archive → exits 1 with a diff of expected vs found manifest fields.
12. Import skips `sessions.db` even if it is present in the archive.

---

## 7. Known failure modes

| Failure | Where it surfaces | Mitigation |
|---------|------------------|------------|
| `node_modules` absent on Machine B | Step 0 pre-flight | Auto-runs `npm install`; exits 1 if it fails |
| `tar` not installed (first run on Machine B) | Step 0 pre-flight | Exits 1 with `npm install` remediation before touching any file |
| `lmdb` native binary wrong arch/Node version | Step 0 pre-flight | Detected by in-memory open test; exits 1 with `npm rebuild lmdb` instructions |
| `lmdb` unavailable, `lmdb` fallback used | Step 0 pre-flight | Warns; import proceeds using built-in driver; health check still works |
| `lmdb` write lock during import | Step 2 port check | Port check → exit 1 before touching any file |
| Corrupt `.db` mid-copy during export | Step 3 read-only probe | `{ readonly: true }` open verifies file is readable before archiving |
| Disk full mid-archive write | Step 7 tar stream | Write to temp file; rename atomically; clean up temp on error |
| Disk full mid-extract during import | Step 6 extract | Backup already exists; rollback command printed in Step 8 |
| `SESSION_SECRET` mismatch despite bundled `.env` | Step 7 health check | Caught immediately with rollback instructions before server starts |
| User modifies `.env` after import but before server start | Step 7 health check | Same catch; backup `.env` path shown in error message |
| `.env` absent from archive (v1 archive) | Step 4 warning | Warns with manual copy instructions; does not abort |
| `sessions.db` accidentally copied into archive by user | Step 6 extract | Explicit skip list in extraction logic |
| Archive from different OS (line endings in JSON) | Not a risk | LMDB binary format is cross-platform; JSON parsing ignores line endings |
| Node version mismatch (different `lmdb` native binary) | Step 7 health check | Log `sourceNodeVersion` from manifest as advisory warning; `lmdb` may need `npm rebuild` — document this |

---

## 8. Out of scope

- Encrypting the archive itself — user is responsible for secure transfer.
- Partial imports (e.g. data only, no `.env`) — out of scope; use `--no-env` flag as a future enhancement if needed.
- Remote push/pull (e.g. S3 upload) — out of scope; script outputs a local file.
- Windows path separator differences — the archive uses POSIX paths internally; extraction uses `path.join()` which handles both platforms.
