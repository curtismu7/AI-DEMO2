# ID-JAG playground, pf-pf mode on SE (PingFederate issues, Acme PingFederate redeems)

Status: code and scripts written and unit-tested; **never run against SE** (the author had no SE access and no write access to any PingFederate). Every step below that touches a cluster or a PingFederate is yours to run.

## Why pf-pf failed on SE

pf-pf took the redeemer ("resource AS") issuer from `PF_ISSUER`, the app's own login PingFederate. On SE that is the SE PingFederate itself, which is also the issuer. The playground asked the SE PingFederate for an ID-JAG whose audience is itself: `400 invalid_target`. The SE PingFederate also has no SP connection for itself.

## Design

| Role | PingFederate | What it needs |
|---|---|---|
| Issuer | SE PF, `https://cmuir-pf.ping-devops.com` (ns `ping-devops-curtismuir`) | SP connection `aiDemoPfIdJagAcmeSp`, entity id `https://cmuir-pf-acme.ping-devops.com`, cloned from `aiDemoPfIdJagLocalPfSp` |
| Redeemer | Acme PF, `https://cmuir-pf-acme.ping-devops.com` (ns `ping-devops-cmuir`) | IdP connection `idjagFromSePf` (trusts the SE issuer and its JWKS), token manager `idjagRedeemerAtm` (Resource URI = the playground resource), client `ai-demo-pf-idjag-redeemer` (JWT bearer grant) |

The app reads the redeemer from new settings, each falling back to the old behaviour so local Docker is unchanged:

| Env var | Meaning | Default when unset |
|---|---|---|
| `PF_IDJAG_PF_REDEEMER_ISSUER` | redeemer issuer = ID-JAG audience | `PF_ISSUER` |
| `PF_IDJAG_PF_REDEEMER_TOKEN_ENDPOINT` | where the JWT bearer grant is posted | `<redeemer issuer>/as/token.oauth2` if the issuer is set, else `PF_TOKEN_ENDPOINT` |
| `PF_IDJAG_PF_REDEEMER_CLIENT_ID` | redeeming client | `ai-demo-pf-idjag-redeemer` |
| `PF_IDJAG_PF_RESOURCE` | ID-JAG `resource` | `https://api.ping.demo:3036/mcp` |
| `PF_IDJAG_PF_REDEEMER_CLIENT_SECRET` | secret of that client (unchanged name) | none: pf-pf stays unavailable |

If the redeemer issuer equals the issuer (`PF_IDJAG_ISSUER_PF_URL`), pf-pf is shown as unavailable with a plain reason instead of failing at the PingFederate.

SE-only: `SE_PF_REDEEMER_ISSUER` in `demo_api_server/.env` (or the shell) makes `k8s/create-secrets.sh` write the first two vars into `ai-demo-secrets`; `SE_PF_REDEEMER_URL` does the same for `scripts/se-pf-overrides.sh`.

## Who runs what

Only you can run: every `kubectl`, every port-forward, every `--apply`, the SE rollout, and the browser sign-in. Read-only checks are marked (read-only).

Run from a checkout that has this branch merged and has `demo_api_server/.env` (the script reads `PF_IDJAG_PF_REDEEMER_CLIENT_SECRET` from it; it never prints it). In zsh, paste commands without `#` comments.

## 1. Issuer side: SE PingFederate

```
kubectl -n ping-devops-curtismuir port-forward svc/pingfederate-admin 19999:9999
```

In a second terminal, prove the forward points at the SE issuer (read-only):

```
PW=$(kubectl -n ping-devops-curtismuir get secret pingfederate-admin -o jsonpath='{.data.password}' | base64 -d); curl -sk -u "administrator:$PW" -H 'X-XSRF-Header: PingFederate' https://localhost:19999/pf-admin-api/v1/serverSettings | python3 -c "import json,sys;print(json.load(sys.stdin)['federationInfo']['baseUrl'])"
```

Expect `https://cmuir-pf.ping-devops.com`. Anything else: stop and fix the forward. (The script repeats this check and refuses on a mismatch, in dry run too.)

Dry run (reads only), then apply:

```
node scripts/pingfederate/configure-pfpf-se.js --side=issuer
node scripts/pingfederate/configure-pfpf-se.js --side=issuer --apply
```

The dry run prints the shape it will create (`shape (cloned from aiDemoPfIdJagLocalPfSp)`); check the `clientIds` is `ai-demo-pf-idjag-redeemer` and the `policies` list matches what `aiDemoPfIdJagLocalPfSp` uses. Re-run: every line should say `keep`.

