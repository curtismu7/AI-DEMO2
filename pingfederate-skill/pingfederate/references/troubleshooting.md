# PingFederate Flow Troubleshooting Playbook

## Method

1. **Reproduce with curl, not a browser screenshot.** Follow the redirect chain hop by hop with `curl -sSv` (no `-L`). Each 302 hop is a server; the failing hop localizes the problem.
2. **Timestamp everything.** Grab the exact UTC time of the failing request, then read PF logs around it.
3. **Which log?**
   - `log/runtime.log` — runtime request processing errors (the main one for broken flows)
   - `log/event.log` — authentication events, successes/failures with user + adapter detail
   - `log/admin.log` — admin console / admin API issues
   - `log/audit.log` — if configured, wire-format SAML/OAuth events
4. **Enable trace if needed**: Log4j2 debug on `org.sourceid.oauth20` / `org.sourceid.saml20` in `log4j2.xml` (runtime nodes restart required — warn the user).

## Redirect chain map (OAuth/OIDC)

```
RP -> GET /as/authorization.oauth2            (PF runtime)
     -> IdP adapter / HTML login form          (adapter rendering)
     -> POST back / continue                   (form submit, then possibly step-up)
     -> 302 redirect_uri?code=...              (authorization code issued)
RP -> POST /as/token.oauth2                    (code exchange)
```

Failures by hop:
- **First hop 4xx**: check client_id, redirect_uri exact match (scheme/host/port/path, trailing slash), `response_type`, required PKCE (`code_challenge` when client requires PKCE).
- **Login form never appears / adapter error**: adapter config, datastore connectivity, LDAP/SCIM backend down.
- **Token hop errors**: see table below.

## OAuth/OIDC error table

| Error | Usual root cause | Where to look |
|---|---|---|
| `invalid_client` | Wrong secret, wrong auth method (client expects private_key_jwt, caller sends secret), client disabled | runtime.log; client `clientAuth` config |
| `unauthorized_client` | Grant type not enabled on client (e.g., token_exchange, refresh_token) | client `grantTypes` |
| `invalid_scope` | Scope not in client's `allowedScopes`, or no access token manager scope mapping | client config; token manager |
| `invalid_grant` (code) | Code already used, expired (short default lifetime), or redirect_uri mismatch in token call vs authorize call | runtime.log — PF logs the mismatch reason |
| `invalid_request` — missing `code_verifier` | Client requires PKCE; caller omitted/used wrong verifier method (S256 vs plain) | client `restrictDefaultScopes`/PKCE setting |
| `invalid_token` / 401 on resource | Token signature key mismatch (key rotated, JWKS cached), audience/`env` mismatch | resource server token manager config |
| `unsupported_grant_type` | Token endpoint policy or plugin doesn't handle grant | token endpoint config |

## SAML error signatures

- **`urn:oasis:names:tc:SAML:2.0:status:Responder`** from IdP — PF (as IdP) rejected internally; read runtime.log. Common: attribute mapping error, adapter failure, no authn policy match.
- **Signature validation failure** — cert expired/mismatch; check the connection's `credentials` and the peer's metadata.
- **`InvalidNameIDPolicy`** — requested NameID format not configured in the connection's NameID mapping.
- **Clock skew** — "assertion not yet valid" / "expired". Check NTP on both sides. PF default skew allowance is small (typically ±60s configurable in connection settings).
- **Entity ID mismatch** — issuer in the incoming AuthnRequest/Assertion doesn't match any connection's `entityId`. runtime.log names the expected value.
- **RelayState/SessionIndex issues** in SLO — usually connection base URL wrong.

## Token exchange (RFC 8693) specifics

- `unauthorized_client` → client missing `token_exchange` grant type.
- `invalid_request` about subject token → token exchange mapping not configured on the target access token manager, or subject token issued by a manager PF doesn't trust.
- Resulting token missing attributes → check the token manager's token-exchange attribute mapping (subject token claims → new token attributes).

## Runtime vs admin port confusion

Symptom: 404 or connection refused on endpoints that "exist". PF runs two services:
- **Runtime**: `:9031` (default) — `/as/authorization.oauth2`, `/as/token.oauth2`, `/sp/SSO.saml2`, `/idp/SSO.saml2`
- **Admin**: `:9999` (default) — `/pf-admin-api/v1`

Using the admin port for SSO/token endpoints (or vice versa) gives confusing errors. Check the port first.

## TLS / certificates

- PF's self-signed cert breaks curl: use `-k` for testing, but prefer installing PF's CA into the trust store for real checks.
- `keytool -list -v -keystore <pf-keystore>` to inspect the signing key; compare `kid`/serial against what the peer trusts.

## Useful curl snippets

```bash
# Follow the authorize chain manually
curl -sSv "https://$PF:9031/as/authorization.oauth2?client_id=X&response_type=code&redirect_uri=...&scope=..." 2>&1 | grep -E '^< (HTTP|Location)'

# Introspect a token (RFC 7662)
curl -sk https://$PF:9031/as/introspect.oauth2 -u "$CLIENT_ID:$SECRET" -d "token=$TOKEN" -d token_type_hint=access_token

# Validate a JWT by hand (offline)
# echo "<payload>" | base64 -d | jq .
```
