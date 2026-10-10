# Agent Privilege: load balancer and second gateway

Status: both gateways in rotation as two nodes of ONE mesh cluster (`ai-demo-cmuir`); one
app registration serves both, and each node serves every app on its own. Both share one
Redis (section 00b), so registered clients survive a gateway restart and are known to both
gateways. A switch still costs the demo's Privilege page a fresh registration and sign-in
(tested): the registry is shared, the tokens are not.
Last updated 2026-10-04. **Section 00 below is the current layout.** It supersedes section 0
(two clusters, forwarding over the mesh), which in turn superseded the parts of sections 1,
5.3, 6 and 9 that say the gateways cannot mesh or that apps must be registered twice.
Audience: engineers and SEs reviewing how we show "two gateways behind one URL".
Related: [CURRENT-CONFIGURATION.md](CURRENT-CONFIGURATION.md), [LESSONS-LEARNED.md](LESSONS-LEARNED.md),
skill `.claude/skills/privilege-mcpgw-agent-k8s/SKILL.md`.

## 00. Current layout (2026-10-04): two nodes in one mesh cluster

Gateway 2 left its own cluster (`ai-demo-cmuir2`) and re-enrolled as a second node of
gateway 1's cluster, `ai-demo-cmuir`. An app belongs to a cluster, so both nodes now own
every app. Neither forwards to the other, and neither depends on the other.

| | Two clusters + mesh (section 0) | Two nodes, one cluster (now) |
| --- | --- | --- |
| App registrations and policies | One | One |
| Who serves a call | The owning cluster; the other gateway forwards | The node the client is pinned to |
| Gateway 1 down | Every app down (~55 s) | Tested 2026-10-04 with gateway 1 scaled to 0: the load balancer moved to gateway 2 within one 10 s sample and two signed-in sidecar apps worked from the UI |
| Sidecars | Gateway 1 only | Both pods |
| Failover costs a sign-in | Yes | Yes, still: tested with Redis on 2026-10-04, the demo page registered and signed in again on gateway 2 within seconds (section 00b). The registry is shared, the tokens are not |

**How the node was added.** Console, Gateways, Add New, the **AI GW** form with a Docker
command at the end (not the VM wizard, which produces a guest-agent env file the chart
cannot use). Cluster ID `ai-demo-cmuir`, the existing name; Host IP gateway 2's in-cluster
Service name. The token's claims then read `clusterID: ai-demo-cmuir` with a new `nodeId`.
On gateway 2, the old enrollment files in `/procyon/ssl` were moved into
`/procyon/ssl/backup-cmuir2` (kept for rollback), the release was upgraded with
`--set-file proxyToken=<file>`, and the pod restarted. It re-enrolled from the token.

**What the test showed.**

| Check | Result |
| --- | --- |
| Second node joins the cluster | Yes: `ClusterID:ai-demo-cmuir`, `LinkStatus:Active`, new node id |
| It serves an app itself | Yes: signed-in `opensearch22` returned `200` from gateway 2 with zero `ConnStream` lines on gateway 1 |
| Sidecar app before gateway 2 had sidecars | `500 dial tcp [::1]:8084: connect: connection refused`: the backend is `localhost` in the pod that takes the call |
| After adding the sidecars to gateway 2 | Pod 9/9 ready; every sidecar `/health` ok and `initialize` answered on 8084, 8080, 8083 and 8081 from inside the pod; no discovery errors except `probe-agent-gateway` (its backend does not exist) |

**What it needs.**

- The same sidecar list on both releases: `sidecars.values.yaml`. For gateway 2 add
  `--set landingPage.enabled=false`.
- The sidecars' secrets in both namespaces: `brave-secrets`, `banking-rest-secrets`,
  `pingone-mcp-secrets`, `mcp-grafana-secrets`, `ghcr-pull-secret`. The Grafana one is not
  called `grafana-secrets` because in `ping-devops-cmuir` that name is Grafana's own secret.
- Backend URLs that resolve from both namespaces: full Service names, never short ones.

**Not verified.**

- Sign-in surviving the switch: it did not, BEFORE Redis (the stop test was run before the
  gateways were put on Redis, see section 00b). In the 2026-10-04 stop test gateway 2's log shows
  two new client registrations, each followed by authorize, callback and token, at 10:15:39 to
  10:15:49 CDT (about 35 s after the stop, before the app calls began). That fits the demo
  Privilege page re-registering itself once per app; the log does not name the source, and
  whether a person saw a prompt is not known. The sequence took under 10 s. Each gateway keeps
  sign-in state in memory, so this is the expected cost of a switch.
- Agent-key callers (the A2A apps) DURING a stop. The route probe stayed `401` throughout.
  A2A ran all five scenarios with `sk-orion` agent keys at 10:17:57 CDT, a minute after
  gateway 1 returned and 3 s after a probe from the same machine read `gateway-2`, so they
  were most likely served by gateway 2 (the load balancer pins by address). They passed with
  no re-registration, and scope, policy, per-tool grants and AIGuard all still applied.
  Nothing was sent with a key while gateway 1 was actually down.
- How long the load balancer keeps gateway 1 out after it returns. Its setting is up to 600 s;
  the probe still read `gateway-2` about a minute after gateway 1 was Ready.
- Whether `gatewayHostname`, `hostAliases` and `meshPort` are still needed now that nothing
  is forwarded. They were left in place.
- Whether MCP clients other than the demo page (for example LM Studio) keep working across a
  switch. Their registration is known to both gateways, but they hold tokens issued by one
  gateway, so they probably sign in again, as the demo page did. Not tested. The second
  key prefix `mcpgw:pl` is unexplained.

**What was done on 2026-10-04, in order.**

1. Sidecar-app test on the old layout: `brave0local` through gateway 2 over the mesh
   (recorded under section 0).
2. Gateway 2 parked; its enrollment moved to `backup-cmuir2`; re-enrolled with a token for
   cluster `ai-demo-cmuir` (release `agentless-mcpgw2` revision 8).
3. Test with gateway 1 parked: `opensearch22` served by gateway 2 alone; `brave0local`
   failed with connection refused.
4. Secrets copied to `ping-devops-cmuir`; `mcp-grafana-secrets` created in both namespaces;
   sidecars added to gateway 2 (revision 9, pod 9/9).
5. Gateway 1 upgraded with the same `sidecars.values.yaml` (release `agentless-mcpgw`
   revision 53, pod 9/9 after one restart). The first attempt failed on a field-manager
   conflict with an old `kubectl patch` on the Grafana secret reference; `--force-conflicts`
   cleared it.
6. Both gateways in rotation.

**What is left.**

