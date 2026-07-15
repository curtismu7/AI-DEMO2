# Banking Demo — PingOne Edition

Standalone AI-powered banking demo using PingOne for authentication and RFC 8693
Token Exchange, so an AI agent can access banking data on behalf of a user. The
repo is a set of cooperating services (BFF/API, UI, MCP servers, AI agents, an
authorization gateway) plus provisioning and test tooling.

This file is the canonical instruction set for AI agents. `AGENTS.md` redirects
here.

## Do-not-break contract — read before editing protected areas

**[REGRESSION_PLAN.md](REGRESSION_PLAN.md) is the source of truth for what must
not break.** Read `§0` (hard UI/style rules) and `§1` (protected areas) before
changing auth flows, token exchange, the BFF session layer, or UI surfaces. The
`regression-guard` skill (`.claude/skills/regression-guard/`) applies it while
you edit — invoke it before touching a protected area. That file is the source
of truth; if the skill disagrees with it, the file wins.

Two rules from `§0` that apply to everything you write here:

- **Emoji rule:** the only emojis allowed in skills, commands, code, and UI text
  are `⚠️` `✅` `❌` `🔐` `✕` (close) `✓` (check) `👤` `🔑` (chip challenge
  markers) `🪟` (pop out to new window). Everything else is plain text or
  CSS/semantic icons.
- **Minimal diff:** name the component, name the element, change only that. No
  "while I'm here" cleanup of adjacent code.

## Working Practice — Always Work in a Worktree (REQUIRED)

**Every agent/session must do its edit→test→commit cycle in its own isolated git
worktree**, never directly in the shared main checkout. Multiple sessions run
concurrently against this repo; sharing one checkout/index lets another
session's `git add -A`/commit/checkout capture or move your work (collisions have
happened — an unrelated commit swept up another session's staged files).

- At the start of any task that edits files or commits, create/enter a worktree
  (`superpowers:using-git-worktrees`, `EnterWorktree`, or dispatch subagents with
  `isolation: "worktree"`). One branch per worktree.
- Stage explicitly (`git add <files>`), never `git add -A`; verify
  `git branch --show-current` before each commit.
- A global hard-block hook denies `Write`/`Edit` in any repo's main checkout to
  enforce this — set up a worktree first.

## AI-DLC (opt-in)

AWS AI-DLC phase gates live as a **sidecar** — they do **not** replace this
file. See [`.aidlc/README.md`](.aidlc/README.md).

- **Activate** only when the user prefixes with `Using AI-DLC,`. Then follow
  [`.aidlc/CORE-WORKFLOW.md`](.aidlc/CORE-WORKFLOW.md) and load details from
  [`.aidlc-rule-details/`](.aidlc-rule-details/). Write stage artifacts under
  `aidlc-docs/` and wait for explicit human approval between stages.
- **Without** that phrase: do not run AI-DLC ceremony; use normal
  CLAUDE.md / REGRESSION_PLAN behavior.
- **Priority:** `REGRESSION_PLAN.md` §0–§1, worktrees, and the emoji allowlist
  always win over AI-DLC (including any upstream “overrides all workflows”
  wording in `CORE-WORKFLOW.md`).
- **Construction** code changes still require a git worktree. Prefer AI-DLC for
  multi-file / new-vertical features; skip it for one-line fixes and hygiene.
- **Resume:** `Continue AI-DLC. Check aidlc-docs/aidlc-state.md for current status.`
- Do not use AI-DLC and GSD/plan-phase ceremony on the same feature in parallel.

## Running the stack

- `./run.sh` — primary local launcher (native Node/Python). API at
  `https://api.ping.demo:3001`, UI at `:4000`, MCP server at `localhost:8080`,
  LangChain agent at `8887/8889/8881`. One-time setup: add `api.ping.demo` to
  `/etc/hosts` and run `mkcert -install`.
- `./run-docker.sh` — Docker Compose launcher. **Default: lean core stack** (real
  PingOne Authorize + PingGateway; demo authz/gateway off). `./run-docker.sh
  {start full|demo-sync|optional start|stop|restart|build|logs|status} [svc...]`;
  `PROD_MODE=1` uses the nginx build instead. See README **Option 2** for memory
  profiles and Quick Flag → container sync.
- `./run-k8.sh` — Kubernetes / OrbStack / EKS variants (see `README.md`).
- `./run-pingaws.sh` — Ping SE AWS cluster only (`ai-demo.ping-devops.com`).
  Wraps `./run-k8.sh se-*` plus `se-update-{code,config,pingone}.sh`.

**Local LLM backends** (`LLAMACPP_BASE_URL`, default `http://localhost:8090`):

- **llama.cpp** (default) — GGUF tiers on `:8091`/`:8096`, routed by `demo_llm_proxy/`.
  Used by Docker, K8s, and CI. Set `LLM_BACKEND=llamacpp` or omit.
- **oMLX** (Mac fast path) — `LLM_BACKEND=omlx` on Apple Silicon for agent chip /
  tool-loop dev. See `demo_llm_proxy/README.md`.

## Tests

- `./run-tests.sh [unit|api|e2e|all]` — quick entry point; `unit` is the fastest
  regression suite.
- `npm test` — full suite (`scripts/run-all-tests.sh`). Per-service targets exist
  as `npm run test:<service>` (e.g. `test:api-server`, `test:ui`, `test:agent`,
  `test:mcp-server`); see `package.json` for the full list.
- Topology/hygiene gates: `npm run topology:verify`, `npm run hygiene:check`.

## Provisioning (PingOne)

Bootstrap and lifecycle scripts run via npm: `npm run setup:fresh`,
`pingone:bootstrap`, `pingone:refresh-envs`, `import`/`export`, `reset`,
`uninstall`. These mutate a live PingOne environment — read the script before
running. Prefer the hosted PingOne MCP tools for app/population/user reads and
env updates during development.

## Repo layout (high level)

- `demo_api_server/` — BFF / API + provisioning scripts (main test surface)
- `demo_api_ui/` — React UI (Vite)
- `demo_mcp_server/`, `demo_mcp_gateway/`, `demo_mcp_proxy/` — MCP servers/gateway
- `demo_authz_server/`, `demo_hitl_service/`, `ping-gateway/` — authz / HITL / gateway
- `langchain_agent/`, `openai_agent/`, `pydantic_agent/`, `mastra_agent/` — AI agents
- `demo_llm_proxy/` — model router (`:8090`, host tiers `8091` + `8096`)
- `scripts/` — topology, hygiene, release, provisioning helpers
- `docs/`, `planning/` — documentation and plans

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
