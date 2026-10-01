# Privilege A2A Anthropic Demo in AI Guard Client

**Status:** Approved<br>
**Date:** 2026-09-29

## Goal

Add the Privilege A2A access-review demo as a native **A2A** tab in AI Guard
Client (`/privilege-mcp-client`). Keep the three independent Node processes
(main agent, worker agent, MCP server), use Anthropic through Privilege, and
reuse each agent's own Agent Access key for that agent's LLM and protocol
requests.

The chat and trace should appear in AI-DEMO2's existing client shell. A user
should be able to open the client, choose the A2A tab, ask about a seeded
entitlement, and watch the main agent delegate to the worker, which queries
the MCP server.

## Existing context

- AI Guard Client is `demo_api_ui/src/pages/PrivilegeMcpClientPage.jsx` at
  `/privilege-mcp-client`. Its Demo view already has Agent Chat and Tools tabs;
  Inspect retains the MCP Explorer, Raw RPC, and Policies tabs.
- `demo_api_server/routes/privilegeMcpClient.js` is the BFF relay for that
  client. The BFF owns browser-session credentials and is the browser's API
  boundary.
- The separate A2A backend is being built under
  `standalone/privilege-a2a-anthropic-demo/`. Its three-process topology and
  Anthropic request path are retained. Its current browser page will no longer
  be the integrated tab's UI.
- The existing banking assistant's A2A handoff, OAuth, RFC 8693 exchange, and
  token-custody flows are separate and remain unchanged.

## User flow and topology

```text
AI Guard Client — A2A tab
  └─ POST /api/privilege-a2a/chat (SSE)
      └─ BFF: validates the AI-DEMO2 session and relays the stream
          └─ main agent :3300
              ├─ Anthropic Messages API → Privilege, Bearer MAIN_AGENT_KEY
              ├─ A2A JSON-RPC → worker :3301, Bearer MAIN_AGENT_KEY
              └─ worker trace SSE → main agent filters by fresh A2A context ID → BFF → browser stream
                  worker agent :3301
                    ├─ Anthropic Messages API → Privilege, Bearer WORKER_AGENT_KEY
                    └─ MCP Streamable HTTP → MCP server :3302,
                       Bearer WORKER_AGENT_KEY
```

The ports avoid existing AI-DEMO2 listeners such as Grafana `:3000`, the BFF
`:3001`, MCP Gateway `:3005`, and Loki `:3100`. The process ports and the BFF's
main-agent URL remain configurable.

## Credential and identity contract

- `MAIN_AGENT_KEY` is used only by the main agent: as Bearer authentication for
  its Anthropic Messages API requests and outbound A2A requests to the worker.
- `WORKER_AGENT_KEY` is used only by the worker: as Bearer authentication for
  its Anthropic Messages API requests and outbound MCP requests.
- Anthropic's provider key is registered in Privilege. It is not stored in the
  browser, the BFF, or either agent process.
- The BFF may require a valid AI-DEMO2 app session to access the chat endpoint,
  but it does not forward browser cookies, OAuth access tokens, `sub`, `act`,
  or other user identity to the main agent. The main agent uses the opaque
  session ID only for in-memory conversation history and creates a fresh
  random A2A context ID for each chat turn. Worker trace events carry that
  context ID, and each trace stream receives only matching events.
- The existing AI Guard Client's interactive gateway OAuth remains separate
  from this machine-to-machine demo identity.
- Local bearer-presence checks, if enabled for the worker or MCP process, only
  demonstrate that a Bearer header arrived. Privilege validates the key and
  applies gateway policy.

## Integration boundaries

### React client

- Add a dedicated feature module under
  `demo_api_ui/src/features/privilegeA2aClient/`.
- Add **A2A** to the existing AI Guard Client Demo tabs and mount the feature
  there. Do not place the flow in the banking assistant's `AIAgentFull.js`,
  replace the MCP Agent Chat tab, or change Inspect tabs.