| Item | Who | Note |
| --- | --- | --- |
| ~~Signed-in call to a sidecar app through gateway 2~~ | Done 2026-10-04 | `brave0local` and `opensearch22` both worked from the demo UI with gateway 1 stopped |
| ~~Prove apps stay up with gateway 1 stopped~~ | Done 2026-10-04 | Scaled `agentless-mcpgw` to 0 for about 90 s and back to 1; probe every 10 s: `x-served-by` moved to `gateway-2` within one sample, gateway 2 stayed 9/9 |
| ~~Registrations surviving a failover~~ | Done 2026-10-04 | Shared Redis (section 00b); restart and cross-gateway tests pass |
| ~~Signed-in session surviving a failover~~ | Tested 2026-10-04: it does not | Registrations are shared, tokens are not; the demo page registered and signed in again. Ask Ping whether user tokens can be shared too |
| Ask Ping | Open | Is a second node in one cluster the supported HA layout; is `MCPGW_REDIS_URL` supported, and is the exit after 6 failed Redis attempts intended; are `gatewayHostname`/`hostAliases`/`meshPort` still needed |
| ~~Old cluster `ai-demo-cmuir2` and its node~~ | Done 2026-10-05 | Deleted from the console by the owner. This ended the rollback path to the two-cluster layout |
| Secrets shown in a console screenshot (tenant API key and secret, OIDC client secret) | Owner's decision | They were pasted into a chat during setup; rotate if that history is not private |
| `probe-agent-gateway` app | Open, unrelated | Its backend `hdr-echo.ping-devops-cmuir` does not exist; discovery fails on both nodes |

**Roll back to section 0.** Park gateway 2, move the files in `backup-cmuir2` back into
`/procyon/ssl`, restart gateway 2, and delete node `7f449849…` in the console.

## 00a. HAProxy engine (2026-10-07, built, NOT deployed)

`loadBalancer.engine: haproxy` swaps the two nginx pods for HAProxy
(`templates/loadbalancer-haproxy.yaml`): same Deployment, Service, port 8623 and
`X-Served-By` header, so the ingresses are untouched. `engine: nginx` rolls it back.
Why: nginx OSS only notices a dead gateway when a client request fails; HAProxy probes each
gateway every 10 s (`GET /`, any 2xx-4xx is up), needs no loopback bridges, and keeps the
10-minute hold-out as `failTimeout / 10 s` consecutive passing checks.

Tested locally 2026-10-07 (haproxy 3.0.29, three fake gateways, one https and two plain):
the same client key always hit the same gateway; stopping one moved only its clients, and
they came back when it returned; no-header requests still answered. The rendered live
config passes `haproxy -c` and starts with an unresolvable peer name (that is what the
`resolvers` block is for).

Not tested: the real gateways' answer to `GET /` with a `Host` header (assumed 401, which
counts as up), `check-sni` against the real certificate, and the swap on the cluster. Before
switching, `kubectl exec` a curl against each gateway Service. Swap with
`--set loadBalancer.engine=haproxy` on the same `helm upgrade` as `gateway1-lb.values.yaml`.

## 00b. Shared Redis (2026-10-04): what it does, why, how

**What it is.** One small Redis, `privilege-redis` in `ping-devops-cmuir`, that both gateways
use as their token store instead of their own memory. The gateway reads it from the
environment variable `MCPGW_REDIS_URL`. Without that variable the gateway logs "no
MCPGW_REDIS_URL configured; using the in-memory token store (single instance only,
resource tokens are lost on restart)". The binary embeds a Redis client and a
`redisTokenStore`; Ping's docs do not mention Redis, so this is not a documented feature.

**What it does for us (each line was tested on 2026-10-04).**

| Before Redis | With Redis |
| --- | --- |
| A gateway restart forgot every registered client; `/authorize` answered 400 "registration has expired" | Restart gateway 2, then ask it about a client registered before: 302 to PingOne, still known |
| A client registered on gateway 1 was unknown to gateway 2 | Registered on either gateway, both gateways answer 302 (tested in both directions) |
| Every switch (stop, restart, park, un-park) made the demo's Privilege page and every MCP client register again | The registry survives, so a client that keeps its registration is still known to the other gateway. The demo's Privilege page still registered and signed in again on a switch (tested 2026-10-04): its tokens are not shared |
| A Redis restart: not applicable | With the append-only file on a volume, restart the Redis pod and a client registered before is still known |

Agent-key callers (the A2A apps) never depended on registrations, and A2A's five scenarios
passed 7.5 minutes after Redis came back empty.

**Session survival, tested 2026-10-04: it does not survive.** The stop test was repeated with
both gateways on Redis and the demo's Privilege page signed in (its traffic was pinned to
gateway 1, which was scaled to 0 for about a minute). Both apps returned their tools. But
gateway 2 recorded, within 2 to 22 seconds of the stop, two new client registrations, two
authorizations, two callbacks, two token exchanges and eight MCP `initialize` calls: the same
pattern as before Redis. So the registry is shared, but the page's access and refresh
tokens, issued by gateway 1, were not honoured by gateway 2, and the page registered and
signed in again. The whole sequence took about 20 s and each authorize-to-callback hop took
one second (single sign-on), so a person may not see a prompt. The reason is our
inference; the log does not say. Redis therefore holds a registered client, but apparently
not the page's tokens. The "resource tokens" wording in the log line and the second key
prefix `mcpgw:pl` are still unexplained.

**Why we use it.**

- A gateway restart no longer forgets registered clients, so an MCP client that keeps its
  registration is still known afterwards, to either gateway. A switch still costs the demo's
  Privilege page an automatic re-registration and sign-in of about 20 seconds (tested),
  because tokens are not shared.
- It is the only way we found to share state between the gateways; the product offers no
  other setting, and the chart has no Redis value of its own (we added one).
- It is cheap: one pod, 1Gi of disk.

**What it costs: Redis is now a hard dependency.** Tested by scaling it to 0:

| Situation | What happens |
| --- | --- |
| Redis goes down while the gateways run | Both stay 9/9 and keep serving. A new client registration still returns 201 and a client ID but is not kept, so the client's next `/authorize` says "registration has expired". Only the gateway log says why: `Redis PutClient: ... connection refused` (or `i/o timeout` from the other namespace). |
| A gateway restarts while Redis is down | It retries 6 times (1, 2, 4, 8, 16 s apart), logging "Not falling back to memory: a configured Redis is required", then exits (`fatal ... unreachable after 6 attempts`). The pod reads Ready during the retries, then the container loops. **Any gateway restart during a Redis outage is a gateway outage.** |
| Redis comes back | The gateways reconnect by themselves (gateway 2 on attempt 3 of 6); gateway 1 needed no restart. |

**How it is wired.**

- **Redis:** `privilege/redis-canary/redis.yaml` (the folder name is historical). One
  Deployment, `Recreate`, a ClusterIP Service `privilege-redis`, a 1Gi claim
  `privilege-redis-data`, append-only file with `everysec` fsync, `maxmemory 64mb` with
  `noeviction` (when memory is full, writes fail with an error and nothing stored is
  deleted; every key the gateway writes has an expiry, so `volatile-lru` would still evict
  registrations), image pinned by digest,
  password from the Secret `privilege-redis`. No TLS: in-cluster, password only.
- **The URL:** a Secret `privilege-redis-url`, key `url`, in **both** namespaces:
  `redis://:<password>@privilege-redis.ping-devops-cmuir.svc.cluster.local:6379/0`.
