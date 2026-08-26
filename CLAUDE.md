# Banking Demo — PingOne Edition

Standalone AI-powered banking demo: PingOne auth, RFC 8693 token exchange, BFF/UI, MCP servers, AI agents, authz/gateway, provisioning and tests. This file is the canonical agent instruction set; `AGENTS.md` redirects here.

## Agent behavior (read first)

Shape **how** you think. Specific stack rules below shape **what** you cannot break.

1. **Don't assume — surface tradeoffs.** State assumptions; present options instead of picking silently; stop and ask when something is unclear.
2. **Minimum code that solves the problem.** No speculative features, abstractions, or error handling beyond what was asked.
3. **Touch only what you must.** Every changed line traces to the request — no drive-by cleanup; remove only orphans your own change created.
4. **Define success criteria, loop until verified.** Turn vague goals into runnable checks; don't declare done without evidence.

Litmus for new rules here: would removing the line cause a mistake the agent couldn't recover from by reading the repo? If not, leave it out.

## Do-not-break contract

**[REGRESSION_PLAN.md](REGRESSION_PLAN.md)** is the source of truth for what must not break — read `§0` (hard UI/style) and `§1` (protected areas) before touching auth, token exchange, BFF sessions, or UI. Invoke `.claude/skills/regression-guard/` first; if it disagrees with the file, the file wins.

Always-on hard rule from `§0` — **emoji allowlist only:** `⚠️` `✅` `❌` `🔐` `✕` `✓` `👤` `🔑` `🪟` `📚`. Everything else: plain text, CSS, or semantic HTML.

**[TECH_DEBT.md](TECH_DEBT.md)** tracks known architectural gaps found while fixing something else — correct enough to ship, worth fixing properly later. Add an entry when you knowingly leave one behind; check it before re-deriving a gap someone already scoped.

## Working practice — worktree (required)

Edit→test→commit only in an **isolated git worktree** — concurrent sessions share one index and collisions have wiped staged work.

- Enter a worktree before edits (`EnterWorktree`, `superpowers:using-git-worktrees`, or a subagent with `isolation: "worktree"`). One branch per worktree.
- Stage explicitly (`git add <files>`), never `git add -A`. Verify `git branch --show-current` before each commit.
- A hard-block hook denies `Write`/`Edit` in the main checkout.
- **After any PR merges, sync the shared main checkout:** `scripts/sync-main-checkout.sh` from repo root. Docker (`ai-demo-ui`/`ai-demo-api-server`) bind-mounts that checkout's files directly — a merge on GitHub does not update them, so the running demo silently serves stale code until something pulls. The script fast-forwards only; it backs off untouched if anything unexpected is dirty. A launchd job also runs it every 15 min to catch merges that land outside any agent session.
- **To try your worktree's code in the running stack:** `npm run serve:worktree here` (status with no argument; `main` hands it back). It moves only the two source mounts — `ui` and `demo-api-server` are the only services that bind-mount source — and keeps `--project-directory` on the main checkout, so all 37 `env_file` entries still resolve. Never `docker compose up` from a worktree: it repoints the shared containers *and* starves every service of its `.env` (a worktree carries no gitignored files, and each entry is `required: false`, so Compose skips it silently). One stack, one owner — the status line names which checkout is being served.
- **When sync backs off:** `npm run sync:status` says whether the checkout is stale and names the files blocking it (silent staleness is the failure mode — the launchd job logs where nobody looks). `npm run sync:unblock` (`scripts/park-main-edits.sh`) moves stray main-checkout edits onto a `wip/main-<timestamp>` branch and then syncs — nothing stashed, nothing discarded, recover with `git switch wip/main-<timestamp>`. Untracked top-level `.claude/*.md` notes no longer block sync at all. A `SessionStart` hook (`.claude/hooks/warn-stale-main-checkout.sh`) fetches and runs `sync-status.sh` at the top of every session, so a stale or blocked checkout announces itself instead of being discovered hours later; it is silent when in sync and never blocks.

