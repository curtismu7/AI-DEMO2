# Customer modal style unification

## Context

PR #966 (commit `670d6a66a`) flattened and shortened `TransactionConsentModal`'s
transaction-consent popup: flush header, single padded body wrapper, removed a
redundant "Transaction summary" heading, removed a nested bordered card,
dropped a redundant account-type word, and fixed an invisible white-on-white
"Learn: Human-in-the-loop" link.

A follow-up audit of the other 10 customer-facing modals found none share the
specific CSS that caused those bugs (each has its own scoped class prefix), but
they are visually inconsistent with each other and with the fixed reference:
five different "primary/confirm" button colors, three files carrying ~150+
lines of dead pre-`DraggableModal` CSS, one duplicate-heading bug
(`ComplianceModal`), and one double-padding bug (`MissingCredentialsModal`) —
the same two defect categories #966 just fixed elsewhere.

Goal: make all 11 customer-facing modals look like one professional, coherent
system, using the app's own already-established design tokens rather than
inventing new ones.

## Scope

**In scope (11 modals, all under `demo_api_ui/src/components/`):**
`TransactionConsentModal.tsx`, `FidoStepUpModal.js`, `OtpStepUpModal.js`,
`GatewayConsentModal.js`, `AgentConsentModal.js`, `LoginSuccessModal.jsx`,
`MissingCredentialsModal.jsx`, `ComplianceModal.js` (+ `ComplianceModalContent.js`),
`ErrorModal.js`, `ConfirmModal.js`, `CibaStepUpFlowPanel.jsx`.

**Out of scope:** admin/dev-tool modals (inspectors, PingOne MCP tooling, kill
switch, demo scripts, preflight, control-plane guides, `MFALogsModal`,
`TokenChainModal`, `ApiCallsModal`, etc.) — these serve the demo operator, not
the simulated customer, and were explicitly excluded.

## Foundation: reuse existing tokens, don't invent new ones

The app already has a button color system in `demo_api_ui/src/index.css`:

