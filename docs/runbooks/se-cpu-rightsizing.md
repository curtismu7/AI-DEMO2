# SE CPU right-sizing and safer demo-api-server deploys

Measured 2026-10-21. Nothing in this document has been applied to the cluster; the manifest edits
take effect only when someone applies them, one workload at a time (see "Roll out").

## Why

The SE EKS cluster is CPU-saturated by *requests*, not by use: 27 nodes, about 90% of allocatable CPU
requested, 16 Pending pods cluster-wide. A demo-api-server rollout on 2026-10-21 left the new pod
Pending 5-8 minutes (`0/27 nodes available: 26 Insufficient cpu`) and SE returned 502 throughout.
Our two namespaces requested far more than they use:

| namespace | requested CPU | used CPU (kubectl top, sum) |
|---|---|---|
| ping-devops-cmuir | 5305m | about 240m (121m at the last snapshot) |
| ping-devops-curtismuir | 2460m | about 68m |

## Method

- Live requests and limits: `kubectl get deploy,sts -o json` (read-only), both namespaces.
- Usage: `kubectl top pods --containers`, three snapshots about one minute apart; the table uses the max.
- New request per container = max(25m, 3 x observed max rounded up to 5m), never above the current
  request, with a 50m floor for anything user-facing (gateways, agents, MCP servers, RAG path, Kibana).
- Limits and memory requests are untouched. Memory is not audited here.
- Left alone on purpose: pingfederate-0 (both namespaces), frontend, mcp-server (126m use on a 100m
  request; never lower), demo-api-server (see "Live differs from the repo"), llama-tier5 (see below),
  and everything scaled to 0 (llama-tier1, llama-tier3, mastra-agent, openai-agent, pydantic-agent).
- Three snapshots is a short window: all numbers are idle numbers. Anything with a startup burst
  (OpenSearch, Elasticsearch, Kibana, the gateway JVM) gets throttled to its (unchanged) limit, not
  killed, but starts slower under contention. Watch the first start after a restart.

llama-tier5 shows **432m** in use right now (the brief said 1m), so 3 x use exceeds its 500m request:
it stays at 500m. It is the one big requester that is actually busy.

## Before / after

CPU in millicores. "Observed max" is the highest of three `kubectl top` snapshots.

| ns | workload / container | old | new | observed max | source |
|---|---|---|---|---|---|
| cmuir | agent-service | 100m | 50m | 3m | k8s/61-agent-service-deployment.yaml |
| cmuir | alloy | 50m | 25m | 4m | k8s/82-alloy-deployment.yaml |
| cmuir | embeddings | 100m | 50m | 1m | k8s/72-rag-stack.yaml |
| cmuir | jaeger | 50m | 25m | 1m | k8s/73-jaeger-deployment.yaml |
| cmuir | langchain-agent | 500m | 50m | 3m | k8s/40-agent-service-deployment.yaml |
| cmuir | llamaindex-agent | 100m | 50m | 9m | k8s/72-rag-stack.yaml |
| cmuir | loki | 50m | 25m | 4m | k8s/81-loki-deployment.yaml |
| cmuir | mcp-code-search | 100m | 50m | 1m | k8s/72-rag-stack.yaml |
| cmuir | mcp-gateway | 100m | 50m | 3m | k8s/60-mcp-gateway-deployment.yaml |
| cmuir | mcp-resource-server | 100m | 50m | 3m | k8s/63-mcp-resource-server-deployment.yaml |
| cmuir | ping-gateway | 150m | 50m | 4m | k8s/71-ping-gateway-deployment.yaml |
| cmuir | prometheus | 50m | 25m | 2m | k8s/76-prometheus-deployment.yaml |
| cmuir | tika | 100m | 25m | 2m | k8s/72-rag-stack.yaml |
| cmuir | weaviate | 250m | 50m | 2m | k8s/72-rag-stack.yaml |
| cmuir | agentless-mcpgw (gateway 2) | 250m | 105m | 34m | pingone-privgateway-helm-main/agentless/sidecars.values.yaml (helm) |
| curtismuir | agentless-mcpgw (gateway 1) | 250m | 105m | 34m | pingone-privgateway-helm-main/agentless/sidecars.values.yaml (helm) |
| cmuir | agentless-mcpgw (gateway 2) / opensearch-mcp-server (in pod) | 250m | 25m | 2m | not in repo (live helm release values) |
| curtismuir | agentless-mcpgw (gateway 1) / opensearch-mcp-server (in pod) | 250m | 25m | 2m | not in repo (live helm release values) |
| cmuir | opensearch | 500m | 25m | 4m | not in repo (helm release agentless-mcpgw2) |
| curtismuir | opensearch | 500m | 25m | 3m | not in repo (helm release) |
| curtismuir | elasticsearch-siem / elasticsearch | 500m | 35m | 11m | not in repo |
| curtismuir | kibana-siem / kibana | 250m | 50m | 9m | not in repo |

