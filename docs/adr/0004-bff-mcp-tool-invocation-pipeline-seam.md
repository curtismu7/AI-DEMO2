# The BFF MCP tool-invocation pipeline is one deep module returning an outcome; the route only renders

**Status:** accepted (2026-05-17)

## Context

`POST /api/mcp/tool` in `banking_api_server/server.js` is the BFF agent's tool-call path
(ARCHITECTURE-TRUTHS T-7 — the agent that does **not** route through the gateway and runs
its own authoritative PingAuthorize gate). It had grown to ~760 lines in a single Express
handler: a PingOne-admin early-exit, RFC 8693 token resolution, a no-bearer branch, the
sole authoritative Authorize gate (ADR-0003 / T-2), RFC 7662 session introspection, and the
remote MCP call plus the gateway audit-trail merge — with ~13 `res.*` exit points, ~20
interleaved SSE `emit()` calls, the `tokenEvents` teaching array mutated at ~10 sites, and
**three** distinct "fall back to the local handler" escape hatches at three different phases.

This is the single most regression-heavy path in the repo. REGRESSION_PLAN §4 records the
single-resource scope rule alone breaking it four times, plus repeated patches to the
`isExchangeScopeError` classification (401-vs-400, the `pingoneError` disambiguation, the
missing `req` arg). Every one of those "confirmed fixed" claims that turned out false shared
a cause: the failure only manifests on a live chip → PingOne call, never in the existing
unit suite, and the decision logic was spread across the handler so a fix in one place left
another stale. There was no nameable unit for "what a BFF tool call does."

## Decision

Extract the orchestration into one deep module — the **MCP tool-invocation pipeline**
(`runMcpToolPipeline`) — with these load-bearing seam properties:

1. **The module returns a discriminated `Outcome`; the route renders it.** The pipeline has
   zero Express coupling. It returns one of `{kind:'result'|'block'|'error', tokenEvents,
   ...}`. A single `renderOutcome(res, outcome)` in the route shell is the **only** `res.*`
   site. The shell also owns the `flowTrace` `finish`/`close` lifecycle hooks.

2. **The Authorize gate stays *inside* the pipeline, injected as a dependency.** Inside,
   because ADR-0003/T-2/T-7 make this the BFF's sole authoritative gate and its ordering
   ("after token resolution, before the remote call, on every call") is exactly the
   knowledge that must not live in the caller — that is the smell this extraction removes.
   Injected (not `require()`d in place), because REGRESSION_PLAN §1 row 56 makes
   "gate runs unconditionally on every tool call" a do-not-break invariant that has been
   broken before (the removed `ff_authorize_mcp_first_tool` flag); injection lets a
   characterization test assert the gate is called before the remote call on every
   non-error path without standing up PingOne.

3. **The pipeline owns all three local-fallback hatches internally.** `callToolLocal` and
   the `isExchangeScopeError` classification move into the module. They are the precise
   logic patched four times in §4; co-locating decide + do in one module is what stops the
   "fixed in one file, stale in the other" recurrence. The route never learns *why* a call
   went local — a local success is just `{kind:'result', ..., flags:{localFallback:true}}`.

4. **SSE `emit` is an injected sink; phase events stay live, not batched.** The pipeline
   takes `emit(payload)` / `publishEvents(evs)` callbacks (real hub in prod, spy in tests).
   Progressive per-phase emission during the call is preserved verbatim — the live Token
   Chain UI is an intentional teaching surface (token-visibility-intentional), and batching
   phases to flush after the call would be a pedagogical behavior change, which this
   project treats as a real regression.

5. **This is a strict zero-behavior-change extraction.** Verification order is
   non-negotiable: characterization tests pinning all ~13 exit paths GREEN *before* the
   extraction, the same tests GREEN *after* (proving a pure move), then the real exit gate —
   a live chip click yielding HTTP 200 with non-empty `tokenEvents` and the Token Chain
   rendering, per the skip-proof-pipeline-tests discipline. The existing suite is explicitly
   not sufficient evidence: §4 shows it did not catch these regressions.

## Consequences

- One nameable unit for the BFF tool call. T-7's "the BFF runs its own gate" is now a
  module boundary, not 760 lines of tribal knowledge. Locality: the §4 hot spots
  (scope classification, effective-user resolution, fallback triggers) live in one file.
- Leverage: the route stops knowing about silent refresh, audit-trail merges, polymorphic
  gate verdicts, or `oauthId || id` resolution. It switches on an `Outcome` kind.
- Test surface: the pipeline is unit-testable through one interface with injected deps;
  the gate-ordering invariant (ADR-0003/T-2) becomes a test assertion rather than a
  code-reading exercise.
- This ADR does **not** relitigate ADR-0003. PingAuthorize via `evaluateMcpFirstToolGate`
  remains the sole authoritative gate; this only relocates *where the call is orchestrated*
  and how its ordering is proven. No second authorization decision is introduced.
- This ADR is about the **BFF direct path** (T-7). The gateway-routed agents are unchanged.
- Anyone later moving the Authorize gate *out* of the pipeline, batching SSE phases, or
  splitting the local-fallback decision from its execution is reintroducing the smell this
  ADR removed — see the four §4 incidents for what that costs.
