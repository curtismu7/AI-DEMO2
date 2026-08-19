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
   - **Groovy consumer DONE (#2133, stacked on this branch)** — and it closed a
     REAL trap that two investigations found independently the same evening:
     `classifyStatements` had no `ELICITATION` in its vocabulary (unlike the
     Node gateway and BFF classifiers), so a real cloud ELICITATION obligation
     classified to null — live `PERMIT + statements` shape forwarded the
     destructive call UNGATED — and the mock half survived only via the
     `simulated || failoverUsed` escape hatch on bare INDETERMINATE, which
     phase 4 would have silently killed along with the whole destructive-tool
     confirmation gate on the PingGateway path. #2133 adds `ELICITATION` (+
     `st.type` read, explicit `obligations[]` preferred, matching the Node
     client exactly), routes `obligationKind == 'elicitation'` through the
     human-approval branch, and RETIRES the engine-aware escape hatch — the
     gate now derives from classification alone, engine-agnostic. Verified in
     review 2026-08-18: vocabulary, precedence (elicitation lowest, never
     co-occurs), and handler are all present; the elicitation-confirmed
     arg/header plumbing (~333-373) was already in place.
   - **BFF `pingOneAuthorizeService`/`simulatedAuthorizeService` audit DONE
     2026-08-19 — no code change needed, both already correct:**
     `pingOneAuthorizeService.js`'s `_classifyRawObligations` (the H2 fix)
     already merges `raw.obligations` into the classification set ahead of
     `raw.statements` — built for real cloud P1AZ's native `obligations` field,
     which happens to share both the field name and the type/id/code shape
     `demo_authz_server`'s phase-2 field uses. This file never calls
     `demo_authz_server` directly (it is the real-cloud-only client — see the
     `pingOneAuthorizeIndeterminate.test.js` audit from the #2119 investigation),
     so in practice it never sees the mock's `obligations[]`, but the merge
     logic is already the "prefer explicit" shape phase 3 asks for, for the
     source it does see. `simulatedAuthorizeService.js` needs no "prefer
     explicit obligations" logic at all — it builds its `mcpCandidates`
     obligations array natively in-process (`type: 'STEP_UP'/'HITL_CONSENT'`)
     and classifies through the same shared `classifyObligations()`; there is
     no inferred-vs-explicit distinction to resolve because it never reads an
     external statements shape to fall back to. Both consumers predate this
     rework's obligations-first pattern rather than needing to adopt it.
   - **UI decision surfaces — checked, not changed:** none of
     `demo_api_server/routes/verticalManifest.js` (`/check-chip`),
     `demo_api_ui/src/vertical/AdminEditor/VerticalPipelineMap.jsx`, or
     `demo_api_ui/src/services/tokenChainTrace/buildTraceSteps.js` read
     `obligations[]` yet — they still branch on `decision`/`statements`, which
     phase 2/3a left byte-identical, so nothing is currently broken (confirmed
     live: Token Chain trace renders a $10 destructive-tool ELICITATION gate
     correctly post-#2133, no console errors, additive field ignored cleanly).
     Wiring the UI onto `obligations[]` has no functional payoff until phase 4
     actually changes what `decision` says — deferred there rather than done
     speculatively now.
4. **Flip the PDP** to stop emitting INDETERMINATE for the pause.

   **Live probe 2026-08-18 — this phase's blast radius is NARROWER than the plan
   assumed, and the verification gate below is aimed at the wrong flow.**

   Driven against the running stack as a real signed-in `demoUser`, two
   transfers on their own accounts (both correctly blocked, no money moved):

   | amount | result |
   |---|---|
   | $600 | `HTTP 401` `error: step_up_required` (UC7) |
   | $300 | `HTTP 428` `error: hitl_required` (UC8) |

   What the logs show underneath:

   - **UC7/UC8 transfers do NOT touch `demo_authz_server`.** `POST /api/transactions`
     goes to **cloud PingOne Authorize** (`[BFF→P1AZ]`); the authz-server container
     logged *zero* decisions across the whole window. So flipping the mock PDP
     cannot break UC7/UC8 transfer enforcement — the two are not connected.
   - **The cloud never returns INDETERMINATE for these.** It returns
     `decision: "PERMIT"` plus `statements[]` (`step-up-required`, `HITL_CONSENT`),
     and the BFF's obligation classifier turns those into 401/428. The transfer
     path has therefore been obligation-driven all along.
   - **The BFF response carries no `decision` field to the client at all** — the UI
     transfer flow consumes HTTP status + error code, so it is decision-agnostic
     by construction.

   Consequence: phase 4's real risk surface is the **MCP/agent tool path** (the
   gateway → `demo_authz_server` decision endpoint), not transfers. The gate
   "UC7 and UC8 driven through the UI" below should be *kept* as a
   non-regression check but is NOT the thing that proves phase 4 — a paused MCP
   tool call is.

   **Trap confirmed live, in writing:** every cloud statement above carries
   `obligatory: false` — including the step-up one. The BFF gates anyway because
   it ignores that field. Anyone who "fixes" a classifier to honour `obligatory`
   silently turns step-up off. This is the `llm-path-approval-gate-open` trap
   observed in production data rather than inferred; pinned by
   `demo_api_server/src/__tests__/authorizeObligations.test.js`.
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
