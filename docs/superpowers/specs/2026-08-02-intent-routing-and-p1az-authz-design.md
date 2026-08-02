# Intent routing stability + P1AZ authz relocation — design

Date: 2026-08-02
Status: approved design; partially implemented — PR #1213 (Stage 1 changes 5+6),
PR #1214 (silent banking fallbacks), PR #1215 (intent-topology generator+checker)
Origin: a SpiceDB evaluation that concluded SpiceDB is the wrong tool

## ⚠️ Corrections since first draft

Implementation disproved several claims below. Each one is corrected in place and
tagged `[CORRECTED]` where it sits, so a reader who acted on the first draft can
see exactly what moved. Nothing was silently edited.

| # | As first written | What implementation measured | Corrected at |
|---|---|---|---|
| 1 | 4 Helix guards to delete in `geminiNlIntent.js` | **3.** The fourth site is generic provider resolution and must stay | Stage 1, change 5 |
| 2 | Overlay shadow ranked failure #3, a live defect | **Zero** instances exist. The check guards a hypothesis | Failure ranking; Stage 1, change 3 |
| 3 | "19 of 20 mismatches were probe error", 25-vs-26 chip discrepancy | **26 blocking + 5 informational**, itemised | Stage 1, change 4 |
| 4 | One lie in `catalog.test.js` | **Two.** `resolveActiveVerticalCtx()` is the second | "The test that lies" |
| 5 | *(not in first draft)* | Six silent banking fallbacks — now fixed by #1214 | Stage 0 |
| 6 | *(not in first draft)* | `a2a` intent missing in 3 of 9 Class A verticals | Stage 0 gap inventory |
| 7 | `both` asserts heuristics **and** offered-to-LLM | Only the first half is asserted — 19 chips would fail the second wrongly | Stage 1 gate table |

## Problem

Three (really four) dispatch shapes decide which tool a prompt reaches, and
nothing proves any of them route correctly:

1. **Standard vertical** — plugin heuristics + plugin tools,
   `demo_api_server/services/verticalDispatch.js:76-101`
2. **Admin** — overlay merged on top, `PLUGIN_OVERLAY_IDS = ['admin']`,
   `verticalDispatch.js:9`
3. **pingone-admin** — bypasses the heuristic layer entirely,
   `geminiNlIntent.js:448-449`, early return `bankingAgentLangGraphService.js:720`
4. **A2A overlay** (undeclared) — flag + specialist gated, `verticalDispatch.js:94-99`

### Named fragilities

- **Order-dependent regex.** `verticalDispatch.js:85-87` prepends
  `ACCOUNT_NICKNAME_HEURISTIC` so nickname beats bare "account". Correctness
  depends on array position. A new chip can silently steal another chip's phrase.
- **Silent last-write-wins authz.** `authzFor` does
  `{ ...authz, ...adminOverlay.getAuthz() }` at `verticalDispatch.js:197`.
  Collisions are never reported.
- **try/catch as routing.** `verticalDispatch.js:173-186` conflates "tool not
  mine" with "tool blew up". The `NOT_MY_TOOL` sentinel patches the return path,
  not the throw path.
- **No coverage gate.** Nothing proves the 120 chip phrases resolve uniquely.
- **Three unschema'd tool fields.** A chip's target tool lives in
  `chips10[].tool`, `featurePage.mcpTool`, or `chips10[].denyTool`.

### The test that lies

`demo_api_server/tests/nlIntentParser.catalog.test.js:223`:

```js
expect(['vertical', 'banking', 'education']).toContain(res.kind);
```

Asserts the phrase resolved to *a* kind, never that it resolved to `chip.tool`.
A chip routing to the **wrong** tool passes green. `pingone-admin` is in that
list at line 191 while production skips heuristics for it entirely — those chips
are tested on a path they never take.

### `[CORRECTED]` There are two lies in that file, not one

The second is the context the test feeds the parser. Line 218 sets the active
vertical, then line 219 calls `resolveActiveVerticalCtx()` — with no `req`:

```js
verticalManifest.resolver.setActive(v);
const ctx = resolveActiveVerticalCtx();
const res = parseHeuristic(chip.message, v, ctx);
```

`resolveActiveVerticalCtx()` at `services/nlIntentParser.js:885-887` is
`resolveVerticalCtx(sessionVerticalId(req) || "banking")`. With no request there
is no session, so it resolves **banking** for every vertical, and
`resolveVerticalCtx` returns `null` for banking at line 831. Measured: `retail`,
`healthcare` and `oauth-teaching` all yield `null`. `setActive(v)` has no effect
on the ctx at all.

That matters because the parser's `llm`/`direct` guard at
`nlIntentParser.js:1010-1032` reads `verticalCtx?.chips`. With `ctx === null` the
chips array is empty, `nonHeuristicChipMessages.size` is 0, and the guard **never
fires** in this test. The test therefore cannot detect the thing that guard
exists to catch.

Both lies have the same shape as the ledger's 446/446 `PASS`: green that checks
less than it appears to.

## Why not SpiceDB

SpiceDB is Zanzibar ReBAC. It answers *can subject S do permission P on resource
R*. The instability is prompt-to-tool routing. Different question; zero overlap.

The one place it did overlap — per-vertical relationship data — loses to PingOne
Authorize, which is the product this repo exists to demonstrate. Adding SpiceDB
would either replace the thing being demoed or become another service in a stack
with documented Compose/env fragility. Same verdict applies to OpenFGA, Permify,
Ory Keto, Cedar and OPA.

## Failure ranking (confirmed)