Totals (replicas counted; every row above has one replica):

| group | freed |
|---|---|
| Defined in this repo's `k8s/*.yaml` (14 containers, ping-devops-cmuir) | 1225m |
| Gateway container, `sidecars.values.yaml` (helm, both namespaces) | 290m |
| Not in this repo, live patch only (opensearch-mcp-server x2, opensearch x2, elasticsearch-siem, kibana-siem) | 2065m |
| **Total** | **3580m** |

| namespace | requested before | requested after |
|---|---|---|
| ping-devops-cmuir | 5305m | 3235m |
| ping-devops-curtismuir | 2460m | 950m |

3580m is about one full 3400m node of requests released cluster-wide.

## What is and is not defined in this repo

Defined in this repo (edited by this PR): the 14 `k8s/*.yaml` containers in the table, plus the
gateway container in `pingone-privgateway-helm-main/agentless/sidecars.values.yaml`.

Not in this repo: the in-pod `opensearch-mcp-server` container (250m), `opensearch` (500m) in both
namespaces, and `elasticsearch-siem` and `kibana-siem` in ping-devops-curtismuir. They come from the
manually installed Helm releases (`agentless-mcpgw`, `agentless-mcpgw2`) or hand-made objects, and the
values live only in the release. Patch them live; a later `helm upgrade` with the old values will put
the old numbers back, so also change the release values the next time you upgrade.

Each patch below restarts that one pod (the template changes). They are shown, not run. A
strategic-merge patch addresses the container by name, so the container index does not matter.

```bash
# ping-devops-cmuir
kubectl -n ping-devops-cmuir patch deploy agentless-mcpgw --type strategic -p '{"spec":{"template":{"spec":{"containers":[{"name":"opensearch-mcp-server","resources":{"requests":{"cpu":"25m"}}}]}}}}'
kubectl -n ping-devops-cmuir patch deploy opensearch --type strategic -p '{"spec":{"template":{"spec":{"containers":[{"name":"opensearch","resources":{"requests":{"cpu":"25m"}}}]}}}}'

# ping-devops-curtismuir
kubectl -n ping-devops-curtismuir patch deploy agentless-mcpgw --type strategic -p '{"spec":{"template":{"spec":{"containers":[{"name":"opensearch-mcp-server","resources":{"requests":{"cpu":"25m"}}}]}}}}'
kubectl -n ping-devops-curtismuir patch deploy opensearch --type strategic -p '{"spec":{"template":{"spec":{"containers":[{"name":"opensearch","resources":{"requests":{"cpu":"25m"}}}]}}}}'
kubectl -n ping-devops-curtismuir patch deploy kibana-siem --type strategic -p '{"spec":{"template":{"spec":{"containers":[{"name":"kibana","resources":{"requests":{"cpu":"50m"}}}]}}}}'
kubectl -n ping-devops-curtismuir patch sts elasticsearch-siem --type strategic -p '{"spec":{"template":{"spec":{"containers":[{"name":"elasticsearch","resources":{"requests":{"cpu":"35m"}}}]}}}}'
```

The gateway container (250m to 105m) in both namespaces is deployed with
`scripts/se-gateways.sh` (a helm upgrade). To do it live first, the same patch shape with `deploy agentless-mcpgw`, container `agentless-mcpgw`,
`"cpu":"105m"` works.

## Live differs from the repo

- demo-api-server: live is api-server 490m + authz-server 10m (trimmed by hand), the repo manifest
  says 500m + 25m. This PR does not touch them. Applying `k8s/20-api-server-deployment.yaml` will put
  the repo values back (+25m); trim the manifest to 490m / 10m in a separate change if the live values
  are meant to stay.
- llama-tier1: repo 250m, live 500m. Scaled to 0, so it costs nothing today; not changed.
- Several small SE workloads (hostile-a2a-agent, mainagentdemo, mcpdemo, workeragentdemo, privilege-redis,
  opensearch-mcp-noget, 10m-50m each) were not changed; most are not in `k8s/*.yaml`.

## Roll out (one workload at a time)

For a repo-defined workload, e.g. weaviate:

```bash
kubectl config current-context        # confirm the SE cluster
scripts/se-capacity-check.sh 50       # read-only: 50m is enough room for a small pod
kubectl apply --dry-run=client -f k8s/72-rag-stack.yaml   # client-side only
# k8s manifests use the ai-demo namespace and placeholders; SE applies them through
# k8s/aws/deploy.sh (apply_patched). Prefer a focused deploy of the one service over a bare apply.
kubectl -n ping-devops-cmuir rollout status deploy/weaviate --timeout=180s
kubectl -n ping-devops-cmuir get pod -l app=weaviate        # Running, restarts 0
kubectl -n ping-devops-cmuir top pod --containers | grep weaviate
```

