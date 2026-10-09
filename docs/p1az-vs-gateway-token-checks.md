# What P1AZ checks on a token vs. what the Agent Gateway checks

Review of the code as of 2026-09-30. "Agent Gateway" here means the Node gateway in
`demo_mcp_gateway/` (the one the A2A path and `dual_token` tools use). PingGateway (IG)
and the PingOne Agent Privilege are covered briefly at the end.

Sources read: `demo_mcp_gateway/src/{tokenValidator.ts, auth/authorizeMcpRequestCore.ts,
auth/GatewayTokenPolicy.ts, auth/PingOneAuthorizeClient.ts, auth/toolScopes.ts,
middleware/authorizeMcpRequest.ts, rarEnforce.ts, tierEnforce.ts, dpopVerify.ts}`,
`snapshots/AI_Demo_Transaction_Authorization_P1AZ.snapshot.json`,
`snapshots/gen-authorize-snapshot.js`, `ping-gateway/scripts/groovy/p1az-decision.groovy`,
`docs/gateway-enforcement-map.md`.

## The one-paragraph answer

**P1AZ never sees the token.** It receives a flat map of ~40 string parameters that the
gateway (or BFF) extracted from the token and the request, and evaluates policy over those.
It cannot verify a signature, cannot check `exp`, cannot introspect. Everything about
whether the token is *genuine and live* is decided at the gateway before P1AZ is called.
P1AZ decides whether a genuine token, carrying these facts, may do this thing. Five checks
that P1AZ's policy DSL cannot express (no set-membership operator, ISO-vs-epoch time
mismatch) are enforced at the gateway instead.

## Order of operations on the Node gateway (HTTP path)

| # | Stage | Checks | Owner |
|---|---|---|---|
| 0 | `validateInboundToken` | signature via JWKS (fail closed on unknown/absent `kid`); `exp`; `nbf` (30s skew); `iat` not future and not older than 7200s; `iss` == `PINGONE_ISSUER_URI` when set; `aud` contains the gateway resource URI | Gateway |
| 1 | Introspection (RFC 7662) | token `active` | Gateway, **currently disabled** (see caveats) |
| 2 | `GatewayTokenPolicy` | `sub` non-empty; `act.sub` non-empty if `act` present; actor allow-list (depth < 2 only); D-05 anti-bypass; UC16 require-`act` (flag-gated) | Gateway |
| 3 | Rate limit, HITL receipt, intent token, DPoP, Web Bot Auth | see below | Gateway |
| 4 | RAR subset (RFC 9396) | tool in grant, amount <= granted, payee == granted | Gateway |
| 5 | Per-tool scope backstop | token scopes cover the tool's required scopes | Gateway |
| 6 | Tier backstop | tier tool restriction + tier amount ceiling | Gateway |
| 7 | **P1AZ decision** | business policy over the parameter map | P1AZ |
| 8 | RFC 8693 exchange to backend audience | only after PERMIT; inbound token is never forwarded | Gateway |

Every stage stamps `filterChain` in the audit trail. A stage that did not run is `skipped`
(audit value `null`), never `passed`.

## What the Agent Gateway checks in detail

**Cryptographic / temporal (`tokenValidator.ts`)**
- Signature against the JWKS. Key chosen by `kid`; a `kid`-less token is only accepted if
  the JWKS has exactly one key (stops attacker stripping `kid`). RS256/ES256 only.
  Unknown-`kid` refreshes are rate-capped to one per 10s.
- Three trusted issuers, each verified against its own JWKS: PingOne (default), oauth-mcp's
  embedded AS (native ID-JAG), PingFederate (`PF_ISSUER_URI`).
- No JWKS configured: refuses unless `MCP_GW_ALLOW_UNVERIFIED_TOKENS=true` (decode-only,
  reported in `/health authz.failOpen`). `STRICT_AUTH=true` never allows it.
- `exp`, `nbf`, `iat` (max age `MCP_GW_IAT_MAX_AGE_SECONDS`, default 7200), `iss`, `aud`.
  `nbf`/`iat`/`iss` are only enforced when the claim is present (`iss` only when
  `PINGONE_ISSUER_URI` is set).

**Identity (`GatewayTokenPolicy.ts`)**
- `sub` required. `act.sub` required if `act` present.
- Actor allow-list (`authorizedActorClientIds`), skipped for A2A nested-act tokens
  (depth >= 2), which are checked by P1AZ via `NestedActClientId`.
- D-05: `aud` must not contain an upstream MCP-server / banking-RS audience. Handles
  multi-aud. Exempt: tokens whose verified `iss` is oauth-mcp (ID-JAG).
- UC16: agent-mediated tools require an `act` claim. Off by default.

**Request-bound**
- DPoP (RFC 9449): proof signature, `htm`/`htu`, `ath`, `jti` replay, and `cnf.jkt` match.
  Mandatory for a token that carries `cnf.jkt` or when `REQUIRE_DPOP_PROOF=true`; otherwise
  observe-and-log.
- Web Bot Auth (RFC 9421): `MCP_GW_WBA_MODE` = off | monitor (default) | enforce.
- HITL receipt: verified and consumed (single use).
- Intent check: signature, expiry and permitted tools.
- RAR: actual call params must be a subset of `authorization_details`.
- Rate limit per agent/tool, flag-gated.

**Trust in headers.** `X-Act-Client-Id`, `X-May-Act-Sub`, tier headers are honoured only
with the shared `x-internal-gateway-secret`. Anything else is dropped.

## What P1AZ checks

P1AZ evaluates 3 policies under a `DenyOverrides` root. Inputs are the parameter map built
by `buildAuthorizeParameters()` (Node) and `p1az-decision.groovy` (IG), same 18+ keys.

