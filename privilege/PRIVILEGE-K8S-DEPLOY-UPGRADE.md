# Deploying and upgrading the Privilege gateway on Kubernetes

October 9, 2026 · operational guide, compiled from the verified record

What Helm install, upgrade, re-enrollment, and teardown of an Agentless
Privilege gateway on Kubernetes actually involve — including the traps that
cost real time. Every claim marked *verified* was measured against a live
system (dates given); everything else is from Ping's config reference, binary
analysis, or a dry-run, and says so.

Companion docs: [`NEW-DEMO-ENVIRONMENT.md`](NEW-DEMO-ENVIRONMENT.md) (first
gateway in a new environment, with our exact values),
[`GATEWAY-LOAD-BALANCER.md`](GATEWAY-LOAD-BALANCER.md) (second/third node,
mesh, shared Redis),
[`AGENTLESS-CONFIGURATION.md`](AGENTLESS-CONFIGURATION.md) (the live
deployment's recorded values), [`LESSONS-LEARNED.md`](LESSONS-LEARNED.md)
(the incidents behind most traps here). This guide is the walkthrough; those
are the sources.

## The three deployments, and which one you are touching

| Deployment | Where | Helm release | Managed by |
|---|---|---|---|
| Gateway 1 + mcpgw-lb | `ping-devops-curtismuir` | `agentless-mcpgw` | manual Helm |
| Gateway 2 | `ping-devops-cmuir` | `agentless-mcpgw2` | manual Helm |
| Gateway 3 | `ping-devops-cmuir` | `agentless-mcpgw3` | manual Helm |

*Verified 2026-10-03..05.* `k8s/aws/deploy.sh` installs **nothing**
Privilege-related by design (2026-09-01): the enrollment token is single-use
and ~2h-lived, so the gateway must never ride a routine deploy. The in-repo
chart `k8s/helm/mcpgw` (release `ping-mcpgw`) is a separate, older path whose
manifest still has `replicas: 0` and has never run — do not confuse the two.

Two rules before anything:

1. **Never run `deploy.sh` for gateway changes.** It refuses Privilege on
   purpose. Gateways are manual Helm only.
2. **Never `helm uninstall` casually** — see [Teardown](#teardown), where the
   PV-destruction deadlock is documented from a real outage (2026-09-01).

## First install

The verified sequence (NEW-DEMO-ENVIRONMENT.md, run 2026-10-03..05):

1. **Cluster prerequisites.** Confirm kubectl context; check CPU *requests*
   against real usage (`kubectl top pod --containers`) — the SE cluster had
   no node with 750m free while every node sat at 8–13% real CPU, because
   requests, not load, fill it. ClusterIssuer `letsencrypt-pdo` and ingress
   class `nginx-public` must exist. DNS is published by external-dns;
   confirm the hostname resolves **before** enrolling.
2. **PingOne OIDC app.** Web App, token auth `client_secret_basic`, grants
   Authorization Code **and Token Exchange**, redirect
   `https://<gateway host>/callback`, scopes `openid profile email`. Ignore
   the chart README's `p1:read:*` scopes — they don't exist and PingOne
   silently drops them. *Self-check for the secret:* a `client_credentials`
   request returning `unauthorized_client` means the secret is **accepted**
   (wrong grant, good secret); `invalid_client` means it is wrong or dead.
3. **Console enrollment.** Gateways > Add New > **AI GW tab** — not the VM
   wizard, whose env file the chart cannot use and whose screens show the
   tenant API key and OIDC secret in plain text (don't screenshot them).
   - **Host IP is the trap that bites:** the form pre-fills a value; the
     right answer is the node's own in-cluster Service DNS name
     (`<service>.<namespace>.svc.cluster.local`). A node enrolled with the
     wrong Host IP runs, joins the mesh, gets **no console row**, and cannot
     be edited — only re-created. *Verified: a node with the pre-filled
     value produced no row until re-enrolled.*
   - Agent Privilege Server URL `https://<gateway host>`; OIDC values from
     step 2; User ID Claim blank.
   - **Token:** Get Docker Command, keep only the `eyJ...` after
     `ENV_PROXY_TOKEN=`. Single-use, ~2 hours — do console and Helm in one
     sitting. Save to an owner-only file, then **strip every
     leading/trailing whitespace character**: two stray spaces caused a
     crash-loop with `crypto/ecdsa: verification error`, and the token was
     *not* spent — the local signature check runs before any server contact.
     Decode the payload and confirm `tenantName`, `clusterID`, `nodeType`
     (`PrivateAIGw`), and minutes left.
4. **Helm install.** Use the **chart source directory**
   (`pingone-privgateway-helm-main/agentless/agentless-mcpgw/`), never the
   packaged `.tgz` — it goes stale and silently drops local additions
   (caused an outage 2026-09-07).

   ```sh
   helm upgrade --install agentless-mcpgw <chart-dir> \
     -n <namespace> -f <values>.yaml \
     --set-file proxyToken=<token file> \
     --set-file oidc.clientSecret=<secret file>
   ```

   Three decisions:
   - **Resources.** Chart default is 1 CPU / 2Gi for the main container;
     idle reality is ~30m / 40MiB. Set requests ~250m / 512Mi (limits 2
     CPU / 4Gi). The 1000m default left the SE cluster unable to schedule an
     unrelated pod for 36 minutes ("27 Insufficient cpu"). *Verified.*
   - **OpenSearch / OpenSearch-MCP:** both default true in the chart; set
     false if unwanted (we rendered a no-sidecars install but never ran it).
   - **Redis.** Without `MCPGW_REDIS_URL` (chart value
     `redis.urlSecret.name` → Secret holding the URL under key `url`), the
     gateway keeps registrations in memory — every restart makes clients
     re-register. With Redis, the gateway **exits after six failed connect
     attempts (1,2,4,8,16s apart) at startup** — Redis is a hard dependency,
     and any gateway restart during a Redis outage is a gateway outage.
     *Verified 2026-10-04.* A bare `REDIS_URL` is ignored — the name must be
     exactly `MCPGW_REDIS_URL`.
   - Second gateway in the **same** namespace needs `nameOverride` +
     `ingress.enabled: false`; a new namespace needs neither. Don't add a
     second node until the first works.
   - **Never `--reuse-values` on first install**; it doesn't hand the
     release the chart's new defaults — spell every key. **Never `--set` a
     list index** (e.g. `loadBalancer.peers[0]...`) — it corrupted list
     entries on this chart before.

5. **Checks before anything else** (verified sequence):
   - Pod ready — 9/9 for a seven-sidecar install (7 sidecars + gateway +
     log-tailer).
   - **The gateway log is a file, not stdout.** `kubectl logs -c mcpgw` is
     empty even when healthy. Read it through the tailer:
     `kubectl exec <pod> -c log-tailer -- tail -50 /var/log/procyon/cyonproxy.log`.
     A crash loop prints nothing to `kubectl logs`.
   - Redis line: `Redis token store connected on attempt 1/6`.
   - Console shows the node **with the address you typed** (the Host IP
     trap's tell).
   - `kubectl get certificate` ready; unauthenticated `POST /<app>/mcp` →
     401 proves ingress + cert + gateway in one probe. (A bare 401 does
     **not** prove the application path — the bearer check runs before
     application resolution, so invented app names answer identically.
     *Verified 2026-08-31.*)
   - Benign noise: `has same NodeURL`, `re-establishing link to node`,
     mesh-controller `not found`.
6. **Order for the rest:** applications first, then agents (an agent can
   only select existing apps). Register MCP servers with path `/mcp`, not
   `/sse` (current builds discover by POSTing `initialize`). Agent keys are
   shown once on the last wizard screen — paste into the secret store
   immediately.
7. **Delete the token and OIDC secret files** once enrolled; rotate anything
   shown on a console screen.

## Upgrading

The routine shape, with the two rules that keep it safe:

```sh
# 1. Capture live values FIRST — never retype from the repo's values.yaml
helm get values agentless-mcpgw -n <ns> -o yaml > live-values.yaml

# 2. Upgrade
helm --kube-context <ctx> -n <ns> upgrade agentless-mcpgw <chart-dir> \
  --reuse-values -f live-values.yaml -f <patch>.yaml \
  --set-file proxyToken=<fresh token file>   # only when re-enrolling

# 3. Restart only if the change is file-based (see below)
kubectl rollout restart deployment/agentless-mcpgw -n <ns>
```

**Rule 1 — `extraContainers` is replaced wholesale.** `--reuse-values`
replaces the whole `extraContainers` **list**; a patch that adds one sidecar
must re-supply every sidecar verbatim, pulled from `helm get values`
immediately before, not retyped from the repo's checked-in `values.yaml`
(whose `extraContainers: []` is illustrative only). Two real outages came
from this. Confirm by **container count**, not by release status.

**Rule 2 — a file-mounted config change needs `rollout restart`.** The
binary reads `pingone.env` eagerly at startup and never hot-reloads; a
recreated Secret alone changes nothing (empty `client_id` in the OAuth
redirect is the tell). Also: `helm upgrade` without `--reuse-values` resets
`frontService` and bypasses the load balancer.

**Floating-tag trap.** `image.tag: latest` + `pullPolicy: Always` means every
pod recreation — `helm upgrade`, `helm rollback`, node drain, `rollout
restart` — is an unplanned binary upgrade, and **`helm rollback` does not
restore the old binary** (it reverts chart values only; the floating tag
re-resolves). Pin the digest when you need stable. Related *verified* trap
(2026-09-06, ~2h outage): current builds derive the MCP GW listen port from
`SERVER_URL` — `https://...` → listen on 443, not 8623. The chart hardcodes
8623 in Service/Ingress. Tell: a healthy old build logs `MCP GW running
[::]:8623` and **no "derived from" line**; the line's presence is the new
behavior. Do not put `:8623` into `SERVER_URL` (it doubles as the public
OIDC issuer base URL).

**Sidecar images must be `linux/arm64`** — all 27 SE nodes are Graviton;
amd64 crash-loops with exec format error. *Verified.*

**Secret rotations.** `pingone.env` lives in Secret
`agentless-mcpgw-oidc-config` (written once at `helm install`); when the
PingOne app secret rotates, re-sync the Secret and `rollout restart` — the
repo's `create-secrets.sh` has `align_gateway_oidc_secret` doing exactly
this, because a rotation reached the BFF but not the gateway twice
(2026-08-31, 2026-09-01). **Never regenerate the secret of OIDC client
`a6219652`** — Privilege-provisioned, with a sixth holder that has no API
and no console field; `secret.regenerate` kills the old value instantly with
no overlap window (broke console sign-in 2026-08-31). *Verified.*

## Re-enrolling a node (token expired, Host-IP fix, binary swap)

A node only re-enrolls from a new token when its old enrollment files are
gone. Verified procedure (GATEWAY-LOAD-BALANCER.md, run 2026-10-05):

1. Console **AI GW form**: existing Cluster ID, the node's in-cluster
   Service name as Host IP, Get Docker Command, keep the `eyJ...`.
   Single-use, ~2h; owner-only file; strip all whitespace.
2. **Scale the Deployment to 0, then delete the enrollment volume**
   (`<release>-ssl` — e.g. `agentless-mcpgw3-ssl`). Old enrollment files on
   the volume make the new token get ignored.
3. `helm upgrade --reuse-values -f <values>.yaml --set-file proxyToken=<file>`,
   then `kubectl rollout restart` (the Secret is read at pod start).
4. Expect 9/9 ready and the Redis line; delete the token file.

**Binary-swap warning** (*verified 2026-08-12*): `mcpgw` does not recognize
`cyonproxy`'s persisted enrollment state — a binary swap is not a config
toggle, it forces a fresh enrollment attempt. And since 2026-08-12, fresh
enrollment is **universally blocked** by a vendor-side CA trust wall:
every fresh `ENV_PROXY_TOKEN` fails with
`x509: certificate signed by unknown authority (Root CA PingOne Privilege)`
on every published image, in every context tested (four reproductions, one
laptop; `grpc.privilege.pingone.com` presents a real Ping PKI chain no image
trusts, and no CLI flag supplies a trust anchor). Already-enrolled nodes are
unaffected — they never re-verify a token once enrolled — but **first
enrollment and forced re-enrollment are currently dead ends**; raise with
Ping before planning one. Details: `PRIVILEGE-MCP.md` §2026-08-12.

If enrollment is impossible and the node is healthy: **leave it alone.**
Scale to 0 to take it out of rotation while keeping enrollment; never
delete the volume without a fresh token in hand.

## Teardown

*Verified 2026-09-01 outage:* `helm uninstall` deleted the release PVC **and
its PV** (reclaim policy `Delete`), destroying the EBS volume holding the
mTLS enrollment pair. The reinstall crash-looped
(`Proxy cert not found → CSR → privilege.pingone.com 500 → fatal`), and with
no mTLS pair plus an expired token the gateway **cannot re-enroll itself** —
a fresh token comes only from the console wizard (which was down). That is
an unrecoverable-without-console deadlock.

Before any `helm uninstall`:

1. `kubectl patch pv <pv> -p '{"spec":{"persistentVolumeReclaimPolicy":"Retain"}}'` **first**;
2. verify the PVC annotation `helm.sh/resource-policy: keep`;
3. confirm a valid, non-expired enrollment token is physically in hand.

An earlier note claiming "the PVC survives `helm uninstall`" was observed
once (2026-08-27) and **did not reproduce** — do not plan around it.

Take a node out of service without losing enrollment: scale to 0 and keep
its volume. Remove for good: `helm uninstall` with the three steps above.
There is **no console way to delete a node** — a replaced node's record was
kept being chased by other nodes ~1h then stopped on its own, never shown in
the list. *Verified.*

## What is and is not verified

| Fact | Status |
|---|---|
| Install sequence, token/whitespace/Host-IP traps, Redis behavior, resource sizing | Verified live 2026-10-03..05 |
| Second-node join, one-cluster failover, shared-Redis semantics, node re-enrollment | Verified live 2026-10-03..05 |
| PV destruction on uninstall, port-derivation outage, sidecar-list replacement, OIDC rotation breakage | Verified live (dated incidents) |
| Fresh-enrollment CA wall, binary-swap forcing re-enrollment | Verified live 2026-08-12; root cause inferred |
| The 2026-08-12 audit fixes (cert mount, 8690, SERVER_URL override) in `k8s/75-ping-mcpgw-deployment.yaml` | **Not verified live** — manifest still `replicas: 0`, never run |
| Mesh-inside-one-tenant supportability, Redis store supportability | Works but unconfirmed as supported — open questions with Ping |

## File map

| Path | Role |
|---|---|
| `pingone-privgateway-helm-main/agentless/agentless-mcpgw/` | The chart (use the directory, not the tgz) |
| `pingone-privgateway-helm-main/agentless/sidecars.values.yaml` | Shared sidecar + Redis values for every release |
| `k8s/helm/mcpgw/` | In-repo chart behind release `ping-mcpgw` (separate, older path; `replicas: 0`) |
| `k8s/75-ping-mcpgw-deployment.yaml` | Plain-manifest variant, digest-pinned, never run |
| `k8s/create-secrets.sh` | Builds `ping-mcpgw-secrets` (gitignored token file) + `align_gateway_oidc_secret` |
| `k8s/aws/deploy.sh` | App deploys only — installs nothing Privilege-related by design |
