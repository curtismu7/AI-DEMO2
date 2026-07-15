# Board Backlog — piped 2026-07-10

Raw feedback from the board for ai-demo.ping-devops.com, triaged into work items.

## Bugs

### B1. `/pinggateway-test.html` returns 404
- URL: https://ai-demo.ping-devops.com/pinggateway-test.html

### B2. Authorization policies list fails with 403
- Error: `ACCESS_FAILED` → `INSUFFICIENT_PERMISSIONS` ("You do not have permissions or are not licensed to make this request.")
- Example error id: `ad182dad-62cd-45e7-8999-13dd7d0ce94c`
- Likely a worker-app role/license issue on the PingOne side, or wrong token being used for the Authorize API.

### B3. `/pingcli` page — every command returns INVALID_ARGUMENT
- Error: "Authentication is not configured for this profile." Suggestion from CLI: run `pingcli <product> auth login`.
- Server-side pingcli profile needs auth configured (or the proxy needs to inject/refresh it).
- Also: **Run buttons at the bottom of the page do nothing.**
- Also: check the currently installed pingcli version on the page and show the upgrade command.

### B4. AI Attach Demos — run buttons do nothing
- None of the run buttons on the AI Attach Demos trigger anything.

### B5. Code chat — "CodeGraph index not available" — FIXED
- Cause: agent image shipped a zero-byte `/app/codegraph.db` (`touch` placeholder) because `setup:fresh` never baked `langchain_agent/codegraph.db` for the Dockerfile COPY. Refresh wrote to `repo-src/.codegraph` (staged indexer without `--out`) while queries read `/app/codegraph.db`.
- Fix: bake DB in setup/run/se-update; bake current `scripts/build-codegraph.py` to `/app/indexer`; `ensure_index` promotes legacy → query path on startup + every query + Refresh; Refresh fails closed if query DB still empty.
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
