# Session Store Rename & Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On branch `fix/mcp-403-deny-reason`, remove naming confusion around the session store by deleting dead files, renaming the live LMDB session store to `sessionStore.js`, and fixing the one path bug in the test helper.

**Architecture:** The LMDB branch uses `services/lmdb/sessionStore.lmdb.js` (via `openEnv()` → `data/persistent/lmdb/`) as the sole session store. A top-level `services/lmdbSessionStore.js` exists but is never imported — it is dead code that uses a different path (`data/sessions-lmdb/`). The test helper `session.js` correctly reads `data/persistent/lmdb/` via `loadFromLmdb()`. The old `services/sqliteSessionStore.js` is also dead (not imported by `server.js` on this branch). Clean-up: delete the two dead files, rename the live adapter to `sessionStore.js`, update the one `require` in `server.js`, and fix `server.js`'s `require` path.

**Tech Stack:** Node.js (CommonJS), `lmdb` npm package, `express-session`, `jest` (real-API test suite).

**Branch:** `fix/mcp-403-deny-reason` — all work happens here.

---

## File Map

| Action | File | Why |
|--------|------|-----|
| **Delete** | `demo_api_server/services/lmdbSessionStore.js` | Dead — never imported; uses wrong path (`data/sessions-lmdb/`) |
| **Delete** | `demo_api_server/services/sqliteSessionStore.js` | Dead — `server.js` on this branch no longer imports it |
| **Rename** | `demo_api_server/services/lmdb/sessionStore.lmdb.js` → `demo_api_server/services/lmdb/sessionStore.js` | Remove the `.lmdb` double-extension; it's the canonical session store, not a draft adapter |
| **Modify** | `demo_api_server/server.js` | Update `require('./services/lmdb/sessionStore.lmdb')` → `require('./services/lmdb/sessionStore')` |
| **No change** | `demo_api_server/tests/real/helpers/session.js` | `loadFromLmdb()` already reads the correct path (`data/persistent/lmdb/`) — no bug here |
| **No change** | `demo_api_server/services/lmdb/openEnv.js` | Correct; defines `data/persistent/lmdb/` as the canonical path |

---

## Task 1: Switch to the right branch

**Files:** none

- [ ] **Step 1: Confirm current branch and switch**

  ```bash
  cd /path/to/AI-Demo
  git status          # confirm working tree is clean
  git checkout fix/mcp-403-deny-reason
  git log --oneline -3
  ```

  Expected: branch is `fix/mcp-403-deny-reason`, last commit shows the LMDB wire-in work.

---

## Task 2: Delete `lmdbSessionStore.js` (dead top-level file)

**Files:**
- Delete: `demo_api_server/services/lmdbSessionStore.js`

This file uses `data/sessions-lmdb/` (a different path from the canonical `data/persistent/lmdb/`) and is never imported by anything.

- [ ] **Step 1: Verify nothing imports it**

  ```bash
  grep -r "lmdbSessionStore" demo_api_server/ --include="*.js" --exclude-dir=node_modules
  ```

  Expected: **no output** (zero references).

- [ ] **Step 2: Delete the file**

  ```bash
  git rm demo_api_server/services/lmdbSessionStore.js
  ```

  Expected: `rm 'demo_api_server/services/lmdbSessionStore.js'`

- [ ] **Step 3: Commit**

  ```bash
  git commit -m "chore(session): delete orphaned lmdbSessionStore.js (never imported, wrong path)"
  ```

---

## Task 3: Delete `sqliteSessionStore.js` (dead SQLite file)

**Files:**
- Delete: `demo_api_server/services/sqliteSessionStore.js`

On this branch `server.js` no longer imports `SqliteSessionStore` — it goes straight to LMDB. The SQLite file is dead code and its name actively misleads anyone reading the codebase.

- [ ] **Step 1: Verify nothing imports it**

  ```bash
  grep -r "sqliteSessionStore\|SqliteSessionStore" demo_api_server/ --include="*.js" --exclude-dir=node_modules
  ```

  Expected: **no output** (zero references on this branch).

- [ ] **Step 2: Delete the file**

  ```bash
  git rm demo_api_server/services/sqliteSessionStore.js
  ```

  Expected: `rm 'demo_api_server/services/sqliteSessionStore.js'`

- [ ] **Step 3: Commit**

  ```bash
  git commit -m "chore(session): delete sqliteSessionStore.js — superseded by LMDB on this branch"
  ```

---

## Task 4: Rename `sessionStore.lmdb.js` → `sessionStore.js`

