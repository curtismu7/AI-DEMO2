# pingone.env — Privilege MCPGW OIDC Configuration Reference

What keys `ping-mcpgw/procyon/config/pingone.env` accepts, where each one comes from, and how the file is consumed by the `mcpgw` binary. Written 2026-11-11 after a binary-strings audit of `public.ecr.aws/s7q1z8z4/privilege-aigw` (tag v1.261106 line).

## How the file is read

The compose service `ping-mcpgw` consumes the file **twice** (see `docker-compose.yml` under the `ping-mcpgw` service):

1. `env_file:` — every line is loaded as an environment variable in the container.
2. `-mcpconfpath /var/lib/procyon/config/pingone.env` — the binary parses the same file directly at startup and **exits fatally** if the path does not resolve (unlike the old `cyonproxy`, which only saw the env vars).

So any key here is available both as an env var and via the binary's config parser. The file is gitignored; `pingone.env.example` is the template to copy.

## Current working file keys

| Key | Example value | Purpose |
|---|---|---|
| `SERVER_URL` | `https://mcpgw.local.ping-devops.com` | Public front-door URL the 401 WWW-Authenticate challenge advertises. Clients register redirect URI `${SERVER_URL}/callback` in PingOne. Must be browser-reachable. SE cluster variant: `https://ai-demo.ping-devops.com/mcpgw`. |
| `OIDC_CLIENT_ID` | (UUID) | PingOne application (worker/authorization-code) client ID. |
| `OIDC_CLIENT_SECRET` | (secret) | Copy character-for-character from `demo_api_server/.env` `PRIVILEGE_SSO_CLIENT_SECRET` — the chars `l`/`I` are visually identical in most fonts; one wrong char = `invalid_client` on the token exchange. |
| `OIDC_AUTH_URL` | `https://auth.pingone.com/<env-id>/as/authorize` | Authorization endpoint of the app's PingOne environment. |
| `OIDC_TOKEN_URL` | `https://auth.pingone.com/<env-id>/as/token` | Token endpoint. |
| `OIDC_USER_URL` | `https://auth.pingone.com/<env-id>/as/userinfo` | Userinfo endpoint (binary logs: `OIDC userinfo URL configured as: %s`). |
| `OIDC_SCOPES` | `openid profile email` | Must include `openid` or the binary warns `no id_token in the token response` and falls back to userinfo for identity. |
| `USER_ID_CLAIM` | `email` | Claim the gateway reads from the id_token to resolve the user. If the claim is absent from the id_token the binary falls back to userinfo (`id_token has no %q claim ... fetching userinfo`). `email` requires the `email` scope above. Default behavior without the key is `sub`. |
| `USER_ID` | `cmuir+demo-user@pingone.com` | Optional identity pin for demo flows that need a concrete resolved user (set 2026-11-11). |
| `PINGONE_ENVIRONMENT_ID` | (UUID) | Documented in the example file for reference; the env-id is already embedded in the three OIDC_* URLs. |

## Keys seen in the binary, not yet exercised here

The config struct also carries these field names (`Issuer`, `SessionKey`, `ListenAddr`, `RedirectURI`, `TenantID`, `CertFile`, `KeyFile`, `LogLevel`, `Debug`, `OidcDomain`). We have not verified they are settable from the env-style `pingone.env` on this binary — some belong to the console/guest-agent registration path instead. Do not add them speculatively; test one key at a time and watch the container logs.

## Related files (not pingone.env)

| File / var | Purpose |
|---|---|
| `ping-mcpgw/procyon/config/proxy-token.env` | `ENV_PROXY_TOKEN=eyJ...` enrollment token from the console gateway wizard. Only needed on first boot or re-enrollment — afterwards the proxy authenticates with the mTLS cert pair in the `mcpgw-ssl` volume and ignores it. |
| `ENV_PROXY_CERT` / `ENV_PROXY_KEY` / `ENV_PROXY_CA` | Enrollment cert pair variables the binary references (`mcpgw-cert.pem` / `mcpgw-key.pem` defaults). Managed by the volume, not hand-edited. |
| `ping-mcpgw/procyon/procyon-guest-agent.env` | GUEST AGENT (native install) config, not the proxy. CamelCase keys: `OidcClientID`, `OidcClientSecret`, `OidcAuthURL`, `OidcTokenURL`, `OidcUserURL`, `OidcUserIDClaim` (default `sub`), `OidcDomain`, `Tenant`, `APIKey`/`APISecret`, `CNTRLUrl`, `NodeType=MCPGw`. Its `APIKey`/`APISecret` authenticate to the Privilege control plane and are NOT the PingOne client credentials. |

## Common gotchas

- **Identity leg vs resource leg.** `pingone.env` configures the *front door* (the gateway authenticating MCP clients against PingOne). The *backend* hop (gateway → our `mcp-server`) is configured in the Privilege console (MCP Application, Auth Mode = Static Token empty) and runs unauthenticated because `mcp-server` sets `MCP_AUTH_DISABLED=true`.
- **DCR state is in-memory.** After editing this file: run `k8s/create-secrets.sh` (SE cluster), restart `mcpgw`, then restart `demo-api-server` — mcpgw loses in-memory DCR client state on restart and the BFF must be restarted too.
- **Mesh vs agentless.** This file only matters in *agentless / self-hosted frontend* mode, where the proxy binds locally and runs the OIDC dance itself. In mesh/cloud-frontend mode requests land on `*.applications.privilege.pingone.com` and the cloud validates the client JWT.

## Verification recipe

```bash
# Confirm the config was parsed (startup log):
docker logs ai-demo-ping-mcpgw 2>&1 | grep -E "OIDC|UserID|identity leg"

# Confirm the front door challenges:
curl -si https://mcpgw.local.ping-devops.com/mcp | head -1
# expect: HTTP/1.1 401 with www-authenticate: Bearer realm="MCP OAuth Server", authorization_uri="..."
```

## References

- `ping-mcpgw/procyon/config/pingone.env.example` — template with the same keys and the secret-transcription warning.
- `privilege/PRIVILEGE-MCP.md` and the `pingaccess-ai-demo` / `privilege-*` skills — gateway topology, the PingOne token wall, and console-side configuration.
- `docker-compose.yml`, service `ping-mcpgw` — mount layout, ports (8620/8623/8690), and the no-`environment:`-block rule.
