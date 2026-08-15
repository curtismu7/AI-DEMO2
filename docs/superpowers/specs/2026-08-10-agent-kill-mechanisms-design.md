# Agent kill mechanisms — session-scoped revocation + active-run audit trail

**Status:** DESIGN COMPLETE — ready for user review before `writing-plans`.

## Context

Today's kill switch (`killSwitchService.js`, shipped across PRs #1555,
#1565, #1586, #1588–#1592, #1597 on 2026-08-10) revokes a caller-supplied
`agentId` string — every UI trigger built so far either hardcodes it
(`"default-agent"`) or derives it loosely (`live.id`). That's a real,
demonstrated bug: two different users clicking "Stop Agent" on a
shared-string surface (Use Cases page, Demo steps dropdown, AdminSideNav)
all target the literal string `"default-agent"` — no per-user isolation.

Two scenarios were considered when scoping this: a benign runaway loop
(bug, no attacker) and a compromised agent (attacker has valid
credentials). Investigation (2026-08-10) found **no persistent background
loop tied to agent execution anywhere in this codebase** — every agent
action is request-scoped, alive only for the duration of one HTTP
request/SSE response, torn down in a `finally` block when it ends. The
"reordering every 15s" scenario used to motivate this design does not
correspond to any real feature; `reorder` (retail vertical) fires once per
chat message with no timer/cron re-triggering it. This finding narrowed
the design considerably — see "Rejected approaches" below for what that
ruled out and why.

### Prior art (research, 2026-08-10)

