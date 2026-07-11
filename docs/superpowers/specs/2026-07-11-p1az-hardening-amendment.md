# P1AZ Hardening — Design Amendment (silent-failure fixes)

**Date:** 2026-07-11
**Status:** Proposed — supersedes the flagged sections below
**Amends:**
- `2026-07-11-p1az-policy-not-found-design.md`
- `2026-07-11-p1az-reliability-design.md`
- Implementation plan `docs/superpowers/plans/2026-07-11-p1az-policy-not-found-and-reliability.md`

## Why this exists

A code review of the two design specs found that, as written, they introduce
several **silent failures** — including one security fail-open and one branch that
never fires for the case it targets. Two were confirmed against the actual code and
policy snapshot. This amendment restates the affected design decisions so the
feature fails **closed and loud**, never open and quiet. Sections of the original
specs not listed here are unchanged.

Each item cites the finding it resolves. Do not implement the original wording where
it conflicts with this doc.

---

## A. Decision normalization stays fail-closed; drift is a side-channel flag

**Resolves:** fail-open in `sensitiveDataService` (CONFIRMED); unreachable
`NOT_APPLICABLE` branch (CONFIRMED); the same latent risk in `checkStepUpRequired`.

The original design made `_normalizeDecision()` return a **new** normalized value
`'NOT_APPLICABLE'`. That is unsafe: the normalized `decision` is read by more
consumers than the two named gates, and every one of them blocks on
`decision === 'DENY'` and treats **everything else as permit**. Confirmed consumers
beyond the two gates:

- `demo_api_server/services/sensitiveDataService.js:69` —
  `if (!result || result.decision === 'DENY') deny; else allow`. A distinct
  `'NOT_APPLICABLE'` value flips this from fail-closed to **fail-open on the exact
  missing-policy drift the feature targets** — sensitive account data is released
  with no error and no log.
- `demo_api_server/services/pingOneAuthorizeService.js:509` (`checkStepUpRequired`)
  — same `=== 'DENY'` pattern; a non-DENY value silently skips step-up.

### New rule

1. **`_normalizeDecision()` remains total and fail-closed.** Any effect that is not
   an explicit PERMIT still returns `'DENY'` (or `'INDETERMINATE'` with obligation,
   exactly as today). It never returns a new decision string.
2. **Drift is carried as a separate boolean on the returned object**, not encoded
   into `decision`. `_postDecisionEndpoint()` / `_evaluateViaPdp()` return
   `{ decision: 'DENY', policyNotFound: true, ... }` when the raw effect is literally
   `not_applicable`. Consumers that know nothing about `policyNotFound` see `'DENY'`
   and stay safe; a mistyped or dropped flag anywhere degrades to DENY, never PERMIT.
3. **Only the two gates opt in.** They read `result.policyNotFound` to swap the
   generic block for the `policy_not_found` chat message. `sensitiveDataService` and
   `checkStepUpRequired` need no change and keep denying — which is the correct,
   safe behavior for a missing policy.

### Detection reachability — narrow the claim (Finding: premise unreachable)

Against the committed snapshot `snapshots/Super_Banking_Transaction_Authorization_P1AZ.snapshot.json`,
`NOT_APPLICABLE` is **not reachable for the "new tool, forgot to update P1AZ" case**:
the snapshot uses `DenyOverrides`, partitions all traffic by `DecisionContext`, and
ends each partition in an always-applicable `unconditionalPermit` catch-all
(`condition:{empty:{}}`). A new unmatched tool hits the catch-all → **PERMIT**.

Therefore:

- The `NOT_APPLICABLE`/`policyNotFound` path is a **secondary** signal that only
  fires against environments whose policy tree can actually return NOT_APPLICABLE
  (no catch-all). Document it as such; do not claim it detects drift on the demo
  snapshot.
- The **primary, reliable** drift signal for the demo is the **HTTP 404** path
  (endpoint ID never created) plus the readiness probe in section E. The spec's
  "primary vs secondary" labels are inverted and must be swapped.
- "New tool silently permitted by a catch-all" is a **policy-authoring** gap the
  BFF cannot detect from a single decision. Call this out as a known limitation
  rather than implying the code closes it.

---

## B. Default failover change must not silently mock the not-configured path

**Resolves:** fresh install silently runs the simulated engine instead of failing
loud (Findings B/A/C, corroborated).

Reliability item 3 changes the `authorize_mode` FIELD_DEFS default
`'pingone'` → `'pingone_fallback_simulated'`. `failoverMode` is read by **two**
branches in each gate, and the spec only accounted for one:

