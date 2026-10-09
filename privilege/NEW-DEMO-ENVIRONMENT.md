# Standing up a new Privilege demo environment

Status: drafted 2026-10-05 from what was done and found building and running our own environment on 2026-10-03 to 2026-10-05. Audience: an SE (or the owner) building a **separate** environment: its own PingOne environment, its own gateway, its own agents, for example a standalone A2A demo. No secret values are in this file.

Companion pieces: skill `.claude/skills/privilege-new-demo-environment/SKILL.md` (the same order as a checklist), [A2A-DEMO-AND-SETUP-OUR-ENVIRONMENT.md](A2A-DEMO-AND-SETUP-OUR-ENVIRONMENT.md) (our values worked through), `.claude/skills/privilege-mcpgw-agent-k8s/SKILL.md` (operating the gateway), [GATEWAY-LOAD-BALANCER.md](GATEWAY-LOAD-BALANCER.md) (more than one gateway).

## What is verified and what is not

| Part | State |
| --- | --- |
| Installing the chart, enrolling a node with the **AI GW** form, the console row, the token traps, Redis, resource sizing, the checks | Done and observed on our cluster, 2026-10-03 to 2026-10-05 |
| Registering apps and creating agents, then the A2A demo | Done and observed (runbook above) |
| Creating the PingOne OIDC app | From the chart's `INSTALL.md` and our skill; the scope list was verified against our environment |
| **Getting Privilege enabled in a brand-new PingOne environment** | **Not documented anywhere in this repository, and not done by us.** Our tenant ("AI Agent") already existed. Ask Ping or your Privilege contact first. Everything below assumes the new environment already has Privilege and a console you can sign in to |
| Running with no sidecars and no OpenSearch | Not run. The chart switches exist and were rendered, but no fresh install without them was started |

## Choices to make first