| # | Failure | Gated today |
|---|---|---|
| 1 | (a) wrong tool, silent — kills the "governed agent" premise | ❌ |
| 2 | (c) heuristics vs LLM divergence | ❌ |
| 3 | (d) overlay shadow via `mergeToolsByName` / `authzFor` — **see correction below** | ❌ |
| 4 | (b) dead-end — loud, two tests already cover it | ✅ |

`[CORRECTED]` **Row 3 was ranked as a live defect. It is not one — the count is
zero.** Measured against the live plugins via
`gen-intent-topology.js:410-437 collectOverlayInputs()`: `admin` contributes 8
tools (`lookup_customer`, `get_customer_transactions`, `get_customer_profile`,
`get_customer_accounts`, `freeze_account`, `adjust_balance`,
`reset_customer_password`, `delete_customer`) and `a2a` contributes 1
(`delegate_to_specialist`). None of the 9 collides with any base vertical's tool
names, and the same holds for the authz keys — 0 collisions on both scans.

So overlay shadowing is a **hypothesis the mechanism permits**, not a defect the
repo has. `checkOverlayShadowing` (`gen-intent-topology.js:387-404`) is built and
wired, and it will catch the first collision the day someone names an overlay
tool after a vertical tool. It should be read as a standing guard, not as a fix.
Row 3 keeps its position in the *mechanism* ranking — last-write-wins that
reports nothing is still the riskiest of the four shapes — but it is not
currently costing the demo anything.

---

# Stage 0 — vertical parity contract

Every vertical behaves the same way, carries the same intents (intent, not
wording), goes through the same server flow its use case requires, and fails the
same way on purpose. Verticals get added later and all of them matter, so parity
has to be enforced by a gate rather than by discipline.

## Two cohorts, both fully gated

**Class A — customer verticals (9).** banking, government, healthcare,
investment, manufacturing, retail, sporting-goods, university, workforce.
One shared canonical intent catalog. Every vertical implements every intent, in
its own domain language, pointing at its own tool.

**Class B — exception verticals (4).** admin, admin-console, oauth-teaching,
pingone-admin. Each declares its **own** intent catalog. Not exempt: each is
held to the same implementation and test standard as Class A — declared intents,
deliberate failures, step-verification coverage, gated chips. These carry demos
that matter as much as the customer verticals.

The gate does not care which cohort a vertical is in. It cares that the
vertical implements its declared catalog completely.

## Canonical catalog is derived, not authored

Banking is the reference row: 15 chips, and the only vertical carrying negative
intents. The generator derives the Class A catalog from banking's intents and
reports every vertical's missing cells. The catalog is **not** hand-written into
this document — hand-enumerating it here would go stale the first time a chip
is added.

Each intent is `{ intentId, semantic, mode, negative? }`. A vertical instantiates
it as `{ message, tool }`. Same intent, different words, different tool.

## intent-topology.json is a matrix, not a list

Rows are intents, columns are verticals. Each cell holds
`{ message, mode, declaredTool, resolvedTool, resolverPath, overlayPrecedence }`.

**An empty cell is a build error.** That single rule is what makes "all verticals
behave the same" checkable instead of aspirational, and it is what makes a newly
added vertical fail loudly until it is complete.

## Measured gaps as of 2026-08-02

Negative intents — **banking is the only vertical that has any**. Every other
vertical's single `direct` chip is a happy path:

| Vertical | `direct` / `llm` chips | Kind |
|---|---|---|
| banking | `bk-dpop` — *"fire a token with the wrong audience at the gateway"* | negative, wrong-aud |
| banking | `bk-deny` — *"show my health record"*, `denyTool: show_health_record` | negative, cross-vertical |
| banking | `bk-bad-scope` — resolves `test_wrong_scope` | negative, bad scope |
| banking | `bk-direct` → `get_my_accounts`, `bk8` (llm) | happy path |
| government | `gv-direct` → `view_permits`, `gv6` (llm) | happy path only |
| healthcare | `hc-direct` → `view_records`, `hc9` (llm) | happy path only |
| investment | `inv-direct` → `view_portfolios`, `inv-llm` | happy path only |
| manufacturing | `mf-direct` → `view_work_orders`, `mf6` (llm) | happy path only |
| retail | `rt-direct` → `list_orders` | happy path only, **no llm chip** |
| sporting-goods | `sg-direct` → `gear_order_status` | happy path only, **no llm chip** |
| university | `un-direct` → `view_courses`, `un8` (llm) | happy path only |
| workforce | `wf-direct` → `list_expenses`, `wf10` (llm) | happy path only |

Other Class A gaps:

| Gap | Missing in |
|---|---|
| `groups` block — sensitive tool ungated | government, investment, manufacturing, university |
| `llm` chip | retail, sporting-goods |
| `tiers` | all 8 except banking |
| `a2a` intent — **added by correction** | retail, sporting-goods, workforce |
| Chip count | 9–15, no two verticals agree |

`[CORRECTED]` **The `a2a` row is new.** The first draft never counted A2A
delegation as a parity dimension. `intent-topology.json` now derives it: the
`a2a` intent exists in **6 of the 9** Class A verticals — banking, government,
healthcare, investment, manufacturing, university — and is absent from **retail,
sporting-goods and workforce**. It belongs in the Stage 0 fill-in job alongside
the missing `llm` chips and `groups` blocks: A2A delegation is one of the demo's
headline stories, and three customer verticals cannot tell it.

Step-verification coverage (which use cases a vertical actually proves):

