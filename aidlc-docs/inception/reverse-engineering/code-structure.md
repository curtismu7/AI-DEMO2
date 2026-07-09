# Code Structure Notes (scoped)

## MCP tool registration pattern
- Static registry map on `BankingToolRegistry`
- Fields: name, description, inputSchema, requiresUserAuth, requiredScopes, handler, readOnly, optional vertical/outputSchema
- Handlers live in `handlers/*.ts` and are referenced by method name string

## Actions chips
- Per-vertical must-have Actions sets (see docs/planning/PLAN-mcp-format-and-vertical-chips.md)
- Direct MCP chip teaches raw tools/call; success path should use human-readable formatting
- Chip labels: plain text / allowlisted glyphs only (no decorative emoji)

## Adaptive reverse-eng note
Full monorepo reverse engineering deferred. Artifacts cover only the path needed
for this pilot. Re-run reverse engineering if Construction expands into auth,
gateway policy, or new verticals.
