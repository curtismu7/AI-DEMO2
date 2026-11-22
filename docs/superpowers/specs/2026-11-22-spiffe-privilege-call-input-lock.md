# POST /api/demo/spiffe/privilege/call: lock caller-controlled inputs

**Status:** agreed (owner chose "lock inputs, stay public", 2026-11-22)   **Owner:** Curtis

## Goal
The route is public (same surface as `/svid` and `/pingfederate/exchange`) but mints a JWT-SVID, requests a PingFederate `client_credentials` token with the server-held secret, and forwards the token to the Privilege gateway, returning the token and the gateway reply. Today the caller chooses the audience, scopes, gateway path and JSON-RPC method. Remove that choice so an anonymous caller can only trigger the one canned demo call, and cap how often.

## Acceptance criteria
1. The body the page sends today (`token_mode`, `resource: /spire-mcp/mcp`, the NHI `audience`, `scopes: ["mcp:invoke"]`) still returns 200 and reaches the service with exactly those values. Demo unchanged.
2. `{ "token_mode": "raw-svid" }` alone (the protocol-flow doc body) still works; omitted fields keep the service defaults.
3. Any `audience` other than the page's NHI audience is refused with 400 `invalid_request`, and the service is not called. A test reads the page source so the allowlist cannot drift from it unnoticed.
4. Any `resource` other than `/spire-mcp/mcp` is refused (400), service not called. Includes traversal (`/../x`) and non-strings.
5. Any `scopes` that is not an array containing only `mcp:invoke` is refused (400).
6. Any `mcp_method` other than `tools/list` is refused (400).
7. More than 60 calls per minute from one IP get 429 `rate_limit_exceeded`. `DISABLE_RATE_LIMIT` still disables it, like the other limiters. The cap is deliberately high: `trust proxy` is 1, so behind several proxy hops visitors may share one bucket, and a page run needs only 3 calls.

## Unhappy paths
- Flag `ff_spiffe_privilege` off: unchanged (service answers 503).
- Non-object or missing body: no crash; falls through to the service's existing `token_mode` validation.
- Hostile types (array/object where a string is expected): refused, never coerced.

## Out of scope
Requiring a session (a separate follow-up; the owner says the page is only run signed in, so it would cost the demo nothing), the sibling `/pingfederate/exchange` route, and the response still carrying the minted token (the page shows it by design). **Residual exposure:** `token_mode` is not restricted (the page uses all three shapes), so an anonymous caller can still obtain one canned token of each shape, including a PingFederate `client_credentials` token minted with the server-held secret, until sign-in is required.

## Protected / must not break
`REGRESSION_PLAN.md` §1 auth/token areas: no change to token minting, exchange, or session code, only to what the route accepts. The flag stays default OFF.

## Verification plan
New route test file covering criteria 1-7 (fails on current main); existing `spiffe*` suites green; `npm run authz:verify`; independent review of the diff before merge; owner says go before merge.
