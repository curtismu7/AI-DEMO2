# POST /api/demo/spiffe/pingfederate/exchange: require a signed-in session

**Status:** agreed ("do these", owner, 2026-11-22; same decision as the privilege-call route in #3677)   **Owner:** Curtis

## Goal
The route mints a real PingFederate access token (RFC 8693 exchange with a SPIRE JWT-SVID as actor token, using server-held client credentials) and returns it. It is public, and the caller chooses `audience` and `scopes`. Require a session so only signed-in users can trigger a mint. Only when `ff_spiffe_pf_exchange` is on (default off).

## Acceptance criteria
1. No session: 401 `unauthenticated`, the service is never called, for any body.
2. With a session: behaviour exactly as today (200 with token when the flag is on, structured 503 when off, 502 on exchange failure).
3. The only callers still work: the protocol playground (`executionEngine.js` uses axios `withCredentials: true`) and the privilege service, which calls the exchange function directly (not this route).

## Unhappy paths
- Signed-out visitor runs the playground step: gets 401 (expected; the same as step 3 after #3677).
- Flag off and signed in: unchanged 503.

## Out of scope / residual
- `audience` and `scopes` are still caller-chosen for a signed-in user. Locking them to an allowlist needs a decision on what the playground is meant to show; separate PR if wanted.
- `/svid` and `/verify` (mock issuer, no real token minted).
- No change to token minting, exchange or session code.

## Verification plan
New 401 tests (fail on current code); existing route tests updated to send a session and stay green; independent review; owner says go before merge.
