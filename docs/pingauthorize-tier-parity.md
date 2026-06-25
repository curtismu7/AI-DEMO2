# PingAuthorize tier enforcement parity

**Date added:** 2026-06-22  
**Companion to:** `docs/pingauthorize-policy-parity.md` (audience-match rule)  
**Related code:** 
- `demo_api_server/services/simulatedAuthorizeService.js` (UC21 tier enforcement)
- `demo_api_server/services/tierResolver.js` (vertical-aware tier config)
- `demo_api_server/config/verticals/banking/manifest.json` (tier definitions)

## Why this doc exists

The Super Banking demo enforces **entitlement tiers** (UC21) in two parallel implementations:

| Implementation | Active | Tier logic |
|---|---|---|
| `simulatedAuthorizeService` | `ff_authorize_simulated=true` | In-process JS: maxAmount ceiling, restrictedTools list |
| `PingOne Authorize` | `ff_authorize_simulated=false` | Trust Framework policy rules (cloud) |

Both must produce **identical decisions** for tier-gated requests (amount ceiling, tool restrictions).

## The rules to add to PingAuthorize policy

In the Trust Framework policy referenced by `authorize_mcp_decision_endpoint_id`:

### Rule 1: Entitlement tier amount ceiling

```
IF amount > userTierMaxAmount
THEN DENY
WITH advice obligation reason = "tier_amount_exceeded"
```

**Parameters needed:**
- `parameters.UserTierMaxAmount` — from user's group → tier mapping (Standard=$2000, PrivateBanking=$50000)
- `parameters.RequestAmount` — from MCP tool call

**Mapping:**
1. Extract user groups from token claims
2. Map group to tier using tier config from active vertical
3. Look up maxAmountUsd for that tier
4. Compare against requested amount

### Rule 2: Tier-restricted tools

```
IF toolName IN userTier.restrictedTools
THEN DENY  
WITH advice obligation reason = "tier_tool_not_allowed"
```

**Parameters needed:**
- `parameters.ToolName` — the MCP tool being called
- `parameters.UserTier` — resolved from user groups
- `parameters.RestrictedTools` — from tier definition (Standard tier denies create_withdrawal)

**Mapping:**
1. Extract user groups → resolve to tier
2. Look up restrictedTools list for that tier
3. Check if toolName is in the list

## Vertical-aware tier config

As of Task 4, tier definitions live in vertical manifests:

```json
{
  "tiers": {
    "default": "Standard",
    "definitions": {
      "Standard": {
        "maxAmountUsd": 2000,
        "restrictedTools": ["create_withdrawal"]
      },
      "PrivateBanking": {
        "maxAmountUsd": 50000,
        "restrictedTools": []
      }
    },
    "groupToTier": {
      "PrivateBanking": "PrivateBanking"
    }
  }
}
```

PingOne Authorize policy must:
1. Load tier config for the active vertical
2. Apply rules above using that config
3. Return identical denial codes and reasons

## Verification

After adding tier rules to PingAuthorize policy:

1. Set `ff_authorize_simulated=false` in `.env`
2. Restart BFF
3. Test high-value transfer ($10,000) as Standard tier user → should DENY with `tier_amount_exceeded`
4. Test create_withdrawal as Standard tier user → should DENY with `tier_tool_not_allowed`
5. Same tests with PrivateBanking user → should PERMIT
6. Flip FF to `true` and repeat — decisions must match

## Implementation status

- ✅ Simulated enforce parity documented
- ✅ Vertical-aware tier config (Task 4)
- ⏳ PingOne Authorize policy rules (manual console work)
- ⏳ Verification tests

## Open items

1. **Trust Framework attributes** — ensure PingOne PA can map:
   - User groups (from token)
   - Vertical ID (from request context)
   - Tool name (from request)
   - Request amount (from MCP call)

2. **Policy provisioning** — no Management API for writing Trust Framework policies yet (as of 2026-05-13). Rules must be added manually in PingOne Console.

3. **Multi-vertical support** — once second vertical adds tier config, policy must handle both. May require:
   - Dynamic tier lookup (vertical-aware)
   - OR separate policies per vertical + routing logic
