# CIBA-login spike result (2026-10-17)

Script: `scripts/spike-ciba-login.mjs` (read-only by default; `--apply` creates a throwaway app; `--send` sends one request).

## Decision: **R1 (confirmed on the token side)** - put the CIBA grant on the login apps

Confirmed with a real approval on 2026-10-17 (see "Confirmed run"). One item remains: whether the *real* login apps (AUTHORIZATION_CODE, PKCE required) accept an added CIBA grant; Task 6 must test that on a copy of each app first. If it fails, the fallback order is R2, then R3.

## Evidence

Throwaway app: `SPIKE-delete-me-ciba-login-mvcqviop`, id `217bb022-6b18-48a6-b8a6-5d939432943c` (grants CIBA +
REFRESH_TOKEN, CLIENT_SECRET_POST, the User Login app's resource grants, flow policies `CIBA - EMAIL` and
`CIBA-SMS` assigned). **Owner: delete it.** The real login apps and existing CIBA apps were not touched.

| Question | Result | Evidence |
|---|---|---|
| Does PingOne accept CIBA with `CLIENT_SECRET_POST`? | **Yes** | `POST /as/cibaAuthorization` with client_id/client_secret in the body: 200, `expires_in` 120, `interval` 2, and a `NOTIFICATION.CREATED` audit event. The same app with Basic auth: 401 `invalid_client` "Unsupported authentication method", so the method follows the app's setting; the login apps (secret-post) work as they are. |
| Does `acr_values` select email vs SMS on one app? | **Yes, but only for policies assigned to that app** | With both policies assigned, `acr_values=<email id>` and `<sms id>` each reach their own policy (error text names that policy id). With the SMS policy NOT assigned: 400 `Invalid DV Flow Policy ID`. So the login apps need BOTH flow policies assigned (additive; sign-on policy assignments are a separate list, and the User Login app currently has zero flow policy assignments). |
| Can a CIBA grant live alongside the login app's settings? | Yes on the throwaway | `grantTypes` [CIBA, REFRESH_TOKEN] with secret-post was accepted. Whether the real login apps (AUTHORIZATION_CODE, PKCE S256 required) accept an added CIBA grant was not tested; the brief forbids touching them. Expect yes (PKCE applies to the code flow only), verify in Task 3 on a copy first. |
| Banking audience / scopes available to a CIBA app? | Grantable | Throwaway got the login app's resource grants (Demo API `enduser.ping.demo` 19 scopes + openid). The existing CIBA apps have **no** resource grants, so their tokens cannot carry the banking audience; this is why R1 needs grants on the login app, not step-up apps. Confirmed: see "Confirmed run". |
| Refresh token issued? | **Yes** | With `offline_access` requested the token response has a refresh token and a refresh-grant call returned 200 (see "Confirmed run"). Without `offline_access`, none. |
| Role derivable from claims? | **Yes by design** | User callback (`routes/oauthUser.js` ~1030-1075) takes admin from username allowlist, population id in userinfo, a custom claim, or `roleClaimResolver` on id-token+userinfo claims; admin callback (`routes/oauth.js` ~430) always grants admin. A CIBA id token plus `/as/userinfo` carry the same sources, so the same code path works. Population-in-userinfo on a CIBA token: **absent** (userinfo returned no population claim), so the population route is unavailable for CIBA logins; use the username allowlist or `roleClaimResolver` (verify in Task 4 with a role test). |

## Cost of each option

- **R1 (chosen):** add CIBA grant + two flow policy assignments to User Login and Admin Login (additive), set
  their config, BFF new CIBA-login routes that build the session from the token response. No new apps, no exchange
  hop; refresh tokens come straight from the grant. Risk: editing real login apps (do it additively, with backup).
- **R2:** keep step-up CIBA apps, then RFC 8693 exchange via the Token Exchanger client. Costs: that client has no
  grant for the `enduser.ping.demo` (Demo API) resource (its resources are MCP/gateway audiences), so it needs a new
  grant on an existing app, the CIBA app has no banking grants to exchange from, and an exchanged token normally
  has no refresh token (session would have to re-run CIBA every token lifetime). More moving parts than R1.
  Not tried live: it needs the same approval as R1's open items and an edit to the exchanger.
- **R3:** DaVinci login flow behind a PingOne-hosted redirect; no change to app grants, but loses the in-modal match
  code (pi.flow cannot render DaVinci screens) and was rejected in the design.

## Confirmed run (2026-10-17, approved by the owner)

Request scope must include the banking scopes plus `offline_access`, exactly what the real login asks for:
`openid profile email offline_access read accounts:read write transfer ai:agent:read` (from `config/oauthUser.js`).
With a bare `openid` request the token has only `openid profile email`, audience is the PingOne issuer resource,
and no refresh token, so the BFF MUST send the full scope string. Result for the full string on the throwaway app:

- Token response scope: `read accounts:read ai:agent:read transfer write openid profile offline_access email`; refresh token issued; ID token issued.
- Access token `aud`: `enduser.ping.demo` (the banking API), `sub` = the signed-in user, `acr` = the CIBA flow policy id, `may_act` present (same claim the callback stores as `session.mayAct`).
- ID token: `amr:["email"]`, `preferred_username`, `email`; `acr` = flow policy id (the CIBA poll must not compare it to a client ACR, as before).
- `/as/userinfo`: 200, profile claims, **no population claim**.
- Refresh grant: 200.
- R2 (exchange via the Token Exchanger client): 401 `invalid_client` "Unsupported authentication method" on the first run (the script used Basic auth); not pursued, since R1 works.

## Still open for Task 6

- Add the CIBA grant to a **copy** of the User Login app and of the Admin Login app first (both require PKCE for the code flow) and confirm PingOne accepts it before touching the real apps.
- The throwaway app `SPIKE-delete-me-ciba-login-mvcqviop` (217bb022-6b18-48a6-b8a6-5d939432943c) must be deleted by the owner.
