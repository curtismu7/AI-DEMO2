# Chip challenge markers — consent vs step-up (MFA)

**Date:** 2026-07-11
**Status:** design (awaiting review)
**Branch:** `worktree-tag-sensitive-chip-hitl`

## Problem

Agent suggestion chips that pause for a human-in-the-loop control show a single
generic "MFA" circle badge (`HitlChipMark`, driven by boolean `hitlTrigger`). It
can't distinguish the controls the demo exercises, and some chips that pause
(the `sensitive_*` `*-a2a` chips) show no badge at all. Observed live: "Sensitive
records" triggered a consent gate with no badge; "Release my records" advertised
a generic MFA badge.

## Engine semantics (authoritative — drives the whole design)

`authorizeObligations.js` classifier is **highest-gate-wins, step-up dominates,
exactly one gate fires** (`authorizeObligations.js:95-101`). Step-up is defined
as **consent + MFA** (`simulatedAuthorizeService.js:71,630`: "requires consent +
MFA"). Therefore, per chip, the honest states are:

- **consent** — HITL approval only, no identity step-up → **👤**
- **both** — a real step-up gate (consent + MFA) → **👤🔑**
- **step_up (MFA spotlight)** — used ONLY on the dedicated MFA showcase chips to
  spotlight the authentication control → **🔑** (owner choice; the gate still
  carries consent, but these chips emphasize MFA)

Rule of thumb: a tool whose `authz` is `{ stepUp, consent }` fires step-up =
**both** (👤🔑); a tool whose `authz` is `{ consent }` fires **consent** (👤).

## Goal

Every vertical can demonstrate **both** a consent-only chip (👤) and a both chip
(👤🔑), regardless of which vertical is active.

## Constraints

- **Emoji allowlist (REGRESSION_PLAN §0).** Expand to add **👤** (HITL consent)
  and **🔑** (step-up / MFA), per explicit owner approval. Update all three:
  `REGRESSION_PLAN.md` §0 (source of truth), `CLAUDE.md` §0,
  `.cursor/rules/emoji-allowlist.mdc`.
- **Markers must match the runtime gate** — no chip may advertise a control it
  won't trigger (that is the bug this whole effort started from). This is why
  the three gap verticals get *real* new tools, not display-only tags.
- **No change to existing tools' gates** — existing UC policy outcomes preserved.
- **Minimal diff**, **worktree-only edits**, explicit staging.

## Design

### 1. Data model — per-chip `challenge`

Add optional `challenge: "consent" | "both" | "step_up"` to each paused chip.
Per-chip (not tool-derived) because showcase chips deliberately spotlight a
specific control. Render precedence in the UI:

1. `challenge` present → render its marker.
2. `hitlTrigger` true, no `challenge` → default **`both`** (👤🔑), preserving
   today's "this pauses for MFA" meaning; non-regressive for any missed chip.

`hitlTrigger` is retained (other code reads it). A chip may render a marker from
`challenge` even without `hitlTrigger` (the `*-a2a` consent chips).

### 2. Marker component — `demo_api_ui/src/components/agentChrome.js`

`HitlChipMark` takes a `challenge` prop and renders emoji span(s) instead of the
"MFA" SVG circle:

- `consent` → `👤`  (aria: "Requires human approval (consent)")
- `both` → `👤🔑`  (aria: "Requires consent and step-up (MFA)")
- `step_up` → `🔑`  (aria: "Requires step-up authentication (MFA)")

`toChips` carries `challenge` through. Call sites `AIAgent.js:7202`
(`action.hitlTrigger`) and `AIAgent.js:8607` (`chip.hitlTrigger`) pass
`challenge`; also render the mark when `challenge` is set (for `*-a2a` chips).

### 3. Allowlist docs — add 👤 and 🔑 to the three governance files.

### 4. Chip classification & coverage (all verticals)

Legend: **B** = both (👤🔑), **C** = consent (👤).

| Vertical | Both chip (👤🔑) | Consent chip (👤) | Action |
|---|---|---|---|
| banking | bk-hitl (create_transfer) | agentActions sensitive-account | tag both |
| government | gv5 (release_record) | gv-a2a (sensitive_tax_record) | tag both |
| investment | inv-hitl (large_trade) | **— none —** | tag inv-hitl; **add consent tool + chip** |
| healthcare | hc5 (release_records) | hc-a2a (sensitive_patient_records) | tag both (supersedes commit a6e54e9) |
| manufacturing | mf5 (release_work_order) | mf-a2a (sensitive_supplier_contract) | tag both |
| university | un5 (release_transcript) | un-a2a (sensitive_student_finance) | tag both |
| retail | **— none —** | rt4 (checkout) | tag rt4; **add both tool + chip** |
| workforce | wf4 (submit_expense) | wf5 (request_time_off) | tag both |
| sporting-goods | **— none —** | sg3 (extend_rental) | tag sg3; **add both tool + chip** |

Showcase chips (every vertical): `sec_mfa_otp`, `sec_mfa_fido` → `step_up` (🔑);
`sec_hitl` → `consent` (👤). Banking `agentActions.js`: transfer chips → `both`;
sensitive-account → `consent`.

The `*-a2a` consent chips (gv/mf/un) currently carry no `hitlTrigger`; they get
`challenge: "consent"` so they render 👤.

### 5. New tools (gap fill — user chose "add new tools")

Each needs: tool def + handler + `authz` in `tools.js`; `scope-topology.json`
entry (`challengeType`, `requiredScopes`, `surface`, `requiresAgentMediation`);
regenerated `mcp-tool-schemas.json` + `verticalTools.generated.ts`; mock/seed
data; a dashboard chip with `challenge` + `hitlTrigger`; and — for the two
step-up tools — regeneration of the P1AZ snapshot `RequiresMcpStepUp` condition
(generated from scope-topology, not hand-edited).

Proposed (names adjustable):

| Vertical | New tool | authz | challengeType | Chip |
|---|---|---|---|---|
| investment | `sensitive_holdings` — sensitive holdings incl. cost basis / tax lots | consent | consent | inv-a2a "Sensitive holdings" (👤) |
| retail | `cash_out_store_credit` — pay store-credit balance to an external account | stepUp+consent | step_up | rt-mfa "Cash out store credit" (👤🔑) |
| sporting-goods | `transfer_membership` — transfer membership to another person | stepUp+consent | step_up | sg-mfa "Transfer membership" (👤🔑) |

New tools follow the hardening pattern: `required: []`, defaults filled in the
handler, so chips don't stall (chipSchemaContract).

### 6. Supersedes earlier commit

Commit `a6e54e9c5` (added `hitlTrigger` + `🔐` label to `hc-a2a`) is replaced:
`hc-a2a` gets `challenge: "consent"`, label reverts to "Sensitive records".

### 7. Tests & gates

- Unit: `challenge → emoji` mapping in `HitlChipMark`; default (`hitlTrigger`,
  no `challenge`) → 👤🔑.
- `chipSchemaContract` green (new chips don't stall; `challenge` display-only).
- `verticalManifest/schema` allows `challenge` (add to chip schema if it
  enum-validates keys).
- `npm run topology:verify`, `verticals:check` green after new tools.
- Decision test(s) for the new step-up tools → STEP_UP; new consent tool →
  HITL_CONSENT.
- Update `HitlChipMark` snapshot + e2e screenshot expectations.

## Out of scope

- Any change to existing tools' authorization behavior. New tools only.
- Reworking `hitlTrigger` beyond adding `challenge`.

## Suggested phasing (for the plan)

1. **Display** — allowlist, marker component + plumbing, tag all existing chips.
   Demonstrates markers in the 7 already-covered verticals. No authz change.
2. **Gap tools** — add the 3 new tools (topology + seed + generated artifacts +
   chips + snapshot regen).
3. **Tests & gates** — unit, contract, topology, snapshot/e2e updates.
