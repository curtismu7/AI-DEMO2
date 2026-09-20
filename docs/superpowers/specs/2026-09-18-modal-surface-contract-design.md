# Modal Surface Contract

## Goal

Make Simple Stepper a true browser-window pop-out with resizing and light/dark
theme support, while establishing a reusable rule for modal surfaces in the UI.

## Design

`DraggableModal` is the canonical modal primitive. It already owns in-page
dragging, eight-direction resizing, pop-out React roots, and close behavior.
Simple Stepper will use that primitive instead of maintaining a parallel
floating-panel implementation. The stepper table remains its own content and
status-row logic.

The shared pop-out shell will copy the current theme into the child window and
expose a theme toggle that changes only the pop-out window's `data-theme`
attribute. The parent page remains unchanged, and the child window closes
cleanly with the modal lifecycle.

## Modal rule

New modal surfaces must use `DraggableModal` or a shared primitive built on its
window/resize behavior. They must provide a real pop-out control, eight-way
resizing with minimum dimensions, and theme-token-based light/dark styling in
both the embedded and pop-out shells. Existing specialized surfaces are not
rewritten opportunistically; they are migrated when touched or when their
current behavior violates the hard UI contract.

## Success criteria

- Simple Stepper opens in a separate browser window through the shared modal
  pop-out control.
- The embedded and popped-out stepper can be resized and retain readable
  content in both themes.
- The pop-out has an accessible light/dark toggle without changing the parent
  page theme.
- Existing `DraggableModal` consumers retain their current close, resize, and
  pop-out behavior.
- The UI unit suite, focused modal tests, and production build are run.
