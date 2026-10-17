# PingFederate in the SE cluster

ID-JAG (UC40) runs on PingFederate, so the launchers bring it up every time.

| Where | What brings it up | Opt out |
|---|---|---|
| Local Docker | `run-docker.sh` start / restart / build call `ensure_pingfederate` (compose project `scripts/pingfederate/docker-compose.local.yml`) | `SKIP_PINGFEDERATE=1` |
| SE cluster | `run-k8.sh se-deploy` / `se-all` (and so `run-pingaws.sh start` / `deploy`) call `scripts/pingfederate/ensure-se-pingfederate.sh` | `SKIP_PINGFEDERATE=1` |

Both are idempotent and soft: a running PF is left alone, and a problem is a warning, never a failed start.

## Cluster layout
`pingfederate.yaml`: StatefulSet (one pod, 5Gi `gp2` volume), `pingfederate-engine` Service (9031), `pingfederate-admin` Service (9999, ClusterIP only), and an Ingress (`nginx-public`) for the **engine only**. The admin API is never on the public ingress: `kubectl -n <ns> port-forward svc/pingfederate-admin 9999:9999`.

Pin where it runs in `demo_api_server/.env` (gitignored) so a deploy never creates a second one in your app namespace:

```
PINGFEDERATE_NAMESPACE=ping-devops-curtismuir
PINGFEDERATE_HOST=cmuir-pf.ping-devops.com
```

Secrets are created only when missing (a re-run never rotates the admin password): `pingfederate-license` (from `$PINGFEDERATE_PROFILE_PATH/instance/server/default/conf/pingfederate.lic`) and `pingfederate-admin` (random).
Read the admin password: `kubectl -n <ns> get secret pingfederate-admin -o jsonpath='{.data.password}' | base64 -d`.

## First run on a new PF (not automated)
1. **Accept the license agreement** in the admin API/console (`PUT /license/agreement`). Until then every admin call, including import, returns `license_agreement_not_accepted`.
2. **Import the configuration**: export from a configured PF (`GET /configArchive/export`) and `POST /configArchive/import`. The archive holds keys and client secrets: never commit it.
3. **Fix the hostname**: set the base URL (`/serverSettings`, federation info) to `https://<host>`, and replace `https://local.ping-devops.com:9031` wherever it appears in the imported config (access-token manager issuer claims, JWT token processor issuers and JWKS URLs).
4. **Set a strong admin password** (the import brings the source instance's administrator account).
5. Point the BFF and `mcp-server` at it (`PF_ISSUER_URI`, `PF_JWKS_URI`, `ENTERPRISE_IDP_ISSUER`, `ENTERPRISE_IDP_JWKS_URL`, `PF_ID_JAG_*`), and register the callback URL for the hosted app on the PF clients.

Check: `curl https://<host>/pf/heartbeat.ping` and `https://<host>/pf/JWKS`.

## Gotcha
The image runs as uid 9031. A fresh `gp2` volume is root-owned, so the pod sets `runAsUser`/`fsGroup: 9031`; without it the first boot dies at `06-copy-product-bits.sh` with "can't create directory /opt/out/instance".
