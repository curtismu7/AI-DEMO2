# Privilege A2A Anthropic tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Add the three-process Privilege A2A access-review demo as an A2A tab in AI Guard Client.

**Architecture:** Keep the main agent, worker agent, and MCP server as separately launched Node processes under standalone/privilege-a2a-anthropic-demo. Add a session-gated BFF SSE relay and a focused React feature module mounted as a tab in the existing AI Guard Client. Keep the Anthropic Agent Access keys in their respective agent processes and use a separate server-only shared secret between BFF and main agent.

**Tech Stack:** Node.js >=22, TypeScript, @anthropic-ai/sdk, @a2a-js/sdk, @modelcontextprotocol/sdk, Express, CommonJS Express BFF, React/Vite, Vitest, Jest/Supertest.

**Spec:** docs/superpowers/specs/2026-09-29-privilege-a2a-anthropic-demo-design.md

## Global Constraints

- Preserve the independent main agent → A2A worker → MCP server topology.
- Do not add a Compose service or change the AI-DEMO2 startup topology.
- Use Anthropic through Privilege; each agent reuses only its own Agent Access key for its LLM and outbound protocol calls.
- Keep browser cookies, OAuth tokens, user claims, and Authorization headers out of requests to the main agent and worker.
- Require the AI-DEMO2 session at the BFF and a server-only shared secret at the BFF-to-main hop.
- Keep all UI calls same-origin through the BFF; render streamed text as text.
- Do not modify banking A2A, OAuth, token exchange, existing MCP tabs, the static A2A product page, or AIAgentFull.js.
- Preserve the emoji allowlist, theme contrast rules, existing app-session behavior, and protected A2A token-custody behavior.
- Do not run docker compose from the worktree.

---

## File map

- standalone/privilege-a2a-anthropic-demo/src/config.ts: process ports, bind hosts, gateway URLs, and the main-agent shared-secret setting.
- standalone/privilege-a2a-anthropic-demo/src/main-agent/index.ts: BFF-authenticated chat endpoint and integration-mode access guard.
- standalone/privilege-a2a-anthropic-demo/src/worker-agent/index.ts: correct SDK route mounting and worker protocol endpoints.
- standalone/privilege-a2a-anthropic-demo/test/topology.test.ts: process-level Anthropic-stub test for chat → A2A → MCP, keys, readiness, BFF shared-secret enforcement, and concurrent trace isolation.
- standalone/privilege-a2a-anthropic-demo/config.example and README.md: defaults, integrated startup, port overrides, and separate-process instructions.
- demo_api_server/routes/privilegeA2aClient.js: session-gated server-side SSE relay.
- demo_api_server/server.js: mount the new focused BFF route at /api/privilege-a2a.
- demo_api_server/tests/privilegeA2aClientRoute.test.js: BFF session, request sanitization, SSE, abort, and upstream-error behavior.
- demo_api_ui/src/features/privilegeA2aClient/PrivilegeA2aTab.jsx: chat, SSE parser, trace, answer, and error UI.
- demo_api_ui/src/features/privilegeA2aClient/PrivilegeA2aTab.css: component-local light/dark styling using existing theme tokens.
- demo_api_ui/src/features/privilegeA2aClient/__tests__/PrivilegeA2aTab.test.jsx: submit, answer/trace streaming, and errors.
- demo_api_ui/src/pages/PrivilegeMcpClientPage.jsx: add the A2A demo tab to Demo mode and mount PrivilegeA2aTab.

### Task 1: Repair and prepare the three-process demo

**Files:**
- Modify: standalone/privilege-a2a-anthropic-demo/src/config.ts
- Modify: standalone/privilege-a2a-anthropic-demo/src/worker-agent/index.ts
- Modify: standalone/privilege-a2a-anthropic-demo/src/main-agent/index.ts
- Modify: standalone/privilege-a2a-anthropic-demo/test/topology.test.ts
- Modify: standalone/privilege-a2a-anthropic-demo/config.example
- Test: standalone/privilege-a2a-anthropic-demo/test/topology.test.ts

**Interfaces:**
- Main integration endpoint: POST /chat with JSON { message: string, sessionId?: string }, protected by header X-A2A-BFF-Secret when A2A_BFF_SHARED_SECRET is configured.
- Main listener host and port: MAIN_AGENT_HOST (default 127.0.0.1) and MAIN_AGENT_PORT (default 3300).
- Worker and MCP ports: WORKER_AGENT_PORT default 3301 and MCP_SERVER_PORT default 3302; their native listeners remain on 127.0.0.1.
- The test uses independently allocated ports and asserts worker card and JSON-RPC routes are mounted at their advertised paths.
- Each main-agent chat turn gets a fresh random A2A context ID; the worker tags MCP traces with it and returns only matching events to that turn's trace stream.

