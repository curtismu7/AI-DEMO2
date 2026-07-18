# Transaction Chain of Custody — Design

**Date:** 2026-07-18
**Status:** Approved, ready for implementation planning

## Problem

A single agent turn crosses six instrumentable Node services — BFF, agent-service, mcp-gateway,
mcp-server, authz-server, hitl-service — plus PingGateway, which is Identity Gateway
configuration only (`config/routes/`, `config/groovy/`) with no Node process, no correlation
middleware, and therefore no hop emission. PingGateway is out of scope for emission; its
involvement is visible indirectly through the gateway and authz hops on either side of it.

Today there is no way to follow one transaction across these services, and no way to assert
afterwards that the delegation chain held.

The pieces mostly exist but do not join:

- Six services already run correlation-ID middleware backed by AsyncLocalStorage.
- The BFF stamps `X-Correlation-ID`, `X-Request-ID`, and a synthetic `traceparent` on every
  outbound axios call (`utils/outboundTracing.js`, registered `server.js:488`).
- Seven services export OpenTelemetry spans to a Jaeger all-in-one container.
- Eight separate audit sinks record fragments of each transaction.

Three concrete gaps block end-to-end tracing:

1. **Correlation-ID and OTel trace-ID are disconnected identifier spaces.** `buildTraceparent()`
   synthesises a traceparent from the correlation UUID, but the OTel SDK generates its own
   trace-IDs. Nothing writes `correlation_id` onto a span and nothing reads `trace_id` back
   into the correlation ALS, so a Jaeger trace cannot be joined to a log line or a token-chain
   entry.
2. **`demo_mcp_server` ignores HTTP headers.** `correlationFromMessage.ts` reads
   `params.correlationId` only, so any call arriving over HTTP without that RPC parameter is
   assigned a fresh, unrelated ID.
3. **`demo_agent_service` is a correlation dead end.** `reasonRoute.ts` enters the ALS scope,
   but the OTel spans live in `agentRunHandler.ts` on a different entry path and carry no
   correlation attribute. Those spans also use bare `tracer.startSpan()` with no
   `context.with`/`trace.setSpan`, so `reasoning-step-N` and `tool-execution` are not parented
   to `agent-run-request`.

## Goals

- **Primary:** a demo showpiece. An SE picks one agent turn and sees the full chain of custody:
  UI trigger, token exchanges, gateway authorization, authz decision, MCP tool execution,
  response.
- **Secondary:** per-transaction identity-invariant checks that assert the delegation chain
  held, plus cross-source reconciliation that detects after-the-fact log editing.

Explicit non-goal: a production-grade forensic audit system. This is a demo artifact that
tells a true story, not a compliance control.

## Scope

The traced unit is **one agent turn**: user types or clicks a chip, through the BFF reason
loop, agent-service LLM iterations, tool calls, token exchanges, gateway, authz, MCP, and back
to the reply.

## Approach

A dedicated append-only transaction ledger in the BFF is the source of truth. Existing audit
sinks act as an independent second witness. Jaeger stays as a latency and topology view, linked
by correlation-ID.

### Why two witnesses

The ledger and the existing sinks are written by different code paths, at different times, to
different stores. Agreement across two independently-written records is real evidence:
tampering with one and not the other is detectable. This yields the strongest invariant in the
set (`INV-CROSS`) without needing a hash chain.

### Why Jaeger is not a witness

The `jaegertracing/all-in-one` container holds traces in memory. Using it as a corroborating
source would manufacture a tamper alarm on every `docker compose down`. It is a deep-link
target only.

### Why token-exchange hops are derived, not emitted

`routes/oauth.js`, `services/oauthService.js`, and the BFF session layer are REGRESSION_PLAN §1
protected areas. Rather than add emit calls inside token exchange, the assembler reads
`tokenChainService` at read time and derives `token.exchange` hops from the exchange steps it
already records.

### Approaches considered and rejected

- **Jaeger-centric** (identity claims as span attributes, Jaeger as the store) — rejected:
  traces vanish on restart, the whole feature would be gated on `ff_tracing` and Jaeger uptime,
  and identity claims living in a trace store is the wrong posture for a Ping demo.
- **Read-time join only** (no new writes, assemble from the six existing sinks) — rejected as
  the primary path: joins across heterogeneous stores including two NDJSON files and one
  non-durable ring buffer, with gaps wherever correlation currently drops. Retained as the
  second witness, which is what it is well suited for.

## Architecture

