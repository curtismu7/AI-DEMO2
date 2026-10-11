# Scope Vocabulary — Canonical Registry

> **Machine-readable source of truth:** [`scope-topology.json`](../scope-topology.json) (repo root),
> loaded and validated by `services/scopeTopology.js`.
> This document is the **human-readable companion** to that file — it explains the same
> scopes, aliases, and resource-server mappings in prose. **If `scope-topology.json`
> changes, this document must be updated to match.** The live drift check on the
> `/scope-reference` admin page compares PingOne against the topology file, not this doc.
> (Regenerated from the topology 2026-10-11 — E2 audit.)

---

## Canonical Scope List

All 49 canonical scopes declared in `scope-topology.json` → `scopes{}`.
Descriptions, risk levels, and categories are taken from that file.

| Scope Name | Category | Risk | Description | Resource Server |
| --------- | -------- | ---- | ----------- | --------------- |
| `read` | data | low | Read accounts, balances, transactions | Demo API |
| `write` | data | high | Write operations (deposit/withdrawal/transfer) | Demo API |
| `transfer` | data | high | Execute fund transfers | Demo API |
| `accounts:read` | data | low | Read account information and balances | Demo API |
| `transactions:read` | data | low | Read transaction history and details | Demo API |
| `mortgage:read` | feature | low | Read mortgage/feature-specific data (banking vertical) | Demo API |
| `largepurchase:read` | feature | low | Read large purchase data (retail vertical) | Demo API |
| `records:read` | feature | low | Read health record data (healthcare vertical) | Demo API |
| `gear:read` | feature | low | Read gear order data (sporting-goods vertical) | Demo API |
| `expense:read` | feature | low | Read expense report data (workforce vertical) | Demo API |
| `permits:read` | feature | low | Read permit status data (government vertical) | Demo API |
| `transcript:read` | feature | low | Read enrollment/transcript status data (university vertical) | Demo API |
| `tax:read` | feature | low | Read sensitive tax assessment records (government vertical A2A specialist scope) | Demo API |
| `finaid:read` | feature | low | Read sensitive student financial aid records (university vertical A2A specialist scope) | Demo API |
| `supplier:read` | feature | low | Read sensitive supplier contract records (manufacturing vertical A2A specialist scope) | Demo API |
| `purchase:read` | feature | low | Read sensitive order/purchase history including payment details (retail vertical A2A specialist scope) | Demo API |
| `membership:read` | feature | low | Read sensitive membership details (sporting-goods vertical A2A specialist scope) | Demo API |
| `payroll:read` | feature | high | Read sensitive payroll details (workforce vertical A2A specialist scope) | Demo API |
| `invest:read` | feature | low | Read investment accounts, balances, and portfolio summaries (A2A specialist scope) | Demo API |
| `holdings:read` | feature | high | Read sensitive investment holdings (investment vertical A2A specialist scope) | Demo API |
| `airlines:read` | feature | low | Read reservations, flight status, and seat maps from the airlines SQLite database (airlines vertical) | Demo API |
| `pnr:read` | feature | high | Read the sensitive passenger record — passport, date of birth, payment card and MileagePlus account (airlines vertical A2A specialist scope) | Demo API |
| `airlines:write` | feature | high | Modify reservations — change seat, add checked bag (airlines vertical, Phase 2) | Demo API |
| `ai:agent:read` | agent | medium | Agent invocation permission | Demo API |
| `mcp:invoke` | infra | medium | Invoke MCP tools via the gateway (RFC 8693 exchange) | Demo MCP Server |
| `code:search` | infra | low | Search and read the indexed source code (read-only) | Demo MCP Server |
| `audit:read` | infra | low | Read the PingOne audit log (activities) through the gateway — read-only, no write path exists | Demo MCP Server |
| `jwt:verify` | infra | low | Invoke JWT/JWKS diagnostic tools (decode, verify signature, validate claims, fetch JWKS, inspect key) | Demo MCP JWT Verifier |
| `agent:invoke` | infra | medium | Invoke the Agent Gateway (Two-Exchange Step 1 audience) | Demo Agent Gateway |
| `ai_agent` | ai | medium | AI agent identity | Demo API |
| `admin:read` | admin | medium | Read access to administrative data | Demo API |
| `admin:write` | admin | high | Write access to administrative operations | Demo API |
| `admin:delete` | admin | critical | Delete operations for administrative tasks | Demo API |
| `users:read` | admin | medium | Read access to user management data | Demo API |
| `users:manage` | admin | high | Full user management capabilities | Demo API |
| `workorders:read` | feature | low | Read Work Order Status data (manufacturing vertical) | Demo API |
| `sensitive:read` | data | high | Read sensitive account details (full account/routing numbers) — requires user consent | Demo API |
| `agent:invoke:investment` | infra | medium | Invoke the Investment Advisor A2A intermediate (Exchange #1 actor) | Super Banking A2A Intermediate - Investment Advisor |
| `agent:invoke:records` | infra | medium | Invoke the Records Specialist A2A intermediate (Exchange #1 actor) | Super Banking A2A Intermediate - Records Specialist |
| `agent:invoke:purchase` | infra | medium | Invoke the Purchase History Specialist A2A intermediate (Exchange #1 actor) | Super Banking A2A Intermediate - Purchase History Specialist |
| `agent:invoke:membership` | infra | medium | Invoke the Membership Specialist A2A intermediate (Exchange #1 actor) | Super Banking A2A Intermediate - Membership Specialist |
| `agent:invoke:payroll` | infra | medium | Invoke the Payroll Specialist A2A intermediate (Exchange #1 actor) | Super Banking A2A Intermediate - Payroll Specialist |
| `agent:invoke:tax` | infra | medium | Invoke the Tax Records Specialist A2A intermediate (Exchange #1 actor) | Super Banking A2A Intermediate - Tax Records Specialist |
| `agent:invoke:finaid` | infra | medium | Invoke the Financial Aid Specialist A2A intermediate (Exchange #1 actor) | Super Banking A2A Intermediate - Financial Aid Specialist |
| `agent:invoke:supplier` | infra | medium | Invoke the Supplier Contract Specialist A2A intermediate (Exchange #1 actor) | Super Banking A2A Intermediate - Supplier Contract Specialist |
| `agent:invoke:holdings` | infra | medium | Invoke the Holdings Specialist A2A intermediate (Exchange #1 actor) | Super Banking A2A Intermediate - Holdings Specialist |
| `agent:invoke:passenger` | infra | medium | Invoke the Passenger Records Specialist A2A intermediate (Exchange #1 actor) | Super Banking A2A Intermediate - Passenger Records Specialist |
| `identity:read` | feature | high | Read a customer identity-verification (KYC) record (admin vertical A2A specialist scope) | Demo API |
| `agent:invoke:identity` | infra | medium | Invoke the Identity Verification Specialist A2A intermediate (Exchange #1 actor) | Super Banking A2A Intermediate - Identity Verification Specialist |

---

## Alias Table

External spellings accepted and normalized to canonical scopes via
`scope-topology.json` → `aliases{}` (`scopeTopology.normalizeScope()`).
Aliases reconcile spellings used outside the manifest (PingGateway env,
OAuth `/authorize` requests) with the canonical scope names.

| Alias (external spelling) | Canonical Scope |
| ------------------------- | --------------- |
| `ai:agent` | `ai:agent:read` |
| `apikey:mcp:invoke` | `mcp:invoke` |
| `banking:mcp:invoke` | `mcp:invoke` |
| `gateway:mcp:invoke` | `mcp:invoke` |
| `pinggateway:invoke` | `mcp:invoke` |
| `server:mcp:invoke` | `mcp:invoke` |

---

## Resource Server Mapping

21 resource servers are modelled in `scope-topology.json` → `resources{}`.
**Native scopes** are the scopes a resource server canonically owns.
**Mirrored scopes** are additionally provisioned onto a resource because it is an
RFC 8693 exchange-hop audience (ARCHITECTURE-TRUTHS T-10) — the gateway enforces
per-tool scopes on the inbound bearer, so every gateway-surface tool scope must
also exist on the exchange-target resource. Bootstrap provisions native + mirrored.

PingOne display names come from `provisioning.resourceNames`.

### Super Banking API (PingOne: "Demo API")
- **Enforcement:** BFF validates `aud === enduser.ping.demo`; `requireScopes()` middleware + row-level ownership checks

- **Audience URI:** `enduser.ping.demo`
- **Native scopes:** `read`, `write`, `transfer`, `accounts:read`, `transactions:read`, `mortgage:read`, `largepurchase:read`, `records:read`, `gear:read`, `expense:read`, `permits:read`, `transcript:read`, `tax:read`, `finaid:read`, `supplier:read`, `purchase:read`, `membership:read`, `payroll:read`, `invest:read`, `holdings:read`, `airlines:read`, `airlines:write`, `pnr:read`, `ai:agent:read`, `ai_agent`, `admin:read`, `admin:write`, `admin:delete`, `users:read`, `users:manage`, `workorders:read`, `sensitive:read`, `identity:read`
- **Mirrored scopes:** _(none)_

### Super Banking MCP Server (PingOne: "Demo MCP Server")
- **Note:** The gateway forwards the inbound bearer unchanged, so the MCP server actually validates `aud === mcpgateway.ping.demo` (see `servers.demo_mcp_server` in the topology)
- **Enforcement:** Validates inbound `aud === mcpgateway.ping.demo` and enforces per-tool `requiredScopes` before credential swap

- **Audience URI:** `mcpserver.ping.demo`
- **Native scopes:** `mcp:invoke`, `code:search`
- **Mirrored scopes:** `read`, `accounts:read`, `write`, `transfer`, `mortgage:read`, `largepurchase:read`, `records:read`, `gear:read`, `expense:read`, `permits:read`, `transcript:read`, `tax:read`, `finaid:read`, `supplier:read`, `purchase:read`, `membership:read`, `payroll:read`, `holdings:read`, `identity:read`, `invest:read`, `airlines:read`, `airlines:write`, `pnr:read`, `ai:agent:read`, `admin:read`, `admin:write`, `admin:delete`, `users:read`, `users:manage`, `workorders:read`, `sensitive:read`, `code:search`, `audit:read`

### Super Banking MCP Invest (PingOne: "Demo MCP Invest")
- **Note:** `airlines:*` is deliberately absent from the MCP Server resource above. `twoExchangeReconciler` grants the MCP Gateway app a scope name on only one backend resource (PingOne enforces per-app scope-name uniqueness); listing `airlines:read` on both would let the partition strip it from the MCP Invest grant, which is the grant the airlines tools actually need.

- **Audience URI:** `mcp-invest.ping.demo`
- **Native scopes:** `mcp:invoke`
- **Mirrored scopes:** `invest:read`, `airlines:read`, `airlines:write`, `pnr:read`, `read`

### Super Banking MCP JWT Verifier (PingOne: "Demo MCP JWT Verifier")

- **Audience URI:** `mcp-jwt-verifier.ping.demo`
- **Native scopes:** `jwt:verify`
- **Mirrored scopes:** _(none)_

### Super Banking MCP Gateway (PingOne: "Demo MCP Gateway")

- **Audience URI:** `mcpgateway.ping.demo`
- **Native scopes:** `mcp:invoke`
- **Mirrored scopes:** `read`, `accounts:read`, `write`, `transfer`, `mortgage:read`, `largepurchase:read`, `records:read`, `gear:read`, `expense:read`, `permits:read`, `transcript:read`, `tax:read`, `finaid:read`, `supplier:read`, `invest:read`, `airlines:read`, `airlines:write`, `pnr:read`, `workorders:read`, `sensitive:read`, `code:search`, `audit:read`, `admin:read`, `admin:write`, `admin:delete`, `users:read`, `users:manage`

### Super Banking Agent Gateway (PingOne: "Demo Agent Gateway")

- **Audience URI:** `agentgateway.ping.demo`
- **Native scopes:** `agent:invoke`
- **Mirrored scopes:** `read`, `write`, `transfer`, `mortgage:read`, `largepurchase:read`, `records:read`, `gear:read`, `expense:read`, `permits:read`, `transcript:read`, `tax:read`, `finaid:read`, `supplier:read`, `invest:read`, `airlines:read`, `airlines:write`, `pnr:read`, `workorders:read`, `sensitive:read`, `code:search`, `audit:read`

### Super Banking A2A Intermediate (PingOne: "Demo A2A Intermediate")

- **Audience URI:** `a2a-intermediate.ping.demo`
- **Native scopes:** `agent:invoke`
- **Mirrored scopes:** _(none)_

### Super Banking A2A Intermediate - Investment Advisor (PingOne: "Super Banking A2A Intermediate - Investment Advisor")

- **Audience URI:** `a2a-intermediate-investment.ping.demo`
- **Native scopes:** `agent:invoke:investment`
- **Mirrored scopes:** _(none)_

### Super Banking A2A Intermediate - Records Specialist (PingOne: "Super Banking A2A Intermediate - Records Specialist")

- **Audience URI:** `a2a-intermediate-records.ping.demo`
- **Native scopes:** `agent:invoke:records`
- **Mirrored scopes:** _(none)_

### Super Banking A2A Intermediate - Purchase History Specialist (PingOne: "Super Banking A2A Intermediate - Purchase History Specialist")

- **Audience URI:** `a2a-intermediate-purchase.ping.demo`
- **Native scopes:** `agent:invoke:purchase`
- **Mirrored scopes:** _(none)_

### Super Banking A2A Intermediate - Membership Specialist (PingOne: "Super Banking A2A Intermediate - Membership Specialist")

- **Audience URI:** `a2a-intermediate-membership.ping.demo`
- **Native scopes:** `agent:invoke:membership`
- **Mirrored scopes:** _(none)_

### Super Banking A2A Intermediate - Payroll Specialist (PingOne: "Super Banking A2A Intermediate - Payroll Specialist")

- **Audience URI:** `a2a-intermediate-payroll.ping.demo`
- **Native scopes:** `agent:invoke:payroll`
- **Mirrored scopes:** _(none)_

### Super Banking A2A Intermediate - Tax Records Specialist (PingOne: "Super Banking A2A Intermediate - Tax Records Specialist")

- **Audience URI:** `a2a-intermediate-tax.ping.demo`
- **Native scopes:** `agent:invoke:tax`
- **Mirrored scopes:** _(none)_

### Super Banking A2A Intermediate - Financial Aid Specialist (PingOne: "Super Banking A2A Intermediate - Financial Aid Specialist")

- **Audience URI:** `a2a-intermediate-finaid.ping.demo`
- **Native scopes:** `agent:invoke:finaid`
- **Mirrored scopes:** _(none)_

### Super Banking A2A Intermediate - Supplier Contract Specialist (PingOne: "Super Banking A2A Intermediate - Supplier Contract Specialist")

- **Audience URI:** `a2a-intermediate-supplier.ping.demo`
- **Native scopes:** `agent:invoke:supplier`
- **Mirrored scopes:** _(none)_

### Super Banking A2A Intermediate - Holdings Specialist (PingOne: "Super Banking A2A Intermediate - Holdings Specialist")

- **Audience URI:** `a2a-intermediate-holdings.ping.demo`
- **Native scopes:** `agent:invoke:holdings`
- **Mirrored scopes:** _(none)_

### Super Banking A2A Intermediate - Passenger Records Specialist (PingOne: "Super Banking A2A Intermediate - Passenger Records Specialist")

- **Audience URI:** `a2a-intermediate-passenger.ping.demo`
- **Native scopes:** `agent:invoke:passenger`
- **Mirrored scopes:** _(none)_

### Super Banking A2A MCP Gateway (PingOne: "Super Banking A2A MCP Gateway")

- **Audience URI:** `mcpgateway-a2a.ping.demo`
- **Native scopes:** `read`, `invest:read`, `holdings:read`, `records:read`, `tax:read`, `finaid:read`, `supplier:read`, `purchase:read`, `membership:read`, `payroll:read`, `pnr:read`, `identity:read`
- **Mirrored scopes:** _(none)_

### Super Banking PingGateway MCP (PingOne: "Demo PingGateway MCP")

- **Audience URI:** `https://api.ping.demo:3036/mcp`
- **Native scopes:** `gateway:mcp:invoke`
- **Mirrored scopes:** _(none)_

### Super Banking PingGateway MCP - API-Key (PingOne: "MCP Gateway - API-Key")

- **Audience URI:** `https://api.ping.demo:3036/mcp/apikey`
- **Native scopes:** `apikey:mcp:invoke`
- **Mirrored scopes:** `mortgage:read`, `largepurchase:read`, `records:read`, `gear:read`, `expense:read`, `permits:read`, `transcript:read`, `workorders:read`, `invest:read`

### Super Banking A2A Intermediate - Identity Verification Specialist (PingOne: "Super Banking A2A Intermediate - Identity Verification Specialist")

- **Audience URI:** `a2a-intermediate-identity.ping.demo`
- **Native scopes:** `agent:invoke:identity`
- **Mirrored scopes:** _(none)_

---

## Related Documentation

- `scope-topology.json` (repo root) — machine-readable source of truth (scopes, aliases, resources, apps, tools, policy)
- `services/scopeTopology.js` — validated accessor for the topology (aliases, resource scopes, audiences)
- `routes/scopeAudit.js` — live PingOne vs. topology drift check backing the `/scope-reference` page
- [OAUTH_SCOPE_CONFIGURATION.md](OAUTH_SCOPE_CONFIGURATION.md) — PingOne environment setup and OAuth app configuration
- [SCOPE_AUTHORIZATION.md](SCOPE_AUTHORIZATION.md) — Middleware enforcement patterns and code examples
- [REGRESSION_PLAN.md](../REGRESSION_PLAN.md) §1 — Protected areas (transaction routes, scope enforcement)

---

## Deprecated / Do Not Create

> **Do not create these scope names in PingOne or request them in new code.**
> The old Phase-146 `banking:*` vocabulary has been superseded by the canonical
> names above. Where an old spelling is still accepted, it survives only as an
> alias (see Alias Table) and is normalized to its canonical scope.
