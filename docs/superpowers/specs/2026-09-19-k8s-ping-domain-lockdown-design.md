# Kubernetes Ping-Domain Access Lockdown Design

## Objective

Protect only `https://ai-demo.ping-devops.com` so the hosted demo is available
only after PingOne authentication by a user whose verified email domain is
exactly `pingidentity.com` or `pingone.com`. The separate public MCP hosts remain
unchanged.

The control must hide the SPA, static assets, Grafana, and demo APIs from
unauthenticated or ineligible visitors. It must also protect the BFF when ingress
is bypassed. Every login attempt and terminal outcome must produce a structured,
searchable audit event without recording credentials or tokens.

## Constraints

- PingOne remains the identity provider and the BFF remains the sole browser-token
  custodian.
- Existing OAuth state, nonce, PKCE, issuer, signature, audience, expiration,
  session regeneration, admin-role resolution, and callback-origin behavior must
  remain intact.
- Authorization is based on a verified token/userinfo claim, never an email typed
  by the browser or a `login_hint`.
- Domain comparison is exact after parsing and lowercasing. Suffix matching is
  forbidden.
- Missing, malformed, or unverified email claims fail closed when hosted access
  enforcement is enabled.
- Local Docker and developer flows remain unchanged by default.
- `cmuir-mcp.ping-devops.com` and all MCPGW hostnames are outside this change.
- Login logs must never include authorization codes, tokens, cookies, PKCE
  verifiers, raw session IDs, or request bodies.

## Recommended Architecture

Use the existing BFF session as the single authentication session and add two
defense-in-depth enforcement points:

1. An ingress external-auth check prevents the frontend, static assets, API proxy,
   and Grafana from being served before approval.
2. A BFF middleware gate protects API routes when traffic reaches the service
   without passing through ingress.

The BFF owns one reusable access-policy service. Both customer and admin OAuth
callbacks call it before persisting a logged-in session. The service evaluates
claims, stamps a small approval record into the regenerated session, and emits
the login audit outcome. The ingress auth endpoint and BFF API middleware accept
only a current approved session.

No `oauth2-proxy` deployment is added. A second proxy would create a second
session and duplicate the existing PingOne login lifecycle without improving the
server-side domain decision.

## Configuration

Add environment-backed settings:

- `HOSTED_ACCESS_GATE_ENABLED`: boolean, default `false`.
- `HOSTED_ACCESS_ALLOWED_DOMAINS`: comma-separated normalized domains, default
  empty. The SE Kubernetes deployment sets
  `pingidentity.com,pingone.com`.
- `HOSTED_ACCESS_REQUIRE_VERIFIED_EMAIL`: boolean, default `true` whenever the
  gate is enabled.

Startup validation rejects an enabled gate with no valid domains. Domain entries
must be DNS-style names without `@`, schemes, paths, ports, wildcard characters,
or whitespace after trimming.

The PingOne customer and admin applications must issue `openid profile email`
and expose `email` plus `email_verified`. The policy fails closed if verification
is not explicitly `true`; deployment documentation includes the required claim
mapping check.

## Access-Policy Service

Create a focused service that exports pure validation plus session helpers:

- `loadHostedAccessPolicy(env)` returns the validated enabled/disabled policy.
- `evaluateHostedIdentity(claims, policy)` returns
  `{ allowed, reason, email, domain, subject }`.
- `stampHostedAccessApproval(session, decision)` stores a versioned approval with
  subject, normalized email/domain, authentication time, and policy fingerprint.
- `hasCurrentHostedAccessApproval(session, policy)` verifies that the stored
  approval still matches the active policy and the current session user.

The email parser accepts exactly one local part and one domain portion, normalizes
the domain to lowercase, and compares membership using equality. It rejects
Unicode lookalikes, empty labels, trailing dots, and domains such as
`evilpingidentity.com` or `pingidentity.com.example.org`.

The policy fingerprint is derived from the enabled flag, verification requirement,
and sorted allowlist. A configuration change invalidates existing approvals and
requires a new login.

## OAuth Integration

Both `routes/oauthUser.js` and `routes/oauth.js` evaluate the merged, validated
PingOne identity claims after existing nonce/token checks and before creating or
updating a local user or regenerating/persisting the authenticated session.

When allowed:

- The existing role resolution and session regeneration continue unchanged.
- The regenerated session receives the approval stamp.
- The signed auth-state cookie must not independently confer hosted approval;
  restoration without a server-side approved session fails the hosted gate.
- A terminal `success` audit event is recorded only after session persistence
  succeeds.

When denied:

- No user record is created or updated.
- No access or refresh token is stored.
- Any partial session is destroyed and auth cookies are cleared.
- The callback returns a minimal high-contrast 403 HTML response stating
  `Access restricted to authorized Ping employees.`
- The response contains no SPA bundle, navigation, claim values, allowlist, or
  explanation that helps enumerate accepted domains.

OAuth provider errors, invalid state, missing code, nonce failures, token/userinfo
failures, session-regeneration failures, and session-save failures retain their
existing client behavior while gaining a terminal audit event.

## Login Audit Trail

Add a dedicated `authAccessAuditService` that writes through
`appEventService.logEvent`. Existing `appEventService` persistence sends the same
event to the activity NDJSON file, New Relic when configured, and Loki for
Grafana searching.

Each login flow emits:

- `attempt` when the BFF starts a customer or admin PingOne authorization request.
- Exactly one terminal event: `success`, `denied`, or `failure`.

Structured fields:

- `eventType`: `hosted_login`.
- `phase`: `attempt` or `terminal`.
- `outcome`: `started`, `success`, `denied`, or `failure`.
- `reasonCode`: stable enumeration such as `allowed`, `domain_not_allowed`,
  `email_unverified`, `email_missing`, `oauth_provider_error`, `invalid_state`,
  `nonce_mismatch`, `token_exchange_failed`, `session_regenerate_failed`, or
  `session_persist_failed`.