- **The chart:** value `redis.urlSecret.name` (and `.key`, default `url`); when set, the gateway
  container gets `MCPGW_REDIS_URL` from that Secret. It is also set in
  `sidecars.values.yaml`, which both releases are upgraded with, so an upgrade that omits
  `--reuse-values` cannot silently turn it off.
- **The name:** `MCPGW_REDIS_URL`. A bare `REDIS_URL` is ignored (we shipped that mistake first).

**How to set it up from scratch.** Do the Secrets and Redis first; the gateways need Redis
reachable when they restart.

```bash
# 1. Redis password, then Redis itself
kubectl --context us -n ping-devops-cmuir create secret generic privilege-redis \
  --from-literal=password="$(openssl rand -base64 24 | tr -d '/+=')"
kubectl --context us -n ping-devops-cmuir apply -f privilege/redis-canary/redis.yaml

# 2. The URL Secret in BOTH namespaces (the password is never printed)
URL="redis://:$(kubectl --context us -n ping-devops-cmuir get secret privilege-redis -o jsonpath='{.data.password}' | base64 -d)@privilege-redis.ping-devops-cmuir.svc.cluster.local:6379/0"
kubectl --context us -n ping-devops-cmuir    create secret generic privilege-redis-url --from-literal=url="$URL"
kubectl --context us -n ping-devops-curtismuir create secret generic privilege-redis-url --from-literal=url="$URL"

# 3. Each release, one at a time (dry-run first; check ownParked; gateway 2 first)
helm --kube-context us upgrade agentless-mcpgw2 pingone-privgateway-helm-main/agentless/agentless-mcpgw \
  -n ping-devops-cmuir --reuse-values --set redis.urlSecret.name=privilege-redis-url
helm --kube-context us upgrade agentless-mcpgw  pingone-privgateway-helm-main/agentless/agentless-mcpgw \
  -n ping-devops-curtismuir --reuse-values --set redis.urlSecret.name=privilege-redis-url
```

Each upgrade restarts that gateway once. Tell anyone using the gateway first, as the
restart drops registrations made before Redis was on.

**How to check it works.** Three checks, none needs a sign-in:

1. The gateway log says `Redis token store connected on attempt 1/6` (with the password
   masked): `kubectl exec deploy/agentless-mcpgw -c agentless-mcpgw -- sh -c 'grep -i redis /var/log/procyon/cyonproxy.log | tail'`.
2. The cross-gateway test, from a pod inside the cluster: POST `/langchainagent/register`
   (a public client, `token_endpoint_auth_method: none`) on one gateway, then GET
   `/langchainagent/authorize?...` for that client on each gateway directly (gateway 1:
   `https://agentless-mcpgw.ping-devops-curtismuir:8623`, gateway 2:
   `http://agentless-mcpgw.ping-devops-cmuir:8623`). Expect 302 to PingOne from both;
   400 "registration has expired" means the gateways are not sharing state.
3. Redis has keys: an authenticated `DBSIZE` shows more than 0 after a registration, with
   key names starting `mcpgw:cl` (clients).

**Rules for running it.**

1. **Never restart a gateway while Redis is down.** Bring Redis back first.
2. Restarting Redis is safe with the volume (tested); a Redis outage still drops
   registrations made during it.
3. Upgrade the gateways with `-f sidecars.values.yaml` as before; it carries the Redis setting.
4. To turn it off: upgrade each release with `--set redis.urlSecret.name=` (empty). The
   gateways go back to in-memory state, and `kubectl delete -f privilege/redis-canary/redis.yaml`
   removes Redis (the claim stays until deleted). Not tested end to end.
5. Rotating the Redis password has not been tried. The order should be: change
   `privilege-redis`, rebuild `privilege-redis-url` in both namespaces, restart Redis, then
   restart each gateway.

**Limits.** One pod: it is a single point of failure for both gateways' startup, and no
amount of persistence changes that. Not a documented Ping feature, so ask Ping whether
`MCPGW_REDIS_URL` is supported and whether the exit after 6 failed attempts is intended.

## 00c. A third node in gateway 1's namespace (installed 2026-10-04, back in rotation 2026-10-05)

**Status, 2026-10-05: running (9/9, Redis connected), listed by the console as the third node of
`ai-demo-cmuir`, and un-parked in the load balancer. It answers the app routes (shown with gateways
1 and 2 parked, see "Proof test" below); a signed-in call served by it has not been shown.**
It was re-enrolled the same day (see "Re-enrolling a node" below) because the first enrollment
never produced a console row. It was removed from service on 2026-10-04
because its pod requested 1000m CPU (nine containers), which left the SE cluster with no node
that had 750m free: SE's `demo-api-server` sat Pending for 36 minutes with "27 Insufficient
cpu". It came back after the main container's request was cut to 250m (below).

What it had shown before that: enrolled in `ai-demo-cmuir` as a third node, pod 9/9, Redis
connected on attempt 1/6, Certificate issued, in rotation. **It never served a request:**
tests through the public URL land on whichever node the client address hashes to, and on
2026-10-04 that was always gateway 1 (39 of 39 logged requests). It was not proven to serve apps.

**Why it was so big, measured 2026-10-05:** the whole 1000m was the main gateway container
(request 1 CPU, 2Gi, from the chart default). The eight sidecars request nothing. At idle that
container used about 30m CPU and 40 MiB, on gateways 1 and 2 alike. `sidecars.values.yaml` now
sets the main container's request to 250m and 512Mi (limits unchanged at 2 CPU and 4Gi), for
every release. The startup burst was not measured; raise the request if a gateway is throttled
when it starts. (An earlier version of this section said to trim the sidecars' requests; that
was wrong, they have none.)

**To take it out again:** set `parked: true` for `gateway-3` in `gateway1-lb.values.yaml` and
`replicaCount: 0` in `gateway3.values.yaml`, then `scripts/se-gateways.sh upgrade --apply`. The
chart's `replicaCount` value (added 2026-10-05; the template used to hardcode 1 and every upgrade
reset a scaled-down gateway) keeps it at 0 across upgrades. To bring it back, set `replicaCount: 1`
and `parked: false` and upgrade, then wait for 9/9 and the Redis line. `se-gateways.sh` still
skips gateway 3 if its live Deployment was scaled to 0 by hand, so a manual
`kubectl scale ... --replicas=0` is also safe.