| Vertical | Unique UCs | Ledger files |
|---|---|---|
| retail | 27 | 47 |
| banking | 25 | 68 |
| healthcare | 24 | 56 |
| government, investment, manufacturing, sporting-goods, university, workforce | 24 | 44 each |
| pingone-admin | 4 | 11 |
| admin | 0 | **no directory** |
| admin-console | 0 | **no directory** |
| oauth-teaching | 0 | **no directory** |

Structural keys missing: `delegation` and `featurePage` from all four Class B
verticals; `identity` from admin and admin-console; `demoUsers` from
pingone-admin.

## `[CORRECTED]` Six silent banking fallbacks — found after this draft, fixed by #1214

The first draft did not know about these. They are the sharpest possible
violation of the parity contract this stage exists to enforce: a healthcare or
investment session that failed to route was served **banking's** chips, silently,
with no signal that a substitution had happened. "Every vertical behaves the same
way" cannot be checked while a routing miss quietly becomes banking.

Six sites, all now closed:

| # | Site | What it did |
|---|---|---|
| 1 | `config/fallback-chips/loader.js` | returned `FALLBACK_CHIPS.banking` for any unknown vertical |
| 2 | same file | `loadFallbackChips(verticalId = 'banking')` — the default parameter did it again for a missing arg |
| 3 | `services/fallbackDataResolver.js` | `intent.vertical \|\| 'banking'` |
| 4 | same file | the `catch` block resolved **every** thrown error to banking |
| 5 | `FALLBACK_CHIPS` map | `healthcare` absent entirely, so it fell through to 1 |
| 6 | `FALLBACK_CHIPS` map | `investment` absent entirely, same |

**The replacement is Option A — a structured no-match.** `buildNoMatch()` returns
one vertical or none, never a substitute: empty `chips`, the active `verticalId`,
`noMatch: true`, `intentsConsidered`, suggestions drawn **only** from that
vertical's own `dashboard.chips10`, and a human-readable message so text-only
surfaces still degrade gracefully. `chips` stays empty on purpose — a caller that
renders it cannot show another vertical's data.

Current state: `loader.js:23-31` uses a `hasOwnProperty` guard and returns `null`;
`fallbackDataResolver.js:78-104` resolves to one vertical or `buildNoMatch`;
`healthcare.js` and `investment.js` now exist in the map at `loader.js:9-10`.

`closestCandidate` is deliberately omitted. `parseForFallback` is an ordered regex
cascade that returns a hit or nothing — there is no score, and inventing one would
misrepresent the routing.

**Approved plan: Option A first, then Option C, with A as C's floor.** Option C is
grounded answers with per-claim source attribution. A ships now and is the
guaranteed behaviour; C layers on top of it. When C cannot ground a claim it must
fall back to A's structured no-match, never to a guess and never to another
vertical — A is the floor, not a stepping stone to be removed.

## Use-case parity: coverage is nearly there, the proof is not

Requirement: every Class A vertical demos the same use cases with similar
results. Measured against the step-verification ledger.

**Coverage is close.** 26 numbered use cases across Class A; **24 are universal**
to all 9 verticals. Only two gaps:

- **UC5** — banking only (`UC5.attack.unit-ref.json`, `triggerType: attack`).
  Missing in the other 8.
- **Three retail-only entries** — `agent-lifecycle-list-orders`,
  `agent-lifecycle-revoke`, `ciba-out-of-band-approval`. Missing in the other 8.

32 missing cells. That is a fill-in job, not a rebuild.

### ⚠️ The proof is hollow for half the ledger

446 ledger entries. **Every single one is `PASS`.** No non-`PASS` entry exists
anywhere in the ledger.

| Measure | Count |
|---|---|
| Total entries | 446 |
| `status: PASS` | 446 (100%) |
| `provesDeclaredOnly: true` | 225 (50%) |
| `flagsAssumedOn: true` | 225 |
| `flagsOffDetected` non-empty | 207 |

Exactly **25 declaration-only entries per vertical**, uniform across all nine —
so the hollow half is itself perfectly at parity, which is why the ledger reads
as if the verticals already match.

Worked example, `government/UC9.chip.unit-prereq.json`:

```json
{
  "vertical": "government", "useCaseId": "UC9",
  "mode": "unit-prereq", "status": "PASS",
  "primaryTool": "pay_fee",
  "requiredFlags": ["ff_authorize_group_policy", "ff_mcp_gateway_pinggateway"],
  "flagsAssumedOn": true,
  "provesDeclaredOnly": true,
  "flagsOffDetected": ["ff_authorize_group_policy", "ff_mcp_gateway_pinggateway"]
}
```

It reports `PASS` while recording that both required flags were **off**, that
they were *assumed* on, and that it proves the declaration only. UC9 is the
sensitive-data group-gate case — and government has no `groups` block at all.
It passes while the gate does not exist.

Mode distribution shows the same shape: 229 `unit-prereq` and 148 `unit-parse`
out of 446. Only **5 entries in the entire ledger** exercise a real agent path
(3 `llamacpp`, 2 `heuristic`).

This is the same defect as `catalog.test.js:223` — green that means less than it
appears — and it is why "similar results" cannot be verified today.

### What Stage 0 must do about it

1. **Fill the 32 missing cells** — UC5 and the three lifecycle/CIBA cases across
   the other 8 verticals.
2. **Separate declared from proven.** A `provesDeclaredOnly: true` entry must not
   count as coverage. The parity gate counts proven entries only.
3. **Require flags actually on.** An entry whose `flagsOffDetected` is non-empty
   is not a pass. Either run it with the flags on or record it as unproven.
