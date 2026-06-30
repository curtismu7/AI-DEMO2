---
name: agent-tool
description: 'Discipline and patterns for using the Agent tool in Claude Code. Read this skill BEFORE spawning any subagent — it covers when to use agents vs inline work, how to write self-contained prompts that agents can execute without context from this conversation, model selection (haiku for mechanical tasks saves cost with no quality loss), foreground vs background, parallel batching up to 5–6 agents per turn, and the hard-won pitfalls around the Edit tool inside agents (file-not-read errors, hook reverts, replace_all). Invoke whenever: you are about to call Agent, you are deciding whether to delegate something, you are writing a prompt for a subagent, you are running a batch of parallel file edits, or an agent just produced an unexpected result.'
---

# Using the Agent Tool

## When to Use

- Before spawning any subagent — read this skill first
- When deciding whether to delegate work vs doing it inline
- When writing a prompt for a subagent (self-contained prompt requirements)
- When running a batch of parallel agents across multiple files
- When an agent just produced an unexpected result — diagnose from the pitfalls section
- When choosing model, foreground/background, or batch size

## When NOT to Use

- For tasks you'll handle entirely inline — this skill only applies to work you're delegating
- For understanding which non-agent tool to reach for (Bash vs grep vs Read vs Edit)
- For workflow orchestration via the Workflow tool — that has its own separate guidance

## The Core Question: Agent or Inline?

Spawn an agent when the work is **independently scoped** and would either (a) take many tool calls that would clutter the main context, or (b) can run in parallel with other work.

Work inline when the task is 1–3 tool calls, you need the result immediately to decide what to do next, or the task is tightly coupled to what you already have in context.

A useful test: could you brief a colleague who just walked into the room with a single paragraph? If yes, use an agent. If the briefing would take half the conversation to reconstruct, do it yourself.

## Writing Prompts That Agents Can Execute

Agents have **zero context from the current conversation**. They don't know what you tried, what you found, what the user said earlier, or what the codebase looks like. Every agent prompt must be self-contained.

**Include:**
- What you're trying to accomplish and *why*
- What you've already ruled out or tried
- Specific file paths, line numbers, symbols, or patterns to target
- What the result should look like (format, where to save it, what to return)
- Any constraints that aren't obvious from the code (emoji rules, module system, token custody rule, etc.)

**Omit:**
- "Based on what we discussed…" — the agent has no memory of this
- Open-ended goals without scope ("clean up the codebase") — bound the task precisely
- Anything the agent should figure out from context — give enough that it can make judgment calls

If your prompt would confuse a smart colleague who just walked in cold, rewrite it.

## Model Selection

Pick the model to match the cognitive load, not the importance of the task:

| Task | Model |
|------|-------|
| Mechanical, fully-specified: rename, replace, reformat | `haiku` |
| Research, broad exploration, reading unfamiliar code | default (inherit from session) |
| Judgment-heavy: architecture, debugging ambiguous bugs | default or `opus` |

Set `model: "haiku"` explicitly when the right answer is already known and the agent is just executing — it's meaningfully faster and cheaper, and the quality is identical for mechanical work.

## Foreground vs Background

**Foreground** (default): blocks the main thread until the agent completes. Use when you need the result before your next step.

**Background** (`run_in_background: true`): returns immediately; you get a notification on completion. Use when spawning a batch of parallel agents — start them all in one message, then continue with other work or start the next batch.

Don't background agents when you immediately need to act on their results — that just adds a wait with a notification in the middle.

## Parallel Batching

When applying the same operation to N independent items, spawn all agents in a single message as parallel tool calls. The batch finishes in wall-clock time of the slowest one — not the sum.

Practical ceiling: 5–6 agents per batch is manageable. More than that can overwhelm concurrency and file-system contention. Group N items into batches of ~5, fire each batch together, wait for all to complete before the next batch.

Each agent in a batch must be fully self-contained — include in its prompt which specific items it's responsible for. Don't rely on shared state between parallel agents.

## Agent Types (Claude Code)

Match the agent type to the task:

| `subagent_type` | Use for |
|----------------|---------|
| `Explore` | Fast read-only search: "where is X defined?", "which files reference Y?" Specify breadth: `"quick"`, `"medium"`, `"very thorough"` |
| `Plan` | Architecture and implementation planning before writing code |
| `dead-code` | Find unused code, unreachable functions, orphaned files |
| `coverage-checker` | Analyze test coverage and find untested code |
| `error-analyzer` | Analyze error logs and identify patterns |
| `code-simplifier` | Simplify/refactor code after changes — preserves functionality |
| default | Everything else |

`Explore` is the best choice for location queries — it stays read-only and skips analysis, so it's faster and cheaper than the generic agent for "find where X is."

## Worktree Isolation

Add `isolation: "worktree"` when multiple parallel agents will **write to the same repository** and could conflict. Each agent gets a fresh git worktree. Cost: ~200–500ms setup + disk per agent. Only add this overhead when agents genuinely mutate files in parallel — read-only agents don't need it.

## The Edit Tool Inside Agents

Several failure modes come up repeatedly when agents use the Edit tool:

**"File has not been read yet"** — Every agent that will Edit a file must Read it first in the same agent session. This is easy to forget in the prompt. If an agent might edit a file, explicitly tell it to read it first: "Read X before editing it."

**"File content has changed since last read"** — If a linter/hook modifies the file between the agent's Read and Edit calls, the Edit fails. Tell agents: "If Edit fails with 'file content has changed', re-read the file and retry immediately."

**System reminders about linter changes are unreliable** — When a hook modifies a file, a system reminder may say the change was "intentional" — this does not mean the agent's edit was reverted. Use `grep` on disk as the ground truth, not the system reminder.

**Hook-protected files** — Some repos have hooks that revert edits to specific files. If an agent's changes keep disappearing, the file may be protected. Don't instruct agents to loop on a file that reverts — investigate the hook first.

**Global replacements** — When renaming a string across an entire file, `replace_all: true` on Edit is more reliable than targeting each occurrence individually. For stale references across many files, one `replace_all` call beats five separate string edits.

## Common Failure Patterns to Avoid

- **Under-specified prompts**: "fix the skills" without naming which files, what's broken, and what fixed looks like. Agents produce vague or wrong output and you have to re-run.
- **Assuming shared context**: writing "as we discussed…" in an agent prompt. The agent has never seen this conversation.
- **Serializing parallel work**: spawning one agent, waiting for it, spawning the next. If the items are independent, batch them.
- **Using sonnet/opus for bulk mechanical work**: adds cost and latency without quality gain when the task is fully specified.
- **Not scoping reads**: telling an agent to "look at the codebase" instead of naming the specific directories or files. Wastes tokens on irrelevant exploration.