**Proof test, run 2026-10-05 (partial).** Park gateways 1 and 2 so the only live upstream is
gateway 3, call `opensearch22` and `brave0local`, and check the client-facing line in the load
balancer log. Everyone using the demo is on gateway 3 alone while it runs, and signed-in clients
may be asked to sign in again. Apply with a values file that copies `gateway1-lb.values.yaml` with
`loadBalancer.ownParked: true` and gateway-2's `parked: true` (`helm upgrade agentless-mcpgw ...
--reuse-values -f sidecars.values.yaml -f <that file>`), and restore by upgrading again with the
repo's `gateway1-lb.values.yaml`. The parking was done by the owner, because the permission classifier
blocks an agent from re-routing the shared load balancer.

Result: with gateways 1 and 2 parked, an **unauthenticated** `POST` to `/opensearch22/mcp` and to
`/brave0local/mcp` on the public gateway URL returned 401 from gateway 3 (`node=gateway-3` on the
ingress-facing line). So gateway 3 receives and answers app requests. The owner's own signed-in calls
did not appear in the load balancer log at all, so **no signed-in call served by gateway 3 has been
shown**. Both gateways were un-parked afterwards (all three upstreams live, no pod restarted).

How to read the load balancer log: each client request is logged twice. The line from the ingress
address (10.52.x) carries the real `node=`. The line from `127.0.0.1` is the load balancer's own hop
through its per-peer bridge and is always labelled `node=gateway-1`, which is the fallback label, as
is the label on `/lb-health` probes and on a request that found no upstream (a 502). Pass needs
`node=gateway-3` with a 200 on the ingress line. Read both load balancer pods
(`kubectl logs -l app=mcpgw-lb --prefix --max-log-requests=4`), because `deploy/mcpgw-lb` reads only one.

**Re-enrolling a node (done for gateway 3 on 2026-10-05).** The console's Gateways page is a tree:
one row per cluster ("3 nodes"), with a child row per node showing its address. A node's address
is the **Host IP typed into the AI GW form**, and a node cannot be edited afterwards, only
re-created. Gateway 3 was first enrolled with the form's pre-filled Host IP
(`ai-demo.ping-devops.com`) and never got a row, although the gateway itself ran and its mesh
node was visible in the other gateways' logs. Re-enrolling with the right Host IP
(`agentless-mcpgw3.ping-devops-curtismuir.svc.cluster.local`) produced the row. Steps:

1. Console: Gateways, Add New, the **AI GW** form, Cluster ID `ai-demo-cmuir`, the node's own
   in-cluster Service name as Host IP, then Get Docker Command. Keep only the `eyJ...` value after
   `ENV_PROXY_TOKEN=`; it is single-use and lasts about 2 hours.
2. Save it to an owner-only file and **strip every leading and trailing whitespace character**
   before use. Two stray leading characters made the first attempt crash-loop with
   `crypto/ecdsa: verification error` (the Secret held a token that would not decode, and the
   local signature check runs before the server is contacted, so the token was not spent).
   Check the file is one line starting `eyJ`, with no whitespace before the first character.
3. Scale the Deployment to 0, then delete the node's enrollment volume (`agentless-mcpgw3-ssl`):
   a node only re-enrolls from a new token when its old files are gone.
4. `helm upgrade ... --reuse-values -f sidecars.values.yaml -f gateway3.values.yaml --set-file
   proxyToken=<file>`, then `kubectl rollout restart deploy/agentless-mcpgw3` (the Secret is read at
   pod start). Expect 9/9 and `Redis token store connected on attempt 1/6`.
5. Delete the token file. The old node's record (`3e1b59d6` for gateway 3) may linger in the mesh:
   the other gateways keep logging attempts to reach it. It did not appear in the console list.

The gateway's own log is a file, not stdout: for a crash loop read it from a running sidecar,
`kubectl exec <pod> -c log-tailer -- tail /var/log/procyon/cyonproxy.log`.

Read `node=` in `kubectl logs deploy/mcpgw-lb` to see which node answered a request; to force a
node, park the others as in section 00.

**A restarted gateway spends ~10 minutes answering `503 node=<NOSRV>`.** The HAProxy
backend uses `rise 60` with 10-second checks, so a node re-enters rotation only after
60 consecutive healthy checks. Until then every call through `mcpgw…` gets 503 with
`node=<NOSRV>` — no backend is marked UP, which looks exactly like a total outage while
both gateways are actually fine. Measured 2026-10-10 after a double rollout: 503s from
18:08 to ~18:17, then clean 401s. Wait out the window (or probe the gateway svc
directly) before diagnosing anything else; do not restart a gateway to "fix" a 503 —
that resets the rise timer.

The container in gateway 3's pod is named `agentless-mcpgw3`, not `agentless-mcpgw`: use
`kubectl exec deploy/agentless-mcpgw3 -c agentless-mcpgw3 ...` for its log.

The chart named every resource `agentless-mcpgw`, so a second release in
`ping-devops-curtismuir` would have collided with gateway 1 on the Deployment, Service,
Secrets, PVC and Certificate, and its Ingresses would have claimed gateway 1's host and
paths. Two local additions fix that, both unchanged when unset: `nameOverride` renames every
resource, label and hostPath; `ingress.enabled: false` skips both Ingresses.

**Checked by render (`helm template`, nothing applied):** gateway 1's render with the live
values is byte-identical before and after the chart change, with and without the new keys
present. Gateway 3's render has six resources (Deployment, Service, Certificate, PVC, two
Secrets), none sharing a kind and name with gateway 1's, 9 containers (the 7 sidecars,
the gateway and its log tailer), and no reference to the unsuffixed names. With gateway 3's
peer parked the load balancer renders it as `down`.

**To install it** (the commands are in `pingone-privgateway-helm-main/agentless/gateway3.values.yaml`):

1. Console, Gateways, Add New, the **AI GW** form, Docker command at the end, Cluster ID
   `ai-demo-cmuir`. The token is single-use and expires in about 2 hours; do the install straight away.
2. `helm install agentless-mcpgw3 ...` with gateway 1's values, `sidecars.values.yaml`,
   `gateway3.values.yaml` and `--set-file proxyToken=<token file>`; delete the values copy after.
3. Check the node joins: `ClusterID:ai-demo-cmuir`, `LinkStatus:Active`, pod 9/9, and a
   sidecar app answers from inside it.
4. Set `parked: false` for `gateway-3` in `gateway1-lb.values.yaml`,
   `scripts/se-gateways.sh upgrade --apply`.

**Found on install:** the Certificate for `mcpgw3.ai-demo.ping-devops.com` issued, and the
console accepted a third node with the existing Cluster ID. The first start took about 6
minutes, almost all of it pulling the sidecar images onto a fresh node. Gateway 3 and gateway 1
each log `Error connecting ... context deadline exceeded` when dialling the other's mesh
address; gateway 2 has thousands of the same lines and serves apps, so it looks routine here, but
it was not shown to be harmless for gateway 3. The overlay has no `hostAliases` (gateway 2
has one); whether gateway 3 needs it is untested.

**Not verified:** whether `meshPort` and `gatewayHostname` are needed (copied from gateway 2,
itself untested). A third pod in the same namespace adds pod redundancy, not namespace
redundancy.

**Redis (section 00b):** gateway 3 uses the shared Redis too. `sidecars.values.yaml` carries
`redis.urlSecret.name`, and the Secret `privilege-redis-url` already exists in
`ping-devops-curtismuir`, so no extra step; but a node that cannot reach Redis exits after six
attempts, so confirm the log line `Redis token store connected` before un-parking it.

## 0. Update: the mesh links, and one registration is enough

Later on 2026-10-03 we got the two gateways to link over the mesh. An Agentic App stays
registered once, on one mesh cluster. Whichever gateway a client is pinned to forwards the
call across the mesh to the cluster that owns the app.

**What was wrong.** The mesh was never blocked by the product; both gateways listen on
8690 in their pods. It was addressing:

- A gateway dials its peer at the address the peer advertises, `<-hostname>:8690`.
- A public hostname resolves to the HTTPS ingress, where 8690 is closed.
- Neither Service published 8690.
- Gateway 1 is the side that dials gateway 2 (its log: `Error connecting to <gateway 2
  node>. Err: context deadline exceeded`, 14 times in 8 minutes).

**The fix (all inside our two namespaces, gateway 1 never restarted).**

| Change | Where |
| --- | --- |
| Publish 8690 on each gateway's Service | chart value `meshPort: 8690`, both releases |
| Gateway 2 advertises its in-cluster Service name, `agentless-mcpgw.ping-devops-cmuir.svc.cluster.local`, which gateway 1 resolves with no change to itself | chart value `gatewayHostname` on gateway 2 |
| Gateway 2 can dial gateway 1's advertised public name | chart value `hostAliases` on gateway 2, pointing `mcpgw.ai-demo.ping-devops.com` at gateway 1's Service |
| Gateway 2's OAuth metadata shows only the public URL | `oidc.serverUrl=https://mcpgw.ai-demo.ping-devops.com` on gateway 2 |
| Gateway 2 in rotation | chart value `loadBalancer.peers[0].parked: false` on gateway 1's release |

