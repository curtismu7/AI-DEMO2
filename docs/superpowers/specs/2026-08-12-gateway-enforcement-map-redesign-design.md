# Gateway Enforcement Map — Redesign

**Status:** approved by user (mockup at https://claude.ai/code/artifact/869f8904-1db8-4545-822b-ee15e93aafcf), pending spec review.

## Problem

The current `gateway-enforcement-map` diagram (`scripts/gen-gateway-enforcement-map.js`, feeding `docs/gateway-enforcement-map.md`, the Learning Hub "Gateway vs P1AZ Decision Split" panel, and the `/gateway-enforcement-map` side-nav page) is a 3-column parallel inventory: P1AZ / Node gateway / IG groovy, each listing the same 5 rules. User feedback, verbatim: "I hate that diagram" → "doesn't tell a story." It states the current status accurately but doesn't explain *why* the split exists or make the stakes concrete — 15 boxes and dashed arrows that all say some version of the same thing three times.

## Goal

Replace the 3-column inventory with something that reads once, top to bottom, as an explanation — then still works as a reference afterward. Two things, not one, per the approved mockup:

1. **The Journey** — a single flow diagram: one request, traced through P1AZ, showing where and why it structurally can't decide, and where the gateway picks up instead.
2. **What's at stake** — five compact cards, one per rule, each a concrete "what could go wrong without this" scenario paired with the *current live* verdict.

The existing reference table (rule × Node × IG, ✅/⚠️/❌) stays, demoted from "the whole page" to supporting detail underneath.

**Non-goal:** no enforcement-logic changes. This is a presentation-layer redesign of an already-accurate data source.

## Architecture — stays single-generator

`scripts/gen-gateway-enforcement-map.js` remains the one source of truth. It already computes, per rule, `p1az` (why-can't-express text, extracted live from `gen-authorize-snapshot.js`'s comment block) and `node`/`groovy` status (`done` / `flagged` / `pending`, via source grep). This redesign adds two new authored fields per row and two new generated outputs — it does not touch the grep-based status detection.

### New per-row data (authored, not derived)

Each of the 5 `ROWS` entries in the generator gains one new static field:

```js
scenario: 'A token carries the coarse gateway:mcp:invoke scope but never earned transfer — and tries to call create_transfer anyway.',
```

Drafted scenarios for all 5 rows:

| Rule | Scenario |
|---|---|
| Temporal exp/iat/nbf | "A token minted hours ago, past the demo's replay window, gets replayed against a tool call — exp alone doesn't catch this, only iat max-age does." |
| Per-tool scope | "A token carries the coarse `gateway:mcp:invoke` scope but never earned `transfer` — and tries to call `create_transfer` anyway." |
| RAR payee allow-list | "A transfer's granted intent named one payee — the actual call sends the funds somewhere else." |
| D-05 multi-aud anti-bypass | "An agent presents a token whose `aud` already targets the banking resource server directly — skipping the gateway hop entirely." |
| tiers.groupToTier mapping | "A Standard-tier caller invokes a PrivateBanking-only tool, or tries to move more than their tier's ceiling." |

### Verdict tier (derived, reuses existing `status()` helper)

A card's/branch's color is the **worse of the two gateway statuses** for that rule — not two separate numbers:

- both `done` → tier `done` (green) — "Caught locally — both gateways"
- either `pending` (a true gap) → tier `gap` (red) — "Would slip through — see the table below"
- otherwise (one `done`, one `flagged`/`pending`, no true gap) → tier `partial` (amber) — asymmetric coverage; card names which gateway covers it and which doesn't, e.g. "Node catches it — IG ships this off by default"

This is a new `worstTier(row)` helper, computed once and reused for both the Journey branch chip color and the stakes-card verdict color — one status computation, two renderings, same rule as the rest of this generator (single source, multiple consumers).

### New generated outputs

In addition to the existing `GATEWAY_ENFORCEMENT_MERMAID` / `GATEWAY_ENFORCEMENT_ROWS`:

- `GATEWAY_ENFORCEMENT_JOURNEY_MERMAID` — the new single-flow diagram (`flowchart LR`): `Request → P1AZ evaluates → [5 branch chips, colored by worstTier] → Gateway backstops → Final decision`. Replaces the 3-subgraph diagram as the primary visual.
- `GATEWAY_ENFORCEMENT_STAKES` — array of `{ id, label, scenario, verdictTier, verdictText }`, one per rule, for the stakes cards.

`docs/gateway-enforcement-map.md` gets both: the new Journey mermaid block, and a "What's at stake" section rendered as a markdown blockquote-per-rule (scenario in italics, verdict as a line under it) — same content as the cards, plain-text form, so the doc reads standalone without a browser.

The old 3-subgraph `GATEWAY_ENFORCEMENT_MERMAID` is dropped (was the whole problem) — the reference table below already carries the per-gateway breakdown the 3-column diagram used to.

## UI changes

**`demo_api_ui/src/components/GatewayEnforcementMapPage.jsx`** (side-nav page) and **`demo_api_ui/src/components/education/GatewayPolicySplitPanel.js`** (Learning Hub "Enforcement map" tab) both restructure to:

1. Journey diagram (same `mermaid.render()` mechanism already in place, new source)
2. Stakes cards — horizontal-scroll row (mirrors the mockup's `.stakes-scroll`), 5 cards
3. Reference table (unchanged from today)

**Theming — real tokens, not the mockup's standalone palette.** The mockup used a throwaway palette to stand alone as an artifact. The real implementation uses this app's actual theme tokens: `--th-bg-card` / `--th-bg-inset` for card/inset surfaces, `--th-text` / `--th-text-muted` for type, `--th-border` for hairlines — same tokens `index.css` already defines for both light and dark. Status tiers (`done`/`partial`/`gap`) stay dedicated literals, consistent with how `STATUS_LABEL` already works in both files today (✅/⚠️/❌ + color) — not pulled from `--th-*`, which has no semantic-status tokens. Per project history (`--th-* tokens + --ba fallback trap`), **verify both light and dark render correctly live** before calling this done — that bug class is exactly late/literal color overrides escaping the token system.

The Learning Hub panel (narrower, inside `EducationDrawer`) may need the stakes cards in a tighter 2-up wrap instead of horizontal scroll — real width available there is smaller than the standalone page. Decide at implementation time by checking the actual rendered drawer width, not guessed.

## What doesn't change

- `scripts/gen-gateway-enforcement-map.js`'s status-detection grep logic (Node/groovy `done`/`flagged`/`pending` computation) — untouched.
- The reference table's shape and data.
- Any enforcement code (`tokenValidator.ts`, `p1az-decision.groovy`, etc.) — this is presentation only.
- `PG_LOCAL_RAR_PAYEE_ENFORCE` stays off; nothing here touches that decision.

## Testing

- `node scripts/gen-gateway-enforcement-map.js` runs clean, both new exports present.
- `demo_api_ui`: `npm run test:unit` + `npm run build`.
- Live verify: both pages render, both light and dark themes, journey diagram + all 5 stakes cards, no console errors — same Playwright-based check used earlier in this work.
