---
name: privilege-new-demo-environment
description: Stand up a NEW, separate PingOne Privilege demo environment (its own PingOne environment, its own AI Gateway, its own apps and agents), for example a standalone A2A demo. Use when asked to build, clone or hand over a demo environment, enroll a first gateway for a new tenant, create the PingOne OIDC app for a gateway, or turn the AI-DEMO2 Privilege setup into something repeatable. For operating our existing gateway use privilege-mcpgw-agent-k8s; for running it use the guide this skill points at.
---

# New Privilege demo environment

The full guide, with a parameter table and a verified-vs-not table, is
`privilege/NEW-DEMO-ENVIRONMENT.md`. Read it first. This is the order and the traps.
Our own values worked through are in `privilege/A2A-DEMO-AND-SETUP-OUR-ENVIRONMENT.md`.

## Ask before building

1. **Does the new PingOne environment already have Privilege and a console you can sign in to?**
   How Privilege is enabled in a brand-new environment is not documented in this repo and was never
   done by us (our tenant already existed). If the answer is no, stop and ask Ping. Do not guess.
2. Namespace, gateway hostname (DNS plus certificate plus ingress), cluster ID, node architecture,
   and whether the cluster is shared. On a shared cluster compare CPU **requests** with real use first.
3. Redis or in-memory sign-in state, sidecars or none, OpenSearch or not (guide, step 4).

## Order

1. Cluster and prerequisites: right kube context, `ClusterIssuer`, ingress class, DNS.
2. PingOne: Web App (OIDC), `client_secret_basic`, Authorization Code + Token Exchange, redirect
   `https://<host>/callback`, scopes `openid profile email`. Test the secret with a `client_credentials`
   request: `unauthorized_client` means accepted, `invalid_client` means wrong or dead.
3. Console, Gateways, Add New, **AI GW** tab. **Host IP = the node's own
   `<service>.<namespace>.svc.cluster.local`, not the pre-filled value.** Cluster ID, Server URL
   `https://<host>`, the OIDC fields, User ID Claim blank. Get Docker Command, keep only the `eyJ...`
   after `ENV_PROXY_TOKEN=`.
4. Token file: owner-only, **strip leading and trailing whitespace**, one line starting `eyJ`. Decode the
   payload and check `tenantName` equals the new environment ID, `clusterID`, `nodeType` is `PrivateAIGw`,
   and minutes remain. It is single-use and lasts about 2 hours: install straight away.
5. `helm upgrade --install` from the **chart source directory** (never the `.tgz`), secrets by
   `--set-file`, resources of the main container at about 250m / 512Mi.
6. Check the gateway (pod ready, log through `log-tailer`, console row, certificate, unauthenticated
   `POST /<app>/mcp` gives 401). Only then continue.
7. Apps first, then agents (runbook steps 2 to 4). MCP path `/mcp`, not `/sse`; callable agents are
   Remote Agent apps; each agent key is shown once.
8. Deploy the standalone demo, build for the node architecture, run the demo checks, hand over, delete
   token and secret files.

## Traps that cost us time

| Trap | Fix |
| --- | --- |
| Node runs but no console row | Wrong Host IP. A node cannot be edited: scale to 0, delete its enrollment volume, upgrade with a new token, restart |
| `crypto/ecdsa: verification error`, crash loop | Whitespace around the token (nothing was spent). Trim, re-apply, restart the pod |
| Gateway log empty in `kubectl logs` | It writes a file: `kubectl exec <pod> -c log-tailer -- tail /var/log/procyon/cyonproxy.log` |
| Pod Pending, `Insufficient cpu` | Requests, not load. The chart default (1 CPU, 2Gi) is far above real use |
| Gateway exits at startup | Redis configured but unreachable: it gives up after six attempts. Bring Redis up first |
| `--reuse-values` | Does not carry the chart's new defaults; spell keys out; never `--set` a list index |
| Helm dry-run or `get manifest` | Prints the release's Secrets. Write to a private file and delete it |
| VM wizard | Its env file does not work with the chart and its screens show secrets in plain text |

## Rules

- Never print, paste or screenshot a token, client secret, agent key or tenant key. Read secrets from files
  and compare by length, prefix or exact match.
- Do not state a step as verified unless you ran it. The guide's first table says which are.
- A shared-cluster change that re-routes traffic (parking gateways on a load balancer) may be blocked for
  an agent and needs the owner to name the exact action or run it.
- This repo is public: nothing environment-secret goes in a skill or guide.