## Project

| | |
|---|---|
| Run | `./run.sh` (native); `./run-docker.sh` (Compose, lean core by default); `./run-k8.sh` |
| SE AWS | `./run-pingaws.sh` — Ping SE cluster only (`ai-demo.ping-devops.com`); wraps `./run-k8.sh se-*` + `se-update-{code,config,pingone}.sh` |
| API / UI | API `https://api.ping.demo:3001` / UI `https://local.ping-devops.com:4000` (hosts + `mkcert -install` once) |
| Test | `./run-tests.sh unit` (fastest); `./run-tests.sh [api\|e2e\|all]`; `npm test` |
| Hygiene | `npm run topology:verify`, `npm run hygiene:check`, `npm run authz:verify` |
| LLM proxy | `:8090` via `demo_llm_proxy/` (`LLM_BACKEND=llamacpp` default; `omlx` on Apple Silicon) |
| Monitoring | Grafana `/grafana` (login required) over Prometheus, scraping PingGateway's admin connector. Always deployed in k8s; **compose-gated behind `--profile monitoring`**, so locally it is off unless asked for. Config in `monitoring/`, one copy for both targets. |

PingOne lifecycle (`setup:fresh`, `pingone:bootstrap`, import/export/reset) mutates a live environment — read the script before running. Prefer hosted PingOne MCP tools for app/population/user reads during development.

## Repo map & stack

**Read the nested `CLAUDE.md` for the directory you're editing** — it carries that service's versions, layout and hard rules. Node >= 22 everywhere non-Python.

- `demo_api_server/` — BFF/API, CommonJS+Express+jest+supertest · own `CLAUDE.md`
- `demo_api_ui/` — React 19.2+Vite 8+**vitest**(not jest)+Playwright · own `CLAUDE.md`
- `oauth-mcp/` (banking/OLB MCP server), `demo_mcp_gateway/` — TypeScript+jest+ts-jest · each own `CLAUDE.md`
- `demo_mcp_resource_server/` (invest/SQLite read-path MCP server), `demo_mcp_proxy/`, `demo_authz_server/`, `demo_hitl_service/`, `ping-gateway/`
- `langchain_agent/` — Python+LangGraph+pytest · own `CLAUDE.md`; `openai_agent/`, `pydantic_agent/` — Python+pytest; `mastra_agent/` — Node
- `demo_llm_proxy/`, `scripts/`, `docs/`, `planning/`

## Watch out

- Auth/token/session/UI: protected — state what you won't break before editing.
- **Which use case / tile / route needs sign-in is declared in `demo_api_server/config/auth-requirements.json`** (`public` | `user` | `admin`), served to the UI as `uc.auth` on `/api/use-cases`. Gate on that, never on a fresh `isLoggedIn` check. `npm run authz:verify` fails on an unlisted use case, a drifted guest allowlist, or an App.js route guard that disagrees with the file — add a route or change a guard and update the SoT in the same commit.
- **Sign-in only works on `local.ping-devops.com:4000`** (passkey rp.id must match the serving host). `api.ping.demo:4000` serves the app but the session cookie lives on the other host, so it shows "Please sign in." Point `E2E_BASE_URL` there too, or every `*.real.spec.js` 401s in a way that looks like broken auth.
- Match existing conventions (error shapes, date handling, import paths) — don't invent.
- After code edits, run `graphify update .` (AST-only). Prefer `graphify query|path|explain` over raw grep when `graphify-out/graph.json` exists; use `graphify-out/wiki/index.md` for broad navigation when present.
- **Ping product docs: start from <https://docs.pingidentity.com/llms.txt>.** Fetch that index first, then follow it to the specific page — don't guess a docs.pingidentity.com URL directly or fall back to general web search.

## Knowledge bundles

