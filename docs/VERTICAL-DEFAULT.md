# Default vertical: United Airlines (airlines)

Decided 2026-09-22: United Airlines is the most compelling demo vertical and
is now the DEFAULT for fresh sessions.

## How the default resolves (verticalManifest/resolver.js)

1. `req.session.active_vertical` — per-session picker choice (wins always)
2. LMDB `verticalStore` `active` key — process-global, persisted
3. `configStore.getEffective('active_vertical')` — bridge for fresh installs
4. `null` → callers fall back to `'banking'` (last-resort code default)

## What was changed

Runtime state only, no code change:
- `verticalManifest.resolver.setActive('airlines')` → LMDB `active=airlines`
- `configStore.setRaw({ active_vertical: 'airlines' })`

Both survive container restarts. A fresh session that never touched the
picker now lands on United; sessions that pinned another vertical keep it
(the session-scoped invariant in `POST /api/verticals/active` is unchanged).

## Kept as-is (deliberate)

The `'banking'` string fallbacks in agentRun/agentInvokeRoute/accounts stay:
they are the last-resort for an empty LMDB AND empty configStore (fresh
clone), and `routes/accounts.js` has real banking-only branching
(checking/savings seeding) that must not silently become airlines.

## Verified

- `GET /api/verticals/active` → `{"id":"airlines"}` after BFF restart
- Fresh Playwright session (no pin) resolves `airlines` (spec:
  `tests/e2e/airlines-default.real.spec.js`)
- UC7 perVertical resolves for airlines: trigger `pay a $600 change fee`,
  tool `pay_airline_fee`
