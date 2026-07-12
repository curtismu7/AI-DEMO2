# Chip challenge markers — consent vs step-up (MFA)

**Date:** 2026-07-11
**Status:** design (awaiting review)
**Branch:** `worktree-tag-sensitive-chip-hitl`

## Problem

Agent suggestion chips that pause for a human-in-the-loop control show a single
generic "MFA" circle badge (`HitlChipMark`, driven by the boolean
`hitlTrigger`). It cannot distinguish the two controls the demo actually
exercises:

- **HITL consent** — a human approves the agent's action (approval receipt).
- **Step-up / MFA** — the user must complete stronger auth (OTP / passkey).

Some tools require **both**. Today every paused chip reads "MFA", which
mislabels consent-only chips and hides the "both" case. Observed live: the
"Sensitive records" chip triggers a consent gate but carried no badge at all,
while "Release my records" advertised MFA generically.

## Goal

Give each paused chip a marker that reflects its actual control:

- consent → 👤
- step-up / MFA → 🔑
- both → 👤🔑

Applied across **all verticals** in one pass.

## Constraints

- **Emoji allowlist (REGRESSION_PLAN §0).** Only `⚠️ ✅ ❌ 🔐 ✕ ✓` are permitted
  in code/UI. This change **expands** the allowlist to add `👤` (HITL consent)
  and `🔑` (step-up / MFA), per explicit owner approval. The allowlist lives in
  three places, all to be updated: `REGRESSION_PLAN.md` §0 (source of truth),
  `CLAUDE.md` §0, `.cursor/rules/emoji-allowlist.mdc`.
- **Minimal diff** (§0): touch only the chip marker path and the chip data.
- **No regression:** every chip that shows a badge today must still show one.
- **Worktree-only edits**; explicit staging.

## Design

### 1. Data model — per-chip `challenge`

Add an optional field to each paused chip:

```
"challenge": "consent" | "step_up" | "both"
```

Per-chip (not tool-derived) because showcase chips deliberately demonstrate a
*specific* control on a tool that may support several (e.g. `sec_mfa_otp` and
`sec_hitl` both call `release_records`, but demo MFA vs consent respectively).

`hitlTrigger: true` is retained as the "this chip pauses" signal (it gates
whether the marker renders and is read elsewhere). Render precedence:

1. `challenge` present → render its marker.
2. `hitlTrigger` true, no `challenge` → default **`step_up`** (🔑) — preserves
   today's "MFA" meaning, so any chip missed in tagging is non-regressive.

### 2. Marker component — `demo_api_ui/src/components/agentChrome.js`

`HitlChipMark` gains a `challenge` prop and renders emoji span(s) instead of the
"MFA" SVG circle:

- `consent` → `👤` (title/aria: "Requires human approval (consent)")
- `step_up` → `🔑` (title/aria: "Requires step-up authentication (MFA)")
- `both` → `👤🔑` (title/aria: "Requires consent and step-up (MFA)")

`toChips` carries `challenge` through alongside `hitlTrigger`. Call sites
`AIAgent.js:7202` (`action.hitlTrigger`) and `AIAgent.js:8607`
(`chip.hitlTrigger`) pass `challenge` to the component.

### 3. Allowlist docs

Add `👤` and `🔑` with their meanings to the three governance files above.

### 4. Chip classification (all verticals)

Primary chips — from the tool's `authz` flags / gating:

| Vertical | Chip | Tool | challenge |
|---|---|---|---|
| banking | bk-hitl | create_transfer (amount-gated) | both |
| government | gv5 | release_record | both |
| investment | inv-hitl | large_trade | both |
| healthcare | hc5 | release_records | both |
| healthcare | hc-a2a | sensitive_patient_records | consent |
| manufacturing | mf5 | release_work_order | both |
| university | un5 | release_transcript | both |
| retail | rt4 | checkout | consent |
| workforce | wf4 | submit_expense | both |
| workforce | wf5 | request_time_off | consent |
| sporting-goods | sg3 | extend_rental | consent |

Showcase chips — from the `showcase` field, in **every** vertical:

| Chip | showcase | challenge |
|---|---|---|
| sec_mfa_otp | mfa_otp | step_up |
| sec_mfa_fido | mfa_fido | step_up |
| sec_hitl | hitl_consent | consent |

Banking `agentActions.js` chips (hardcoded `hitlTrigger`): transfer → both;
sensitive-account → consent.

### 5. Supersedes earlier commit

Commit `a6e54e9c5` (added `hitlTrigger` + `🔐` label prefix to `hc-a2a`) is
replaced: `hc-a2a` gets `challenge: "consent"` and its label reverts to
"Sensitive records" (the marker now carries the meaning; drop the label 🔐).

### 6. Tests

- Unit: `challenge → emoji` mapping in `HitlChipMark`; default (`hitlTrigger`,
  no `challenge`) → 🔑.
- `chipSchemaContract` / manifest schema stay green (`challenge` is display-only,
  no effect on params). Confirm `challenge` is an allowed manifest field in
  `verticalManifest/schema` (add to the chip schema if it enum-validates keys).
- Update any `HitlChipMark` snapshot and e2e screenshot expectations that assert
  the old "MFA" circle.

## Out of scope

- Changing any authorization behavior or gate. Display-only.
- Reworking `hitlTrigger` semantics beyond adding `challenge`.
