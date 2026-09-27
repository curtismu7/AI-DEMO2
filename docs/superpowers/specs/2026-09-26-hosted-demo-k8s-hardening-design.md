# Hosted Demo Kubernetes Hardening Design

## Goal

Make the hosted demo safer and more dependable to operate while preserving its current demo behavior, Ping SE ingress contract, and existing secret sources and rotation workflow.

## Context

The target is the hosted demo path in `k8s/aws/deploy.sh`, especially its use of a pre-created `K8S_NAMESPACE` on the Ping SE shared cluster. The script skips namespace creation in that mode. `k8s/01-namespace.yaml` currently sets restricted Pod Security Admission to `audit` and `warn`, while `k8s/01-namespace.yaml` also defines a NetworkPolicy that allows ingress from every pod in the namespace and broad egress on ports 80, 443, and 53.

The current hosted BFF runtime intentionally uses `NODE_ENV=development` and `MCP_AUTH_DISABLED=true` to support the demo's simulated authorization paths. Those settings are explicitly out of scope. Keep the existing vault and generated Kubernetes Secret flow; newly required alert credentials must use that same flow rather than introducing a new secret manager.

## Design

### 1. Workload security contexts

Inventory every workload applied by `k8s/aws/deploy.sh`, including its one-time model-seeding Job and monitoring services. Update pod and container security contexts so workloads meet the Kubernetes Restricted Pod Security Standard wherever the image and volume behavior permits: non-root execution, RuntimeDefault seccomp, no privilege escalation, dropped capabilities, and read-only root filesystems where compatible. Add writable `emptyDir` mounts only for paths a service demonstrably needs to write.

Disable service-account token automount for workloads that do not call the Kubernetes API. Where API access is required, retain a dedicated service account and the narrowest namespace-scoped RBAC needed; do not grant workload pods the default service account's credentials by accident.

Do not weaken the policy to accommodate an exception. The model-seeding Job currently runs as root because it writes into root-owned model PVCs; resolve its ownership/write access deliberately and verify that the serving containers can still read the files. If any hosted workload cannot meet Restricted, document the concrete incompatibility and keep namespace-wide enforcement blocked until it is resolved. Optional Helm charts not installed by `k8s/aws/deploy.sh` are outside this change and must not be presented as covered.

### 2. Admission enforcement boundary

For namespaces created from `k8s/01-namespace.yaml`, change Pod Security Admission from audit/warn-only to restricted enforcement after workload compatibility is established. For a pre-created hosted SE namespace, do not patch the Namespace from the application deploy script: namespace labels and admission policy are owned by the cluster/namespace administrator. Document Restricted enforcement as a promotion prerequisite for the hosted namespace and add a deploy preflight that reports a clear error when the required namespace label is absent or weaker.

The preflight must be read-only and must not alter shared-cluster policy. It must preserve local/EKS behavior for the default namespace created by this repository.

### 3. Network policy

Replace the current namespace-wide same-namespace ingress allowance with explicit workload-selector rules for the traffic required by the hosted topology. Use `service-topology.json` and the actual service/port declarations as sources when mapping frontend, BFF, gateway, agent, MCP, resource-server, and observability traffic. Preserve ingress-controller access to the public frontend and external HTTPS access required for PingOne and configured model/provider calls.

Limit DNS egress to cluster DNS endpoints and retain the existing metadata endpoint exclusions. Do not claim FQDN-level egress restrictions: standard Kubernetes NetworkPolicy has no portable hostname policy. If the cluster's CNI cannot enforce the proposed selectors or DNS rules, document that dependency and fail promotion checks rather than assuming enforcement.

### 4. Immutable hosted releases

Preserve the hosted deploy script's existing commit-addressed tag default for repo-built images. Inventory all images in the hosted deployment and remove mutable tags such as `latest` from that path, including third-party images, by pinning tested versions or digests. Make the exact image inventory part of each release record so an operator can redeploy the same bits for rollback. Reject a hosted promotion if an image is mutable or cannot be traced to the approved release.

