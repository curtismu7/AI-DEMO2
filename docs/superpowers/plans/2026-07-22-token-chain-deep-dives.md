# Token Chain — deep digs (step-up → RS HTTP → UC why)

**Date:** 2026-07-22  
**Branch:** `feat/token-chain-gap-fill` (PR #738)  
**Surface:** `buildTraceSteps` + gateway audit / MCP `_meta`

## Scope (all nine) — done

| # | Dig | Approach | Status |
|---|-----|----------|--------|
| 1 | Step-up / HITL / CIBA | Enrich `stepup` from HITL phases + challenge fields | ✅ |
| 2 | DPoP + RAR | First-class `dpop` + `rar` steps from existing events | ✅ |
| 3 | Two-exchange | Exchange step shows hop #1 + final nested `act` | ✅ |
| 4 | Token refresh | First-class `refresh` from `token-refresh` | ✅ |
| 5 | mTLS | First-class `mtls` from `gw-mtls` (out of gateway kv) | ✅ |
| 6 | Dual-token | First-class `dual-token` when `credentialPath===dual_token` | ✅ |
| 7 | Full filter chain | Expand Node/PingGateway `filterChain` on success | ✅ |
| 8 | RS HTTP | Prefer `_meta.resourceRequest`; stamp on api_key / dual_token / bankingdata / WS oauth | ✅ |
| 9 | Per-UC why | Append `UC_WHY[useCaseId]` onto key step `why` lines | ✅ |

## Verify

```bash
cd demo_api_ui && npm test -- --run src/services/tokenChainTrace/__tests__/buildTraceSteps.test.js
cd demo_api_ui && npm run build
cd demo_mcp_gateway && npm test -- --testPathPattern='authzProvenanceGaps'
```
