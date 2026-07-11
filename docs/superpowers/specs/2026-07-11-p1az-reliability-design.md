# P1AZ Reliability Hardening — Design

**Date:** 2026-07-11
**Status:** Approved
**Companion to:** `2026-07-11-p1az-policy-not-found-design.md`

## Problem

A P1AZ cloud failure (outage, latency, config drift) can stall or block the live
demo. Five hardening items, all scoped to `demo_api_server` (the BFF cloud path);
the gateway/mock path is untouched.

## 1. Preflight readiness check (drift detection)

`warmup()` in `pingOneAuthorizeService.js` currently only lists decision endpoints —
it proves connectivity, not that policies match the code.

- Add `checkPolicyReadiness()`: fire one synthetic decision request per configured
  gate (transaction endpoint; MCP endpoint with `DecisionContext: 'McpFirstTool'`),
  using clearly-synthetic attributes (e.g. subject `preflight@demo.local`).
- Classify each result: `ready` (PERMIT or DENY — a policy matched),
  `policy_not_found` (404 or NOT_APPLICABLE — code/P1AZ drift), or
  `error` (other failure).
- Run it from the existing boot warm path (non-blocking, logged) and expose it via
  the existing admin route in `routes/authorize.js` so the operator can check
  readiness before a demo.
- Skipped entirely when the simulated engine is active or credentials are
  unconfigured (same guards as `warmup()`).

## 2. Worker token cache

`getWorkerToken()` does a client-credentials call before **every** decision.

- Cache `{ token, expiresAt }` in module state; reuse until 60s before
  `expires_in` elapses.
- On a 401 from a decision/API call made with a cached token, clear the cache and
  retry that call once with a fresh token.
- Test hook to reset the cache (exported `_resetWorkerTokenCache()` or similar),
  consistent with the module's existing test conventions.

## 3. Demo failover default: fail to simulated, not closed

Today `authorize_mode` defaults to `'pingone'` (configStore FIELD_DEFS), which
`resolveAuthorizeMode()` maps to `failoverMode: 'deny'` — an outage blocks the demo
with 503.

- Change the FIELD_DEFS default to `'pingone_fallback_simulated'`
  (failover = fallback_simulated): real P1AZ is used when healthy; on engine
  failure the local simulated engine takes over and the existing
  `authorizeFallback` operator modal reports it.
- Explicitly stored `authorize_mode` values are unaffected — only the unset
  default changes. Operators who want strict fail-closed set `pingone`.
- Update the stale header comment in `transactionAuthorizationService.js` and any
  tests asserting the old default.

## 4. Tighter timeout + one retry

`AUTHZ_FETCH_TIMEOUT_MS` defaults to 15000 — a 15s frozen agent mid-demo.

- Default drops to **5000ms** (still overridable via `PINGONE_AUTHZ_TIMEOUT_MS`).
- In the bounded-fetch helper (decision + token calls): on a timeout/network error
  or 5xx response, retry **once**; never retry 4xx. Worst case ≈ 10s before
  failover engages, typical transient blips are absorbed.

## 5. Circuit breaker

Without one, every action during an outage pays the full timeout before failover.

- Module-level breaker in `pingOneAuthorizeService.js` around the evaluate paths:
  after **3 consecutive** evaluate failures, open the circuit for a **60s**
  cooldown; while open, evaluate calls fail immediately with an error tagged
  `err.code = 'authorize_circuit_open'` — existing failover handling then engages
  instantly (fallback_simulated keeps the demo alive with no stall).
- Any successful evaluate closes the breaker and resets the count. After cooldown,
  the next call goes through live (half-open probe).
- `policy_not_found` outcomes (404/NOT_APPLICABLE) do NOT count as breaker
  failures — drift is not an outage.
- The enriched `authorizeFallback` signal carries a `circuit_open` reason so the
  operator modal shows why. Test hook to reset breaker state.

## Invariants

- No change to decision semantics: PERMIT/DENY/obligations/step-up/HITL untouched;
  no decision-result caching.
- Explicitly configured `authorize_mode`, timeout env var, and gateway/mock paths
  unaffected.
- All new state (token cache, breaker) is in-process, resettable in tests.

## Testing / success criteria

- Unit tests: token cache reuse + 401-refresh; retry on 5xx/timeout but not 4xx;
  breaker opens after 3 failures / fails fast / half-open recovery / not tripped
  by policy_not_found; readiness classification (ready / policy_not_found / error);
  resolveAuthorizeMode default now fallback_simulated.
- Existing suites green (with default-assertion tests updated deliberately).
- UI build gate passes (REGRESSION_PLAN) — UI changes come only from the companion
  policy-not-found spec.
