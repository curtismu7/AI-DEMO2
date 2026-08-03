# Vertical chip audit — 2026-08-01

Started as "test the workforce vertical". Workforce came back clean, but the two
checks written to prove that turned up defects in other verticals, so the audit
was generalised and is now a script anyone can re-run.

```bash
node demo_api_server/scripts/audit-vertical-chips.js            # all nine verticals
node demo_api_server/scripts/audit-vertical-chips.js workforce  # one vertical
```

Offline — reads the catalog, the heuristic parser and the per-vertical seeds. No
running stack, no credentials. Exits `1` when anything is flagged, so it can be
promoted to a pre-push gate once the findings below are fixed.

## Why existing gates miss these

`tests/useCases.primaryTool.test.js` is the drift gate for chip routing: for every
vertical × chip it parses the trigger phrase and asserts the resolved tool equals
that vertical's stored `primaryTool`. 129 checks, and they all pass. It cannot see
either defect class below.

| gate | asserts | blind to |
|---|---|---|
| `useCases.primaryTool.test.js` | resolved **tool** == stored `primaryTool` | the **params** that go with it |
| same, `chipEntries()` line 56 | — | anything matching `A2A_UNROUTABLE`, whose `primaryTool` is then never validated at all |

The second exclusion is correct for *routing* — "delegate this to a specialist" is
resolved by the LangGraph dispatch overlay, not `parseHeuristic`, so the gate would
fail it spuriously. But skipping the row also skips its stored contract value.

## Finding 1 — UC2.5 contracts the wrong tool in 8 of 9 verticals

Every vertical except banking stores banking's `get_portfolio_summary` as the
`primaryTool` for "delegate this to a specialist", while `config/a2aSpecialists.js`
declares a different specialist tool for each:

```
healthcare      primaryTool "get_portfolio_summary"  specialist "sensitive_patient_records"
retail          primaryTool "get_portfolio_summary"  specialist "sensitive_order_history"
government      primaryTool "get_portfolio_summary"  specialist "sensitive_tax_record"
university      primaryTool "get_portfolio_summary"  specialist "sensitive_student_finance"
workforce       primaryTool "get_portfolio_summary"  specialist "sensitive_payroll_details"
sporting-goods  primaryTool "get_portfolio_summary"  specialist "sensitive_membership_details"
manufacturing   primaryTool "get_portfolio_summary"  specialist "sensitive_supplier_contract"
investment      primaryTool "get_portfolio_summary"  specialist "sensitive_investment_holdings"
```

This is the same "banking base entry leaks into every vertical" class that PR #553
set out to eliminate — it fixed the read and amount chips and left the A2A chip,
because the A2A row is excluded from the gate that would have caught it.

**Impact is documentation-level, not runtime.** `primaryTool` is the response
contract the gate holds a chip to; the A2A handoff itself resolves through
`a2aSpecialists.js`, which is correct everywhere. So the demo behaves properly and
the catalog lies about it. That matters the moment anyone builds on `primaryTool`
— any per-vertical test, evidence table or doc generated from it inherits the wrong
tool for eight verticals.

## Finding 2 — sporting-goods amount chips demo a rental that does not exist

```
extend my rental $2500  ->  { amount: 2500, rentalId: "2500" }
extend my rental $600   ->  { amount: 600,  rentalId: "600"  }
extend my rental $300   ->  { amount: 300,  rentalId: "300"  }
extend my rental $150   ->  { amount: 150,  rentalId: "150"  }
```

Real rental ids in `config/verticals/sporting-goods/seed.json` are **3001–3006**.
The heuristic reuses the dollar figure as the record id, so all four chips address
a rental that isn't there.

This is exactly the defect the `chip-correctness-testing` skill records for
healthcare (`pay my $300 bill` → `recordId: "300"` against real ids 101–106).
Healthcare has since been fixed — it now returns `{ amount: 300 }` alone —
but sporting-goods was never swept.

Every other vertical is clean here. Banking (`fromId`/`toId`) and retail
(`product`) carry non-id descriptors, which is why the audit ignores those keys.

## Workforce — clean

All 12 unique chips route to their contracted tool, and no chip injects a value
that isn't real:

```
UC1     "my benefits"                        -> view_benefits              {}
UC2     "show my sensitive payroll details"  -> sensitive_payroll_details  {}
UC6/7/8/22  "submit a $N expense"            -> submit_expense             { amount: N }
UC24    "What office locations are near me?" -> get_branch_hours           {}
UC30/31 "what's the weather in ..."          -> get_weather                { city_name }
```

The amount chips carry `{ amount }` and nothing else — no invented `expenseId`,
which is the sporting-goods failure. Ground truth for later value-level work:
`config/verticals/workforce/seed.json` — `expenses[].amount` (ids 201–206),
`payslips[].grossPay/netPay` (301–305), `pto.balance` = 14, `benefits[]` has no
money key at all.

Note `UC2.5` also flags for workforce, but that is Finding 1, not a workforce bug.

## What this audit does NOT cover

Only defect class 1 from `chip-correctness-testing` — routing and params. The other
two need an authenticated session, which this script deliberately does not require:

- **Tool data.** Does the payload match the seed? Needs `POST /api/mcp/tool` with a
  customer session.
- **Narration.** Does every money figure in the rendered prose appear in that turn's
  tool payload? Needs a browser, because only a browser sees rendered prose.

Both were attempted on 2026-08-01 and neither completed: `/api/demo-agent/nl`
returns routing only (`{ source, result: { kind, vertical, action, params } }`) with
no payload, and Playwright could not launch — the cache held build 1234 while the
repo's Playwright wanted 1217, and a headed launch is blocked by the sandbox
(`kill EPERM`). Anyone with a working browser should extend this with the narration
check; the seed key names above are the ground truth to assert against.

Also unmeasured: everything here ran with the heuristic floor **ON**, which is the
only path a matched chip phrase takes. Per `chip-correctness-testing` Trap 1, that
says nothing about "Routing: LLM only" mode.

## Re-checking after a fix

```bash
node demo_api_server/scripts/audit-vertical-chips.js            # expect: clean
```

When both findings are fixed the script exits `0` and can be wired into
`.husky/pre-push` next to the existing topology gates, so a newly added vertical
cannot reintroduce either defect.