`k8s/72-rag-stack.yaml` holds five workloads (tika, weaviate, embeddings, mcp-code-search,
llamaindex-agent): a file-level apply touches all five, so wait for each rollout in turn and check the
app (the RAG page, an `ask` query) before moving on. Start with the biggest saver that has the least
traffic: langchain-agent (450m), then weaviate (200m), ping-gateway (100m), the rest.

Live strategies (read 2026-10-21): weaviate, embeddings, mcp-code-search and llamaindex-agent are
`Recreate`; loki, prometheus, alloy, jaeger, langchain-agent, agent-service, ping-gateway and
mcp-resource-server are `maxSurge: 0, maxUnavailable: 1`; only tika and mcp-gateway surge. So each
restart takes that workload down briefly (weaviate, embeddings and mcp-resource-server also hold RWO
volumes). Do it between demos. Do **not** restart demo-api-server as part of this (see next section).

## Roll back

```bash
git revert <merge-commit-of-this-PR>      # or revert only the file you want
# then apply the reverted file the same way as the roll out, one workload at a time
kubectl -n ping-devops-cmuir rollout undo deploy/<name>     # fastest, per workload
```

Raising a request back needs free CPU: run `scripts/se-capacity-check.sh <old request>` first.

## Why demo-api-server cannot surge

Live spec (read 2026-10-21) equals the repo manifest: `replicas: 1`, `RollingUpdate` with
`maxSurge: 0, maxUnavailable: 1`, volumes `bff-logs` and `lmdb-data` (PersistentVolumeClaims).
Both PVCs are `ReadWriteOnce` on StorageClass gp2 (in-tree `kubernetes.io/aws-ebs`, a single EBS
volume), and the PVs carry required node affinity to one zone (us-east-2b).

So with `maxSurge: 0, maxUnavailable: 1` the controller scales the old ReplicaSet to 0 and the new
one to 1 in the same step. That is exactly "old pod removed the moment the new one is created", and it
is the only ordering that works here:

- `maxSurge: 1, maxUnavailable: 0` would start the new pod while the old one still holds the volumes.
  An EBS volume attaches to one node. If the scheduler puts the new pod on any other node, it sits in
  `ContainerCreating` with a Multi-Attach error. `maxUnavailable: 0` forbids stopping the old pod
  until the new one is Ready, so neither can progress and the rollout stalls to its
  `progressDeadlineSeconds` (600s). Nothing in the pod spec steers the new pod to the old pod's node.
- Forcing the same node (required self pod-affinity on `kubernetes.io/hostname`) would let both mount
  the volume, but then two BFF processes write the same LMDB environment and log files, and the new
  pod needs a second 500m on that one node, which on a full cluster is the case that fails anyway.
- The `ai-demo-quota` in `k8s/01-namespace.yaml`, which the old manifest comment cited, is not
  present on SE (no ResourceQuota in either namespace). The real reason is the volumes.

So the strategy is left as is, and only the comment was corrected. What actually hurts on SE is the
window after the old pod is gone: the new pod needs 500m on a node in us-east-2b and the cluster had
none. The remedies are (1) a smaller footprint cluster-wide (this PR frees 3580m of requests, 2070m in
the namespace that hosts the BFF) and (2) looking before you roll: `scripts/se-capacity-check.sh`.
A durable fix would be to move the BFF off node-pinned EBS volumes (EFS, or no PVC for logs) so it can
surge; that is a design change, not part of this PR.

## Capacity check before a deploy

```bash
scripts/se-capacity-check.sh              # N = demo-api-server's live total request
scripts/se-capacity-check.sh 500          # N = 500m
scripts/se-capacity-check.sh --zone us-east-2b -q
```

Read-only (`kubectl get ... -o json` only). Prints, per node, allocatable CPU, requested CPU and the
free difference, the Pending pod count cluster-wide, and answers "can a pod of N millicores be
scheduled now?" Exit 0 = yes, 1 = no, 2 = could not tell. For demo-api-server it counts only nodes in
the volume's zone, because that is where the pod can run. It also says whether the pod would only fit
in the old pod's own slot, which another team's pod can take first.

`scripts/saml-live-setup.sh` (deploy phase) runs it before the image change and prints a WARNING when
it exits 1 or 2; add `--strict-capacity` to make exit 1 stop the deploy. Test:
`bash scripts/se-capacity-check.test.sh`.
