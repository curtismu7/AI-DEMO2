# Authorization Fix — Shared Contract

Companion to `docs/authorization-decision-split.md`. Every workstream below must
conform to this contract so the pieces line up. Do not deviate without updating
this file first.

## Decisions taken (2026-07-18)

| # | Decision |
|---|---|
| D1 | Fix both sides: gateways send real attribute values (code), cloud policy widens `IsMcpFirstToolRequest` and gains the missing attributes (live env, applied separately after a snapshot export). |
| D2 | `MCP_GW_P1AZ_ENABLED` defaults **true**. The local scope engine survives only as an explicit opt-in and every decision it produces is labelled. |
| D3 | Both PDP callers stay (BFF `McpFirstTool` + gateway `McpToolCall`), but they send an **identical parameter set** so they cannot disagree. The Delegated Access page keeps its visual. |

## C1 — Canonical decision parameter set

Every PDP caller (`pingOneAuthorizeService.js`, `PingOneAuthorizeClient.ts`,
`p1az-decision.groovy`) sends these keys. Absent values are omitted, never
fabricated.

**Identity / delegation**
`ClientId`, `UserId`, `ActClientId`, `NestedActClientId`, `ActChainDepth`, `MayActSub`

**Token facts**
`TokenAudience` — the **actual** `aud` of the presented token (array ⇒ first entry)
`TokenAudActual` — same value; retained for mock back-compat
`McpResourceUri` — the **expected** gateway resource URI
`TokenScopes`, `TokenExp`, `TokenIat`, `TokenNbf`, `TokenIss`

**Request**
`DecisionContext`, `McpMethod`, `ToolName`, `Vertical`, `Timestamp`

**Transaction**
`Amount` — numeric string, the value the cloud Trust Framework actually reads
`TransactionAmount` — same value; retained for mock back-compat
`TransactionType`, `ToAccountId`, `ResourceOwnerId`

**Authentication strength / entitlement**
`Acr`, `UserTier`, `RequiredGroup`, `InRequiredGroup`

**Obligations context**
`HitlApproved`, `HitlChallengeId`

**Caller role**
`UserRole` — added 2026-07-18 when the admin gate-bypass was removed. Admin is
now a policy input rather than a code-level skip.

