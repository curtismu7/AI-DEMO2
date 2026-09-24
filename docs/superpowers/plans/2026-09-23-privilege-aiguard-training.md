# Privilege AIGuard Training Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Connect the Privilege AIGuard deck to a practical presenter guide and a short orientation in the existing Attack Lab.

**Architecture:** Add a manual Markdown trainer guide with slide-to-demo mapping and precise enforcement attribution. Add a concise expandable orientation to the existing Attack Lab, backed by a focused test; do not change gateway behavior or policy.

**Tech Stack:** Markdown, React 19, CSS theme tokens, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-23-privilege-agent-attack-scenarios-design.md`

## Global Constraints

- Preserve the Attack Lab's observed-result attribution; do not label local validation or authorization checks as AIGuard decisions.
- Preserve existing routes, default tabs, auth/session behavior, and attack execution paths.
- UI changes use theme tokens, the emoji allowlist, and narrative text at least 12pt equivalent (repo CSS font scale).
- Run focused UI tests and `cd demo_api_ui && npm run build`.

---

### Task 1: Add presenter guide

**Files:**
- Create: `docs/privilege-aiguard-training.md`
- Modify: `docs/privilege-llm-protection.md` (Related links only)

**Steps:**

- [x] Write a short presenter flow using deck slides 1, 5, 6, and 7 as the core; list slides 2–4 and 8 as technical reference.
- [x] Map all five Attack Lab scenarios to the real path and enforcement point, including local schema validation and no-verdict outcomes.
- [x] Mark thresholds, defaults, model metrics, and tenant outcomes as claims to recheck before presenting.
- [x] Link the guide from the existing Privilege LLM protection documentation.

### Task 2: Orient presenters in Attack Lab

**Files:**
- Modify: `demo_api_ui/src/pages/AttackLabTab.jsx`
- Modify: `demo_api_ui/src/pages/AttackLabTab.css`
- Modify: `demo_api_ui/src/pages/__tests__/AttackLabTab.test.jsx`

**Steps:**

- [x] Add a focused test that the Attack Lab explains how to run a scenario and attribute the observed result.
- [x] Add a semantic expandable orientation with the five scenario paths and the rule to describe only observed enforcement.
- [x] Style the orientation with existing theme tokens and visible keyboard focus.
- [x] Run the focused Vitest file and the UI production build.
- [x] Run the existing theme contrast audit for the page in both themes, if the audit can be driven locally.

### Task 3: Review the final changes

**Files:**
- Review only the files above.

**Steps:**

- [x] Check `git diff --check` and confirm only requested files changed.
- [x] Confirm the presenter guide does not state mutable tenant settings or measured numbers as current guarantees.

## Execution results

- Focused Attack Lab test: 10/10 passed.
- Production build: passed; Vite reported the existing missing local mkcert warning and a large-chunk advisory.
- Computed-color contrast audit: no failures among 10 checked elements in light or dark theme.
- Full UI suite: 5,045 passed, 24 skipped, 10 failed across 6 unrelated suites; failures include network-dependent requests in the isolated worktree and existing ratchet/assertion mismatches. The touched AttackLabTab suite passed.
- `git diff --check`: passed.
