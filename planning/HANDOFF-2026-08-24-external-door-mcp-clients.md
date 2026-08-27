# Handoff — External-Door MCP Clients (2026-08-24)

**Read this first, then check the "Open PRs" table below for current status before doing anything else — PR states may have changed since this was written.**

## What this session was about

Starting question: which Mac MCP clients (commercial, open source, and our own) can act as the "front door" into AI-DEMO2's MCP servers, across **both** of the two front doors this repo has:

1. **Agent Gateway path** — `demo_mcp_gateway` (Node), default transport WebSocket, alt Streamable HTTP / PingGateway.
2. **Privilege path** — PingOne Privilege Cloud's MCP Gateway, agent-mode or agentless-mode (OAuth Auth Code + PKCE).

That grew into: a survey report → two design specs (extend our own `langchain_agent` client, and use LibreChat) → a spike that found a real bug in the LibreChat design → a corrected spec → a full implementation plan for the `langchain_agent` client → subagent-driven execution of that plan (4 code tasks + 1 final-review fix wave, all reviewed) → a small unrelated bug fix discovered along the way.

## Open PRs (check `gh pr view <n> --json state` for current truth)

| PR | Title | State as of this doc | What it is |
|---|---|---|---|
| [#2330](https://github.com/curtismu7/AI-DEMO2/pull/2330) | docs: Mac MCP client report for external-door use case | OPEN | The original survey report, `docs/mcp/MAC_MCP_CLIENTS_EXTERNAL_DOOR_REPORT.md` |
| [#2332](https://github.com/curtismu7/AI-DEMO2/pull/2332) | docs: design specs for dual-front-door external MCP clients | **MERGED** | The two original design specs (before the LibreChat correction) |
| [#2335](https://github.com/curtismu7/AI-DEMO2/pull/2335) | docs: correct LibreChat spec to Privilege-only after source verification | OPEN | Corrects the LibreChat spec — see "The LibreChat correction" below |
| [#2336](https://github.com/curtismu7/AI-DEMO2/pull/2336) | feat(langchain_agent): external MCP client for both front doors | OPEN | The actual implementation — `external_client.py`, `privilege_auth.py`, `PrivilegeConfig`. Full suite green (855 passed). Contains the "Rulings made during execution" writeup in its PR description. |
| [#2338](https://github.com/curtismu7/AI-DEMO2/pull/2338) | fix(langchain_agent): remove dead test_encryption.py from stable pytest subset | OPEN | Unrelated one-line fix, found while verifying #2336 — `bash scripts/run-pytest.sh` (no args) was broken on `main` itself before this |

**None of these are merged except #2332.** Whoever picks this up should review and merge #2330, #2335, #2336, #2338 in roughly that order (later ones build conceptually on earlier ones, though there's no hard git dependency).

## The LibreChat correction (why it matters)

The original LibreChat spec claimed it could reach the Agent Gateway's WebSocket transport with a static bearer token, "zero server-side changes." A follow-up spike checked this against LibreChat's actual source (`github.com/danny-avila/LibreChat`) and found: the WS transport is real, but that code path **never attaches any bearer token, static header, or OAuth credential** — auth only exists on the SSE/Streamable-HTTP branches. So that claim was wrong. PR #2335 rescopes the LibreChat spec to the Privilege door only. **The `langchain_agent` external CLI (PR #2336) remains the only client that reaches the Agent Gateway door.** LM Studio was also investigated as a side note — closed-source app, but ships native OAuth 2.1 config for remote MCP servers, so it's a zero-code option for the Privilege door too (documented in the corrected spec, not implemented).

## What's actually built and working (PR #2336)

- `langchain_agent/src/mcp/external_client.py` — CLI: `python -m src.mcp.external_client --server {agent_gateway,privilege} [--call TOOL_NAME JSON_ARGS]`
- `langchain_agent/src/mcp/privilege_auth.py` — OAuth Authorization Code + PKCE flow for the Privilege door (local loopback callback, `client_secret_basic` token exchange)
- `langchain_agent/src/config/settings.py` — `PrivilegeConfig`, plus a fix to the production URL-scheme allowlist (now accepts `https://`, not just `wss://`/`local://`)
- `langchain_agent/.env.example` — documents all 9 new env vars (added in the final-review fix wave)
- Full test suite: 855 passed. Reviewed task-by-task (subagent-driven-development process) plus one final whole-branch review; one Critical bug (missing `ai_agent` OAuth scope on the Agent Gateway token — would have been denied live) and 4 Important usability gaps were found and fixed in that final pass.

## What's NOT done yet — the actual next steps

1. **Merge the 4 open PRs** (#2330, #2335, #2336, #2338) — nothing is blocking this except review.
2. **Live verification (this repo's own "Task 5" from the implementation plan)** — never run, because it needs a live demo stack + real PingOne credentials, which weren't available in the isolated worktree session:
   - Agent Gateway door: needs `MCP_SERVER_AGENT_GATEWAY_ENDPOINT` set in `langchain_agent/.env` (same URL as the existing `MCP_SERVER_BANKING_ENDPOINT` — the CLI uses a different env var name by design, see PR #2336's "Rulings" section for why).
   - Privilege door: needs a **new PingOne OAuth client registered** — redirect URI `http://127.0.0.1:8765/callback` (or whatever `PRIVILEGE_MCP_CALLBACK_PORT` is set to), Authorization Code grant, PKCE S256 required, `client_secret_basic`. This is an admin-console action, not something automatable.
3. **LibreChat implementation** — the corrected spec (PR #2335, once merged) describes standing up LibreChat as a Privilege-only client (`librechat/docker-compose.yml`, `librechat.yaml`, pointed at the repo's local LLM proxy on :8090). **No implementation plan has been written for this yet** — brainstorming/design is done, the next step (if wanted) is the `superpowers:writing-plans` skill against `docs/superpowers/specs/2026-08-24-librechat-dual-door-mcp-client-design.md`.
4. Two Minor gaps deliberately deferred out of #2336's final review (not blocking, just noted): the new "Privilege not configured" validation branch in `privilege_auth.py` has no dedicated test, and `external_client.py`'s error handling doesn't catch 3 of `connection.py`'s own custom exception types.

## Worktrees from this session

All under `~/Development/AI-DEMO2/.claude/worktrees/`, one per PR/topic above — each still has its work committed and pushed, so they're safe to delete once their PR merges (or just leave them, they don't cost anything sitting idle):

| Worktree dir | Branch | PR |
|---|---|---|
| `docs-mac-mcp-clients-report` | `worktree-docs-mac-mcp-clients-report` | #2330 |
| `external-agent-mcp-client` | `worktree-external-agent-mcp-client` | #2332 (merged, worktree can be removed) |
| `librechat-spec-correction` | `worktree-librechat-spec-correction` | #2335 |
| `external-agent-mcp-client-plan` | `worktree-external-agent-mcp-client-plan` | #2336 |
| `fix-run-pytest-stable-list` | `worktree-fix-run-pytest-stable-list` | #2338 |
| `handoff-external-door-mcp-session` | `worktree-handoff-external-door-mcp-session` | this doc |

## How to resume in a new session

Point a fresh Claude Code session at this file (`planning/HANDOFF-2026-08-24-external-door-mcp-clients.md`) and ask it to check the PR states first (`gh pr view <n> --json state,mergeable`), since this doc's table may be stale by the time you're reading it. From there:
- If you just want the work merged: review and merge #2330 → #2335 → #2336 → #2338.
- If you want to continue building: either do the live verification (step 2 above) or write the LibreChat implementation plan (step 3 above) — both are independent next steps, pick whichever matters more.
