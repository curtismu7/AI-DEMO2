# MCP Tool Metadata Audit

Date: 2026-04-17
Phase: 145

## Objective

Ensure MCP tool discovery metadata is complete and consistent from registry to `tools/list`, so downstream clients and agents can rely on server-advertised contracts.

## Contract

Canonical metadata source:
- `banking_mcp_server/src/tools/BankingToolRegistry.ts`

`tools/list` response contract (per tool):
- `name`
- `title` (if defined)
- `description`
- `inputSchema`
- `icons` (if defined)
- `annotations` (if defined)
- `requiresUserAuth`
- `requiredScopes`
- `readOnly` (backward-compatible extension currently consumed by existing clients)

## Findings

1. Registry already defined richer metadata (`title`, `icons`, `annotations`) but `tools/list` mapped only a subset.
2. Tests did not explicitly enforce richer metadata propagation in the list contract.
3. Registry baseline tests were stale vs current tool inventory and metadata shape.

## Remediation in Phase 145

1. `MCPMessageHandler.handleListTools()` now maps richer registry metadata to list responses.
2. `MCPMessageHandler` tests now verify expected metadata keys are preserved.
3. `BankingToolRegistry` tests now reflect current tool inventory and metadata expectations.

## Verification Checklist

- `cd banking_mcp_server && npm run test -- tests/server/MCPMessageHandler.test.ts --runInBand`
- `cd banking_mcp_server && npm run test -- tests/tools/BankingToolRegistry.test.ts --runInBand`
- Manual spot-check of one tool in `tools/list` includes title/icons/annotations when present.

## Future Guardrails

- Add/update tests whenever registry fields are added or removed.
- Treat `BankingToolRegistry` as the single source of truth for list metadata.
- Keep `tools/list` backward-compatible while extending metadata.