**Evidence.**

- Link: gateway 1 logged the peer certificate, then `established command stream to` and
  `command stream connected from` gateway 2; its connection errors went from 2 per 30 s to 0.
- Forward, with real client traffic: `opensearch22` was bound to `ai-demo-cmuir2` (gateway
  2). Calls through gateway 1 returned `500` at 16:34 UTC and `200` (1469-byte tool list)
  from 16:36:39, after the fix. Gateway 1 logged `Connect: to reach
  ai-demo-cmuir2/opensearch-mcp-server..., connecting to ai-demo-cmuir2/<gateway 2>`;
  gateway 2 logged `Connected to opensearch-mcp-server...:80`.
- Gateway 2's sign-in front half: `register` 201, and `authorize` 302 to PingOne with the
  callback set to the public `mcpgw.ai-demo.ping-devops.com/callback` (already registered,
  so no PingOne change was needed).
- Load balancer: 12 client keys split 6 and 6; for every key the MCP, authorize and
  discovery paths landed on the same gateway. The pin key is the real client address: the
  ingress overwrites any client-supplied `X-Forwarded-For`.

**Corrections to earlier sections.**

- "TLS only when the certificate matches `-hostname`" was wrong. TLS follows the OAuth
  `SERVER_URL` matching the certificate: gateway 2 serves TLS with `SERVER_URL=mcpgw2...`
  and plain HTTP with the public URL. It accepts the public `Host` whatever its `-hostname`.
- The `re-establishing link to node` lines are a node handling its own record. They are
  not a failed peer link; watch `Error connecting to <node>` instead.

**Verified end to end on gateway 2 (17:09 UTC).** Every test client on our network hashes
to gateway 1, so gateway 1 was parked for about two minutes and a real LM Studio client
signed in fresh. `opensearch22` had been moved back to `ai-demo-cmuir` by then, so this is
the reverse direction of the first test.

| Step | Result |
| --- | --- |
| Sign-in on gateway 2 | `register` 201, `authorize` 302, `callback` 302, `token` 200; user identity resolved |
| Forward to the owning cluster | Gateway 2 logged `Connect: to reach ai-demo-cmuir/opensearch-mcp-server...` 7 times; gateway 1 logged `Connected to opensearch-mcp-server...:80` 7 times |
| Client result | `200` with the 1469-byte tool list, every request `node=gateway-2` |

Both directions are therefore proven: a client on either gateway can use an app registered
once, on the other gateway's cluster. The run showed tool-list calls; a tool invocation
returning data was seen only in the first direction (through gateway 1).

**The `400` responses are explained.** LM Studio first probes with a newer MCP protocol
version (`Mcp-Protocol-Version: 2026-07-28`, `Mcp-Method: server/discover`). The OpenSearch
MCP backend (`Server: uvicorn`) answers `400`, and the client falls back to `2024-11-05`.
It is client-to-backend version negotiation, not the load balancer or the mesh.

**Failover drill (2026-10-03, 23:00 to 23:13 UTC).** Each gateway's pod was deleted while two
unauthenticated probes, one pinned to each gateway, sent a request a second through the load
balancer.

| Scenario | Load balancer | Recovery | Real impact |
| --- | --- | --- | --- |
| Gateway 2 killed | Its clients moved to gateway 1 in under 1 s; no failed request | Pod ready in 43 s; mesh back in 32 to 44 s | Those clients sign in once on gateway 1. Apps keep working: gateway 1 owns them. |
| Gateway 1 killed | Its clients moved to gateway 2 in under 1 s; no failed request | Pod (9 containers) ready in 52 s; mesh back in 55 s | **Every app down for about 55 s**: gateway 1 owns every app and sidecar, and gateway 2 can only forward to it. Then every client signs in again. Inferred from how forwarding works; the probes cannot see it. |

**Gateway 1 is a single point of failure for the apps.** Gateway 2 is a second front door,
not a second copy of the apps. Removing that needs gateway 2 to own its own apps and
sidecars, or shared state in the gateway from Ping.