**Files:**
- Rename: `demo_api_server/services/lmdb/sessionStore.lmdb.js` → `demo_api_server/services/lmdb/sessionStore.js`
- Modify: `demo_api_server/server.js` (update require path)

The `.lmdb` infix in the filename was a convention used during the "adapters not yet wired in" phase (see the original plan). Now that it is the live session store, the double extension `.lmdb.js` is noise. All other wired-in adapters in `services/lmdb/` that were NOT wired in still carry the `.lmdb.js` extension — but this one is the canonical implementation, so it gets the plain name.

- [ ] **Step 1: Rename with git mv**

  ```bash
  git mv demo_api_server/services/lmdb/sessionStore.lmdb.js \
         demo_api_server/services/lmdb/sessionStore.js
  ```

  Expected: no output (silent success).

- [ ] **Step 2: Update `server.js` require**

  Open `demo_api_server/server.js`. Find this line (around line 54):

  ```js
  const { LmdbSessionStore } = require('./services/lmdb/sessionStore.lmdb');
  ```

  Change it to:

  ```js
  const { LmdbSessionStore } = require('./services/lmdb/sessionStore');
  ```

  Nothing else in this block changes.

- [ ] **Step 3: Verify the rest of the server.js block is correct**

  The surrounding block should look exactly like this after your edit:

  ```js
  // ── Session store ──
  /** 'lmdb' | 'memory' */
  let sessionStoreType = 'memory';
  let sessionStore;

  // ── LMDB store (no native ABI dependency — works across all Node versions) ──
  try {
      const { LmdbSessionStore } = require('./services/lmdb/sessionStore');
      sessionStore = new LmdbSessionStore({ ttl: 24 * 60 * 60 * 1000 });
      sessionStoreType = 'lmdb';
      console.log('[session-store] Using LMDB store — sessions persist across restarts without native ABI dependency');
  } catch (err) {
      console.warn('[session-store] LMDB store init failed, falling back to memory store:', err.message);
  }
  ```

- [ ] **Step 4: Smoke-test the require resolves**

  ```bash
  cd demo_api_server
  node -e "const { LmdbSessionStore } = require('./services/lmdb/sessionStore'); console.log('OK', typeof LmdbSessionStore);"
  ```

  Expected: `OK function`

- [ ] **Step 5: Commit**

  ```bash
  git add demo_api_server/services/lmdb/sessionStore.js \
          demo_api_server/server.js
  git commit -m "refactor(session): rename sessionStore.lmdb.js → sessionStore.js, update require in server.js"
  ```

---

## Task 5: Update the lmdb/README.md wire-in guide

**Files:**
- Modify: `demo_api_server/services/lmdb/README.md`

The README was written before wire-in and still says `sessionStore.lmdb.js` in the table. Update it to reflect reality: the session store is already wired in as `sessionStore.js`, and `sqliteSessionStore.js` is gone.

- [ ] **Step 1: Open the README**

  ```bash
  cat demo_api_server/services/lmdb/README.md
  ```

- [ ] **Step 2: Replace the file content**

  Write `demo_api_server/services/lmdb/README.md` with:

  ```markdown
  # LMDB Storage Layer

  All persistent data for this service uses LMDB (via the `lmdb` npm package).
  Sessions, config, banking data, transactions, delegations, and demo accounts
  are stored in `data/persistent/lmdb/` as named sub-databases.

  ## Data directory

  All LMDB data lives in `demo_api_server/data/persistent/lmdb/` (two files: `data.mdb`, `lock.mdb`).
  Back this up alongside any other persistent data.

  ## File map

  | File | Role | Status |
  |------|------|--------|
  | `openEnv.js` | Shared LMDB environment + named sub-DB accessor | Wired in (used by all adapters) |
  | `sessionStore.js` | `express-session` Store backed by LMDB `sessions` sub-DB | **Wired in** — imported by `server.js` |
  | `configStore.lmdb.js` | Config persistence (`config` sub-DB) | Wired in via `configStore.js` |
  | `bankingDb.lmdb.js` | Banking resource server accounts + transactions | Wired in via `bankingDb.js` |
  | `transactionStore.lmdb.js` | In-memory store transaction persistence | Wired in via `data/store.js` |
  | `delegationStore.lmdb.js` | Delegation grants and revocations | Wired in via `delegationService.js` |
  | `demoAccountStore.lmdb.js` | Demo account CRUD | Wired in via `demoDataService.js` |
  | `migrate.js` | One-shot SQLite → LMDB migration script (run once, offline) | Standalone script |

  ## Migration (already done for existing installs)

  If setting up a brand-new install from scratch, LMDB is seeded automatically on first boot.
  If migrating from an older SQLite install:

  ```bash
  # Stop the server first, then:
  node demo_api_server/services/lmdb/migrate.js
  ```
  ```

