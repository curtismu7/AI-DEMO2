# Vertical Tools Registry — Generator Fix

**Branch:** `worktree-vertical-tools-gen`
**Date:** 2026-06-20

## Symptom

New verticals (**manufacturing / government / university**) returned **no results**
when their chips were clicked. The agent/gateway responded `Unknown tool: "…"`.
Feature pages (`show_work_order` / `show_permit` / `show_enrollment`) worked; the
generic action chips (`view_machines`, `view_inspections`, `view_financial_aid`, …)
did not.

It was **not** a bootstrap or PingOne-provisioning problem, and a plain image
rebuild did not fix it — the registration source itself was missing.

## Root cause

A chip's tool call travels: **frontend → BFF (vertical plugin) → MCP gateway → MCP server**.
For a tool to resolve, it must be registered downstream in two places:

1. `demo_mcp_server/src/tools/handlers/verticalHandlers.ts` → `VERTICAL_TOOLS`
   (the MCP server exposes the tool and relays it to the BFF executor)
2. `scope-topology.json` → `tools{}` (the gateway authorizes it)

`VERTICAL_TOOLS` was a **hand-maintained list** with a "keep in sync with
`config/verticals/<id>/tools.js`" comment. It had drifted badly:

| | tools defined in plugins | registered in `VERTICAL_TOOLS` |
|---|---|---|
| before | ~150 (non-banking) | **25** |

So the 3 new verticals (0 of ~75 tools registered) **and** the intent-pack
expansions of existing verticals (retail/sporting-goods/workforce/healthcare)
were all unregistered → "Unknown tool".

## Fix — generate the registry from the plugins

`tools.js` is already the runtime source of truth, so the registry is now
**derived** from it instead of hand-maintained.

### New: `scripts/gen-vertical-tools.js`

Enumerates every non-banking vertical's `plugin.getTools()` and writes two outputs:

- **`demo_mcp_server/src/tools/handlers/verticalTools.generated.ts`** — the typed
  `VERTICAL_TOOLS` array the MCP server exposes. `verticalHandlers.ts` now imports
  this instead of an inline literal.
- **`scope-topology.json` `tools{}`** entries (add-only): `requiredScopes` from the
  tool's `scopes`, `surface:"gateway"`, and `challengeType` from `authz`
  (`stepUp → step_up`, `consent → consent`).

### Curation rules (match the old hand list)

- **Banking excluded** — its tools are core, registered directly in
  `BankingToolRegistry`, not relayed through the generic vertical handler.
- Per vertical, the **featurePage tool** (`manifest.featurePage.mcpTool`) and the
  **demo tools** (`api_key_demo`, `dual_token_demo`) are excluded — they are
  registered on their own api-key path. (This is why each vertical lands on the
  canonical **25** generic tools: e.g. manufacturing's 27 = 25 + 2 demo.)
- Everything else a plugin returns is included (including `sensitive_*`).

### Shared tool names → cross-vertical

MCP tool names are globally unique, so a name defined by **more than one** vertical
collapses to a single registry entry. Five names are shared
(`cancel_appointment`, `view_documents`, `view_billing`, `cancel_order`,
`close_support_ticket`). These are emitted **cross-vertical** (no `vertical` tag) so
the gateway's per-vertical `tools/list` filter passes them for **every** owner — the
BFF still runs the **active** vertical's implementation by name. Uniquely-named tools
keep their `vertical` tag so `AllowedVertical` correctly hides foreign tools.

## Safety / verification

- **0-drop invariant:** every one of the old 25 hand-list tools is still present;
  **no scope changes**; parameterized `inputSchema`s preserved.
- **No collisions** with core `BankingToolRegistry` tool names (no duplicate registration).
- `scope-topology.json` stays valid JSON; the serializer is shared
  (`scripts/lib/stringify-topology.js`) so `gen-scope-topology.js` and
  `gen-vertical-tools.js` can't drift in formatting and thrash the file.
- TypeScript compiles clean; rebuilt + recreated `mcp-server` / `mcp-gateway` —
  the **live registry now exposes 194 tools** (was ~47), including the new verticals.

## How to use going forward

Adding or changing a vertical's tools now needs **no hand-edit** to the MCP
registry or scope-topology:

```bash
cd demo_api_server
npm run verticals:gen     # regenerate verticalTools.generated.ts + scope-topology.json
npm run verticals:check   # CI guard — fails if either output drifts from the plugins
```

`vertical-tools:gen` / `vertical-tools:check` run the new generator on its own;
both are also wired into the combined `verticals:gen` / `verticals:check`.

After regenerating, rebuild the MCP server + gateway images so the new tools are
served (no `pingone:bootstrap` required unless a tool needs a brand-new PingOne scope):

```bash
COMPOSE_PROJECT_NAME=ai-demo docker compose build mcp-server mcp-gateway
COMPOSE_PROJECT_NAME=ai-demo docker compose up -d --force-recreate mcp-server mcp-gateway
```

## Files

| File | Change |
|---|---|
| `scripts/gen-vertical-tools.js` | **new** — the generator (both outputs, `check`/`generate` modes) |
| `scripts/lib/stringify-topology.js` | **new** — shared scope-topology house-style serializer |
| `scripts/gen-scope-topology.js` | use the shared serializer |
| `demo_mcp_server/src/tools/handlers/verticalTools.generated.ts` | **new** — generated `VERTICAL_TOOLS` (167 tools) |
| `demo_mcp_server/src/tools/handlers/verticalHandlers.ts` | consume the generated list (no more hand list) |
| `scope-topology.json` | +142 generic vertical tool entries (generated, add-only) |
| `demo_api_server/package.json` | `vertical-tools:gen/check` + wired into `verticals:gen/check` |
