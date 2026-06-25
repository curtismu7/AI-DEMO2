# OAuth Scope Reference — Super Banking Demo

Canonical scope names (Phase 146). Must exactly match the strings issued by PingOne.

---

## Scope Definitions

| Scope | What the user can do |
|---|---|
| `openid` | Authenticate — establishes identity, required for all login flows |
| `profile` | Read name, username, locale from the ID token |
| `email` | Read email address from the ID token |
| `offline_access` | Get a refresh token — stay logged in across sessions without re-authenticating |
| `banking:read` | **View accounts & transactions** — balances, account list, transaction history, investment portfolios, search users; required for all read-only MCP tools (`get_my_accounts`, `get_my_transactions`, `get_investment_balance`, etc.) |
| `banking:write` | **Move money & change data** — create deposits, withdrawals, transfers; create/update/delete users; all `banking:read` operations are also permitted |
| `banking:admin` | **Admin panel** — view system stats, look up any user's transactions, audit activity logs, manage other users; requires admin role in addition to this scope |
| `banking:sensitive` | **Sensitive account details** — PAN, routing numbers, or other data gated behind PingOne Authorize policy + session consent token; requires an extra policy evaluation step |
| `banking:ai:agent` | **Invoke the AI agent** — allows the user's token to be delegated to the agent service via RFC 8693; without this the BFF rejects agent chat requests |
| `banking:mcp:invoke` | **Call MCP tools** — required on the token that reaches the MCP server; issued by the token exchange chain; end-users don't request this directly, it is obtained by the exchanger app on the user's behalf |
| `banking:transfer` | **Transfers specifically** — `create_transfer` requires this plus `banking:write`; scoped narrowly so write-only apps cannot transfer without explicit consent |

---

## MCP Tool → Required Scopes

Defined in `banking_mcp_gateway/src/auth/toolScopes.ts`.

| Tool | Required scopes | HITL challenge type |
|---|---|---|
| `get_my_accounts` | `banking:read` | consent |
| `get_account_balance` | `banking:read` | consent |
| `get_sensitive_account_details` | `banking:read` | consent |
| `get_my_transactions` | `banking:read` | consent |
| `query_user_by_email` | `banking:read` | consent |
| `sequential_think` | `banking:read` | consent |
| `get_investment_balance` | `banking:read` | consent |
| `get_investment_accounts` | `banking:read` | consent |
| `get_portfolio_summary` | `banking:read` | consent |
| `create_deposit` | `banking:write` | **step_up** |
| `create_withdrawal` | `banking:write` | **step_up** |
| `create_transfer` | `banking:write`, `banking:transfer` | **step_up** |

---

## Typical Token Scopes by User Role

| User type | Scopes issued at login |
|---|---|
| Regular customer | `openid profile email offline_access banking:read banking:write banking:ai:agent` |
| Admin | `openid profile email offline_access banking:read banking:write banking:admin banking:sensitive banking:ai:agent` |
| Agent exchanger (service, client credentials) | `banking:read banking:write banking:mcp:invoke` |

---

## Legacy Scope Aliases

PingOne may issue older scope names that map to the canonical names above.

| Old scope | Maps to |
|---|---|
| `ai_agent` | `banking:ai:agent` |
| `banking:accounts:read` | `banking:read` |
| `banking:accounts:write` | `banking:write` |
| `banking:transactions:read` | `banking:read` |
| `banking:transactions:write` | `banking:write` |
| `banking:ai:agent:read` | `banking:ai:agent` |
| `banking:agent:invoke` | `banking:ai:agent` |
| `banking:mcp:tools` | `banking:mcp:invoke` |
