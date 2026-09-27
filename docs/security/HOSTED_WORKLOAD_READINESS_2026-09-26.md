# Hosted Workload Security Readiness — 2026-09-26

## Scope and access

This inventory covers the workload manifests applied by `k8s/aws/deploy.sh`, including the conditional model-seeding Job. It is static and repository-based. A read-only query of the configured Kubernetes context (`us`) could not reach the EKS API because the configured API hostname did not resolve. No resources were changed.

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

## External image inventory requiring immutable references

The AWS deploy script rewrites repo-built first-party `*:latest` images to commit-derived registry tags. External image references in its deployment path include:

| Manifest | Reference | Notes |
|---|---|---|
| `71-ping-gateway-deployment.yaml` | `us-docker.pkg.dev/forgeops-public/images-base/ig:latest` | Active hosted gateway; current running image/digest unavailable from the inaccessible cluster. |
| `72-rag-stack.yaml` | `semitechnologies/weaviate:latest` | Hosted RAG workload; current data/schema compatibility with a proposed version is unverified. |
| `54-seed-llm-models.yaml` | `curlimages/curl:latest` | Conditional one-time download Job. |
| `56-llm-stack.yaml`, `72-rag-stack.yaml` | `ghcr.io/ggml-org/llama.cpp:server` | Mutable tag despite not ending in `latest`; server build must be pinned without changing model-serving behavior. |

Do not replace these with a different version based only on the current public `latest` pointer. Capture the runtime image IDs from the target cluster, then pin and record the corresponding approved digest. The optional manually installed gateway and unused manifests are outside the hosted deploy script and should be inventoried separately if promoted into that path.

## Egress requirements and limits

Manifest/configuration sources show in-cluster calls plus outbound HTTPS for PingOne, configured model providers, and Hugging Face model downloads. The provider endpoints can be supplied through generated secrets/configuration and are not fully represented in committed manifests. Standard Kubernetes NetworkPolicy cannot express portable DNS-name allowlists, and this workspace could not inspect the target CNI or live egress policy. Keep current broad egress until a destination inventory and CNI capability check are available; retain both metadata IP exclusions in the meantime.

## Read-only cluster evidence needed to finish

From the intended hosted namespace, capture only non-secret operational data:

- Namespace Pod Security Admission labels and namespace-owner confirmation of enforcement policy.
- Workload `image` and `imageID` values, including sidecars and the last successful seed Job.
- Existing NetworkPolicy objects and a statement from the cluster operator that the CNI enforces them.
- Audit/violation events for the deployed pods and required external service destinations.

Do not include Secret objects, secret environment values, service-account tokens, or registry credentials in an evidence bundle.
