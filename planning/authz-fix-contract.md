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
now a policy input rather than a code-level skip. Inert until the Trust
Framework defines the attribute; the mock accepts it today.

**Binding evidence** (omit when the transport did not verify it)
`IntentTokenValid`, `IntentMatchesTool`, `RarAuthorizationDetails`, `TratPurp`, `Cnf`

Rules:
1. `TokenAudience` must never be hardcoded to the expected URI. If a caller
   cannot read the real `aud`, it omits the key.
2. `Amount` and `TransactionAmount` always move together.
3. A caller that cannot verify a binding claim must **omit** it rather than send
   `false` — omission means "unknown", `false` means "verified absent".

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
| D | `demo_authz_server/`, `snapshots/` | F9, scope-rule bypass, mock/cloud contract |
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

1. `IsMcpFirstToolRequest` ⇒ `DecisionContext IN (McpFirstTool, McpToolCall, McpToolsList, McpRequest)`
2. New Trust Framework attributes: `TokenAudActual`, `TokenScopes`, `TokenExp`,
   `TokenIat`, `TokenNbf`, `TokenIss`, `ToAccountId`, `ResourceOwnerId`, `Vertical`,
   `IntentTokenValid`, `IntentMatchesTool`
3. Rules consuming them, mirroring mock rules 0b-2 (D-05), 0c–0f (temporal),
   3 (scope), 3.5a (resource owner), 4a/4b (intent)

Prerequisite: export the current policy to `snapshots/` before any write.