If PingFederate rejects the new connection because the resource URI is already used by `aiDemoPfIdJagLocalPfSp`, pick a distinct one and use it on both sides and in `PF_IDJAG_PF_RESOURCE` (`--resource=https://api.ping.demo:3036/mcp/acme`).

Optional, SAML on pf-pf: add the SAML mapping to the new connection (the existing script discovers connections by entity id). Dry run first:

```
node scripts/pingfederate/configure-saml-idjag.js --ns=ping-devops-curtismuir --port=19999 --dry-run --oauth-mcp-entity=https://cmuir-mcp.ping-devops.com --pf-pf-entity=https://cmuir-pf-acme.ping-devops.com --pf-pf-client-id=ai-demo-pf-idjag-redeemer
```

That script has no identity check of its own: only run it after the check above passed.

## 2. Redeemer side: Acme PingFederate

Prerequisite: `scripts/pingfederate/configure-acme-idp.js` was run once (it creates the signing key `acme-idjag-signing` that the new token manager uses). The script refuses if the key is missing.

```
kubectl -n ping-devops-cmuir port-forward svc/pingfederate-admin 29999:9999
```

Second terminal, verify (read-only):

```
PW=$(kubectl -n ping-devops-cmuir get secret pingfederate-admin -o jsonpath='{.data.password}' | base64 -d); curl -sk -u "administrator:$PW" -H 'X-XSRF-Header: PingFederate' https://localhost:29999/pf-admin-api/v1/serverSettings | python3 -c "import json,sys;print(json.load(sys.stdin)['federationInfo']['baseUrl'])"
```

Expect `https://cmuir-pf-acme.ping-devops.com`.

```
node scripts/pingfederate/configure-pfpf-se.js --side=redeemer
node scripts/pingfederate/configure-pfpf-se.js --side=redeemer --apply
```

It only adds: token manager, IdP connection, client, and any missing scopes in the authorization server settings. The Acme demo objects (`acme-agent`, `acme-user`, the password grant, the `acme*` connections and keys) are not modified. If the client already exists it is kept: PingFederate cannot show its secret, so confirm it equals `PF_IDJAG_PF_REDEEMER_CLIENT_SECRET`.

Remove everything this runbook adds (dry run unless `--apply`): `--side=redeemer --remove`, `--side=issuer --remove`.

## 3. The issuer sign-in client allows the playground callback (read-only)

pf-pf signs in at the SE PingFederate with the app's user client (`PF_USER_CLIENT_ID`) and the redirect URI `https://ai-demo.ping-devops.com/api/id-jag-playground/issuer/callback`. Check the client lists it (port-forward from step 1 still running):

```
PW=$(kubectl -n ping-devops-curtismuir get secret pingfederate-admin -o jsonpath='{.data.password}' | base64 -d); curl -sk -u "administrator:$PW" -H 'X-XSRF-Header: PingFederate' https://localhost:19999/pf-admin-api/v1/oauth/clients/ai-demo-pf-user | python3 -c "import json,sys;print(json.load(sys.stdin)['redirectUris'])"
```

If the callback is missing, add it in the PingFederate admin console (or ask for a script). This was not verified; the SE sign-in for oauth-mcp mode uses a different callback.

## 4. App settings on SE

Keep these in `demo_api_server/.env` (the `SE_*` lines are read by the deploy scripts, ignored locally):

```
SE_PF_ISSUER=https://cmuir-pf.ping-devops.com
SE_OAUTH_MCP_URL=https://cmuir-mcp.ping-devops.com
SE_PF_REDEEMER_ISSUER=https://cmuir-pf-acme.ping-devops.com
```

`PF_IDJAG_ISSUER_PF_URL` (or `PINGFEDERATE_HOST`) must resolve to `https://cmuir-pf.ping-devops.com` and `PF_IDJAG_PF_REDEEMER_CLIENT_SECRET` must be in `.env`: it is shipped to `ai-demo-secrets` by the normal rebuild.

Apply without the overwrite traps. Never run plain `./run-pingaws.sh` (no argument = build and push images, then deploy), and do not rely on `update config` alone: it rebuilds `ai-demo-secrets` from `.env`, stops at the vault check before the SE override, and can leave local-Docker PingFederate values on SE (handoff section 5, items 1 to 3).

