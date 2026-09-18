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

## Files changed

- `demo_api_ui/src/components/SimpleStepperPanel.js`
- `demo_api_ui/src/components/__tests__/SimpleStepperModalLifecycle.test.jsx`
- `demo_api_ui/src/components/__tests__/dmScrollContract.test.js`

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
- Focused Vitest command and `npm run build`: could not start because the host
  Node executable aborts with macOS `dyld` error for missing
  `/opt/homebrew/opt/simdutf/lib/libsimdutf.34.dylib`.

## Commit

Implementation commit: `0ff1b11dea64d4c99a89c108d4d019f78cb22a38`

## Residual risks

- Vitest and production-build execution remain unverified until the host Node
  dynamic-library issue is repaired.
- The required live embedded/pop-out light/dark computed-style audit and manual
  resize check could not be performed without a working Node/browser runtime.
