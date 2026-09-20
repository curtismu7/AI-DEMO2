# Hosted PingOne Front-Door Authentication Design

## Objective

Require a PingOne-authenticated front-door session before anyone can load the
hosted browser application, while preserving the existing Demo User and Admin
login flows and demo accounts unchanged.

## Non-goals

- Do not replace or merge the existing Demo User/Admin OAuth sessions.
- Do not create a local demo user from a front-door identity.
- Do not store demo access or refresh tokens in the front-door session.
- Do not change public MCP host authentication.
- Do not require Google Workspace or PingIdentity corporate Google access.

## Architecture

The application has two independent authentication planes:

1. **Front door:** a dedicated PingOne OIDC client authenticates an allowed
   workforce/test identity. The BFF stores only a server-side admission
   approval in a dedicated front-door session cookie.
2. **Application:** the existing `/api/auth/oauth/user/*` and
   `/api/auth/oauth/*` flows continue to create the normal Demo User/Admin
   session, resolve roles, and obtain tokens exactly as before.

Ingress external-auth calls the front-door check endpoint. The BFF API gate
   independently requires the same front-door approval, so an ingress bypass or
   direct service access cannot skip admission. Application routes retain their
   existing Demo User/Admin authorization requirements after admission.

## Front-Door Flow

Add exact routes:

- `GET /api/auth/hosted/login` — starts the dedicated PingOne OIDC flow.
- `GET /api/auth/hosted/callback` — validates state, PKCE, nonce, issuer,
  signature, audience, expiry, and verified identity policy; creates only the
  front-door approval session.
- `GET /api/auth/hosted/check` — returns `204` for current admission,
  `401` when absent, and `403` when present but invalidated.
- `GET /api/auth/hosted/logout` — clears only the front-door session and
  redirects to a sanitized hosted return path.

The front-door client requests `openid profile email`. The policy requires
`email_verified === true` and exact normalized membership in the configured
allowlist. The default hosted allowlist remains `pingidentity.com,pingone.com`.
Local development remains gate-off by default.

The approval contains a subject, normalized email/domain, authentication time,
and policy fingerprint. It is never accepted from an application session or a
browser-provided email/header/query value.

## Session Isolation

Use a dedicated front-door session namespace/cookie, separate from the existing
application session. Front-door logout must not log out the Demo User/Admin
session, and Demo User/Admin logout must not grant or revoke front-door access
unless explicitly designed to do so. The ingress check forwards only the
front-door cookie to the BFF check endpoint.

The exact front-door login/callback paths are the only public application
perimeter bypasses. Existing application OAuth login/callback paths are not
used as front-door bypasses; they are reachable only after front-door admission
or through the dedicated front-door flow as needed by the browser.

## Kubernetes Routing

Update the SE ingress `auth-signin` target to `/api/auth/hosted/login` and add a
separate exact-path bypass ingress for the front-door login and callback. The
catch-all application and Grafana paths retain external-auth. The generic ALB
manifest must not claim to provide this NGINX external-auth behavior; the SE
deployment path remains the supported hosted rollout unless equivalent ALB
OIDC integration is explicitly configured.

The SE deployment injects a dedicated front-door client ID and secret through
the existing secret/configuration mechanism. No credentials are committed.

## Error and Audit Behavior

Front-door attempts emit the existing structured hosted-login audit events,
with a distinct `loginType` or flow identifier so front-door and application
logins can be distinguished. Logs exclude authorization codes, tokens, cookies,
PKCE verifiers, raw session IDs, and request bodies.

Denied or invalid front-door callbacks destroy partial front-door state and
return the minimal access-restricted response. Existing application OAuth
errors and responses remain unchanged.

## Testing

Add focused BFF tests for:

- front-door login/callback success creates admission only;
- no demo user mutation or application token storage occurs;
- missing, unverified, malformed, and disallowed identities fail closed;
- front-door session and application session remain independent;
- front-door logout does not destroy the application session;
- the BFF gate and hosted check require front-door approval;
- existing Demo User/Admin hosted-access regression tests remain green.

Add static ingress tests for exact front-door bypass paths, the new
`auth-signin`, unchanged MCP ingress content, and required SE configuration.

## Rollout

1. Create/configure the dedicated PingOne front-door OIDC application and
   populate its secret through the deployment secret workflow.
2. Deploy the BFF with the front-door routes and gate disabled at ingress.
3. Verify front-door audit and callback behavior in a non-production namespace.
4. Enable the front-door gate and apply the exact-path bypass ingress.
5. Test front-door login, then Demo User login, then independent logout paths.
6. Verify direct BFF access is denied without the front-door session.

Rollback removes front-door ingress external-auth first, then disables the
front-door gate. Existing application OAuth validation remains enabled.
