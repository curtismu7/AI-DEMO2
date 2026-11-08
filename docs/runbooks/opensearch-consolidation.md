# One OpenSearch for both gateway nodes

**Status: DRAFT. Nothing in this change has been applied to the cluster.** Applying it changes a shared Kubernetes environment and deletes a volume, so it needs the owner's approval first.

## Why

The SE cluster has two OpenSearch servers that do the same job, one in each namespace that holds a gateway node:

| | `ping-devops-curtismuir` (gateway 1) | `ping-devops-cmuir` (gateway 2) |
| --- | --- | --- |
| Gateway log shipper writes to it | yes (index `gateway-events`) | yes: gateway 2's `logShipping.opensearchUrl` already points at curtismuir |
| OpenSearch MCP sidecar searches it | yes (`http://opensearch:9200`) | **no, it searches its own namespace's copy** |
| `gateway-events` content (read 2026-11-08) | 1,993 documents, 2026-09-06 to 2026-11-08, current | 935 documents, 2026-10-10 to 2026-10-26, nothing newer |

Gateway 1 and gateway 2 are two nodes of one mesh cluster (`ai-demo-cmuir`) behind one load balancer. Today a call to an OpenSearch tool searches current data or a stale copy depending on which node the load balancer picks. The cmuir copy is also the only reason that namespace carries a 10 Gi volume and a 1 Gi memory request.

## What the change does

Rendered with `helm template` before and after, using `gateway2-mesh.values.yaml`:

- **Removed:** `Deployment/opensearch`, `Service/opensearch` and `PersistentVolumeClaim/opensearch-data` in the gateway 2 release.
- **Changed:** the OpenSearch address of both the gateway 2 sidecar and the standalone `opensearch-mcp-server` Deployment becomes `http://opensearch.ping-devops-curtismuir.svc.cluster.local:9200`.
- **Unchanged:** the renders of `gateway1-lb`, `gateway3` and `sidecars` values are byte-identical to before. The chart default for `opensearchMcpServer.opensearchUrl` is the old value, so any other release behaves as it did.

Files: `agentless-mcpgw/templates/opensearch-mcp-server.yaml` (the URL becomes a value), `agentless-mcpgw/values.yaml` (the new key), `gateway2-mesh.values.yaml` (the cmuir values).

## Before applying (checks, all read-only)

1. **Reachability from gateway 2 to curtismuir's OpenSearch.** The shipper already posts there, so the route exists. Confirm the sidecar's route the same way: `kubectl -n ping-devops-cmuir exec <gateway pod> -c log-tailer -- wget -qO- -T 3 http://opensearch.ping-devops-curtismuir.svc.cluster.local:9200/` returns the cluster banner.
2. **Nothing else in cmuir uses the local `opensearch` Service.** A scan of Deployments and StatefulSets found only the gateway sidecar, the standalone adapter and the log shipper. **Not checked:** `opensearch-mcp-noget` (`k8s/aws/opensearch-mcp-noget.yaml`, applied by hand). Read its environment before applying; if it points at `http://opensearch:9200` it will lose its backend.
3. **Decide whether the old data matters.** The cmuir `gateway-events` holds 935 documents from 2026-10-10 to 2026-10-26. **I did not check whether curtismuir holds the same events**; its index starts earlier (2026-09-06) but may not contain these. The other indices are OpenSearch's own (`top_queries-*`, `.plugins-ml-config`, `.opensearch-observability`). If those 935 events matter, export the index with a scroll query before the upgrade.
4. **Read the live gateway image tag.** The running pod is `v1.261106`; `gateway2-mesh.values.yaml` pins `v1.261102`. A bare `helm upgrade` would roll the gateway back.

## Apply

```bash
# 1. Preview what Helm will do on the server.
helm upgrade agentless-mcpgw ./agentless-mcpgw -n ping-devops-cmuir \
  -f gateway2-mesh.values.yaml --set image.tag=<live tag from check 4> --dry-run=server
# 2. Only if the plan removes exactly Deployment/Service/PVC "opensearch" and changes the two URLs:
helm upgrade agentless-mcpgw ./agentless-mcpgw -n ping-devops-cmuir \
  -f gateway2-mesh.values.yaml --set image.tag=<live tag from check 4>
```

The release may also need the other overlay files it was installed with (`gw2-values.yaml`, `sidecars.values.yaml`); use the same `-f` list as the last upgrade. Never use `--force-conflicts`: the gateway image was set by hand once and forcing the apply moves it. If the upgrade complains about a field-manager conflict, stop and read it.

## Verify

1. `kubectl -n ping-devops-cmuir get deploy,svc,pvc | grep opensearch` shows no `opensearch` Deployment, Service or claim. The `opensearch-mcp-server` Deployment and Service remain.
2. The gateway 2 sidecar answers an OpenSearch tool call with the same index list as gateway 1.
3. `gateway-events` in curtismuir keeps growing after a test call.
4. The gateway 2 pod is still `Running` with its previous image tag.

## Roll back

`helm rollback agentless-mcpgw <previous revision> -n ping-devops-cmuir` restores the Deployment, Service and an **empty** volume claim. The old stale index is not recoverable without the export from check 3, and would not be worth restoring.

## Not changed by this draft

- Curtismuir's OpenSearch, the Elasticsearch SIEM and Kibana in that namespace.
- `opensearch-mcp-noget` and the older `k8s/helm/mcpgw` chart.
- The unrelated `data-elasticsearch-siem-0` volume claim in cmuir (no matching pod was seen; confirm before deleting it, separately).

## Not verified

The upgrade has not been run, even as a server-side dry run. The release name, namespace and exact `-f` file list for the live gateway 2 release were read from the repo, not from the cluster's Helm history.