**What the drill changed (PR #658, live as release revision 43).** With the original
`fail_timeout=10s` the load balancer moved a client back to the restarted gateway after about
45 s, and the first request back hung against a gateway that was not yet answering. Each
gateway only accepts its own tokens, so a signed-in client would have signed in twice. The
chart now holds a failed gateway out for `loadBalancer.failTimeout` (600 s) and uses a 3 s
connect timeout. Re-test with gateway 2 killed again: moved in under 1 s, 158 requests in a
row on gateway 1, no return within the test and no hung request.

| | Before (`fail_timeout=10s`) | After (`600s`) |
| --- | --- | --- |
| Moved to the surviving gateway | under 1 s | under 1 s |
| Requests that failed or hung | 1 (hung on the way back) | 0 |
| Moved back | after about 45 s | not within 158 s; after the 10-minute hold |
| Forced sign-ins for a signed-in client | 2 (inferred) | 1 (inferred) |

**Sidecar-backed app through gateway 2: verified 2026-10-04.** With gateway 1 parked
(`ownParked: true`), a signed-in call to `brave0local` from the demo client went through
gateway 2 and reached the Brave sidecar in gateway 1's pod.

| Where | What it showed (11:49 UTC) |
| --- | --- |
| Load balancer | Every `/brave0local/...` request `node=gateway-2`: `401`, register `201`, token `200`, then `200`/`202` on `/brave0local/mcp` |
| Gateway 2 | Resolved the app, ran the policy check and filtered the responses |
| Gateway 1 | Seven mesh streams in the same two seconds, each `Connected to localhost:8084` (the `mcp-brave` sidecar) |

The same run showed the app outage a signed-in client sees while gateway 1 is down: the
park upgrade restarted gateway 1 once (it carried an undeployed log-tailer change), and
`tools/list` on `opensearch22` through gateway 2 returned `500 Error opening conn stream:
rpc error: code = Canceled desc = grpc: the client connection is closing` until the mesh
link returned about six seconds later.

**Still not verified.**

- The forced sign-in after a failover, seen from a signed-in client. The probes were
  unauthenticated; it is reasoned from the token behaviour, not observed during a failure.
- A gateway that accepts a connection and then stalls. The read timeout stays at 3600 s for
  long MCP streams, so such a request can still hang.
- The two load balancer pods keep separate failure state and may disagree for a few seconds.
- Whether Ping supports gateway-to-gateway mesh inside one tenant. It works; ask anyway.

**Decisions taken (2026-10-03).**

- **Failover that makes the client sign in again is NOT acceptable.** The current design
  cannot do better: registrations, OAuth state and tokens live in each gateway's memory, so
  a client moved to the other gateway always signs in again. Only a gateway change (shared
  or persistent session state) can fix it. This is now a requirement to raise with Ping,
  together with the question of whether the mesh setup is supported. Until then, present
  this as "two gateways serve one URL and one registration", not as seamless failover.
- **The load balancer moves into the Helm chart.** Done: it is `templates/loadbalancer.yaml`,
  switched on by `loadBalancer.enabled`; the hand-applied `mcpgw-lb/mcpgw-lb.yaml` is gone.

**Operating the load balancer from the chart.** Gateway 1's settings are in
`pingone-privgateway-helm-main/agentless/gateway1-lb.values.yaml`, gateway 2's in
`gateway2-mesh.values.yaml` (plus a private file for its secrets).

```bash
# apply or change the load balancer (always --reuse-values: the sidecars live in the release values)
helm --kube-context us upgrade agentless-mcpgw pingone-privgateway-helm-main/agentless/agentless-mcpgw \
  -n ping-devops-curtismuir --reuse-values -f pingone-privgateway-helm-main/agentless/gateway1-lb.values.yaml

```

- **Park gateway 2:** set `parked: true` on its entry in `gateway1-lb.values.yaml` and run
  the command above. Do not use `--set 'loadBalancer.peers[0]...'` with `--reuse-values`:
  setting a list index that way has corrupted list entries on this chart before.
- **Park gateway 1** (to force clients onto gateway 2 for a test): `ownParked: true`.
- **Take the load balancer out:** `loadBalancer.enabled: false`; the ingresses go back to
  gateway 1.

The load balancer pods roll on their own after each change.

The older runbook commands in sections 6 and 7 that edit `mcpgw-lb.yaml` and run
`kubectl apply` are superseded by these.

## 1. Summary

> **Partly superseded by section 0.** The gateways do mesh once they dial each other
> on the in-cluster address, and an app is registered once, not once per gateway. The
> design below was the state before that was found; read section 0 first.

We want one public URL, `https://mcpgw.ai-demo.ping-devops.com`, served by two
Agent Privileges so we can show failover and "1 + 1" to customers.

What we built and proved:

- A 2-replica nginx **load balancer** in front of the existing gateway. The URL did not
  change. A real LM Studio client registered, signed in through PingOne and ran a tool
  call end to end through it.
- A **second gateway** deployed and enrolled, parked (not receiving traffic).

What we learned, and why the design is not round robin:

- Each gateway keeps client registrations, OAuth state and issued tokens **in its own
  memory**. A token issued by gateway 1 is rejected (401) by gateway 2.
- The two gateways **cannot reach each other** on their mesh port (8690), so one cannot
  forward a request to the other. A gateway can only serve apps registered on its own
  mesh cluster.
- Privilege's own HA guidance is "deploy at least two gateways per network", meaning two
  gateways that each own their apps, not nodes forwarding to each other.

The supported design is therefore: **two independent gateways, each owning its own
Agentic Apps, and a load balancer that pins each client to one gateway for everything
(sign-in, token and MCP calls).** An app can exist on only one mesh cluster (5.5), so
gateway 2 needs its own differently named copy of each app, and the load balancer maps the
public path to it (options in section 9). The first version of this design assumed the same
app name could be registered on both clusters; that was tested and is wrong.

Decisions needed from reviewers are in section 9.

## 2. Goals and non-goals

Goals:

1. One stable URL for MCP clients and the console. No client-side change.
2. Two gateways able to serve any request for a client pinned to them.
3. A visible way to show which gateway answered (the `X-Served-By` response header).
4. Reversible in one command.

Non-goals:

- True per-request load balancing across gateways. Shown not to work (section 5).
- Sharing sessions or tokens between gateways. Not supported by the product as deployed.
- Changing the Privilege console model or the PingOne tenant.

## 3. What is deployed

| Piece | Namespace | Name | Notes |
| --- | --- | --- | --- |
| Gateway 1 | `ping-devops-curtismuir` | Helm release `agentless-mcpgw` | Mesh cluster `ai-demo-cmuir`. 9 containers: gateway plus 8 sidecars (Brave, Grafana, banking-rest, pingone, openapi-banking, promptguard, guardrail-probe, log-tailer). Owns all Agentic Apps today. |
| Load balancer | `ping-devops-curtismuir` | Deployment `mcpgw-lb` (2 replicas) and Service `mcpgw-lb` | Source: the chart's `templates/loadbalancer.yaml`, switched on by `loadBalancer.enabled` (values in `gateway1-lb.values.yaml`). The ingresses route to it automatically when it is enabled. |
| Gateway 2 | `ping-devops-cmuir` | Helm release `agentless-mcpgw2` | Mesh cluster `ai-demo-cmuir2`. Gateway only: no sidecars, no OpenSearch. Currently `down` in the load balancer. |
| Console entries | Privilege console, tenant `0428ba4f-...` | `ai-demo-cmuir`, `ai-demo-cmuir2` | Each gateway is its own entry (its own mesh cluster). |

The chart is `pingone-privgateway-helm-main/agentless/agentless-mcpgw`. Two values were
added, both defaulting to the old behaviour:

- `gatewayHostname`: the `-hostname` the gateway process answers to (defaults to `hostname`).
- `frontService`: the Service the ingresses route to (defaults to the gateway itself).

### Request path

```text
MCP client / browser
        |  https://mcpgw.ai-demo.ping-devops.com/<App>/...
        v
nginx-public ingress (curtismuir)            <- unchanged hostname
        |  Service mcpgw-lb :8623
        v
mcpgw-lb pods (x2)  -- consistent hash on client address (X-Forwarded-For)
        |                       |
        v                       v
gateway 1 (curtismuir)    loopback bridge :8444 -> gateway 2 (cmuir, plain HTTP)
cluster ai-demo-cmuir     cluster ai-demo-cmuir2   [parked: `down`]
        |                       |
        v                       v
sidecars on localhost     apps/sidecars it owns (must exist: section 6)
```

Why the loopback bridge: the chart's ingresses use `backend-protocol: HTTPS`, so the
load balancer must speak TLS to its upstream group. Observed: with gateway 2 started as
`-hostname mcpgw2...` (matching its certificate) it served TLS; started as
`-hostname mcpgw...` (the shared name, certificate still `mcpgw2...`) it answered plain
HTTP on the same port. We have not found the rule in vendor documentation, so treat
"TLS only when the certificate matches `-hostname`" as an inference. The bridge takes TLS
in and sends HTTP out so one upstream group can hold both gateways.

## 4. How the load balancer behaves

- **Pinning:** `hash $stick consistent`, where `$stick` is the `X-Forwarded-For` value
  (client address) or the connection address if absent. One client always lands on the
  same gateway while both are healthy. Adding or removing a gateway moves only a share of
  clients (consistent hashing).
- **Every path is pinned.** There is no round-robin path. Sign-in arrives both at the root
  (`/authorize`) and under the app name (`/opensearch22/authorize`); a single `location /`
  avoids the pattern-matching bug described in 5.1.
- **Failover:** `proxy_next_upstream error timeout http_502 http_503 http_504` with
  2 tries. If a pinned gateway is down, the request is retried on the other. That client
  holds a token only the first gateway knows, so it must sign in again. Same as a gateway
  restart today. Not yet exercised by killing a gateway (section 8).
- **Header:** every response carries `X-Served-By: gateway-1` or `gateway-2`.
- **Health:** the pods expose `/lb-health` on port 8081 for readiness and liveness.

## 5. Evidence: what we tried and what it showed

All measurements are from 2026-10-03 on the shared SE cluster.

### 5.1 Sign-in paths under the app name were not pinned (fixed)

First version pinned `^/(register|authorize|token|callback|consent|.well-known/)`. The
MCP OAuth flow actually uses `/<App>/register`, `/<App>/authorize` and `/<App>/token`, which
did not match, so they were round-robined. A client could register on one gateway and
exchange its token on the other.

- Symptom in LM Studio: "This client's registration has expired. Clear its saved
  credentials for this server and reconnect."
- Evidence: load balancer access log showed `GET /opensearch22/authorize` going through the
  round-robin path.
- Fix: pin everything. After the fix, `/opensearch22/authorize`, `/token`, `/register` all
  returned `X-Served-By: gateway-1` on 4 of 4 requests each.

### 5.2 A token from gateway 1 is rejected by gateway 2

With MCP calls round-robined and sign-in pinned to gateway 1, the 12:15 UTC sequence was:

```text
POST /opensearch22/register   201
GET  /opensearch22/authorize  302 (to PingOne)
GET  /callback                302
POST /opensearch22/token      200   <- token issued by gateway 1
POST /opensearch22/mcp        200   <- served by gateway 1
POST /opensearch22/mcp        401   <- landed on gateway 2
```

LM Studio reported "Authentication failed: Unauthorized". With gateway 2 parked, the same
flow succeeded and a real tool call returned data (an OpenSearch cluster health result).

### 5.3 The gateways cannot mesh with each other

> **Superseded by section 0.** This was an addressing problem, not a product limit.

- Both gateway logs show two mesh nodes in the tenant: gateway 1 (`ClusterID ai-demo-cmuir`,
  NodeURL `mcpgw.ai-demo.ping-devops.com:8690`) and gateway 2 (`ClusterID ai-demo-cmuir2`,
  NodeURL `mcpgw2.ai-demo.ping-devops.com:8690`), each repeatedly logging
  `re-establishing link to node`.
- From inside the cluster, TCP 8690 is **closed** on `mcpgw.ai-demo...`,
  `mcpgw2.ai-demo...` and gateway 2's in-cluster Service. TCP 443 on the same host is
  open (control), so the test itself works.
- The chart's Service and ingress publish only ports 80 and 8623. The mesh address shares
  its hostname with the HTTPS ingress, so opening 8690 would need cluster-level load
  balancer or DNS changes on the shared SE cluster, outside this namespace.
- The log line `this node and ... has same NodeURL` is largely each node seeing its own
  record and is documented as cosmetic. We saw it before gateway 2 existed.

Consequence: gateway 2 cannot forward a request to gateway 1, cannot validate its tokens,
and cannot reach its apps.

### 5.4 Vendor documentation

From the Privilege docs (gateway pages), paraphrased:

- "To ensure high availability, we recommend deploying at least two gateways per network."
- An MCP server application is bound to a gateway by selecting a **Mesh Cluster** in the
  application configuration. The docs are silent on adding a second node to an existing
  gateway, on two gateways sharing a hostname, and on scaling or load balancing a gateway.

### 5.5 An Agentic App is one tenant-wide object bound to ONE mesh cluster

Tested 2026-10-03 15:53 UTC while trying to register `opensearch22` on cluster
`ai-demo-cmuir2`. The console did not create a second app. It **edited the existing one**.
Both gateways' logs show the same object (`http-opensearch22`, `CreatedAt 2026-09-02`,
`UpdatedAt 2026-10-03T15:53:11Z`) now carrying `Cluster:ai-demo-cmuir2`, followed by
`MCP force-sync app=opensearch22: re-scanning`.

