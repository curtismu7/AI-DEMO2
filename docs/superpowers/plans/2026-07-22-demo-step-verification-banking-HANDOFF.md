# Handoff — Demo Step Verification (Banking, Phase 1)

Read this first if picking this work up on a different machine or after a break.

## What this is

A test harness that runs every banking demo step (chip + free-text prompts, heuristic + LLM-only modes) and records a machine-written PASS/FAIL verdict against five checks: server error, parse error, LLM error, right response, right gate behavior (HITL/STEP_UP/DENY). Scoped to the banking vertical only — other verticals are a deliberate follow-on, not part of this work.

## Where things stand

| | |
|---|---|
| Design spec | `docs/superpowers/specs/2026-07-21-demo-step-verification-design.md` — **already merged to `main`** via PR #712 |
| Implementation plan | `docs/superpowers/plans/2026-07-22-demo-step-verification-banking.md` — 6 tasks, fully detailed (real code, no placeholders), committed on branch `feat/demo-step-verification-impl` |
| Pre-flight review | Done. Two conflicts found and resolved (both already committed to the plan): (1) Global Constraints now carves out Task 5's promptfoo config from the "never a literal" rule; (2) Task 2 shares `ACTION_TO_TOOL` via a new plain helper module (`demo_api_server/tests/helpers/actionToTool.js`) instead of duplicating it — caught mid-review that requiring a `*.test.js` file directly from another test file would double-register its `describe`/`test` blocks in Jest. |
| Execution | **Not started.** 0 of 6 tasks have been dispatched to an implementer subagent. Chosen approach: `superpowers:subagent-driven-development` (fresh implementer subagent per task + task review + final whole-branch review). |
| Branch | `feat/demo-step-verification-impl`, based on `origin/main` (which already has the merged spec). Two commits so far, both docs-only (the plan itself + the pre-flight fixes) — no implementation code exists yet. |

## How to resume on a new machine

```bash
git clone https://github.com/curtismu7/AI-DEMO2.git   # or cd into an existing clone
cd AI-DEMO2
git fetch origin
git checkout feat/demo-step-verification-impl          # or: git worktree add .claude/worktrees/<name> feat/demo-step-verification-impl
```

Per this repo's `CLAUDE.md`, do the implementation work in an isolated git worktree, not the main checkout.

Then tell Claude Code:

> Using subagent-driven-development, continue executing `docs/superpowers/plans/2026-07-22-demo-step-verification-banking.md`. Branch `feat/demo-step-verification-impl`. Check `git log --oneline` on this branch for which task commits already exist before dispatching anything — the plan's own commit-message steps name each task (e.g. "feat(step-verification): add ledger read/write module" = Task 1), so `git log` is the source of truth for progress, not this handoff doc's snapshot.

**Why not the progress ledger:** `subagent-driven-development` normally tracks progress in `.superpowers/sdd/progress.md`, but that file is git-ignored — it will not exist on a fresh clone/worktree. Resuming must reconstruct progress from `git log` on this branch (each task's plan text ends with its own `git commit -m "..."` step, so the commit messages are self-describing) rather than from that ledger.

## Things the next session should know

- **Worktree Jest gotcha**: any new test file's absolute path will contain `.claude/worktrees/<name>/...`, which `demo_api_server/jest.config.js`'s `testPathIgnorePatterns` silently excludes by default. Every Jest command in the plan already includes the fix: `--testPathIgnorePatterns='/node_modules/'` on the command line.
- **One pre-existing, unrelated test failure** in this repo: `useCases.primaryTool.test.js` → `chip dollar amounts are canonical threshold tiers`. Not caused by this work, not in scope to fix — the plan's Task 2 Step 1 explicitly calls this out so it isn't mistaken for a regression.
- **Not a CI gate**: nothing in this plan is meant to block `use-cases:check`/pre-push beyond the same drift-gate treatment `check-goldens.js` already gets (malformed/orphaned entries fail; missing/stale coverage only warns).
- Two project skills carry hard-won knowledge this plan builds on and should stay in sync with as bugs are found: `chip-correctness-testing` and `agent-demo-triage` (both under `.claude/skills/`). Task 2's design notes explain why `UC22`/`UC27` are recorded by reference to existing suites rather than re-tested.
