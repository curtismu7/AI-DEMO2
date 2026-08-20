---
name: privilege-mcpgw-agent-k8s
description: Deploy and verify the agent-based PingOne Privilege MCP Gateway (now called AI Gateway) on the SE DevOps Kubernetes cluster using the privgateway Helm chart, then register the MCP server, author policy, and prove the chain from an MCP client. Use this whenever the task touches the privgateway/agentless-mcpgw Helm packages, ENV_PROXY_TOKEN or the Privilege console Gateways wizard, Agentic Apps registration, a Frontend Name like *.applications.procyon.ai:8643, or symptoms such as an MCP client hanging on a svc.cluster.local URL, "The MCP server denied this operation", "User <id> doesn't have access to MCP app <name>", or "has same NodeURL". Also use it before choosing between the agent-based and agentless variants, since the two need different console objects and must not be mixed in one release.
---

# Privilege MCP Gateway (AI Gateway) — agent-based on K8s

Proven end to end 2026-08-17 against PingOne env `0428ba4f-169c-436b-aff9-b230496e0e3b` ("Privilege Agent"), namespace `ping-devops-curtismuir`, release `cm-mcpgw`. Every command and error string here was observed, not inferred.

Scope: the SE Helm path where the gateway runs in Kubernetes and the MCP client reaches it through the Priv Agent on a Mac. For the local Docker gateway, the BFF MCP client relay, and the PingOne-token wall, read `privilege-cloud-mcp` instead — different deployment, different failure modes.

## Current cmuir deployments (verified 2026-08-20)

Read `privilege/CURRENT-CONFIGURATION.md` before operating either mode.

- Agentless: namespace `ping-devops-cmuir`, release `agentless-mcpgw`, cluster
  `ai-demo-cmuir`, app `cmuir`, client URL
  `https://cmuir-agentless-mcpgw.ping-devops.com/cmuir/mcp`.
- Agent: app `cmuir2`, client URL
  `https://opensearch.default.applications.procyon.ai:8643/mcp`. The Agent owns
  authentication; do not configure a client ID or gateway OAuth in the demo client.
- Current gateway digest:
  `sha256:0faad5903a5bd72539b1df525e3c7bc5d458a5bd324aac9755b8af99dfa6647d`.

Do not use the OpenSearch backend or app name for the cmuir Agentless deployment.
OpenSearch belongs to the working Agent use case.

## Pick the variant before touching anything

The two variants need different console objects. Mixing their values in one Helm release produces a gateway that enrolls and then serves nothing.

| | Agent-based | Agentless |
|---|---|---|
| Client reaches gateway via | Priv Agent on the workstation (device-bound, Secure Enclave) | Browser / MCP client straight to your own DNS + TLS |
| Gateway OIDC client | **not used** — leave `mcpgw.oidc.enabled=false` | required: OIDC Web App, Client Secret Basic, redirect `https://<host>/callback` |
| Console entry point | agent menu-bar icon > **Open Console** | PingOne env properties > **PingOne Privilege Console Url** |
| Chart | `privgateway-0.1.0.tgz` | `agentless-mcpgw-0.1.0.tgz` |

A client id and secret handed to you are an *agentless* artifact. If someone asks for an agent-based deploy and also supplies OIDC credentials, surface the contradiction rather than wiring both.

## The enrollment token is the only blocking input

`mcpgw.proxyToken` is `required` in the chart. Nobody but a console operator can produce it: Privilege console > **Gateways** > **Add New** > **Add via Docker**, Cluster ID of your choice, Host IP = `https://<your-gateway-hostname>`, then lift `ENV_PROXY_TOKEN` out of the docker command.

Decode it before use — the claims tell you which tenant and cluster you are actually enrolling into, which is the single most common way this goes wrong:

```bash
python3 -c "
import base64,json,sys,datetime
p=sys.argv[1].split('.')[1]; p+='='*(-len(p)%4)
c=json.loads(base64.urlsafe_b64decode(p))
print({k:c.get(k) for k in ('clusterID','nodeId','nodeType','tenantName','tenantID')})
print('exp',datetime.datetime.fromtimestamp(c['exp'],datetime.timezone.utc))" 'eyJ...'
```