- `.btn-primary` — red gradient (`--app-primary-red-mid` #dc2626 → `--app-primary-red` #b91c1c), white text
- `.btn-secondary` — white background, red border/text (`--app-primary-red-border` #7f1d1d)
- `.btn-danger` — same red gradient as primary, darker border, for destructive actions

All 11 modals adopt these three classes for every button, replacing each
modal's bespoke color (LoginSuccessModal's teal, MissingCredentialsModal's
navy, ConfirmModal's ad-hoc inline blue, etc.). `DraggableModal` (the shared
shell in `DraggableModal.jsx`/`.css`) already renders a flush, edge-to-edge
titlebar and exposes an opt-in padded body class, `dm-scroll` — no changes
needed there.

**Spacing/typography (validated via mockup, "Compact" option chosen):**
- Body padding ~10-14px (vs `dm-scroll`'s existing 16/20 — compact tightens it further for these dense, single-purpose panels)
- Section labels: 10-11px, uppercase, letter-spacing 0.04em, `#9ca3af`
- Body/table text: 11-12px
- Row/field gap: 2-3px within a summary table, 8-10px between distinct sections
- Buttons: 12px text, 6px/12px padding, 6px border-radius

**Size tiers (width is the hard rule; height fits content):**
- **S — 380px wide:** quick yes/no or a single short prompt, no form fields. `ConfirmModal`, and (content permitting) `FidoStepUpModal`.
- **M — 380px wide:** one action plus a short summary/ledger. `TransactionConsentModal`, `GatewayConsentModal`, `AgentConsentModal`, `OtpStepUpModal`, `LoginSuccessModal`.
- **L — 460px wide:** multi-field form or a longer list/checklist. `MissingCredentialsModal`, `ComplianceModal`, `ErrorModal`, `CibaStepUpFlowPanel`.

Height is not pinned to a single number — real modals carry more copy than the
mockups used to validate the spacing feel (e.g. TransactionConsentModal's live
RFC 9396/8693 disclosure footnote). Each modal sizes to its own content; past
roughly 480px tall, content scrolls internally (`dm-scroll`'s own scrollbar)
rather than growing the panel further. This replaces today's scattered
one-off dimensions (344, 380×460, 420×600, 440×210, 460×344, 500×470-520,
520×440-480, 520×560, 560×480).

A single shared text-link class (promoted from TransactionConsentModal's
existing `.transaction-consent-learn-link`, which is already visually correct
— navy underlined text, no background) replaces every other modal's ad-hoc
"secondary link" treatment, including ErrorModal's current boxed grey
"Learn more" button.

**Icons:** no new emoji introduced. Existing per-modal SVG title-icons stay as
they are (this is a color/spacing/sizing pass, not an icon redesign).
`DraggableModal`'s own `🪟`/`✕` controls stay. `ErrorModal` keeps its `⚠️`
warning icon — already within the REGRESSION_PLAN §0 emoji allowlist.

## Phase 1 — TransactionConsentModal → DraggableModal (highest risk, own worktree/PR)

`TransactionConsentModal.tsx` currently bypasses `DraggableModal` entirely: it
calls `useDraggablePanel` directly and hand-builds its own shell (`drp-panel`,
`drp-header` with an inline-styled header, `drp-body`), which is itself a
violation of this repo's standing "always DraggableModal" rule. This phase
migrates it onto the real shared shell.

Two concrete changes ride along with the migration:
1. **Color-collision fix:** `--ghost` (the Cancel button) currently maps to
   the exact same red gradient as `--primary` (Agree & continue) — both
   `linear-gradient(135deg, #dc2626, #991b1b)`. Cancel becomes `.btn-secondary`
   (white/red-outline) so the two actions read as visually distinct.
2. Apply the Compact spacing/typography convention and confirm the M-tier
   width (380px) fits the existing content (ledger table, agreement checkbox,
   RFC disclosure footnote, OTP step).

**Test-compatibility constraint (hard requirement):** `hitl-transfer.spec.js`,
`hitl-transfer.real.spec.js`, and the shared `helpers/hitlMocks.js` all locate
this modal via `.transaction-consent-popup`, locate the transfer form via
`.transfer-form`/`.account-card`, and assert button role names ("Agree &
continue", "Confirm") plus the `123123` OTP placeholder. These selectors and
strings must keep working after the shell migration — either by keeping
`.transaction-consent-popup` as an additional class on the new `DraggableModal`
instance, or by updating the three test-side files in lockstep if that isn't
practical. Exact mechanism is an implementation decision for the plan, not
pinned here.

**Verification:** `cd demo_api_ui && npm run test:unit && npm run build`, plus
a manual run of both `hitl-transfer.spec.js` and `hitl-transfer.real.spec.js`
(the latter needs real PingOne E2E env vars — skip if unavailable, but at
minimum the mocked spec must pass).

## Phase 2 — bulk rollout to the other 10 modals

For each of `FidoStepUpModal`, `OtpStepUpModal`, `GatewayConsentModal`,
`AgentConsentModal`, `LoginSuccessModal`, `MissingCredentialsModal`,
`ComplianceModal` (+ `ComplianceModalContent.js`), `ErrorModal`, `ConfirmModal`,
`CibaStepUpFlowPanel`:

- Replace bespoke button colors with `.btn-primary` / `.btn-secondary` /
  `.btn-danger`. `ConfirmModal`'s inline `background: danger ? '#dc2626' :
  '#2563eb'` becomes real classes (this also fixes a latent bug: the inline
  style has no `:hover` rule, so the primary/danger action currently has zero
  hover feedback).
- Snap to the nearest width tier (380 or 460) per the table above; let height
  fit content with `dm-scroll` handling overflow.
- Apply the Compact spacing/typography convention.
- Route any secondary "Learn more"/link-style action through the shared
  `.modal-text-link` class from Phase 1.

**Two concrete bug fixes bundled into this phase:**
- **ComplianceModal** renders its title twice — `ComplianceModalContent.js`
  draws its own `.compliance-modal__header` `<h3>` reading "MCP Compliance
  Checklist" directly under `DraggableModal`'s real titlebar showing the same
  text. Delete the duplicate; keep the one real titlebar.
- **MissingCredentialsModal** double-pads its form — `dm-scroll`'s padding
  stacks with the form's own `.mcm-body` padding, visibly misaligning the
  intro/guidance text (which only sits under one padding layer) against the
  form fields (which sit under both). Collapse to one padding layer.

**Dead CSS purge**, ~150+ lines each in `MissingCredentialsModal.css`,
`ComplianceModal`'s stylesheet, and `ErrorModal`'s stylesheet — leftover
pre-`DraggableModal` shell classes (`.mcm-overlay/.mcm-header/.mcm-footer`,
`.compliance-modal__header/__drag-header/__close-icon/__popout-icon/8×
__resize-handle/__close-btn`, `.modal-overlay/.error-modal__header/icon/
title/close/body/footer`) nothing in the current JSX references.

**Caution:** `ComplianceModalPopout.js` is a *second*, independent,
non-`DraggableModal` implementation (a `window.open`-based popout) that still
legitimately uses some of the same-looking class names (`.compliance-modal`,
`.compliance-modal__modal-title`). Audit class-by-class before deleting
anything from the Compliance modal's CSS — don't break the popout path while
purging the dead-in-*this*-component classes.

**Verification per file (or per small batch of files):**
`cd demo_api_ui && npm run test:unit && npm run build`. Check each modal's
existing unit test (where one exists) still passes — several assert on class
names or button text that will change; update assertions to match the new
classes/text rather than loosening them.

## Non-goals

- Not migrating admin/dev-tool modals (explicitly out of scope).
- Not introducing a new shared React component (e.g. a `<ModalActionFooter>`)
  — this pass is CSS/class-level consistency using existing tokens, not a new
  abstraction. (Rejected as Approach B during design — revisit only if future
  modals keep drifting despite this pass.)
- Not touching spacing/sizing of anything outside these 11 files.
- No new emoji or icon system.
