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
Worked through on 2026-10-17 for `ping-devops-curtismuir`. Use the admin API through `kubectl -n <ns> port-forward svc/pingfederate-admin 19999:9999`.

1. **License agreement.** The image's own startup hook normally accepts it and creates the first admin from `pingfederate-admin`; if that did not complete, every admin call returns `license_agreement_not_accepted`. `PUT /license/agreement {"accepted":true}`, then create the first admin (`POST /administrativeAccounts`, unauthenticated, header `X-XSRF-Header: PingFederate`) with the password from the secret.
2. **Custom plugins first.** The config references two demo plugins that are not in the stock image, so the import fails validation ("jar file is missing or not loaded") until they are in the deploy folder: copy `pf-ai-agent-rar.jar` and `pf-ai-agent-ciba-approver.jar` (built from `scripts/pingfederate/plugins/*`, or taken from a running local PF's `server/default/deploy`) with `kubectl cp` to `/opt/out/instance/server/default/deploy/`, then restart the pod.
3. **Rewrite the hostnames in the archive, then import it.** Export from a configured PF (`GET /configArchive/export`), unzip, and replace `https://local.ping-devops.com:9031` with `https://<host>` in: `sourceid-saml2-local-metadata.xml` (base URL), the three `bearer-access-token-management-plugins/*Atm.xml` (issuer claim) and `token-processors/aiDemoPfAccessSubjectProcessor.xml` (issuer, JWKS URL). Replace `https://local.ping-devops.com:4000` with the hosted app URL in the CIBA approver, RAR user-limits and CIMD policy files, and add the hosted callback/logout URLs next to the local redirect URIs of the two login clients. Leave the SPIFFE processor (local only). Re-zip and `POST /configArchive/import` (multipart `file`). The archive holds keys and client secrets: keep it out of Git and delete it afterwards.
4. **Change the admin password immediately.** The import re-installs the source instance's administrator account and its (known) password. `POST /administrativeAccounts/changePassword`, and update the `pingfederate-admin` secret to match.
5. **Seven clients are not in the exported archive** (`ai-demo-pf-rar`, `-rar-dpop`, `-ciba`, `-ciba-web`, `-introspection`, `-xdomain`, and the dynamic CIMD client). They are not on the ID-JAG path. Copy them with `GET` on the source and `POST /oauth/clients` on the target (encrypted secrets are accepted after the import); the CIMD client is created on demand.
6. Point the BFF and `mcp-server` at it (`PF_ISSUER_URI`, `PF_JWKS_URI`, `ENTERPRISE_IDP_ISSUER`, `ENTERPRISE_IDP_JWKS_URL`, `PF_ID_JAG_*`, and the oauth-mcp issuer the ID-JAG is addressed to), then run a real ID-JAG.

Check: `curl https://<host>/pf/heartbeat.ping`, `https://<host>/pf/JWKS`, and `https://<host>/.well-known/openid-configuration` (`issuer` must be `https://<host>`).

## Gotcha
The image runs as uid 9031. A fresh `gp2` volume is root-owned, so the pod sets `runAsUser`/`fsGroup: 9031`; without it the first boot dies at `06-copy-product-bits.sh` with "can't create directory /opt/out/instance".
