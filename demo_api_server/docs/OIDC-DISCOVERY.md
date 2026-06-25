# OIDC Discovery

Auto-populates OAuth endpoints from a provider's `.well-known/openid-configuration` at server startup. When enabled, any OIDC-compliant IDP (PingFederate, Auth0, Okta, Keycloak, etc.) can be configured with a single issuer URL instead of 5+ individual endpoint settings.

## Quick start

Set `OAUTH_ISSUER` to your IDP's issuer URL and enable discovery:

```bash
OAUTH_ISSUER=https://auth.example.com
OAUTH_DISCOVERY_ENABLED=true
```

The server fetches `https://auth.example.com/.well-known/openid-configuration` at startup and caches the endpoints. Individual `OAUTH_*` overrides still take priority over discovered values.

## Configuration

| Variable | Default | Description |
|---|---|---|
| `OAUTH_DISCOVERY_ENABLED` | `false` | Set to `true` to enable OIDC discovery at startup |
| `OAUTH_ISSUER` | _(empty)_ | Issuer URL used both as the discovery base and as the expected `issuer` claim in metadata |
| `OAUTH_DISCOVERY_ENDPOINT` | _(computed)_ | Override the discovery URL directly (defaults to `{issuer}/.well-known/openid-configuration` or the PingOne pattern) |

All settings can also be set via the Config UI (stored in SQLite) and are overridable by env vars.

## Endpoint resolution priority

For each OAuth endpoint (`token_endpoint`, `authorization_endpoint`, etc.):

1. **Explicit config** — `OAUTH_TOKEN_ENDPOINT` / Config UI value
2. **Discovery cache** — value from OIDC metadata fetched at startup
3. **PingOne computed** — `https://auth.pingone.{region}/{envId}/as/{path}`
4. **Empty string** — not configured

## Security

- **HTTPS required in production** — `http://` discovery URLs are rejected when `NODE_ENV=production`.
- **Issuer validation** — the `issuer` field in metadata must match `OAUTH_ISSUER` (normalized, trailing slash ignored).
- **Required fields** — discovery returns `null` and logs an error if `issuer`, `authorization_endpoint`, `token_endpoint`, or `jwks_uri` are missing.
- **5-second timeout** — a slow or hung discovery endpoint never blocks startup.
- **Non-blocking** — discovery failure is logged as a warning; the server starts regardless and falls back to PingOne pattern or explicit config.

## IDP examples

### PingFederate

```bash
OAUTH_ISSUER=https://federate.example.com
OAUTH_DISCOVERY_ENABLED=true
```

Discovery populates all endpoints automatically from PingFederate's standard OIDC metadata.

### Auth0

```bash
OAUTH_ISSUER=https://example.auth0.com/
OAUTH_DISCOVERY_ENABLED=true
```

### Okta

```bash
OAUTH_ISSUER=https://example.okta.com/oauth2/default
OAUTH_DISCOVERY_ENABLED=true
```

### PingOne (default — discovery optional)

PingOne endpoints are computed from `PINGONE_ENVIRONMENT_ID` + `PINGONE_REGION` without discovery. Enable discovery only if you want to validate the metadata or pick up non-standard endpoints.

```bash
PINGONE_ENVIRONMENT_ID=your-env-id
PINGONE_REGION=com
# Discovery is optional for PingOne — computed URLs are used by default
```

## Architecture

```
server.js startup
  └─ initializeDiscovery()          (non-blocking, fires-and-forgets)
       ├─ check oauth_discovery_enabled flag
       ├─ build discoveryUrl from OAUTH_DISCOVERY_ENDPOINT or {issuer}/.well-known/...
       ├─ fetchDiscoveryMetadata(url)  [oauthDiscoveryService]
       │    ├─ GET discoveryUrl (5s timeout)
       │    ├─ validate required fields
       │    └─ validate issuer match
       └─ _discoveryCache = extractEndpoints(metadata)

Request time (sync)
  └─ oauthEndpointResolver.getTokenEndpoint()
       ├─ 1. configStore.getEffective('oauth_token_endpoint')  → explicit config
       ├─ 2. _discoveryCache?.token_endpoint                   → discovery
       └─ 3. https://auth.pingone.{region}/{envId}/as/token    → PingOne computed
```

## Services involved

| File | Role |
|---|---|
| `services/oauthDiscoveryService.js` | Fetches + validates OIDC metadata |
| `services/oauthEndpointResolver.js` | Sync resolver with discovery cache; exports `initializeDiscovery()` |
| `services/configStore.js` | Stores `oauth_discovery_enabled` + `oauth_issuer` settings |
| `server.js` | Calls `initializeDiscovery()` non-blocking at startup |
