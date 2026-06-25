# LMDB Replacement Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a complete LMDB-backed storage layer that mirrors all 6 SQLite databases (config, sessions, banking-resource-server, banking/transactions, delegations, demoAccounts) with the same public API as their SQLite equivalents — ready to swap in but **not wired into the app** until explicitly requested.

**Architecture:** A single `demo_api_server/services/lmdb/` directory contains one adapter per database. Each adapter exports the same function signatures as its SQLite counterpart. A shared `openEnv.js` module manages the LMDB environment and named sub-databases. A `migrate.js` script copies live data from the existing SQLite files into LMDB. Nothing in the main app imports from `lmdb/` — it is dead code until the wire-in step.

**Tech Stack:** `lmdb` npm package (v3.5.4), Node 20+ (already required by repo), existing `better-sqlite3` for migration reads, `msgpackr` (bundled with `lmdb`) for value serialization.

---

## Why LMDB

- Memory-mapped: reads are zero-copy, lock-free for concurrent readers
- ACID transactions with crash safety (no journal files to corrupt)
- Single environment, multiple named databases — replaces 6 separate `.db` files
- No separate process or server required
- `lmdb` npm package has zero native build step on Node 20/22 (pre-built binaries)

---

## File Map

```
demo_api_server/
  services/
    lmdb/
      openEnv.js              — opens/returns the shared LMDB Environment + named sub-DBs
      configStore.lmdb.js     — drop-in replacement API for configStore SQLite layer
      sessionStore.lmdb.js    — express-session Store subclass backed by LMDB
      bankingDb.lmdb.js       — drop-in for bankingDb.js public API
      transactionStore.lmdb.js — drop-in for data/store.js SQLite transaction layer
      delegationStore.lmdb.js — drop-in for delegationService.js SQLite layer
      demoAccountStore.lmdb.js — drop-in for demoDataService.js SQLite layer
      migrate.js              — one-shot migration: SQLite → LMDB for all 6 DBs
      README.md               — wire-in instructions for future swap
```

**Not modified:**
- `demo_api_server/services/configStore.js` — untouched
- `demo_api_server/services/sqliteSessionStore.js` — untouched
- `demo_api_server/services/bankingDb.js` — untouched
- `demo_api_server/data/store.js` — untouched
- `demo_api_server/services/delegationService.js` — untouched
- `demo_api_server/services/demoDataService.js` — untouched
- `demo_api_server/server.js` — untouched

---

## Task 1: Install lmdb

**Files:**
- Modify: `demo_api_server/package.json` (dependencies)

- [ ] **Step 1: Install**

  ```bash
  cd demo_api_server && npm install lmdb@3
  ```
  Expected: `added 1 package` (lmdb ships with pre-built binaries, no compile step)

- [ ] **Step 2: Verify the package loads**

  ```bash
  cd demo_api_server && node -e "const { open } = require('lmdb'); console.log('lmdb OK');"
  ```
  Expected: `lmdb OK`

- [ ] **Step 3: Commit**

  ```bash
  git add demo_api_server/package.json demo_api_server/package-lock.json
  git commit -m "chore(lmdb): install lmdb@3 for replacement storage layer"
  ```

---

## Task 2: Shared environment — openEnv.js

**Files:**
- Create: `demo_api_server/services/lmdb/openEnv.js`

- [ ] **Step 1: Create the file**

  ```js
  'use strict';
  /**
   * openEnv — shared LMDB environment for all sub-databases.
   *
   * All named databases live in data/persistent/lmdb/ (one directory, multiple
   * named sub-DBs). Call openEnv() to get the root env, then env.openDB(name)
   * for each sub-DB.
   *
   * NOT wired into the app. Imported only by lmdb/* adapters.
   */
  const path = require('path');
  const fs   = require('fs');
  const { open } = require('lmdb');

  const LMDB_PATH = path.join(__dirname, '../../data/persistent/lmdb');

  let _env = null;

  function openEnv() {
    if (_env) return _env;
    fs.mkdirSync(LMDB_PATH, { recursive: true });
    _env = open({
      path: LMDB_PATH,
      maxDbs: 12,
      mapSize: 128 * 1024 * 1024, // 128 MB — plenty for local dev
      noSync: false,               // crash-safe
    });
    return _env;
  }

  function closeEnv() {
    if (_env) { _env.close(); _env = null; }
  }

  module.exports = { openEnv, closeEnv, LMDB_PATH };
  ```

