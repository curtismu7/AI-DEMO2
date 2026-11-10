# PingOne token exchange with third-party signed JWTs: setup

Audience: SEs and customers. **Status (release note, 10 Nov 2026): generally available in all geographies, subject to the license entitlement.** Third-party JWTs are never trusted by default: an administrator defines each trusted issuer and assigns it to the applications that need it. Our measurements below were made on 2026-10-27 while it was still behind a feature flag and have not been re-run since GA. Source: Ping's UAT guide "Token Exchange to support third-party signed JWTs as subject and actor tokens" (23 Oct 2026, Ping staff and selected customers, ticket P14C-83104 phase 2). The demo page is `/p1-third-party-exchange` (simulated, no live call).

Every step is labelled:

- **GUIDE**: stated in the UAT guide.
- **MEASURED**: run live against a PingOne environment (North America, while the capability was still feature-flagged) on 2026-10-27. We created a trusted issuer whose signing key we generated ourselves, signed the third-party tokens with it, ran the exchanges, then deleted everything. Error text below is exactly what PingOne returned.
- **UNVERIFIED**: neither stated nor measured. Check it in your environment before you quote it.

What the first live run did NOT cover (signed-in user as the subject token, real vendor tokens, a JWKS URL fetched by PingOne, PingOne's order of evaluation when several faults occur at once): a second live run with a **real PingFederate token** covered the JWKS URL and PingFederate, see "Measured with a real PingFederate token" below. Still not covered: a signed-in user as the subject, real Okta, Auth0 or Microsoft tokens, and the order of evaluation.

## What it does (GUIDE)

PingOne's token exchange grant (`urn:ietf:params:oauth:grant-type:token-exchange`) used to accept only access tokens or ID tokens from the **same** PingOne environment as the subject and actor tokens. With this capability it also accepts a JWT signed by an issuer you trust, such as PingFederate, Okta, Auth0, Microsoft Entra, or another PingOne environment. The new token type is `urn:ietf:params:oauth:token-type:jwt`. Claims in that token can be mapped into the access token PingOne issues.

Two uses in the guide:

- **A. External application identity in the issued token.** The actor token is a PingFederate client-credentials token. Its `sub` becomes the `act` claim of the issued token, so the downstream API sees which application acted.
- **B. Token enrichment.** The actor token is a PingFederate ID token with a custom `securityLevel` claim (`Class 3`). The issued token gets a `security` claim with that value.

## Before you start

1. The capability is generally available. Quick check that your environment can use it (MEASURED during the feature-flag period): `GET https://api.pingone.com/v1/environments/<ENV_ID>/trustedIssuers` returns HTTP 200 with a count, even if it is 0. If it returns an error instead, check the license entitlement.
2. A license entitlement that includes it (release note: "subject to the applicable license entitlement"). The UAT guide listed these packages (GUIDE, any one; re-check against the current license list): TRIAL, ENHANCED TRIAL, AGENT IAM CORE, WORKFORCE PLUS, WORKFORCE PREMIUM, CIAM PLUS, CIAM PASSWORDLESS, CIAM PREMIUM.
3. The right role (GUIDE). Creating, updating and deleting trusted issuers and assignments: **Environment Admin**. Read: also Client Application Developer, Application Owner, Configuration Read Only. The permissions are `trustedIssuers:create|read|update|delete:trustedIssuer` and `applications:create|read|update|delete:trustedIssuerAssignment`.
4. An **OIDC-based, non-worker application** that is allowed to use the token exchange grant (GUIDE). This is the application that sends the exchange.
5. The third-party issuer's **issuer string** and either its **JWKS URL** or the JWKS itself.
6. A **custom resource** in PingOne that is the audience of the token you want back, with a scope on it.

## 1. Define the trusted issuer (GUIDE)

Console: Trusted issuers. Fields:

| Field | Required | Notes |
|---|---|---|
| Name | yes | |
| Description | no | |
| Issuer | yes | Must equal the `iss` in the third-party token, character for character |
| JSON Web Key Set method | yes | `JWKS URL` (default) or `JWKS` |
| JWKS URL or JWKS | yes, one of the two | |
| Audience | no | Blank accepts any `aud`. If set, at least one `aud` in the token must match one of these |

The admin API also has `expRequired`, `iatRequired`, `nbfRequired`, `clockSkew` and `maxFutureValidity`. The guide does not explain the last two; measured:

- `clockSkew` is in **seconds, maximum 60** (PingOne rejects more: `clockSkew must be less than or equal to 60`). It loosens `exp` (an `exp` 30 s ago passed with skew 60; 120 s ago failed) and `nbf` (a future `nbf` beyond the skew is refused).
- `maxFutureValidity` is in **seconds, 0 = no limit**. With 3600, an `exp` one day ahead was refused and one 10 minutes ahead passed. (Tested on tokens with no `iat`, so whether it is measured from `now` or from `iat` is UNVERIFIED.)
- `expRequired` defaults to true. With it on, a token with no `exp` is refused. We did not test it off.
- **Inline JWKS (MEASURED):** use the `jwks` field with the key set as a **JSON string**; the response then shows `jwksUrl: null`. This means you can trust an issuer, or test one, without hosting a JWKS endpoint.

API (`POST /trustedIssuers` on the PingOne management API for your environment):

```json
{
  "name": "Example",
  "issuer": "https://issuer.example.com",
  "expRequired": true,
  "iatRequired": false,
  "nbfRequired": false,
  "audiences": ["one", "two"],
  "jwksUrl": "https://issuer.example.com/jwks"
}
```

## 2. Assign it to the application (GUIDE)

Console: the application, Trusted issuer assignments. API (MEASURED: create returns 201, delete returns 204 at `/applications/<appId>/trustedIssuerAssignments/<assignmentId>`):

```
POST /applications/<appId>/trustedIssuerAssignments
{ "trustedIssuer": { "id": "<trusted issuer id>" } }
```

The application we used was a `WEB_APP` with grant types `CLIENT_CREDENTIALS` and `TOKEN_EXCHANGE` and `tokenEndpointAuthMethod` `CLIENT_SECRET_BASIC`, with the custom resource's scope granted to it.

Assignments to **AI agents** are marked "coming soon" in the guide. Configuration management and promotion between environments is also "coming soon": repeat the steps by hand per environment.

## 3. Map attributes on the custom resource (GUIDE)

This is the existing resource attribute mapping. On the custom resource that is the **audience** of the token you want back, add an attribute and give it an expression that reads from the actor (or subject) token.

- Sample A: attribute `act`, expression takes the actor token's `sub`. Result: `"act": { "sub": "<actor sub>" }`.
- Sample B: attribute `security`, expression takes the actor token's `securityLevel`. Result: `"security": "Class 3"`.

**MEASURED expressions** (the guide's own figures were screenshots we could not read; these are the ones that worked, created as `CUSTOM` attributes on the resource):

| Attribute | Expression | Result |
|---|---|---|
| `act` | `${{'sub': #root.context.requestData.actorToken.sub}}` | `"act": {"sub": "<actor sub>"}` (an object) |
| `security` | `${#root.context.requestData.actorToken.securityLevel}` | `"security": "Class 3"` |
| any claim of a third-party **subject** token | `${#root.context.requestData.subjectToken.<claim>}` | the claim's value (tested with `sub` and `email`) |

Notes: a bare `${...sub}` for `act` would give a string, so wrap it in `{'sub': ...}` as above. If the source claim is absent, PingOne **leaves the attribute out and still issues the token** (MEASURED). If there is no actor token at all, an `act` attribute like the one above comes out as `"act": {"sub": null}` (MEASURED), so only put it on a resource that is always exchanged with an actor, or check for it downstream.

## 4. Send the token exchange (MEASURED)

```
POST https://auth.pingone.<region>/<ENV_ID>/as/token
Content-Type: application/x-www-form-urlencoded

grant_type=urn:ietf:params:oauth:grant-type:token-exchange
subject_token=<PingOne access token>
subject_token_type=urn:ietf:params:oauth:token-type:access_token
actor_token=<third-party JWT>
actor_token_type=urn:ietf:params:oauth:token-type:jwt
scope=<scope on the custom resource>
```

Client authentication was HTTP Basic with the application's client id and secret. This exact shape returned HTTP 200 (MEASURED). No `audience` or `resource` parameter was needed: the issued token's `aud` is the custom resource that owns the requested scope. `actor_token_type` must be `urn:ietf:params:oauth:token-type:jwt` for a third-party token; PingOne refuses `access_token` for it and refuses a missing one (see the error table).

**Third-party JWT as the subject token (MEASURED):** accepted (`subject_token_type=urn:ietf:params:oauth:token-type:jwt`), with or without an actor token. But the issued token then has **no `sub` claim at all**, because there is no PingOne user to take it from. Map what you need with `subjectToken.<claim>` (table above). If your API expects a `sub`, create a `sub`-less design deliberately or map the external subject into another claim.

**Limits stated in the release note (10 Nov 2026):**

- **Signed only.** Input JWTs must be signed. Signed-and-encrypted JWTs are not supported.
- **Type is `jwt` even for ID tokens and access tokens.** For any third-party input, set `subject_token_type` or `actor_token_type` to `urn:ietf:params:oauth:token-type:jwt`, whatever kind of token it is.
- **No local user.** PingOne does not resolve a third-party token to a PingOne user. A `p1.userId` claim in it is ignored, and the `subjectTokenUser` / `actorTokenUser` context value is null. This is why the issued token has no `sub` when the subject is third-party (measured above). Do not write mapping expressions that read the user context for a third-party token.

Expected response (GUIDE sample): `token_type: Bearer`, `expires_in: 3600`, the scope, and `issued_token_type: urn:ietf:params:oauth:token-type:access_token`.

## 5. Check it worked

1. Decode the issued token. Its `aud` is the custom resource, `scope` is the requested scope, `sub` is the original user, and the mapped claim (`act` or `security`) is present with the value from the third-party token.
2. Audit: PingOne emits Trusted Issuer and Trusted Issuer Assignment events (Created, Updated, Deleted for each of the two resources, six in all; there is no Read event). Administrators can subscribe to them through webhooks.
3. Negative tests: the table below is what PingOne returns for each. Every failure is **HTTP 400** with `error: invalid_request` and a description that starts `The request could not be completed. The request was malformed or invalid.: ` followed by the text below and a correlation id.

## Error responses (MEASURED, one fault at a time)

| What was wrong | PingOne's text (after the common prefix) |
|---|---|
| Actor token `exp` in the past | `The provided JWT has expired` |
| Signed with a different key, or unknown `kid` | `JWT signature verification failed` |
| `iss` matches no trusted issuer assigned to the app | `The token issuer does not match any Trusted Issuer assigned to the application` |
| Issuer exists but is not assigned to the calling app | `The token issuer does not match any Trusted Issuer for the requesting application` |
| No `exp`, `expRequired` on | `Missing exp claim; the Trusted Issuer requires an expiration time` |
| No `nbf`, `nbfRequired` on | `Missing nbf claim; the Trusted Issuer requires a not-before time` |
| `nbf` in the future beyond skew | `The nbf claim is in the future beyond the allowed clock skew` |
| No `iat`, `iatRequired` on | `Missing iat claim; the Trusted Issuer requires an issued-at time` |
| Audience list set and no `aud` matches | `None of the token's aud values match the Trusted Issuer's configured audiences` |
| `exp` beyond `maxFutureValidity` | `The exp claim exceeds the maximum allowed future validity` |
| `actor_token_type` is `access_token` for a third-party JWT | `Provided token type must be urn:ietf:params:oauth:token-type:jwt` |
| `actor_token_type` missing | `No value supplied for required parameter: actor_token_type` |

Two things that are easy to misread: an untrusted issuer and an unassigned issuer give **different** messages, and a token whose `aud` is an array passes if **any** value matches the audience list (blank list accepts any). `nbfRequired` with an `nbf` in the past passes.

## Measured with a real PingFederate token (2026-10-27)

A token from a real PingFederate (13.1) JWT access token manager was used as the actor token, with the trusted issuer pointing at that PingFederate's **JWKS URL** (so PingOne fetched and used the live keys itself).

- **Trusted issuer:** `issuer` exactly equal to the token's `iss` (the PingFederate base URL, no trailing slash), `jwksUrl` = `<PingFederate base URL>/pf/JWKS`, `expRequired` and `iatRequired` true. Audiences left blank: the PingFederate token's `aud` was a gateway URL and PingOne accepted it.
- **What the PingFederate token looked like:** RS256 JWT with `kid` in the header (the signing key's id) and `typ: JWT`; claims `iss`, `aud`, `sub`, `client_id`, `iat`, `exp` (60 minutes), `jti`, `scope`, and an `act` that PingFederate had already emitted as an **object** (`{"sub": "<agent>"}`).
- **PingFederate settings that made it work:** the token manager has "Publish Keys to the PingFederate JWKS Endpoint" turned on, and the token's `kid` matches a key in `<base>/pf/JWKS`. These are exactly the two things to check first if PingOne reports `JWT signature verification failed`.
- **Results (one fault at a time):**
  1. The real token: **HTTP 200**. The issued token had `act: {"sub": <actor sub>}` from the usual mapping, plus claims mapped from the actor token.
  2. The same token with its signature damaged: HTTP 400 `JWT signature verification failed`. So PingOne really verifies against the PingFederate keys.
  3. The trusted issuer changed to a different string: HTTP 400 `The token issuer does not match any Trusted Issuer assigned to the application`.
- **Nested claims can be mapped:** `${#root.context.requestData.actorToken.act.sub}` returned the nested value, so you can pull `act.sub` out of a token that already carries an `act` object. The plain `${#root.context.requestData.actorToken.iss}` and `.client_id` also work.
- **Cleanup:** everything created in PingOne was deleted afterwards and the throwaway PingFederate client was removed; the token itself expires on its own.

## Which switches fit which issuer

From the comparison sheet and the vendors' sample tokens: Okta, Auth0 and RFC 9068 tokens have `iat` and `exp` but **no `nbf`**; Microsoft v1.0 and v2.0 have `iat`, `nbf` and `exp`; a PingFederate client-credentials token has `exp` only. So `nbfRequired` would refuse Okta, Auth0 and PingFederate tokens, and `iatRequired` would refuse the PingFederate client-credentials token. The demo page lets you try this (the page's refusals reuse the texts above).

## Which claim names each issuer uses

See the table on the demo page (from the comparison sheet). In short, the calling application id is `client_id` (PingOne, RFC 9068), `azp` (Auth0, Microsoft v2.0), `cid` (Okta) or `appid` (Microsoft v1.0).
