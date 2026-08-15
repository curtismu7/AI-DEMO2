# Incident Response Runbooks

Operational runbooks for security incidents in the demo platform (BFF
`demo_api_server`, MCP gateway, Authorization Server, PingOne OAuth + RFC 8693
token exchange, LMDB-backed config/session store).

> **Scope & intent.** This is a security *teaching* demo, not a production bank.
> These runbooks document the **real** containment levers, endpoints, and audit
> sources that exist in this codebase, so an operator (or a workshop facilitator)
> can respond to — and demonstrate response to — a realistic incident. Paths and
> identifiers are accurate as of writing; verify against the code before acting.

## The three runbooks

| Incident | Runbook | Primary lever |
| --- | --- | --- |
| Leaked / stolen access, refresh, or exchanged token | [token-compromise.md](token-compromise.md) | Kill switch + RFC 7009 revocation |
| Agent/user holding a scope or delegation it shouldn't | [unauthorized-scope-grant.md](unauthorized-scope-grant.md) | Revoke `may_act` / delegation, scope audit |
| `VAULT_PASSWORD` or a stored secret leaked | [vault-secret-exposure.md](vault-secret-exposure.md) | Vault rotate + secret rotation |

## First response (any incident)

The first five minutes are the same regardless of incident type:

1. **Declare and timestamp.** Note the wall-clock time you became aware and a
   one-line description. Every audit query below is time-bounded — you need a `t0`.
2. **Assess severity** (table below). This sets who you wake up and whether you
   contain immediately or gather evidence first.
3. **Preserve evidence before you change anything.** Pull the relevant audit
   trail (see *Evidence sources*) — containment actions (kill switch, session
   wipe, vault rotate) destroy live state. Capture first, then contain.
4. **Contain** using the incident-specific runbook.
5. **Eradicate & recover**, then run the **post-incident** checklist.

### Severity

| Sev | Definition | Examples |
| --- | --- | --- |
| **SEV-1** | Active compromise with blast radius beyond the demo, or secret material exposed | Leaked `VAULT_PASSWORD`; an exchanged token actively draining accounts |
| **SEV-2** | Confirmed unauthorized action, contained to the demo | An agent used a scope it shouldn't; a single stolen user token |
| **SEV-3** | Suspicious but unconfirmed, or self-limiting | Rate-limit spike with auto-kill already engaged; an audit anomaly |

## Evidence sources

Capture these **before** containment. All admin endpoints require an admin
session (`authenticateToken` + `requireAdmin`); `/api/introspect` is public.

| Source | What it records | How to read |
| --- | --- | --- |
| `services/auditLogService.js` | Kill events, kill failures, rate-limit violations, time-to-revoke, state-snapshot id | `GET /api/admin/audit-trail?agentId=<id>&hours=<h>` and `GET /api/admin/audit-event/:auditId` |
| `services/lmdb/mcpAuditStore.lmdb.js` + `services/mcpToolAuditStore.js` | MCP tool calls: tool name, user, success, duration, token sub/scope, delegation flag (durable in LMDB db `mcpToolCalls`) | `GET /api/mcp/audit?agentId=<id>&outcome=<>` |
| `middleware/delegationAuditLogger.js` | Per-request delegation chain: `act` / `may_act` claims, user vs actor, method/path, correlation id | Structured logs (`logger.audit('DELEGATION_ACTION', …)`) |
| `services/scopeAuditService.js` | Per-resource scope drift (current vs expected at PingOne): `CORRECT` / `MISMATCH` / `ERROR` | `GET /api/admin/scope-audit/resources` |
| `services/exchangeAuditStore.js` | RFC 8693 token-exchange events (in-memory ring buffer, **ephemeral — lost on restart**) | In-app token-chain / exchange views |
| `services/auditLogger.js` | Auth events (login/logout/refresh/revocation), authz allow/deny, security events (invalid/revoked tokens) | Structured logs |
| Vault audit log | `op` / `key` / `result` / `caller` for vault unlock/rotate (**never** secret values) | `{VAULT_PATH}.audit.log` on disk |

> **Correlation id.** The BFF stamps `X-Request-ID` / `X-Correlation-ID` on every
> request and propagates it through the gateway and Authorization Server (see
> `middleware/correlationId.js`). If you have the correlation id of the offending
> request, it ties the BFF, gateway, and authz logs together — start there.

## Post-incident checklist (all incidents)

- [ ] Timeline reconstructed from the audit sources above (with correlation ids).
- [ ] Root cause identified; the specific token/scope/secret/agent confirmed neutralized.
- [ ] Affected credentials rotated (tokens revoked, secrets rotated, sessions cleared).
- [ ] Regression / detection gap captured — if a code bug enabled it, add a test and a `REGRESSION_LOG.md` entry.
- [ ] CHANGELOG updated if any code/config changed during response.
- [ ] Brief written: what happened, blast radius, time-to-contain, follow-ups.

## Reference: where things live

- Token revocation (RFC 7009): `services/tokenRevocation.js`
- Token introspection (RFC 7662): `services/tokenIntrospectionService.js`, route `routes/introspect.js` → `POST /api/introspect`
- Kill switch: `services/killSwitchService.js`, route `POST /api/admin/agent/:agentId/kill-switch` (`routes/admin.js`); enforced on the next tool call by the kill check in `services/mcpToolPipeline.js` (`runMcpToolPipeline`)
- Delegation / `may_act`: `services/delegationService.js`, `routes/agentAuthorization.js`, `middleware/delegationAuditLogger.js`
- Vault: `services/vaultLoader.js`, `routes/adminVault.js`
- Sessions: `services/lmdb/sessionStore.js` (LMDB db `sessions`), env `CLEAR_SESSIONS_ON_BOOT`
