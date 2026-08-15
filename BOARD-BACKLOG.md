# Board Backlog — piped 2026-07-10

Raw feedback from the board for ai-demo.ping-devops.com, triaged into work items.

## Bugs

### B1. `/pinggateway-test.html` returns 404 — FIXED
- Served from `demo_api_ui/public/pinggateway-test.html`; nginx uses `try_files` (no BFF proxy dependency).

### B2. Authorization policies list fails with 403 — FIXED
- `/api/authorize/pingone-policies` serves the repo P1AZ snapshot first (worker tokens always 403 on the live policy-editor API).

### B3. `/pingcli` page — every command returns INVALID_ARGUMENT — FIXED
- Live commands use `pingone api <uri>`; `--config` resolved at call time; auth bootstrap fails closed if worker creds are missing.

### B4. AI Attack Demos — run buttons do nothing — FIXED
- Showcase fallback navigates to `/dashboard` with pending-attack replay; Intent Bypass uses the same handoff; catalog tabs use router state.

### B5. Code chat — "CodeGraph index not available" — FIXED
- Cause: agent image shipped a zero-byte `/app/codegraph.db` (`touch` placeholder) because `setup:fresh` never baked `langchain_agent/codegraph.db` for the Dockerfile COPY. Refresh wrote to `repo-src/.codegraph` (staged indexer without `--out`) while queries read `/app/codegraph.db`.
- Fix: bake DB in setup/run/se-update; bake current `scripts/build-codegraph.py` to `/app/indexer`; `ensure_index` promotes legacy → query path on startup + every query + Refresh; startup auto-builds when still empty (`build_query_index_sync`); Refresh fails closed if query DB still empty.
- Verify: rebuild/redeploy agent, ask "How does the MCP gateway work?" on `/code-explorer` — expect SSE answer, not 503. Pod restart must keep working without a manual copy.

### B6. `/code-search` — button CSS broken
- URL: https://ai-demo.ping-devops.com/code-search

## Enhancements

### E1. Vertical ops pages: show Agent (MCP Client) → MCP Server
- Show the exact same data as today, but in the token chain show just the MCP route.
- Example URL: https://ai-demo.ping-devops.com/admin/healthcare

### E2. `/scope-reference` — keep current with code
- URL: https://ai-demo.ping-devops.com/scope-reference
- Verify the page content matches what the code actually uses.

### E3. `/settings` — verify all options work
- URL: https://ai-demo.ping-devops.com/settings
- Audit every option on the page end-to-end.

### E4. `/delegation` — real demo-user login flow
- Create a user in PingOne with a password.
- Show a message to the demo user with those credentials so they can log in and see delegation.
- URL: https://ai-demo.ping-devops.com/delegation

### E5. `/code-search` — real agent experience
- Current "Ask the agent" is too small; make it feel like a real agent.
- Use a system modal (native `confirm`/dialog) instead of the app modal for the file-size warning.
- Add a spinner while code is uploading.
- Make the agent look like the OAuth Academy page.

### E6. Consistent "Exploring" section
- Code Explorer, OAuth Academy, Code Search, and OAS Demo should be visually consistent pages/agents.
- Move all of them under a new menu group named **"Exploring"**.

### E7. `/agent-studio-preview` — needs to be greatly enhanced
- URL: https://local.ping-devops.com:4000/agent-studio-preview
- Design spec: `docs/superpowers/specs/2026-07-13-agent-studio-preview-design.md`
- Was fixed for blank-page-when-signed-out in PR #1641 (route was gated behind login); content itself still needs the enhancement pass.
