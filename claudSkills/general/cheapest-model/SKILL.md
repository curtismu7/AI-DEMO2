---
name: cheapest-model
description: >-
  Pick the cheapest model that can still do the job well. Use this skill BEFORE
  dispatching any subagent/Task, before choosing a `model:` for an Agent call,
  before routing a runtime LLM call, or whenever the user asks "which model
  should I use", "what's the cheapest model for this", "is this overkill for
  Opus", "can Haiku handle this", or wants to cut model/token cost. Also use it
  when you're about to default to a frontier model for work that may be
  mechanical. Triggers on: model selection, model routing, downgrading/upgrading
  a model, cost optimization for LLM calls, Haiku vs Sonnet vs Opus, and picking
  a tier for fan-out subagents.
---

# Cheapest Model

## Goal

Spend the least money that still gets a correct, high-quality result. The right
model is the **cheapest tier whose capability ceiling comfortably clears what
the task demands** — not the smartest model available, and not the cheapest
model you can rationalize.

Two failure modes cost money:
- **Over-provisioning**: running a frontier model on mechanical work. Pure waste.
- **Under-provisioning**: a cheap model fails, you re-run on a bigger one, and
  pay for both — plus the cost of noticing the failure. A botched cheap run is
  more expensive than going one tier up from the start.

So: bias cheap, but escalate the moment the task shows real judgment, ambiguity,
or stakes.

## The decision in one pass

Classify the task on these axes. Each "yes" pushes you up a tier.

1. **Specification** — Is the task fully specified with an unambiguous done
   state? (cheap) Or does it need interpretation, taste, or filling gaps? (up)
2. **Reasoning depth** — Single deterministic transform / lookup? (cheap) Or
   multi-step reasoning, planning, or holding several constraints at once? (up)
3. **Stakes** — Is a wrong answer cheap to catch and fix? (cheap) Or
   hard-to-reverse, security-/money-/data-touching, user-facing, or
   load-bearing for later work? (up) A task can be **easy yet high-stakes**:
   faithfully pulling terms out of a dense 200-page contract is low-difficulty
   work, but a missed clause is a *silent* failure that surfaces long after the
   cheap run looked fine. Easy does not mean cheap-tier when a subtle miss is
   expensive and hard to notice — stakes can outrank difficulty.
4. **Open-endedness** — One clear right answer? (cheap) Or design space with
   tradeoffs, architecture, or novel synthesis? (up)
5. **Context** — Small, self-contained? (cheap) Or large/sprawling context where
   missing one detail breaks it? (up — and check the model's context window).

If every axis is on the cheap side → **cheap tier**. One or two moderate axes →
**mid tier**. Any axis screaming judgment/stakes → **frontier tier**.

When genuinely torn between two tiers, pick by **escalation cost**: if a cheap
failure is obvious and cheap to retry (e.g. a script that won't run), start
cheap. If a failure is silent or expensive to detect (subtly wrong logic, a bad
architectural call), go up — paying once for the right answer beats paying twice
for the wrong one plus the cleanup.

## Tiers → concrete models

Map the chosen tier to a model. The tiers are model-agnostic; current Claude
mappings:

| Tier | Claude model | Use for |
|------|-------------|---------|
| Cheap | `haiku` (claude-haiku-4-5) | Mechanical edits, renames, formatting, boilerplate, simple extraction/classification, fully-specified single-step tasks, log scraping, mechanical test scaffolding from a clear spec. |
| Mid | `sonnet` (claude-sonnet-4-6) | Standard coding, bounded multi-file changes, debugging with a clear repro, writing tests, reviewing a small diff, summarizing, routine refactors. |
| Frontier | `opus` (claude-opus-4-8) | Ambiguous requirements, architecture, security analysis, subtle/multi-system debugging, complex planning, anything high-stakes or open-ended, judgment calls. |

For non-Claude providers, apply the same tiering to that family (e.g. a small /
mid / flagship trio) — the axes above are what matter, not the brand.

## Applying the choice

**Claude Code subagent / Agent tool** — pass the tier as the model:
```
Agent(subagent_type: "...", model: "haiku", prompt: "...")
```
Per the user's standing preference, mechanical or fully-specified subagent work
should default to `haiku`; reserve `sonnet`/`opus` for judgment work. When
fanning out many subagents, tier each one to its own task — a 10-agent fan-out
of mechanical edits should be 10× `haiku`, not 10× `opus`.

**App / runtime LLM calls (this repo)** — route through the self-hosted Manifest
router at `localhost:2099` `/auto`, which picks a model per call. Use this skill
to decide whether to *pin* a tier (cheap for a classifier, frontier for the main
reasoning agent) versus letting `/auto` decide. Don't hardcode the most
expensive model as a default.

## Output format

When asked which model to use, answer in one or two lines — recommendation
first, reason second. Don't write an essay.

**Example 1:**
Input: "Rename `getUser` to `fetchUser` across the repo and update call sites."
Output: **haiku** — fully specified, mechanical, single right answer, failures
are obvious (build breaks).

**Example 2:**
Input: "Figure out why transfers intermittently 401 and propose a fix."
Output: **opus** — ambiguous, multi-system debugging, silent-failure risk;
a wrong guess here costs more than the model does.

**Example 3:**
Input: "Write unit tests for this pure utility function with these 4 cases."
Output: **sonnet** (or **haiku** if the cases are spelled out exactly) — bounded
and specified, but some judgment on edge cases.

**Example 4:**
Input: "Summarize the key terms of this 200-page vendor contract — the
summarizing isn't hard."
Output: **sonnet** — low difficulty, but faithful extraction from a long, dense
legal doc is high-stakes with silent-failure risk; a missed liability cap costs
far more than the tier. Drop to **haiku** only if a human verifies each summary
against the source (e.g. at high volume), and check the doc fits the context
window either way.

## Anti-patterns

- Defaulting to the frontier model "to be safe" on mechanical work — that's the
  expensive habit this skill exists to break.
- Forcing a cheap model onto a judgment task to save pennies, then paying for the
  re-run and the cleanup.
- Picking a tier from task *topic* ("it's about security, use Opus") instead of
  task *demand* (reading one obvious log line about a security feature is still
  cheap-tier work).
- Treating an easy-but-dense task as automatically cheap-tier. "The summarizing
  isn't hard" is a trap when the input is long and adversarial (contracts, audit
  logs, legal/financial docs): the *extraction* is where a cheap model silently
  drops the one clause that mattered. Difficulty is low; stakes and
  silent-failure risk are not. Weigh every axis, not just difficulty.
- Ignoring the context window: even for genuinely cheap-tier work, a small model
  is the wrong choice if the task can't fit — chunk it or step up a tier.
