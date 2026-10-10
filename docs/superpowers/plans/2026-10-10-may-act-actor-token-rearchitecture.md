# may_act re-architecture: actor-token act minting by default, may_act behind a flag

**Status:** PLAN — not started. Written 2026-10-10 in worktree `act-claim-rfc8693-alignment`.
**Decision:** Option C (full re-architecture), chosen by the user 2026-10-10 over
teaching-copy-only (B) and hide-the-claim (A, non-viable — breaks act minting + revocation).

---

## 1. Problem statement

The demo's default delegation path seeds the RFC 8693 `act` claim from the user's
`may_act` attribute (`act ← subjectToken.may_act` resource SpEL). Vendor research
(2026-10-10, see the superseded array-migration note in `2026-08-12-act-claim-array-migration.md`)
showed no major implementer uses `may_act`-seeded minting as its default pattern:

- **Auth0 OBO**: mints/maintains `act` from the exchange itself — no `may_act` pre-auth required.
- **Entra Agent ID / Okta / AWS**: no `act` at all; per-hop identity claims or immutable origin strings.

The user's direction: **may_act should not be used by default — only behind a feature flag.**

### What the audit found (2026-10-10)

| Finding | Evidence |
|---|---|
| `may_act` is load-bearing: it is the ONLY mint-time source of `act` on single-hop flows | `pingoneProvisionService.js` step 23.5 + agent-gw + a2a-intermediate wiring; `act ← subjectToken.may_act` |
| Revocation depends on it: revoke → `mayAct` cleared → no `may_act` → no `act` → Rule 2.5 (`REQUIRE_ACT_FOR_AGENT_TOOLS`, default ON) denies | `agentAuthorization.js:53-56`; `demo_authz_server/routes/decision.js` Rule 2.5 |
| `MayActSub` decision parameter is **dead plumbing** — sent by both gateways, evaluated by NO rule (snapshot has zero mentions; mock's `ENFORCE_MAY_ACT` branch was removed for act-only validation) | `PingOneAuthorizeClient.ts:250`, `p1az-decision.groovy:920` vs `AI_Demo_Transaction_Authorization_P1AZ.snapshot.json` (0 hits), `decision.js:721-731` |
| The `X-May-Act-Sub` bridge is **static** (config value), not per-user — it cannot express "this user did not consent" | `mcpActorBridge.js:31-56` |
| Exchange #1 and Exchange #2 produce the **same final `act`** from either source: legacy seeds `{sub: AI Agent}` from `may_act`; actor-token minting yields `{sub: AI Agent}` from `actorToken.client_id`. The A2A nested composer (`{'sub': actorToken.client_id, 'act': subjectToken.act}`) is already actor-based and mode-agnostic | `pingoneProvisionService.js:3395-3410` |
| The `${...}` inline-map SpEL form IS evaluated (map literals construct objects); `#{...}` is emitted verbatim (documented bug) — the nested composer was verified live | `pingoneProvisionService.js:3395-3400`, step 23.5 comment |

## 2. Target architecture

**Default (new):** `act` is minted from the **actor token's client id**. `may_act` remains
on user tokens as the RFC 8693 consent declaration, but enforcement of that consent moves
from "mint-time absence" to a **P1AZ policy rule evaluated on every tool call** (and at the
mock's parity engine). Revocation takes effect at decision time, not only at re-mint.

**Flag ON (legacy teaching):** today's wiring — `act ← subjectToken.may_act`; absence of
consent means no `act`, and Rule 2.5 denies. UC3's "may_act seeds act" story.

### The flag

`ff_may_act_seed` (configStore, `public: true`, **default `'false'`**).

- **OFF (default):** provisioning wires `act` from the actor token; PDP consent rule active; teaching copy reframed.
- **ON:** exactly today's behavior, preserved for the may_act lesson and regression comparison.

⚠️ SpEL is baked at **provisioning** time — the flag is read when the setup wizard wires
resources, not per-request. Changing the flag requires re-provisioning (document this in
the config UI description).

## 3. Changes per subsystem

### 3.1 `demo_api_server/services/pingoneProvisionService.js` (mint side)

- Read `ff_may_act_seed` (configStore) where steps 23.5 / agent-gw-act / a2a-intermediate-act wire SpEL.
- **Flag OFF:**
  - Agent Gateway resource + each specialist intermediate resource:
    `act = "${{'sub': #root.context.requestData.actorToken.client_id}}"` — the single-hop
    subset of the already-verified nested composer. **Verify live before trusting** (the
    nested form is proven; this one-hop form is not).
  - Keep `may_act = ${user.mayAct}` on the user-facing resources (Demo API + MCP Server):
    the claim stays as the consent declaration the BFF bridges and the PDP evaluates.
  - Keep `may_act` literal on the Agent Gateway resource (agent-gw-may-act step): it
    authorizes the Exchanger to present the intermediate token in Exchange #2 — exchange
    authorization, not act seeding. Same for specialist intermediates.
- **Flag ON:** current SpEL, byte-identical.
- Step messages say which mode wired what (setup wizard transcript).

### 3.2 `demo_api_server/services/mcpActorBridge.js` + callers (per-user consent signal)

- `buildActorBridgeHeaders({ workloadActorClientId, userMayActSub })`:
  - `X-Act-Client-Id` unchanged (names the agent — static is correct).
  - `X-May-Act-Sub` = `userMayActSub` when provided, else legacy static resolution.
- Callers thread the per-user value from the session's user access token
  (`routes/oauthUser.js:1111-1122` already stores `accessTokenMayAct` at login):
  - `mcpGatewayClient.callToolViaGateway` — new opt, plumbed from `mcpToolPipeline.js`
    (same path `workloadActorClientId` already uses).
  - `mcpWebSocketClient.js` — same.
  - `demo_mcp_gateway/src/index.ts:1263` + `authorizeMcpRequest.ts:716` keep reading the
    header; no gateway change needed for the bridge itself.
- `routes/authorize.js:884` audit: confirm its bridge usage is consent-irrelevant or thread too.

### 3.3 `demo_authz_server/routes/decision.js` (mock parity — the new rule)

New **Rule 2.6 — per-user consent** (mirrors what the P1AZ snapshot will enforce):

- Fires only on `MCP_TOOL_CALL_CONTEXTS` and agent-mediated tools (same tool set as Rule 2.5).
- Skips A2A-delegated calls (Rule 1c path) and workload-agent calls (UC38/44) — their
  authorization is the act chain / workload resource, matching Rule 2's carve-outs.
- Logic: `MayActSub` present and `=== ActClientId` → pass; present but mismatched → DENY
  (`may_act_mismatch`); absent → DENY (`no_user_consent`) — because in default mode a
  missing consent must not fall back to "actor token is enough".
- ⚠️ Backward-compat: gateway tests hardcode `MayActSub: 'agent-1'` matching `ActClientId`
  — they keep passing. BFF-originated `McpFirstTool` calls must now also receive
  `MayActSub` (see 3.4) or every agent-mediated BFF call denies.
- `ENFORCE_MAY_ACT` comment block: replace the stale "removed" note with the live rule reference.

### 3.4 `demo_api_server/services/mcpToolAuthorizationService.js` (BFF-gate parity)

- `decodeMcpTokenFacts` / `buildMcpDelegationParameters`: add `MayActSub` from the
  session user token's `may_act.sub` (same per-user source as 3.2) so the BFF's own
  P1AZ decision evaluates consent identically to the gateway path.

### 3.5 P1AZ snapshot (live tenant parity)

- `p1az-import-generator` skill: add `MayActSub` `AttributeDefinition` + `ConditionDefinition`
  + rule ("agent-mediated tool && MayActSub ≠ ActClientId → DENY"), mirroring Rule 2.6.
- Produces a new import file; **live import is a deployment step, gated on the user** —
  do not push to the tenant from this work unilaterally.

### 3.6 Teaching copy (default mode reframe)

- `config/useCases.js` UC3 (`may-act-gate`): default copy teaches
  "the actor token identifies the agent; PingOne Authorize checks the user's consent
  (may_act) on **every** call — revoke and the next call is denied, no re-mint needed";
  flag-ON copy keeps the mint-time story. `pingOneSolution`/`whatToSay`/`whatLong`/`productRoles`.
- `MayActPanel.js`: a mode note (actor-token minting default; may_act seeding behind the flag),
  plus the vendor table from PR #1085 already positions this.
- `DelegationPage.js` Maya narrative: same reframe.
- Emoji allowlist (REGRESSION_PLAN §0) applies.

### 3.7 Unchanged (explicitly)

- `agentAuthorization.js` grant/revoke: clears `mayAct` + RFC 7009 revocation + reauth — works in both modes (in default mode the PDP rule is the second layer).
- A2A nested composer, `X-Act-Client-Id` bridge, Rule 2 (actor allowlist), Rule 2.5, PF
  SPIFFE `act` string form, `pf-pingone-user-gate.json` (consent read stays).
- `may_act` claim projection on user tokens (it is the RFC-sanctioned consent declaration
  and the PDP's per-user signal).

## 4. Why default mode is *stronger*, not weaker

Today, consent is checked once — at mint. A granted user's MCP token carries `act` until
expiry even after revocation (mitigated only by RFC 7009 + re-auth). In default mode the
PDP re-evaluates consent on **every** tool call from the bridged current-session value:
revoke → next call denied. Same UX, tighter enforcement, and it matches Ping's
"policy at the authorization server" positioning. The demo story improves:
*"may_act is checked by policy on every call"* vs *"may_act was baked in at mint"*.

## 5. Verification

- `demo_api_server`: `CI=true npm test -- --forceExit` (new: bridge per-user tests,
  provisioning SpEL mode tests).
- `demo_authz_server`: `npm test` (new Rule 2.6 tests: match / mismatch / absent / A2A skip /
  workload skip / non-agent-mediated skip).
- `demo_mcp_gateway`: `npm run build && npm test` (header passthrough unchanged).
- `demo_api_ui`: `npm run test:unit && npm run build`.
- Root: `npm run topology:verify`.
- Manual (flag OFF): re-provision → UC3 run → confirm `act.sub` = AI Agent minted from
  actor token → revoke → next agent call DENIED `no_user_consent` without waiting for
  token expiry → flag ON → re-provision → legacy behavior byte-identical.
- REGRESSION_PLAN §4 entry (shape-migration-scale change).

## 6. Risks / open questions

1. **Single-hop map-literal SpEL unproven live** — `${{'sub': #root.context.requestData.actorToken.client_id}}`. The nested composer is proven; verify this on the tenant before cutting over (provision a scratch resource first).
2. **P1AZ snapshot import** — live-tenant change; sequence after code parity is green.
3. **BFF-path `MayActSub` plumbing depth** — `mcpToolPipeline` must reach the session's user-token claims at call time; if the session is unavailable in some path (service-to-service), the safe fallback is omit → deny for agent-mediated tools (fail closed), with an explicit escape for workload agents.
4. **PingFederate mode** — PF's own ATM act mapping is already actor-based; only its user-gate reads the PingOne grant (consent), which stays. Confirm the PF exchange path still PERMITs in default mode during verification.
5. **Docs**: `docs/ACT_CLAIM_VERIFICATION.md` + ENV docs mention the may_act semantics — update both.