| Choice | Our environment | Yours |
| --- | --- | --- |
| PingOne environment ID | `0428ba4f-...` (the token's `tenantName` is this ID) | new ID |
| Region | `auth.pingone.com` | the new environment's region |
| Gateway public hostname | `mcpgw.ai-demo.ping-devops.com` | one you can publish through DNS and an ingress with a certificate |
| Namespace | `ping-devops-curtismuir` (gateways 1 and 3), `ping-devops-cmuir` (gateway 2) | your own |
| Cluster ID (Mesh Cluster) | `ai-demo-cmuir` | any name; the console form sets it and the token carries it |
| Node Host IP | `<service>.<namespace>.svc.cluster.local` | the node's own Service name, never the form's pre-filled value |
| Shared Redis | yes, one pod | optional for one gateway; see step 4 |
| Sidecar MCP servers | seven | none unless you register catalog apps |
| Node architecture | arm64 (Graviton) | check; images must match |

## Steps

### 1. Check the cluster and the prerequisites

- `kubectl config current-context` is the cluster you mean. On a shared cluster, **compare CPU requests to real use before adding pods**: our SE cluster had no node with 750m free while every node sat at 8-13% real CPU, because requests fill it (`kubectl top pod --containers`, and the `FailedScheduling` event on a Pending pod).
- A `ClusterIssuer` for certificates and an ingress class exist (`kubectl get clusterissuer`, `kubectl get ingressclass`). Ours are `letsencrypt-pdo` and `nginx-public`; the chart's `clusterIssuer` and `ingressClassName` values name them.
- DNS: our ingress host was published by external-dns. Confirm yours resolves before enrolling.

### 2. PingOne: the sign-in app and a test user

In the new environment create a Web App (OIDC) with token endpoint auth `client_secret_basic` (chart `INSTALL.md`), grant types **Authorization Code and Token Exchange**, redirect `https://<gateway host>/callback`, and the `openid`, `profile`, `email` scopes. The chart README also lists `p1:read:env`, `p1:read:user` and `p1:read:application`; on our environment `p1:read:env` and `p1:read:application` do not exist as user-context scopes and PingOne drops them silently, so only `openid profile email` matter.

Make sure a user exists who can sign in. Keep the **client ID, client secret and the three endpoint URLs** (`.../as/authorize`, `.../as/token`, `.../as/userinfo`) for steps 3 and 4.

Check the secret before using it. A `client_credentials` token request with the client ID and secret returns `unauthorized_client` when the secret is **accepted** (this app type cannot use that grant) and `invalid_client` when it is **wrong or dead**. Nothing else in this guide tells you a bad secret as quickly.

### 3. Console: enroll a new gateway

Console, Gateways, Add New, the **AI GW** tab (not the VM wizard: its env file cannot be used by the chart, and its screens show the tenant API key and OIDC secret in plain text, so do not screenshot them).

| Field | Value |
| --- | --- |
| Cluster ID | your cluster name |
| **Host IP** | **`<service>.<namespace>.svc.cluster.local` of this node** |
| Agent Privilege Server URL | `https://<gateway host>` |
| OIDC Client ID / Secret | from step 2 |
| OIDC Auth / Token / User URL | from step 2 |
| User ID Claim | leave blank |

**The Host IP is the one that bites.** The form pre-fills it (ours showed `ai-demo.ping-devops.com`). A node enrolled with the wrong value still runs and joins the mesh, but it gets **no row on the Gateways page**, and a node cannot be edited, only re-created. The page is a tree: one row per cluster ("3 nodes"), with a child row per node showing that address.

Click **Get Docker Command** and keep only the `eyJ...` value after `ENV_PROXY_TOKEN=`. It is single-use and lasts about 2 hours, so do steps 3 and 4 together. Save it to an owner-only file and **strip every leading and trailing whitespace character**: two stray leading spaces made our first attempt crash-loop with `crypto/ecdsa: verification error`, and the token was not spent because the check runs before the server is contacted. Check the file is one line starting `eyJ`. Decode the payload (not the signature) and confirm `tenantName` is the new environment ID, `clusterID` is yours, `nodeType` is `PrivateAIGw`, and some minutes are left.

### 4. Install the chart

Use the **chart source directory**, `pingone-privgateway-helm-main/agentless/agentless-mcpgw/`, never the packaged `.tgz`: the `.tgz` goes stale and silently drops local additions (this caused an outage on 2026-09-07).

Put everything that is not secret in a values file and pass secrets from files, so nothing is typed on a command line:

```bash
helm upgrade --install agentless-mcpgw pingone-privgateway-helm-main/agentless/agentless-mcpgw/ \
  -n <namespace> \
  -f <your-values>.yaml \
  --set-file proxyToken=<token file> \
  --set-file oidc.clientSecret=<secret file>
```

Values to set (`hostname`, `namespace`, `oidc.serverUrl`, `oidc.clientId`, `oidc.authUrl`, `oidc.tokenUrl`, `oidc.userUrl`, `clusterIssuer`, `ingressClassName`) and three decisions:

- **Resources.** The chart default asks for 1 CPU and 2Gi for the main container. It used about 30m and 40 MiB at idle. Set `resources.requests` to about `250m` and `512Mi` (limits can stay at 2 CPU and 4Gi). Raise the request if the gateway is throttled at startup; the startup burst was not measured.
- **OpenSearch.** `opensearch.enabled` and `opensearchMcpServer.enabled` default to true, which deploys an OpenSearch and an MCP server for it. Set both to false if you do not want them (rendered, not run).
- **Redis.** Without `MCPGW_REDIS_URL` the gateway keeps client registrations and tokens in memory, so a restart makes every MCP client register again. Set `redis.urlSecret.name` to a Secret holding the URL under `url` to keep them (`redis-canary/redis.yaml` has our Redis). Cost: a gateway **exits after six failed Redis attempts at startup**, so Redis becomes a hard dependency. For one demo gateway, in-memory is a fair default.

A second gateway in the **same namespace** needs the chart's `nameOverride` and `ingress.enabled: false`; one in another namespace needs neither. Do not add a second node to the same cluster until the first works.

Do not pass `--reuse-values` on the first install. On later upgrades, `--reuse-values` does not hand a release the chart's new default values, so spell every key you need in the values file, and never `--set` a list index.

### 5. Check the gateway before anything else

1. `kubectl get pods -n <namespace>`: the gateway pod ready. Our pods show 9/9 because we run seven sidecars plus the gateway and a `log-tailer`; without sidecars expect fewer containers.
2. The gateway's log is a **file**, not stdout. Read it through the sidecar: `kubectl exec <pod> -c log-tailer -- tail -50 /var/log/procyon/cyonproxy.log`. A crash loop prints nothing to `kubectl logs`.
3. If Redis is set: `Redis token store connected on attempt 1/6`.
4. The console's Gateways page shows your cluster with the node and the address you typed as Host IP.
5. The certificate was issued (`kubectl get certificate -n <namespace>`).
6. An unauthenticated `POST https://<gateway host>/<app>/mcp` returns 401 once an app exists. That proves the ingress, the certificate and the gateway answer, though not a signed-in call.

The log lines `has same NodeURL`, `re-establishing link to node` and a mesh-controller `not found` are a node handling its own record. Do not chase them.

### 6. Apps first, then agents

Follow steps 2 to 4 of [A2A-DEMO-AND-SETUP-OUR-ENVIRONMENT.md](A2A-DEMO-AND-SETUP-OUR-ENVIRONMENT.md) with your names. The order matters: an agent can only select apps that already exist. Register an MCP server with the path `/mcp`, not `/sse` (current gateway builds discover by POSTing `initialize` to the registered path), and register an agent that other agents call as a **Remote Agent** app. An agent key is shown once, on the last wizard screen: paste it into its secret store immediately.

### 7. Deploy the standalone demo and prove it

Build for the cluster's architecture (`linux/arm64` on ours), deploy `standalone/privilege-a2a-anthropic-demo` (`k8s/deployment.yaml`), and set the main agent's gateway URLs to your host. Then run the "Before you demo" checks and both demos once, as in the runbook.

### 8. Hand over and tear down

- Delete the token and OIDC secret files once the node is enrolled. Rotate anything that was shown on a screen or pasted anywhere.
- To take a node out of service without losing its enrollment, scale it to 0 and keep its volume. To remove it for good, delete its Helm release and its volume. We never found a way to delete a node from the console: a replaced node's record kept being chased by the other nodes for about an hour and then stopped on its own, and it never showed in the list. Ask Ping how to remove one (issue 6 in the Ping questions).
- If you share the cluster, undeploy what you added when you finish. Gateway pods are not removed by the app's `undeploy` script.

## When it goes wrong

| Symptom | Cause and fix |
| --- | --- |
| Pod runs but the console has no row for the node | Wrong Host IP in the form. Re-enroll: scale to 0, delete the node's enrollment volume, upgrade with a new token, restart the pod |
| Crash loop, log says `crypto/ecdsa: verification error` | Whitespace around the token, or a truncated paste. Trim the file and re-apply |
| Pod Pending, `Insufficient cpu` | CPU requests, not load. Lower requests or free a node |
| Sign-in redirect carries an empty `client_id` | OIDC values changed but the pod was not restarted |
| `500 ... connection refused` on a sidecar app | That node has no sidecars; a sidecar app's backend is `localhost` in the pod that takes the call |
| A new token is ignored | The old enrollment files are still on the volume. Remove them first |

More: the skill's symptom index and [GATEWAY-READING-GATEWAY-ERRORS.md](GATEWAY-READING-GATEWAY-ERRORS.md).
