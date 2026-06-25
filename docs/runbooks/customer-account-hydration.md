# Customer account data hydration (runbook)

This runbook explains why customers sometimes saw **no accounts** after login, what we changed, and how to verify and monitor.

## What “no account data” means

The customer dashboard loads **`GET /api/accounts/my`** before **`GET /api/transactions/my`**. The server auto-provisions demo accounts when the user has none (`provisionDemoAccounts` in `banking_api_server/routes/accounts.js`). The UI can still show an empty table when:

1. **Session/JWT lag** — OAuth “signed in” status returns before the BFF accepts the same access token on data routes (historically mitigated by `refreshIfExpiring` on `/api/auth/oauth`).
2. **Transient failures** — network blips, cold starts, Redis/session store hiccups, **503** from upstream or serverless.
3. **Empty response race** — rare timing between first response and provisioning (mitigated by client retries).

## Client-side resilience (`accountsHydration.js`)

- **`fetchMyAccountsWithResilience`** — multiple attempts with backoff: retries **401** (session settling), **5xx including 503**, and **empty** account lists until a non-empty list is returned or attempts are exhausted.
- **`isAccountsHydrationTransientError`** — aligns “transient” with hydration (does **not** auto-retry **429**; the dashboard still pauses auto-refresh on 429).

## User-facing fallback

On **`UserDashboard`**, if accounts are still empty after loading, the user sees a short explanation and **Retry loading accounts** (calls a full `fetchUserData` again).

## Prevention checklist (releases / incidents)

1. **Smoke after deploy**: customer OAuth login → dashboard shows at least one account row (or Retry succeeds within one click).
2. **Watch**: spikes in **401** on `/api/accounts/my` right after login; **429** on shared IPs (rate-limit exclusions in `server.js`).
3. **Ordering**: keep **accounts before transactions** on full hydration (comment in `UserDashboard.js`).
4. **Tests**: run `npm test -- --testPathPattern=accountsHydration.test.js` in `banking_api_ui`.

## Related regression entries

See `REGRESSION_LOG.md` for OAuth refresh on `/api/auth/oauth`, Redis session store fault tolerance, and global rate-limit exclusions on session/demo paths.
