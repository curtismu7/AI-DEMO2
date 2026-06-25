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
| `clientRegistryStore.lmdb.js` | DCR-registered OAuth clients + rotation history (`oauth_clients` sub-DB) | Wired in via `oauthClientRegistry.js` |
| `cimdStore.lmdb.js` | Client ID Metadata Documents for `/.well-known/oauth-client/:id` (`cimd` sub-DB) | Wired in via `routes/clientRegistration.js` |
| `demoScenarioStore.lmdb.js` | Per-user demo scenario (MFA step-up threshold, UI mode) (`demo_scenarios` sub-DB) | Wired in via `demoScenarioStore.js` |
| `reportShareStore.lmdb.js` | Report share-link tokens (`report_shares` sub-DB) | Wired in via `routes/reports.js` |
| `securityMonitoringStore.lmdb.js` | Security-monitoring dashboard snapshot — alerts, client risk, metrics (`security_monitoring` sub-DB) | Wired in via `securityMonitoringService.js` (periodic snapshot, not write-through) |
| `migrate.js` | One-shot SQLite → LMDB migration script (run once, offline) | Standalone script |

## Migration (already done for existing installs)

If setting up a brand-new install from scratch, LMDB is seeded automatically on first boot.
If migrating from an older SQLite install:

```bash
# Stop the server first, then:
node demo_api_server/services/lmdb/migrate.js
```