- **outage/catch path** (intended target) — fine to fall back to simulated.
- **not-configured path** (`transactionAuthorizationService.js:157-183`,
  `mcpToolAuthorizationService.js:326`) — today returns a loud
  `503 authorization_service_unavailable`. Under the new default it silently sets
  `runSimulated=true` with **no `authorizeFallback` modal** (that is only built in
  the catch path), so an operator who believes real P1AZ is enforcing gets the mock.

### New rule

- **Not-configured stays fail-closed regardless of `failoverMode`.** Missing
  worker creds or missing decision-endpoint ID → `503`, unchanged. Only a *genuine
  engine failure when P1AZ is configured* is eligible for simulated failover.
- Gate the default change behind that distinction explicitly (a `configured &&
  engineError` predicate), rather than letting the raw `failoverMode` default leak
  into the not-configured branch.
- Update the `simulatedAuthorizeService.js:1078-1092` "never silently degrades to
  mock / fails CLOSED" comments in the same change — the original spec omits them.

---

## C. Retry only idempotent evaluate/token calls — never provisioning writes

**Resolves:** duplicate decision endpoints from retried non-idempotent POST/PUT
(Findings A/B/C/F, corroborated).

`fetchT` is the shared transport for **all** outbound Authorize calls, including
non-idempotent management writes: `_createDecisionEndpointResource` POST
(`pingOneAuthorizeService.js:~804`) and `setEndpointRecording` PUT (`~921`). A
blanket "retry once on timeout/5xx in the bounded-fetch helper" retries those too;
a write that succeeds server-side but times out client-side gets re-fired, creating
duplicate endpoints.

### New rule

- Retry is **opt-in per call**, not a property of `fetchT`. Add an `idempotent:
  true` option (or a thin `fetchWithRetry` wrapper) applied **only** to worker-token
  requests and decision-evaluation calls.
- Provisioning writes call `fetchT` with **no retry**.
- Also apply the 15000→5000ms default **only** to evaluate/token calls; keep the
  longer bound for provisioning, which is legitimately slower.

---

## D. Failover signal must reach the UI, or it isn't a signal

**Resolves:** enriched `authorizeFallback` reason dropped on the MCP permit path and
in the modal (Findings B/E and C).

Two carriers are broken:

1. **MCP permit-mode path** returns bare `{ ran: false }`
   (`mcpToolAuthorizationService.js:612`), discarding the `authorizeFallback` object
   the catch just built. Enriching it changes nothing.
2. **The modal renders fixed fields only** (`DemoAuthzFallbackModal.jsx:47`) and the
   listener dedups **once per browser session**
   (`AuthorizeFallbackListener.jsx:28-31`). A new `reason` key flows through
   `emitAuthorizeFallback` and is silently dropped; an earlier generic blip consumes
   the once-per-session slot so `policy_not_found` never shows.

### New rule

- **Scope the enrichment claim to modes that actually surface a signal.** In
  `fallback_simulated` (the response carries the signal) enrichment is valid. On the
  MCP permit `{ ran: false }` path there is no carrier — either add one explicitly
  as its own work item or state plainly that permit-mode 404s are invisible by
  design; do not write acceptance criteria the path cannot meet.
- **List the two UI files as in-scope changes:** render `reason` in
  `DemoAuthzFallbackModal.jsx`, and key the listener's dedup by `reason` (or
  severity) so a drift/circuit reason is not swallowed by an earlier generic one.

---

## E. Circuit breaker: scope, classification, ordering, and the readiness probe

**Resolves:** breaker masks the UserGroups-400 self-heal (Finding F); cross-spec
ordering + module-wide blast radius (Findings B/G); half-open stampede and 20s
worst-case latency (Finding F); self-contradictory readiness probe and decision-log
pollution (Findings G/E/C, corroborated).

1. **Count only timeout / network / 5xx toward the breaker.** All 4xx pass through
   to their existing handlers. This is required for correctness, not just tuning:
   the known `400 INVALID_VALUE` UserGroups error is self-healed at
   `mcpToolAuthorizationService.js:584` (disable flag → retry); if a 400 opens the
   breaker, subsequent calls fast-fail with `authorize_circuit_open` **before** the
   400 is ever thrown, the self-heal becomes unreachable, and a one-flag config error
   is misreported as an outage. This classification also removes the hidden
   dependency on the companion spec's `err.code` tagging for the 404 exclusion.
2. **Ship both specs together.** The breaker's "404 does not count" rule depends on
   `err.code='policy_not_found'` tagging that lives only in the policy-not-found
   spec. Split delivery turns persistent config drift into a permanent silent
   simulated-engine takeover.
