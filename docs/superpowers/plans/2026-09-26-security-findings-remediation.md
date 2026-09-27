# Hosted Demo Security Findings Remediation Plan

> **For agentic workers:** Implement this plan task by task. Keep the change set scoped to the findings in `docs/security/SECURITY_REVIEW_2026-09-26.md`.

**Goal:** Reduce the hosted demo's security exposure while preserving its existing sign-in, gateway, CodeGraph, and secret workflows.

**Architecture:** Apply application-layer controls that do not alter authentication flows first. Then tighten the MCP network boundary and pin the remaining hosted image references. Keep namespace-wide Restricted enforcement and general egress restriction as promotion gates until workload audit and traffic requirements are established; do not invent missing live-cluster evidence.

**Tech Stack:** Express/Morgan, Kubernetes manifests and deployment scripts, existing secret workflow, Markdown operational documentation.

**Spec:** `docs/superpowers/specs/2026-09-26-hosted-demo-k8s-hardening-design.md`; findings: `docs/security/SECURITY_REVIEW_2026-09-26.md`.

## Global Constraints

- Preserve `NODE_ENV=development`, `MCP_AUTH_DISABLED=true`, current OAuth flows, and current secret sources.
- Do not deploy to any remote cluster.
- Do not change hosted access admission or OAuth bypass behavior.
- Do not enforce Pod Security Admission or narrow general egress without verified workload compatibility and network requirements.
- Do not add tests or run tests in this task; perform source-level and manifest-level review only.

---

### Task 1: Redact query strings from BFF access logs

**Files:** `demo_api_server/server.js`.

- [x] Replace Morgan's default URL token in the access log format with a path-only token, retaining method, status, timing, remote address, and existing poll-route skip behavior.
- [x] Inspect the format to confirm request URL and Referer query values are omitted.
- [x] Preserve the OAuth callback implementation and callback state validation unchanged.

### Task 2: Decouple hosted session hardening from `NODE_ENV`

**Files:** `demo_api_server/server.js`, `k8s/20-api-server-deployment.yaml`.

- [x] Add opt-in hosted flags that fail startup on missing/default `SESSION_SECRET` and set Secure cookie attributes while leaving `NODE_ENV=development`.
- [x] Set the flags in the hosted BFF deployment only; preserve local development defaults and simulated Authorize behavior.
- [x] Confirm the existing one-hop proxy trust and TLS ingress support secure cookies; session storage, rotation, regeneration, and OAuth persistence remain unchanged.

### Task 3: Bound public CodeGraph resource use

**Files:** `demo_api_server/server.js`, `demo_api_server/routes/codegraphProxy.js` or a focused middleware module.

- [x] Add separate route-local limits for `/api/codegraph/query` and `/api/codegraph/reindex` without requiring application login.
- [x] Keep hosted access admission in front of the routes and preserve CodeGraph SSE headers/timeouts.
- [x] Bound reindex frequency to one request per five minutes per client IP while leaving the public Refresh feature available.

### Task 4: Restrict direct MCP service ingress

**Files:** `k8s/01-namespace.yaml` and/or a dedicated network-policy manifest applied by `k8s/aws/deploy.sh`.

- [x] Map active MCP server callers from the hosted manifests and service topology: PingGateway, the in-cluster MCP gateway, and ingress-nginx for resource metadata.
- [x] Retain legacy same-namespace traffic for other workloads while excluding `mcp-server` from the broad ingress policy.
- [x] Apply a dedicated `mcp-server` policy allowing only the mapped callers on port 8080; preserve existing egress rules.
- [x] Optional manual gateway `demo-mcpgw` is not installed by the hosted deploy script; document that it must be added if that changes.

### Task 5: Pin remaining hosted third-party images

**Files:** hosted manifest references and `k8s/aws/deploy.sh` release inventory.

- [ ] Identify every third-party image used by the hosted deployment path and obtain stable version/digest evidence from approved sources.
- [ ] Pin each applicable workload to an immutable digest; leave local-only or unused optional manifests unchanged.
- [ ] Record the complete hosted image inventory in the release process and verify the rewrite cannot leave a mutable hosted reference.

### Task 6: Close Pod Security and general egress gaps safely

**Files:** `k8s/01-namespace.yaml`, hosted preflight/deployment docs.

- [x] Create a static hosted workload/image/effect inventory in `docs/security/HOSTED_WORKLOAD_READINESS_2026-09-26.md`.
- [ ] Keep warning/audit mode until every hosted workload's violations and required writable paths are inventoried.
- [ ] Add or refine a read-only hosted preflight that reports whether the target namespace is externally enforcing Restricted, without patching a shared namespace.
- [ ] Derive per-workload egress needs and DNS endpoints before replacing broad HTTP(S)/DNS egress; preserve required PingOne/model-provider access and metadata exclusions.
- [ ] Mark Restricted enforcement and egress narrowing as promotion blockers until cluster/CNI behavior and required destinations are verified.

### Task 7: Update the security report with implementation evidence

**Files:** `docs/security/SECURITY_REVIEW_2026-09-26.md`.

- [x] Mark each finding fixed, mitigated, or awaiting external evidence, with links to changed files.
- [x] State that no tests or live deployment were run, and list the remaining operator checks needed before promotion.
- [x] Run `git diff --check` and inspect the final diff for unrelated changes and secrets.