4. **Raise the real-path floor.** Five real-agent entries across nine verticals
   cannot support a claim about behavioural parity. Every vertical needs its
   declared use cases exercised on a real path, not just parsed.

Expect the ledger to go red when this lands. That is the point — it is currently
green because it does not check.

## Negative-intent parity: all three, every Class A vertical

Decided. Each of the 9 customer verticals carries all three deliberate failures:

1. **Wrong audience** — fire a token with the wrong `aud` at the gateway.
   Vertical-agnostic; replicates directly from `bk-dpop`.
2. **Cross-vertical DENY** — name another vertical's tool to trigger a DENY.
   Pairing rule confirmed below; every target verified to exist.
3. **Bad scope** — resolves a `test_wrong_scope` equivalent.

Class B verticals declare their own deliberate failures appropriate to what they
demo, held to the same "must exist and must actually deny" standard.

### Cross-vertical DENY — pairing rule

The mechanism is already uniform across Class A and needs no invention. Every
customer vertical has a `featurePage.mcpTool` gated by a **distinct**
`featureScope`, and a vertical's token never carries another vertical's
featureScope. Naming a foreign `featurePage.mcpTool` therefore denies on scope.

Banking's existing `bk-deny` is exactly this pattern: it targets
`show_health_record`, which is healthcare's `featurePage.mcpTool`, gated by
`records:read`. The rule generalises it rather than inventing anything.

**Rule: each Class A vertical's cross-vertical DENY chip targets the
`featurePage.mcpTool` of the alphabetically next Class A vertical, wrapping.**

| Source vertical | Target vertical | `denyTool` | Denied by scope |
|---|---|---|---|
| banking | healthcare *(grandfathered)* | `show_health_record` | `records:read` |
| government | healthcare | `show_health_record` | `records:read` |
| healthcare | investment | `show_investment` | `invest:read` |
| investment | manufacturing | `show_work_order` | `workorders:read` |
| manufacturing | retail | `show_large_purchase` | `largepurchase:read` |
| retail | sporting-goods | `show_gear_order` | `gear:read` |
| sporting-goods | university | `show_enrollment` | `transcript:read` |
| university | workforce | `show_expense_report` | `expense:read` |
| workforce | banking | `show_mortgage` | `mortgage:read` |

All nine target tools were verified to exist as real, provisioned
`featurePage.mcpTool` values, so the earlier 502-instead-of-DENY concern does not
apply to this pairing.

**Banking is grandfathered** to its current healthcare target rather than moved
to government. `bk-deny` is a working, demoed chip whose behaviour is documented
in `scripts/extractChips.js:18-22`; changing its message and target to satisfy a
naming rule would touch protected demo surface for no functional gain. Two
consequences, both harmless and recorded so nobody "fixes" them later:
healthcare is targeted twice (from banking and government), and government's
`show_permit` is targeted by nothing.

**Why this is not a duplicate of the bad-scope intent.** `bk-bad-scope` resolves
a synthetic `test_wrong_scope` tool — it proves the scope check fires. The
cross-vertical DENY names a *real tool in a real other vertical* — it proves
domain isolation holds between two live verticals. Different claims; both worth
demoing.

⚠️ Verification requirement: each of the nine must produce an actual DENY, not a
502 and not a 200. A negative chip that errors out looks like a broken demo
rather than a working control, and a negative chip that succeeds is the failure
this whole plan exists to catch.

## Honest size

Roughly 24 new negative chip declarations (8 verticals × 3), 2 new `llm` chips,
4 new `groups` blocks, plus whatever the generator's gap report shows for
happy-path intents once the canonical catalog is derived. Three Class B
verticals need step-verification coverage built from zero.

This is the largest part of the work and it is deliberately generated-and-checked
rather than hand-maintained, because the same gap will reappear the next time a
vertical is added.

---

# Stage 1 — one intent table, both paths read it

## Governing invariant

**For every chip phrase, heuristics and the LLM resolve to the same tool.**

On free text, heuristics may abstain while the LLM resolves — the LLM is a
superset. What is forbidden is *contradiction*: the LLM resolving a chip phrase
to a different tool than heuristics do.

Agreement-or-abstain. Never disagree.

## Mechanism

`demo_api_server/scripts/gen-intent-topology.js generate|check` — copies the
house generator/checker pattern from `gen-scope-topology.js` and
`gen-vertical-tools.js`. Wired into `verticals:check` and `hygiene:check`.

`[CORRECTED]` Two notes on where it landed:

- **It is the odd one out on location.** `verticals:gen` / `verticals:check`
  (`demo_api_server/package.json:65-66`) chain three generators and every one of
  them lives in the repo-root `scripts/`, referenced as `../scripts/`:
  `gen-scope-topology.js`, `gen-feature-data.js`, `gen-vertical-tools.js`.
  `intents:gen` / `intents:check` (`package.json:63-64`) point at a **local**
  `scripts/gen-intent-topology.js`. Worth knowing before anyone goes looking for
  it next to its siblings.
- **It is not yet wired into any blocking gate.** Not `verticals:check`, not
  `hygiene:check`. Deliberate: it reports 26 blocking gaps today, so wiring it in
  now would make every gate red for reasons Stage 0 has not fixed yet. Wiring it
  in is the last step of Stage 0/1, not the first.

Emits `intent-topology.json`, one row per chip:

```
vertical · id · message · mode · declaredTool · resolvedTool · resolverPath · overlayPrecedence
```

