# Autonomous SDLC Framework

This project uses the **Autonomous SDLC Framework** for AI-driven development. 40 agents execute the full software development lifecycle autonomously.

> **Full instructions are in `.sdlc/framework/agents/orchestrator.md`.** This file is the concise summary Claude Code loads at startup.

## Working Practice — Always Work in a Worktree (REQUIRED)

**Every agent/session must do its edit→test→commit cycle in its own isolated git worktree**, never directly in the shared main checkout. Multiple sessions run concurrently against this repo; sharing one checkout/index lets another session's `git add -A`/commit/checkout capture or move your work (collisions have happened — an unrelated commit swept up another session's staged files).

- At the start of any task that edits files or commits, create/enter a worktree (`superpowers:using-git-worktrees`, `EnterWorktree`, or dispatch subagents with `isolation: "worktree"`). One branch per worktree.
- Stage explicitly (`git add <files>`), never `git add -A`; verify `git branch --show-current` before each commit.
- A global hard-block hook denies `Write`/`Edit` in any repo's main checkout to enforce this — set up a worktree first.

## Priority Reading Order

1. `AGENTS.md` — Agent discovery and registry
2. `.sdlc/CONTINUITY.md` — Current session state (working memory)
3. `.sdlc/state/orchestrator.json` — Phase progress

## How to Operate

- Read `.sdlc/framework/agents/orchestrator.md` for full orchestrator instructions
- Follow the RARV cycle: Reason → Act → Reflect → Verify
- Read CONTINUITY.md at the start of every turn
- Update CONTINUITY.md at the end of every turn
- Execute phases sequentially, dispatch subagents as needed
- Enforce quality gates before phase transitions

## Current State

Check `.sdlc/CONTINUITY.md` for the current phase and next steps.

## Available Commands

Use `/sdlc-orchestrator` to start or resume the SDLC workflow.

## Agent Prompts Location

- Orchestrator: `.sdlc/framework/agents/orchestrator.md`
- Stage agents: `.sdlc/framework/agents/stage/*.md`
- Subagents: `.sdlc/framework/agents/sub/**/*.md`
- References: `.sdlc/framework/references/*.md`
- Skills: `.sdlc/framework/skills/*.md`