- Render streamed model output and trace text as text. Handle an unavailable
  main-agent service and BFF errors inside the new tab.
- Make requests only through `demo_api_ui/src/services/apiClient` or the
  established client API mechanism; never call a local or gateway URL directly
  from the browser.

### BFF relay

- Add a focused route mounted at `/api/privilege-a2a`, separate from the
  existing MCP operations.
- Protect chat requests with the established session middleware. Stream the
  main-agent SSE response through without buffering; propagate browser aborts
  to the upstream request and normalize connection errors.
- Use a configurable `PRIVILEGE_A2A_MAIN_URL` for the upstream main agent.
  The integrated request body is restricted to the chat text and opaque
  session correlation ID. Never copy authorization headers or session data
  from the browser request.
- Authenticate the BFF-to-main-agent hop with a server-only shared secret.
  The main agent accepts chat requests only from this BFF-authenticated hop
  when integration mode is enabled.

### Three-process backend

- Keep the process code and configuration in
  `standalone/privilege-a2a-anthropic-demo/`; process defaults are main `3300`,
  worker `3301`, and MCP `3302`, with overrides for each port and URL.
- Use the official Anthropic TypeScript SDK at the native
  `/llm/anthropic/v1/messages` route. Do not retain the source demo's Google
  provider implementation.
- Keep the data lookup tools in the MCP process. The main agent delegates with
  A2A JSON-RPC, and the worker performs the Anthropic tool loop against MCP.
- Support direct local startup with `npm run dev`. The BFF upstream URL is
  configurable for native AI-DEMO2 startup (`http://127.0.0.1:3300`) and the
  shared Docker BFF (`http://host.docker.internal:3300`). The main listener
  must accept the configured BFF connection and reject requests that lack the
  BFF shared secret. Worker and MCP remain loopback-bound for native startup.
- Do not add a Compose service in this change; the A2A processes remain
  independently started, preserving the requested three-process topology.

## Failure behavior

- If the BFF session check fails, return the existing `{ error }` API shape and
  do not contact the main agent.
- If the main agent is unreachable, return a normalized BFF error without
  disclosing request headers, secrets, or upstream stacks.
- If an upstream A2A, Anthropic, or MCP operation fails after streaming starts,
  preserve the stream's error/trace semantics and close the response cleanly.
- A worker/MCP or Privilege policy denial is surfaced as a failed trace/result;
  the main agent does not fall back to another credential, model provider, or
  direct tool path.

## Non-goals

- No browser-token propagation, RFC 8693 exchange, user-on-behalf-of flow, or
  change to the banking A2A protocol.
- No changes to the static AI Gateway · A2A product explanation page or the
  banking assistant's disabled Privilege A2A control.
- No replacement of existing MCP client tabs or Privilege OAuth flows.
- No changes to the root startup topology or deployment targets.

## Verification plan

- Backend package integration test: run main, worker, and MCP processes on
  ephemeral ports against a local Anthropic stub; verify the chat delegates,
  the MCP result reaches the worker model, the response reaches the tab, and
  the main and worker use their own Bearer keys. Run concurrent chats and
  verify their worker traces do not expose one another's entitlement details.
  Require Bearer headers on the local A2A and MCP hops.
- BFF route tests: reject missing app sessions, verify the proxy body excludes
  browser identity/tokens, relay SSE events, abort the upstream on disconnect,
  and return a safe error when the main agent is unavailable.
- UI unit tests: select the A2A tab, submit a question through the BFF API,
  render streamed answer/trace events, and handle error events.
- Run the focused BFF Jest tests; the focused AI Guard Client Vitest tests and
  `npm run build`; backend `npm test` and `npm run build`; `git diff --check`.
- Run the UI contrast auditor on the new tab in light and dark themes.
- Preserve the regression plan's OAuth, app-session, A2A token-custody,
  existing MCP-client, and UI emoji/style invariants.
