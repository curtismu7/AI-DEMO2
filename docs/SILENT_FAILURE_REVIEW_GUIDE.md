# Silent-Failure Review Guide

A reviewer's checklist for the class of bug that doesn't announce itself: the code
keeps running, the demo still "works," tests stay green — and something is quietly
wrong. These are the failures that survive review because nothing crashes.

The examples below are real defects found (and fixed) in this repo's PingOne
Authorize (P1AZ) flow during the July 2026 hardening. Use them as the pattern
library; the general rules at the end apply everywhere.

**Companion doc:** `docs/superpowers/specs/2026-07-11-p1az-hardening-amendment.md`
(the corrected design that these findings drove).

---

## The high-value patterns (each seen in this repo)

### 1. Fail-open where fail-closed was intended — the dangerous one
A gate that **denies on a specific bad value** and treats everything else as allow.

- **Seen here:** `sensitiveDataService` gated on `result.decision === 'DENY'` and
  returned `{ denied: false }` otherwise. Introducing a new non-DENY decision
  value (`NOT_APPLICABLE`) would have **silently released sensitive account data**
  on exactly the policy-drift case the feature targeted.
- **Look for:** `!== 'DENY'` → allow, `if (blocked) … else proceed`, any authz
  check keyed on a denylist rather than an allowlist.
- **Fix:** allow only on the positive value (`=== 'PERMIT'` → allow, else deny).
  Keep the normalizer **total and fail-closed** — an unknown value collapses to
  DENY. Carry side information (e.g. "policy not found") as a **separate flag**, so
  a consumer that ignores it still denies.

### 2. A branch that can never fire (contract drift between layers)
A condition comparing against a value the producer never emits.

- **Seen here:** both gates checked `r.decision === 'NOT_APPLICABLE'`, but
  `_normalizeDecision` stays fail-closed and returns `DENY` + a `policyNotFound`
  flag — it never returns that string. The branch was dead, so the intended
  "Policy not found, please contact administrator." message never appeared; drift
  fell through to a generic deny.
- **Look for:** string "sentinels" threaded through several layers where one
  layer's contract changed; `=== 'SOME_STATE'` checks against enum values nothing
  produces.
- **Fix:** structured fields over magic strings (a renamed/typo'd sentinel fails
  silently); exhaustive `switch` with a `default` that denies or throws.

### 3. Silent degradation that hides the real cause
A fallback keeps things running without surfacing that it engaged.

- **Seen here, three flavors:**
  - The `authorize_mode` default was flipped to `pingone_fallback_simulated`,
    which **also governs the not-configured path** — so a fresh/misconfigured
    install quietly ran the in-process **mock** engine instead of a loud 503, and
    the operator believed real PingOne Authorize was enforcing.
  - A generic `authorization_service_unavailable` body masked a specific
    `policy_not_found`.
  - The server set an enriched "why we fell back" reason, but the UI modal
    rendered only fixed fields and **dropped it** — the operator never saw it.
- **Look for:** fallbacks/defaults that change behavior without an operator-visible
  signal; error messages that generalize away the specific cause; a field set on
  the server but never rendered client-side.
- **Fix:** make the safe state the default state (fail closed, loudly); ensure any
  degradation emits a signal that actually reaches a human.

### 4. Tests that are green but prove nothing
Passing tests that exercise code that doesn't exist, or mock shapes production
can't return.

- **Seen here:** a whole reliability suite was merged for functions that were never
  implemented (threw `is not a function`); gate tests mocked
  `decision: 'NOT_APPLICABLE'` — a value the real code never produces — so they
  passed while testing a dead branch.
- **Look for:** mocks returning shapes the real dependency can't; tests for
  unimplemented functions; suites that "pass" because a `beforeEach` no-ops; tests
  asserting the buggy behavior.
- **Fix:** mocks must match the real contract (here: `{ decision: 'DENY',
  policyNotFound: true }`, not `{ decision: 'NOT_APPLICABLE' }`). A green test on an
  unrealistic mock is worse than no test — it manufactures false confidence.

### 5. Retry / idempotency mismatch
Retry logic applied at a layer that also carries non-idempotent writes.

- **Seen here:** a blanket retry in the shared fetch helper would have re-fired a
  create-decision-endpoint POST that succeeded server-side but timed out
  client-side → **duplicate endpoints**, silently.
- **Look for:** "retry on timeout/5xx" wrapping a transport that also does POST/PUT
  writes; retries without asking "did the server already process this?"
- **Fix:** make retry opt-in per call, scoped to idempotent reads/evaluations only;
  give writes an idempotency key or no retry.

---

## The classic ones worth a standing grep

- **Swallowed / log-only errors** — `catch (e) {}`, or `catch` that logs then
  continues as if it succeeded.
- **Ignored return values** — a `{ ok: false }` / status / error that nothing
  checks (`save()`, `writeFile`, a store op that takes a callback).
- **Missing `await`** — an async error becomes an unhandled rejection and vanishes;
  the caller proceeds on a pending promise. (This repo's session store must call
  `cb(err)` on every op — see REGRESSION_PLAN §1.)
- **Falsy-zero / bad defaults** — `value || fallback` treating `0` / `''` / `false`
  as missing; `??` vs `||` confusion.
- **Broken import → `undefined`** — a function imported but never implemented only
  throws *when the route/branch is hit*. Silent until exercised. (Seen here:
  `checkPolicyReadiness` imported by a route that then threw at runtime.)
- **Lost guard / narrowed validation** — a dropped regex anchor, an allowlist that
  silently widened, a check that used to reject and now doesn't.
- **Dedup that swallows a distinct signal** — a once-per-session alert eating a
  later, *different* cause.
- **Cache keyed wrong** — a token cache keyed only by expiry (not credentials/env)
  keeps using a stale identity after a rotation, with no error.
- **Circuit breaker counting the wrong things** — counting a reachable 4xx as an
  outage masks a self-heal path and misreports config drift as downtime.

---

## How to hunt them

- **Ask "what happens on the third outcome?"** Not just happy path + the one error
  you thought of. The dangerous case is the outcome nobody enumerated: cold cache,
  a rare error handler, a new enum value, a partial failure.
- **Trace every producer → consumer of a shared value.** The fail-open here was an
  *unlisted third consumer* of the normalized decision — found only by grepping all
  callers, not the two obvious ones.
- **Prefer loud, fail-closed defaults.** A 503 an operator sees beats a mock that
  quietly answers. Make the safe state the default state.
- **Structured results over sentinels**, with exhaustive consumers (a `default`
  that denies/throws) so a new case can't slip through as "allow."
- **Verify behavior end-to-end, not just tests.** Several of these passed tests;
  they surfaced only by driving the real value through detection → gate → UI and by
  reading what a mock actually returns vs. production.
- **In review, treat "it still runs" as a question, not an answer.** Fallbacks,
  retries, catches, and defaults are exactly where "it works" and "it's correct"
  diverge.