**Token-derived inputs P1AZ is given** (already verified by the gateway): `ClientId`/`UserId`
(= `sub`), `ActClientId`, `NestedActClientId`, `ActChainDepth`, `MayActSub`, `TokenScopes`,
`TokenAudience`, `TokenAudActual`, `TokenIss`, `TokenExp/Iat/Nbf`, `Acr`,
`TokenKidKnown` (only sent when JWKS verification is on).

**Rules that read those (MCP Delegation policy)**

| Rule | Effect | Reads |
|---|---|---|
| Invalid Token Audience | DENY | `TokenAudience` in the accepted-gateway-audience allowlist (`HasValidMcpAudience`; external-door branch gated on `TokenIss`) |
| Missing User ID | DENY | `UserId` absent or `none` |
| Invalid Actor Chain | DENY | `ActClientId` not one of 25 registered identities |
| Invalid A2A Generalist | DENY | A2A tool called without depth-2 delegation / wrong `NestedActClientId` |
| Audience Targets Upstream | DENY | `TokenAudActual` equals one upstream audience (single-aud only) |
| Invalid Signing Key | DENY | `TokenKidKnown` == false (inert when omitted) |
| Step-up for sensitive tools | PERMIT + obligation | tool is step-up-gated and `Acr` != `Multi_Factor` |
| HITL consent | PERMIT + obligation | tool is consent-gated and `HitlApproved` != true |

**Rules that read the request, not the token:** amount bands ($250 consent, $500 step-up,
$2,000 deny), UC21 tier tool/amount cap, UC9 group membership, resource-owner mismatch,
admin-role-on-write-tool, RAR amount ceiling, intent-token tamper/tool mismatch,
autonomous-agent mandate, and the Agent Intent Governance policy (grant vs. request drift
on action, payee, amount; grant expiry; user consent).

**P1AZ does NOT check:** signature, `exp`/`iat`/`nbf` (params are sent but no rule reads
them), revocation, `iss` correctness beyond the external-door exemption, DPoP, or scope
membership.

## Split by design: the five checks P1AZ cannot express

From `gen-authorize-snapshot.js` ("DELIBERATELY NOT MODELED") and
`docs/gateway-enforcement-map.md` (10/10 live):

| Check | Why P1AZ can't | Enforced at |
|---|---|---|
| Temporal exp/iat/nbf | `Timestamp` is ISO string, claims are epoch | Node `tokenValidator.ts`; IG groovy local deny |
| Per-tool scope membership | `TokenScopes` is a space-joined set, no contains operator | Node `toolScopes.ts`; IG groovy |
| RAR payee allow-list | permitted payees are an array | Node `rarEnforce.ts`; IG delegates to P1AZ amount rule |
| D-05 multi-aud | `TokenAudTargetsUpstream` compares one string | Node `GatewayTokenPolicy.ts`; IG groovy |
| tiers.groupToTier | group array to tier needs set membership; BFF sends scalar `UserTier` | Node `tierEnforce.ts`; IG groovy |

## Findings worth acting on

1. **Introspection is off on the Node gateway** (`GW_INTROSPECTION_ENABLED=false`, #1016).
   PingOne scopes introspection to the issuing client, and A2A tokens come from five
   specialist clients, so one introspection client cannot cover them. Consequence: **a
   revoked-but-unexpired token is accepted on the Node path.** Only IG (`f4dd707d`)
   introspects for real. The core refuses to run with introspection off *and* no JWKS, so
   it cannot be both, but JWKS gives you signature + expiry, not revocation.
2. **`aud` is checked twice, differently.** Gateway: token `aud` contains any accepted
   gateway URI. P1AZ: `TokenAudience` in its own baked-in allowlist. The two lists live in
   different places (config vs. snapshot generated from `scope-topology.json`) and can drift.
   `McpResourceUri` is sent but *not compared*; older comments claim it is.
3. **Amount defaults to `'0'`, not omitted**, because omitted `Amount` makes P1AZ return
   INDETERMINATE and fail every read closed. This is safe only because write tools require
   `amount` in their schema.
4. **INDETERMINATE with no obligation is treated as DENY** at the gateway (fail closed).
   Two meanings of INDETERMINATE exist ("P1AZ could not evaluate" vs. "PERMIT pending a
   gate"); this is the collapse point.
5. **Unsigned `X-TraT-Context` is honoured** only when `ALLOW_UNSIGNED_TRAT_CONTEXT=true`.
   RAR grants and `cnf.jkt` come from it in simulated mode, so RAR is only as trustworthy
   as who built the header (the BFF), not an independent grant.
6. **Web Bot Auth defaults to `monitor`**, i.e. verifies and audits but does not block.
7. **Optional claims are optional.** `nbf`, `iat`, `iss` are not required to be present, so
   a token that omits them skips those checks.

## Other gateways (not code-reviewed here)

- **PingGateway (IG)**: same P1AZ call via `p1az-decision.groovy`; validates tokens by real
  PingOne introspection (`01-mcp-olb.json`) or JWKS (`00-mcp-olb-jwks.json`), switched by
  `ff_mcp_gateway_jwks` / `X-Token-Validation`. Fails closed on DENY, INDETERMINATE, error,
  timeout, or unconfigured backend.
- **PingOne Agent Privilege** (Procyon / agentless MCPGW): from memory notes, not
  re-verified against live behavior today. Binds every token to **one Agentic App** and
  rejects it on any other; bearer check runs before routing; then a Privilege policy check
  ("policy denied <userID> access to <app>", a 403, on the federated identity). A 401 does
  not distinguish wrong-app, not-signed-in, or nonexistent-app; only the gateway log does.
  Procyon agent frontends send no Authorization header; the agent is the identity.
