# Scope Vocabulary — Canonical Registry

> **Machine-readable source of truth:** [`scope-topology.json`](../scope-topology.json) (repo root),
> loaded and validated by `services/scopeTopology.js`.
> This document is the **human-readable companion** to that file — it explains the same
> scopes, aliases, and resource-server mappings in prose. **If `scope-topology.json`
> changes, this document must be updated to match.** The live drift check on the
> `/scope-reference` admin page compares PingOne against the topology file, not this doc.

---

## Canonical Scope List

All 25 canonical scopes declared in `scope-topology.json` → `scopes{}`.
Descriptions, risk levels, and categories are taken from that file.

| Scope Name | Category | Risk | Description | Resource Server |
| --------- | -------- | ---- | ----------- | --------------- |
| `read` | data | low | Read accounts, balances, transactions | Super Banking API |
| `write` | data | high | Write operations (deposit/withdrawal/transfer) | Super Banking API |
| `transfer` | data | high | Execute fund transfers | Super Banking API |
| `accounts:read` | data | low | Read account information and balances | Super Banking API |
| `transactions:read` | data | low | Read transaction history and details | Super Banking API |
| `sensitive:read` | data | high | Read sensitive account details (full account/routing numbers) — requires user consent | Super Banking API |
| `mortgage:read` | feature | low | Read mortgage/feature-specific data (banking vertical) | Super Banking API |
| `largepurchase:read` | feature | low | Read large purchase data (retail vertical) | Super Banking API |
| `records:read` | feature | low | Read health record data (healthcare vertical) | Super Banking API |
| `gear:read` | feature | low | Read gear order data (sporting-goods vertical) | Super Banking API |
| `expense:read` | feature | low | Read expense report data (workforce vertical) | Super Banking API |
| `permits:read` | feature | low | Read permit status data (government vertical) | Super Banking API |
| `transcript:read` | feature | low | Read enrollment/transcript status data (university vertical) | Super Banking API |
| `workorders:read` | feature | low | Read Work Order Status data (manufacturing vertical) | Super Banking API |
| `invest:read` | feature | low | Read investment accounts, balances, and portfolio summaries (A2A specialist scope) | Super Banking API |
| `ai:agent:read` | agent | medium | Agent invocation permission | Super Banking API |
| `ai_agent` | ai | medium | AI agent identity | Super Banking API |
| `admin:read` | admin | medium | Read access to administrative data | Super Banking API |
| `admin:write` | admin | high | Write access to administrative operations | Super Banking API |
| `admin:delete` | admin | critical | Delete operations for administrative tasks | Super Banking API |
| `users:read` | admin | medium | Read access to user management data | Super Banking API |
| `users:manage` | admin | high | Full user management capabilities | Super Banking API |
| `mcp:invoke` | infra | medium | Invoke MCP tools via the gateway (RFC 8693 exchange) | Super Banking MCP Server |
| `code:search` | infra | low | Search and read the indexed source code (read-only) | Super Banking MCP Server |
| `agent:invoke` | infra | medium | Invoke the Agent Gateway (Two-Exchange Step 1 audience) | Super Banking Agent Gateway |

---

## Alias Table

External spellings accepted and normalized to canonical scopes via
`scope-topology.json` → `aliases{}` (`scopeTopology.normalizeScope()`).
Aliases reconcile spellings used outside the manifest (PingGateway env,
OAuth `/authorize` requests) with the canonical scope names.

| Alias (external spelling) | Canonical Scope |
| ------------------------- | --------------- |
| `banking:mcp:invoke` | `mcp:invoke` |
| `gateway:mcp:invoke` | `mcp:invoke` |
| `server:mcp:invoke` | `mcp:invoke` |
| `ai:agent` | `ai:agent:read` |

---

## Resource Server Mapping

Six resource servers are modelled in `scope-topology.json` → `resources{}`.
**Native scopes** are the scopes a resource server canonically owns.
**Mirrored scopes** are additionally provisioned onto a resource because it is an
RFC 8693 exchange-hop audience (ARCHITECTURE-TRUTHS T-10) — the gateway enforces
per-tool scopes on the inbound bearer, so every gateway-surface tool scope must
also exist on the exchange-target resource. Bootstrap provisions native + mirrored.

PingOne display names come from `provisioning.resourceNames`
(e.g. `Super Banking API` is provisioned as **Demo API**).

### Super Banking API (PingOne: "Demo API")