Consumption status (corrected 2026-07-18 — the earlier claim that "the mock
accepts it today" was false; nothing read the key on any path):

| Side | State |
|---|---|
| BFF → live PingOne (`pingOneAuthorizeService`) | **sends** it (conditional spread; omitted when the session has no role) |
| BFF → simulated engine (`mcpToolAuthorizationService` `simParams`) | **sends** it (WS-C, this round) |
| `demo_authz_server/routes/decision.js` | **does not read it yet — WS-D owns adding the rule** |
| Cloud Trust Framework | attribute not yet defined; see the cloud policy delta below |

Until a PDP reads it, `UserRole` changes no decision. It is sent because the
BFF genuinely knows the value and both engines must receive the *same* inputs
(F3): an attribute present on the live path and absent on the failover path
is the very disagreement this contract exists to prevent. Rule 1 below governs
it like any other key — a session with no role omits it rather than sending `''`.

**Do not treat `UserRole` as an admin bypass.** It is an attribute; the removed
code-level skip must not return in policy form without an explicit decision
recorded here.

**Binding evidence** (omit when the transport did not verify it)
`IntentTokenValid`, `IntentMatchesTool`, `RarAuthorizationDetails`, `TratPurp`, `Cnf`

Rules:
1. `TokenAudience` must never be hardcoded to the expected URI. If a caller
   cannot read the real `aud`, it omits the key.
2. `Amount` and `TransactionAmount` always move together.
3. A caller that cannot verify a binding claim must **omit** it rather than send
   `false` — omission means "unknown", `false` means "verified absent".
4. **No invented endpoints.** `McpResourceUri` is resolved from config/env only.
   A resolver that cannot find one returns `''` and the caller omits the key or
   reports that no decision could be evaluated — it must never fall back to a
   hardcoded host/port (REGRESSION_PLAN §3). A made-up expected resource is the
   same defect as a fabricated audience: the guard then compares real tokens
   against an endpoint nobody configured.

## C2 — Decision provenance

Every decision returned, logged, or rendered carries:

```
policy_source: 'p1az' | 'p1az-mock' | 'local-fallback' | 'simulated'
```

`local-fallback` is the gateway's own scope engine. It is a degraded mode, and
any response carrying it must also set `degraded: true`.

## C3 — Gate-armed health

Gateway `GET /health` gains:

```json
{
  "authz": {
    "policySource": "p1az",
    "enforcing": { "dpop": false, "intent": false, "rar": false, "act": false, "webBotAuth": "monitor" },
    "failOpen": ["MCP_GW_DEV_BYPASS"]
  }
}
```

`failOpen` lists every currently-active bypass by name. Empty array = fully
armed. This is the single signal F5/F6 were missing.

## C4 — Omission is not permission

Any code path that skips the authorization gate must return an explicit,
inspectable marker (`ran: false, skipReason: '<why>'`) that the caller logs. A
skipped gate must never be indistinguishable from a PERMIT.

## Workstreams (disjoint file sets — safe to run in parallel)

| WS | Directory | Findings |
|---|---|---|
| A | `demo_mcp_gateway/` | F1, F7, F8, F10, UC16 wiring, actor allow-list, gateway fail-open |
| B | `ping-gateway/` | F4 (intent + TraT verification), route-validation parity, `X-BFF-Exchanged` gate, C1 params |
| C | `demo_api_server/` | F3, F5 (admin bypass, failover permit, local-handler fallback), F11, undefined flag |
| D | `demo_authz_server/`, `snapshots/` | F9, scope-rule bypass, mock/cloud contract, **consume `UserRole`** (WS-C now sends it on both paths) |
| E | `demo_mcp_server/` | F10 verifier side, dead middleware |

## Cloud policy delta (applied separately, not by these workstreams)

**Mechanism constraint:** PingOne Authorize exposes no policy API for COMPARISON
conditions (`snapshots/gen-authorize-snapshot.js` header). The cloud policy is
changed only by editing the snapshot and importing it. So this delta is an
extension of that reconciler script plus one import — the reconciler already
handles `RequiresHitlConsent`, `RequiresMcpStepUp`, and `IsConsentTransaction`
by stable ID and is idempotent; `IsMcpFirstToolRequest` (cond `0008`) and the
new attributes get the same treatment. Sequenced after WS-D so the two do not
collide in `snapshots/`.

> **BLOCKER — do not import the snapshot before fixing item 0.** The cloud
> condition `HasValidMcpAudience` is `TokenAudience == McpResourceUri`, a STRING
> EQUALITY. After the C1 fixes, every caller sends the token's real single `aud`
> as `TokenAudience` and a comma-joined list of accepted gateway identities as
> `McpResourceUri`. Those are never equal, so `MCP Deny — Invalid Token Audience`
> fires on every MCP request and the cloud denies all traffic. The mock absorbs
> this via set intersection (`decision.js` Rule 0c, WS-D); the cloud has no
> equivalent. Previously Path B masked the problem by deriving the expected URI
> from the token under test — that masking *was* the defect, so fixing it exposed
> this. Sequence: item 0, then item 1, then import.

0. **DONE (round 3)** — `HasValidMcpAudience` (cond `23456789-0007`) is now an
   OR of `TokenAudience Equals <accepted gateway identity>`, the identities read
   from `scope-topology.json` resources (`Super Banking MCP Gateway`,
   `Super Banking PingGateway MCP`) — never hardcoded. The generator fails
   loudly if either resource is missing. Rule `45678901-0004` is unchanged.
   `routes/import-snapshot.js` now 409-blocks a snapshot whose audience
   condition is attribute-to-attribute (the old equality), missing/renamed, or
   whose constant set differs from the SoT.
1. **DONE** — `IsMcpFirstToolRequest` ⇒ `DecisionContext IN (McpFirstTool, McpToolCall, McpToolsList, McpRequest)`
2. **DONE (round 3, revised set)** — new request-resolved attributes:
   `TokenAudActual` (`''`), `ResourceOwnerId` (`''`), `RarMaxAmount` (`''`),
   `IntentTokenValid` (`''`), `IntentMatchesTool` (`''`), `IntentTokenError`
   (`''`), `UserRole` (`'none'`). All defaults are inert sentinels. The BFF
   must resolve `RarMaxAmount` (governing RAR detail's `amount`) and forward
   `IntentTokenError` for the new rules to fire; the rest are already in C1.
3. **DONE (round 3, expressible subset)** — new deny rules in the MCP
   Delegation policy (before the catch-all permit), each mirroring a mock rule
   and emitting a specific statement code plus the shared
   `mcp-authorization-denied`:

   | Rule | Mirrors mock | Statement code |
   |---|---|---|
   | MCP Deny — Audience Targets Upstream | 0b-2 (D-05) | `mcp-bypass-attempt` |
   | MCP Deny — Resource Owner Mismatch | 3.5a | `mcp-resource-owner-mismatch` |
   | MCP Deny — RAR Amount Exceeded | 3c (amount half) | `mcp-rar-amount-exceeded` |
   | MCP Deny — Intent Token Invalid | 4a | `mcp-intent-invalid` |
   | MCP Deny — Intent Tool Mismatch | 4b | `mcp-intent-mismatch` |
   | MCP Deny — Admin Role Not Permitted | 2.95 | `mcp-admin-role-not-permitted` |

   These codes must be wired into `KNOWN_STATEMENT_CODES`
   (`demo_api_server/services/pingOneAuthorizeService.js`) and, for mock/cloud
   code parity, into `DENY_CODE_BY_REASON_PREFIX`
   (`demo_authz_server/routes/decision.js`) — owned by WS-C/WS-D, not the
   snapshot workstream.

**NOT modeled in the cloud policy — PEP + mock only** (the P1AZ DSL cannot
express them faithfully; do not add them to the snapshot without revisiting
this): temporal `exp`/`iat`/`nbf` (mock 0c–0f — ISO `Timestamp` vs epoch-second
strings are not comparable without a verified `CurrentEpoch` attribute and
confirmed numeric coercion), per-tool scope membership (mock Rule 3 — no
set/contains operator over the space-separated `TokenScopes`), the RAR payee
allow-list (3c payee half — array membership), and multi-aud D-05 (the cloud
compares a single `TokenAudActual` string; space-joined multi-aud bypasses are
caught at the gateway PEP and mock only).

Prerequisite: export the current policy to `snapshots/` before any write.
