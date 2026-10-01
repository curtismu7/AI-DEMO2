# Hosted Workload Security Readiness — 2026-09-26

## Scope and access

This inventory covers the workload manifests applied by `k8s/aws/deploy.sh`, including the conditional model-seeding Job. Static manifest review is supplemented with read-only observations collected 2026-09-27 from Kubernetes context `us`. The shared namespaces are `ping-devops-cmuir` and `ping-devops-curtismuir`; the bare names `cmuir` and `curtismuir` do not exist. No resources were changed.

In `ping-devops-cmuir`, 27 pods were present. The namespace had no `pod-security.kubernetes.io/*` labels and no namespaced NetworkPolicies. `ping-devops-curtismuir` had 7 pods, no such namespace labels, and no namespaced NetworkPolicies. These observations do not rule out cluster-wide admission or network controls. The latter namespace contains separate workloads and was not changed.

## Pod security inventory

The namespace manifest requests Restricted `audit` and `warn`; the hosted deployment does not establish an `enforce=restricted` label. The hosted manifests are not ready for Restricted enforcement: most containers have no explicit security context, and several workloads have only partial pod-level settings. The model seed Job deliberately runs as UID 0 to write root-owned model files on RWO volumes.

| Manifest | Workloads | Static observation |
|---|---|---|
| `10-frontend-deployment.yaml` | frontend | Pod sets non-root UID; container has no explicit seccomp, capability-drop, or privilege-escalation settings. |
| `20-api-server-deployment.yaml` | BFF | Pod sets non-root UID and fsGroup; container hardening fields are absent. |
| `30-mcp-server-deployment.yaml` | MCP server | Pod sets non-root UID and fsGroup; container hardening fields are absent. |
| `40-agent-service-deployment.yaml` | LangChain agent | Pod sets non-root UID and fsGroup; container hardening fields are absent. |
| `54-seed-llm-models.yaml` | model seed Job | `runAsUser: 0`; writable RWO model volumes; root was an explicit compatibility choice. |
| `56-llm-stack.yaml` | llama-tier1, llama-tier3, llama-tier5, tier-manager, llm-proxy | No explicit pod or container security context. |
| `57-mcp-weather-deployment.yaml` | weather MCP | No explicit pod or container security context. |
| `58-mcp-brave-deployment.yaml` | Brave MCP | No explicit pod or container security context. |
| `60-mcp-gateway-deployment.yaml` | MCP gateway and authz sidecar | No explicit pod or container security context. |
| `61-agent-service-deployment.yaml` | agent service | No explicit pod or container security context. |
| `62-hitl-service-deployment.yaml` | HITL service | No explicit pod or container security context. |
| `63-mcp-resource-server-deployment.yaml` | MCP resource server | No explicit pod or container security context. |
| `64-api-resource-server-deployment.yaml` | API resource server | No explicit pod or container security context. |
| `71-ping-gateway-deployment.yaml` | PingGateway and authz sidecar | No explicit pod or container security context; gateway uses writable instance/truststore paths. |
| `72-rag-stack.yaml` | Tika, Weaviate, embeddings, MCP code search, llamaindex agent | No explicit pod or container security context. |
| `73-jaeger-deployment.yaml` | Jaeger | No explicit pod or container security context. |
| `76-prometheus-deployment.yaml` | Prometheus | fsGroup only; no explicit runAsNonRoot or container hardening fields. |
| `77-grafana-deployment.yaml` | Grafana and sync init container | fsGroup only; containers lack explicit hardening fields. |
| `81-loki-deployment.yaml` | Loki | fsGroup only; no explicit runAsNonRoot or container hardening fields. |
| `82-alloy-deployment.yaml` | Alloy | No explicit pod or container security context. |
| `83-alertmanager-deployment.yaml` | Alertmanager | fsGroup only; no explicit runAsNonRoot or container hardening fields. |

The previously existing `00-sealed-secrets-install.yaml` and the optional manually installed Privilege Helm chart are not part of the hosted deploy manifest list. This does not establish their runtime posture.

### Restricted enforcement prerequisites

- Confirm image user IDs, write paths, required capabilities, and volume ownership for each workload.
- Add explicit `runAsNonRoot`, `seccompProfile: RuntimeDefault`, `allowPrivilegeEscalation: false`, and `capabilities.drop: [ALL]` where compatible; provide narrow writable mounts only where needed.
- Resolve the seed Job's root write requirement without changing model ownership or RWO behavior, or record a narrowly scoped exception accepted by the namespace owner.
- Reconcile the hosted manifest set against the target cluster's audit results before asking the namespace administrator to enforce Restricted.
- Keep Pod Security Admission in audit/warn until the compatibility work and runtime observation are complete.

## External image inventory and digest pins

The AWS deploy script rewrites repo-built first-party `*:latest` images to commit-derived registry tags. Runtime `imageID` values observed in `ping-devops-cmuir` were used to pin the currently deployed third-party images in the corresponding deployment manifests. This keeps the current runtime bytes while preventing a future pull from resolving a different tag target:

