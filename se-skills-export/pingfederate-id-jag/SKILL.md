---
name: pingfederate-id-jag
description: Use when configuring PingFederate 13.1+ to issue or accept an ID-JAG (Identity Assertion JWT Authorization Grant, cross-app access) via OAuth token exchange (RFC 8693), including refresh-token-to-ID-JAG exchange, processor policies, the OAuth Token Exchange SP connection, JWT Bearer Grant Processor on the resource side, or debugging token-exchange errors. Also use for any "ID-JAG", "id-jag", or "oauth-id-jag+jwt" request.
---

# PingFederate ID-JAG

An ID-JAG is a short-lived JWT (`typ` header `oauth-id-jag+jwt`) that an identity provider issues in exchange for a subject token. The client then presents it as a JWT bearer assertion to a resource authorization server for an access token. PingFederate supports the issuing side from 13.1. This is RFC 8693 token exchange producing a different token type, not the nested-`act` delegation in the `a2a-protocol` skill; do not conflate them.

Verify every step and field against `https://docs.pingidentity.com/pingfederate/13.1/administrators_reference_guide/pf_configuring_refresh_token_to_idjag_exchange.md`. A running PingFederate is assumed (`pingfederate-install`).

## Issuing side (PingFederate is the IdP)

Prerequisite: PingFederate already issues refresh tokens to the requesting client, and you know the downstream resource authorization server's identifier.

1. **Token Processor** (Authentication > Token Exchange > Token Processors): create an *OAuth Refresh Token Token Processor*. Extended-contract attribute names must match the persistent-grant attribute names exactly, including case.
2. **Processor Policy** (Applications > Token Exchange > Processor Policies): map that processor as the subject token processor. Subject token type is `urn:ietf:params:oauth:token-type:refresh_token`. Fulfil the attribute contract and add issuance criteria.
3. **SP connection** (Applications > Integration > SP Connections): type *OAuth Token Exchange*. Set Partner's Entity ID to the resource authorization server's base URL, because it becomes the default `aud`. On Protocol Settings tick *Identity Assertion JWT (ID-JAG)* under Allowed Requested Token Types. `resource` selects the connection; `audience` names the intended audience. Map the processor policy and fulfil the ID-JAG attribute contract.
4. **OAuth client:** allow the *Token Exchange* grant and select the processor policy.
5. **Request:** POST to `/oauth2/token` with `grant_type=urn:ietf:params:oauth:grant-type:token-exchange`, `requested_token_type=urn:ietf:params:oauth:token-type:id-jag`, `audience`, optional `resource` and `scope`, `subject_token`, `subject_token_type`. Authenticate the client as configured.
6. **Expect** `access_token` (the ID-JAG), `issued_token_type=urn:ietf:params:oauth:token-type:id-jag`, `token_type=N_A`, and a short `expires_in` (the docs example shows 300).

## Variant: ID token as the subject token

Use this when the client holds an OIDC ID token rather than a refresh token (for example after an SSO login). Steps 3 to 6 are unchanged; only the subject-token plumbing differs.

1. **Token Processor:** create a *JWT Token Processor 2.0* instead of the refresh-token processor (`pf_configuring_jwt_token_processor_20_instance.html`). Set Issuer to the OP that minted the ID token and supply its keys (JWKS URL or pasted JWKS). `aud` and `exp` are required by default, so set Allowed Audiences to the client that received the ID token, or the exchange is rejected. Map the claims you need (`sub`, `email`, and so on) in the Extended Contract.
2. **Processor Policy:** map that processor as the subject token processor. The docs pages fetched do not state the Subject Token Type URN for this processor. Use the value the console pre-fills, expect the RFC 8693 `urn:ietf:params:oauth:token-type:id_token`, and send exactly that as `subject_token_type` in the request.
3. **Request:** same as above with `subject_token=<the ID token>` and that `subject_token_type`.

Trade-off: an ID token is short-lived and single-audience, so it suits an interactive, just-signed-in exchange. The refresh-token variant suits repeated or automated exchanges. If the ID token comes from PingFederate itself, its issuer and JWKS are on its own `/.well-known/openid-configuration`.

Confirm the ID-token path against a live 13.1 instance before relying on it; the ID-JAG doc only walks through the refresh-token case.

## Consuming side (resource authorization server)

Configure the resource AS to accept the ID-JAG as a JWT bearer assertion. If that is PingFederate, use a *JWT Bearer Grant Processor* connection (trusted issuer and keys, attribute contract, access token manager mapping, contract fulfilment, issuance criteria); see `pf_configuring_jwt_bearer_grant_processor_attribute_mapping_instance.md`. That page describes the processor generally, so confirm ID-JAG-specific validation (issuer, `aud`, `typ`) before promising it works.

## Verify

Decode the ID-JAG (no signature trust needed for inspection) and check `typ`, `iss`, `aud`, `sub`, `exp`. Then test denial cases: wrong `audience`, expired or revoked refresh token (or expired ID token, wrong issuer or `aud` on it), client without the grant, issuance criteria failing. Never log subject tokens or ID-JAGs.
