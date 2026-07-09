# Components

## C1 — NicknameToolHandler (demo_mcp_server)
- **Purpose**: Resolve account and return display nickname string
- **Responsibilities**: Optional accountId resolution; fallback to type+masked; call BFF via BankingAPIClient
- **Location**: `demo_mcp_server/src/tools/handlers/accountHandlers.ts` (new export)

## C2 — BankingToolRegistry entry
- **Purpose**: Advertise `get_account_nickname` to MCP clients
- **Responsibilities**: inputSchema, readOnly, scopes, handler binding, outputSchema if needed
- **Location**: `demo_mcp_server/src/tools/BankingToolRegistry.ts`

## C3 — Tool scope map
- **Purpose**: Least-privilege scope for TX
- **Location**: `demo_mcp_server/src/tools/toolScopeMap.ts`

## C4 — BankingToolProvider dispatch
- **Purpose**: Route `get_account_nickname` to handler
- **Location**: `demo_mcp_server/src/tools/BankingToolProvider.ts`

## C5 — Actions chip catalog
- **Purpose**: Expose chip in account group + Direct MCP set
- **Location**: `demo_api_ui/src/components/agentActions.js` (`ACTION_GROUPS.account`, `API_DIRECT_CHIPS`)

## C6 — AIAgent chip runner / formatter
- **Purpose**: Map chip id → tool call; format nickname in chat
- **Location**: `demo_api_ui/src/components/AIAgent.js` (minimal: chip id mapping + formatResult branch if needed)