- [ ] **Step 3: Commit**

  ```bash
  git add demo_api_server/services/lmdb/README.md
  git commit -m "docs(lmdb): update README to reflect wired-in state and sessionStore rename"
  ```

---

## Task 6: Verify the real test suite can now find sessions

**Files:** none (verification only)

This confirms the existing `loadFromLmdb()` in `tests/real/helpers/session.js` works with the sessions written by `services/lmdb/sessionStore.js`.

- [ ] **Step 1: Confirm the BFF is running and you are logged in**

  ```bash
  curl -sk https://api.ping.demo:3001/api/health | jq .status
  ```

  Expected: `"ok"` (or similar — just confirm it responds).

  If the BFF is not running, start it: `./run.sh` from the repo root. Then log in at `https://api.ping.demo:4000`.

- [ ] **Step 2: Confirm sessions exist in LMDB with a valid access token**

  ```bash
  cd demo_api_server
  node -e "
  const { open } = require('lmdb');
  const path = require('path');
  const env = open({ path: path.resolve('data/persistent/lmdb'), maxDbs: 16, encoding: 'json', readOnly: true });
  const db = env.openDB('sessions', { encoding: 'json' });
  const now = Date.now(); const nowSec = Math.floor(now / 1000);
  let found = 0;
  for (const { key, value } of db.getRange()) {
    if (!value || value.expire <= now) continue;
    const at = value.sess?.oauthTokens?.accessToken;
    if (!at) continue;
    const payload = JSON.parse(Buffer.from(at.split('.')[1], 'base64url').toString());
    if (payload.exp > nowSec) { found++; console.log('valid session:', key.slice(0,20), 'oauthType:', value.sess?.oauthType); }
  }
  env.close();
  console.log('Total valid sessions with token:', found);
  "
  ```

  Expected: at least one valid session printed, `Total valid sessions with token: 1` (or more).

  If `found = 0`, log in via the browser at `https://api.ping.demo:4000` and re-run.

- [ ] **Step 3: Run the real test suite**

  ```bash
  cd demo_api_server
  RUN_REAL_TESTS=true npx jest --config=jest.real.config.js 2>&1 | tail -20
  ```

  Expected: test suites run (not all skip with "No valid session"). Some may fail for unrelated reasons, but the session resolution itself should succeed — you will see `[globalSetup] Bootstrapping fixtures…` instead of `[globalSetup] No valid session found`.

- [ ] **Step 4: Commit verification note (no code change needed)**

  No commit needed — this task is read-only verification.

---

## Task 7: Final check — no stray references to old names

- [ ] **Step 1: Search for any remaining references to deleted/renamed files**

  ```bash
  cd demo_api_server
  grep -r "sqliteSessionStore\|SqliteSessionStore\|lmdbSessionStore\|sessionStore\.lmdb" \
    . --include="*.js" --include="*.ts" --include="*.md" \
    --exclude-dir=node_modules
  ```

  Expected: **no output** (zero matches).

- [ ] **Step 2: Confirm the lmdb services directory looks clean**

  ```bash
  ls demo_api_server/services/lmdb/
  ```

  Expected output (8 files, no `.lmdb.js` on sessionStore):

  ```
  README.md
  bankingDb.lmdb.js
  configStore.lmdb.js
  delegationStore.lmdb.js
  demoAccountStore.lmdb.js
  migrate.js
  openEnv.js
  sessionStore.js
  transactionStore.lmdb.js
  ```

- [ ] **Step 3: Run the mocked unit test suite to confirm no breakage**

  ```bash
  cd demo_api_server
  npx jest --passWithNoTests 2>&1 | tail -10
  ```

  Expected: all tests pass (exit 0).

- [ ] **Step 4: Tag the cleanup with a final commit if anything was missed**

  If steps 1–3 are clean, no commit needed. If you found a stray reference and fixed it:

  ```bash
  git add -A
  git commit -m "chore(session): fix stray reference to old session store names"
  ```

---

## Summary

After these 7 tasks the branch has:

- **Deleted** `services/lmdbSessionStore.js` — orphan, wrong path, never imported
- **Deleted** `services/sqliteSessionStore.js` — superseded by LMDB on this branch
- **Renamed** `services/lmdb/sessionStore.lmdb.js` → `services/lmdb/sessionStore.js`
- **Updated** `server.js` require to match the new name
- **Updated** `services/lmdb/README.md` to reflect current wired-in state
- **Verified** the real test suite finds sessions via `loadFromLmdb()` without any changes to `session.js` (it was already correct)