- [x] Step 1: Add failing topology assertions before changing implementation. Extend test/topology.test.ts to: fetch the worker card and assert its JSON-RPC URL; prove POST /chat without X-A2A-BFF-Secret returns 401 when integration mode is enabled; then send two concurrent test chats with the secret and assert each receives only its own worker trace details. Retain the delegated entitlement lookup and per-agent Authorization assertions. Use A2A_BFF_SHARED_SECRET=test-bff-shared-secret in the main child environment. Keep the local Anthropic stub and ephemeral ports.

  The route readiness assertion should call GET /a2a/.well-known/agent-card.json and require a JSON card. The end-to-end chat then exercises the worker's advertised JSON-RPC endpoint through the real main-agent client.

- [x] Step 2: Run the backend integration test and confirm it fails before the implementation changes. It failed because Carol's trace stream received Erin's entitlement details.

  Run from standalone/privilege-a2a-anthropic-demo: npm test.
  Expected: failure at the current SDK handler mounting/readiness defect or missing BFF-secret guard, not at the Anthropic stub.

- [x] Step 3: Fix the A2A SDK route mounts. The SDK agentCardHandler and jsonRpcHandler return routers whose internal routes match “/”; mount them with app.use('/a2a/.well-known/agent-card.json', agentCardHandler(...)) and app.use('/a2a/jsonrpc', jsonRpcHandler(...)) rather than passing them to app.get/app.post at the full path. Preserve the existing optional inbound Bearer-presence middleware.

- [x] Step 4: Update configuration defaults and BFF access. Set process defaults to 3300/3301/3302. Add MAIN_AGENT_HOST with default 127.0.0.1 and use it for main listener binding. Add A2A_BFF_SHARED_SECRET; when configured, reject /chat with 401 unless X-A2A-BFF-Secret matches. Keep /status and the standalone page independent of the BFF secret. Do not expose the secret in /status, logs, or HTML. Continue accepting direct standalone /chat when the secret is unset.

- [x] Step 5: Run backend tests and TypeScript build. npm test exercises the complete three-process request, both keys, the shared secret, and concurrent worker trace isolation; npm run build passes.

### Task 2: Add the AI Guard Client BFF relay

**Files:**
- Create: demo_api_server/routes/privilegeA2aClient.js
- Modify: demo_api_server/server.js
- Create: demo_api_server/tests/privilegeA2aClientRoute.test.js
- Test: demo_api_server/tests/privilegeA2aClientRoute.test.js