**The same file feeds the LLM's per-vertical tool surface.** One table, two
consumers. Divergence becomes structurally hard rather than merely detected.

## Changes

1. **Zod schema tightening** — `services/verticalManifest/schema.js:25` requires
   exactly one normalized tool declaration, collapsing the three-field
   polymorphism (`tool` / `featurePage.mcpTool` / `denyTool`).
2. **`(action, vertical)` resolver** replaces the flat `ACTION_TO_TOOL` map in
   `tests/helpers/actionToTool.js`. Confirmed necessary: `chip.tool` and
   `featurePage.mcpTool` agree in all 8 verticals that have a feature page, so
   `vertical_feature_demo` resolves to `manifest.featurePage.mcpTool` —
   vertical-parameterized, not expressible as a flat map.
3. **Two new checks** — phrase collision within a vertical, and overlay
   tool-name shadowing from `mergeToolsByName` / `authzFor`.

   `[CORRECTED]` Both are built, and neither is finding what this draft expected.
   Overlay shadowing measures **zero** — see the correction under *Failure
   ranking*; it guards a hypothesis. Phrase collision finds **4**, all of them
   `phrase_duplicate` (same phrase, *same* declared tool), which the checker
   grades `warn` not `fail` at `gen-intent-topology.js:354-377`: `inv1`+`inv-direct`
   on *"show my portfolios"*, `rt1`+`rt-direct` on *"list my orders"*,
   `sg4`+`sg-direct` on *"order status"*, `wf3`+`wf-direct` on *"my expenses"*.
   Every one is a vertical's `direct` demo chip reusing its `both` chip's exact
   wording — an intentional alias, not ambiguous routing. **Zero** true
   `phrase_collision` (same phrase, different tools) exists anywhere.

   Read straight, that is the Stage 3 trigger firing negative: the collision count
   this design said would decide whether to build a semantic router is
   effectively 0.
4. **Backfill the no-tool chips** that already resolve correctly but never
   declared a tool. `oauth-teaching` is the bulk: all 12 of its chips.

   `[CORRECTED]` **The "19 of 20 mismatches were probe error" framing and the
   25-vs-26 discrepancy are both superseded.** The generator now measures it
   directly instead of estimating: **26 blocking, 5 informational**, across 120
   chips in 12 verticals. The gap list, verbatim from
   `cd demo_api_server && npm run intents:check`:

   | Vertical | Blocking | Chips |
   |---|---|---|
   | oauth-teaching | 12 | `ot1`–`ot12`, all `missing_declared_tool`, all `mode=both` |
   | banking | 4 | `bk-a2a` `tool_mismatch`; `bk-bad-scope`, `bk-dpop`, `bk8` `missing_declared_tool` |
   | retail | 4 | `rt5`, `rt8`, `rt9`, `rt10`, all `missing_declared_tool`, all `mode=both` |
   | government | 1 | `gv6` (`llm`) |
   | healthcare | 1 | `hc9` (`llm`) |
   | investment | 1 | `inv-llm` (`llm`) |
   | manufacturing | 1 | `mf6` (`llm`) |
   | university | 1 | `un8` (`llm`) |
   | workforce | 1 | `wf10` (`llm`) |

   The one-chip discrepancy resolves: **25** chips declare no tool at all, and the
   26th blocking gap is a different failure code — `bk-a2a`'s `tool_mismatch`. Both
   counts were right about different things.

   ⚠️ Note the three banking chips individually, because the shorthand "the
   negative chips have no tool" is wrong in the details:
   - `bk-dpop` is `mode=direct` and declares no `tool`, no `denyTool`.
   - `bk-bad-scope` is **`mode=both`** — not `direct` — and also declares neither.
     Its `useCaseId` is `insufficient-scope`; the design text above describes it
     as resolving `test_wrong_scope`, but nothing in the manifest says so.
   - `bk8` is `mode=llm` and declares no tool.

   ⚠️ `bk-a2a` is the only true routing mismatch in the repo and it is **not** a
   missing declaration: it declares `get_sensitive_account_details`, heuristics
   resolve action `sensitive_account_details` → tool `sensitive_account_details`,
   and **both tool names exist** on the banking plugin. One of the two is wrong;
   which one is a decision for implementation, not a typo to patch blind.

   Five informational (`warn`, non-blocking): the four `phrase_duplicate` aliases
   listed under change 3, plus `pa1` `client_dispatched_unverifiable` —
   `pingone-admin`'s `mcp_tools` action is UI-dispatched and maps to no BFF tool,
   so its declared `list_pingone_tools` cannot be verified statically.

   **Zero** were found for `unresolved`, `unreachable_tool`, `not_offered_to_llm`,
   `overlay_tool_shadow`, `overlay_authz_shadow` and `feature_tool_disagreement`.
   Six of the eleven failure codes the checker can emit have no instances at all.