Do not redesign the build system or add unrelated supply-chain tooling in this change. Local developer manifests can retain convenient local tags when those manifests are not used by the hosted path.

### 5. Availability and recovery

Define a hosted-demo service objective and recovery targets suitable for scheduled demonstrations, then classify each hosted workload by stateless, session-bound, or persistent state. Scale only services whose state model supports multiple replicas. For those services, set a minimum replica count, disruption budget, and autoscaling policy where the metrics and cluster quota make it safe. Keep stateful or GPU/model-heavy services single-instance when replication would break RWO volume access, local session state, or memory quota; document their recovery behavior instead of claiming high availability.

Add backup and restore procedures for the persistent BFF LMDB and MCP OAuth state PVCs. Include schedules/retention that match the approved recovery point objective and a repeatable restore rehearsal that proves data can be recovered into an isolated namespace. The hosted user-facing application must have a rollback path to a previously recorded immutable image set and configuration revision.

Initial planning assumptions to validate during implementation: 99% availability during announced demo windows, a one-hour recovery time objective, and a 24-hour recovery point objective for demo history/configuration data. These are demo operations targets, not customer-service commitments.

### 6. Alert delivery and operational exercises

Replace Alertmanager's no-op hosted receiver with a configurable webhook receiver. The URL/credential must be supplied through the existing secret workflow and never be stored in a ConfigMap or committed. Local development may retain a no-op receiver. Hosted readiness checks must clearly report when no delivery target is configured; a deployment cannot be described as operationally monitored until a test alert reaches the configured endpoint and is acknowledged by its owner.

Document and rehearse the hosted deploy, rollback, post-deploy smoke, backup restore, and existing security incident runbooks against an isolated production-like namespace. Record the expected signals and operator actions. Do not run these exercises against the shared Ping SE namespace or any remote environment as part of this repository change.

### 7. Compatibility and exclusions

- Preserve the existing hosted ingress authentication, OAuth bypass, and rate-limit behavior.
- Preserve `NODE_ENV=development`, `MCP_AUTH_DISABLED=true`, and all current demo authorization flows.
- Preserve existing secret sources and rotation behavior; add only the notifier credential needed for alert delivery through the same process.
- Do not deploy to Ping SE or any remote cluster as part of this change.
- Do not modify the optional privilege Helm chart, local-only developer stack behavior, or unrelated product behavior.

## Verification and acceptance criteria

- Every workload applied by the hosted deploy script is inventoried, and no Restricted-policy violation is left undocumented.
- Restricted Pod Security Admission is requested for locally/repo-managed namespaces, and the hosted preflight rejects namespaces that are not externally enforced Restricted.
- NetworkPolicy allows only documented service-to-service ingress and necessary DNS/HTTPS egress, including the existing ingress controller and metadata protections.
- Every image in the hosted release inventory is immutable and recorded; rollback can select a prior image/configuration record.
- Availability and recovery objectives are documented; replica/HPA/PDB settings respect workload state and namespace capacity; LMDB and OAuth state have a rehearsed restore path.
- A configured hosted alert receiver delivers a test notification; missing configuration is surfaced as an operational readiness gap.
- Hosted deploy, rollback, smoke, restore, and incident-response procedures have an isolated rehearsal path and operator checklist.
- The existing hosted-auth ingress contracts remain unchanged.
- Static checks cover pod security, NetworkPolicy edges, immutable hosted image references, availability declarations, backup/restore artifacts, and alert receiver configuration.
- No hosted behavior or deployment occurs until the change is reviewed and promoted separately.

## Risks

Restricted enforcement will reject any overlooked root, privileged, hostPath, or writable-root-filesystem dependency. NetworkPolicy enforcement depends on the destination CNI and can break functionality if a required service edge is omitted. The pre-created SE namespace cannot be made Restricted from this repository without administrator action; deployment readiness therefore depends on an external namespace-policy change. Multi-replica rollout can conflict with RWO PVCs, MCP session affinity, local state, and the shared namespace quota. Backup restore and notification delivery require cluster storage and an operator-owned webhook destination; repository changes can provide checks and procedures but cannot prove external service availability on their own.