| Manifest | Immutable image reference | Evidence |
|---|---|---|
| `71-ping-gateway-deployment.yaml` | `us-docker.pkg.dev/forgeops-public/images-base/ig@sha256:ccdde554f83c597a0851d714d08c32c3caa2b3d28cad0d9d7fcddf2299619388` | Matches running PingGateway imageID. |
| `72-rag-stack.yaml` | `semitechnologies/weaviate@sha256:ac7f9f124f9b3cd18d1977c8117a2d382618196f68b44cbc1686c25a3f3a66bd` | Matches running Weaviate imageID. |
| `56-llm-stack.yaml`, `72-rag-stack.yaml` | `ghcr.io/ggml-org/llama.cpp@sha256:6257697a7f5d034b8fb499ddb07af3e250506352f94102054252a23f3b85e0af` | Matches running llama.cpp imageID across tiers. |
| `72-rag-stack.yaml` | `apache/tika@sha256:ffab324253edc54706e8882dd28190b1e6559c344b5315ae8a74b9efda9e7291` | Matches running Tika imageID. |
| `73-jaeger-deployment.yaml` | `jaegertracing/all-in-one@sha256:836e9b69c88afbedf7683ea7162e179de63b1f981662e83f5ebb68badadc710f` | Matches running Jaeger imageID. |
| `76-prometheus-deployment.yaml` | `prom/prometheus@sha256:2659f4c2ebb718e7695cb9b25ffa7d6be64db013daba13e05c875451cf51b0d3` | Matches running Prometheus imageID. |
| `77-grafana-deployment.yaml` | `grafana/grafana@sha256:a0f881232a6fb71a0554a47d0fe2203b6888fe77f4cefb7ea62bed7eb54e13c3` | Matches running Grafana main and init container imageIDs. |
| `81-loki-deployment.yaml` | `grafana/loki@sha256:8af2de1abbdd7aa92b27c9bcc96f0f4140c9096b507c77921ffddf1c6ad6c48f` | Matches running Loki imageID. |
| `82-alloy-deployment.yaml` | `grafana/alloy@sha256:b8ec653c44235fbe910879145dac3597d66b0aaecf60bcbbe82580767771a839` | Matches running Alloy imageID. |
| `83-alertmanager-deployment.yaml` | `prom/alertmanager@sha256:690c7b525f4367aa91f73e2f91c632206d32e97c6384bdbf2fb7a861b420340d` | Matches running Alertmanager imageID. |
| `54-seed-llm-models.yaml` | `curlimages/curl@sha256:58adaa4e8dca9c988bae2aba4ab3434a0bb2da16bbe3f92dec39ec7785166777` | Seed Job was absent; pinned to the OCI manifest-list digest returned by `docker buildx imagetools inspect curlimages/curl:latest` on 2026-09-27. |

The image pins change manifest references only; they do not change application configuration or data. The conditional curl seed Job has no current runtime imageID to preserve, so its digest is explicitly identified as registry evidence rather than a running-cluster digest. Optional manifests outside `k8s/aws/deploy.sh`, including the manually installed gateway, were not changed.

## Egress requirements and limits

Manifest/configuration sources show in-cluster calls plus outbound HTTPS for PingOne, configured model providers, and Hugging Face model downloads. The provider endpoints can be supplied through generated secrets/configuration and are not fully represented in committed manifests. Neither reviewed namespace currently contains a namespaced NetworkPolicy, so this repo's `k8s/04-network-policies.yaml` policy set is not present there. Standard Kubernetes NetworkPolicy cannot express portable DNS-name allowlists; CNI enforcement and cluster-wide policy were not established by these reads. Do not narrow egress or enable namespace enforcement until workload compatibility and required destinations are verified; retain the metadata IP exclusions in the repo policy.

## Read-only cluster evidence needed to finish

Collect namespace and runtime evidence with:

```sh
K8S_NAMESPACE=<hosted-namespace> KUBE_CONTEXT=<context> ./k8s/aws/security-preflight.sh
```

The script is read-only and does not fetch Secret objects or secret values. It reports namespace Pod Security labels, third-party pod image/imageID pairs, and present NetworkPolicies. It cannot establish whether a cluster-level admission policy or the CNI enforces those objects; ask the namespace or cluster operator to confirm those separately.

The namespace labels, live pod image IDs, current Jobs, and namespaced NetworkPolicies were collected from both available namespaces on 2026-09-27. Remaining evidence needed before changing namespace enforcement or egress:

- Namespace-owner confirmation of intended Pod Security enforcement and the audit/violation results for deployed workloads.
- Cluster-operator confirmation of CNI NetworkPolicy enforcement, cluster-wide network policies, and cloud firewall egress controls.
- A verified list of required outbound service destinations, collected without exposing secret values.
- If a runtime digest is required for the one-time model seed image, retain image evidence from its next approved run; no seed Job or seed pod existed during this inspection.

Do not include Secret objects, secret environment values, service-account tokens, or registry credentials in an evidence bundle.
