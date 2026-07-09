# Component Inventory (scoped)

| Component | Path | Role for pilot |
|-----------|------|----------------|
| BankingToolRegistry | demo_mcp_server/src/tools/BankingToolRegistry.ts | Register `get_account_nickname` |
| TOOL_SCOPES | demo_mcp_server/src/tools/toolScopeMap.ts | Scope for TX / tools/list filter |
| accountHandlers | demo_mcp_server/src/tools/handlers/accountHandlers.ts | Likely home for nickname handler |
| BankingToolProvider | demo_mcp_server/src/tools/BankingToolProvider.ts | Dispatch to handler |
| BankingAPIClient | demo_mcp_server/src/banking/ | BFF HTTP client |
| AIAgent | demo_api_ui/src/components/AIAgent.js | Chip click + Direct MCP formatting |
| Vertical manifests | demo_api_server/config/verticals/*/manifest.json | Chip lists per vertical |
| REGRESSION_PLAN | REGRESSION_PLAN.md | Do-not-break contract |

## Existing similar tools
- `get_my_accounts` — full account list (includes names)
- `get_account_balance` — balance by account
- Pilot tool should be narrower: nickname/display name only for a given accountId