- [ ] **Step 2: Verify the environment opens**

  ```bash
  cd demo_api_server && node -e "
    const { openEnv, closeEnv } = require('./services/lmdb/openEnv');
    const env = openEnv();
    console.log('env opened at:', env.path || 'ok');
    closeEnv();
    console.log('closed OK');
    process.exit(0);
  "
  ```
  Expected: two lines, no error. Also `ls demo_api_server/data/persistent/lmdb/` should show `data.mdb` and `lock.mdb`.

- [ ] **Step 3: Commit**

  ```bash
  git add demo_api_server/services/lmdb/openEnv.js
  git commit -m "feat(lmdb): add shared LMDB environment module"
  ```

---

## Task 3: Config adapter — configStore.lmdb.js

**Files:**
- Create: `demo_api_server/services/lmdb/configStore.lmdb.js`

The SQLite layer in `configStore.js` exposes two private functions used internally:
- `_loadFromSQLite()` → returns array of `{ key, value }` rows
- `_upsertToSQLite(key, value)` → upserts one row

The LMDB adapter mirrors these exact signatures so it can be swapped in later.

- [ ] **Step 1: Create the file**

  ```js
  'use strict';
  /**
   * configStore.lmdb.js — LMDB-backed config persistence.
   *
   * Mirrors the SQLite layer in configStore.js:
   *   loadAll()           → [{ key, value, updated_at }]
   *   upsert(key, value)  → void
   *   remove(key)         → void
   *
   * NOT imported by configStore.js. Wire in by replacing _getSQLite() calls.
   */
  const { openEnv } = require('./openEnv');

  const DB_NAME = 'config';

  function _db() {
    return openEnv().openDB(DB_NAME, { encoding: 'json' });
  }

  function loadAll() {
    const db = _db();
    const rows = [];
    for (const { key, value } of db.getRange()) {
      rows.push({ key, value: value.value, updated_at: value.updated_at });
    }
    return rows;
  }

  function upsert(key, value) {
    const db = _db();
    db.putSync(key, { value, updated_at: new Date().toISOString() });
  }

  function remove(key) {
    const db = _db();
    db.removeSync(key);
  }

  module.exports = { loadAll, upsert, remove };
  ```

- [ ] **Step 2: Write a quick test**

  ```bash
  cd demo_api_server && node -e "
    const { loadAll, upsert, remove } = require('./services/lmdb/configStore.lmdb');
    upsert('test_key', 'hello');
    const rows = loadAll();
    const found = rows.find(r => r.key === 'test_key');
    console.assert(found && found.value === 'hello', 'upsert/loadAll failed');
    remove('test_key');
    const after = loadAll().find(r => r.key === 'test_key');
    console.assert(!after, 'remove failed');
    console.log('configStore.lmdb OK');
    process.exit(0);
  "
  ```
  Expected: `configStore.lmdb OK`

- [ ] **Step 3: Commit**

  ```bash
  git add demo_api_server/services/lmdb/configStore.lmdb.js
  git commit -m "feat(lmdb): add config adapter (not wired in)"
  ```

---

## Task 4: Session store adapter — sessionStore.lmdb.js

**Files:**
- Create: `demo_api_server/services/lmdb/sessionStore.lmdb.js`

Must implement the `express-session` Store interface: `get`, `set`, `destroy`, `all`, `length`, `clear`, plus automatic TTL expiry. Mirrors `sqliteSessionStore.js` public API.

