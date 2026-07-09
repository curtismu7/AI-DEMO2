# Units of Work

## U01 — MCP get_account_nickname
- **Stories**: US-02, US-03, US-04 (server side), US-05 (MCP tests)
- **Deliverables**: Registry entry, scope map, handler, provider wire, unit tests
- **Packages**: `demo_mcp_server` only

## U02 — UI Account nickname chip
- **Stories**: US-01, US-04 (UI side), US-05 (UI assertion)
- **Deliverables**: Chip in `agentActions.js`, Direct MCP membership, formatter hook if needed
- **Packages**: `demo_api_ui` only
- **Depends on**: U01 (tool name stable)

## Deferred
- BFF unit — skipped unless Construction discovers `name` unavailable (then minimal read-only endpoint with explicit approval)
