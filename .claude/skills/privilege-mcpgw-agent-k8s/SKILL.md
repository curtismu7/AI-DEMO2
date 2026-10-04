---
name: privilege-mcpgw-agent-k8s
description: Deploy, repair and verify the PingOne Privilege AI Gateway (formerly "agentless MCP gateway") on the SE DevOps Kubernetes cluster from the pingone-privgateway-helm package, register an MCP server as an Agentic App, author policy, and prove the chain from an MCP client. Use whenever the task touches the agentless-mcpgw/privgateway Helm charts, ENV_PROXY_TOKEN or the Privilege console Gateways wizard, Agentic Apps registration, a Frontend Name like *.applications.procyon.ai:8643, or symptoms such as "Unknown client", "Gateway Unreachable — Error discovering MCP server: calling initialize: Unauthorized", "Access Denied for", "user not found in system", an MCP client hanging on a svc.cluster.local URL, or "has same NodeURL".
---

# Privilege AI Gateway on K8s

Rebuilt end to end 2026-09-01/02 and proven from Postman, LM Studio and the demo's
own client. Every command and error string here was observed, not inferred.

## Gateway 1, the one that owns the apps

| | |
|---|---|
| Helm release | `agentless-mcpgw` in `ping-devops-curtismuir` |
| Chart | `pingone-privgateway-helm-main/agentless/agentless-mcpgw-0.1.0.tgz` |
| Host | `mcpgw.ai-demo.ping-devops.com` (external-dns publishes it from the ingress) |
| Cluster ID | `ai-demo-cmuir` (the `clusterID` in the enrollment token) |
| PingOne tenant | `0428ba4f-169c-436b-aff9-b230496e0e3b` — "AI Agent" |
| Client URL | `https://mcpgw.ai-demo.ping-devops.com/<AgenticAppName>/mcp` |

**This chart prefixes nothing.** Its objects are `opensearch-mcp-server`,
`opensearch`, `agentless-mcpgw` — no release prefix. The older `privgateway`
chart did prefix (`cm-mcpgw-…`), and that release is gone; a `cm-mcpgw-*` or
`ping-mcpgw-*` name anywhere is stale.

`k8s/aws/deploy.sh` installs nothing Privilege-related — the gateway is a
deliberate manual install, because `ENV_PROXY_TOKEN` is single-use and ~2h-lived.

## Two gateways behind one URL (since 2026-10-03)

The table above is gateway 1. There is now a second gateway and a load balancer.
Full design, evidence and runbook: `privilege/GATEWAY-LOAD-BALANCER.md`. Read it
before changing any of this.

| | |
|---|---|
| Gateway 1 | release `agentless-mcpgw`, `ping-devops-curtismuir`, cluster `ai-demo-cmuir`. Owns every app and all sidecars. |
| Gateway 2 | release `agentless-mcpgw2`, `ping-devops-cmuir`. **Since 2026-10-04 a second node of gateway 1's cluster `ai-demo-cmuir`** (was its own cluster `ai-demo-cmuir2`, forwarding over the mesh). Serves every app itself, so it runs the same sidecars: upgrade it with `sidecars.values.yaml --set landingPage.enabled=false` as well as `gateway2-mesh.values.yaml` (its secrets live only in the release's stored values). |
| Load balancer | part of the chart (`templates/loadbalancer.yaml`), enabled on gateway 1's release by `gateway1-lb.values.yaml`. Deployment/Service `mcpgw-lb`. |
| Gateway 3 (installed 2026-10-04, parked and scaled to 0: 1000m CPU starved the SE cluster) | release `agentless-mcpgw3` in gateway 1's namespace; its container is named `agentless-mcpgw3`, via the chart's `nameOverride` and `ingress.enabled: false` (`gateway3.values.yaml`). Install steps and findings: `privilege/GATEWAY-LOAD-BALANCER.md` section 00c. `scripts/se-gateways.sh` upgrades it. |

**Two nodes in one cluster is the current layout** (`privilege/GATEWAY-LOAD-BALANCER.md`
section 00). What it changes:

- A sidecar app's backend is `localhost` in whichever pod takes the call. A node without
  the sidecars answers `500 dial tcp [::1]:<port>: connect: connection refused`. Both
  releases need the same sidecar list and the sidecars' secrets in both namespaces.
- The Grafana sidecar's secret is `mcp-grafana-secrets`: in `ping-devops-cmuir`,
  `grafana-secrets` is Grafana's own secret with different keys.