- [ ] **Step 1: Create the file**

  ```js
  'use strict';
  /**
   * sessionStore.lmdb.js — LMDB-backed express-session store.
   *
   * Implements the express-session Store interface (same surface as
   * sqliteSessionStore.js). Entries are stored as { sess, expire } objects.
   * Expired sessions are pruned on get() and by an hourly cleanup interval.
   *
   * NOT wired into server.js. Replace SqliteSessionStore with LmdbSessionStore
   * in server.js to activate.
   */
  const { Store } = require('express-session');
  const { openEnv } = require('./openEnv');

  const DB_NAME = 'sessions';
  const ONE_HOUR_MS = 60 * 60 * 1000;

  class LmdbSessionStore extends Store {
    constructor(options = {}) {
      super();
      this.ttl = options.ttl || 24 * 60 * 60 * 1000; // 24h default
      this._db = openEnv().openDB(DB_NAME, { encoding: 'json' });
      this._startCleanup();
    }

    _startCleanup() {
      this._cleanupInterval = setInterval(() => this._cleanup(), ONE_HOUR_MS);
      if (this._cleanupInterval.unref) this._cleanupInterval.unref();
    }

    _cleanup() {
      const now = Date.now();
      for (const { key, value } of this._db.getRange()) {
        if (value.expire <= now) this._db.removeSync(key);
      }
    }

    get(sid, cb) {
      try {
        const entry = this._db.get(sid);
        if (!entry || entry.expire <= Date.now()) return cb(null, null);
        cb(null, entry.sess);
      } catch (e) { cb(e); }
    }

    set(sid, sess, cb) {
      try {
        const maxAge = sess.cookie && sess.cookie.maxAge ? sess.cookie.maxAge * 1000 : this.ttl;
        const expire = Date.now() + maxAge;
        this._db.putSync(sid, { sess, expire });
        cb(null);
      } catch (e) { cb(e); }
    }

    destroy(sid, cb) {
      try {
        this._db.removeSync(sid);
        cb(null);
      } catch (e) { cb(e); }
    }

    all(cb) {
      try {
        const now = Date.now();
        const sessions = {};
        for (const { key, value } of this._db.getRange()) {
          if (value.expire > now) sessions[key] = value.sess;
        }
        cb(null, sessions);
      } catch (e) { cb(e); }
    }

    length(cb) {
      try {
        const now = Date.now();
        let count = 0;
        for (const { value } of this._db.getRange()) {
          if (value.expire > now) count++;
        }
        cb(null, count);
      } catch (e) { cb(e); }
    }

    clear(cb) {
      try {
        this._db.clearSync();
        cb(null);
      } catch (e) { cb(e); }
    }

    close() {
      clearInterval(this._cleanupInterval);
    }
  }

  module.exports = { LmdbSessionStore };
  ```

- [ ] **Step 2: Verify the store works**

  ```bash
  cd demo_api_server && node -e "
    const { LmdbSessionStore } = require('./services/lmdb/sessionStore.lmdb');
    const store = new LmdbSessionStore({ ttl: 5000 });
    const sess = { cookie: { maxAge: 5 }, userId: 'u1' };
    store.set('sid-test', sess, (err) => {
      if (err) throw err;
      store.get('sid-test', (err2, s) => {
        if (err2) throw err2;
        console.assert(s && s.userId === 'u1', 'get failed');
        store.destroy('sid-test', () => {
          store.length((e, n) => {
            console.log('sessionStore.lmdb OK, count after destroy:', n);
            store.close();
            process.exit(0);
          });
        });
      });
    });
  "
  ```
  Expected: `sessionStore.lmdb OK, count after destroy: 0`

- [ ] **Step 3: Commit**

  ```bash
  git add demo_api_server/services/lmdb/sessionStore.lmdb.js
  git commit -m "feat(lmdb): add session store adapter (not wired in)"
  ```

---

## Task 5: Banking resource server adapter — bankingDb.lmdb.js

**Files:**
- Create: `demo_api_server/services/lmdb/bankingDb.lmdb.js`

Mirrors the public API of `bankingDb.js`: `initBankingDb()`, `getAccountsByUserId(userId)`, `getTransactionsByUserId(userId, limit?)`.

- [ ] **Step 1: Create the file**

  ```js
  'use strict';
  /**
   * bankingDb.lmdb.js — LMDB-backed banking resource server storage.
   *
   * Mirrors bankingDb.js public API:
   *   initBankingDb()                          → Promise<void>
   *   getAccountsByUserId(userId)              → account[]
   *   getTransactionsByUserId(userId, limit?)  → transaction[]
   *   upsertAccount(account)                   → void
   *   upsertTransaction(tx)                    → void
   *
   * Accounts keyed as `acct:<id>`, indexed by `acct_user:<userId>:<id>`.
   * Transactions keyed as `tx:<id>`, indexed by `tx_user:<userId>:<createdAt>:<id>`.
   *
   * NOT imported by bankingDb.js. Wire in by replacing bankingDb.js imports.
   */
  const { openEnv } = require('./openEnv');

  const ACCT_DB  = 'banking_accounts';
  const TX_DB    = 'banking_transactions';

  let _initialized = false;

  function _accounts() { return openEnv().openDB(ACCT_DB, { encoding: 'json' }); }
  function _txns()     { return openEnv().openDB(TX_DB,   { encoding: 'json' }); }

  async function initBankingDb() {
    _initialized = true;
  }

  function getAccountsByUserId(userId) {
    const db = _accounts();
    const prefix = `user:${userId}:`;
    const results = [];
    for (const { value } of db.getRange({ start: prefix, end: prefix + '\xFF' })) {
      results.push(value);
    }
    return results;
  }

  function getTransactionsByUserId(userId, limit = 50) {
    const db = _txns();
    const prefix = `user:${userId}:`;
    const results = [];
    for (const { value } of db.getRange({ start: prefix, end: prefix + '\xFF', reverse: true, limit })) {
      results.push(value);
    }
    return results;
  }

  function upsertAccount(account) {
    const db = _accounts();
    // Primary key
    db.putSync(`id:${account.id}`, account);
    // User index — key encodes userId + id for range scan
    db.putSync(`user:${account.userId}:${account.id}`, account);
  }

  function upsertTransaction(tx) {
    const db = _txns();
    db.putSync(`id:${tx.id}`, tx);
    // User index — key encodes userId + createdAt for reverse-time range scan
    const ts = tx.createdAt || new Date().toISOString();
    db.putSync(`user:${tx.userId}:${ts}:${tx.id}`, tx);
  }

  module.exports = { initBankingDb, getAccountsByUserId, getTransactionsByUserId, upsertAccount, upsertTransaction };
  ```