`tenantName` holds the **environment id**, not a friendly name. `clusterID` is what you must later type into the MCP app's Mesh Cluster field. Expiry runs ~2h and only has to survive until first boot; after that the mTLS pair in the `-mcpgw-ssl` PVC is the durable credential and restarts need no token.

## Deploy

```bash
# 1. prerequisites — all three must exist or the ingress and cert silently never resolve
kubectl config current-context                      # expect: us
kubectl get clusterissuer letsencrypt-pdo
kubectl get ingressclass nginx-public

# 2. token to a file, never to a flag (flags land in shell history and ps output)
cat > /tmp/secrets.yaml <<'YAML'
mcpgw:
  proxyToken: "eyJ..."
YAML
chmod 600 /tmp/secrets.yaml

# 3. dry run, then install
helm upgrade --install <RELEASE> privgateway-0.1.0.tgz \
  --namespace <NAMESPACE> --create-namespace \
  --set mcpgw.hostname=<HOST> \
  --set mcpgw.serverUrl=https://<HOST> \
  --values /tmp/secrets.yaml --dry-run
```

Then the same command without `--dry-run`. Three pods appear: `-mcpgw` (2/2 with its log-tailer sidecar), `-opensearch`, `-opensearch-mcp-server`.

OpenSearch reports `ready=false` for roughly the first minute. That is startup, not failure — re-check before diagnosing.

## Verify enrollment from the log, not the HTTP surface

```bash
kubectl logs -n <NAMESPACE> deployment/<RELEASE>-mcpgw -c log-tailer --tail=30
```

The line that proves success:

```
MedusaLink … OriginCluster:ai-demo-agent TargetCluster:privilege-cluster-proxy LinkStatus:Active
```

Two errors in that same log are cosmetic and cost hours if chased:

| Log line | Reality |
|---|---|
| `has same NodeURL - this happens because of misconfigured Node` | The node linking against its own registration row. Command streams stay up, discovery still dispatches |
| `Error sending update to mesh controller: … not found` | Same symptom, different call site |

Confirm the backend independently, since a healthy gateway in front of a dead MCP server looks identical to a routing fault:

```bash
kubectl exec -n <NS> deploy/<RELEASE>-opensearch-mcp-server -c opensearch-mcp-server -- python -c "
import urllib.request as u
for p in ['/sse','/mcp','/']:
    try: print(p, u.urlopen('http://localhost:9900'+p, timeout=3).status)
    except Exception as e: print(p, getattr(e,'code',type(e).__name__))"
```

Expect `/sse 200 /mcp 200 / 404` — FastMCP serves both transports even when it only logs the StreamableHTTP manager.

## Register the MCP server (console Step 6)

Agentic Apps > Add Application > **MCP Server** tile > Integrate.

```
Application Name  opensearch
MCP Server URL    http://<RELEASE>-opensearch-mcp-server.<NAMESPACE>.svc.cluster.local/sse
Mesh Cluster      <clusterID from the token>
```

**The `/sse` here is not the same field as the client URL.** This is the BACKEND
the gateway proxies to, and `/sse` is what this deployment was registered with and
works. An MCP client (Postman, Claude, Cursor) connects to the FRONTEND at
`https://<FRONTEND_NAME>/mcp` — see the Postman note below. Do not "fix" one to
match the other; they are different ends of the hop, and the server answers on
both paths, so a mismatch fails during the handshake rather than at connect.

Two field-level traps:

- **The release prefix is part of the service name.** Vendor material shows the URL both with and without it. The chart prefixes every object with the release, so `opensearch-mcp-server.<ns>.svc…` does not resolve and discovery fails in a way that reads like a broken backend.
- **That URL is for the gateway, never for a client.** `svc.cluster.local` only resolves inside the cluster. An MCP client pointed there hangs on connect with no error — the single most confusing symptom in this whole flow.

After saving, the app shows a read-only **Frontend Name** like `opensearch.default.applications.procyon.ai:8643`. That is the client address. If the console displays a `…applications.privilege.pingone.com` name instead, the object may hold a different `…procyon.ai` value, and only the latter routes.

