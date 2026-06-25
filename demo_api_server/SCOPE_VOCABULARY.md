# Scope Vocabulary — Canonical Registry

> **Single source of truth** for all OAuth 2.0 scope definitions in the Super Banking demo.
> Phase 146 (Scope Vocabulary Alignment) — Decision D-02, D-03.

---

## Canonical Scope List

| Scope Name | Type | Description | Resource Server |
|-----------|------|-------------|-----------------|
| `banking:read` | Core | Read-only access to accounts, balances, and transactions | Main Banking API |
| `banking:write` | Core | Write access for deposits, withdrawals, transfers | Main Banking API |
| `banking:admin` | Core | Full administrative access (admin UI, stats, settings) | Main Banking API |
| `banking:sensitive` | Core | Sensitive data access (PII, account details) | Main Banking API |
| `banking:ai:agent` | Core | AI agent delegation marker on banking resource tokens | Main Banking API |
| `banking:mcp:invoke` | Core | Permission to invoke MCP tools (MCP RS only) | MCP Resource Server |
| `ai_agent` | Identity | Agent identity marker (OIDC scope, no RS needed) | OIDC (built-in) |

> **Deprecated — do not create in PingOne or request in code:**
> `banking:accounts:read`, `banking:transactions:read`, `banking:transactions:write`, `banking:agent:invoke`, `banking:ai:agent:read`, `banking:general:read`, `banking:admin:full`
>
> These names were removed in Phase 146. The `Scopes.ACCOUNTS_READ` / `Scopes.TRANSACTIONS_READ` / `Scopes.MCP_TOOLS` constants in `middleware/scopeEnforcement.js` were replaced with `Scopes.READ`, `Scopes.WRITE`, `Scopes.MCP_INVOKE`.

---

## Resource Server Mapping

### Main Banking API

- **Audience URI:** Value of `ENDUSER_AUDIENCE` env var (e.g. `https://resource.pingdemo.com`)
- **PingOne Resource:** Custom resource server — create in PingOne Admin → Resources
- **Scopes issued:** `banking:read`, `banking:write`, `banking:admin`, `banking:sensitive`, `banking:ai:agent`
- **Enforcement:** BFF middleware `requireScopes()` + row-level ownership checks

### MCP Resource Server

- **Audience URI:** Value of `PINGONE_RESOURCE_MCP_SERVER_URI` env var
- **Scopes issued:** `banking:read`, `banking:write`, `banking:mcp:invoke`
- **Purpose:** Narrowed delegated tokens for MCP tool execution (RFC 8693 exchange output)

---

## Route Enforcement Index

Two sources govern route access:
1. **`ROUTE_SCOPE_MAP`** (`config/scopes.js`) — the intended policy, used by `auth.test.js`
2. **Route middleware** — what is actually wired in `routes/*.js` (may differ; see Notes)

| Route | Scope Gate (`requireScopes`) | Additional Gate | Notes |
|-------|------------------------------|-----------------|-------|
| `GET /api/accounts` | `banking:read` | Admin role check (403 for non-admin) | All accounts; non-admin users get 403 even with correct scope |
| `GET /api/accounts/my` | `banking:read` | — | Returns only caller's rows |
| `GET /api/accounts/:id` | `banking:read` | Ownership check | |
| `GET /api/accounts/:id/balance` | `banking:read` | — | |
| `POST /api/accounts` | `banking:write` | Admin role check (403 for non-admin) | |
| `PUT /api/accounts/:id` | `banking:write` | — | |
| `DELETE /api/accounts/:id` | `banking:write` | — | |
| `GET /api/transactions` | `banking:read` | Admin role check (403 for non-admin) | All transactions; non-admin users get 403 |
| `GET /api/transactions/my` | _(none — just auth)_ | Row-level ownership | No `requireScopes()` wired in route. Any authenticated token works |
| `GET /api/transactions/:id` | `banking:read` | — | |
| `POST /api/transactions` | _(none — just auth)_ | **Phase 122 session check** + HITL consent + Step-up MFA | No scope gate. Requires `req.session?.user` (login session, not just Bearer token). Amounts > $500 require HITL consent challenge. Amounts ≥ $250 (configurable) trigger step-up MFA |
| `POST /api/transactions/deposit` | `banking:write` | — | |
| `POST /api/transactions/withdraw` | `banking:write` | — | |
| `POST /api/transactions/transfer` | `banking:write` | — | |
| `PUT /api/transactions/:id` | `banking:write` | — | |
| `DELETE /api/transactions/:id` | `banking:write` | — | |
| `GET /api/admin/*` | `banking:admin` | — | |
| `POST /api/admin/*` | `banking:admin` | — | |
| `PUT /api/admin/*` | `banking:admin` | — | |
| `DELETE /api/admin/*` | `banking:admin` | — | |
| `GET /api/users` | `banking:read` | — | |
| `GET /api/users/me` | `banking:read` | — | |
| `GET /api/users/:id` | `banking:read` | Ownership check | |
| `POST /api/users` | Admin role via `requireAdmin` | — | Scope `banking:write` insufficient alone; admin role required |
| `PUT /api/users/:id` | `banking:write` | — | |
| `DELETE /api/users/:id` | `banking:write` | — | |