- Add a node with the console's **AI GW** form (Docker command), Cluster ID = the existing
  cluster name. The VM wizard yields a guest-agent env file the chart cannot use, and its
  screens show the tenant API key and OIDC secret in plain text: do not screenshot them.
- A gateway re-enrolls from a new token only if its old files in `/procyon/ssl` are out of
  the way. Move them to a subfolder instead of deleting, and the old enrollment can return.
- The bullets below about forwarding and the mesh describe the earlier two-cluster layout
  (nothing is forwarded now; "The mesh forwards" and "Watch `Error connecting`" are history).
  Pinning, in-memory sign-in state, Helm 4 and `--reuse-values` still apply as written.
- **Keeping the nodes in step is scripted:** `scripts/se-gateways.sh secrets` copies the
  sidecar secrets from gateway 1's namespace to gateway 2's (never overwrites without
  `--force`, never prints a value); `scripts/se-gateways.sh upgrade` dry-run-renders both
  releases and aborts if a sidecar would be dropped; add `--apply` to upgrade. Also
  `./run-pingaws.sh gateways ...`. Tested by `scripts/test-se-gateways.sh`.

How it fits together, and the traps, each one hit on 2026-10-03:

- **Apps are registered once.** An Agentic App is one tenant-wide object bound to
  one Mesh Cluster. Editing its Mesh Cluster in the console MOVES it off the
  other gateway; it does not copy it. Never "register it again" to test.
- **The mesh forwards.** The gateway a client lands on forwards the call to the
  cluster that owns the app, over port 8690. It works only because: `meshPort:
  8690` is published on both Services, and gateway 2 advertises its in-cluster
  Service name (`gatewayHostname`). A gateway dials its peer at the address the
  peer ADVERTISES; a public hostname resolves to the HTTPS ingress, where 8690
  is closed. Gateway 1 is the side that dials.
- **Watch `Error connecting to <node>` for mesh health** (gateway 1's
  `log-tailer`). `re-establishing link to node` and `has same NodeURL` are a
  node handling its own record and mean nothing.
- **Every client is pinned to one gateway** (hash on the client address).
  Registrations, OAuth state and tokens live in each gateway's memory: a token
  from one gateway gets 401 on the other. Round robin, even for `/mcp` only,
  breaks every signed-in client. The ingress overwrites any client-supplied
  `X-Forwarded-For`, and everyone behind one NAT hashes to the same gateway, so
  to reach the other gateway from your own network you must park one
  (`ownParked` / `parked` in `gateway1-lb.values.yaml`).
- **Gateway 1 is a single point of failure for the apps** (about 55 s down on a
  restart), and any failover costs the affected clients a sign-in. A failed
  gateway is held out for `loadBalancer.failTimeout` (600 s); with 10 s clients
  were bounced back and signed in twice.
- **TLS follows `oidc.serverUrl` matching the certificate**, not `-hostname`.
  Gateway 2's OAuth URL is the public one, so it serves plain HTTP and the load
  balancer bridges to it.
- **Helm on this machine is v4 and applies server-side.** Adopting objects that
  were created with `kubectl apply` needs the ownership annotations/labels AND
  `--force-conflicts`, or the upgrade fails half-way on a field-manager conflict.
- **`--reuse-values` does not hand a release the chart's NEW default values.**
  Spell out every key in the overlay file, and never read a new value in a
  template without `| default`. Also never `--set` a list index with
  `--reuse-values` (see the sidecar section below); edit the values file.
- **Helm dry-runs and `helm get manifest` print the release's Secrets.** Write
  them to a private file, never to a shared scratch directory, and remove them.

## Register the MCP server with `/mcp`, not `/sse`

This section said the opposite until 2026-10-02. In the console (Agentic Apps →
Add Application → MCP Server):

```
Application Name  opensearch22
MCP Server URL    http://opensearch-mcp-server.ping-devops-curtismuir.svc.cluster.local/mcp
Mesh Cluster      ai-demo-cmuir
Auth Mode         None
```

**Current gateway builds discover by POSTing `initialize` to the registered
path.** Confirmed in the gateway's own log on v1.260906 and v1.260925:

```
Error discovering MCP server: calling "initialize": sending "initialize":
rejected by transport: Post "http://<backend>/mcp": ...
```

