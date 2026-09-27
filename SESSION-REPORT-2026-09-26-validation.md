# Validation Addendum — 2026-09-26

This addendum records a fresh check of `SESSION-REPORT-2026-09-26.md` against
the current `main` checkout and local demo stack. The original report is a
historical snapshot and remains unchanged.

## Report open items

- §5.1: the PF scope-subset change is already merged in PR #337; the focused PF
  standard exchange suite passes 5/5.
- §5.2: the local BFF runtime provider is PingOne, matching
  `.demo-provider-intent.json`; `.env` and Compose have no provider override.
  The BFF was restarted after restoring PingOne so startup OAuth discovery
  matches that provider.
- §5.3: the UC40 demo handoff now opens the Command Dock before selecting Demo
  Steps, and the drawer stacks above the dock. The PF/ID-JAG Playwright spec
  passes 8/8.
- §5.4: the BFF code-drift health row is green.
- §5.5: OrbStack remained responsive through the browser and health-gate runs.
- Suggested §8.4 post-start automatic health-gate hook remains optional; the
  existing explicit gate is green.

## Fresh verification

- Local pre-demo health gate with auto-repair disabled: **36/36**.
- Real UC2 Airlines A2A browser probe: **1/1**, full evidence chain.
- A2A Jest suites: **293/293**; focused PF exchange suite: **5/5**.
- UC40 PF/ID-JAG Playwright spec: **8/8**.
- Focused UI guard and provider/reply tests: **20/20**.
- UI production build: passed.
- Final local runtime: `oauth_provider=pingone`, `active_vertical=banking`; the
  shared Docker stack serves the main checkout.

## UI suite follow-up

The four focused UI failures identified in this validation pass have been
addressed. The queued-question timeout test now checks that a pending question
is replayed through the BFF after the vertical readiness deadline. The theme
ratchet failures were fixed by tokenizing equivalent radii and elevation
shadows, adding theme ink to affected surfaces, and lowering the
ground-without-ink count and pin from 481 to 475. The focused tests pass. The
full UI unit run reported 678 passing files but did not exit or print a final
summary: one worker remained busy, so that run was stopped. This full-suite
runner behavior remains the only unresolved verification item.
