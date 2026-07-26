# Demo Step Verification — Design

**Date:** 2026-07-21
**Status:** Approved (Phase 1 scope)

## Problem

No single mechanism proves a demo step (chip or free-text prompt, in a given
LLM mode) does the right thing right now. Existing coverage is split across
100+ Jest unit tests, 15 Playwright `*.real.spec.js` e2e specs, a golden-replay
drift gate (`check-goldens.js`), and an auto-generated maturity table
(`docs/use-cases/audit-table.md`). None of it answers, per step: did it error
server-side, did the heuristic parser mis-route it, did the LLM call fail or
swap providers, did the response contain the right values, did the right gate
(HITL / CIBA / step-up) fire or not fire.

Two project skills already encode hard-won knowledge for this exact problem —
`chip-correctness-testing` (how to prove a value is right, not just that the
pipeline ran) and `agent-demo-triage` (failure-signature → root-cause table
for silent agent-pipeline breakage). This design wires new coverage around
those skills rather than duplicating what they already solved.

## Goal

A repeatable way to run every applicable demo step in a vertical, across chip
and free-text triggers and across LLM modes, and get back a per-step verdict
across five checks — with a living, machine-written record of the result that
compounds over time instead of rotting into stale checkboxes.

## Scope — Phase 1

**Banking vertical only.** Rows = every banking-applicable use case, pulled
live from `demo_api_server/config/useCases.js` (via `resolveUseCase`) — never
a hand-maintained list, so the matrix can't drift from the catalog. Banking is
the vertical that already exercises HITL (UC8), step-up (UC7), CIBA (UC22,
flag-gated), and a bypass attempt (UC27) — the exact gate-correctness class
called out as a requirement.

Columns per row:
- Trigger type: chip, free-text prompt
- Mode: heuristic-floor ON, LLM-only (llamacpp), LLM-only (other configured
  provider, e.g. Helix)

Phase 2 (not in this design, mechanical follow-on): parameterize the same
harness by vertical and widen to the remaining 8.

## The five checks

| # | Check | Mechanism | Owner |
|---|---|---|---|
| 1 | Server error (5xx, uncaught exception, backend unreachable) | HTTP status assertion + `agent-demo-triage` log-signature grep | Jest + Playwright |
| 2 | Parse error (heuristic mis-routes action/params) | Extends `chipSchemaContract.test.js` / `useCases.primaryTool.test.js` pattern | Jest |
| 3 | LLM error (timeout, provider tier swap, context overflow, refusal, malformed tool call) | promptfoo, provider-comparison mode | promptfoo |
| 4 | Right response (values match ground truth) | `chip-correctness-testing` pattern: assert against store/tool payload, never a literal | Jest (chips) + promptfoo (narration vs. payload) |
| 5 | Right behavior (HITL/CIBA/step-up fires when expected, not otherwise) | Extends `hitlBypass.regression.test.js` / `agentRunHitlSuspend.test.js` pattern | Jest + Playwright |

### Division of labor

- **Jest** (API-level, fast, no browser): checks 1/2/4/5 for chip triggers via
  the heuristic path. New file per vertical:
  `demo_api_server/tests/stepVerification.<vertical>.test.js`.
- **Playwright** (`*.real.spec.js`, real login/session): checks 1/3/5 for
  free-text prompts where rendered narration or a real HITL modal matters, plus
  evidence screenshots. Extends the `evidence-screenshots.real.spec.js` /
  `use-cases-agent.real.spec.js` pattern.
- **promptfoo** (new dependency, MIT-licensed, npm, no cloud account —
  configured to call the local `demo_llm_proxy` on `:8090` same as everything
  else): owns check 3 and the narration-vs-payload half of check 4 for
  free-text prompts, across providers side by side. Config-driven
  (`promptfoo.config.yaml`), assertion types used: `contains`/regex for
  gate-language, `javascript` custom assertions that compare rendered numbers
  against that turn's `/api/mcp/tool` payload (the grounding rule from
  `chip-correctness-testing`). Run on demand, not a CI gate — it's a grading
  tool for narration quality, not a pass/fail pipeline check.

### Known traps this design must respect (from `chip-correctness-testing`)

- The heuristic floor answers matched chip phrases in every mode when
  `ff_heuristic_enabled` is on — chip tests through the floor never exercise
  the LLM. LLM-mode coverage requires free-text phrases that don't match a
  heuristic, or the floor flag flipped off.
- Two result shapes (`result.banking.action` vs `result.action` for every
  other vertical) — normalize or silently assert `null`.
- Ground truth is the store/seed or that turn's tool payload, never a
  hard-coded literal (transfers legitimately move money).

## Living record

New per-use-case ledger, mirroring the goldens directory convention but a
separate concern (goldens = fallback replay content; this = last-verified
status):

```
demo_api_server/data/step-verification/<vertical>/<useCaseId>.json
```

```json
{
  "vertical": "banking",
  "useCaseId": "UC8",
  "triggerType": "chip",
  "mode": "heuristic",
  "status": "PASS",
  "errorClass": null,
  "primaryTool": "create_transfer",
  "checkedAt": "2026-07-21T00:00:00.000Z"
}
```

Machine-written by test runs only — never hand-edited. This is the load-bearing
property: a ledger entry is only ever true because a test just proved it, so
it cannot drift into the stale-checkbox failure mode already seen in this
project's own plan artifacts.

A generator script, `scripts/gen-step-verification-report.js` (same pattern as
the existing `gen-use-cases-audit.js`), reads the ledger and produces
`docs/use-cases/step-verification-report.md` — auto-generated, read-only,
regenerated by `npm run use-cases:gen` alongside the existing audit table.

A companion `check-step-verification.js` (same pattern as `check-goldens.js`)
gates: orphaned entries (use case no longer in the catalog), malformed
entries, and stale entries (checked-at older than N days) — printed as a
warning, not a hard CI failure, consistent with how `check-goldens.js` treats
missing coverage.

## Closing the loop — "learn as we go"

No new knowledge-store invented. When a run finds a bug:

1. Fix lands.
2. Re-run the specific cell — the ledger entry flips to `PASS` with an updated
   `checkedAt` and `errorClass: null`.
3. If the bug was a **new root-cause class** (a failure signature not already
   in the table), add a row to `agent-demo-triage`'s failure-signature table.
4. If it revealed a **new ground-truth gotcha** (e.g. a vertical using
   `amountDue` instead of `amount`), add it to `chip-correctness-testing`.

Both skills are read at the start of every session that touches this area, so
the knowledge compounds where it's already load-bearing — no separate
"learnings" doc to keep in sync.

## Out of scope (Phase 1)

- Verticals other than banking.
- Making promptfoo or the new Jest/Playwright specs a CI/pre-push gate —
  they're a manual/on-demand verification pass for now, matching how
  `check-goldens.js` treats missing coverage as a warning, not a blocker.
- Automated fix application — the ledger records verdicts; fixing failures is
  ordinary triage work using `agent-demo-triage`.