5. **Delete 3 Helix guards** — `geminiNlIntent.js`, landed in #1213:

   ```js
   if (llmProvider !== 'helix') {
     return { result: { kind: 'none', message: 'PingOne Admin tools require Helix to be configured...' } };
   }
   ```

   `pingone-admin` already has 8 heuristic rules pinning exact hosted MCP tools
   (`config/verticals/pingone-admin/index.js:10-19`, exported line 42), and Helix
   is **not** a real dependency — `pingone-admin/tools.js:2` executes through
   `mcpPingOneHttpAdapter`, and the reason loop at
   `bankingAgentLangGraphService.js:722-724` already strips the provider and
   resolves generically. It runs on llamacpp today. This is a removal, not a build.

   `pingone-admin` is the extreme case of the governing invariant: a full
   heuristics path exists that production can never reach.

   `[CORRECTED]` **This draft said four sites — 448, 490, 496 and 511. Only three
   were locks.** The three removed were the guard itself (448) and the two
   `provider !== 'pingone-admin'` bypasses (490, 496) that skipped the heuristic
   short-circuit and the result cache.

   **Site 511 must stay, and deleting it would break free text.** It now sits at
   `geminiNlIntent.js:496` and reads:

   ```js
   const selectedProvider = (provider === 'auto' || provider === 'pingone-admin')
     ? resolveLlmProvider(langchainConfig).provider
     : provider;
   ```

   That is generic provider resolution, not a Helix pin. `pingone-admin` is a
   **routing marker, not an LLM name** — remove it from that condition and
   `selectedProvider` stays the literal string `'pingone-admin'`, which matches no
   provider branch below, so free text in the vertical dead-ends at the
   `kind: 'none'` fallback. Anyone reading the first draft as "delete all four"
   would have traded a Helix lock for a silent dead end.
6. **Fix `toolsCalled: []`** hardcoded at `bankingAgentLangGraphService.js:769`.
   `pingone-admin` reports zero tool calls even after calling five, so ProofStrip
   and step-verification see nothing. Landed in #1213.

## Gate: mode-appropriate, no exemptions

All 120 chips gated, none invisible. The assertion differs by mode:

| mode | assertion |
|---|---|
| `both` | resolves via heuristics to its declared tool ~~**and** that tool is offered to the LLM for that vertical~~ — **narrowed, see below** |
| `direct` | its `tool` / `denyTool` exists and has a handler on the dispatch path it actually uses — extends `services/checks/uiDispatchCheck.js` rather than duplicating it |
| `llm` | its tool appears in the schemas offered to the LLM |

`[CORRECTED]` **The `both` row is implemented as the first half only.** The second
half — "and that tool is offered to the LLM" — is **not** asserted; it is
**recorded**, per cell, as `offeredToLlm` (`gen-intent-topology.js:276`). The
`both` branch at `gen-intent-topology.js:320-338` checks heuristic resolution and
nothing else.

Asserting the second half would fail **19 chips wrongly.** Measured from
`intent-topology.json`: 102 of the 120 chips are `mode=both`, and 19 of those
carry a declared tool that is absent from the LLM schema set. All 19 are
`clientDispatched: true`, and every one of the 19 tools is a **gateway** tool:

- the nine `*-jwt` chips, all on `jwt_decode_full`
- the eight `*-feature` chips — `gv`/`hc`/`inv`/`mf`/`rt`/`sg`/`un`/`wf` on
  `show_permit`, `show_health_record`, `show_investment`, `show_work_order`,
  `show_large_purchase`, `show_gear_order`, `show_enrollment`,
  `show_expense_report`
- `retail`'s `rt-invest` on `show_investment`, and banking's `bk7` on
  `show_mortgage`

These are dispatched by the UI, not chosen by the LLM. Their absence from the
schema set is the design, so a check that failed them would be measuring the
wrong thing — the same category of error as the "20 mismatches" that turned out
to be `CLIENT_DISPATCHED_ACTIONS`.

⚠️ **Open question, deliberately not answered here.** Recording `offeredToLlm`
rather than asserting it leaves the real question open: *is abstention the correct
LLM behaviour for these 19?* A user who free-types *"show my mortgage"* instead of
clicking `bk7` reaches the LLM, which has no `show_mortgage` to offer. Whether
that should resolve, abstain, or route to a client-dispatch hint is a product
decision. The data to answer it is now in `intent-topology.json` per cell; the
answer is not in this document.

Literal "every chip must resolve through heuristics" was rejected for cause.
`scripts/extractChips.js:18-22` documents that `bk-deny`'s *"show my health
record"* **deliberately names a HEALTHCARE tool from banking** to trigger an
Authorize DENY. A banking heuristic matching that phrase would destroy the use
case the chip exists for.

## Honest limit

A static check proves a tool is *offered* to the LLM, not that the LLM *picks*
it. Live agreement requires replay: `npm run intent:sweep:llm`, opt-in, built on
the existing sweep tooling, **not** in the default gate. Claiming a static check
proves LLM agreement would repeat the exact lie `catalog.test.js:223` tells today.

## Correction carried forward

19 of 20 originally-reported "mismatches" were probe error, not defects.
`scripts/useCaseSweepCauses.js:29-43` defines `CLIENT_DISPATCHED_ACTIONS`
containing `jwt_decode_demo`, `vertical_feature_demo`, `invest_demo`, `mcp_tools`.
Those chips are dispatched by the UI, so their heuristic action never needs to
equal a BFF tool name. The comparison was invalid.

`[CORRECTED]` **Superseded as a count.** The reasoning above still holds — the
generator honours `CLIENT_DISPATCHED_ACTIONS` and records those chips as
unverifiable rather than failing them — but "20 mismatches, 19 of them probe
error" is no longer the number anyone should quote. The measured figure is
**26 blocking and 5 informational**, itemised under Stage 1 change 4.

Real chip count is **120**, not the 399 first reported — the earlier count
included every `id` field in the manifests, not just chips.

Chips live at **`manifest.dashboard.chips10`**, not at the manifest top level.
`demo_api_server/scripts/extractChips.js` reads the banking manifest as the CI
baseline; `tests/real/shared/all-chips-pipeline.test.js` is the cross-vertical
reader. The generator must use the same nesting or it will silently find zero.

