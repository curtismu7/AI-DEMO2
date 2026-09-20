# Simple Stepper modal follow-up implementer report

Date: 2026-09-18

## Summary

Fixed the two final-review findings only.

1. `SimpleStepperPanel` now returns `null` whenever it is closed. This unmounts
   the real `DraggableModal`, so its established cleanup closes an active child
   window and removes the parent pop-out placeholder. The shared modal API and
   existing `closeOnPopout` behavior are unchanged.
2. `SimpleStepperPanel` is now a documented `dmScrollContract` full-bleed
   caller: `.sstp-body` owns the audit table's fill and scrolling behavior.

Follow-up test correction: the real shared pop-out button exposes its existing
`title`, not an accessible name. The tests now select that established title.
Their mocked child windows also emulate the browser capabilities the real modal
uses: document-write theme stamping and a foreign document `defaultView`.
Product source behavior was not changed in this follow-up.

Theming follow-up: paired `color: var(--th-text)` with the pop-out root,
hover, and footer tokenized grounds, and with the remaining shared close-button
hover violation needed to preserve the ground-without-ink baseline. The
`MAX_UNTHEMED` ratchet pin moved from 136 to its measured 135.

## Files changed

- `demo_api_ui/src/components/SimpleStepperPanel.js`
- `demo_api_ui/src/components/DraggableModal.css`
- `demo_api_ui/src/components/__tests__/DraggableModal.test.jsx`
- `demo_api_ui/src/components/__tests__/SimpleStepperModalLifecycle.test.jsx`
- `demo_api_ui/src/components/__tests__/dmScrollContract.test.js`
- `demo_api_ui/src/components/__tests__/themingRatchet.test.js`

## Regression coverage

`SimpleStepperModalLifecycle.test.jsx` uses the real `SimpleStepperBar` and
`DraggableModal`, mocking only the browser child window returned by
`window.open`. It verifies both the child title-bar Close action and the bar
Hide action close that child window and remove the parent placeholder.

The existing `dmScrollContract` generic offender assertion now covers the
declared Simple Stepper exception: removing the exception while retaining its
full-bleed body makes the contract test fail.

## Verification

- `git diff --check`: passed before staging.
- Static scroll-contract regression assertion: passed; it confirmed the
  documented full-bleed exception, `DraggableModal` caller, and `.sstp-body`
  scrolling root.
- `graphify update .`: completed. It reported three pre-existing syntax
  warnings in unrelated education panels.
- With `/opt/homebrew/opt/node@22/bin` first in `PATH`, the focused Vitest
  command passed: 5 files, 24 tests.
- With the same Node 22 path, `npm run build` passed.
- The theming-ratchet, modal, and Stepper focused command passed: 6 files,
  31 tests.
- The full UI suite completed under Node 22 with 581 passing files and four
  unrelated failing files (six tests): navigation catalog drift, AIAgent
  grounding correction, wrong audience, and wrong scope.
- The post-ratchet Node 22 `npm run build` passed.

## Commit

Implementation commit: `0ff1b11dea64d4c99a89c108d4d019f78cb22a38`

Test follow-up commit: `8ec67c32ca71f0dbccb167318ecbed939d3e1b3b`

Theming follow-up commit: `30c8f64db80b747f31b14f79c8df314817476b8b`

## Residual risks

- The required live embedded/pop-out light/dark computed-style audit and manual
  resize check were not part of this focused follow-up.
- The full UI suite retains the unrelated failures listed above; the theming
  ratchet and all Simple Stepper/modal coverage passed in the focused run.