- [ ] **Step 2: Verify**

  ```bash
  cd demo_api_server && node -e "
    const { initBankingDb, upsertAccount, upsertTransaction, getAccountsByUserId, getTransactionsByUserId } = require('./services/lmdb/bankingDb.lmdb');
    initBankingDb().then(() => {
      upsertAccount({ id: 'a1', userId: 'u1', accountType: 'checking', name: 'Test', balance: 100, currency: 'USD', status: 'active', accountNumber: '0001' });
      upsertTransaction({ id: 't1', userId: 'u1', accountId: 'a1', type: 'deposit', amount: 50, description: 'test', createdAt: new Date().toISOString() });
      const accts = getAccountsByUserId('u1');
      const txns  = getTransactionsByUserId('u1');
      console.assert(accts.length >= 1, 'accounts missing');
      console.assert(txns.length  >= 1, 'transactions missing');
      console.log('bankingDb.lmdb OK — accounts:', accts.length, 'txns:', txns.length);
      process.exit(0);
    });
  "
  ```
  Expected: `bankingDb.lmdb OK — accounts: 1 txns: 1`

- [ ] **Step 3: Commit**

  ```bash
  git add demo_api_server/services/lmdb/bankingDb.lmdb.js
  git commit -m "feat(lmdb): add banking resource server adapter (not wired in)"
  ```

---

## Task 6: Transaction store adapter — transactionStore.lmdb.js

**Files:**
- Create: `demo_api_server/services/lmdb/transactionStore.lmdb.js`

Mirrors the SQLite layer inside `data/store.js` — the `DataStore` persists transactions to `banking.db`. The LMDB adapter exposes `persistTransaction(tx)` and `loadTransactions()` with the same shape.

- [ ] **Step 1: Create the file**

  ```js
  'use strict';
  /**
   * transactionStore.lmdb.js — LMDB-backed transaction persistence.
   *
   * Mirrors the SQLite layer in data/store.js:
   *   persistTransaction(tx)   → void  (upsert one transaction)
   *   loadTransactions()       → transaction[]  (all stored transactions)
   *   removeTransaction(id)    → void
   *
   * Transaction shape from data/store.js:
   *   { id, userId, fromAccountId, toAccountId, amount, type, description,
   *     merchant, category, status, createdAt, updatedAt }
   *
   * NOT imported by data/store.js. Wire in by replacing the SQLite upsert calls
   * inside _initializeSQLiteTransactions and addTransaction.
   */
  const { openEnv } = require('./openEnv');

  const DB_NAME = 'transactions';

  function _db() { return openEnv().openDB(DB_NAME, { encoding: 'json' }); }

  function persistTransaction(tx) {
    _db().putSync(tx.id, tx);
  }

  function loadTransactions() {
    const results = [];
    for (const { value } of _db().getRange()) {
      results.push(value);
    }
    return results;
  }

  function removeTransaction(id) {
    _db().removeSync(id);
  }

  module.exports = { persistTransaction, loadTransactions, removeTransaction };
  ```

