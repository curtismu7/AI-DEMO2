# Services

## S1 — Banking API client (existing)
- **Service**: `BankingAPIClient.getMyAccounts(token)`
- **Orchestration**: Nickname handler calls this once per tool invocation; no new BFF endpoint

## S2 — MCP gateway (existing, unchanged)
- **Service**: Proxies `tools/call` after authz
- **Orchestration**: Picks up new tool from `tools/list` automatically when registered

## S3 — BFF session / TX (existing, untouched)
- **Constraint**: No new session or token-exchange code paths (NFR-001)
