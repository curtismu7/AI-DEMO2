# mcpgw

Helm chart for the PingOne Privilege MCPGW gateway (agentless / self-hosted
frontend mode): `Deployment` + `Service` + `PersistentVolumeClaim`, an optional
cert-manager wildcard `Certificate`, and an optional `Ingress`.

Packages what this repo's `k8s/75-ping-mcpgw-deployment.yaml`,
`k8s/aws/mcpgw-wildcard-certificate.yaml`, and
`k8s/aws/mcpgw-agentless-ingress.yaml` do by hand via `deploy.sh` /
`create-secrets.sh`, as a standalone reusable chart. See
`privilege/PRIVILEGE-MCP.md` and `.claude/skills/privilege-cloud-mcp/SKILL.md`
in this repo for the full operational history and gotchas — this README only
covers installing the chart itself.

## Prerequisites

- A PingOne Privilege enrollment JWT (`ENV_PROXY_TOKEN`) — Privilege console →
  Setup Gateways → generate token. Short-lived; only needed for first boot or
  re-enrollment.
- `pingone.env` contents — the gateway's own OIDC client for chaining to
  PingOne on user login: `SERVER_URL` (must equal `hostname` below, with
  `https://`), `OIDC_CLIENT_ID`/`OIDC_CLIENT_SECRET`, `OIDC_AUTH_URL`/
  `OIDC_TOKEN_URL`/`OIDC_USER_URL`, `OIDC_SCOPES`. See
  `ping-mcpgw/procyon/config/pingone.env.example` in this repo for the exact
  shape.
- Either a cert-manager `ClusterIssuer` in-cluster (set `certificate.enabled:
  true`, the default) or your own wildcard cert pair for `hostname` +
  `*.hostname` (set `certificate.enabled: false` and supply
  `secrets.mcpgwCert`/`secrets.mcpgwKey`).

## Install

```bash
helm install ping-mcpgw ./k8s/helm/mcpgw \
  --namespace <your-namespace> \
  --set namespace=<your-namespace> \
  --set hostname=mcpgw.<your-domain> \
  --set-file secrets.envProxyToken=./proxy-token.jwt \
  --set-file secrets.pingoneEnv=./pingone.env
```

Never commit `proxy-token.jwt` / `pingone.env` / cert material to git — pass
them per-install, or via a secrets manager your team already uses.

## Known gaps (true for the underlying resources this chart wraps, not
introduced by the chart)

- The gateway's own PingOne login redirect_uri (`https://<hostname>/callback`)
  must be a registered Redirect URI on whichever OIDC app `pingoneEnv` names —
  a mismatch here is a PingOne console fix, not a chart or cluster issue.
- MCPGW resolves an MCP Server application by URL path (`/<app-slug>/mcp`),
  not by `Host` — confirmed 2026-08-12. Creating an application in console is
  a separate step from this chart; nothing here provisions applications.
- `ValidateInfraJwt` (the gateway's inbound token check) has, as of this
  chart's `appVersion`, rejected every PingOne-issued client token tested
  against it — see `privilege/PRIVILEGE-MCP.md` "The PingOne token wall"
  before assuming a fresh install will pass tool calls end to end.
