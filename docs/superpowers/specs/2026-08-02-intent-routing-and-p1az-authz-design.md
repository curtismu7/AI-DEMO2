# Intent routing stability + P1AZ authz relocation — design

Date: 2026-08-02
Status: approved design, not yet implemented
Origin: a SpiceDB evaluation that concluded SpiceDB is the wrong tool

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
| 3 | (d) overlay shadow via `mergeToolsByName` / `authzFor` | ❌ |
| 4 | (b) dead-end — loud, two tests already cover it | ✅ |

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
4. **Backfill the no-tool chips** that already resolve correctly but never
   declared a tool (`ot1`–`ot10` → `explain_concept`, `rt5`/`rt9` →
   `list_orders`, etc.). `oauth-teaching` is the bulk: all 12 of its chips.
   Count is 25 by direct manifest parse against 26 in the original pass — a
   one-chip discrepancy to reconcile during implementation, not to guess at now.
5. **Delete 4 Helix guards** — `geminiNlIntent.js` lines 448, 490, 496, 511:

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
6. **Fix `toolsCalled: []`** hardcoded at `bankingAgentLangGraphService.js:769`.
   `pingone-admin` reports zero tool calls even after calling five, so ProofStrip
   and step-verification see nothing.

## Gate: mode-appropriate, no exemptions

All 120 chips gated, none invisible. The assertion differs by mode:

| mode | assertion |
|---|---|
| `both` | resolves via heuristics to its declared tool **and** that tool is offered to the LLM for that vertical |
| `direct` | its `tool` / `denyTool` exists and has a handler on the dispatch path it actually uses — extends `services/checks/uiDispatchCheck.js` rather than duplicating it |
| `llm` | its tool appears in the schemas offered to the LLM |

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

1. `intent-topology.json` exists, covers 120/120 chips, zero silent skips.
2. `npm run verticals:check` fails on a deliberately mis-declared chip tool.
3. `npm run verticals:check` fails on a deliberate phrase collision within a
   vertical, and on a deliberate overlay tool-name shadow.
4. `pingone-admin` chips resolve through heuristics with `LLM_BACKEND=llamacpp`
   and report non-empty `toolsCalled`.
5. `npm run intent:sweep:llm` reports zero contradictions across all chip phrases
   (heuristic tool equals LLM tool, or the LLM abstains).
6. Stage 2: with `ff_authorize_group_policy` ON, a $5,000 transfer for a Standard
   user is denied by **real** PingOne Authorize — verified against the cloud
   decision, not the mock — and the same denial reproduces after a fresh snapshot
   import, with the `act` mapping intact.
7. Stage 2: all **nine** `sensitive_*` tools are group-gated. A non-privileged
   user is denied each one by real P1AZ, in every one of the nine verticals —
   including the four that have no gate today (government, investment,
   manufacturing, university).
8. `cd demo_api_server && CI=true npm test -- --forceExit` green.
9. `npm run topology:verify` green.
