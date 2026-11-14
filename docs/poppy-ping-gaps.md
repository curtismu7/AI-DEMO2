# Poppy (Personal Agent Protocol) — what PingOne and PingFederate are missing

Spec: Personal Agent Protocol (Poppy) **Draft 0.4** (1.0 RC, 2026-11-10), <https://personalagentprotocol.org/docs/0.4/spec>.
What we run today: AI-DEMO2 as the Company (poppy.json, protected resource, `/poppy/api/v1/me` with Poppy-Session verification), PingFederate as the issuer (CIMD client, private_key_jwt, token manager with client_id from the request), and the poppy-agent-tester lab as the Personal Agent. The happy path — discover, Direct Sign-In, token, signed-in API call — **works end to end** against real PF + the demo Company.

This document lists every spec requirement we could not meet with current product features, per product. Each row is a concrete, testable ask — useful for product/PM conversations.

Status labels: **GAP** = not supported, we built a workaround or do without. **PARTIAL** = supported with configuration but not the spec's exact shape. **OK** = works.

---

## 1. PingFederate gaps

| # | Spec requirement (section) | Status | What PF does today | What is needed |
|---|---|---|---|---|
| PF-1 | Issuer metadata MUST list `protected_resources` including the Company domain, with no path/port (§3.2) | **GAP** | PF publishes RFC 8414 metadata but has no `protected_resources` field. We run a TLS metadata shim in front of PF that adds it. | A setting to declare protected resources on the OAuth AS so RFC 9728 §4 `protected_resources` appears in `/.well-known/oauth-authorization-server`. |
| PF-2 | Redirect response MUST carry `iss` (RFC 9207), including on error (§4.2) | **PARTIAL** | PF supports RFC 9207 on the authorization response. We did not have to work around it, but error-response `iss` was not separately verified in our testing. | Confirm/enable `iss` on **all** authorization responses including `error=access_denied`. |
| PF-3 | CIMD client caching (§4.1) | **PARTIAL** | PF caches a fetched CIMD client document for ~5 minutes with no invalidation control. During development, policy/metadata changes took that long to appear; a revoked agent stays accepted up to the TTL. | A shorter/admin-configurable CIMD cache TTL, and an admin action to evict a cached client document immediately (kill switch for a rogue agent). |
| PF-4 | Device Sign-In: `device_authorization_endpoint` (§4.3) | **GAP** | PF's device grant exists but was not configured/verified for a CIMD client; our demo uses Direct Sign-In only. | Device grant support for CIMD clients (the spec requires it if `grant_types_supported` lists `urn:ietf:params:oauth:grant-type:device_code`). |
| PF-5 | Refresh tokens with client assertion (§4.4) | **PARTIAL** | Refresh works with the standard grant; we did not exercise refresh for a CIMD client end to end. | Verify refresh + revocation for CIMD clients; the spec requires `refresh_token` in `grant_types_supported`. |
| PF-6 | Scope granting MUST NOT exceed what was requested (§4.7) | **PARTIAL** | PF grants from the policy/mapping; the consent page shows every scope the AS advertises (55 in our deployment, most belonging to other demos) and the checked-scope box on consent must stay checked or the token has no scope. | Per-client scope allow-listing for CIMD clients (the client metadata has no `scope` field to intersect with), and consent that shows only the requested scopes. |
| PF-7 | Assertion `aud` MUST be the issuer exactly, char for char (§4.1, per RFC 7523bis) | **OK** | PF rejects `aud` set to the token endpoint URL; ours requires the issuer. | — |
| PF-8 | Client assertions MUST be ES256 (SHOULD PS384) (§4.1) | **OK** | PF accepts ES256; PS384 untested. | Verify PS384. |

### PF — the two that matter most

1. **`protected_resources` in AS metadata (PF-1).** Without it, any domain could claim another Company's issuer and receive its tokens; the spec makes agents refuse metadata without it. Today only our shim satisfies it.
2. **Per-client scopes + CIMD cache control (PF-6, PF-3).** These decide whether a Company can actually run an agent program: least privilege per agent, and instant revocation.

## 2. PingOne (platform / DaVinci / Protect) gaps

PingOne is not used in our Poppy flow today (PF is the issuer). These are the asks if PingOne (CIM/B2B) wants to be the issuer for a Poppy Company.

| # | Spec requirement (section) | Status | What is needed in PingOne |
|---|---|---|---|
| P1-1 | AS metadata `protected_resources` (§3.2) | **GAP** | Same as PF-1: a way to declare the protected resource (the Company domain) so `protected_resources` appears in the issuer metadata. |
| P1-2 | CIMD clients: `client_id` is a URL, fetched at authorization time (§4.1) | **GAP** | PingOne applications are pre-registered; there is no dynamic "fetch client metadata from a URL" client type. Needed: accept a CIMD client (validate `client_id` == fetched document URL, `jwks_uri` on same host, `redirect_uris` from the document, private_key_jwt with keys from `jwks_uri`). |
| P1-3 | Client assertion `aud` = issuer, exactly (§4.1) | **GAP** | PingOne expects token-endpoint audience conventions; the spec (RFC 7523bis direction) demands issuer-only. |
| P1-4 | Scope advertising per resource (§4.7) | **PARTIAL** | PingOne scopes exist but are not organized "per protected resource" for agents, and there is no `scope_hints` concept. Needed: scope descriptions + `changes`/`personal_data` hints the Company publishes, and enforcement that granted ⊆ requested. |
| P1-5 | Refresh token + revocation endpoints (§4.4, §4.6) | **PARTIAL** | PingOne has refresh/revocation; verify they accept private_key_jwt client authentication for CIMD-style clients. |
| P1-6 | Pairwise `sub` the AGENT chooses (§5.1) — the User ID is assigned by the Personal Agent, not the IdP | **GAP (conceptual)** | IdPs mint their own `sub`. Poppy tokens carry the agent-assigned pseudonymous User ID in the Session JWT; the OAuth token's `sub` is separate. Product positioning note, not a bug. |
| P1-7 | Per-client scope limiting at consent (§4.7) | **GAP** | Consent must show only requested scopes and grant ⊆ requested. |

## 3. Also verified working (so nobody re-tests these)

- CIMD client resolution on PF (client_id = URL, document fetched, `jwks_uri` same-host rule enforced by our resolver).
- private_key_jwt client authentication, header typ `client-authentication+jwt`, `aud` = issuer.
- Direct Sign-In: authorization code + PKCE, consent screen, RFC 9207 `iss` check on the callback.
- Poppy-Session verification on the resource: delegation (≤24h, `cnf.jwk`, kid = thumbprint), session signature, `htm`/`htu`, `iat` window, `ath` hash of the access token, jti replay refusal, sid binding (User + agent + client), signed-out Sessions (§5.3, spec 5.3).
- poppy.json checks: `protocol_version` 0.3, `organization.domain` == host, scope_hints present, resource == origin, authorization_servers listing.

## 4. Known version skew

- Our Company publishes `protocol_version: "0.3"` and the tester speaks 0.3. Draft 0.4 (1.0 RC) adds `Poppy-Version`/`Poppy-Extensions` headers, `version_unsupported`, `supported_versions`, `auth.disabled`, Device Sign-In requirements, and the `poppy:browser-sign-in` scope. **Next step:** bump the Company and tester to 0.4 (see `/docs/0.4/spec` §3.4 for the dual-version mechanism so 0.3 agents keep working during transition).