Verified distribution — 12 verticals carry chips, `admin-console` has none:

| Vertical | Chips | No tool | `tiers` | `groups` |
|---|---|---|---|---|
| banking | 15 | 3 | Y | Y |
| retail | 15 | 4 | – | Y |
| oauth-teaching | 12 | 12 | – | – |
| healthcare | 10 | 1 | – | Y |
| workforce | 10 | 1 | – | Y |
| government | 9 | 1 | – | – |
| investment | 9 | 1 | – | – |
| manufacturing | 9 | 1 | – | – |
| university | 9 | 1 | – | – |
| sporting-goods | 9 | 0 | – | Y |
| admin | 8 | 0 | – | – |
| pingone-admin | 5 | 0 | – | – |

---

# Stage 2 — tier/group relationships into PingOne Authorize

## What was found

The recovered analysis claimed this data was hand-written ReBAC repeated across
12 verticals. **That was wrong.** Actual distribution:

- `tiers` — **banking only**
- `groups` — **5 verticals**: banking, healthcare, retail, sporting-goods, workforce

Consolidation already happened. `demo_api_server/config/group-policy.json` is
explicitly marked `DEPRECATED — group policy lives in
config/verticals/*/manifest.json`, and `services/groupPolicy.js` (246 lines) is
the single accessor.

### ⚠️ The gap that correction exposed

Nine verticals ship a `sensitive_*` tool. Only five gate it. Four have the tool
and **no `groups` block at all**:

| Vertical | Sensitive tool | Gated |
|---|---|---|
| banking | `get_sensitive_account_details` | ✅ |
| healthcare | `sensitive_patient_records` | ✅ |
| retail | `sensitive_order_history` | ✅ |
| sporting-goods | `sensitive_membership_details` | ✅ |
| workforce | `sensitive_payroll_details` | ✅ |
| government | `sensitive_tax_record` | ❌ |
| investment | `sensitive_holdings` | ❌ |
| manufacturing | `sensitive_supplier_contract` | ❌ |
| university | `sensitive_student_finance` | ❌ |

This is inconsistency, not intent — a demo run in government or investment shows
no group gate on data the vertical itself labels sensitive.

## The real reason to do this

The data feeds the **simulator**. `simulatedAuthorizeService.js:863-888` calls
`groupPolicy.getTierDefinitions()` and `groupPolicy.resolveUserTier()`, then
enforces `maxAmountUsd` and `privateBankingOnlyTools` in JavaScript.

So the demo's most concrete authorization story —

> "$2,000 Standard vs $50,000 PrivateBanking; group membership expands capability"

— is enforced by a JS simulator while the demo's premise is that PingOne
Authorize does fine-grained authz. Enforcement is additionally flag-gated OFF
via `ff_authorize_group_policy`.

Stage 2 moves that story into the product being sold. That is the value, not
de-duplication.

## Scope — close the gap, then relocate all nine

Decided: do not relocate only what exists today. That would carry the
inconsistency into P1AZ and leave four verticals demoing an ungated sensitive
tool.

**Step 1 — close the gap.** Add `groups` blocks to government, investment,
manufacturing and university, following the shape the other four non-banking
verticals already use (`categories.privileged` / `categories.delegates`, plus a
`restrictedTools` entry pointing the vertical's `sensitive_*` tool at
`privileged`). Provision the corresponding PingOne groups — see
`services/pingoneProvisionService.js`, already a consumer of this data.

**Step 2 — relocate all nine.** Move group-restricted-tool policy for all nine
verticals, plus banking's tier ceilings, into P1AZ via the snapshot generator.

`tiers` stays banking-only. Tier ceilings are amount-based and only meaningful
where a value transfer exists; inventing thresholds for verticals without one
would add demo surface with no story behind it.

## Import path (option C, confirmed already in place)

`snapshots/gen-authorize-snapshot.js` (832 lines) is the SoT-driven reconciler
for the cloud P1AZ import file. It reconciles by stable ID against
`scope-topology.json` and is idempotent. Snapshots are git-tracked. Stage 2
extends this generator; it does not invent a new mechanism.

Two properties of the existing path:

- **No automated push.** The generator's own header: *"PingOne Authorize has NO
  policy API for COMPARISON conditions, so the cloud policy is updated by
  importing a snapshot."* Import remains a console upload. This is a product
  limitation, not a repo gap.
- **`demo_authz_server/routes/import-snapshot.js` is a validator, not an
  importer.** It parses a snapshot, diffs it against `scope-topology.json`, and
  returns `{ valid, policies, conflicts }`. This is the drift gate, already built.

## The DSL constraint

The generator documents what P1AZ cannot express, including: *"TokenScopes is a
space-separated set and the DSL has no set/contains operator"*, and the same for
the RAR payee allow-list. Group membership is an array, so it hits the same wall.

Our data splits accordingly:

| Data | Expressible in P1AZ |
|---|---|
| `tiers.definitions.maxAmountUsd` | ✅ numeric comparison — the snapshot already does `Amount > confirm($250)` and `RarMaxAmount` |
| `tiers.groupToTier` | ❌ requires set membership |
| `groups.restrictedTools` | ❌ tool equality is fine, group membership is not |

## Resolution — flatten at the PEP

Follow the convention the snapshot already uses for `HasMFAAuthentication` and
`RarAmountExceeded`: precompute scalars at the PEP, let P1AZ evaluate numeric and
equality only.

`groupPolicy.js` resolves the user's tier before the decision call and passes:

- `UserTier` (STRING)
- `UserMaxAmountUsd` (NUMBER)
- `ToolRequiresGroup` (BOOLEAN)

