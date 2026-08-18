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

1. **Characterise.** Convert the baseline above into a committed test that
   asserts the current pause behaviour end-to-end, per band, per vertical. This
   runs BEFORE any change and must keep passing in spirit afterwards (its
   assertions change shape, not outcome).
2. **Introduce the obligation.** PDP emits a step-up / consent obligation
   alongside today's INDETERMINATE. Nothing consumes it yet. Suite green.
3. **Move consumers one at a time**, each with its own test flip:
   `transactionConsentChallenge` → `mcpToolPipeline` → `hitlClient.ts` →
   Groovy `p1az-decision` → the UI surfaces that read the decision.
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
