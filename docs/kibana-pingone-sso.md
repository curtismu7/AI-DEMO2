# Local Kibana access through PingOne

This setup protects the local Kibana port-forward with PingOne OIDC without
requiring an Elastic SSO subscription. Kibana uses a shared, read-only
Elasticsearch role for `ping-siem-events*`; it is suitable for local testing,
not per-user authorization.

## PingOne application

Create a confidential OIDC web application with:

- Grant type: `AUTHORIZATION_CODE`
- Token endpoint authentication: `CLIENT_SECRET_BASIC`
- Redirect URI: `http://localhost:4180/oauth2/callback`
- Scopes: `openid profile email`

Set the resulting values locally (for example in an untracked shell file):

```bash
export PINGONE_ENVIRONMENT_ID='<environment-id>'
export KIBANA_PINGONE_CLIENT_ID='<client-id>'
export KIBANA_PINGONE_CLIENT_SECRET='<client-secret>'
```

## Start the local path

Terminal 1 keeps Kibana reachable from the Mac:

```bash
kubectl -n ping-devops-curtismuir port-forward \
  service/kibana-siem 5601:5601
```

Terminal 2 starts the PingOne gate:

```bash
./scripts/run-kibana-pingone-proxy.sh
```

Open <http://localhost:4180>. The browser is redirected to PingOne, then
proxied to Kibana after authentication.

## Shared Kibana role

The Elasticsearch cluster must enable its anonymous realm with the username
`kibana_shared` and role `kibana_shared`. The role should grant:

- `monitor` cluster access;
- `read` and `view_index_metadata` on `ping-siem-events*` and
  `pingfederate-logs-*`;
- read-only access to `.kibana*` and `.tasks` so Kibana can render saved objects.

The PF Filebeat sidecar uses a separate ingestion account. Grant it `monitor`
cluster access and `create_doc` plus `auto_configure` on `pingfederate-logs-*`
only.

Keep the Elasticsearch and PingOne secrets in Kubernetes Secrets or local
environment storage. Do not commit them to this repository.

This local proxy binds only to `127.0.0.1` through the published Docker port;
it is not an internet-facing Kibana deployment.
