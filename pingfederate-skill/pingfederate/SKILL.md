---
name: pingfederate
description: Work with PingFederate — automate admin via the PF Admin REST API (create/update OAuth clients, OIDC/SAML connections, idempotent provisioning) AND troubleshoot OAuth/OIDC/SAML flows, token errors, and log analysis. Use whenever the user mentions PingFederate, PF admin console automation, connection export/import, client or SP connection provisioning, or debugging PF login/token/redirect errors — even if they just say "PF" or paste a PF error message.
---

# PingFederate Skill

PingFederate (PF) is Ping Identity's federation gateway. This skill covers two jobs:

1. **Admin automation** — drive the PF Administrative API to provision and manage configuration (via PingCLI or the raw REST API).
2. **Flow troubleshooting** — diagnose failing OAuth/OIDC/SAML flows from errors, redirects, and logs.

Read `references/admin-api.md` before writing any admin API code. Read `references/troubleshooting.md` when debugging a failing flow.

## Prefer PingCLI when available

If the `pingcli` tool is installed (`command -v pingcli`), prefer it over hand-rolled curl for admin API work — it handles auth token acquisition, storage (OS keychain), and TLS config for you. Read `references/pingcli.md` for setup and usage. Fall back to raw curl only when PingCLI isn't installed or its options don't fit (e.g., the user explicitly wants raw requests for debugging).

## Environment discovery (do this first)

Ask or discover, never guess:

- **Base URL** — Admin API is typically `https://<pf-host>:9999/pf-admin-api/v1`. Runtime endpoints are `https://<pf-host>:9031` (default). PF admin and runtime are different ports — a common mistake is using the admin port for runtime OAuth calls.
- **Auth** — Admin API uses OAuth 2.0 bearer tokens obtained via a PF OAuth client with the `PingFederate Administrator` entitlement, or basic auth if `admin.api.authentication.method` permits. Get a token first, then use `Authorization: Bearer <token>`.
- **Version** — `GET /pf-admin-api/v1/batch/...` unavailable? Check `GET /` or response headers. API surface varies by version (11.x vs 12.x differ meaningfully). Note the version and consult version-specific docs when behavior seems off.

```bash
# Typical first steps
curl -sk https://$PF_HOST:9999/pf-admin-api/v1/oauth/clients -H "Authorization: Bearer $TOKEN"
```

## Admin API automation

### Core principles

- **Idempotency**: before POST, GET the resource; PUT on 200, POST on 404. Scripted runs must be safe to repeat.
- **Full-object semantics**: PF PUT endpoints replace the whole object. GET the current object, merge changes, PUT back. Blind PUTs silently drop fields.
- **Test connectivity**: a config change that saves but breaks the connection shows up as connection-test failure — for SP/OAuth connections, use the test endpoints where available (e.g., `POST /oauth/clients/{id}/...` varies; for SAML use `POST /sp/adapters/.../testConnection` style endpoints on the relevant resource).

### Key resource paths (v1)

| Resource | Path |
|---|---|
| OAuth clients | `/oauth/clients` |
| Access token managers | `/oauth/accessTokenManagers` |
| Token exchange (extension) | configured within token manager processors / grant mapping |
| IdP (SP-swept) connections | `/idp/connections` |
| SP connections | `/sp/connections` |
| IdP adapters | `/idp/adapters` |
| Password credential validators | `/passwordCredentialValidators` |
| Authentication policies | `/authenticationPolicies/authenticationSelectors` + policy management endpoints |
| Certificates | `/serverSettings/certificates` |
| Data stores | `/dataStores` |
| Cluster status | `/cluster/status` |
| Config export | `/configArchive/export` (full archive) |
| Connection export | `/connections/export` or per-connection export endpoints |

### Writing provisioning scripts

- Use `jq` (bash) or a small Python script with `requests` — don't hand-assemble large JSON in shell strings.
- Handle PF error format: `{ "validationErrors": [...], "message": "..." }` — surface `validationErrors` verbatim; they're precise.
- Always print the resource ID + version-sensitive fields you changed.

### Export / import (moving config between environments)

- Prefer **connection exports** (per-connection JSON) over full config archives for moving individual connections; they're merge-friendly.
- On import, connection exports carry metadata refs (certs, adapters, data stores) by ID — target environment must have those, or include them in the export bundle.
- Full config archive import replaces configuration — treat as destructive; snapshot the target first via export.

## Flow troubleshooting

Read `references/troubleshooting.md` for the full playbook. Quick triage:

1. **Reproduce with curl** — get the actual HTTP status and response body. Don't debug from a screenshot.
2. **Follow the redirects** — `curl -sSv` (no `-L`); PF flows are redirect chains (authorize → login adapter → consent → callback). The failing hop tells you which server has the problem.
3. **Check runtime log** (`log/runtime.log`) vs admin log; `event.log` for authn events. Look for `WARN`/`ERROR` around the timestamp.
4. **Common signatures**:
   - `invalid_client` → client ID wrong or client auth (secret/mtls/jwt) mismatch
   - `unauthorized_client` → grant type not enabled on the client
   - `invalid_scope` → scope not in client's allowed scopes or no scope grant mapping
   - SAML `Responder`/status error → check the SP/IdP connection entity ID match and clock skew
   - `PKCE` / `code_verifier` errors → client required PKCE but caller skipped it
5. **Clock skew** — SAML assertions and JWTs are sensitive; NTP drift between PF and the peer is a classic root cause.

## Safety rules

- Never run config-archive **import** against production without an explicit user instruction and a fresh export snapshot taken first.
- Don't disable or alter existing connections when creating a new one with similar settings — create parallel and let the user cutover.
- Credentials (client secrets, signing keys) come from the user/env — never fabricate and never log them.