- **Industry practice:** no standardized "kill switch" term. Real
  mechanisms are cancel APIs plus policy gates — OpenAI's
  `POST /threads/{id}/runs/{run_id}/cancel`, Anthropic's Agent SDK
  `query.interrupt()` (their V2 SDK has an open gap for
  interrupt-without-close — the same "notify a running process vs.
  destroy the session" tension this design threads), LangGraph's
  `runs.cancel()` plus checkpointed `interrupt()`/`Command(resume=...)`
  for HITL pauses. "Circuit breaker" (threshold-triggered auto-pause) and
  "kill switch" (operator-initiated hard stop) are the terms with real
  industry traction — this feature is the latter, correctly named.
  OWASP's Excessive Agency is **LLM06** (not LLM08); the newer **OWASP
  Agentic AI Threats and Mitigations** doc names kill switches explicitly
  under T6 (Intent Breaking & Goal Manipulation).
- **CAEP / SSF (OpenID Foundation):** Continuous Access Evaluation
  Profile 1.0 went **final Aug 2025** with a `session-revoked` event
  type — this exact use case — built on RFC 8417 (Security Event Token)
  and RFC 8935 (push delivery, reaches a *running* receiver directly
  rather than only gating its next call). Real production use: Okta,
  Microsoft Entra CAE, Google Workspace, Apple, Cisco Duo, SailPoint,
  Keycloak (experimental, July 2026). This design's core mechanism
  (revoke + receiver-side flag check before the next action) already
  matches what CAEP prescribes for receivers — worth naming the internal
  event `session-revoked` and citing CAEP rather than inventing bespoke
  vocabulary.
- **`draft-klrc-aiagent-auth-03`** (IETF individual draft, 6 Jul 2026,
  co-authored by Brian Campbell — Ping Identity — with Okta and OpenAI
  authors): prescribes CAEP/RISC subscriptions for AI agents; states
  cached tokens **MUST NOT** be used after a revocation notification.
  Directly validates the shipped revoke-then-check pattern.
- **GNAP (RFC 9635, published Oct 2024):** cleaner grant-level revocation
  (`DELETE` the whole grant, no new tokens issuable) than OAuth's
  per-token `RFC 7009` scope — but near-zero production adoption. Cited
  as design rationale only; not something to build on.
- **SpiceDB (AuthZed's Zanzibar implementation)** was evaluated for the
  active-run registry component and is **the wrong tool for that piece**
  — Zanzibar-style stores hold the permission graph, not operational
  metadata (`startedAt`, `tool` name), and writing on every single agent
  action start/end is high churn against a system tuned for a
  slowly-changing graph. No production examples found of Zanzibar/SpiceDB
  used as a live session/run registry; the standard architecture is
  "SpiceDB for permissions, KV store for live state." SpiceDB **does**
  fit the *authorization* question this design doesn't currently need —
  "who may kill which agent" (`agent:X#killer@user:alice`) — called out
  below as an explicitly out-of-scope future extension, not part of this
  spec.

## Architecture

Replace the caller-supplied `agentId` string with a server-derived key.
`killAgent(agentId, ...)`, `isAgentRevoked(agentId)`, and every enforcement
check keep their existing signatures and storage mechanism (the generic
`express-session` Store interface — `get`/`set`, already built today) —
what changes is *what string gets passed in* as that key, and *who
decides it*.

- New: `deriveAgentKey(req, explicitAgentId)` — the caller passes an
  explicit real agent id when one exists (e.g. `ControlPlaneRoster`
  already knows `live.id` for the Super Banking live agent — that path is
  unchanged). When no explicit id is passed (every `"default-agent"`
  label call site today: `AdminSideNav`, the Use Cases page, the Demo
  steps dropdown), it falls back to
  `session:<truncated-hash-of-req.sessionID>` — a real per-user,
  per-login key instead of a shared label. This is a caller-side choice,
  not something `deriveAgentKey` infers from the route.
- `routes/admin.js`'s kill-switch route and `agentRateLimit.js`'s
  `isAgentRevoked` check both call the same `deriveAgentKey(req, ...)`
  instead of trusting a client-supplied `:agentId` param directly. The
  URL param becomes the `explicitAgentId` input to that function rather
  than the raw enforcement key.
- This *is* the security boundary — it blocks every future action for
  that session. No loop-halting component is needed: there is no loop to
  halt (see Context). A single in-flight request can still be running
  when a kill fires; that's the mid-flight-abort item below, explicitly
  optional.

A second, independent component adds audit visibility on top — it does
not change what gets blocked, only what the operator can see before and
after clicking Stop.

## Components & data flow

### 1. Core enforcement — `deriveAgentKey`

- **`services/sessionKeyService.js`** (new, small) — houses
  `deriveAgentKey(req, explicitAgentId)`. Single source of truth so
  `routes/admin.js`, `killSwitchService.js`, and `agentRateLimit.js`
  can't quietly disagree on what "the agent" means.
- **`routes/admin.js`'s kill-switch route** — swap
  `const { agentId } = req.params` for
  `const agentId = deriveAgentKey(req, req.params.agentId)`.
- **`agentRateLimit.js`'s `isAgentRevoked` check** — same swap.

**Data flow:** `Stop Agent click → POST /kill-switch → deriveAgentKey(req)
→ same key written by the kill AND read by every subsequent request's
enforcement check` — a session-scoped kill now actually isolates one
user's session from another's, closing the coarse-targeting bug.

### 2. Audit layer — `services/agentRunRegistry.js` (new)

Stays on the existing LMDB-backed store — not SpiceDB (see Prior art).

- `startRun(agentKey, { tool, userId })` — mints a runId (same pattern as
  the existing `correlationId` middleware), writes
  `run:<runId> = {agentKey, userId, tool, startedAt}` via the generic
  Store interface, TTL-capped so a crashed process can't leak an entry
  forever.
- `endRun(runId)` — removes it, called in the agent route's `finally`
  block (mirrors the SSE-keepalive cancellation pattern already present
  in `langchain_agent/src/api/agui_run_handler.py` and the Node
  equivalent).
- Hooks into `routes/agentRun.js` (already has a TTL-sweep at line 134 —
  natural home for the start/end calls around tool execution).
- The kill-switch confirm modal fetches active runs for the target
  `agentKey` before showing "Confirm" — so it says *"This will stop:
  reorder, started 4s ago"* instead of a blind revoke, or *"Nothing
  currently running"* if the run already finished. This directly serves
  the original ask behind this whole feature: explain what's being done
  and why, not just do it.

### 3. Optional/stretch — mid-flight abort as a CAEP-shaped push

Only worth building if real tool calls are slow enough that a running
request could still be in flight when someone clicks kill (needs a
latency check against real tool-call timings before committing to this).

- Internally name the kill event `session-revoked` (CAEP vocabulary) and
  shape the payload like a Security Event Token (RFC 8417) even without
  implementing full SSF transport — reuses the existing `killSwitchSseHub`
  pattern (built earlier today for the kill-switch modal) as the delivery
  channel instead of RFC 8935's HTTP push, since there's no cross-system
  receiver here, just this app's own running request.
- The in-flight handler holds an `AbortController` tied to its runId
  (from the registry above) and cancels the actual external call when it
  receives the push.
- Explicitly last to build, first to cut if time-boxed.

## Rejected approaches (from the original brainstorm menu)

- **Self-checking loop / loop-halting component** — no persistent loop
  exists anywhere in this codebase to instrument (see Context). Dropped
  outright rather than build unused plumbing.
- **Nonce-per-launch token (adversarial-hardened revoke)** — originally
  pitched to survive a fully hijacked, non-cooperative process. Given the
  confirmed request-scoped architecture, the real gap this would close is
  the propagation window between "kill fires" and "flag write lands" —
  milliseconds, not a structural hole, since there's no persistent
  process for a hijacked credential to keep running against. Not worth
  reworking token minting for that in a demo app. Not designed further.
- **SpiceDB for the run registry** — wrong tool for operational metadata
  with high write churn; see Prior art above.

## Error handling

- `deriveAgentKey` can't resolve a session → falls back to a labeled
  anonymous key, logs a warning; the kill route still succeeds (never
  500s on this — killing "no session" is a safe no-op-ish default).
- `agentRunRegistry` write failure (session store hiccup) → non-fatal,
  the run proceeds untracked. Matches the existing pattern elsewhere in
  this codebase (e.g. `killSwitchService.js`'s audit-log failures log,
  don't block the action).
- Orphaned run entries (process crashed before `endRun` fired) → handled
  by the same TTL mechanism already used for the revoked flag.

## Testing

- Unit: `deriveAgentKey` — same session → same key; different sessions →
  different keys.
- Unit: `agentRunRegistry.startRun`/`endRun` round-trip against the real
  `LmdbSessionStore` class directly, not just a mock — matches the
  pattern already established today (`lmdbSessionStore.deleteByPrefix.test.js`).
- Integration: two simulated sessions each start a run; kill session A;
  confirm session B's active run and next action are untouched.
- UI: confirm modal shows the active-run list when present, "nothing
  currently running" when absent.

## Explicitly out of scope for this spec

- SpiceDB-based authorization ("who may kill which agent") — a real,
  defensible future extension per the research, but a separate concern
  from session-scoped revocation and not needed to fix the coarse-
  targeting bug this spec addresses.
- Full SSF/CAEP cross-system transport (RFC 8935 HTTP push to external
  receivers) — this app has no external receiver for these events today;
  only the internal CAEP-shaped naming/payload convention is adopted.

## Next steps

1. User reviews this spec.
2. Invoke `writing-plans` to turn the approved spec into an
   implementation plan — no implementation before that.
