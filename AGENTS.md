# Repository agent instructions

- `CLAUDE.md` is canonical. Read its Agent behavior, do-not-break contract, and verification sections first; read the nearest nested `CLAUDE.md` before editing a service.
- Use an isolated git worktree for edits and commits. Stage only intended paths. Never run `docker compose` from a worktree; use `npm run serve:worktree here` when the shared stack must serve worktree code.
- Before changing OAuth, token exchange, sessions, authorization, or `demo_api_ui/`, read `REGRESSION_PLAN.md` §0–§1 and invoke `regression-guard`. UI changes require `cd demo_api_ui && npm run build`; preserve the project emoji allowlist.
- This is a multi-service Node/Python demo, not a single package. Node services require Node >=22. The BFF is `demo_api_server/` and is the sole browser-token custodian; the UI is `demo_api_ui/`; MCP/gateway boundaries include `oauth-mcp/` and `demo_mcp_gateway/`.
- Fast default verification: `./run-tests.sh unit`. For a focused BFF test use `cd demo_api_server && CI=true npx jest <touched test paths> --forceExit`; full BFF is `CI=true npm test -- --forceExit`. UI uses Vitest, not Jest: `cd demo_api_ui && npm run test:unit && npm run build`.
- Run focused checks for touched surfaces; use `npm run topology:verify`, `npm run hygiene:check`, and `npm run authz:verify` when topology, generated/configured routes, or auth requirements are affected. `npm run ci:local` is the broad local CI equivalent.
- Run `npm ci` in a service before testing it; `run-tests.sh` intentionally refuses missing service dependencies instead of letting `npx` fetch a stray toolchain. E2E needs a running API and the browser origin `https://local.ping-devops.com:4000`.
- Generated schemas, topology, use-case data, scopes, and ledgers must be regenerated with their source package scripts and then checked; never hand-edit generated output. Worktree hooks may skip topology checks, so run `npm run topology:verify` before merging.
- The canonical local browser origin is `local.ping-devops.com:4000`; do not add hardcoded `localhost` OAuth redirects. Read `REGRESSION_PLAN.md` for the complete origin/config list.
- Do not treat a piped command’s exit status as proof of success; redirect output or inspect `PIPESTATUS`. Do not claim completion without fresh test/build evidence.
- AI-DLC is opt-in only when the user says `Using AI-DLC,`; otherwise follow the normal workflow. PingOne provisioning/reset scripts mutate live state—read them before running.
