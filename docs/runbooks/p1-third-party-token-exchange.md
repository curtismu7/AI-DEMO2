# PingOne token exchange with third-party signed JWTs: setup

Audience: SEs and customers who have the capability enabled. Source: Ping's UAT guide "Token Exchange to support third-party signed JWTs as subject and actor tokens" (23 Oct 2026, Ping staff and selected customers, ticket P14C-83104 phase 2). The demo page is `/p1-third-party-exchange` (simulated, no live call).

Every step is labelled:

- **GUIDE**: stated in the UAT guide.
- **UNVERIFIED**: not in the guide, or the guide shows it only as a screenshot we could not read. Check it in your environment before you quote it.

## What it does (GUIDE)

PingOne's token exchange grant (`urn:ietf:params:oauth:grant-type:token-exchange`) used to accept only access tokens or ID tokens from the **same** PingOne environment as the subject and actor tokens. With this capability it also accepts a JWT signed by an issuer you trust, such as PingFederate, Okta, Auth0, Microsoft Entra, or another PingOne environment. The new token type is `urn:ietf:params:oauth:token-type:jwt`. Claims in that token can be mapped into the access token PingOne issues.

Two uses in the guide:

- **A. External application identity in the issued token.** The actor token is a PingFederate client-credentials token. Its `sub` becomes the `act` claim of the issued token, so the downstream API sees which application acted.
- **B. Token enrichment.** The actor token is a PingFederate ID token with a custom `securityLevel` claim (`Class 3`). The issued token gets a `security` claim with that value.

## Before you start

1. The capability is behind a **feature flag** (GUIDE says it is being added; **UNVERIFIED**: no flag name is given). Ask Ping to confirm it is on for your environment.
2. A license package that includes it (GUIDE, any one): TRIAL, ENHANCED TRIAL, AGENT IAM CORE, WORKFORCE PLUS, WORKFORCE PREMIUM, CIAM PLUS, CIAM PASSWORDLESS, CIAM PREMIUM.
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

The admin API also shows `expRequired`, `iatRequired`, `nbfRequired`, `clockSkew` and `maxFutureValidity`. The guide does not explain `clockSkew` or `maxFutureValidity` (both 0 in its sample): leave them alone unless Ping tells you otherwise (**UNVERIFIED**).

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

**Which switches to set depends on the issuer's tokens.** From the comparison sheet and the vendors' sample tokens: Okta, Auth0 and RFC 9068 tokens have `iat` and `exp` but **no `nbf`**; Microsoft v1.0 and v2.0 have `iat`, `nbf` and `exp`; a PingFederate client-credentials token has `exp` only (no `iat`). Turning `nbfRequired` on would refuse Okta, Auth0 and PingFederate tokens, and `iatRequired` would refuse the PingFederate client-credentials token. The demo page lets you try this.

## 2. Assign it to the application (GUIDE)

Console: the application, Trusted issuer assignments. API:

```
POST /applications/<appId>/trustedIssuerAssignments
{ "trustedIssuer": { "id": "<trusted issuer id>" } }
```

Assignments to **AI agents** are marked "coming soon" in the guide. Configuration management and promotion between environments is also "coming soon": repeat the steps by hand per environment.

## 3. Map attributes on the custom resource (GUIDE)

This is the existing resource attribute mapping. On the custom resource that is the **audience** of the token you want back, add an attribute and give it an expression that reads from the actor (or subject) token.

- Sample A: attribute `act`, expression takes the actor token's `sub`. Result: `"act": { "sub": "<actor sub>" }`.
- Sample B: attribute `security`, expression takes the actor token's `securityLevel`. Result: `"security": "Class 3"`.

**UNVERIFIED:** the guide shows the exact expressions only in screenshots (its Figures 4, 5, 7 and 8) that we could not read. Open the same screens in the PingOne console and copy the expression from there. Do not type one from memory.

If the source claim is absent from the third-party token, expect the attribute to be missing from the issued token (**UNVERIFIED**, inferred; the demo page shows this).

## 4. Send the token exchange (GUIDE for the token type, rest UNVERIFIED)

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

plus client authentication as for any PingOne token request. The guide states that `actor_token_type` (or `subject_token_type`) must be `urn:ietf:params:oauth:token-type:jwt` for a third-party token. The other parameters follow RFC 8693 and PingOne's existing exchange documentation; the guide's request figures are screenshots we could not read.

Use a **subject** third-party token only after checking the result: the guide says it is accepted, but both of its samples use a third-party **actor** token, so what the issued `sub` becomes is **UNVERIFIED**.

Expected response (GUIDE sample): `token_type: Bearer`, `expires_in: 3600`, the scope, and `issued_token_type: urn:ietf:params:oauth:token-type:access_token`.

## 5. Check it worked

1. Decode the issued token. Its `aud` is the custom resource, `scope` is the requested scope, `sub` is the original user, and the mapped claim (`act` or `security`) is present with the value from the third-party token.
2. Audit: PingOne emits Trusted Issuer and Trusted Issuer Assignment events (Created, Read, Update, Delete, eight in all).
3. Negative tests worth running: an unassigned issuer, an expired third-party token, an issuer string that does not match, and an audience that is not on the list. Record the real error responses, because the guide does not describe them.

## Troubleshooting (all UNVERIFIED: our expectations from the checks the guide lists)

| Symptom | Likely cause |
|---|---|
| Exchange refused, third-party token only | Trusted issuer not assigned to the calling application |
| Refused for an Okta, Auth0 or PingFederate token | `nbfRequired` (or `iatRequired` for PingFederate client credentials) is on and the token has no such claim |
| Refused for one environment only | `iss` differs from the Issuer field (trailing slash, tenant id, port) |
| Refused on audience | Audience list is set and none of the token's `aud` values is on it. Blank the list to accept any |
| Refused as expired | Third-party token `exp` is past |
| Token issued but mapped claim missing | The source claim is not in the third-party token (for example Okta has `cid`, not `client_id`) |

## Which claim names each issuer uses

See the table on the demo page (from the comparison sheet). In short, the calling application id is `client_id` (PingOne, RFC 9068), `azp` (Auth0, Microsoft v2.0), `cid` (Okta) or `appid` (Microsoft v1.0).
