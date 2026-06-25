# PingOne Admin Chips — Design Spec

> **Note (2026-06-16):** The feature shipped, but the transport changed. References below to
> `mcpPingOneStdioAdapter.callToolViaStdio()` / the local `pingone-mcp-server` binary are
> **outdated** — the BFF now calls PingOne's **hosted HTTP MCP server** via
> `services/mcpPingOneHttpAdapter.js` (`listTools()` / `callTool()`) using a worker
> `client_credentials` token. The chip UX and `provider: "pingone-admin"` routing are unchanged.

## Overview

Add a "PingOne Admin" chip section to the banking agent's Actions popout. Clicking a chip sends a natural-language prompt through the **existing LangGraph agent pipeline** (`/api/banking-agent/message`) with a `provider: "pingone-admin"` flag. The BFF detects this flag, injects PingOne Admin tool schemas alongside the banking tools (or as a replacement), and executes any tool calls via `mcpPingOneStdioAdapter.callToolViaStdio()`. The section is visible only to admin-role users.

---

## Architecture

### Routing decision: extend the existing agent (Option A)

The chip click fires `onChipClick({ message, label, requiresLlm: true })` — the same path used by LLM analysis chips. `BankingAgent.js` posts to `/api/banking-agent/nl` (NL intent) which, when `source === 'llm'`, then calls `processAgentMessage`. The `provider: "pingone-admin"` value flows through the session/config into `bankingAgentLangGraphService.processAgentMessage`, where it is detected before the reason loop to swap in PingOne Admin tool schemas.

This reuses: streaming event delivery, token chain UI, tool event emission, `runReasonLoop` at `:3006`, and all existing error handling. No new route or service is created.

### Why no token exchange for PingOne Admin tools

The `pingone-mcp-server` binary handles its own PKCE auth (cached in macOS Keychain after the first admin browser login). It does **not** consume the user's delegated banking token. `mcpPingOneStdioAdapter.callToolViaStdio()` accepts an `accessToken` param that is passed as `_meta` — for PingOne Admin tool calls this is passed as `null` (or omitted); the server authenticates itself independently.

---

## Components

### 1. `PINGONE_ADMIN_CHIPS` array — `BankingChips.jsx`

Six chips, all `requiresLlm: true`, added after existing `ADMIN_CHIPS`:

```js
const PINGONE_ADMIN_CHIPS = [
  { id: 'p1_list_apps',          label: 'List all apps',               message: 'List all applications in our PingOne environment' },
  { id: 'p1_list_envs',          label: 'List environments',           message: 'Show all environments I have access to in PingOne' },
  { id: 'p1_services_enabled',   label: 'What services are enabled?',  message: 'What services are enabled in our PingOne environment?' },
  { id: 'p1_identity_count',     label: 'Identity count this week',    message: 'How many identities are in our PingOne environment?' },
  { id: 'p1_ai_agent_config',    label: 'Show Demo AI Agent config',   message: 'Get the configuration for the Demo AI Agent application in PingOne' },
  { id: 'p1_verify_apps',        label: 'Verify all 8 demo apps',      message: 'Confirm all 8 demo apps exist in PingOne: Demo Admin App, Demo User App, Demo MCP Server, Demo Worker, Demo MCP Exchanger, Demo MCP Gateway, Demo Agent, Demo AI Agent' },
];
```

### 2. New chip section — `BankingChips.jsx`

Rendered below the existing "Admin Actions" section, gated on `user?.role === 'admin'`. Uses distinct blue-tinted CSS classes `banking-chips-dropdown__section--pingone` and `banking-chips-dropdown__button--pingone` to visually separate from banking chips. Includes a section label "PingOne Admin" and a small "MCP" text badge.

Chip clicks fire `handleChipClick(chip, true)` — `requiresLlm: true`.

### 3. `PINGONE_ADMIN_CHIP_IDS` set — chip routing marker

In `BankingAgent.js`, when `requiresLlm` is true and the chip id matches `PINGONE_ADMIN_CHIP_IDS`, the NL post body includes `provider: "pingone-admin"`. Non-PingOne LLM chips continue to use `activeLlmProvider` as before.

Implementation: `BankingChips.jsx` exports `PINGONE_ADMIN_CHIP_IDS` (a `Set` of the 6 chip IDs). `BankingAgent.js` imports it and checks `PINGONE_ADMIN_CHIP_IDS.has(chip.id)` in the chip click handler.

### 4. `provider: "pingone-admin"` handling — `bankingAgentLangGraphService.js`

In `processAgentMessage`, before the reason loop, detect `provider === 'pingone-admin'`:

```js
if (provider === 'pingone-admin') {
  const toolSchemas = await buildPingOneAdminToolSchemas();
  const loopResult = await runReasonLoop({
    messages: [{ role: 'user', content: message }],
    tools: toolSchemas,
    provider: resolvedLlmProvider,   // actual LLM (anthropic/helix/ollama)
    model,
    helixConfig: ...,
    ollamaBaseUrl: ...,
    anthropicApiKey: ...,
    maxIterations: MAX_TOOL_ITERATIONS,
    executeTool: async (name, args) => executePingOneTool(name, args),
  });
  // format and return
}
```

