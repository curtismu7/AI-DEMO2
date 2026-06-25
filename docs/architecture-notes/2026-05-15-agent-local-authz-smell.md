# Architecture smell: BFF agent makes authorization decisions locally

**Date:** 2026-05-15
**Status:** **Superseded by [ADR-0003](../adr/0003-pingauthorize-is-sole-bff-tool-gate.md) (2026-05-15).** This note is retained for the investigation trail + corrected-premise record; the decision and its consequences are now canonical in ADR-0003. R1 landed in commits `8faf114e` (remove local authz-decision use + delete `services/agentMcpScopePolicy.js`), `0fffd3a1` (catalog/flag preservation + non-authz annotations), `52f5044b` (R1 regression tests + stale-test updates). REGRESSION_PLAN.md §1 row "MCP Authorize gate … SOLE authoritative BFF tool gate" + §4 entry (2026-05-15) codify the invariant. Resolves BFF review WR-01 + WR-02. Code tracing during implementation found the note's "also used to advertise tools" premise did not hold — `agentMcpScopePolicy`'s only runtime consumer was the redundant authz veto (the agent's tool list comes from the gateway `tools/list`), so R1 deleted the module entirely rather than keeping it as catalog data; the separate `MCP_TOOL_SCOPES` map in `mcpWebSocketClient.js` is the surviving catalog and is now annotated non-authz.
**Surfaced by:** Phase 3 code review of agent code paths, clarified by the architecture principle below.

> **Decision record (2026-05-15):** R1 selected after verifying the actual code paths (see "Corrected premise" below). The original framing — "R1 removes a gate, big blast radius" — was **wrong**. The authoritative PingAuthorize gate already exists independently (`server.js:~1535` `evaluateMcpFirstToolGate`, runs on every MCP tool call). The local scope map is a *redundant second layer*, not the only gate. R1 deletes the redundant authorization-*decision* use while preserving the legitimate catalog/tool-advertisement use. R1 also resolves BFF review WR-01 (MCP_TOOL_SCOPES drift) and WR-02 (duplicate scope entries) as a side effect — you cannot have drift in a deleted map.

---

## The principle

Canonical statement: [docs/ARCHITECTURE-TRUTHS.md](../ARCHITECTURE-TRUTHS.md) **T-2** (authorization decision is external) and **T-4** (PingOne mints/exchanges; gateway/agents only request; identity comes from a PingOne-issued token the authorization server accepts, never a client claim).

Short form for this note: PingOne issues and exchanges tokens; the authorization server (PingAuthorize / PDP) only validates + decides; the gateway and agents request exchange and ask for decisions but neither mint nor decide; the agent owns intent/orchestration only and must never invent identity or authorization locally.

### The line

| Agent decides locally (OK) | Agent must NOT decide — ask the authorization server |
|---|---|
| Which tool to call next | Whether the caller is *allowed* to call it |
| Prompt / useCase template | Whether a scope is sufficient for an operation |
| When to stop the tool loop | Whether an amount needs HITL / step-up |
| Transport retry/backoff | Whether a denied call may be retried as permitted |
| Summarizing results | Redacting by the caller's entitlements |
| Conversation memory | Mapping token claims → permitted tools |

---

## The smell

`banking_api_server/services/agentMcpScopePolicy.js` and `banking_api_server/services/mcpToolAuthorizationService.js` encode a **local scope → tool map** with set-union match semantics (`isToolPermittedByAgentPolicy` uses `.some()` for OR). The earlier code review validated this logic as *correct as code* — and it is. But under the principle above it is **architecturally misplaced**: the BFF LangGraph agent is deciding *whether a tool is authorized for the caller's scopes* locally, instead of asking PingOne Authorize.

This is not a bug (it produces correct answers today). It is a **design smell**: authorization policy is duplicated into the agent. Consequences:

1. **Policy drift.** The local map must be hand-kept in sync with PingOne Authorize policy and with `banking_mcp_server`'s registry (already flagged separately as `MCP_TOOL_SCOPES` drift, WR-01 in the BFF review). Two+ sources of authorization truth.
2. **Bypass surface.** Any path that reaches tool execution without re-consulting the authorization server trusts the local map. The map is the security boundary instead of PingOne Authorize being it.
3. **Wrong layer.** The gateway already asks PingAuthorize per tool call (`PingOneAuthorizeClient.evaluate`). The BFF-side local check is redundant *and* authoritative-looking — a future reader cannot tell which is the real gate.

---

## Corrected premise (verified 2026-05-15)

The note originally assumed the gateway's PingAuthorize call was the only authoritative gate and the BFF local map was the BFF's *de facto* gate. Code tracing disproved this:

1. **The BFF does NOT route through the gateway.** It dials `banking_mcp_server` directly (`mcpWebSocketClient.js`, `MCP_SERVER_URL` default `ws://localhost:8080`). The gateway (3005) is in the *other* agents' path (banking_agent_service, langchain_agent), not the BFF LangGraph agent's path.
2. **The BFF already asks the authorization server on every tool call.** `server.js:~1535` runs `mcpToolAuthorizationService.evaluateMcpFirstToolGate` on every MCP tool call (PingAuthorize or simulated; acts on PERMIT / DENY / HITL). This is the real, authoritative gate and it is independent of the local scope map.
3. **`agentMcpScopePolicy.isToolPermittedByAgentPolicy` is a *second* check** invoked during token acquisition / tool-list filtering (`agentMcpTokenService.js:~912`), redundant with the authoritative gate. It is also used (legitimately) to decide which tools to *advertise* to the agent and is referenced by `configStore.js:~190` for scope-disable-blocks-tool.

**Therefore R1 is narrow and low-risk:** delete the authorization-*decision* role of the local scope policy (the redundant `isToolPermittedByAgentPolicy` authz gate), keep `evaluateMcpFirstToolGate` as the sole authoritative gate, and **preserve** the legitimate catalog/tool-advertisement use (deciding which tools to offer is orchestration — allowed per "the line"). R1 is "delete the decision role, keep the catalog role," not "delete the file."

## Why this needs a recorded decision (future-reader test)

A future engineer reading `agentMcpScopePolicy.js` sees correct, tested scope-union code and reasonably concludes "this is the authorization check." They will extend it (add a tool → add a scope mapping) rather than push the policy into PingOne Authorize. The smell self-perpetuates. Recording it stops that.

---

## Remediation options (undecided — for a future ADR/spec)

- **R1 — Remove local scope policy; gateway's PingAuthorize call is the sole gate.** Agent proposes a tool; the gateway (asking PingOne Authorize) disposes. Deletes `agentMcpScopePolicy.js` decision logic; keeps only orchestration. Largest change; cleanest alignment with the principle.
- **R2 — Demote local policy to a fast-fail hint, not a gate.** Local map may *short-circuit obviously-wrong calls for UX latency* but the gateway's PingAuthorize decision is always authoritative and always runs. Local check can only ever be *more* restrictive as a UX optimization, never the security boundary. Documented + tested as non-authoritative.
- **R3 — Status quo + explicit "this duplicates authz, kept for X reason" annotation.** Only if there is a real constraint (e.g., latency budget, offline-agent requirement) that justifies a local authorization cache. Requires stating the constraint.

**Recommendation pending owner input:** R1 if the gateway PingAuthorize call already covers every tool path; R2 if local fast-fail has a measured UX value. Not R3 unless a hard constraint surfaces.

---

## Related findings

- BFF review WR-01 / WR-02 — `MCP_TOOL_SCOPES` hand-maintained map drift; admin-scope absence + admin-role short-circuit in `mcpToolAuthorizationService.js:78`.
- Gateway CR-01 (fixed, Phase 2) — HITL receipt rebinding; an example of the gateway correctly *asking + enforcing* rather than *deciding*.
- This note should be promoted to an ADR once a remediation (R1/R2/R3) is chosen.
