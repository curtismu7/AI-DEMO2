# CIBA-login spike result (2026-10-17)

Script: `scripts/spike-ciba-login.mjs` (read-only by default; `--apply` creates a throwaway app; `--send` sends one request).

## Decision: **R1 (provisional)** - put the CIBA grant on the login apps

Everything that can be proven without a human approval is proven and points to R1. Four token-content questions
need one approval click and are still OPEN (see "Open"). If any of them fails, the fallback order is R2, then R3.

## Evidence

Throwaway app: `SPIKE-delete-me-ciba-login-mvcqviop`, id `217bb022-6b18-48a6-b8a6-5d939432943c` (grants CIBA +
REFRESH_TOKEN, CLIENT_SECRET_POST, the User Login app's resource grants, flow policies `CIBA - EMAIL` and
`CIBA-SMS` assigned). **Owner: delete it.** The real login apps and existing CIBA apps were not touched.

| Question | Result | Evidence |
|---|---|---|
| Does PingOne accept CIBA with `CLIENT_SECRET_POST`? | **Yes** | `POST /as/cibaAuthorization` with client_id/client_secret in the body: 200, `expires_in` 120, `interval` 2, and a `NOTIFICATION.CREATED` audit event. The same app with Basic auth: 401 `invalid_client` "Unsupported authentication method", so the method follows the app's setting; the login apps (secret-post) work as they are. |
| Does `acr_values` select email vs SMS on one app? | **Yes, but only for policies assigned to that app** | With both policies assigned, `acr_values=<email id>` and `<sms id>` each reach their own policy (error text names that policy id). With the SMS policy NOT assigned: 400 `Invalid DV Flow Policy ID`. So the login apps need BOTH flow policies assigned (additive; sign-on policy assignments are a separate list, and the User Login app currently has zero flow policy assignments). |
| Can a CIBA grant live alongside the login app's settings? | Yes on the throwaway | `grantTypes` [CIBA, REFRESH_TOKEN] with secret-post was accepted. Whether the real login apps (AUTHORIZATION_CODE, PKCE S256 required) accept an added CIBA grant was not tested; the brief forbids touching them. Expect yes (PKCE applies to the code flow only), verify in Task 3 on a copy first. |
| Banking audience / scopes available to a CIBA app? | Grantable | Throwaway got the login app's resource grants (Demo API `enduser.ping.demo` 19 scopes + openid). The existing CIBA apps have **no** resource grants, so their tokens cannot carry the banking audience; this is why R1 needs grants on the login app, not step-up apps. Actual token scope/aud: OPEN. |
| Refresh token issued? | OPEN (grant is allowed on the app) | needs approval |
| Role derivable from claims? | **Yes by design** | User callback (`routes/oauthUser.js` ~1030-1075) takes admin from username allowlist, population id in userinfo, a custom claim, or `roleClaimResolver` on id-token+userinfo claims; admin callback (`routes/oauth.js` ~430) always grants admin. A CIBA id token plus `/as/userinfo` carry the same sources, so the same code path works. Population-in-userinfo on a CIBA token: OPEN. |

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

## Open (needs one human approval, ~100 s window)

A request was sent at 18:44:01Z (match code SP4821, expired 18:46:02Z) and was not approved because nobody was
available inside the window. To finish: run
`ENV_FILE=<env> node scripts/spike-ciba-login.mjs --send --exchange --app 217bb022-6b18-48a6-b8a6-5d939432943c --policy email --bm SP1234`,
then click the emailed link for cmuir+demo-user@pingone.com within 120 s and check the match code. The script
prints token scope/aud, id-token and userinfo claims (masked), refresh result, and attempts the R2 exchange.
That settles audience/scopes, refresh token, and population in userinfo. Task 3 should treat R1 as confirmed only
after that output is recorded here.