`buildPingOneAdminToolSchemas()` calls `mcpPingOneStdioAdapter.listTools()` (added to adapter — see §5) and converts the MCP tool descriptors to the JSON Schema shape `runReasonLoop` expects.

`executePingOneTool(name, args)` calls `mcpPingOneStdioAdapter.callToolViaStdio(name, args, null)`.

Both helpers live in `bankingAgentLangGraphService.js` alongside the existing banking helpers.

### 5. `listTools()` — `mcpPingOneStdioAdapter.js`

Add a `listTools()` export that sends `tools/list` JSON-RPC to the stdio process and returns the array of tool descriptors. The existing `callToolViaStdio` already manages process lifecycle; `listTools` reuses the same `_sendRequest` internal. Tool list is cached in module-level variable for the process lifetime.

```js
module.exports = { callToolViaStdio, listTools };
```

### 6. CSS — `BankingChips.css`

Two new rules (appended, no existing rules touched):

```css
.banking-chips-dropdown__section--pingone .banking-chips-dropdown__label {
  color: #6b8cff;
}
.banking-chips-dropdown__button--pingone {
  background: #0f1a3a;
  border-color: rgba(107, 140, 255, 0.27);
  color: #a0b4ff;
}
.banking-chips-dropdown__button--pingone:hover:not(:disabled) {
  background: #1a2a4a;
  border-color: rgba(107, 140, 255, 0.5);
}
```

---

## Data flow

```
User (admin) clicks "List all apps" chip
  → BankingChips.jsx: handleChipClick({ id: 'p1_list_apps', message: '...', label: '...' }, true)
  → BankingAgent.js: onChipClick({ message, label, requiresLlm: true })
  → PINGONE_ADMIN_CHIP_IDS.has('p1_list_apps') === true
  → POST /api/banking-agent/nl { message, provider: 'pingone-admin' }
  → bankingAgentNl.js → parseNaturalLanguage (provider='pingone-admin' passes through)
  → processAgentMessage({ message, provider: 'pingone-admin', ... })
  → buildPingOneAdminToolSchemas() — lists tools from pingone-mcp-server via stdio
  → runReasonLoop(:3006) — LLM reasons over PingOne tool schemas, picks tool
  → executePingOneTool('list_applications', {}) — callToolViaStdio(...)
  → pingone-mcp-server stdio → PingOne Management API → result
  → runReasonLoop returns final text reply
  → response JSON → BankingAgent.js → chat message displayed
```

---

## Error handling

- **pingone-mcp-server not installed / not on PATH**: `callToolViaStdio` throws; `executePingOneTool` catches and returns `{ error: 'pingone_mcp_unavailable', message: 'PingOne MCP server is not available.' }`. Reason loop surfaces this as a tool error; LLM formulates an error reply.
- **Admin not logged in to PingOne (token expired)**: `pingone-mcp-server` will respond with an auth error JSON-RPC result. Same path — tool error → LLM error reply.
- **No LLM configured**: Same as existing chips — returns `buildCatalogMessage()` (heuristic floor) telling user no LLM is configured.

---

## What does NOT change

- Heuristic parser (`nlIntentParser.js`) — no new intents added (these go straight to LLM path)
- Token exchange pipeline — not invoked for PingOne Admin tools
- Existing chip routing — no existing chip IDs, messages, or handlers change
- Admin chip section (banking admin actions) — unchanged
- `BankingAgent.js` NL dispatch code — only a conditional added at chip-click point
- `bankingAgentNl.js` route — passes `provider` through unchanged (already does)

---

## Testing

1. **`mcpPingOneStdioAdapter.listTools()` unit test** (`demo_api_server/tests/mcpPingOneStdioAdapter.test.js` — new file):
   - Mock child process, assert `tools/list` JSON-RPC sent, returns parsed tool array.
   - Cached on second call (process not re-spawned).

2. **`buildPingOneAdminToolSchemas()` unit test** (inline in `bankingAgentLangGraphService.test.js` if it exists, or a new focused test):
   - Mock `listTools()` returning 2 tools, assert schema shape matches `runReasonLoop` expectation.

3. **Manual smoke test**: With `pingone-mcp-server` installed and PingOne token cached, click "List all apps" chip as admin user → response shows PingOne applications list.

---

## Files changed

| File | Change |
|---|---|
| `demo_api_ui/src/components/BankingChips.jsx` | Add `PINGONE_ADMIN_CHIPS` array, new section render, export `PINGONE_ADMIN_CHIP_IDS` |
| `demo_api_ui/src/components/BankingChips.css` | Add 3 new CSS rules for PingOne section |
| `demo_api_ui/src/components/BankingAgent.js` | Import `PINGONE_ADMIN_CHIP_IDS`, set `provider: 'pingone-admin'` when chip is in set |
| `demo_api_server/services/mcpPingOneStdioAdapter.js` | Add `listTools()` export with module-level cache |
| `demo_api_server/services/bankingAgentLangGraphService.js` | Add `provider === 'pingone-admin'` branch, `buildPingOneAdminToolSchemas()`, `executePingOneTool()` |
| `demo_api_server/tests/mcpPingOneStdioAdapter.test.js` | New test file for `listTools()` |