A FastMCP-style `/sse` endpoint is GET-only and answers that POST with 405, so
an `/sse` registration fails discovery and every JSON-RPC call. The registered
path also becomes the only client-facing path: a client calling `/mcp` on an app
registered on `/sse` gets a bare 404 once signed in
(`rejecting /mcp on app <name>: outside entry path "/sse"`).

**Earlier builds (August 2026) behaved the other way** — a bare `GET`, then a
wait for the SSE `endpoint` event — which is why this skill used to say `/sse`.
That is from notes, not re-measured. If discovery fails on a build you have not
seen before, read the `Error discovering MCP server` line: it names the method
and path the gateway actually used.

Whatever the cause, a discovery failure shows in the console as

```
Gateway Unreachable — Error discovering MCP server:
calling "initialize": sending "initialize": Unauthorized
```

which reads like an auth fault and usually is not one. Tools stay empty and
**policy creation is disabled** until discovery succeeds. Discovery re-runs when
the gateway restarts or a re-scan is forced (`MCP force-sync app=<name>` in the
log):

```bash
kubectl rollout restart deployment/agentless-mcpgw -n ping-devops-curtismuir
```

Full test record: `privilege/GATEWAY-REGISTERING-AN-MCP-SERVER.md`.

**Backend vs client URL are different ends of the hop.** `svc.cluster.local`
resolves only inside the cluster — Postman/LM Studio failing on it is correct,
not a symptom. Clients use the Frontend/client URL above. To reach the backend
from a laptop: `kubectl port-forward -n ping-devops-curtismuir svc/opensearch-mcp-server 9900:80`.

## The packaged `.tgz` goes stale silently — repackage after every template edit

`templates/deployment.yaml` in the vendored chart carries **local additions**
the upstream chart doesn't have: `imagePullSecrets` and `extraContainers`
(the mechanism for adding a new MCP server as a sidecar — see below). The
`.tgz` alongside the chart source is a **build artifact**, not the source of
truth. Edit the source and forget to `helm package` it again, and every
subsequent `helm upgrade` against the stale `.tgz` silently re-renders the
Deployment WITHOUT those blocks — dropping every `extraContainers` sidecar
and the pull secret in one shot.