P1AZ then owns the *policy* — the thresholds, the deny rules, the decision.
Membership *resolution* stays at the PEP because the DSL genuinely cannot hold it.
This is stated as a limitation in the design rather than hidden, mirroring the
generator's existing "DELIBERATELY NOT MODELED" section.

`ff_authorize_group_policy` remains the switch. The simulator remains the
fallback. P1AZ is an added path, not a replacement.

## ⚠️ Import hazard

Reimporting the snapshot **reverts the `act` mapping** that was hand-fixed on the
PingGateway resource via the Management API and never landed in git. Stage 2 must
fold that mapping into `gen-authorize-snapshot.js`, or every import silently
breaks the actor chain.

Related: a DENY from the local p1az-mock is **not** proof a cloud rule ran. The
mock is authored policy in the same generator. Verification must target real
PingOne Authorize, not the mock.

---

# Stage 3 — semantic router (not built; measurement-gated)

The genuine off-the-shelf alternative for the runtime. Embeddings + nearest
neighbour over the 120 chip phrases, per vertical, replacing ordered regex.
Kills order-dependence structurally — no array position, just similarity ranking
with a confidence floor.

Infrastructure already exists: the `embeddings` service in
`docker-compose.yml:1198` runs llama.cpp in `--embedding` mode serving an
OpenAI-compatible `/v1/embeddings` on `:8084` with nomic-embed-text-v1.5, in the
`rag` profile which `docker-compose.yml:39` says is on by default. Zero new
services. No new dependency either — the BFF is CommonJS, so this is roughly 100
lines against the existing endpoint, not a library.

**Cost:** regex either matches or does not. Cosine similarity is a tuned
threshold. For a demo that must be reproducible on stage this is a real
downgrade. Mitigation would be an exact-phrase index for the 120 canonical chips
(deterministic) with embeddings only as fallback for free-typed variants.

**Trigger to build it:** the phrase-collision count reported by
`intent-topology.json`. Near zero means Stage 3 buys nondeterminism for nothing.
Frequent collisions mean it has a case. Measure, do not guess.

`[CORRECTED]` **The measurement now exists and the trigger has not fired.** True
`phrase_collision` — one phrase, two different tools — measures **0**. The only
four hits are `phrase_duplicate` (one phrase, the *same* tool), all of them a
vertical's `direct` demo chip reusing its `both` chip's wording on purpose. On the
rule this document set, Stage 3 does not have a case today.

Also rejected: a runtime intent registry consulted by the parser instead of
walking ordered regex. It genuinely fixes order-dependence in production, but
rewrites the hot path in a 53K-line file that 129 pattern sites depend on. Blast
radius far exceeds the ask.

---

# Do-not-break

No change to OAuth, RFC 8693 token exchange, `middleware/auth.js`, BFF session
handling, or HITL transfer consent (428). Stage 1 leaves `nlIntentParser.js`
untouched — failures surface as build errors, not demo surprises. Stage 2 keeps
`ff_authorize_group_policy` as the switch and the simulator as fallback.

# Success criteria

1. `intent-topology.json` exists as an intent × vertical matrix, covers every
   chip, zero silent skips.
2. **Parity:** no empty cell. Every Class A vertical implements every canonical
   intent; every Class B vertical implements its own declared catalog completely.
   Adding a stub vertical with a missing intent fails the check.
3. **Deliberate failures:** all 9 Class A verticals carry all three negative
   intents, and each one actually denies — wrong-aud, cross-vertical, bad scope.
   A negative chip that returns 200, or 502s instead of denying, is a failure.
   The cross-vertical DENY is verified per the pairing table: nine sources, nine
   real `featurePage.mcpTool` targets, each denied on the target's `featureScope`.
4. **Step-verification:** every vertical has a ledger directory with coverage for
   its declared use cases, including admin, admin-console and oauth-teaching,
   which have none today.
5. **Use-case parity:** all 9 Class A verticals cover the same use-case set —
   UC5 and the three lifecycle/CIBA cases exist everywhere, not just in banking
   and retail.
6. **Ledger honesty:** zero entries counted as coverage while carrying
   `provesDeclaredOnly: true` or a non-empty `flagsOffDetected`. A run with the
   required flags off is recorded as unproven, not `PASS`. The ledger is capable
   of recording a failure and has recorded at least one during development —
   a ledger that has only ever emitted `PASS` proves nothing.
7. `npm run verticals:check` fails on a deliberately mis-declared chip tool.
8. `npm run verticals:check` fails on a deliberate phrase collision within a
   vertical, and on a deliberate overlay tool-name shadow.
9. `pingone-admin` chips resolve through heuristics with `LLM_BACKEND=llamacpp`
   and report non-empty `toolsCalled`.
10. `npm run intent:sweep:llm` reports zero contradictions across all chip phrases
    (heuristic tool equals LLM tool, or the LLM abstains).
11. Stage 2: with `ff_authorize_group_policy` ON, a $5,000 transfer for a Standard
    user is denied by **real** PingOne Authorize — verified against the cloud
    decision, not the mock — and the same denial reproduces after a fresh snapshot
    import, with the `act` mapping intact.
12. Stage 2: all **nine** `sensitive_*` tools are group-gated. A non-privileged
    user is denied each one by real P1AZ, in every one of the nine verticals —
    including the four that have no gate today (government, investment,
    manufacturing, university).
13. `cd demo_api_server && CI=true npm test -- --forceExit` green.
14. `npm run topology:verify` green.
