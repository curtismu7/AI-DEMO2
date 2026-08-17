# Prompt Flow Inspector — design

**Date:** 2026-08-16
**Status:** draft, pending user review

## Goal

Full visibility into a single AI prompt flow — Agent → LLM → Agent Gateway → P1AZ MCP server → Backend — as one correlated trace, viewable in one UI, instead of five disconnected logging systems.

Today: three unjoined ID schemes (gateway `correlationId`, LLM proxy `_aiTraceId`, LangChain `run_id`/`session_id`); P1AZ decisions logged stdout-only ("nothing in repo reads it," per existing code comment); LLM prompt/completion content never captured locally at all (metadata only, sent to PostHog cloud); backend request detail lives in its own store, never reaching the shared ledger. No way to pull up one request and see all five layers together.

## Existing infrastructure to reuse

`demo_mcp_gateway` and `demo_authz_server` already fire-and-forget POST "hop" events (`phase`, `correlationId`, `durationMs`, `status`, `identity`) into `demo_api_server`'s `transactionLedger.lmdb` — proven, non-blocking, already in production. Gateway and BFF also already share one `correlationId` scheme via `x-correlation-id` header + `AsyncLocalStorage` (`demo_mcp_gateway/src/correlationId.ts`, `demo_mcp_gateway/src/correlationContext.ts`; `demo_authz_server/correlationId.js`, `correlationContext.js`; `demo_api_server/middleware/correlationId.js`).

The UI side already has an established layout pattern for exactly this kind of trace view: `InspectorShell` (tree + tabbed detail panel), used today by `UnifiedTokenFlowInspector.jsx` (tool-tree, live polling, raw-JSON tab).

Approach: extend both of these rather than build new ones.

## Approach considered and rejected

- **Query-time join across the five existing/separate stores** (mcpAuditStore, transactionLedger, reportStore, a new LLM store, activityLog) — rejected. Agent and LLM proxy have no durable record today; this approach still requires building that storage, then ALSO building a fan-out join layer on top. More moving parts for no extra benefit.
- **Brand-new dedicated store** — rejected. Becomes an 11th siloed store duplicating the ledger's existing job; most new code for the least reuse.

## Design

### 1. Correlation ID propagation

One ID, sourced at the BFF (existing `middleware/correlationId.js`), threaded through every hop:

- **BFF → Agent**: pass `correlationId` into the agent invocation (websocket/AG-UI run start) so it tags every `execution_tracer.py` / `tracing_callback.py` step.
- **Agent → LLM proxy**: agent's HTTP call to `:8090` carries `x-correlation-id`. Proxy keeps its own `_aiTraceId` for PostHog's `$ai_trace_id`, but sets the ledger hop's `correlationId` = inbound header (falls back to `_aiTraceId` if the header is absent — e.g. a direct/manual proxy call with no upstream agent).
- **Gateway, P1AZ, Backend**: already propagate the same header/AsyncLocalStorage pattern — no change needed.

### 2. Ledger extension — forward full detail, not a summary

The ledger's `details` field already accepts an arbitrary object (gateway hops use it today for DPoP/RAR posture). No schema migration. The change is: **each layer forwards the full object it already computes, instead of a trimmed summary**, since that full object already exists in memory at the point the hop fires.

**P1AZ (`demo_authz_server`)** — `auditDecision()` (`logger.js:40-55`) already builds a rich JSON record: `decision`, `reason`, `correlationId`, `decisionContext`, `tool`, `sub`, `actor`, `workerId`, plus `scopes`, RAR presence, `intentMatch`, `intentValid`, `hitlApproved`, `policy_version`, `decision_id` (from `decision.js:287` and the `permit()`/`deny()`/`indeterminate()` terminal helpers). Today this JSON goes to stdout only. The separate hop emitter (`_emitDecisionHop`, `decision.js:1016-1025`) reaches the ledger but currently sends only a bare outcome. **Change: pass the same rich object `auditDecision()` builds into the hop's `details` field**, so PERMIT/DENY/INDETERMINATE in the ledger carries the full decision context, not just the verdict.

**Gateway (`demo_mcp_gateway`)** — `recordGatewayAudit()` (`gatewayAudit.ts:67-103`) already builds full detail (httpStatus, jsonRpcErrorCode, DPoP/RAR posture, token scopes, ACR, scope-denial alerts with `requiredScopes`/`missingScopes`/`availableScopes`) for `mcpAuditStore` (read via existing `GET /api/mcp/audit`). Its `emitHop()` call (`gatewayAudit.ts:80-92`) currently sends a coarser `decision{outcome,by,reason}`. **Change: forward the same `details` object built for `mcpAuditStore` into the hop's `details` field too** — one computation, two destinations, no divergence.