Consequences:

- The same Application Name **cannot** exist on two mesh clusters. Editing it moves the app
  from one gateway to the other, so gateway 1 loses the app gateway 2 gains. This
  invalidates the first version of the design in section 1 ("register every app on both
  clusters, same name").
- Anyone editing an app in the console while testing can silently take it away from the
  gateway that serves live traffic. Revert the Mesh Cluster to `ai-demo-cmuir` to restore it.
- The path clients use is `/<AppName>/mcp`, so a second copy needs a **different name** on
  cluster 2 (for example `opensearch22b`). See the options in section 9.

Also checked: the backend `http://opensearch-mcp-server.ping-devops-curtismuir.svc.cluster.local/sse`
answers `200 text/event-stream` with an `event: endpoint` line from both the
`ping-devops-curtismuir` and `ping-devops-cmuir` namespaces, so gateway 2 can reach it.
That proves network reachability only. It is NOT the path to register: current gateway
builds need the backend registered with `/mcp` (see the skill and
`privilege/GATEWAY-REGISTERING-AN-MCP-SERVER.md`).

### 5.6 Smaller findings

- We could not open a details page for a gateway in the console, so we found no route to
  add a second node to `ai-demo-cmuir`. "Add New" creates a new cluster entry each time
  (that is how `ai-demo-cmuir2` was made).
- Gateway 2 needs the same hostname as gateway 1 to answer the shared URL (the gateway
  routes by Host header). That makes the two NodeURLs identical. Because the mesh cannot
  link anyway (5.3), this is harmless but untidy; see open questions.

## 6. Bringing gateway 2 into rotation (runbook)

> Superseded by section 0. With the mesh linked, gateway 2 needs NO copy of any app; it
> forwards to the cluster that owns it. The steps below are kept as the record of the
> fallback (a differently named copy per app), which was not needed.

Prerequisite: every Agentic App that clients use needs a copy on cluster `ai-demo-cmuir2`.
**Create a NEW app with a different name; never edit the existing one.** An app is a single
tenant-wide object (5.5), so editing `opensearch22` and changing its Mesh Cluster moves it
off gateway 1. This runbook step is not finished until the name-mapping option in section 9
(A) is implemented in the load balancer; as written the public path `/<AppName>/mcp` will
only reach gateway 2 for apps that have the same name there, which the console does not allow.

1. **Register the copy on the second cluster** in the Privilege console: Agentic Apps, add
   MCP Server, a NEW Application Name (for example `opensearch22b`), Mesh Cluster
   `ai-demo-cmuir2`, Auth Mode None.
   - Pilot with `opensearch22`. Its backend is an in-cluster Service reachable from gateway 2:
     `http://opensearch-mcp-server.ping-devops-curtismuir.svc.cluster.local/mcp`
     (use `/mcp`; an earlier version of this document said `/sse`, which was wrong for
     current gateway builds: an app registered on `/sse` answers `404` on `/mcp`).
     No sidecar is needed.
   - Apps backed by sidecars (`http://localhost:808x`) need the same sidecar containers in
     gateway 2's pod, and copies of their secrets in `ping-devops-cmuir`. Not done.
   - Add a policy for the app on the new registration (policies are per app).
2. **Confirm gateway 2 knows the app.** Gateway 2 log: no `Cluster not found` for the app.
3. **Put gateway 2 in rotation** by setting its `parked: false` in `gateway1-lb.values.yaml`
   (section 0, "Operating the load balancer from the chart").

4. **Verify** (section 7).

### Roll back or park gateway 2

Set gateway 2's `parked: true` in `gateway1-lb.values.yaml` and run the same `helm upgrade`
(section 0). All traffic returns to gateway 1 once the load balancer pods have rolled.

### Remove the load balancer entirely

```bash
helm --kube-context us upgrade agentless-mcpgw \
  pingone-privgateway-helm-main/agentless/agentless-mcpgw \
  -n ping-devops-curtismuir --reuse-values --set frontService=
```

The ingresses route straight to gateway 1 again.

### Tear down gateway 2

```bash
helm --kube-context us -n ping-devops-cmuir uninstall agentless-mcpgw2
kubectl --context us -n ping-devops-cmuir delete pvc agentless-mcpgw-ssl
```

Then delete the `ai-demo-cmuir2` entry in the console. The SE cluster is shared; remove
what you are not using.

## 7. Verification

Headers (no sign-in needed):

```bash
for i in 1 2 3 4; do curl -s -o /dev/null -D - https://mcpgw.ai-demo.ping-devops.com/opensearch22/mcp | grep -i x-served-by; done
```

Expected: gateway-1 only while gateway 2 is `down`; a mix across different client
addresses once it is in rotation. One client always sees the same gateway.

End to end (needs a person):

1. In LM Studio remove the server entry from `~/.lmstudio/mcp.json`, quit with Cmd+Q,
   reopen, re-add with just the URL `https://mcpgw.ai-demo.ping-devops.com/opensearch22/mcp`,
   toggle on, complete the PingOne sign-in, run a tool call.
2. Watch the load balancer log: `register`, `authorize` (302), `callback`, `token` (200),
   then `mcp` 200s, with no 401.
3. To show failover: delete one `mcpgw-lb` pod during a session (calls continue); then
   park the client's gateway and show it re-signing in on the other.

Self-test of the sign-in path without a browser: register a throwaway client at
`/<App>/register` and `GET /<App>/authorize` with PKCE parameters. A `302` to
`auth.pingone.com` means the load balancer and gateway are healthy.

## 8. What is not verified

> **Dated.** Items about the gateways being unable to reach each other are answered by
> section 0. The failover drill in section 0 lists what is still unverified.

- Gateway 2 has never completed a full sign-in and tool call for any app. Everything about
  it serving traffic is design, not measurement.
- Whether a differently named copy on cluster 2 plus a load balancer path rewrite works
  end to end (sign-in metadata will carry the second name).
- Whether the client address seen behind the ingress is the real client or a shared
  address. If shared, consistent hashing sends everyone to one gateway and the spread is
  poor. Check `X-Forwarded-For` in the load balancer log from two different networks.
- Real failover by killing a gateway (retry then re-sign-in).
- Load balancer behaviour on SSE streams long enough to hit the 3600 s timeouts.
- The `Error sending message to nebula: EOF` lines in gateway 1's log (audit link to the
  Privilege cloud). They did not affect calls; we did not establish whether they are new.