Use the additive patch script instead. Plan first (prints keys and URLs only, changes nothing), then apply:

```
SE_PF_REDEEMER_URL=https://cmuir-pf-acme.ping-devops.com scripts/se-pf-overrides.sh
SE_PF_REDEEMER_URL=https://cmuir-pf-acme.ping-devops.com scripts/se-pf-overrides.sh --apply
```

It merges the PF keys plus `PF_IDJAG_PF_REDEEMER_ISSUER` and `PF_IDJAG_PF_REDEEMER_TOKEN_ENDPOINT` (taken from Acme's live discovery document, which must name the same issuer, and which must not be the login PingFederate) into `ai-demo-secrets`, then restarts `demo-api-server`. It does not change `OAUTH_PROVIDER` unless you add `--unpin`, and pf-pf does not need that.

Check the client secret reached the pod (key names only, read-only):

```
kubectl -n ping-devops-cmuir get secret ai-demo-secrets -o json | python3 -c "import json,sys;k=json.load(sys.stdin)['data'];print([x for x in k if x.startswith('PF_IDJAG') or x=='PINGFEDERATE_HOST'])"
```

If `PF_IDJAG_PF_REDEEMER_CLIENT_SECRET` is not listed, set it without printing it (run from the repo root), then restart:

```
printf '{"stringData":{"PF_IDJAG_PF_REDEEMER_CLIENT_SECRET":"%s"}}' "$(grep -E '^PF_IDJAG_PF_REDEEMER_CLIENT_SECRET=' demo_api_server/.env | tail -n1 | cut -d= -f2- | tr -d '"')" | kubectl -n ping-devops-cmuir patch secret ai-demo-secrets --type merge --patch-file /dev/stdin
kubectl -n ping-devops-cmuir rollout restart deployment/demo-api-server
```

The SE image must contain this branch's `idJagPlayground.js`. This PR does not deploy; build and roll the `demo-api-server` image through your normal focused deploy (`saml-live-setup.sh --only=deploy` or equivalent), then re-run the plan above if a rebuild reset the secret.

## 5. Prove discovery from the pod (read-only)

```
kubectl -n ping-devops-cmuir exec deploy/demo-api-server -- node -e "fetch('https://cmuir-pf-acme.ping-devops.com/.well-known/openid-configuration').then(async r=>console.log(r.status,(await r.json()).issuer))"
```

Expect `200 https://cmuir-pf-acme.ping-devops.com`.

## 6. Verification checklist in the browser

Open `https://ai-demo.ping-devops.com/pingfederate-id-jag/playground` signed in as admin.

1. Mode picker: `PingFederate -> PingFederate` is enabled. If disabled, its tooltip names the missing setting; that text is the diagnosis (secret unset, or issuer equals redeemer).
2. Choose pf-pf. The page shows resource AS issuer `https://cmuir-pf-acme.ping-devops.com`.
3. Step 1, sign in at the issuer (SE PingFederate). Expect to land back on the playground, signed in.
4. Step 2, Request ID-JAG with OIDC. Expect 200, and in the decoded ID-JAG: `iss` `https://cmuir-pf.ping-devops.com`, `aud` `https://cmuir-pf-acme.ping-devops.com`, `client_id` `ai-demo-pf-idjag-redeemer`, `typ` `oauth-id-jag+jwt`. A `400 invalid_target` here means the issuer-side SP connection is missing or its entity id differs from `aud`.
5. Step 2 again with SAML (only if you ran the optional SAML mapping above).
6. Step 3, Redeem. Expect 200 and an access token with `iss` `https://cmuir-pf-acme.ping-devops.com`. `invalid_grant` or `Invalid JWT token` means the Acme IdP connection does not trust the issuer JWKS (check `idjagFromSePf` entity id and JWKS URL). `invalid_client` means the secret differs from the Acme client's.
7. Step 4, call the MCP gateway. This may fail with an issuer or audience rejection: the gateway has not been confirmed to trust the Acme issuer. That is a separate gateway setting, not part of redeem.

## What is verified and what is not

Verified by the author: unit tests of the settings, the gate, and every body builder; the identity gate refusing a wrong PingFederate (run against the local Docker PingFederate's admin API, read-only); the redeemer side's read path and the SP clone against real local objects (read-only). Not verified: any write, any SE behaviour, the points marked UNVERIFIED at the top of `scripts/pingfederate/configure-pfpf-se.js`.