```text
UI click/chip
  └─ BFF: correlationIdMiddleware mints correlationId (exists)
       + NEW: derive traceId from it, seed both into ALS
  ├─ hop: ui.request        (BFF, in-process, writes to store directly)
  ├─ hop: agent.reason      (agent-service → POST /internal/transaction-hop)
  ├─ hop: token.exchange    (DERIVED at read time from tokenChainService)
  ├─ hop: gateway.authorize (mcp-gateway, alongside existing gatewayAudit fire-and-forget)
  ├─ hop: authz.decision    (authz-server → POST)
  ├─ hop: hitl.consent      (hitl-service → POST, when the consent gate fires)
  ├─ hop: mcp.tool          (mcp-server → POST)
  └─ hop: response          (BFF)
                 │
                 ▼
    transactionLedger.lmdb.js   ← primary witness (durable, capped at 500 transactions)
                 │
   ┌─────────────┴─────────────┐
   ▼                           ▼
invariantEngine            reconciler  ← second witness: mcpAuditStore + mcpTrafficLogger
 (pure function)                          + tokenChainService + authz auditDecision
   └──────────┬────────────────┘
              ▼
   GET /api/transaction-trace[/:correlationId]
              ▼
   UI: Transaction Trace page  →  deep-links to Jaeger (latency) and Token Chain (existing)
```

### Components

| Component | Path | Responsibility |
|---|---|---|
| Ledger store | `demo_api_server/services/lmdb/transactionLedger.lmdb.js` | Append hops, get by correlationId, list, evict past cap. Mirrors `mcpAuditStore.lmdb.js`. |
| Ingest route | `demo_api_server/routes/transactionHopIngest.js` | `POST /internal/transaction-hop`, guarded by `x-internal-gateway-secret`. Mirrors `routes/mcpAuditIngest.js`. |
| Read route | `demo_api_server/routes/transactionTrace.js` | `GET /api/transaction-trace`, `GET /api/transaction-trace/:correlationId`. Assembles record, derives token hops, runs engine + reconciler. |
| Invariant engine | `demo_api_server/services/transactionInvariants.js` | Pure `evaluate(record) → {status, violations[]}`. No I/O. |
| Reconciler | `demo_api_server/services/transactionReconciler.js` | Joins the second-witness sources by correlationId, emits `MATCH`/`MISMATCH`/`SOURCE_UNAVAILABLE`. |
| Emitter | `transactionHop` module per service (see plan deviation) | `emitHop(hop)` — reuses the module's correlation ALS and service name. |
| UI page | `demo_api_ui/src/pages/TransactionTracePage.jsx` | List plus vertical chain-of-custody detail. |

The emitter lives inside each service's existing `teachLogger` rather than in a new shared
package. `teachLogger` is already copy-pasted across five services and already holds the
correlation ALS and the service name, so this adds roughly twenty lines per service and no new
plumbing. Introducing an npm workspace package to deduplicate `teachLogger` is out of scope.

## Data model

```js
// LMDB key = correlationId
TransactionRecord {
  correlationId, traceId,           // traceId is the Jaeger deep-link
  startedAt, endedAt, vertical,
  trigger:   { kind: 'chip'|'freeform', text, useCaseId },
  principal: { sub, email, sessionId },
  hops:      [TransactionHop],
  verdict:   { status: 'PASS'|'FAIL'|'INCOMPLETE', violations: [] },
  reconciliation: { status: 'MATCH'|'MISMATCH'|'SOURCE_UNAVAILABLE', diffs: [] }
}

TransactionHop {
  seq, ts, service, durationMs, status: 'ok'|'error',
  phase: 'ui.request'|'agent.reason'|'token.exchange'|'gateway.authorize'
       |'authz.decision'|'hitl.consent'|'mcp.tool'|'response',
  op,                                // tool name, endpoint, or grant type
  identity: { sub, act:[], aud, scopes:[], tokenType, jti },
  decision: { outcome:'permit'|'deny'|'n/a', by:'pingauthorize'|'gateway'|'mock', reason },
  source:   'emit'|'derived'
}
```

`verdict` and `reconciliation` are computed at read time, not stored — they are pure functions
of `hops` plus the second-witness sources, so caching them would create a second thing to
invalidate for no benefit at demo scale.

`act` is an array with the outermost actor first. This ordering is what makes the delegation
chain invariants expressible.

**The ledger stores claims only, never raw tokens.** `teachLogger` deliberately logs tokens
unredacted as a teaching feature; the ledger is framed as an audit record, so it stores `jti`
plus decoded claims and nothing more.