## 9. Open questions and decisions for reviewers

> **Mostly answered by section 0.** The question of a second, differently named copy of
> each app no longer arises: one registration is enough.

1. **How should gateway 2 get its apps?** An app lives on one cluster only (5.5). Options:
   - **A. Differently named copy on cluster 2** (for example `opensearch22b`) plus a path
     rewrite in the load balancer's gateway-2 bridge so clients keep using
     `/opensearch22/mcp`. Cost: each app registered twice under two names, sidecar-backed
     apps need their sidecars on gateway 2, policies maintained twice. Untested caveat: after
     sign-in on gateway 2 the OAuth metadata it returns will contain the `b` name, so the
     client sees it from then on.
   - **B. Distinct public path per gateway** (clients choose `/opensearch22/...` or
     `/opensearch22b/...`). Simplest, but the URL is no longer single.
   - **C. One gateway behind the load balancer.** Stable URL and load balancer HA, no gateway HA.
2. **Ask Ping (Privilege team):** is there a supported way to run two nodes in one mesh
   cluster, or to publish the mesh port 8690 between gateways? If yes, the registration
   duplication and the pinning both go away.
3. **Hostname:** two gateways advertising the same hostname collide as mesh nodes. Is the
   right fix distinct hostnames with the load balancer rewriting `Host`, at the cost of the
   gateway advertising its own URL in OAuth metadata? We have not tried it.
4. **Where should this live long term?** The load balancer is a plain manifest applied by
   hand. Should it move into the Helm chart as an optional template?
5. **Demo story:** is "client pinned to a gateway, re-sign-in on failure" a good enough
   failover narrative for customers?

## 10. Operational gotchas

- A `helm upgrade` of the live gateway release **without `--reuse-values`** resets
  `frontService` and sends traffic straight to gateway 1, bypassing the load balancer.
- Without Redis, restarting a gateway forgets every registered client; clients show
  "registration has expired" until the saved credentials are cleared and the client
  reconnects. With the shared Redis (section 00b) that only happens if Redis lost its data
  or was down. **Never restart a gateway while Redis is down:** it exits after 6 attempts.
- Gateway enrollment tokens are single use and live about two hours.
- `helm upgrade --reuse-values` replaces the whole `extraContainers` list; carry every
  sidecar forward and repackage the chart tgz after any template edit
  (see the skill for the dry-run check).
- The shared SE cluster expects teardown when a demo ends.

## 11. Change record

| What | Where |
| --- | --- |
| Load balancer and chart values | PR #634 |
| Pin-everything load balancer config and this document | this PR |
| UI: themed boot screen, redirect overlay, discover tools after sign-in | PR #632 |

Secrets are not recorded here. Enrollment tokens, OIDC client secrets and the generated
values file live outside the repository.