- **Audience URI:** `enduser.ping.demo`
- **Native scopes:** `read`, `write`, `transfer`, `accounts:read`, `transactions:read`, `mortgage:read`, `largepurchase:read`, `records:read`, `gear:read`, `expense:read`, `permits:read`, `transcript:read`, `invest:read`, `ai:agent:read`, `ai_agent`, `admin:read`, `admin:write`, `admin:delete`, `users:read`, `users:manage`, `workorders:read`, `sensitive:read`
- **Mirrored scopes:** _(none)_
- **Enforcement:** BFF validates `aud === enduser.ping.demo`; `requireScopes()` middleware + row-level ownership checks

### Super Banking MCP Server (PingOne: "Demo MCP Server")

- **Audience URI:** `mcpserver.ping.demo`
- **Native scopes:** `mcp:invoke`, `code:search`
- **Mirrored scopes:** `read`, `write`, `transfer`, `mortgage:read`, `largepurchase:read`, `records:read`, `gear:read`, `expense:read`, `permits:read`, `transcript:read`, `invest:read`, `ai:agent:read`, `admin:read`, `admin:write`, `admin:delete`, `users:read`, `users:manage`, `workorders:read`, `sensitive:read`
- **Note:** The gateway forwards the inbound bearer unchanged, so the MCP server actually validates `aud === mcpgateway.ping.demo` (see `servers.demo_mcp_server` in the topology)

### Super Banking MCP Invest (PingOne: "Demo MCP Invest")

- **Audience URI:** `mcp-invest.ping.demo`
- **Native scopes:** `mcp:invoke`
- **Mirrored scopes:** `invest:read`, `read`

### Super Banking MCP Gateway (PingOne: "Demo MCP Gateway")

- **Audience URI:** `mcpgateway.ping.demo`
- **Native scopes:** `mcp:invoke`
- **Mirrored scopes:** `read`, `write`, `transfer`, `mortgage:read`, `largepurchase:read`, `records:read`, `gear:read`, `expense:read`, `permits:read`, `transcript:read`, `invest:read`, `workorders:read`, `sensitive:read`, `code:search`
- **Enforcement:** Validates inbound `aud === mcpgateway.ping.demo` and enforces per-tool `requiredScopes` before credential swap

### Super Banking Agent Gateway (PingOne: "Demo Agent Gateway")

- **Audience URI:** `agentgateway.ping.demo`
- **Native scopes:** `agent:invoke`
- **Mirrored scopes:** `read`, `write`, `transfer`, `mortgage:read`, `largepurchase:read`, `records:read`, `gear:read`, `expense:read`, `permits:read`, `transcript:read`, `invest:read`, `workorders:read`, `sensitive:read`, `code:search`
- **Purpose:** Two-Exchange Step 1 audience for the AI Agent client-credentials token

### Super Banking A2A Intermediate (PingOne: "Demo A2A Intermediate")

- **Audience URI:** `a2a-intermediate.ping.demo`
- **Native scopes:** `agent:invoke`
- **Mirrored scopes:** _(none)_

---

## Deprecated / Do Not Create

> **Do not create these scope names in PingOne or request them in new code.**
> The old Phase-146 `banking:*` vocabulary has been superseded by the canonical
> names above. Where an old spelling is still accepted, it survives only as an
> alias (see Alias Table) and is normalized to its canonical scope.

| Old Name | Superseded By | Status |
| -------- | ------------- | ------ |
| `banking:read` | `read` | Removed |
| `banking:write` | `write` | Removed |
| `banking:admin` | `admin:read` / `admin:write` / `admin:delete` | Removed |
| `banking:sensitive` | `sensitive:read` | Removed |
| `banking:ai:agent` | `ai:agent:read` | Removed |
| `banking:mcp:invoke` | `mcp:invoke` | Accepted alias only (normalized via `aliases{}`) |
| `banking:accounts:read` | `accounts:read` | Removed |
| `banking:transactions:read` | `transactions:read` | Removed |

---

## Related Documentation

- `scope-topology.json` (repo root) — machine-readable source of truth (scopes, aliases, resources, apps, tools, policy)
- `services/scopeTopology.js` — validated accessor for the topology (aliases, resource scopes, audiences)
- `routes/scopeAudit.js` — live PingOne vs. topology drift check backing the `/scope-reference` page
- [OAUTH_SCOPE_CONFIGURATION.md](OAUTH_SCOPE_CONFIGURATION.md) — PingOne environment setup and OAuth app configuration
- [SCOPE_AUTHORIZATION.md](SCOPE_AUTHORIZATION.md) — Middleware enforcement patterns and code examples
- [REGRESSION_PLAN.md](../REGRESSION_PLAN.md) §1 — Protected areas (transaction routes, scope enforcement)
