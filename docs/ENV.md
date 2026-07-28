# Environment Variables Reference

## Quick Start

Copy `demo_api_server/.env` to your deployment. All secrets are required.

## Credential Variables (PingOne Apps)

### Core Apps

- **User App**: `PINGONE_USER_CLIENT_ID` + `PINGONE_USER_CLIENT_SECRET`
  - Used by: BFF OAuth flow for end-user login

- **Admin App**: `PINGONE_ADMIN_CLIENT_ID` + `PINGONE_ADMIN_CLIENT_SECRET`
  - Used by: BFF admin login & dashboard backend

- **MCP Gateway**: `PINGONE_MCP_GATEWAY_CLIENT_ID` + `PINGONE_MCP_GATEWAY_CLIENT_SECRET`
  - Used by: MCP Gateway client credentials flow

- **Token Exchanger**: `PINGONE_TOKEN_EXCHANGER_CLIENT_ID` + `PINGONE_TOKEN_EXCHANGER_CLIENT_SECRET`
  - Used by: RFC 8693 token exchange (Step 1 of Two-Exchange flow)

- **AI Agent Actor**: `PINGONE_AI_AGENT_ACTOR_CLIENT_ID` + `PINGONE_AI_AGENT_ACTOR_CLIENT_SECRET`
  - Used by: AI Agent OAuth actor for A2A delegation

- **Agent**: `PINGONE_AGENT_CLIENT_ID` + `PINGONE_AGENT_CLIENT_SECRET`
  - Used by: Agent service authentication

- **Worker**: `PINGONE_WORKER_CLIENT_ID` + `PINGONE_WORKER_CLIENT_SECRET`
  - Used by: Token introspection worker

### A2A Specialist Agents (8 verticals)

- **Investment Advisor**: `PINGONE_A2A_INVESTMENT_AGENT_CLIENT_ID` + `PINGONE_A2A_INVESTMENT_AGENT_CLIENT_SECRET`
- **Records Specialist**: `PINGONE_A2A_RECORDS_AGENT_CLIENT_ID` + `PINGONE_A2A_RECORDS_AGENT_CLIENT_SECRET`
- **Purchase Specialist**: `PINGONE_A2A_PURCHASE_AGENT_CLIENT_ID` + `PINGONE_A2A_PURCHASE_AGENT_CLIENT_SECRET`
- **Membership Specialist**: `PINGONE_A2A_MEMBERSHIP_AGENT_CLIENT_ID` + `PINGONE_A2A_MEMBERSHIP_AGENT_CLIENT_SECRET`
- **Payroll Specialist**: `PINGONE_A2A_PAYROLL_AGENT_CLIENT_ID` + `PINGONE_A2A_PAYROLL_AGENT_CLIENT_SECRET`
- **Tax Records Specialist**: `PINGONE_A2A_TAX_AGENT_CLIENT_ID` + `PINGONE_A2A_TAX_AGENT_CLIENT_SECRET`
- **Financial Aid Specialist**: `PINGONE_A2A_FINAID_AGENT_CLIENT_ID` + `PINGONE_A2A_FINAID_AGENT_CLIENT_SECRET`
- **Holdings Specialist**: `PINGONE_A2A_HOLDINGS_AGENT_CLIENT_ID` + `PINGONE_A2A_HOLDINGS_AGENT_CLIENT_SECRET`

## Resource URIs (Non-Secret Config)

| URI Variable | Value | Purpose |
|---|---|---|
| `PINGONE_RESOURCE_MCP_GATEWAY_URI` | `mcpgateway.ping.demo` | MCP Gateway audience (token exchange target) |
| `PINGONE_RESOURCE_MCP_SERVER_URI` | `mcpserver.ping.demo` | MCP Server audience |
| `PINGONE_RESOURCE_AGENT_GATEWAY_URI` | `agentgateway.ping.demo` | Agent Gateway audience (Two-Exchange Step 1) |
| `PINGONE_RESOURCE_MCP_INVEST_URI` | `mcp-invest.ping.demo` | Investment vertical MCP scope target |
| `PINGONE_RESOURCE_JWT_VERIFIER_URI` | `mcp-jwt-verifier.ping.demo` | JWT diagnostic tool resource |
| `PINGONE_RESOURCE_A2A_INTERMEDIATE_<VERTICAL>_URI` | `a2a-intermediate-<vertical>.ping.demo` | A2A Delegation intermediary (per specialist) |

## Cleanup Notes (2026-07-28)

**Removed duplicates:**
- ✅ `GW_INTROSPECTION_CLIENT_ID/SECRET` → consolidated into `PINGONE_TOKEN_EXCHANGER_*`
- ✅ `AGENT_CLIENT_ID/SECRET` → renamed to `PINGONE_AGENT_CLIENT_*`

**Consolidated resource URIs:**
- ✅ `MCP_RESOURCE_URI`, `MCP_SERVER_RESOURCE_URI`, `MCP_GW_RESOURCE_URI`, `PINGONE_RESOURCE_TWO_EXCHANGE_URI` → single `PINGONE_RESOURCE_MCP_GATEWAY_URI`
- ✅ `A2A_INTERMEDIATE_AUDIENCE_*` → renamed to `PINGONE_RESOURCE_A2A_INTERMEDIATE_*_URI`

**Result:** 105 lines → ~85 lines, zero duplication, app mappings clear from .env comments.

## Adding New Apps

Follow these patterns:

1. **New PingOne app credentials:**
   ```
   PINGONE_<APP_SHORTHAND>_CLIENT_ID=<value>
   PINGONE_<APP_SHORTHAND>_CLIENT_SECRET=<value>
   ```
   Example: `PINGONE_NEW_SERVICE_CLIENT_ID` for a service called "New Service"

2. **New resource URIs:**
   ```
   PINGONE_RESOURCE_<SERVICE>_URI=<uri.ping.demo>
   ```
   Example: `PINGONE_RESOURCE_NEW_SERVICE_URI=new-service.ping.demo`