### Phase 122 session check on POST /api/transactions

`POST /api/transactions` checks `req.session?.user` before executing. A valid Bearer token alone is not enough — the caller must have a full login session. This affects:
- **API-only callers** (no browser session): will receive `401 unauthenticated`
- **MCP tool calls** that go through the BFF: succeed only when the BFF session carries the delegated user context

---

## User Type Scope Assignments

| User Type | Scopes |
|-----------|--------|
| **Admin** | `banking:admin`, `banking:read`, `banking:write`, `banking:sensitive`, `banking:ai:agent` |
| **Customer** | `banking:read`, `banking:write`, `banking:ai:agent` |
| **Read-only** | `banking:read` |
| **AI Agent** | `ai_agent`, `banking:ai:agent`, `banking:read`, `banking:write` |

Defined in `config/scopes.js` → `USER_TYPE_SCOPES`.

---

## Scope Injection (Demo Mode)

When PingOne resource server is not configured, the BFF can inject banking scopes for demo purposes via feature flag `ff_inject_scopes`:

- **Flag:** `ff_inject_scopes` (configStore / Feature Flags UI)
- **Behavior:** When enabled, if the user token lacks `banking:read`/`banking:write`, the BFF injects them in memory before token exchange
- **Tracking:** Injected scope names stored in `claims.injected_scope_names` array
- **UI:** Token Chain displays ⚡ INJECTED badge per scope (see Phase 146 Plan 03)
- **Security:** Flag only writable by admin; injection is logged to tokenEvents and exchange audit

See also: `ff_inject_may_act` (similar pattern for RFC 8693 `may_act` claim injection).

---

## Deprecation Path

### Old → New Scope Names (Phase 146)

| Old Name | New Canonical Name | Status |
|----------|--------------------|--------|
| `banking:general:read` | `banking:read` | **Replaced** in `config/scopes.js` |
| `banking:general:write` | `banking:write` | **Replaced** in `config/scopes.js` |

### Compound Scopes (Future Deprecation)

| Scope | Status | Notes |
|-------|--------|-------|
| `banking:accounts:read` | Accepted | Still recognized by middleware for backward compatibility |
| `banking:transactions:read` | Accepted | Still recognized by middleware for backward compatibility |
| `banking:transactions:write` | Accepted | Still recognized by middleware for backward compatibility |

These compound scopes will be fully removed in a future phase. New code should use `banking:read` and `banking:write`.

---

## Related Documentation

- [OAUTH_SCOPE_CONFIGURATION.md](OAUTH_SCOPE_CONFIGURATION.md) — PingOne environment setup and OAuth app configuration
- [SCOPE_AUTHORIZATION.md](SCOPE_AUTHORIZATION.md) — Middleware enforcement patterns and code examples
- [SCOPE_CONFIGURATION_README.md](SCOPE_CONFIGURATION_README.md) — Quick start for scope setup
- `config/scopes.js` — Scope constants and user type mappings (code)
- `services/configStore.js` — Feature flag `ff_inject_scopes` for demo mode
- [REGRESSION_PLAN.md](../REGRESSION_PLAN.md) §1 — Protected areas (transaction routes, scope enforcement)