Citable facts live in `graphify-out/*.kb.json`: `repo-topology` (service boundaries, token exchange, scope topology, feature-flag wiring, MCP tools) and `banking-domain` (balances, transfer limits, fraud holds the demo agent enforces). Check these before re-deriving a documented fact; add new assertions (`id`, `claim`, `source`, `confidence`) per `schemas/knowledge-bundle.schema.json`. `banking-domain` grounds the demo agent when `ff_knowledge_grounding` is ON — this is the demo's citable-facts feature, not Google's Open Knowledge Format.

## Push / merge / deploy cadence

Commit often (free, and uncommitted work is the only work that dies). **Push once per logical unit and always before going idle** — push is the only handoff between worktrees, and unpushed is the real loss risk. One PR per feature.

The expensive part is not opening a PR, it's watching it. `.claude/hooks/warn-token-leaks.py` warns (never blocks) on the three biggest leaks — repeat `gh pr checks` polling instead of one `--watch`, an unscoped test run, and a whole-stack `run-docker.sh restart`. Proceed past a warning when you have a reason and say why; suppress with `# no-leak-warn`. Self-check: `bash .claude/hooks/warn-token-leaks.test.sh`.

Deploy only after merge, only if you touched a bind-mounted service, and targeted (`scripts/deploy-live.sh` already is). Deploy is a singleton — check `npm run serve:worktree` before yanking the mounts out from under another session. The launchd job syncs main every 15 min, so a manual sync is only for "I need it current now".

**Before and after any live UI drive, pin the stack generation:** `gen="$(npm run -s stack:generation)"` … `npm run -s stack:generation -- --check "$gen"`. Several sessions share one stack and any of them can recreate `ui`/`demo-api-server` mid-request; from the driver's side that looks exactly like an application bug (404/502, no server-side trace, and `docker logs` afterwards reads the *new* container). A non-zero `--check` means the run is void — not a finding.

## Before claiming done

Use **Super Sports** as the default vertical for manual validation and tests that select a vertical. Keep another vertical only when that test explicitly verifies vertical-specific behavior.

1. Run the checks for what you touched — **scoped by default, not the full suite** — and paste the result line.
   - Server, scoped (default): `cd demo_api_server && CI=true npx jest <touched test paths> --forceExit`
   - Server, full: `cd demo_api_server && CI=true npm test -- --forceExit` — only when the change touches shared middleware (auth, session, token exchange, config store), spans more than ~3 route files, or a scoped run came back red in a way that suggests wider breakage.
   - UI → `cd demo_api_ui && npm run test:unit && npm run build`; cross-service → `npm run topology:verify` (run these only if you touched that surface).
   - A single-route fix, copy change, or one isolated test file needs the scoped run only. Say which scope you ran.
2. **Never conclude from a piped command's exit status.** `cmd | tail` exits with `tail`'s status, so a `deploy-live.sh` run that aborted with exit 1 reads as exit 0 — every "verified, exit 0" claim made through a pipe is unfounded, and the failure is silent by construction. Redirect to a file and read the file, or check `${PIPESTATUS[0]}`. Scripts under `scripts/` that run a subcommand whose failure should matter set `-o pipefail`.
3. State ✅ or ❌ — no bare "done": tests/build green (evidence, not assertion) · every changed line traces to the request · staged explicitly on a worktree branch · emoji allowlist respected.

## AI-DLC (opt-in only)

Activate **only** when the user prefixes with `Using AI-DLC,`. Then follow [`.aidlc/CORE-WORKFLOW.md`](.aidlc/CORE-WORKFLOW.md). Without that phrase, skip AI-DLC ceremony. `REGRESSION_PLAN` §0–§1, worktrees, and the emoji allowlist always win. Construction still requires a worktree. Do not run AI-DLC and GSD/plan-phase on the same feature in parallel. Resume: `Continue AI-DLC. Check aidlc-docs/aidlc-state.md for current status.`