## Invariants

`services/transactionInvariants.js` is a pure function requiring no running services.

| ID | Invariant | Catches |
|---|---|---|
| INV-1 | Once delegation starts, every hop carries a non-empty `act`, and `act[0]` matches the calling agent identity | Agent acting without a delegation claim |
| INV-2 | `identity.sub` is identical across all hops | Confused deputy — the transaction switched users mid-flight |
| INV-3 | `scopes[N+1] ⊆ scopes[N]` (RFC 8693 downscoping is monotonic) | Privilege escalation between exchange legs |
| INV-4 | Each hop's `aud` matches the service that consumed the token | Token replay at the wrong resource |
| INV-5 | Every `mcp.tool` hop is preceded by an `authz.decision` or `gateway.authorize` hop with the same correlationId | Tool executed with no authorization decision |
| INV-6 | No `mcp.tool` hop follows a `deny` decision for the same op | Deny bypass |
| INV-7 | Consent-required ops have a prior `hitl.consent` permit whose intent parameters match the tool's actual parameters | Consent granted for one amount, a different amount executed |
| INV-8 | Hop timestamps are monotonic by `seq`, and no hop falls after the token's `exp` | Expired-token use, replayed or reordered hops |
| INV-CROSS | Every gateway tool call in the ledger has a matching second-witness row with identical `{correlationId, toolName, userId, agentId, outcome}`, and the reverse | After-the-fact log editing |

INV-7 builds on the existing `routes/intentBinding.js` intent-binding demo.

A transaction is `INCOMPLETE` rather than `FAIL` when hops are missing such that an invariant
cannot be evaluated — for example a `mcp.tool` hop with no preceding decision hop *and* no
gateway hop recorded at all. Absence of evidence is reported as absence, not as a violation.

## Reconciliation

`services/transactionReconciler.js`, keyed on correlationId:

| Source | Written by | Corroborates |
|---|---|---|
| `mcpAuditStore.lmdb` | mcp-gateway, fire-and-forget to `/internal/mcp-audit` | `gateway.authorize`, `mcp.tool` |
| `mcpTrafficLogger` NDJSON (`.logs/mcp-traffic.log`) | BFF | RPC calls, token exchanges, authorize decisions |
| `tokenChainService` per-user JSON | BFF oauth paths | `token.exchange` legs |
| authz `auditDecision` | authz-server | `authz.decision` |

Comparison key is `{correlationId, op, sub, outcome}`.

Two rules govern honesty of the output:

- **`SOURCE_UNAVAILABLE` never renders as a violation.** A missing NDJSON file after log
  rotation is not a hack. The UI shows it as grey/unknown, visually distinct from a red
  mismatch.
- **Reconciliation only asserts on phases the second witness should have observed.** It never
  reports a hop as fabricated because a source that never observes that phase is silent.

`mcpToolAuditStore` is deliberately excluded as a witness. Its own header documents it as a
200-event non-durable ring buffer for live debug; using it would produce false mismatches after
every restart.

**Required change:** `demo_authz_server/logger.js:35` currently audits only `DENY` and
`INDETERMINATE`. Permit auditing must be added so reconciliation can corroborate the permit
path, which is the path every happy-path demo takes. `demo_authz_server` is not a
REGRESSION_PLAN §1 protected area.

**Expected during build:** early divergences will be our own bugs — correlation dropping at
mcp-server, agent-service spans with no correlation attribute. That is useful as a correctness
gate on the P0 propagation fixes. The demo narrative calls this *reconciliation*, not "hack
detected".

## UI

New page at `/transaction-trace`, added as the third child of the existing **Telemetry** nav group
(`demo_api_ui/src/components/AdminSideNav.jsx:709-715`) alongside Tracing and Health Check.
`/transaction-trace` is added to `AUTO_EXPAND_SECTIONS` (`AdminSideNav.jsx:156`).

Layout is a **vertical chain of custody**: hop cards stacked top to bottom, each showing
identity and decision. Violations render inline as red bands anchored at the offending hop, so
the failure is read in position rather than in a separate list.

