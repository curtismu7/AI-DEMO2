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
| PF-2 | Redirect response MUST carry `iss` (RFC 9207), including on error (§4.2) | **PARTIAL (setting exists, off by default)** | PingFederate 13.1.3 sends `iss` only when Authorization Server Settings, "Include issuer in authorization response" (admin API field `includeIssuerInAuthorizationResponse`) is on. It was off here: the redirect carried a `code` and no `iss` (measured 2026-11-17, two real sign-ins), and the metadata did not advertise `authorization_response_iss_parameter_supported`. Switched on 2026-11-17: the redirect now carries `iss` equal to the issuer, character for character, and the metadata advertises the parameter. | Ship the setting on for Poppy deployments (it is off by default). The `access_denied` redirect was not re-checked after enabling. |
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
- Direct Sign-In: authorization code + PKCE, consent screen, RFC 9207 `iss` check on the callback. poppy-verification-LAB refuses a redirect with a missing or wrong `iss` (spec 4.2); PingFederate sends it only with the PF-2 setting on.
- Poppy-Session verification on the resource: delegation (≤24h, `cnf.jwk`, kid = thumbprint), session signature, `htm`/`htu`, `iat` window, `ath` hash of the access token, jti replay refusal, sid binding (User + agent + client), signed-out Sessions (§5.3, spec 5.3).
- `Poppy-Version` check on every Session request (spec 3.4: missing or another major version is `version_unsupported`, HTTP 400); the delegation header is `poppy_dlg` and its JWT type `poppy-delegation+jwt` (spec 1.0 names).
- poppy.json checks: `protocol_version` 1.0 (the tester accepts any 1.x), `organization.domain` == host, scope_hints present, resource == origin, authorization_servers listing.

## 4. Version status

- Both sides speak spec **1.0** (2026-11-15): the Company publishes `protocol_version: "1.0"`, verifies `Poppy-Version` and the renamed `poppy_dlg` / `poppy-delegation+jwt`; the tester sends `Poppy-Version: 1.0` on every Session request, accepts any 1.x Company, and uses PAR (RFC 9126) whenever the issuer metadata lists the endpoint.
- Not done, not audited against 1.0: `supported_versions` (we serve 1.0 only, so 0.3 agents are refused with `version_unsupported`), `Poppy-Extensions`, `auth.disabled`, Device Sign-In requirements and the `poppy:browser-sign-in` scope. Read spec 1.0 sections 3.4, 4.3 and 6 before claiming full conformance.