- [ ] **Step 2: Verify**

  ```bash
  cd demo_api_server && node -e "
    const { persistTransaction, loadTransactions, removeTransaction } = require('./services/lmdb/transactionStore.lmdb');
    persistTransaction({ id: 'tx-test', userId: 'u1', fromAccountId: 'a1', toAccountId: null, amount: 25, type: 'transfer', description: 'test', merchant: null, category: null, status: 'completed', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    const all = loadTransactions();
    const found = all.find(t => t.id === 'tx-test');
    console.assert(found && found.amount === 25, 'persist/load failed');
    removeTransaction('tx-test');
    const after = loadTransactions().find(t => t.id === 'tx-test');
    console.assert(!after, 'remove failed');
    console.log('transactionStore.lmdb OK');
    process.exit(0);
  "
  ```
  Expected: `transactionStore.lmdb OK`

- [ ] **Step 3: Commit**

  ```bash
  git add demo_api_server/services/lmdb/transactionStore.lmdb.js
  git commit -m "feat(lmdb): add transaction store adapter (not wired in)"
  ```

---

## Task 7: Delegation store adapter — delegationStore.lmdb.js

**Files:**
- Create: `demo_api_server/services/lmdb/delegationStore.lmdb.js`

Mirrors `delegationService.js` storage functions: `grantDelegation`, `revokeDelegation`, `getDelegations`.

- [ ] **Step 1: Create the file**

  ```js
  'use strict';
  /**
   * delegationStore.lmdb.js — LMDB-backed delegation storage.
   *
   * Mirrors the SQLite layer in delegationService.js:
   *   grantDelegation(delegation)         → { id }
   *   revokeDelegation(id)                → void
   *   getDelegations(userId)              → delegation[]  (delegator OR delegate)
   *   getDelegationById(id)               → delegation | null
   *
   * Delegation shape:
   *   { id, delegator_user_id, delegate_user_id, delegate_email,
   *     delegator_email, scopes, status, granted_at, revoked_at }
   *
   * scopes stored as JS array (not JSON string — LMDB serialises natively).
   *
   * NOT imported by delegationService.js. Wire in by replacing the SQLite
   * getStorage() branch.
   */
  const { v4: uuidv4 } = require('uuid');
  const { openEnv } = require('./openEnv');

  const DB_NAME = 'delegations';

  function _db() { return openEnv().openDB(DB_NAME, { encoding: 'json' }); }

  function grantDelegation({ delegator_user_id, delegate_user_id, delegate_email, delegator_email, scopes, status = 'active' }) {
    const id = uuidv4();
    const record = {
      id,
      delegator_user_id,
      delegate_user_id: delegate_user_id || null,
      delegate_email,
      delegator_email: delegator_email || null,
      scopes: Array.isArray(scopes) ? scopes : [],
      status,
      granted_at: new Date().toISOString(),
      revoked_at: null,
    };
    _db().putSync(id, record);
    return { id };
  }

  function revokeDelegation(id) {
    const db = _db();
    const record = db.get(id);
    if (!record) return;
    db.putSync(id, { ...record, status: 'revoked', revoked_at: new Date().toISOString() });
  }

  function getDelegations(userId) {
    const results = [];
    for (const { value } of _db().getRange()) {
      if (value.delegator_user_id === userId || value.delegate_user_id === userId) {
        results.push(value);
      }
    }
    return results;
  }

  function getDelegationById(id) {
    return _db().get(id) || null;
  }

  module.exports = { grantDelegation, revokeDelegation, getDelegations, getDelegationById };
  ```

- [ ] **Step 2: Verify**

  ```bash
  cd demo_api_server && node -e "
    const { grantDelegation, revokeDelegation, getDelegations, getDelegationById } = require('./services/lmdb/delegationStore.lmdb');
    const { id } = grantDelegation({ delegator_user_id: 'u1', delegate_email: 'b@b.com', scopes: ['read'] });
    const found = getDelegationById(id);
    console.assert(found && found.status === 'active', 'grant failed');
    revokeDelegation(id);
    const after = getDelegationById(id);
    console.assert(after && after.status === 'revoked', 'revoke failed');
    const list = getDelegations('u1');
    console.assert(list.length >= 1, 'getDelegations failed');
    console.log('delegationStore.lmdb OK');
    process.exit(0);
  "
  ```
  Expected: `delegationStore.lmdb OK`

- [ ] **Step 3: Commit**

  ```bash
  git add demo_api_server/services/lmdb/delegationStore.lmdb.js
  git commit -m "feat(lmdb): add delegation store adapter (not wired in)"
  ```

---

## Task 8: Demo accounts adapter — demoAccountStore.lmdb.js

**Files:**
- Create: `demo_api_server/services/lmdb/demoAccountStore.lmdb.js`

