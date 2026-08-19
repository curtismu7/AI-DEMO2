# Plan — stop INDETERMINATE meaning two different things

**Status:** plan only, no code. Written 2026-08-18 at the user's direction after
they reaffirmed the full rework over the cheaper alternatives.

**Origin:** the agent-dashboard plan file — *"pingauthorize should never return
indeterminate it means we made invalid request or policy not right. Add to
memory and fix."*

---

## The problem, stated precisely

One word carries two unrelated meanings.

| Source | `INDETERMINATE` means | Correct reaction |
|---|---|---|
| **Cloud PingOne Authorize** | evaluation failed — missing attribute, unreachable attribute provider, malformed payload | fail closed, find the missing attribute; the plan file's description is exactly right |
| **`demo_authz_server`** | a deliberate PAUSE — step-up or human consent required before this call may proceed | prompt the user; this is the demo's whole UC7/UC8 story |

### The authoritative definition (user-supplied 2026-08-18)

What INDETERMINATE means on the Ping platform, which is the meaning phase 5's
guard must enforce:

- **Unresolved rules** — the policy cannot decide whether the request meets the
  permit or the deny conditions.
- **Evaluation issues** — commonly a missing attribute, an evaluation fault, or
  **combining-algorithm results that cancel out or fail**. (That third cause is
  not in the blast-radius list below and is not currently modelled anywhere in
  this repo — worth checking for when phase 5 lands, since it produces an
  INDETERMINATE that no missing-attribute check would explain.)
- **Default handling** — in orchestration flows (PingOne DaVinci, PingFederate
  nodes) an INDETERMINATE outcome belongs on the **"No Match" or error path,
  never on a path that grants access**.

