# Operator Guide — Vertical PingOne Authorize Group Policy

Use this when enabling **live** PingOne Authorize (not simulated) with `ff_authorize_group_policy`.

## Trust Framework parameters (already sent by BFF)

The BFF pre-resolves scalars for the snapshot DSL (no array-contains):

| Parameter | Meaning |
|---|---|
| `RequiredGroup` | PingOne group name for the restricted tool |
| `InRequiredGroup` | `true` / `false` — user in that group |
| `UserTier` | Entitlement tier (`Standard`, `PrivateBanking`, …) |

Do **not** add `UserGroups` as an array — PingOne returns `INVALID_VALUE`.

## Per-vertical group names (provisioned by bootstrap)

| Vertical | Privileged group | Delegates | Premium tier |
|---|---|---|---|
| banking | `Banking_Privileged` | `Banking_Delegates` | `Banking_PremiumTier` |
| healthcare | `Healthcare_Privileged` | `Healthcare_Delegates` | — |
| retail | `Retail_Privileged` | `Retail_Delegates` | — |
| sporting-goods | `SportingGoods_Privileged` | `SportingGoods_Delegates` | — |
| workforce | `Workforce_Privileged` | `Workforce_Delegates` | — |

## Sample Authorize rule (UC9 binary deny)

```
IF DecisionContext == "McpFirstTool"
AND RequiredGroup is present
AND InRequiredGroup == false
THEN DENY
```

## Sample tier rule (banking UC21)

```
IF DecisionContext == "McpFirstTool"
AND UserTier == "Standard"
AND ToolName in ["create_withdrawal", "withdraw"]
THEN DENY
```

## Verify

1. **Provision groups** (no full bootstrap required):
   ```bash
   npm run pingone:provision-groups
   # or one vertical:
   node demo_api_server/scripts/provisionVerticalGroups.js --vertical healthcare
   ```
   Or: PingOne MCP Inspector → **Provision groups (API)** (admin).
2. Enable `ff_authorize_group_policy`.
3. Open **PingOne MCP Inspector** → **Vertical group membership** — confirm `Source: pingone` and expected groups.
4. Run group-denial scenario from Agent Demo Guide.

**Note:** The hosted PingOne MCP server has no group/membership tools. Groups are created via the Management API using worker creds from `.env`.