Mirrors `demoDataService.js`: `getDemoAccounts(userId?)`, `createDemoAccount(data)`, `deleteDemoAccount(id, userId)`.

- [ ] **Step 1: Create the file**

  ```js
  'use strict';
  /**
   * demoAccountStore.lmdb.js — LMDB-backed demo account storage.
   *
   * Mirrors demoDataService.js public API:
   *   getDemoAccounts(userId?)              → account[]
   *   createDemoAccount(accountData)        → account
   *   deleteDemoAccount(accountId, userId)  → boolean
   *
   * Account shape:
   *   { id, userId, accountType, accountNumber, routingNumber,
   *     balance, currency, status, createdAt }
   *
   * NOT imported by demoDataService.js. Wire in by replacing the SQLite
   * module-level init and query functions.
   */
  const { v4: uuidv4 } = require('uuid');
  const { openEnv } = require('./openEnv');

  const DB_NAME = 'demo_accounts';

  function _db() { return openEnv().openDB(DB_NAME, { encoding: 'json' }); }

  function getDemoAccounts(userId) {
    const results = [];
    for (const { value } of _db().getRange()) {
      if (!userId || value.userId === userId) results.push(value);
    }
    return results;
  }

  function createDemoAccount({ userId, accountType, accountNumber, routingNumber, balance, currency = 'USD', status = 'active' }) {
    const account = {
      id: uuidv4(),
      userId,
      accountType,
      accountNumber,
      routingNumber,
      balance,
      currency,
      status,
      createdAt: new Date().toISOString(),
    };
    _db().putSync(account.id, account);
    return account;
  }

  function deleteDemoAccount(accountId, userId) {
    const db = _db();
    const existing = db.get(accountId);
    if (!existing || existing.userId !== userId) return false;
    db.removeSync(accountId);
    return true;
  }

  module.exports = { getDemoAccounts, createDemoAccount, deleteDemoAccount };
  ```

- [ ] **Step 2: Verify**

  ```bash
  cd demo_api_server && node -e "
    const { getDemoAccounts, createDemoAccount, deleteDemoAccount } = require('./services/lmdb/demoAccountStore.lmdb');
    const acct = createDemoAccount({ userId: 'u1', accountType: 'savings', accountNumber: '0001', routingNumber: '9999', balance: 500, currency: 'USD' });
    const list = getDemoAccounts('u1');
    console.assert(list.find(a => a.id === acct.id), 'create/get failed');
    const deleted = deleteDemoAccount(acct.id, 'u1');
    console.assert(deleted, 'delete failed');
    console.assert(getDemoAccounts('u1').find(a => a.id === acct.id) === undefined, 'still present after delete');
    console.log('demoAccountStore.lmdb OK');
    process.exit(0);
  "
  ```
  Expected: `demoAccountStore.lmdb OK`

- [ ] **Step 3: Commit**

  ```bash
  git add demo_api_server/services/lmdb/demoAccountStore.lmdb.js
  git commit -m "feat(lmdb): add demo accounts adapter (not wired in)"
  ```

---

## Task 9: Migration script — migrate.js

**Files:**
- Create: `demo_api_server/services/lmdb/migrate.js`

One-shot script: reads all data from the 6 live SQLite files and writes it into the LMDB sub-databases. Idempotent (uses putSync — re-running overwrites with same data). Safe to run while the server is stopped.