**This is the trap that caused a live outage 2026-09-07.** The tell that cost
the most time: `helm get values` / `helm get values -a` kept showing
`extraContainers` and `imagePullSecrets` present and correct in the merged
values object, because Helm happily stores values for keys a stale template
never reads. Only `helm get manifest <release> --revision <N> | grep
extraContainers` (or a `--dry-run` against the render you're about to apply)
tells you whether the template actually consumed them. Recovery required a
direct `kubectl patch --type=json` on the live Deployment to restore service,
then re-running `helm package agentless-mcpgw/` and `helm upgrade
agentless-mcpgw agentless-mcpgw/ -n ping-devops-curtismuir --reuse-values`
**against the source directory, not the tgz**, to bring the release's own
tracked state back in sync with reality.

**Rule going forward:**
- After ANY edit to `agentless-mcpgw/templates/*` or `agentless-mcpgw/values.yaml`, run `helm package agentless-mcpgw/` immediately, in the same change.
- Before any upgrade that touches `extraContainers` or `imagePullSecrets`, dry-run it first and grep the render: `helm upgrade agentless-mcpgw <chart> -n ping-devops-curtismuir --reuse-values --dry-run | grep -c 'name: mcp-brave\|name: mcp-grafana\|name: mcp-banking-rest\|ghcr-pull-secret'` — expect 4. Zero means you're about to drop sidecars, whatever `helm get values` claims.
- When actively iterating on the chart, upgrade directly against the **source directory** (`pingone-privgateway-helm-main/agentless/agentless-mcpgw/`) instead of the `.tgz` — it can't go stale because there's nothing to forget to repackage.
- Never patch a nested list index with `--set` (e.g. `--set extraContainers[2].env[1].value=...`) combined with `--reuse-values` — on this chart it corrupted sibling list entries to `null` rather than patching the one field. Use a full values file (`-f`) that restates the whole list instead.

### Adding a new MCP server as a sidecar

Apps added from the Privilege MCP catalog pin their backend to a fixed,
non-editable `http://localhost:8080/mcp` — the only way to satisfy that is to
run the server inside this same pod. Add an entry to `extraContainers` in a
values file (same shape as the existing three: `name`, `image`, `ports`,
`env`, `readinessProbe` on `/health`), give it its own `PORT` (8080/8081/8082
are taken), then:

```bash
helm package agentless-mcpgw/                      # keep the .tgz in sync
helm upgrade agentless-mcpgw agentless-mcpgw/ -n ping-devops-curtismuir \
  --reuse-values --dry-run -f my-new-sidecar.yaml   # verify the render first
helm upgrade agentless-mcpgw agentless-mcpgw/ -n ping-devops-curtismuir \
  --reuse-values -f my-new-sidecar.yaml
kubectl rollout status deployment/agentless-mcpgw -n ping-devops-curtismuir
```

Then register it in the Privilege console as its own Agentic App pointing at
`http://localhost:<its-port>/mcp` (not `/sse` — see the registration section
above), Mesh Cluster `ai-demo-cmuir`, Auth Mode None.

## Deploy

```bash
kubectl config current-context                 # expect: us
kubectl get clusterissuer letsencrypt-pdo
kubectl get ingressclass nginx-public

cat > /tmp/secrets.yaml <<'YAML'
proxyToken: "eyJ..."          # console > Gateways > Add New > Add via Docker
oidc:
  clientId: "…"
  clientSecret: "…"
  authUrl:  "https://auth.pingone.com/<envId>/as/authorize"
  tokenUrl: "https://auth.pingone.com/<envId>/as/token"
  userUrl:  "https://auth.pingone.com/<envId>/as/userinfo"
YAML
chmod 600 /tmp/secrets.yaml

helm upgrade --install agentless-mcpgw <chart>.tgz \
  --namespace ping-devops-curtismuir \
  --set hostname=mcpgw.ai-demo.ping-devops.com \
  --set namespace=ping-devops-curtismuir \
  --set oidc.serverUrl=https://mcpgw.ai-demo.ping-devops.com \
  --values /tmp/secrets.yaml
```

Decode the token before using it — `tenantName` is the **environment id**, and
`clusterID` is what the Agentic App's Mesh Cluster field must say:

```bash
python3 -c "
import base64,json,sys,datetime
p=sys.argv[1].split('.')[1]; p+='='*(-len(p)%4)
c=json.loads(base64.urlsafe_b64decode(p))
print({k:c.get(k) for k in ('clusterID','nodeId','tenantName')})
print('exp',datetime.datetime.fromtimestamp(c['exp'],datetime.timezone.utc))" 'eyJ...'
```

Enrollment lives in the `agentless-mcpgw-ssl` PVC afterwards, so restarts need
no token. Success in the log is `LinkStatus:Active`; `has same NodeURL` and
mesh-controller `not found` are cosmetic — do not chase them.

**Changing OIDC values requires a restart.** `helm upgrade` rewrites the secret
but the running pod keeps the old config, which shows up as an authorize
redirect carrying an empty `client_id`.

## The PingOne OIDC app

Web app, **Client Secret Basic**, grant types Authorization Code **+ Token
Exchange**, redirect `https://mcpgw.ai-demo.ping-devops.com/callback`, and on
Resources grant `openid`, `profile`, `email`.

`p1:read:env` and `p1:read:application` **do not exist as user-context scopes**
in PingOne — the chart's default scope string asks for them, PingOne silently
drops them, and that is harmless. Only `p1:read:user` is real, and the flow works
without it. (Verified by enumerating all 23 scopes on the PingOne API resource.)

## Clients

Everything discovers and registers dynamically — **no client id or secret is
configured anywhere on the client side**:

```
https://mcpgw.ai-demo.ping-devops.com/<AppName>/mcp
```

- **Postman:** MCP request, transport HTTP, Auth **None**. It DCRs and opens a browser.
- **LM Studio:** just the `url` in `mcp.json`. Needs ≥ 0.4.10 for MCP OAuth.
- **The demo's own client:** `/privilege-mcp-client` — see below.

**The gateway's DCR registry is in Redis (since 2026-10-04).** Both gateways share
one Redis (`privilege-redis` in `ping-devops-cmuir`, env `MCPGW_REDIS_URL`), so a restart
no longer forgets registered clients. Without Redis, every gateway restart forgets every
registered client and the next authorize shows a bare `Unknown client` page. The BFF
detects that and re-registers (`isDcrClientStillKnown` in
`demo_api_server/routes/privilegeMcpClient.js`); an MCP client that caches its
registration must be deleted and re-added by hand. That now only happens if Redis lost
its data or was down. **Tokens are NOT shared**, so a switch between gateways (stop,
park) still makes the BFF register and sign in again, about 20 s, automatic; only the
registry survives (tested 2026-10-04).

**Redis rules (verified 2026-10-04, see `privilege/GATEWAY-LOAD-BALANCER.md`, "Shared Redis"):**
- Upgrade with `-f sidecars.values.yaml` as always; it carries `redis.urlSecret`, so the
  setting survives an upgrade that does not use `--reuse-values`. The env var name is
  `MCPGW_REDIS_URL` (NOT `REDIS_URL`; the gateway ignores that one).
- **Never restart a gateway while Redis is down.** It retries 6 times, then exits
  (`fatal ... unreachable after 6 attempts`) and the pod loops. Restore Redis first.
- Redis down while the gateways run: they keep serving but new registrations return
  `201` and are silently not kept, so `/authorize` says "registration has expired".
- The Secret `privilege-redis-url` must exist in BOTH namespaces before an upgrade.

## Policy denials

Policies are **per Agentic App**, time-boxed, and name users — a new app has no
policy even if a sibling app does. Read the gateway log, not the client:

```bash
kubectl logs -n ping-devops-curtismuir deployment/agentless-mcpgw -c log-tailer --tail=200 \
  | grep -E 'identity resolved|policy denied'
```

| Log line | Meaning |
|---|---|
| `policy denied … : user not found in system` | the user is not synced into Privilege — fix the PingOne Privilege app's Group Membership Policy and the user's group |
| `policy denied … : Access Denied for` | user is synced; **no policy on this app covers them** |
| `✅ User identity resolved: … Email=` (empty) | cosmetic. Email is empty for every user, including ones whose policy works. Do NOT chase it — it is not why a call is denied |

The client renders both as a bare `403 Forbidden` / "The MCP server denied this
operation", so always go to the log for the real reason.

**Policy behaves strangely (union of old + new grants, an app you just
created denies everything, the wrong tool list) or a door you registered
moments ago 404s or 401s in a way that doesn't add up?** Read
`privilege/LESSONS-LEARNED.md` first — it covers exactly those failure
modes with the log lines that distinguish them.

## Symptom index

| Symptom | Cause |
|---|---|
| Console "Gateway Unreachable … initialize: Unauthorized", Tools empty, policy disabled | discovery failed: backend registered on `/sse` (use `/mcp` on current builds), wrong hostname, or an expired policy reported misleadingly — read the `Error discovering MCP server` log line |
| `Unknown client` page at `/authorize` | gateway restarted and forgot the DCR client; re-register |
| LM Studio "This client's registration has expired" | same thing, or the client now lands on the OTHER gateway (one was parked, restarted or failed over). Remove the entry from `~/.lmstudio/mcp.json`, quit, re-add, sign in |
| `401` on `/<app>/mcp` straight after a successful sign-in | the token came from one gateway and the call reached the other: pinning is broken. Compare `node=` on the `token` and `mcp` lines of the `mcpgw-lb` log |
| `500` on `/<app>/mcp` while sign-in works | one node is missing the sidecars: `dial tcp [::1]:<port>: connection refused` means the pod that took the call has no sidecar on that port. Run `scripts/se-gateways.sh upgrade`. (Two-cluster layout only: mesh link down, `Error connecting to <node>` on gateway 1) |
| An app stops working on one gateway after a console edit | its Mesh Cluster was changed, which moves it. Set it back |
| `helm upgrade` fails with `conflict with "kubectl-client-side-apply"` | Helm 4 server-side apply on an object first made with `kubectl apply`; add `--force-conflicts` |
| A `400` right after every LM Studio connect | harmless: the client probes MCP protocol `2026-07-28`, the backend refuses, the client falls back |
| `Error finding next hop to <cluster>. Cluster not found` | app's Mesh Cluster names a torn-down gateway; set it to `ai-demo-cmuir` |
| MCP client hangs forever | pointed at `svc.cluster.local`, or at a `*.applications.procyon.ai:8643` agent frontend (this chart exposes no inbound mesh port) |
| Authorize redirects with empty `client_id` | pod still running pre-`helm upgrade` OIDC config; restart |
| Console shows apps you did not create / your edits do not appear | wrong tenant. The gateway's tenant is `0428ba4f`; open the console from the agent menu bar and check the tenant name |
| `404 NOT_FOUND` opening the app from the PingOne portal | expected — the gateway's OIDC client has no initiate-login URI; start from the client instead |