The third point is the phase 5 acceptance criterion, stated precisely: every
consumer must route INDETERMINATE to its error/no-match branch. It also
independently confirms the known trap already recorded below — an INDETERMINATE
with no obligation must resolve to DENY (#1310) — and rules out any "treat it as
soft-permit" shortcut during phase 3's consumer migration.

The overload is the defect. Anyone acting on "INDETERMINATE means something is
broken" will break the pause; anyone acting on "INDETERMINATE means step-up"
will silently swallow a real cloud evaluation error.

## Live baseline — what must still work afterwards

Captured 2026-08-18 against the running stack, direct to
`POST /governance/pap/alpha/policy/mcp-gateway/decision`, real subject
(`1aee74ae…`) and real actor (`71e878ea…`):

```
$600  -> INDETERMINATE / STEP_UP        banking, retail, airlines, sporting-goods, healthcare
$300  -> INDETERMINATE / HITL_CONSENT   same five
$100  -> PERMIT         all policy rules passed
$2500 -> DENY           amount_exceeds_ceiling: $2500 exceeds the absolute deny limit of $2000
```

Reproduce with `scripts/` equivalent of the probe in the PR description. Note
the meaning already lives in `reason`, not in `decision` — that is what makes
the rename option below cheap.

Also observed the same day: `demo_authz_server` logged **zero** INDETERMINATE in
45 minutes of ordinary traffic, and the real cloud decision endpoint returned
clean `PERMIT`s. The error case this plan targets is not currently firing; only
the intended pause is.

## Blast radius (measured, not estimated)

- **55 source files** reference `INDETERMINATE` (excluding tests)
- **40 test files** assert on it
- `demo_authz_server/routes/decision.js` — 12 `STEP_UP` / `HITL_CONSENT` sites
- `demo_authz_server/tests/decision.test.js` — 26 `INDETERMINATE` assertions
- Consumers include `transactionConsentChallenge`, `mcpToolPipeline`,
  `simulatedAuthorizeService`, `pingOneAuthorizeService`, `attackSimulatorService`,
  `authorizeLearningDemos`, `mcpGatewayClient`, `demo_mcp_gateway/src/hitlClient.ts`,
  and PingGateway's Groovy `p1az-decision`
- REGRESSION_PLAN §1 protected: UC7 step-up, UC8 HITL consent

## Two ways to reach the same end state

### Option A — rename the pause (recommended, not chosen)

Introduce a distinct decision value (`CHALLENGE`, or `PENDING`) for the pause.
`INDETERMINATE` then means only "evaluation failed", which is the plan file's
intent, and every existing `reason=STEP_UP` / `reason=HITL_CONSENT` becomes
`decision=CHALLENGE` carrying the same reason.

- No behavioural change: the same calls pause, the same calls permit
- The 26 pinned assertions become a rename, not a redesign
- Consumers need a one-line mapping, and the wire value changes — so the Groovy
  script and any snapshot fixtures must move in the same commit

### Option B — rework step-up off INDETERMINATE entirely (chosen)

Step-up and HITL stop using the decision channel at all: the PDP returns
`DENY` with an obligation, or `PERMIT` with an unfulfilled obligation, and the
PEP raises the challenge from the obligation rather than from the decision.

- Closest to the plan file's literal instruction
- Aligns with XACML obligations, which is what obligations are for
- Largest change: every consumer that branches on `decision === 'INDETERMINATE'`
  must branch on an obligation instead, and the `obligatory` / `fulfilled`
  fields already present in the cloud response become load-bearing
- **Known trap:** memory records that `obligatory:false` is NOT safe to treat as
  optional (`llm-path-approval-gate-open`), and that an INDETERMINATE with no
  obligation must resolve to DENY (#1310). Both constraints apply directly here.

## Phased execution (Option B)

Each phase ships independently and leaves the suite green.

1. ~~**Characterise.**~~ **DONE 2026-08-18** —
   `demo_authz_server/tests/decision.indeterminateBaseline.test.js`, 24 tests,
   green. Freezes the four amount bands across five verticals' write tools
   (banking/retail/healthcare/sporting-goods/investment), deliberately mixing
   `challengeType: 'consent'` and `'step_up'` tools to pin a second invariant:
   **the amount bands ignore the tool's declared challengeType** (the
   `declaresStepUp`/`declaresConsent` branches require `!hasAmount`), so the
   rework must not let that leak into the amount path.

   The pause assertion is isolated in three helpers — `assertPauses` /
   `assertPermits` / `assertDenies` — so phases 2-4 rewrite ONLY those and the
   band table stays byte-identical. If a later phase has to edit the table, the
   rework changed behaviour, which is what this test exists to catch.

   **Correction to the baseline above:** the deny ceiling is **exclusive**
   (`txAmount > DENY_CEILING_USD`, decision.js ~795) while both pause thresholds
   are **inclusive** (`amount >= X`, ~907-911). So `$2000` exactly is NOT denied —
   it pauses for STEP_UP; `$2000.01` is the first denied amount. A first draft of
   the test asserted DENY at `$2000` and failed, which is how this surfaced. If
   the rework normalises the comparisons, that is a deliberate behavioural change
   and this test will say so.

   Guard proven to bite: mutating the step-up threshold from `>=` to `>` fails the
   edge test (23/24). Pre-existing suite state is unchanged — 10 failures in
   `importSnapshot.parity` / `introspect.*` occur identically with and without
   this file (236→260 tests, +24 all passing).
2. ~~**Introduce the obligation.**~~ **DONE 2026-08-18** — every pause response
   (STEP_UP / HITL_CONSENT via the `indeterminate()` helper, plus the inline
   ELICITATION site) now also carries
   `obligations: [{ id, type, obligatory: true, fulfilled: false }]`.
   `obligatory` is hard-coded true per the #1310 / llm-path-approval-gate traps
   (an "optional" pause is not a pause). Nothing consumes it yet. Pinned by
   `tests/decision.obligations.test.js` (5 tests: three pause kinds each carry
   exactly one obligatory unfulfilled obligation; PERMIT and DENY carry none);
   the phase-1 baseline file is untouched and green — decision/reason/
   statements byte-identical.
3. **Move consumers one at a time**, each with its own test flip:
   `transactionConsentChallenge` → `mcpToolPipeline` → `hitlClient.ts` →
   Groovy `p1az-decision` → the UI surfaces that read the decision.

   **Progress 2026-08-18 (phase 3a):**
   - **Discovery that re-scopes this phase:** the BFF consumers are already
     obligation-first — `demo_api_server/services/authorizeObligations.js` (the
     H2 fix) is the single classifier both engines route through, and the Node
     gateway independently grew the same architecture
     (`demo_mcp_gateway/src/auth/authorizeObligations.ts`, statements-based,
     with the INDETERMINATE-no-obligation fail-closed DENY that phase 5 wants
     already in place for that consumer). What remained was wiring the
     EXPLICIT phase-2 `obligations[]` into those classifiers.
   - **Node gateway DONE:** `PingOneAuthorizeClient.toDecision` now classifies
     `data.obligations` FIRST (the phase-2 structural contract), statements as
     fallback; explicit wins on disagreement. 5 new tests in
     `tests/authorizeObligations.test.ts` (obligations-only responses for all
     three pause kinds — previously those hit the fail-closed DENY branch —
     plus precedence and fallback-intact). Full gateway suite 776/776.
   - **Remaining in this phase:** BFF `pingOneAuthorizeService` /
     `simulatedAuthorizeService` explicit-obligations pass-through audit,
     Groovy `p1az-decision`, and the UI decision surfaces.
4. **Flip the PDP** to stop emitting INDETERMINATE for the pause.
5. **Add the guard** the plan actually wants: any INDETERMINATE from either
   engine is now unambiguously an error — log it loudly, fail closed, and
   surface the missing attribute.

## Verification gates

- `cd demo_authz_server && CI=true npm test` — `node --test`, not jest
- `cd demo_api_server && CI=true npm test -- --forceExit --maxWorkers=4`
- `cd demo_mcp_gateway && npm run build && SUITE_BLOCKING=1 npm run test:mcp-gateway`
- Live re-probe of the four bands across five verticals — the table above
- UC7 and UC8 driven through the UI, since neither is provable from unit tests

## Do not

- Do not start this alongside another change to the same files. It touches the
  authz contract; a merge conflict here is a correctness risk, not an
  inconvenience.
- Do not "fix" the 26 pinned assertions by rewriting them to match new
  behaviour before the behaviour is agreed. They encode the contract.
- Do not treat a green unit suite as proof. The pause is a user-visible flow;
  it needs the live probe.