3. **Breaker is per evaluate target, not one module-level object.** Key it by
   endpoint (transaction / MCP / sensitive-data), so 3 failures on one endpoint do
   not fast-fail the other healthy gates.
4. **One deadline per evaluate; retry within the remaining budget.** The original
   "worst case ≈ 10s" is wrong — retry-once applies to the token call **and** the
   decision call, which run serially, giving ~20s (worse than today's 15s). Use a
   single `AbortSignal.timeout` spanning token+decision, or retry the decision call
   only.
5. **Single-flight the token cache; single-probe half-open.** Cache the pending
   promise so concurrent gate evaluations share one client-credentials call; on 401
   clear only if the cached token equals the one that failed. Half-open must admit
   exactly one probe (others fast-fail) so an ongoing outage does not re-stall N
   concurrent calls for a full timeout each.
6. **Readiness probe is admin-invoked only — not on the boot/warm path.** Firing
   synthetic decisions from `warmup()` breaks its documented invariant
   (`pingOneAuthorizeService.js:729`, list-only "so the decision log stays clean")
   and injects `preflight@demo.local` rows into the 20-slot recent-decisions window
   shown during demos (warmup also re-fires on UI activity). Expose readiness behind
   the existing admin route only.
7. **Resolve the readiness classifier contradiction.** "Clearly-synthetic
   attributes" are exactly what yields `NOT_APPLICABLE`, so a correctly provisioned
   environment would report `policy_not_found` — a permanent false alarm. Either
   probe with **real catalog values** (accepting the probe looks like a real
   decision) or restrict readiness to the **404 endpoint-existence** check only, and
   state which. Do not classify synthetic-attribute NOT_APPLICABLE as drift.

---

## F. Reuse existing infrastructure instead of a fourth/third/second copy

**Resolves:** duplicated mechanisms (Finding D).

The repo already has the three mechanisms the reliability spec hand-rolls. Extend
these rather than adding parallel implementations that drift on the next fix:

- **Worker-token cache** — `pingoneScopeUpdateService.js:34` (`tokenCache` with
  `expiresAt`/ttl); siblings in `tokenIntrospectionService.js` and `agentTokenCache.js`.
  Extract a shared worker-token helper. Additionally, key the cache by
  credentials/env id, not expiry alone, so an admin credential/env rotation is
  picked up immediately instead of surviving until token expiry.
- **Circuit breaker** — `helixLlmService.js:33` (threshold + cooldown + half-open
  probe) and the class in `utils/oauthMonitor.js`. Extract one shared breaker.
- **Boot P1AZ probe** — `startupHealthProbe.js:95` already verifies both configured
  decision-endpoint IDs exist (the 404-drift case) and logs via `appEventService`;
  `pingOneWorkerPreflight.js` already classifies token errors. Extend
  `probeP1AZEndpoints` rather than adding a parallel boot probe.

---

## G. Operational note — `secrets.vault` is tracked despite the docs

**Not part of the P1AZ design, but surfaced in the same review.**

The working tree has a re-encryption of two `DEMO_*_SERVICE_KEY` entries in
`secrets.vault`, but the file is **tracked by git** even though `docs/vault.md`
states `.gitignore` should prevent it (`git check-ignore secrets.vault` exits 1).
Committing writes fresh ciphertext into permanent history, and per the repo's
worktree rule a change left in the shared `main` checkout can be swept into an
unrelated concurrent commit. Decide deliberately: either restore `.gitignore`
coverage and `git rm --cached` the file, or follow `vault.md`'s intentional-commit
checklist. Do not let it ride along silently.

---

## Updated success criteria

- `_normalizeDecision` unit test: literal `not_applicable` → `{ decision: 'DENY',
  policyNotFound: true }`; every other unknown effect → `'DENY'` with no
  `policyNotFound`. Explicit assertion that `sensitiveDataService` and
  `checkStepUpRequired` still deny on that input.
- Not-configured path returns `503` under **every** `failoverMode`, including the new
  default. Outage-with-configured-endpoint falls back to simulated.
- Retry fires for token/decision calls only; a timed-out provisioning POST is **not**
  retried (test with an injected timeout asserting a single create call).
- Breaker: opens on 3 timeout/5xx; a 4xx (incl. the UserGroups 400) never opens it and
  reaches its handler; per-endpoint isolation; half-open admits one probe; single
  evaluate deadline ≤ ~10s end to end.
- Modal renders `reason`; dedup keyed so a drift reason is not swallowed.
- Readiness probe is reachable only via the admin route and writes no rows to the
  recent-decisions window (assert the window is unchanged after a probe).
- Existing P1AZ suites stay green; UI build gate passes (REGRESSION_PLAN).