- [ ] **Step 1: Create the file**

  ```js
  'use strict';
  /**
   * migrate.js — one-shot SQLite → LMDB migration.
   *
   * Run once (while server is stopped) to copy all live data into LMDB:
   *   node demo_api_server/services/lmdb/migrate.js
   *
   * Idempotent: re-running overwrites LMDB with current SQLite state.
   * Does not modify any SQLite files.
   *
   * Reports counts for each database on completion.
   */
  const path    = require('path');
  const fs      = require('fs');
  const Database = require('better-sqlite3');

  const { openEnv, closeEnv } = require('./openEnv');
  const configLmdb      = require('./configStore.lmdb');
  const { upsertAccount, upsertTransaction } = require('./bankingDb.lmdb');
  const { persistTransaction }               = require('./transactionStore.lmdb');
  const { grantDelegation }                  = require('./delegationStore.lmdb');
  const { createDemoAccount }                = require('./demoAccountStore.lmdb');

  const DATA_DIR  = path.join(__dirname, '../../data/persistent');
  const SESS_PATH = path.join(__dirname, '../../data/sessions.db');

  function openSqlite(dbPath) {
    if (!fs.existsSync(dbPath)) return null;
    return new Database(dbPath, { readonly: true });
  }

  function migrateConfig() {
    const db = openSqlite(path.join(DATA_DIR, 'config.db'));
    if (!db) { console.log('[migrate] config.db not found — skipping'); return 0; }
    const rows = db.prepare('SELECT key, value FROM config').all();
    db.close();
    for (const { key, value } of rows) configLmdb.upsert(key, value);
    console.log(`[migrate] config: ${rows.length} rows`);
    return rows.length;
  }

  function migrateSessions() {
    const db = openSqlite(SESS_PATH);
    if (!db) { console.log('[migrate] sessions.db not found — skipping'); return 0; }
    const { LmdbSessionStore } = require('./sessionStore.lmdb');
    const store = new LmdbSessionStore();
    const now = Date.now();
    const rows = db.prepare('SELECT sid, sess, expire FROM sessions WHERE expire > ?').all(now);
    db.close();
    let count = 0;
    for (const { sid, sess, expire } of rows) {
      try {
        const parsed = JSON.parse(sess);
        store._db.putSync(sid, { sess: parsed, expire });
        count++;
      } catch (_) {}
    }
    store.close();
    console.log(`[migrate] sessions: ${count} active sessions`);
    return count;
  }

  function migrateBankingResourceServer() {
    const db = openSqlite(path.join(DATA_DIR, 'banking-resource-server.db'));
    if (!db) { console.log('[migrate] banking-resource-server.db not found — skipping'); return { accounts: 0, txns: 0 }; }
    const accounts = db.prepare('SELECT * FROM accounts').all();
    const txns     = db.prepare('SELECT * FROM transactions').all();
    db.close();
    for (const a of accounts) upsertAccount(a);
    for (const t of txns)     upsertTransaction(t);
    console.log(`[migrate] banking-resource-server: ${accounts.length} accounts, ${txns.length} transactions`);
    return { accounts: accounts.length, txns: txns.length };
  }

  function migrateBankingDb() {
    const db = openSqlite(path.join(DATA_DIR, 'banking.db'));
    if (!db) { console.log('[migrate] banking.db not found — skipping'); return 0; }
    const rows = db.prepare('SELECT * FROM transactions').all();
    db.close();
    for (const tx of rows) persistTransaction(tx);
    console.log(`[migrate] banking.db transactions: ${rows.length} rows`);
    return rows.length;
  }

  function migrateDelegations() {
    const db = openSqlite(path.join(DATA_DIR, 'delegations.db'));
    if (!db) { console.log('[migrate] delegations.db not found — skipping'); return 0; }
    const rows = db.prepare('SELECT * FROM delegations').all();
    db.close();
    const { openEnv: env } = require('./openEnv');
    const lmdbDb = env().openDB('delegations', { encoding: 'json' });
    for (const row of rows) {
      const record = { ...row, scopes: JSON.parse(row.scopes || '[]') };
      lmdbDb.putSync(record.id, record);
    }
    console.log(`[migrate] delegations: ${rows.length} rows`);
    return rows.length;
  }

  function migrateDemoAccounts() {
    const dbPath = path.join(process.cwd(), 'data', 'persistent', 'demoAccounts.db');
    const db = openSqlite(dbPath);
    if (!db) { console.log('[migrate] demoAccounts.db not found — skipping'); return 0; }
    const rows = db.prepare('SELECT * FROM demo_accounts').all();
    db.close();
    const lmdbDb = openEnv().openDB('demo_accounts', { encoding: 'json' });
    for (const row of rows) lmdbDb.putSync(row.id, row);
    console.log(`[migrate] demo_accounts: ${rows.length} rows`);
    return rows.length;
  }

  async function main() {
    console.log('[migrate] Starting SQLite → LMDB migration...');
    migrateConfig();
    migrateSessions();
    migrateBankingResourceServer();
    migrateBankingDb();
    migrateDelegations();
    migrateDemoAccounts();
    closeEnv();
    console.log('[migrate] Done. LMDB data at demo_api_server/data/persistent/lmdb/');
  }

  main().catch(e => { console.error('[migrate] FAILED:', e); process.exit(1); });
  ```