**Interfaces:**
- Mount the route at /api/privilege-a2a.
- POST /chat accepts only a non-empty message (maximum 4000 characters) and an optional opaque sessionId (maximum 128 characters).
- Read PRIVILEGE_A2A_MAIN_URL (default http://127.0.0.1:3300), append /chat, and read PRIVILEGE_A2A_BFF_SECRET from server environment.
- Forward only message and sessionId in JSON and X-A2A-BFF-Secret in headers. Never forward browser Authorization, Cookie, request session, sub, act, or other claims.
- Require middleware requireSession. Stream upstream event-stream chunks without buffering; abort the upstream fetch when the browser disconnects; emit { error } JSON before headers or a safe SSE error after streaming begins.

- [x] Step 1: Add route tests first. Use a focused Express test app, express.json(), the new router, Supertest, and a controllable requireSession mock. Cover unauthenticated 401 with no upstream fetch; authenticated successful SSE relay; sanitization of a request containing fake Authorization, Cookie, and extra identity properties; missing/invalid message 400; unavailable main agent 502 with { error }; and client disconnect aborting the upstream signal.

  For the relay test, have the mocked upstream return Content-Type text/event-stream and a ReadableStream containing trace, token, and done events. Assert the BFF body preserves the frames, its fetch target uses PRIVILEGE_A2A_MAIN_URL, and the only forwarded credential is X-A2A-BFF-Secret.

- [x] Step 2: Run the new focused Jest test and confirm it fails because the route did not exist.

  Run from demo_api_server: CI=true npx jest tests/privilegeA2aClientRoute.test.js --forceExit.
  Expected: FAIL on missing route module.

- [x] Step 3: Implement the narrow relay route. Register POST /chat with requireSession, validate message and sessionId, build a new upstream body/header set from the allow-listed fields, and fetch the configured main URL with an AbortController. Set text/event-stream, no-cache, and no-buffering headers; flush headers before waiting for the first event; copy response bytes as they arrive; abort upstream when the browser response closes. Never copy incoming headers except that route's own fixed Accept/Content-Type values.

- [x] Step 4: Mount with app.use('/api/privilege-a2a', require('./routes/privilegeA2aClient')) and rerun the focused Jest test. All five route behaviors pass.

### Task 3: Build and test the A2A tab feature

**Files:**
- Create: demo_api_ui/src/features/privilegeA2aClient/PrivilegeA2aTab.jsx
- Create: demo_api_ui/src/features/privilegeA2aClient/PrivilegeA2aTab.css
- Create: demo_api_ui/src/features/privilegeA2aClient/__tests__/PrivilegeA2aTab.test.jsx
- Test: demo_api_ui/src/features/privilegeA2aClient/__tests__/PrivilegeA2aTab.test.jsx

**Interfaces:**
- Export default PrivilegeA2aTab with no required props.
- POST same-origin to /api/privilege-a2a/chat using fetch, credentials: include, JSON { message, sessionId }, and Accept: text/event-stream.
- Parse SSE frames incrementally from response.body.getReader(); support trace, token, done, and error events, plus malformed frames without throwing.
- Keep the opaque sessionId from done events for the next message. Never send browser OAuth tokens or Authorization headers.
- Render answer, question, and trace content as ordinary text nodes.

- [x] Step 1: Write Vitest tests first with Testing Library and user-event. Test that submitting a question calls the same-origin BFF with credentials and only message/sessionId; streamed token text appears in the answer; trace appears in the trace area; done carries sessionId into a second request; a BFF non-2xx response and an SSE error event render an inline error; duplicate submit is disabled while streaming.

- [x] Step 2: Run only the new test file and confirm it fails because the feature module had not been created.

  Run from demo_api_ui: npm run test:unit -- src/features/privilegeA2aClient/__tests__/PrivilegeA2aTab.test.jsx.
  Expected: FAIL on missing feature module.

- [x] Step 3: Implement the accessible chat component. Use a form with a labeled textarea and submit button, an aria-live answer region, a trace list with semantic headings, an inline error region, and a cancel button that aborts the browser fetch. Use text nodes only for all model- and tool-sourced data. Keep request parsing in this feature module rather than expanding the large existing page.

- [x] Step 4: Add component-local CSS using the page's existing CSS variables/theme tokens; include readable light and dark states, visible focus, disabled, and error styles. Do not add themeable inline styles, muted modal text, non-allowlisted emoji, or an iframe.

- [x] Step 5: Rerun the focused Vitest file and confirm streaming, error, session, and accessibility interactions pass.

### Task 4: Mount the tab and document integrated startup

**Files:**
- Modify: demo_api_ui/src/pages/PrivilegeMcpClientPage.jsx
- Modify: standalone/privilege-a2a-anthropic-demo/config.example
- Modify: standalone/privilege-a2a-anthropic-demo/README.md
- Modify: REGRESSION_PLAN.md (reverse-chron bug-log entry only if required by regression-guard for the new feature)
- Test: demo_api_ui/src/pages/__tests__/PrivilegeMcpClientPage.noAutoDiscover.test.jsx

**Interfaces:**
- Add the tab label A2A to Demo-mode VIEW_TABS while preserving Agent Chat, Tools, and every Inspect tab.
- Mount PrivilegeA2aTab only when visibleTab === 'a2a'; do not replace MCP Agent Chat.
- Document native and shared-Docker-BFF configurations, server-only secret pairing, process ports, host binding, environment overrides, and commands to start each process separately.

- [x] Step 1: Add a focused page test to the existing noAutoDiscover suite. Set cur_priv_view to demo, render the existing AI Guard Client shell, select A2A, and assert the tab content is mounted; switch to Inspect and assert MCP Explorer, Raw RPC, and Policies remain available.

- [x] Step 2: Run the page test and confirm it fails because the tab was not listed or mounted.

  Run from demo_api_ui: npm run test:unit -- src/pages/__tests__/PrivilegeMcpClientPage.noAutoDiscover.test.jsx.
  Expected: FAIL because the A2A tab cannot be selected.

- [x] Step 3: Wire the page. Import the focused feature, add ['a2a', 'A2A'] to TAB_LABELS and 'a2a' to the demo list, then mount the component in the editor area. Do not change the Inspect view.

- [x] Step 4: Update config.example and README. Set integrated defaults MAIN_AGENT_PORT=3300, WORKER_AGENT_PORT=3301, MCP_SERVER_PORT=3302; set MAIN_AGENT_HOST=127.0.0.1 for native BFF or 0.0.0.0 when the BFF is in Docker and accesses the host via host.docker.internal; set matching PRIVILEGE_A2A_MAIN_URL and PRIVILEGE_A2A_BFF_SECRET/A2A_BFF_SHARED_SECRET values on the BFF and main process. Explain npm run dev and the separate npm run mcp / npm run worker / npm run main workflow. Make clear that no Compose service was added and Anthropic's provider key remains registered in Privilege.

- [x] Step 5: Run focused tests and gates. Run npm ci in demo_api_server and demo_api_ui before their tests; the focused Jest route suite passed (5 tests), both focused Vitest files passed (8 tests), the demo_api_ui build passed, the standalone npm test and TypeScript build passed, and git diff --check passed. The UI contrast auditor found no new violations in the A2A feature in either theme. `npm run topology:verify`, `npm run authz:verify`, and `npm run hygiene:check` passed; no generated route output was hand-edited.

- [x] Step 6: Review git status and staged paths; stage only the listed feature, test, and documentation paths. Commit the integrated demo as one logical unit after all required gates passed. No push was made.
