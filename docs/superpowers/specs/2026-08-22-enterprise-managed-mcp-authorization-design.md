# Enterprise-Managed MCP Authorization — native ID-JAG and centralized revocation

**Date:** 2026-08-22
**Status:** Design approved, implementation not started
**Spec:** [io.modelcontextprotocol/enterprise-managed-authorization](https://modelcontextprotocol.io/extensions/auth/enterprise-managed-authorization) · [normative text](https://github.com/modelcontextprotocol/ext-auth/blob/main/specification/stable/enterprise-managed-authorization.mdx) · SEP-990

**Supersedes Phase 3 of** `planning/ENTERPRISE-MANAGED-MCP-AUTH-PLAN.md`. That
plan's Phases 1–2 shipped and are the baseline described in §1. Its Phase 3 is
titled *"blocked on PingOne product"*; §1 and §2 below show only part of it is.
Its Phase 4 (IT admin UX) is untouched and remains open.

---

## 1. Why this exists

The MCP Enterprise-Managed Authorization extension is already showcased in this
demo across three surfaces:

| Surface | What it does today |
|---|---|
| **UC25** — Enterprise-managed MCP access | Behind `ff_enterprise_managed_mcp_auth`: group gate, auto-connect, no per-server consent |
| **UC-LEARN8** — EMA education panel | Explains the extension; "In This Demo" tab documents live-vs-spec |
| **UC-LEARN9** — ID-JAG / Cross-App Access panel | Explains the grant the extension exchanges |

Supporting code that already exists and is **not** changing:

- `services/enterpriseMcpMetadata.js` — RFC 9728 extension block
- `services/enterpriseMcpPolicyService.js` — PingOne group/population gate
- `routes/protectedResourceMetadata.js` — advertises the extension
- `routes/tokenChain.js` — renders `mode: enterprise-managed`

The gap is that **no ID-JAG is ever minted or redeemed.** UC25 performs an
RFC 8693 token exchange at PingOne and labels the result
`idJagStandIn: true`. That is an honest stand-in, but three consequences follow:

1. The token carrying the tool call is a PingOne access token, not a grant
   redeemed at the MCP Authorization Server. The spec's central mechanic is
   absent.
2. `EnterpriseManagedAuthPanel.js:205` calls all of Phase 3 *"blocked on
   PingOne product."* Only one of its three items is. The MCP Authorization
   Server is `oauth-mcp` — our own code — and nothing external prevents it
   accepting the grant.
3. The spec's strongest enterprise claim — centralized revocation — is not
   demonstrated anywhere.

This design closes 1 and 3, and corrects 2.

### Non-goals

- Native PingOne ID-JAG issuance. PingOne does not support
  `requested_token_type=urn:ietf:params:oauth:token-type:id-jag`. This design
  is structured so that swapping to it later is a configuration change
  (§4.6), not a rewrite.
- Changing the flag-OFF path. See §6.
- Changing `/api/demo/xaa` (Protocol Playground mock). See §3.3.

---

## 2. Role mapping

The spec names four actors. Mapped onto this repo:

| Spec actor | This demo |
|---|---|
| Enterprise IdP | PingOne (SSO + group policy) **+ new BFF endpoint that signs the ID-JAG** |
| MCP Client | BFF agent path (`agentMcpTokenService`) |
| MCP Authorization Server | `oauth-mcp` embedded AS (`OAuthRouter` / `TokenIssuer`) |
| MCP Resource Server | `oauth-mcp` tool endpoints |

The split of "Enterprise IdP" across PingOne and the BFF is the one deliberate
compromise. PingOne remains the authority for **identity and policy** — who the
user is, and which groups they belong to. The BFF only performs the
**signing** step PingOne cannot yet perform. §4.6 covers collapsing this.

### Why `oauth-mcp` is cheap to extend

`TokenIntrospector.ts:337` already accepts embedded-issuer tokens alongside
PingOne ones, verifying against the local RSA key. An access token issued by
`oauth-mcp`'s own AS is therefore **already** a first-class accepted credential
at the resource server. No gateway change, no introspection change, no new
trust relationship on the resource side.

---

## 3. Key constraints discovered

### 3.1 `alg: none` cannot be promoted

`demo_api_server/utils/demoJwt.js` mints unsigned JWTs and documents itself as
"never verified or trusted anywhere else in the app." The existing ID-JAG
minter at `routes/xaaIdJagDemo.js` uses it.

That minter **must not** be promoted to feed a real token endpoint. An
authorization server accepting an `alg: none` bearer grant accepts forged
assertions from anyone — the assertion *is* the authorization. This is a
security boundary, not a simplification to trade away.

Therefore the ID-JAG path needs a real RS256 key and real signature
verification.

### 3.2 The policy gate runs one hop too late

`enterpriseMcpPolicyService.checkPolicy` currently runs in the BFF *after*
PingOne has already minted a token. The spec states the IdP evaluates policy
**before** issuing, and that "the MCP client never receives a token for
unauthorized servers."

The fix is a call-site move, not a rewrite: the same service is called from
inside the ID-JAG mint, and a denied user receives an OAuth error response
instead of an assertion.

### 3.3 `/api/demo/xaa` stays as-is

`routes/xaaIdJagDemo.js` is wired to the Protocol Playground and generated
`protocolFlows.json` via its JSDoc `@flow` annotations. It teaches the wire
shape with decodable, deliberately-invalid tokens. It is left untouched;
the new path is separate.

---

## 4. Phase A — real ID-JAG mint and redemption

### 4.1 New: BFF enterprise IdP signing key

**File:** `demo_api_server/services/enterpriseIdpKey.js`

Memoised RS256 key singleton with `ENTERPRISE_IDP_SIGNING_KEY_PEM` override,
generating an ephemeral pair when unset. Mirrors the structure of
`oauth-mcp/src/oauth/SigningKeyManager.ts` and `embeddedIssuer.ts` — a proven
pattern in this repo — rather than inventing a new one.

Exports: `getPrivateKey()`, `getPublicJwk()`, `getKid()`.

**Not** reusing the `private_key_jwt` key from `clientAssertionService.js`.
That key is the BFF's identity as an OAuth *client* to PingOne; using it to
sign IdP assertions conflates two trust roles, and it is frequently
unconfigured (`getPrivateKeyPem()` returns `''`), which would make the
demo fail in a confusing way.

### 4.2 New: BFF enterprise IdP endpoints

**File:** `demo_api_server/routes/enterpriseIdp.js`, mounted at
`/api/enterprise-idp`.

#### `GET /jwks`

Public JWKS so `oauth-mcp` can verify assertions. Single RS256 key, `use: sig`.

#### `POST /token`

RFC 8693 token exchange issuing an ID-JAG.

Request:

```
grant_type=urn:ietf:params:oauth:grant-type:token-exchange
requested_token_type=urn:ietf:params:oauth:token-type:id-jag
subject_token=<the user's PingOne ID token>
subject_token_type=urn:ietf:params:oauth:token-type:id_token
audience=<oauth-mcp AS issuer>
resource=<MCP server resource URI>
scope=<requested tool scopes>
```

Processing:

1. Validate the subject token belongs to the current session user.
2. **Evaluate policy** — `enterpriseMcpPolicyService.checkPolicy(req)`.
   On DENY, return `403` with OAuth error body
   `{ error: 'access_denied', error_description: <policy message> }` and the
   existing `enterprise_mcp_policy_denied` code preserved for the UI. No
   assertion is minted.
3. Validate `audience` matches the configured MCP AS issuer, and `resource`
   is in `enterpriseMcpPolicy.getAllowedResourceUris()`.
4. Mint the ID-JAG.

ID-JAG shape, per the normative spec:

```jsonc
// header
{ "typ": "oauth-id-jag+jwt", "alg": "RS256", "kid": "<kid>" }
// claims
{
  "jti": "<uuid>",                       // single-use, replay-checked
  "iss": "<ENTERPRISE_IDP_ISSUER>",
  "sub": "<PingOne user id>",            // primary account-link identifier
  "email": "<user email>",               // fallback account-link identifier
  "aud": "<oauth-mcp AS issuer>",
  "resource": "<MCP server resource URI>",
  "client_id": "<BFF MCP client id>",
  "iat": <now>,
  "exp": <now + 120>,                    // short: see §5.3
  "scope": "<granted tool scopes>"
}
```

Response:

```json
{
  "issued_token_type": "urn:ietf:params:oauth:token-type:id-jag",
  "access_token": "<the ID-JAG>",
  "token_type": "N_A",
  "expires_in": 120
}
```

### 4.3 New: `oauth-mcp` accepts the grant

**File:** `oauth-mcp/src/oauth/IdJagGrantHandler.ts`

Verification, in order — every step fail-closed:

1. Decode header; require `typ === 'oauth-id-jag+jwt'`.
2. Verify RS256 signature against `ENTERPRISE_IDP_JWKS_URL` using
   `jose.createRemoteJWKSet` (cached; `jose` is already a dependency).
3. `iss` equals `ENTERPRISE_IDP_ISSUER`.
4. `aud` equals `resolveEmbeddedIssuer()` — this AS's own issuer.
5. `resource` is present and accepted by `audienceAccepted()`.
6. `exp` / `iat` valid, with small clock skew tolerance.
7. **`jti` single-use.** In-memory replay cache keyed on `jti`, TTL = assertion
   lifetime. A replayed assertion is rejected. Without this, a captured
   assertion is reusable for its whole lifetime.

Then:

8. **Account linking** — resolve `sub` first; fall back to `email` only when
   `sub` matches nothing, exactly as the spec directs for accounts predating
   enterprise-managed auth.
9. Issue an embedded-issuer access token via `TokenIssuer`, with
   `aud = resolveOwnAudience()` and scope **intersected** with the assertion's
   `scope` — never widened.

`ponytail:` in-memory replay cache, single-process. A shared store is needed
only if `oauth-mcp` is scaled to multiple replicas.

**Edit:** `oauth-mcp/src/oauth/OAuthRouter.ts:326` — add the
`urn:ietf:params:oauth:grant-type:jwt-bearer` case ahead of the
`unsupported_grant_type` fallthrough, delegating to the handler.

**Edit:** `oauth-mcp/src/oauth/OAuthRouter.ts:67` — AS metadata gains, only
when native mode is active (§4.5):

```json
"grant_types_supported": ["authorization_code", "client_credentials",
                          "urn:ietf:params:oauth:grant-type:jwt-bearer"],
"authorization_grant_profiles_supported": ["urn:ietf:params:oauth:grant-profile:id-jag"]
```

### 4.4 Edit: BFF agent path uses the real grant

**File:** `demo_api_server/services/agentMcpTokenService.js`

When enterprise-managed mode is on **and** native mode is configured, replace
the PingOne RFC 8693 exchange with:

1. `POST /api/enterprise-idp/token` → ID-JAG
2. `POST <oauth-mcp>/token` with `grant_type=...jwt-bearer`,
   `assertion=<ID-JAG>`, `client_id=<BFF MCP client id>` → MCP access token
3. That token carries the tool call.

Naming follows the existing plan: the client half (mint request + redemption)
lives in `demo_api_server/services/idJagService.js`, the name Phase 3 of
`ENTERPRISE-MANAGED-MCP-AUTH-PLAN.md` already reserved.

Token Chain events become real rather than relabelled:

- The `enterprise-managed-mode` event sets `idJagStandIn: false`.
- A new `id-jag-issued` event carries the decodable assertion, so
  TokenInspector shows genuine `typ`, `resource`, and `scope` claims.
- A new `id-jag-redeemed` event records the MCP AS issuing the access token.

Two new event kinds means the **render path** needs them, not just the emitter:
`demo_api_ui/src/components/TokenChainDisplay.jsx` and
`demo_api_ui/src/services/traceGraph.js` both branch on ID-JAG today and must
learn the new steps, or the events emit into a chain that does not draw them.

### 4.4b MCP client declares the extension

The spec's first client requirement is declaring support in per-request
`_meta`. Without it the client is not conformant even when the token flow is:

```jsonc
"_meta": {
  "io.modelcontextprotocol/clientCapabilities": {
    "extensions": { "io.modelcontextprotocol/enterprise-managed-authorization": {} }
  }
}
```

Emitted from `langchain_agent/src/mcp/connection.py` on `initialize`, per
Phase 3 of the existing plan.

### 4.5 Activation — auto-engage, no new flag

Native mode engages when **both** `ENTERPRISE_IDP_ISSUER` and
`ENTERPRISE_IDP_JWKS_URL` are configured. Otherwise the existing RFC 8693
stand-in runs unchanged.

Both are unset by default, so **the default demo behaviour does not change**.
This follows how `resolveEmbeddedIssuer` and `getAllowedResourceUris` already
degrade, and avoids adding a Quick Flag whose value would rarely move.

New config keys (`configStore`, all defaulting empty/unchanged):

| Key | Default | Purpose |
|---|---|---|
| `enterprise_idp_issuer` | `''` | ID-JAG `iss`; enables native mode |
| `enterprise_idp_jwks_url` | `''` | Where `oauth-mcp` fetches verification keys |
| `enterprise_mcp_policy_cache_ttl_ms` | `300000` | Unchanged default; see §5.2 |

### 4.6 The path to native PingOne

When PingOne ships ID-JAG issuance, the change is:

- Point `enterprise_idp_issuer` and `enterprise_idp_jwks_url` at PingOne.
- Call PingOne's token endpoint instead of `/api/enterprise-idp/token`.

`oauth-mcp` needs **no change** — it already verifies a remote JWKS from a
configured issuer. The BFF IdP endpoint becomes dead code and is deleted.
This is the reason for remote-JWKS verification rather than a shared local key.

---

## 5. Phase B — centralized revocation (UC39)

### 5.1 The scenario

`UC39` — *IT revokes MCP access centrally*. Track: `controls`.

1. User is in the allowed group; agent tool calls succeed.
2. Presenter removes the user from the group **in the PingOne console**.
3. Next tool call: the IdP refuses to mint an ID-JAG →
   `enterprise_mcp_policy_denied` (403).
4. Token Chain shows the refusal at the IdP step — not a downstream rejection.

Real PingOne group removal is the demo default;
`enterpriseMcpPolicyService.listPingOneGroupNames` already reads live group
membership via the Management API, so no new integration is required.

### 5.2 Blocker: the policy cache

`enterpriseMcpPolicyService.CACHE_TTL_MS = 5 * 60 * 1000` means a revoked user
stays permitted for up to five minutes — long enough to make a live demo look
broken.

Make the TTL read `enterprise_mcp_policy_cache_ttl_ms`, **default unchanged at
300000**. The demo sets it low; nothing else changes.

### 5.3 Blocker: the already-issued access token

Denying the *next* mint does not invalidate a token already in hand. Two
mitigations, both required:

- ID-JAG lifetime is 120s (§4.2), so no long-lived assertion survives.
- On a DENY where the session holds an MCP access token, the BFF calls
  `oauth-mcp`'s existing `/revoke` endpoint for it. The next tool call 401s
  rather than succeeding on a stale token.

### 5.4 Offline behaviour

If the PingOne Management API is unreachable,
`listPingOneGroupNames` returns `null` and the existing `demoGroupsForUser`
fallback applies. UC39 is documented as requiring a live tenant; the fallback
is not presented as revocation.

---

## 6. What must not break

Per `REGRESSION_PLAN.md` §1, this touches the live agent token path. Stated
explicitly:

- **Flag OFF** (`ff_enterprise_managed_mcp_auth` false): no code path changes.
  The new route is mounted but unreachable by the agent path.
- **Flag ON, native unconfigured** (the default): today's RFC 8693 stand-in
  runs byte-identically. This is the regression surface that matters most,
  because it is what every existing demo does today.
- **PingOne login, session handling, token audience checks**: untouched. The
  new IdP endpoint reads the session; it does not modify authentication.
- **`/api/demo/xaa`**: untouched.
- **Gateway token validation**: untouched — embedded-issuer tokens are already
  accepted (§2).
- **Emoji allowlist** (§0): new UI copy uses allowlisted emoji only.

---

## 7. Testing

| Area | Test |
|---|---|
| ID-JAG shape | Minted assertion has `typ: oauth-id-jag+jwt` and every required claim |
| Policy DENY | Denied user receives an OAuth error and **no** assertion is minted |
| Signature | Assertion signed by the wrong key is rejected by `oauth-mcp` |
| `alg: none` | An `alg: none` assertion is rejected — explicit regression guard for §3.1 |
| Replay | Same `jti` twice → second redemption rejected |
| Audience | `aud` naming another AS is rejected |
| Resource | `resource` outside the accepted set is rejected |
| Scope | Redeemed token's scope never exceeds the assertion's |
| Account linking | `sub` match wins; `email` used only when `sub` matches nothing |
| Metadata | `authorization_grant_profiles_supported` present in native mode, absent otherwise |
| **Stand-in unchanged** | Flag ON + native unconfigured produces the same token events as today |
| Revocation | Group removal → next call denied at the IdP; prior token revoked |
| Client capability | `initialize` carries the `_meta` extensions block |
| Token Chain render | `id-jag-issued` / `id-jag-redeemed` actually draw, not just emit |
| **Deploy parity** | Enterprise mode works on Docker **and** SE K8 — carried over from the existing plan's Phase 3 acceptance criteria; `ENTERPRISE_IDP_JWKS_URL` must resolve in-cluster, where BFF and `oauth-mcp` are separate pods |

Scoped runs (per `CLAUDE.md`):

- `cd oauth-mcp && CI=true npx jest src/oauth/__tests__/IdJagGrantHandler.test.ts`
- `cd demo_api_server && CI=true npx jest <touched paths> --forceExit`
- `npm run authz:verify` — UC39 must be registered in `auth-requirements.json`
- `npm run topology:verify` — cross-service change

---

## 8. Documentation to correct

`demo_api_ui/src/components/education/EnterpriseManagedAuthPanel.js:205`
currently labels all three Phase 3 items *"blocked on PingOne product."*
After Phase A, only native PingOne ID-JAG issuance is. The panel must
distinguish what is implemented from what is genuinely blocked — the same
honesty the current stand-in labelling already shows.

---

## 9. File inventory

**New**

- `demo_api_server/services/enterpriseIdpKey.js` — RS256 key singleton
- `demo_api_server/routes/enterpriseIdp.js` — demo IdP: `/jwks`, `/token`
- `demo_api_server/services/idJagService.js` — client half: mint + redeem
- `oauth-mcp/src/oauth/IdJagGrantHandler.ts`
- tests per §7

**Edited**

- `oauth-mcp/src/oauth/OAuthRouter.ts` — grant case + metadata
- `demo_api_server/services/agentMcpTokenService.js` — mint/redeem path
- `demo_api_ui/src/components/TokenChainDisplay.jsx` — render new steps
- `demo_api_ui/src/services/traceGraph.js` — render new steps
- `langchain_agent/src/mcp/connection.py` — `_meta` extension declaration
- `demo_api_server/services/enterpriseMcpPolicyService.js` — configurable TTL
- `demo_api_server/services/configStore.js` — three keys
- `demo_api_server/server.js` — mount the route
- `demo_api_server/config/useCases.js` — UC39
- `demo_api_server/config/auth-requirements.json` — UC39
- `demo_api_ui/src/components/education/EnterpriseManagedAuthPanel.js` — §8

**Untouched by design**

- `demo_api_server/routes/xaaIdJagDemo.js`
- `demo_api_server/utils/demoJwt.js`
- gateway token validation
