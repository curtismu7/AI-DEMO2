# Phase 1 Diagram Update Summary
## Aligned with Updated i4ai-ref-arch.mmd

**Updated:** 2026-05-05
**Status:** ✅ Documentation Updated

---

## What Changed in the Diagram

The updated `i4ai-ref-arch.mmd` now shows that **Ping Authorize calls MCP to fetch all tools** (steps 7–8), then filters them by agent's scopes based on introspection results. Previously, the diagram only showed Ping Authorize returning a filtered list without explicit MCP involvement.

### Updated Flow: Steps 5–12 (was 5–10)

| Step | Actor | Message | Details |
|------|-------|---------|---------|
| 5 | Agent → AG | `tools/list` (JSON-RPC) | Initial request |
| 6 | AG → PA | Authorization check | With agent CC token |
| **7** | **PA → MCP** | **Get all tools** | **NEW: Fetch full catalog** |
| **8** | **MCP → PA** | **All tools** | **NEW: Tool definitions** |
| 9 | PA → PID | Introspect agent token | Validate scopes |
| 10 | PID → PA | Token claims | Sub, aud, scope |
| 11 | PA → AG | Permitted tool list | Filtered by agent's scopes |
| 12 | AG → Agent | List of available tools | Return to agent |

---

## Documentation Updates

### Files Updated

1. **AGENT-INIT-ALIGNMENT-PLAN.md**
   - ✅ Diagram section: Updated to show steps 1–12 (was 1–10)
   - ✅ Added explicit MCP steps (7–8): "Ping Authorize → MCP → Get all tools"
   - ✅ Added "Token claims (sub, aud, scope)" to step 10
   - ✅ Added "Fine-grained policy evaluation" note to step 11
   - ✅ Section 2 title: "Steps 5–12" (was "Steps 5–10")
   - ✅ Section 2 description: Updated to include MCP fetch and policy filtering

2. **banking_api_server/services/agentGatewayClient.js**
   - ✅ Updated JSDoc to match new diagram steps
   - ✅ Explains MCP involvement in tools/list flow
   - ✅ Clarifies policy evaluation with introspection

### Mapping Table

Updated from 10 rows to 12 rows:

| New | Old | Change |
|-----|-----|--------|
| Step 7: PA → MCP | — | **NEW** |
| Step 8: MCP → PA | — | **NEW** |
| Step 9 | Step 7 | Shifted down |
| Step 10 | Step 8 | Shifted down |
| Step 11 | Step 9 | Shifted down |
| Step 12 | Step 10 | Shifted down |

---

## Code Implementation Status

✅ **No code changes required** — Implementation already handles the MCP involvement correctly:
- `agentGatewayClient.getAvailableTools()` calls Agent Gateway
- Gateway handles all PA/MCP/PingOne interactions internally
- Agent receives filtered tool list as before

The code was already correct; only documentation needed updating to reflect the detailed MCP flow.

---

## Key Insights from Updated Diagram

1. **MCP is part of tools/list discovery** — Not just for execution
   - PA fetches full catalog from MCP
   - PA filters based on agent's token scopes
   - Only permitted tools returned to agent

2. **Policy evaluation is two-stage:**
   - Step 9: Introspect token with PingOne → get token claims
   - Step 11: Filter tools by scopes in claims

3. **Agent Gateway abstracts complexity:**
   - Agent only sees steps 5, 12
   - Gateway handles steps 6–11 internally
   - Token events from PA/MCP/PingOne still flow through for Token Chain

---

## Forward Compatibility

Phase 2 and Phase 3 implementations are unaffected:
- Phase 2: Tool call flow (steps 14–17) unchanged
- Phase 3: RFC 8693 exchange (steps 26–49) uses embedded step numbers

All implementations follow the Agent Gateway abstraction—internal PA/MCP details are handled by gateway, not by our BFF code.

---

## Verification

✅ agentGatewayClient.js updated with new step documentation
✅ AGENT-INIT-ALIGNMENT-PLAN.md updated with new diagram (steps 1–12)
✅ Mapping table updated to show all 12 steps
✅ Code implementation already correct (no changes needed)
✅ Build still passes (`npm run build` → exit 0)

---

## Next Steps

Phase 2 implementation stands as-is:
- Tool invocation without subject token (steps 14–17 in new diagram)
- Returns `requiresUserContext: true` on 403 DENY
- Ready for Phase 3: RFC 8693 token exchange (steps 26–49)