## Client verification

The Priv Agent runs a partial DNS proxy, so the frontend name resolves locally once the app exists:

```bash
dscacheutil -q host -a name opensearch.default.applications.procyon.ai
# ip_address: 127.0.0.1   <- the agent's listener; no record means the app is not registered
```

Then probe. Read the 403 as progress:

```bash
curl -sk -m 8 -H 'Accept: text/event-stream' https://<FRONTEND_NAME>/sse
# 403  User <uuid> doesn't have access to MCP app <name>   -> auth + routing + registration all working, policy missing
```

Author the policy (console Step 7): Agentic Apps > the app > **Policy** > select tools > **Update Configuration** > add the **user id the 403 names** > name it, set an end date/time > Submit. Policies are time-boxed; a call that worked and now 403s again means the policy lapsed, not that the gateway broke.

Re-probe. Success looks like a hang:

```bash
curl -sk -o /dev/null -w 'http=%{http_code}\n' -m 8 -H 'Accept: text/event-stream' https://<FRONTEND_NAME>/sse
# http=200 with curl exiting 28 — the SSE stream stays open until the client timeout
```

In Postman: **MCP** request, transport **HTTP** (not STDIO — that is for servers Postman launches as a subprocess), URL `https://<FRONTEND_NAME>/mcp`, **no auth**. The agent supplies identity. Postman renders the same 403 as "Couldn't run the request: The MCP server denied this operation" — check with curl before believing it is a Postman problem.

**It is `/mcp`, not `/sse`.** This said `/sse` and was wrong. Postman's transport
**HTTP** is MCP Streamable HTTP, which the server exposes at `/mcp`; `/sse` is the
separate, older SSE transport. The mistake survives review because the probe above
returns `/sse 200 /mcp 200` — FastMCP serves both, so the wrong URL is reachable
and only fails later, during the MCP handshake, in a way that reads as a gateway
or policy fault rather than a wrong path.

The curl probes above deliberately still use `/sse` with
`Accept: text/event-stream`: they are testing reachability, auth and policy, and a
long-lived SSE stream is the easiest thing to eyeball (`http=200` with curl exiting
28). Use `/sse` to probe, `/mcp` in an MCP client.

## The Mac agent

One agent holds several tenants at once and pins one. The onboarded set and the active choice are visible in its log, which is the only place either is legible — `config.json` carries just `controllerURL`, and the pairing key lives in the Secure Enclave where no keychain dump reaches it:

```bash
grep -a -A4 'OnboardedTenants' ~/Library/Logs/PingOne\ Privilege/main.log | tail -8
grep -a 'Updating preferred tenant' ~/Library/Logs/PingOne\ Privilege/main.log | tail -1
```

The gateway's tenant and the agent's **Preferred Tenant** must match, or the client has no route to the gateway and every request hangs. Settings > Preferred Tenant switches between onboarded tenants without re-onboarding.

## Symptom index

| Symptom | Cause | Fix |
|---|---|---|
| MCP client hangs, no error | Pointed at `…svc.cluster.local` | Use the Frontend Name |
| `The MCP server denied this operation` (Postman) | The 403 below, reworded | curl the endpoint to see the real message |
| `User <id> doesn't have access to MCP app <name>` | No policy, or policy expired, or policy names a different user | Author policy for that exact user id, with an end time in the future |
| Client hangs even with the Frontend Name | Agent's Preferred Tenant differs from the gateway's tenant | Repoint Preferred Tenant, or redeploy with a token from the agent's tenant |
| Frontend name gives `(no record)` | MCP app not registered yet | Complete Step 6 |
| Discovery fails, backend looks dead | MCP Server URL missing the release prefix | Use `<RELEASE>-opensearch-mcp-server.<NS>.svc.cluster.local/sse` |
| `has same NodeURL` / mesh controller `not found` | Cosmetic | Ignore; check `LinkStatus:Active` instead |
| Helm fails on a required value | `mcpgw.proxyToken` absent | Only a console operator can produce it |
| Gateway enrolled into the wrong tenant | Token came from a different environment | Decode the token first; `tenantName` is the env id |