```text
TRANSACTIONS                    [banking v] [1h v]
──────────────────────────────────────────────────
 14:22:07  "check my balance"    ✅ PASS   MATCH
 14:19:44  "transfer $5000"      ❌ FAIL    MATCH   ▼
──────────────────────────────────────────────────
 ❌ FAIL  · INV-6 deny bypass       [Jaeger] [Chain]

 │ 1  demo-api-server   ui.request        12ms
 │    👤 demoUser
 │
 │ 2  demo-api-server   token.exchange    88ms  🔐
 │    👤 demoUser  act[agent-gw]
 │    🔑 banking:transfer  aud=mcp-server
 │
 │ 3  authz-server      authz.decision    31ms
 │    ❌ DENY  Amount > 2000
 │
 ┃━━ ❌ INV-6  tool ran after deny ━━━━━━━━━━━━━
 │
 │ 4  mcp-server        mcp.tool          204ms
 │    create_withdrawal  amount=5000
```

The detail header deep-links to the Jaeger trace (via `traceId`) and to the existing Token
Chain page, mirroring how `TracingPage.jsx:269-273` already bridges to Token Chain.

Only allowlisted emoji are used, per REGRESSION_PLAN §0: ✅ PASS, ❌ FAIL, ⚠️ INCOMPLETE,
🔐 token hops, 👤 subject, 🔑 scopes.

## Error handling

- **Emission is fail-open.** Every `emitHop` call is wrapped in try/catch and is
  fire-and-forget. A dead or slow ledger drops hops; it never fails, blocks, or slows a banking
  request.
- **Ingest validates and rejects cleanly.** A malformed hop returns 400 and does not corrupt
  the existing record for that correlationId.
- **Read path degrades.** A record with missing hops renders as `INCOMPLETE` with the gap
  visible, rather than erroring.
- **Reconciler source failures are reported, not thrown.** An unreadable NDJSON file yields
  `SOURCE_UNAVAILABLE` for that source, and the remaining sources still reconcile.

## Testing

**Unit, no stack running:**

- Invariant engine: 16 fixtures — one passing and one violating record per INV-1 through INV-8.
- Reconciler: `MATCH`, `MISMATCH(diffs)`, and `SOURCE_UNAVAILABLE` fixtures, asserting that
  `SOURCE_UNAVAILABLE` never produces a violation.
- Ledger store: append, get-by-correlationId, cap and eviction at 500.

**Route:**

- `POST /internal/transaction-hop` rejects requests without `x-internal-gateway-secret`;
  a malformed hop returns 400 and leaves the existing record intact.
- `GET /api/transaction-trace` and `GET /api/transaction-trace/:correlationId`.

**Propagation regression, guarding the P0 fixes:**

- correlationId survives BFF → gateway → mcp-server over HTTP with no `params.correlationId`.
- agent-service spans carry a `correlation_id` attribute.

**End-to-end acceptance:**

1. One banking balance chip produces a record with ≥6 hops across ≥4 distinct services,
   `verdict: PASS`, `reconciliation: MATCH`.
2. With `ff_authorize_group_policy` on, a `create_withdrawal` above $2000 produces a `deny` hop
   and INV-6 still reads PASS — proving the engine does not simply fire on any deny.
3. A hand-tampered fixture with the `authz.decision` hop removed trips INV-5.
4. `./run-tests.sh unit` green (with `CI=true`), and the UI build gate green.

## Constraints and non-breakage

- **No writes into protected auth code.** `routes/oauth.js`, `services/oauthService.js`, and
  the BFF session layer are untouched. Token exchange behaviour, scopes, and audiences are
  unchanged. Invoke `.claude/skills/regression-guard/` before the P0 propagation fixes.
- **`ff_transaction_ledger` feature flag**, three-point wiring per repo convention, default ON.
  Off means no emitters and no page.
- **Emoji allowlist** per REGRESSION_PLAN §0.
- **Worktree required**, one branch, explicit `git add <files>`.
- The uncommitted `services/tracingGraph.js` and `routes/tracing.js` `/graph` work is left
  alone. It is the Jaeger service-topology view and is orthogonal to this design.

## Phasing

| Phase | Work | Gate |
|---|---|---|
| P0 | Correlation propagation fixes: mcp-server header read, agent-service ALS↔span bridge, correlationId↔traceId bijection | propagation tests green |
| P1 | Ledger store, ingest route, per-service `emitHop` | one agent turn produces ≥6 hops |
| P2 | Invariant engine and 16 fixtures | all fixtures assert correctly |
| P3 | Reconciler and authz permit auditing | `MATCH` on the happy path |
| P4 | Transaction Trace page and nav wiring | UI build gate green |
| P5 | Jaeger deep-link | link resolves to a real trace |

P0 has standalone value independent of the rest: it makes correlation actually work across all
seven services, which nothing in the repo currently guarantees.