**LLM proxy (`demo_llm_proxy`)** — new hop emitter (Node, ported from `demo_mcp_gateway/src/transactionHop.ts` — same shape), called from `router.js`'s existing `proxyRes` handler alongside `captureGeneration()` (`posthogAi.js:142-182`). Forwards everything already computed there for PostHog: `model`, `tier`, `durationMs`, `time_to_first_token`, `http_status`, `stream` flag, routing reason (`via`), input/output token counts — plus new: `promptRedacted`, `completionRedacted` (see redaction below). Phase: `llm.call`.

**Backend (`demo_api_server`)** — currently has NO ledger entry at all; `activityLogger` (`middleware/activityLogger.js:3-133`) writes its rich per-request record (user, endpoint, IP, UA, status, duration) to its own `activityLog` store only. **Change: when a request carries a `correlationId`, `activityLogger` also writes a `phase:'backend.request'` entry directly into `transactionLedger.lmdb.js`** (in-process write, no HTTP hop needed — the ledger lives in this same service) carrying the same detail already captured for the activity log.

**Agent (`langchain_agent`)** — new hop emitter (Python, same shape as the TS/JS ones), hooked into `tracing_callback.py`'s `on_chain_start/end`, `on_tool_start/end`, `on_llm_start/end` (lines 32/68/103, 128/158/197, 221/246/270) — covering agent-level reasoning steps as well as individual tool/LLM calls, not just the leaf calls. Phase: `agent.step`. `details.content` = redacted prompt/tool I/O (capped ~4000 chars), `runId`/`parentRunId`/`sessionId` carried through from LangChain's own IDs.

### 3. Redaction

Port the pattern already in `demo_api_server/utils/logRedact.js` (SSN/card/email/token patterns) to the two new emitters (LLM proxy: Node, direct reuse; langchain_agent: Python port of the same rule set) — one rule set to audit, not two independently maintained ones. Content capped at ~4000 chars per field. Redaction failure → store `"[redaction-error, content omitted]"`, never raw content on error.

### 4. Read API (`demo_api_server`)

Admin-session gated, same pattern as existing `GET /api/mcp/audit`:

- `GET /api/prompt-flow` — list recent runs: distinct `correlationId` + latest timestamp + summary status + vertical, paginated. Feeds the run list.
- `GET /api/prompt-flow/:correlationId` — all ledger hops for that ID, ordered by timestamp, each carrying its full `details` payload per layer as specced above.

Both are pure reads against `transactionLedger.lmdb.js` filtered by `correlationId` — no new store.

### 5. UI — `PromptFlowInspector.jsx`

New standalone admin page (not a `DevToolsDashboard` floating-panel tab — a 5-layer trace needs more room), built on `InspectorShell`:

- Left: run list from `GET /api/prompt-flow` (manual refresh — history-first, no live tail in this iteration).
- Center: selected run's hops as an ordered, layer-color-striped timeline (Agent / LLM / Gateway / P1AZ / Backend).
- Right: tabbed detail panel — **Details** (selected hop's full `details`, redaction clearly marked) / **Raw JSON** (full ledger response for the run).
- New route + nav entry under the existing "Inspectors" group (`AdminSideNav.jsx`, `navStructureCatalog.js`), admin-gated like `PolicyDecisionTracePage`.

Mockup published for layout review (not wired to live data): confirms the three-pane shell, layer color-coding, and Details/Raw-JSON tab split before implementation.

### 6. Error handling

- All hop emissions (new and existing) follow the established fire-and-forget pattern — POST with timeout, swallow errors. Agent/LLM proxy never block or fail a user-facing request if the BFF ledger endpoint is unreachable.
- Missing/unknown `correlationId` at the read endpoint → empty result, not an error.
- Redaction failure → placeholder text (see §3), never raw content.

### 7. Testing

- **Backend**: unit tests for the two new endpoints against a fixture ledger covering all 5 phases with full `details` payloads.
- **LLM proxy**: unit tests for the redaction function (SSN/card/email/token patterns) and the new hop payload shape.
- **langchain_agent**: pytest for the new emitter firing from `tracing_callback.py` hooks (mock POST, assert phase/correlationId/redacted content).
- **Gateway/P1AZ**: no new tests for the hop mechanism itself (unchanged); add coverage confirming the *expanded* `details` payload matches what `mcpAuditStore`/`auditDecision()` already build (regression guard against the two diverging again).
- **UI**: vitest for `PromptFlowInspector` against a fixture API response.
- **E2E** (Playwright, Super Sports vertical): one agent chat turn that exercises a tool call → confirm the resulting run shows all 5 phases with the expected detail fields present.

## Scope explicitly excluded (this iteration)

- Live tail / streaming updates — history-first per user decision; live tail is a follow-up once this data model is proven.
- Ledger retention/TTL sizing for content-bearing hops — needs verifying against `transactionLedger.lmdb.js`'s existing retention policy during implementation; flagged as a risk, not re-derived here.