- `loginType`: `user` or `admin`.
- `subjectId`, normalized `email`, and `domain` when claims are available.
- `sourceIp`, `userAgent`, `correlationId`, and a SHA-256 session-ID hash truncated
  to 16 hexadecimal characters.
- `durationMs` from login initiation to terminal outcome when available.

The event message is generic and all query-controlled provider text is excluded.
The structured metadata contains no secrets. The audit helper owns a closed
reason-code set so accidental raw error messages cannot enter Loki.

Repeated callback requests must still produce a terminal failure event; each
HTTP login attempt has its own correlation/login trace identifier. The service
does not log every anonymous ingress auth check, avoiding a high-volume attacker
turning the audit store into noise.

## BFF Enforcement

Add two routes/middleware behaviors:

- `GET /api/auth/hosted-access/check`: internal ingress subrequest endpoint.
  It returns `204` for a current approved session, `401` for no approved session,
  and `403` for a present but ineligible/invalidated session. It returns no user
  profile or policy details.
- A global hosted-access middleware runs after session restoration and before API
  route mounts. When enabled, it permits only:
  - customer/admin login initiation and callback paths;
  - the minimal access-denied response;
  - required signed PingOne/DaVinci webhook endpoints, whose existing signature
    or authenticity checks remain authoritative;
  - the hosted-access check endpoint itself.

Kubernetes readiness/liveness probes continue over ClusterIP/localhost and do
not require a public exception. All other `/api` and `/grafana` requests require
an approved session. When the gate is disabled, middleware is a no-op.

## Ingress Layout

Split `k8s/aws/se-ingress.yaml` into annotation scopes while keeping the same
host and backends:

- The catch-all application ingress (`/` and `/grafana`) uses ingress-nginx
  external-auth annotations. `auth-url` calls the BFF ClusterIP hosted-access
  check and forwards the browser cookie. `auth-signin` redirects a `401` to the
  customer PingOne login route with a sanitized return path.
- A separate bypass ingress on the same host owns only exact OAuth initiation and
  callback paths required for customer and admin login, plus signed webhook paths.
  It has no external-auth annotation.

Path matching must prevent prefix confusion. Bypass paths use the narrowest
available `Exact` rules. The BFF gate remains active on these paths and applies
its own explicit allowlist, so an ingress merge or controller change cannot turn
the bypass ingress into general API access.

The MCP public-door ingress remains byte-for-byte unchanged.

## Failure Behavior

- No session: ingress receives `401` and redirects to PingOne login.
- Authenticated but unapproved or policy changed: ingress receives `403`; the
  browser receives the minimal restriction page without a redirect loop.
- PingOne unavailable: existing callback/login error behavior remains, with a
  structured failure audit event.
- Audit sinks unavailable: local NDJSON logging remains synchronous best effort;
  New Relic/Loki forwarding remains non-blocking and never changes the auth
  decision.
- BFF unavailable: ingress external auth fails closed and does not serve the SPA.

## Testing

Unit tests cover configuration parsing, exact-domain evaluation, case handling,
malformed and Unicode email input, missing/unverified claims, policy fingerprints,
approval stamping, invalidation, and audit redaction.

Focused route tests cover both user and admin flows: attempt, success, domain
denial, absent/unverified email, OAuth errors, state/nonce failures, regeneration
failure, save failure, session destruction, and the hosted-access check endpoint.
Tests assert one terminal audit outcome and absence of secrets.

Server tests prove the global BFF gate blocks direct API access when ingress is
bypassed, preserves OAuth/webhook routes, and is a no-op when disabled.

Static Kubernetes guards verify:

- external-auth annotations exist only on the `ai-demo.ping-devops.com`
  application ingress;
- bypass paths are exact and limited;
- MCP ingress content is unchanged;
- the SE ConfigMap enables the policy with exactly the two approved domains.

The hosted smoke test verifies anonymous redirect, successful employee access,
ineligible-domain 403, deep links, logout/re-login, Grafana protection, callback
reachability, and signed webhook continuity. Existing focused BFF tests,
`npm run authz:verify`, topology/hygiene checks as affected, and the UI build gate
remain required.

## Rollout and Recovery

1. Configure and verify `email` and `email_verified` claims in both PingOne apps.
2. Deploy BFF code with the gate disabled.
3. Enable audit-only evaluation in a non-production namespace and inspect real
   login decisions in Loki/Grafana.
4. Enable BFF enforcement and validate direct API denial.
5. Apply ingress enforcement last and execute the hosted smoke matrix.
6. Monitor `category=auth_lifecycle`, `eventType=hosted_login` by outcome and
   reason code.

Rollback removes the external-auth annotations first, then disables
`HOSTED_ACCESS_GATE_ENABLED`. It does not bypass OAuth or token validation. The
previous manifest and image remain deployable. There is no query-string, header,
cookie, or hard-coded-user bypass.

## Acceptance Criteria

- Anonymous and ineligible visitors cannot download the SPA, static assets, or
  call demo/Grafana endpoints on `ai-demo.ping-devops.com`.
- A verified exact-domain PingOne identity from either approved domain can log in.
- Similar-looking, subdomain, missing, malformed, and unverified addresses fail
  closed.
- Direct BFF access is denied without a current approval.
- Customer/admin role semantics, OAuth security checks, callbacks, and signed
  webhooks continue working.
- Every login attempt has an `attempt` event and exactly one terminal audit event
  searchable in Loki/Grafana, with no credentials or tokens.
- Public MCP hosts behave exactly as before.
