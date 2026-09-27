# Hosted Demo Kubernetes Hardening Design

## Goal

Improve the security boundary of the hosted demo Kubernetes deployment while preserving its current demo behavior, Ping SE ingress contract, and secret workflow.

## Context

The target is the hosted demo path in `k8s/aws/deploy.sh`, especially its use of a pre-created `K8S_NAMESPACE` on the Ping SE shared cluster. The script skips namespace creation in that mode. `k8s/01-namespace.yaml` currently sets restricted Pod Security Admission to `audit` and `warn`, while `k8s/01-namespace.yaml` also defines a NetworkPolicy that allows ingress from every pod in the namespace and broad egress on ports 80, 443, and 53.

The current hosted BFF runtime intentionally uses `NODE_ENV=development` and `MCP_AUTH_DISABLED=true` to support the demo's simulated authorization paths. Those settings are explicitly out of scope. The current vault and generated Kubernetes Secret flow is also out of scope.

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

### 4. Compatibility and exclusions

- Preserve the existing hosted ingress authentication, OAuth bypass, and rate-limit behavior.
- Preserve `NODE_ENV=development`, `MCP_AUTH_DISABLED=true`, and all current demo authorization flows.
- Preserve secret sources, names, and rotation behavior.
- Do not deploy to Ping SE or any remote cluster as part of this change.
- Do not modify the optional privilege Helm chart or unrelated image tagging, availability, or monitoring behavior.

## Verification and acceptance criteria

- Every workload applied by the hosted deploy script is inventoried, and no Restricted-policy violation is left undocumented.
- Restricted Pod Security Admission is requested for locally/repo-managed namespaces, and the hosted preflight rejects namespaces that are not externally enforced Restricted.
- NetworkPolicy allows only documented service-to-service ingress and necessary DNS/HTTPS egress, including the existing ingress controller and metadata protections.
- The existing hosted-auth ingress contracts remain unchanged.
- Static manifest/security checks cover the new pod and network-policy requirements.
- No hosted behavior or deployment occurs until the change is reviewed and promoted separately.

## Risks

Restricted enforcement will reject any overlooked root, privileged, hostPath, or writable-root-filesystem dependency. NetworkPolicy enforcement depends on the destination CNI and can break functionality if a required service edge is omitted. The pre-created SE namespace cannot be made Restricted from this repository without administrator action; deployment readiness therefore depends on an external namespace-policy change.
