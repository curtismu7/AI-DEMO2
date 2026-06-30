# Token Exchange (RFC 8693) — PingOne deep dive (reference)

> **Wired in the banking app?** ✅ **Partially — the basic exchange is.** The
> BFF performs RFC 8693 token exchange for MCP delegation (`SKILL.md` §7,
> `oauthService.performTokenExchange()`). The PingOne-internal constraints
> below are documented so you understand *why* the exchange behaves as it does
> and what is **not** supported. Source: Ping-internal RFC 8693 spec note
> ("OAuth 2.0 Token Exchange — info for selected customers", rev. Nov 14 2025).
>
> ⚠️ These are **forward-looking Phase-1 constraints** from that note (Ping
> targeted Phase 1 delivery ~2026 Q1). Treat them as the documented Phase-1
> contract, not a guaranteed description of what every PingOne environment
> enforces today — verify against your environment before relying on an edge
> (especially `requested_token_type=id_token` and the SPEL `context.*` surface).

This complements `SKILL.md` §7 — read that first for the request shapes and
`act`/`may_act` validation.

---

## ⚠️ Critical PingOne constraints (read before designing anything)

1. **Same-environment-only.** The `subject_token` and `actor_token` MUST be an
   access token or ID token **previously issued by the same PingOne
   environment**. A token from another PingOne environment — *even under the
   same organization* — or from any external authorization server is **not
   supported**. Cross-environment delegation is impossible at the protocol
   layer; design around it.
2. **No refresh token in the response.** PingOne does **not** include a
   `refresh_token` in a Token Exchange token response. The exchanged token is
   short-lived; re-run the exchange to mint a fresh one (this is exactly what
   `agentMcpTokenService.js` does — never try to "refresh" a T2/T3 token).
3. **Grant type is opt-in per app.** No application may use the Token Exchange
   grant until a PingOne administrator **explicitly enables** it on that
   application. Scopes requested via the `scope` parameter must also be added
   to the exchanging application (same processing as an authorization request).
4. **Token must be valid.** Subject/actor token must not be expired and must
   have a valid signature, or PingOne rejects the exchange.

---

## Supported `requested_token_type`

| `requested_token_type` | Resulting `access_token` in response |
|---|---|
| `urn:ietf:params:oauth:token-type:access_token` | An access token intended for one or more **custom resources** (the banking app's MCP case) |
| `urn:ietf:params:oauth:token-type:id_token` | The `access_token` field carries an **ID token** instead |

(`urn:ietf:params:oauth:token-type:id-jag` is a *future-phase* item, not
available — do not depend on it.)

---

## Attribute mapping with `context.requestData.*` SPEL

When `requested_token_type=access_token`, claim fulfillment is controlled by
the **attribute-mapping configuration of the applicable custom resource(s)**.
Administrators write SPEL expressions that can branch on token-request data:

| SPEL expression | Resolves to |
|---|---|
| `context.requestData.grantType` | the grant type used (branch behavior for token-exchange vs others) |
| `context.requestData.subjectToken[.claim]` | an individual claim from the subject token (e.g. `context.requestData.subjectToken.sub`) |
| `context.requestData.scope` | the `scope` parameter value on the exchange request |
| `context.appConfig.clientId` | exchanging app's client ID |
| `context.appConfig.tokenEndpointAuthMethod` | exchanging app's token endpoint auth method |
| `context.appConfig.envId` / `context.appConfig.orgId` | environment / organization IDs |

Example use: fulfill a claim differently when
`context.requestData.grantType == 'urn:ietf:params:oauth:grant-type:token-exchange'`,
sourcing its value from `context.requestData.subjectToken.sub` so the exchanged
token carries the original end-user identity.

---

## App-A-acts-as-client chained-resource pattern

The canonical Ping use case: a resource server that needs data from a *second*
resource server obtains a downstream token by acting as a client.

```
App X  --(access token for API A)-->  API A
                                        |
                                        |  API A needs data N from API B
                                        v
   API A acts as application "App A": Token Exchange request to PingOne
     client_id     = <client ID of App A>          (its own PingOne app record)
     subject_token = the access token from App X    (same-environment only)
     actor_token   = none
     scope         = B.r                            (must be allowed on App A)
       --> response: access token scoped B.r, issued to App A
   API A --(token scoped B.r)--> API B  --> data N
   API A returns data M to App X
```

Requirements for this pattern:

- A PingOne **application record** must exist for API A ("App A"): grant type
  **Token Exchange** enabled, allowed scopes `openid` + the downstream scopes
  (e.g. `B.r`).
- API A authenticates **as that application** (its own client ID + auth) when
  it sends the exchange — it is no longer "just a resource server."
- The `subject_token` is App X's original access token; PingOne enforces the
  same-environment rule on it.

This is the structural model behind the banking BFF's MCP delegation: the BFF
acts as the application, the user's token is the subject, and the exchanged
token is narrowed to the MCP resource audience (`SKILL.md` §7a/§7b).

---

## Practical implications for the banking BFF

- ✅ Keep minting T2/T3 by re-running the exchange — there is no refresh token
  to cache; cache the *exchanged access token* until `exp`, not a refresh.
- ✅ Subject token (user) and actor token (agent CC token) are both issued by
  the same PingOne environment in this project — the same-environment rule is
  satisfied by construction. Do not introduce a cross-environment token.
- ❌ Do not request `id-jag`; ❌ do not expect a `refresh_token`; ❌ do not feed
  an externally-issued token as `subject_token`/`actor_token`.
