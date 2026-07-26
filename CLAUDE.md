# Banking Demo — PingOne Edition

Standalone AI-powered banking demo: PingOne auth, RFC 8693 token exchange, BFF/UI,
MCP servers, AI agents, authz/gateway, provisioning and tests. This file is the
canonical agent instruction set; `AGENTS.md` redirects here.

## Agent behavior (read first)

Shape **how** you think. Specific stack rules below shape **what** you cannot break.

1. **Don't assume. Don't hide confusion. Surface tradeoffs.**
   State assumptions. If multiple approaches exist, present them — do not pick
   silently. If something is unclear, stop and ask. Push back when a simpler
   path exists.

2. **Write the minimum that solves the problem. Nothing speculative.**
   No features, abstractions, config knobs, or error handling beyond what was
   asked. If a senior engineer would call it overcomplicated for the request,
   simplify.

3. **Touch only what you must. Clean up only your own mess.**
   Every changed line should trace to the request. No "while I'm here" cleanup,
   drive-by refactors, or reformatting of adjacent code. Remove orphans **your**
   change created (unused imports you added); leave pre-existing dead code alone
   unless asked.

4. **Define success criteria. Loop until verified.**
   Turn vague goals into checks you can run (tests, build, a concrete assertion).
   For multi-step work, state a short plan with a verify step per item, then
   loop until green. Do not declare done without evidence.

Litmus for new rules in this file: would removing the line cause a mistake the
agent could not recover from by reading the repo? If not, leave it out.

## Do-not-break contract

**[REGRESSION_PLAN.md](REGRESSION_PLAN.md)** is the source of truth for what must
not break. Read `§0` (hard UI/style) and `§1` (protected areas) before changing
auth, token exchange, the BFF session layer, or UI surfaces. Invoke
`.claude/skills/regression-guard/` before touching a protected area. If the
skill disagrees with that file, the file wins.

Hard rule from `§0` that always applies here:

- **Emoji allowlist only:** `⚠️` `✅` `❌` `🔐` `✕` `✓` `👤` `🔑` `🪟` `📚`.
  Everything else: plain text, CSS, or semantic HTML.

## Working practice — worktree (required)

Edit→test→commit only in an **isolated git worktree**, never the shared main
checkout. Concurrent sessions share one index; collisions have wiped staged work.

- Create/enter a worktree before edits (`superpowers:using-git-worktrees`,
  `EnterWorktree`, or subagents with `isolation: "worktree"`). One branch per
  worktree.
- Stage explicitly (`git add <files>`), never `git add -A`. Verify
  `git branch --show-current` before each commit.
- A hard-block hook denies `Write`/`Edit` in the main checkout — set up a
  worktree first.

## Project

| | |
|---|---|
| Run | `./run.sh` (native); `./run-docker.sh` (Compose, lean core by default); `./run-k8.sh` |
| SE AWS | `./run-pingaws.sh` — Ping SE cluster only (`ai-demo.ping-devops.com`); wraps `./run-k8.sh se-*` + `se-update-{code,config,pingone}.sh` |
| API / UI | API `https://api.ping.demo:3001` / UI `https://local.ping-devops.com:4000` (hosts + `mkcert -install` once) |
| Test | `./run-tests.sh unit` (fastest); `./run-tests.sh [api\|e2e\|all]`; `npm test` |
| Hygiene | `npm run topology:verify`, `npm run hygiene:check` |
| LLM proxy | `:8090` via `demo_llm_proxy/` (`LLM_BACKEND=llamacpp` default; `omlx` on Apple Silicon) |

PingOne lifecycle (`setup:fresh`, `pingone:bootstrap`, import/export/reset) mutates
a live environment — read the script before running. Prefer hosted PingOne MCP
tools for app/population/user reads during development.

## Stack

Node >= 22 everywhere. **Read the nested `CLAUDE.md` for the directory you are
editing** — it carries that service's versions, layout and hard rules.

- `demo_api_server/` — CommonJS, Express 4.18, jest 29.7 + supertest, LMDB, Redis session
- `demo_api_ui/` — React 19.2, Vite 8, **vitest** (not jest), Playwright, plain JSX
- `langchain_agent/`, `openai_agent/`, `pydantic_agent/` — Python + pytest;
  `mastra_agent/` is Node

## Watch out

- Auth / token / session / UI: treat as protected; state what you will **not**
  break before editing.
- **Sign-in only works on `local.ping-devops.com:4000`** — passkeys need an
  rp.id matching the serving host, so `PUBLIC_APP_URL` and the OAuth callback
  point there. `api.ping.demo:4000` still serves the app (allowed by
  `CORS_ORIGIN`) but the session cookie is on the other host, so the dashboard
  renders "Please sign in to use the Agent". Point `E2E_BASE_URL` at the same
  host or every `*.real.spec.js` 401s in a way that looks like broken auth.
- Do not invent conventions (error shapes, date handling, import paths) — match
  the nearest existing module.
- After code edits, run `graphify update .` (AST-only). For codebase questions,
  prefer `graphify query|path|explain` when `graphify-out/graph.json` exists;
  use `graphify-out/wiki/index.md` for broad navigation when present.

## Knowledge bundles

Authored, citable facts live in `graphify-out/*.kb.json` (tracked; the loader
serves them via `knowledgeLoaderService`). Two bundles: `repo-topology`
(service boundaries, token exchange, scope topology, the feature-flag
three-point wiring, compose profiles, MCP tools) and `banking-domain` (balance
definitions, transfer limits, fraud holds the demo agent enforces). Consult the
relevant bundle before grepping to rediscover a documented fact; if you verify a
new durable fact, add an assertion (`id`, `claim`, `source`, `confidence`)
validated against `schemas/knowledge-bundle.schema.json`. `banking-domain`
grounds the demo agent when the **Knowledge Grounding** flag
(`ff_knowledge_grounding`) is ON — this is the demo's citable-facts feature, not
Google's Open Knowledge Format.

## Before claiming done

1. Run the checks for what you touched, and paste the result line:
   - server → `cd demo_api_server && CI=true npm test -- --forceExit`
   - UI → `cd demo_api_ui && npm run test:unit && npm run build`
   - cross-service config → `npm run topology:verify`
2. State ✅ or ❌ for each — no bare "done":
   - tests / build green (evidence, not assertion)
   - every changed line traces to the request
   - staged explicitly on a worktree branch (`git branch --show-current`)
   - emoji allowlist respected in any rendered string

## Repo map (high level)

- `demo_api_server/` — BFF / API + provisioning (main test surface) · own `CLAUDE.md`
- `demo_api_ui/` — React UI (Vite) · own `CLAUDE.md`
- `demo_mcp_server/`, `demo_mcp_gateway/`, `demo_mcp_proxy/`
- `demo_authz_server/`, `demo_hitl_service/`, `ping-gateway/`
- `langchain_agent/`, `openai_agent/`, `pydantic_agent/`, `mastra_agent/`
- `demo_llm_proxy/`, `scripts/`, `docs/`, `planning/`

## AI-DLC (opt-in only)

Activate **only** when the user prefixes with `Using AI-DLC,`. Then follow
[`.aidlc/CORE-WORKFLOW.md`](.aidlc/CORE-WORKFLOW.md). Without that phrase, skip
AI-DLC ceremony. `REGRESSION_PLAN` §0–§1, worktrees, and the emoji allowlist
always win. Construction still requires a worktree. Do not run AI-DLC and
GSD/plan-phase on the same feature in parallel. Resume:
`Continue AI-DLC. Check aidlc-docs/aidlc-state.md for current status.`