- [ ] **Step 2: Run the migration (server should be stopped)**

  ```bash
  cd demo_api_server && node services/lmdb/migrate.js
  ```
  Expected output (counts will vary):
  ```
  [migrate] Starting SQLite → LMDB migration...
  [migrate] config: 12 rows
  [migrate] sessions: 0 active sessions
  [migrate] banking-resource-server: 3 accounts, 15 transactions
  [migrate] banking.db transactions: 15 rows
  [migrate] delegations: 0 rows
  [migrate] demo_accounts: 0 rows
  [migrate] Done. LMDB data at demo_api_server/data/persistent/lmdb/
  ```
  Any `not found — skipping` lines are fine (db file may not exist yet in a fresh install).

- [ ] **Step 3: Verify LMDB directory was created**

  ```bash
  ls -lh demo_api_server/data/persistent/lmdb/
  ```
  Expected: `data.mdb` and `lock.mdb`

- [ ] **Step 4: Commit**

  ```bash
  git add demo_api_server/services/lmdb/migrate.js
  git commit -m "feat(lmdb): add one-shot SQLite-to-LMDB migration script"
  ```

---

## Task 10: Wire-in README

**Files:**
- Create: `demo_api_server/services/lmdb/README.md`

- [ ] **Step 1: Create the file**

  ```markdown
  # LMDB Storage Layer

  Drop-in replacements for all 6 SQLite databases. **Not wired into the app.**
  Run migration first, then swap imports per the table below.

  ## Migration

  Stop the server, then:
  ```bash
  node demo_api_server/services/lmdb/migrate.js
  ```

  ## Wire-in guide (when ready)

  | SQLite module | LMDB replacement | Change in |
  |---|---|---|
  | `services/configStore.js` `_getSQLite()` | `configStore.lmdb.js` `{ loadAll, upsert, remove }` | `configStore.js` ~line 430 |
  | `services/sqliteSessionStore.js` | `sessionStore.lmdb.js` `{ LmdbSessionStore }` | `server.js` ~line 54 |
  | `services/bankingDb.js` | `bankingDb.lmdb.js` same API | all `require('./bankingDb')` callers |
  | `data/store.js` SQLite layer | `transactionStore.lmdb.js` `{ persistTransaction, loadTransactions }` | `data/store.js` `_initializeSQLiteTransactions()` |
  | `services/delegationService.js` SQLite branch | `delegationStore.lmdb.js` same API | `delegationService.js` `getStorage()` |
  | `services/demoDataService.js` | `demoAccountStore.lmdb.js` same API | `demoDataService.js` module-level init |

  ## Data directory

  All LMDB data lives in `demo_api_server/data/persistent/lmdb/` (two files: `data.mdb`, `lock.mdb`).
  Add this path to backups alongside the existing `.db` files.
  ```

- [ ] **Step 2: Commit**

  ```bash
  git add demo_api_server/services/lmdb/README.md
  git commit -m "docs(lmdb): add wire-in guide for LMDB replacement layer"
  ```

---

## Task 11: Final verification

- [ ] **Step 1: Confirm nothing in the main app imports from lmdb/**

  ```bash
  grep -r "services/lmdb" demo_api_server/server.js demo_api_server/routes/ demo_api_server/middleware/ demo_api_server/services/configStore.js demo_api_server/services/sqliteSessionStore.js demo_api_server/services/bankingDb.js demo_api_server/data/store.js demo_api_server/services/delegationService.js demo_api_server/services/demoDataService.js 2>/dev/null
  ```
  Expected: **no output** (zero imports)

- [ ] **Step 2: Run the API test suite**

  ```bash
  cd demo_api_server && npx jest --passWithNoTests 2>&1 | tail -20
  ```
  Expected: all tests pass

- [ ] **Step 3: Build the UI**

  ```bash
  cd demo_api_ui && npm run build 2>&1 | tail -5
  ```
  Expected: exit code 0

- [ ] **Step 4: Confirm lmdb directory structure**

  ```bash
  find demo_api_server/services/lmdb -type f | sort
  ```
  Expected:
  ```
  demo_api_server/services/lmdb/README.md
  demo_api_server/services/lmdb/bankingDb.lmdb.js
  demo_api_server/services/lmdb/configStore.lmdb.js
  demo_api_server/services/lmdb/demoAccountStore.lmdb.js
  demo_api_server/services/lmdb/delegationStore.lmdb.js
  demo_api_server/services/lmdb/migrate.js
  demo_api_server/services/lmdb/openEnv.js
  demo_api_server/services/lmdb/sessionStore.lmdb.js
  demo_api_server/services/lmdb/transactionStore.lmdb.js
  ```
