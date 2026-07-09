# Business Overview (scoped)

## Business Description
Super Banking demo: AI agents access banking data on behalf of a user via PingOne
authentication and RFC 8693 token exchange, with MCP tools and UI Actions chips
for teaching / demo flows.

## Business Transactions (relevant)
- Read account list / balance / transactions (delegated MCP)
- Write deposit / withdrawal / transfer (often HITL-gated)
- Vertical-specific actions (workforce, healthcare, retail, etc.)
- Direct MCP chip: typed `tools/call` without full agent NL loop

## Pilot intent
Expose a **display nickname** for an account as a dedicated read-only tool + chip,
without changing token exchange or session semantics.

## Component Level (in scope)
### demo_mcp_server
- **Purpose**: Banking MCP tool surface
- **Responsibilities**: Register tools, validate scopes/`act`, call BFF

### demo_api_server
- **Purpose**: BFF / banking API
- **Responsibilities**: Account data source for MCP handlers

### demo_api_ui
- **Purpose**: Demo UI including Actions chips
- **Responsibilities**: Chip → NL/heuristic or Direct MCP → formatted result

### demo_mcp_gateway
- **Purpose**: Token-enforcing MCP sidecar
- **Responsibilities**: Authn/authz before tool execution
