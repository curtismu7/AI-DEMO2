# Privilege AI Gateway: load balancer and second gateway

Status: both gateways in rotation, linked by the mesh; one app registration serves both.
Last updated 2026-10-03 (evening). **Section 0 supersedes the parts of sections 1, 5.3, 6
and 9 that say the gateways cannot mesh or that apps must be registered twice.**
Audience: engineers and SEs reviewing how we show "two gateways behind one URL".
Related: [CURRENT-CONFIGURATION.md](CURRENT-CONFIGURATION.md), [LESSONS-LEARNED.md](LESSONS-LEARNED.md),
skill `.claude/skills/privilege-mcpgw-agent-k8s/SKILL.md`.

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

**Still not verified.**

- Tokens do not cross gateways, so pinning stays and a client signs in again if its gateway
  dies. Automatic failover by killing a gateway has not been exercised; parking one in the
  load balancer has (clients re-sign-in on the other).
- Sidecar-backed apps (Brave, Grafana, banking-rest, ...) through gateway 2. Their backends
  are `localhost` in gateway 1's pod, reached over the mesh like `opensearch22`; not tested.
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

We want one public URL, `https://mcpgw.ai-demo.ping-devops.com`, served by two
Privilege AI Gateways so we can show failover and "1 + 1" to customers.

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

### 5.6 Smaller findings

- We could not open a details page for a gateway in the console, so we found no route to
  add a second node to `ai-demo-cmuir`. "Add New" creates a new cluster entry each time
  (that is how `ai-demo-cmuir2` was made).
- Gateway 2 needs the same hostname as gateway 1 to answer the shared URL (the gateway
  routes by Host header). That makes the two NodeURLs identical. Because the mesh cannot
  link anyway (5.3), this is harmless but untidy; see open questions.

## 6. Bringing gateway 2 into rotation (runbook)

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
     `http://opensearch-mcp-server.ping-devops-curtismuir.svc.cluster.local/sse`
     (use `/sse`, not `/mcp`). No sidecar is needed.
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
- Restarting a gateway forgets every registered client; clients show "registration has
  expired" until the saved credentials are cleared and the client reconnects.
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
