# Application Design — get_account_nickname

Consolidated design for approved requirements.

## Summary
Add one read-only MCP tool that returns a single nickname string (with fallback), plus an Actions chip that invokes it through the existing Direct MCP path. Reuse `getMyAccounts` on the BFF; no new auth/session code.

## Components
See `components.md`, `component-methods.md`, `services.md`, `component-dependency.md`.

## Key decisions
| Decision | Choice |
|----------|--------|
| Nickname source | `account.name` from existing accounts payload |
| Fallback | Account type + masked last4 (FR-002) |
| Default account | First checking when `account_id` omitted |
| Chip placement | `ACTION_GROUPS.account` + `API_DIRECT_CHIPS` |
| BFF changes | None preferred (NFR-002) |

## Files expected to change (Construction)
- `demo_mcp_server/src/tools/BankingToolRegistry.ts`
- `demo_mcp_server/src/tools/toolScopeMap.ts`
- `demo_mcp_server/src/tools/handlers/accountHandlers.ts`
- `demo_mcp_server/src/tools/BankingToolProvider.ts` (wire method)
- `demo_mcp_server/src/tools/handlers/index.ts` (export if needed)
- `demo_mcp_server` tests under `src/tools/__tests__/`
- `demo_api_ui/src/components/agentActions.js`
- `demo_api_ui/src/components/AIAgent.js` (only if formatter needs tool-specific branch)

## Out of scope
- New BFF routes, session store, TX changes
- Gateway / authz policy edits (tool inherits `read` like other banking reads)
