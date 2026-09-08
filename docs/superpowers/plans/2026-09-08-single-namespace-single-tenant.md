# Single Namespace + Single Tenant Migration Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapse the SE cluster's two namespaces into `ping-devops-cmuir`, and collapse the two PingOne tenants so every login lands in `01d89b06`.

**Architecture:** Two independent phases, executed in order. Phase 1 physically moves the `agentless-mcpgw` + `opensearch` workloads from `ping-devops-curtismuir` into `ping-devops-cmuir` by re-binding their existing EBS-backed PersistentVolumes — no data copy, no re-enrollment. Phase 2 repoints the gateway's OIDC from tenant `0428ba4f` to `01d89b06` and retires the External IdP federation that currently bridges them. Phase 1 changes no identity; Phase 2 changes no infrastructure. Keeping them separate means a failure is unambiguously attributable to one or the other.

**Tech Stack:** EKS 1.35 (`us` context), Helm 3, in-tree `kubernetes.io/aws-ebs` gp2 storage, nginx-public ingress, PingOne (`01d89b06` "AI-Demo", `0428ba4f` "AI Agent"), PingOne Privilege AI Gateway (chart `agentless-mcpgw-0.1.0`).

**Spec:** This document. Findings were gathered live from the cluster on 2026-09-08; see "Established Facts" below.

**Status: PARKED for future consideration. Nothing in this plan has been executed.**
Revised 2026-09-08 (later the same day) with evidence from an unrelated live
incident that happened to exercise most of the same machinery — see
"Revisions" immediately below. Read that section before the plan body: it
changes the justification for Phase 2 and adds three execution traps that
would each have made a step silently no-op.

---

## Revisions — evidence from the 2026-09-08 AI Gateway Client incident

A `405`/`404` outage on the AI Gateway Client was debugged the same day this
plan was written. It touched the gateway, the federation and the Helm release,
so it produced hard evidence the plan was previously guessing at.

### 1. Phase 2 now has a real justification (it did not before)

The original assessment was that collapsing the tenants bought "one fewer hop"
and little else, so Phase 2 was rated not worth the risk. Measured:

```
https://mcpgw.ai-demo.ping-devops.com/opensearch22/authorize
  -> auth.pingone.com/0428ba4f…/as/authorize
  -> /rp/authenticate?providerId=122422d9…       (External IdP)
FINAL: https://apps.pingone.com/01d89b06-…/signon/
```

**Every gateway login is a three-hop federated round trip**, and each hop is a
session that can lapse independently. The user-visible sign-on page is
`01d89b06` — the main demo tenant — even though the OAuth client lives in
`0428ba4f`. Phase 2 removes two of those three hops. Treat it as worth doing,
not as hygiene.

### 2. The token is minted by `0428ba4f`, NOT by the tenant users log into

This is the trap the above appearance sets. Because the sign-on page is
`01d89b06`, it is natural to conclude that PingOne app changes belong there.
They do not: in a federated flow the token is issued by the tenant where the
**client** is registered — `0428ba4f`, app `1a403855` ("AI Gateway").
`01d89b06` only authenticates the user and returns an assertion; it holds no
OAuth client in this chain. Task 2.1 creates the replacement client in
`01d89b06` precisely to move that role.

### 3. `offline_access` is already enabled upstream — Phase 2 must preserve it

Applied 2026-09-08 (Helm revision 22), verified inside the running container:

```
OIDC_SCOPES=openid profile email offline_access p1:read:env p1:read:user p1:read:application
```

App `1a403855` accepts the scope (an authorize probe carrying it returns the
normal federation 302, not `invalid_scope`). Task 2.2's values edit MUST carry
this scope across to the `01d89b06` client, and that client must be created
with the `REFRESH_TOKEN` grant — otherwise the scope is accepted and silently
yields no refresh token, which is exactly how PR #1181's refresh code shipped
inert for a day.

### 4. The gateway's entry path is pinned per Agentic App and can deadlock

The gateway pins ONE client-facing entry path per app, derived from the backend
URL it was registered with, and 404s anything else:

```
[mcpgw] rejecting /mcp on app opensearch22: outside entry path "/sse"
```

It forwards the path after the app segment verbatim. Measured at the
`opensearch-mcp-server` backend (uvicorn) behind `opensearch22`:

| | GET | POST |
|---|---|---|
| `/sse` | 200 | **405** (`Allow: HEAD, GET`) |
| `/mcp` | 200 | accepted |

So an app registered with an `/sse` backend cannot serve a JSON-RPC POST at
all: `/sse` 405s at the backend and `/mcp` 404s at the gateway. **Task 1.5 must
check every Agentic App's registered backend path, not just its namespace.**
Re-registering the backend with a `/mcp` suffix is the only fix, and it is a
console action with no API available from the CLI.

### 5. Three traps that make a step look applied when it is not

- **`helm upgrade` does not restart the pod when only a Secret changes.** The
  OIDC config lives in `agentless-mcpgw-oidc-config`, not the pod spec, so
  revision 22 deployed with `STATUS: deployed` while the pod stayed 5h45m old
  and the process kept the old scopes. **Task 2.2 must follow the upgrade with
  an explicit `kubectl rollout restart`.**
- **The Secret is mounted as a single FILE**
  (`oidc-config -> /var/lib/procyon/config/pingone.env`). Kubernetes never
  auto-updates file-level mounts, so the change reaches the process only on
  restart. Verify by reading the file inside the container, never from
  `kubectl get secret`.
- **Permission rules are prefix matches, so flag order matters.** This repo
  allows `Bash(helm upgrade *)` and `Bash(kubectl patch *)`. Writing
  `helm --kube-context us upgrade …` or `kubectl --context us … patch …` does
  not match, and the command gets refused. Put the subcommand first —
  `helm upgrade --kube-context us …` — both tools accept global flags there.
  This affects nearly every command in this plan.

### 6. A scoped SE deploy touches more than its target, and exits 0 when it fails

`./run-pingaws.sh update code bff` calls the full `k8s/aws/deploy.sh`, which
re-applies all manifests. During the incident it reset `langchain-agent`'s image
to the unqualified local name `ai-demo-k8-langchain-agent:latest`, which
resolves to Docker Hub and `ImagePullBackOff`; all 22 prior ReplicaSets used
`ghcr.io/curtismu7/ai-demo-langchain-agent:latest`. The GHCR rewrite map in
`k8s/aws/deploy.sh:86` has the right entry, but the manifest is misnamed —
**`k8s/40-agent-service-deployment.yaml` actually defines `langchain-agent`,
not `agent-service`** — and the rewrite misses it.

The run reported `[SMOKE] 2 check(s) FAILED` and still **exited 0**. Any deploy
step in this plan must verify pod state directly rather than trust the exit
status. This is unfixed at time of writing.

---

## Global Constraints

- kube context is `us` for every `kubectl` and `helm` command. Pass `--context us` / `--kube-context us` explicitly; do not rely on the current context. **Put the subcommand BEFORE the global flag** — `helm upgrade --kube-context us …`, `kubectl patch --context us …` — because this repo's permission rules are prefix matches (`Bash(helm upgrade *)`, `Bash(kubectl patch *)`) and a flag-first command matches none of them and is refused. See Revision 5.
- **A Helm values change that only rewrites a Secret does not restart the pod, and a single-file Secret mount never auto-updates.** After any `helm upgrade` in this plan, run `kubectl rollout restart` and then verify by reading the value *inside the running container*. `helm` reporting `STATUS: deployed` and `kubectl get secret` showing the new value both lie about what the process is using. See Revision 5.
- Target namespace is `ping-devops-cmuir`. It is already pinned in `demo_api_server/.env` as `SE_NAMESPACE=ping-devops-cmuir`; do not change that line.
- Public hostnames MUST NOT change: `mcpgw.ai-demo.ping-devops.com`, `pingone-mcp-server-2.mcpgw.ai-demo.ping-devops.com`, `opensearch-mcp-server.mcpgw.ai-demo.ping-devops.com`, `mcp-resource-server.ping-devops.com`. Changing any of them forces OIDC redirect-URI and Privilege console re-registration that is not in scope.
- NEVER rotate PingOne client `a6219652-47af-4ed2-8dea-20e9940b3377` — it is the Privilege service client and rotating it permanently kills console sign-in.
- NEVER print a secret value into the transcript, a log, a commit, or a PR body. Copy secrets opaquely (`kubectl get secret -o yaml` piped straight into `kubectl apply`), and assert on key NAMES and lengths only.
- Both PVs are `persistentVolumeReclaimPolicy: Delete` today. Patching them to `Retain` is the FIRST action of Phase 1 and is a hard prerequisite for every later step. Deleting a PVC before that patch destroys the EBS volume irreversibly.
- The gateway binary derives its listen port from `oidc.serverUrl` (an `https://` URL yields 443). If a restart returns 502, suspect a port mismatch between the derived port and the Service `targetPort`, not the application.
- Emoji allowlist per `REGRESSION_PLAN.md` §0. This document uses only the check and cross marks for pass/fail.
- Every verification step must read a command's own exit status, never a piped one. Use `${PIPESTATUS[0]}` or redirect to a file and read the file.

## Established Facts (verified live 2026-09-08)

| Fact | Evidence |
|---|---|
| Both namespaces are owned by the SAME RBAC group `ns-admin-ping-devops-cmuir` | `kubectl get rolebinding -o wide` in both namespaces |
| No NetworkPolicies exist in either namespace | `kubectl get netpol` returns "No resources found" in both |
| Traffic is one-directional: curtismuir reaches INTO cmuir; nothing in cmuir references curtismuir | `kubectl -n ping-devops-cmuir get deploy -o yaml` grepped for `curtismuir` returns nothing |
| `ping-devops-cmuir` has ZERO Helm releases (kubectl/kustomize-deployed) | `helm list -n ping-devops-cmuir` is empty |
| The namespace split originated in email-derived naming | `run-k8.sh:512-513` — `cmuir@` yields `ping-devops-cmuir`, `curtis.muir@` yields `ping-devops-curtismuir` |
| The BFF's Privilege SSO already uses `01d89b06` | `ai-demo-secrets.PRIVILEGE_SSO_ENV_ID` = `01d89b06-66d5-430e-9f28-65636843788b` |
| Only the GATEWAY's own OIDC is on `0428ba4f` | `helm get values agentless-mcpgw` — `oidc.authUrl` points at `0428ba4f-169c-436b-aff9-b230496e0e3b` |
| No CSI VolumeSnapshot CRDs, no `aws` CLI | `kubectl get crd` has no snapshot CRDs; `which aws` fails |
| `patch persistentvolumes` IS permitted | `kubectl auth can-i patch persistentvolumes` returns `yes` |
| The chart has no `persistence.existingClaim` value | `pingone-privgateway-helm-main/agentless/agentless-mcpgw/templates/pvc.yaml` hardcodes a fresh PVC |
| `grafana-secrets` exists in BOTH namespaces with DISJOINT keys | cmuir: `GF_SECURITY_ADMIN_USER/PASSWORD`, `GF_AUTH_GENERIC_OAUTH_CLIENT_SECRET`; curtismuir: `GRAFANA_SERVICE_ACCOUNT_TOKEN` |

### Volumes to re-bind

| PVC (in curtismuir) | PersistentVolume | EBS volume | Size | AZ |
|---|---|---|---|---|
| `agentless-mcpgw-ssl` | `pvc-60ffe628-89d2-4931-8a64-e72a022b4e25` | `vol-06966509423ec278d` | 1Gi | us-east-2c |
| `opensearch-data` | `pvc-21ba9758-c8be-4390-b50a-307ddbd6e1df` | `vol-0bed7d31a3e8977fd` | 10Gi | us-east-2b |

Both AZs have Ready nodes, so either PV can schedule after the move. The PVs carry `nodeAffinity` pinning them to their AZ; this is expected and must not be edited.

### What lives in `ping-devops-curtismuir` today

| Object | Disposition |
|---|---|
| Helm release `agentless-mcpgw` (rev 21) — gateway + 4 MCP sidecars (`mcp-brave`, `mcp-grafana`, `mcp-banking-rest`, `mcp-pingone`) | MOVE (Task 1.4) |
| `opensearch`, `opensearch-mcp-server` (same Helm release) | MOVE (Task 1.4) |
| Helm release `mcp-config-standalone` (`mcp-resource-server-0.1.0`) | DELETE — duplicate of `mcp-resource-server` already in cmuir on the same tenant (Task 1.2) |
| Secrets: `agentless-mcpgw-oidc-config`, `agentless-mcpgw-secret`, `agentless-mcpgw-tls`, `banking-rest-secrets`, `brave-secrets`, `pingone-mcp-secrets` | COPY verbatim (Task 1.3) |
| Secret `grafana-secrets` | COPY as `mcpgw-grafana-secrets` — the name collides in cmuir with disjoint keys (Task 1.3) |
| Secrets `ghcr-pull`, `ghcr-pull-secret` | DO NOT COPY. The values reference `ghcr-pull-secret`, which already exists in cmuir; `ghcr-pull` is unreferenced |
| Ingresses `agentless-mcpgw`, `agentless-mcpgw-mcp`, `mcp-config-standalone-mcp-resource-server` | RECREATED by Helm in cmuir; the third is dropped with its release |
| ConfigMap `mcp-config-standalone-mcp-resource-server-env` | DELETE with its release |

---

## Prerequisites before starting (added 2026-09-08)

Do not begin while the AI Gateway Client is broken. Phase 1 uninstalls the
gateway and re-binds both PVs, so a pre-existing fault makes any new failure
unattributable — and the whole value of splitting the phases is attribution.

- [ ] `tools/list` through `mcpgw.ai-demo.ping-devops.com` returns `200` with a non-empty array **today**, on the current namespace and tenant. As of 2026-09-08 it does NOT — see Revision 4.
- [ ] Task 0.2's console check is answered. A "no" parks Phase 2 indefinitely; Phase 1 still stands alone.
- [ ] No other session owns the SE cluster or the Docker stack (`npm run serve:worktree`).

---

## Phase 0: Pre-flight

### Task 0.1: Capture a complete rollback snapshot

**Files:**
- Create: `docs/superpowers/plans/artifacts/2026-09-08-rollback/` (git-ignored working dir; do NOT commit secret material)

**Interfaces:**
- Produces: `agentless-mcpgw.values.yaml` — the exact Helm values used to reinstall in Task 1.4 and to roll back in either direction.

- [ ] **Step 1: Create the snapshot directory**

```bash
mkdir -p /tmp/ns-migration-rollback
cd /tmp/ns-migration-rollback
```

- [ ] **Step 2: Capture Helm values and manifests**

```bash
helm --kube-context us get values agentless-mcpgw -n ping-devops-curtismuir -o yaml > agentless-mcpgw.values.yaml
helm --kube-context us get manifest agentless-mcpgw -n ping-devops-curtismuir > agentless-mcpgw.manifest.yaml
helm --kube-context us get values mcp-config-standalone -n ping-devops-curtismuir -o yaml > mcp-config-standalone.values.yaml
kubectl --context us -n ping-devops-curtismuir get all,ingress,pvc,cm -o yaml > curtismuir-all.yaml
kubectl --context us get pv pvc-60ffe628-89d2-4931-8a64-e72a022b4e25 pvc-21ba9758-c8be-4390-b50a-307ddbd6e1df -o yaml > pvs.yaml
```

- [ ] **Step 3: Verify the values file is complete**

Run:
```bash
grep -c 'proxyToken\|oidc:\|extraContainers' agentless-mcpgw.values.yaml
```
Expected: `3` or higher. A `0` means the capture failed and you MUST NOT proceed — the `proxyToken` is unrecoverable without a console round-trip.

- [ ] **Step 4: Confirm the file is outside the repo**

Run: `pwd`
Expected: `/tmp/ns-migration-rollback`. This file contains `oidc.clientSecret` and `proxyToken` in cleartext — it must never be committed.

---

### Task 0.2: Confirm `01d89b06` can host the gateway's Agentic App

This is the one genuine unknown in the plan. It gates Phase 2 ONLY. Phase 1 proceeds regardless of the outcome.

- [ ] **Step 1: Open the Privilege console for `01d89b06`**

Navigate to the PingOne console for environment `01d89b06-66d5-430e-9f28-65636843788b`, then `AI Security > Agentic Apps`.

- [ ] **Step 2: Record the answer to three questions**

1. Does an `Agentic Apps` surface exist in this environment at all? (It requires the per-environment Privilege feature flag. `01d89b06` has the Agent IAM Core license and a Privilege cluster `ai-demo-mine`, so this is expected to be yes — but it has never been verified for the AGENTLESS gateway path.)
2. Does a Mesh Cluster exist here that a gateway can enroll into, or would enrollment create one?
3. Can an OIDC application be created here to replace `1a403855-81f6-45eb-b233-fed59abc5c73` ("AI Gateway", currently in `0428ba4f`)?

- [ ] **Step 3: Gate the decision**

- All three yes: Phase 2 is GO. Proceed.
- Any no: Phase 2 is BLOCKED. Stop after Phase 1, record the blocker in `TECH_DEBT.md`, and keep the existing `0428ba4f` federation. Do NOT attempt a workaround — the federation currently works and breaking it strands every gateway login.

---

## Phase 1: Merge `ping-devops-curtismuir` into `ping-devops-cmuir`

### Task 1.1: Protect both volumes

Do this before anything else. Until it is done, every later step risks irreversible data loss.

- [ ] **Step 1: Patch both PVs to Retain**

```bash
kubectl --context us patch pv pvc-60ffe628-89d2-4931-8a64-e72a022b4e25 \
  -p '{"spec":{"persistentVolumeReclaimPolicy":"Retain"}}'
kubectl --context us patch pv pvc-21ba9758-c8be-4390-b50a-307ddbd6e1df \
  -p '{"spec":{"persistentVolumeReclaimPolicy":"Retain"}}'
```

- [ ] **Step 2: Verify BOTH now read Retain**

Run:
```bash
kubectl --context us get pv pvc-60ffe628-89d2-4931-8a64-e72a022b4e25 pvc-21ba9758-c8be-4390-b50a-307ddbd6e1df \
  -o custom-columns='PV:.metadata.name,RECLAIM:.spec.persistentVolumeReclaimPolicy'
```
Expected: both rows show `Retain`. If either shows `Delete`, STOP — re-run Step 1 for that PV. Proceeding with a `Delete` PV destroys the volume at Task 1.4.

---

### Task 1.2: Delete the duplicate mcp-resource-server

`mcp-config-standalone` in curtismuir serves `mcp-resource-server.ping-devops.com` on tenant `01d89b06`. A `mcp-resource-server` deployment already runs in cmuir on the same tenant. The curtismuir copy is redundant.

- [ ] **Step 1: Confirm nothing routes to the curtismuir copy that the cmuir copy cannot serve**

Run:
```bash
kubectl --context us -n ping-devops-curtismuir get cm mcp-config-standalone-mcp-resource-server-env \
  -o jsonpath='{.data.PINGONE_ENVIRONMENT_ID}{"\n"}{.data.VERTICAL}{"\n"}'
kubectl --context us -n ping-devops-cmuir get deploy mcp-resource-server \
  -o jsonpath='{.spec.template.spec.containers[0].image}{"\n"}'
```
Expected: the environment id is `01d89b06-66d5-430e-9f28-65636843788b` and a cmuir image is printed. If the environment ids differ, STOP — the copies are not equivalent and this task must be re-scoped.

- [ ] **Step 2: Record who resolves the hostname**

Run:
```bash
kubectl --context us -n ping-devops-curtismuir get ingress mcp-config-standalone-mcp-resource-server \
  -o jsonpath='{.spec.rules[*].host}{"\n"}'
```
Expected: `mcp-resource-server.ping-devops.com`. Note it — after uninstall this hostname stops resolving unless an equivalent ingress exists in cmuir.

- [ ] **Step 3: Check whether cmuir already publishes that hostname**

Run:
```bash
kubectl --context us -n ping-devops-cmuir get ingress -o jsonpath='{range .items[*]}{.metadata.name}{" "}{.spec.rules[*].host}{"\n"}{end}'
```
If `mcp-resource-server.ping-devops.com` is absent, you must add an ingress for it in cmuir BEFORE Step 4, or accept that the public hostname goes dark. Adding it is a `k8s/` manifest change, not a Helm change.

- [ ] **Step 4: Uninstall the duplicate**

```bash
helm --kube-context us uninstall mcp-config-standalone -n ping-devops-curtismuir
```

- [ ] **Step 5: Verify it is gone and nothing else broke**

Run:
```bash
kubectl --context us -n ping-devops-curtismuir get pods
```
Expected: `agentless-mcpgw`, `opensearch`, `opensearch-mcp-server` still Running; no `mcp-config-standalone-*` pod.

- [ ] **Step 6: Commit the ingress change if Step 3 required one**

```bash
git add k8s/
git commit -m "feat(k8s): publish mcp-resource-server hostname from ping-devops-cmuir"
```

---

### Task 1.3: Copy secrets into `ping-devops-cmuir`

**Interfaces:**
- Produces: secrets `agentless-mcpgw-oidc-config`, `agentless-mcpgw-secret`, `agentless-mcpgw-tls`, `banking-rest-secrets`, `brave-secrets`, `mcpgw-grafana-secrets`, `pingone-mcp-secrets`, `ghcr-pull` in `ping-devops-cmuir`. Task 1.4's Helm values reference these names.

The `grafana-secrets` collision is the trap here: the two namespaces hold secrets of the same name with completely different keys. Copying it verbatim would overwrite cmuir's Grafana admin password and PingOne SSO client secret, taking out both the SSO login and the deliberate local-admin lockout fallback.

- [ ] **Step 1: Re-confirm the collision before touching anything**

Run:
```bash
kubectl --context us -n ping-devops-cmuir get secret grafana-secrets -o jsonpath='{range $k,$v := .data}{$k}{"\n"}{end}'
kubectl --context us -n ping-devops-curtismuir get secret grafana-secrets -o jsonpath='{range $k,$v := .data}{$k}{"\n"}{end}'
```
Expected: the two key lists are disjoint. cmuir has `GF_SECURITY_ADMIN_USER`, `GF_SECURITY_ADMIN_PASSWORD`, `GF_AUTH_GENERIC_OAUTH_CLIENT_SECRET`; curtismuir has only `GRAFANA_SERVICE_ACCOUNT_TOKEN`. If cmuir's list is missing `GF_SECURITY_ADMIN_PASSWORD`, STOP — a previous run already clobbered it and Grafana must be restored first.

- [ ] **Step 2: Copy the six non-colliding secrets**

Run each separately so a failure is attributable:
```bash
for s in agentless-mcpgw-oidc-config agentless-mcpgw-secret agentless-mcpgw-tls banking-rest-secrets brave-secrets pingone-mcp-secrets; do
  kubectl --context us -n ping-devops-curtismuir get secret "$s" -o json \
    | python3 -c 'import sys,json; d=json.load(sys.stdin); m=d["metadata"]; d["metadata"]={"name":m["name"],"namespace":"ping-devops-cmuir"}; print(json.dumps(d))' \
    | kubectl --context us apply -f -
  echo "  $s -> $?"
done
```

- [ ] **Step 3: Copy grafana-secrets UNDER A NEW NAME**

```bash
kubectl --context us -n ping-devops-curtismuir get secret grafana-secrets -o json \
  | python3 -c 'import sys,json; d=json.load(sys.stdin); d["metadata"]={"name":"mcpgw-grafana-secrets","namespace":"ping-devops-cmuir"}; print(json.dumps(d))' \
  | kubectl --context us apply -f -
```

- [ ] **Step 4: Ensure an image pull secret exists**

`ghcr-pull-secret` already exists in cmuir. Confirm rather than copy:
```bash
kubectl --context us -n ping-devops-cmuir get secret ghcr-pull-secret \
  -o jsonpath='{.type}{"\n"}'
```
Expected: `kubernetes.io/dockerconfigjson`. If absent, copy it from curtismuir the same way as Step 2.

- [ ] **Step 5: Verify every secret landed and cmuir's Grafana is untouched**

Run:
```bash
kubectl --context us -n ping-devops-cmuir get secret \
  agentless-mcpgw-oidc-config agentless-mcpgw-secret agentless-mcpgw-tls \
  banking-rest-secrets brave-secrets pingone-mcp-secrets mcpgw-grafana-secrets ghcr-pull-secret \
  -o custom-columns='NAME:.metadata.name,TYPE:.type'
kubectl --context us -n ping-devops-cmuir get secret grafana-secrets \
  -o jsonpath='{range $k,$v := .data}{$k}{"\n"}{end}'
```
Expected: eight rows, no `NotFound`; and `grafana-secrets` still lists `GF_SECURITY_ADMIN_PASSWORD`. A missing `GF_SECURITY_ADMIN_PASSWORD` means Step 3 was run without the rename — restore it before continuing.

- [ ] **Step 6: Confirm Grafana still serves**

Run:
```bash
kubectl --context us -n ping-devops-cmuir rollout status deploy/grafana --timeout=60s
```
Expected: `successfully rolled out`.

---

### Task 1.4: Move the Helm release and re-bind both volumes

This is the only irreversible-feeling step, and it is the reason Task 1.1 exists. The sequence is: uninstall in curtismuir (PVCs are deleted, PVs survive as `Released` because of `Retain`), strip the stale `claimRef` so each PV becomes `Available`, pre-create adopted PVCs in cmuir bound by `volumeName`, then install.

The chart has no `existingClaim` value, so Helm would create its own PVCs and collide with the pre-created ones. Helm 3 resolves this only if the existing object already carries the release's ownership metadata — hence the `meta.helm.sh/*` annotations and the `app.kubernetes.io/managed-by: Helm` label in Step 4.

**Files:**
- Create: `/tmp/ns-migration-rollback/cmuir-pvcs.yaml`
- Modify: `/tmp/ns-migration-rollback/agentless-mcpgw.values.yaml` (namespace + grafana secret name)

**Interfaces:**
- Consumes: `agentless-mcpgw.values.yaml` from Task 0.1; the secrets from Task 1.3.
- Produces: Helm release `agentless-mcpgw` in `ping-devops-cmuir` serving the unchanged hostnames.

- [ ] **Step 1: Edit the captured values for the new namespace**

Two changes only. In `/tmp/ns-migration-rollback/agentless-mcpgw.values.yaml`:

```yaml
# was: namespace: ping-devops-curtismuir
namespace: ping-devops-cmuir
```

and in the `mcp-grafana` entry of `extraContainers`, the secret reference:

```yaml
  - name: GRAFANA_SERVICE_ACCOUNT_TOKEN
    valueFrom:
      secretKeyRef:
        key: GRAFANA_SERVICE_ACCOUNT_TOKEN
        name: mcpgw-grafana-secrets   # was: grafana-secrets
```

Leave `hostname`, `oidc.*`, and `proxyToken` EXACTLY as captured. Phase 1 changes no identity.

- [ ] **Step 2: Verify only those two lines changed**

Run:
```bash
diff <(helm --kube-context us get values agentless-mcpgw -n ping-devops-curtismuir -o yaml) \
     /tmp/ns-migration-rollback/agentless-mcpgw.values.yaml
```
Expected: exactly two changed lines — the `namespace:` value and the grafana secret `name:`. Any other diff means the file was edited wrongly; restore it from Task 0.1 and redo Step 1.

- [ ] **Step 3: Uninstall from curtismuir**

```bash
helm --kube-context us uninstall agentless-mcpgw -n ping-devops-curtismuir
```

Then confirm the volumes survived:
```bash
kubectl --context us get pv pvc-60ffe628-89d2-4931-8a64-e72a022b4e25 pvc-21ba9758-c8be-4390-b50a-307ddbd6e1df \
  -o custom-columns='PV:.metadata.name,STATUS:.status.phase,RECLAIM:.spec.persistentVolumeReclaimPolicy'
```
Expected: both `Released` with `Retain`. If either says `Failed` or is `NotFound`, the volume is gone — stop and restore from the EBS volume id in the facts table via the AWS console.

- [ ] **Step 4: Release the stale claimRef on both PVs**

```bash
kubectl --context us patch pv pvc-60ffe628-89d2-4931-8a64-e72a022b4e25 \
  --type=json -p '[{"op":"remove","path":"/spec/claimRef"}]'
kubectl --context us patch pv pvc-21ba9758-c8be-4390-b50a-307ddbd6e1df \
  --type=json -p '[{"op":"remove","path":"/spec/claimRef"}]'
```

Verify:
```bash
kubectl --context us get pv pvc-60ffe628-89d2-4931-8a64-e72a022b4e25 pvc-21ba9758-c8be-4390-b50a-307ddbd6e1df \
  -o custom-columns='PV:.metadata.name,STATUS:.status.phase'
```
Expected: both `Available`. A PV still showing `Released` will never bind — re-run the patch for it.

- [ ] **Step 5: Pre-create the PVCs in cmuir with Helm ownership metadata**

Write `/tmp/ns-migration-rollback/cmuir-pvcs.yaml`:

```yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: agentless-mcpgw-ssl
  namespace: ping-devops-cmuir
  labels:
    app: agentless-mcpgw
    app.kubernetes.io/managed-by: Helm
  annotations:
    meta.helm.sh/release-name: agentless-mcpgw
    meta.helm.sh/release-namespace: ping-devops-cmuir
spec:
  accessModes:
    - ReadWriteOnce
  storageClassName: gp2
  volumeName: pvc-60ffe628-89d2-4931-8a64-e72a022b4e25
  resources:
    requests:
      storage: 1Gi
---
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: opensearch-data
  namespace: ping-devops-cmuir
  labels:
    app: opensearch
    app.kubernetes.io/managed-by: Helm
  annotations:
    meta.helm.sh/release-name: agentless-mcpgw
    meta.helm.sh/release-namespace: ping-devops-cmuir
spec:
  accessModes:
    - ReadWriteOnce
  storageClassName: gp2
  volumeName: pvc-21ba9758-c8be-4390-b50a-307ddbd6e1df
  resources:
    requests:
      storage: 10Gi
```

Apply it:
```bash
kubectl --context us apply -f /tmp/ns-migration-rollback/cmuir-pvcs.yaml
```

- [ ] **Step 6: Verify both PVCs bound to the ORIGINAL volumes**

Run:
```bash
kubectl --context us -n ping-devops-cmuir get pvc agentless-mcpgw-ssl opensearch-data \
  -o custom-columns='PVC:.metadata.name,STATUS:.status.phase,PV:.spec.volumeName'
```
Expected:
```
PVC                   STATUS   PV
agentless-mcpgw-ssl   Bound    pvc-60ffe628-89d2-4931-8a64-e72a022b4e25
opensearch-data       Bound    pvc-21ba9758-c8be-4390-b50a-307ddbd6e1df
```
A `Pending` PVC means the PV was not `Available` — go back to Step 4. A DIFFERENT PV name means `volumeName` was omitted and a fresh empty volume was provisioned: delete that PVC, confirm the intended PV is still `Available`, and re-apply.

- [ ] **Step 7: Install the release into cmuir**

```bash
helm --kube-context us install agentless-mcpgw \
  ./pingone-privgateway-helm-main/agentless/agentless-mcpgw \
  -n ping-devops-cmuir \
  -f /tmp/ns-migration-rollback/agentless-mcpgw.values.yaml
```

- [ ] **Step 8: Verify the pod comes up with all six containers**

Run:
```bash
kubectl --context us -n ping-devops-cmuir rollout status deploy/agentless-mcpgw --timeout=300s
kubectl --context us -n ping-devops-cmuir get pods -l app=agentless-mcpgw
```
Expected: `successfully rolled out`, and a pod reading `6/6 Running`. Anything less than 6/6 means a sidecar cannot reach its secret — check which container with `kubectl describe pod`.

- [ ] **Step 9: Prove the enrollment survived the move**

This is the whole point of the PV re-bind. Run:
```bash
kubectl --context us -n ping-devops-cmuir logs deploy/agentless-mcpgw -c log-tailer --tail=200 > /tmp/mcpgw-boot.log
grep -icE 'x509|certificate signed by unknown authority|enroll.*fail|Unknown client' /tmp/mcpgw-boot.log
```
Expected: `0`. A non-zero count means the SSL volume did not carry over and the gateway needs a fresh `ENV_PROXY_TOKEN` from the Privilege console — see `privilege/LESSONS-LEARNED.md`.

- [ ] **Step 10: Verify the public endpoint still answers on the unchanged hostname**

Run:
```bash
curl -s -o /dev/null -w '%{http_code}\n' https://mcpgw.ai-demo.ping-devops.com/opensearch22/sse
```
Expected: `401` (unauthenticated, gateway is alive and enforcing) — NOT `502`, `503`, or a connection error. A `502` points at the derived-listen-port trap in the Global Constraints.

---

### Task 1.5: Repoint anything that names the old namespace

**Files:**
- Modify: `privilege/CURRENT-CONFIGURATION.md`, `privilege/AGENT-CONFIGURATION.md`, `privilege/AGENTLESS-CONFIGURATION.md`, `privilege/LESSONS-LEARNED.md`, `k8s/helm/mcpgw/values.yaml:7`, `k8s/aws/deploy.sh:269`, `k8s/create-secrets.sh:523`

- [ ] **Step 1: Update Privilege console backend registrations**

In the Privilege console, `AI Security > Agentic Apps`, any Backend Name containing `.ping-devops-curtismuir.svc.cluster.local` must be rewritten to `.ping-devops-cmuir.svc.cluster.local`. Per `privilege/CURRENT-CONFIGURATION.md` the known one is:

```
http://opensearch-mcp-server.ping-devops-curtismuir.svc.cluster.local/sse
```
becomes
```
http://opensearch-mcp-server.ping-devops-cmuir.svc.cluster.local/mcp
```

Backends already pointing at `.ping-devops-cmuir.` need no namespace change — but still check their path suffix per the next paragraph.

**Fix the PATH while you are in here, not just the namespace.** The suffix sets
the gateway's client-facing entry path for that app, and an `/sse` registration
cannot serve this demo at all: the gateway forwards the path verbatim, and the
`opensearch-mcp-server` backend answers `POST /sse` with `405 Allow: HEAD, GET`
while `POST /mcp` is accepted. Registering `/sse` therefore deadlocks — `/sse`
405s at the backend and `/mcp` 404s at the gateway with
`rejecting /mcp on app opensearch22: outside entry path "/sse"`. This is a live
defect as of 2026-09-08, independent of the migration; doing the migration is a
natural moment to clear it. Audit every Agentic App, not only the ones naming
the old namespace.

- [ ] **Step 2: Verify the rewritten backend resolves from inside the gateway pod**

Run:
```bash
kubectl --context us -n ping-devops-cmuir exec deploy/agentless-mcpgw -c mcpgw -- \
  getent hosts opensearch-mcp-server.ping-devops-cmuir.svc.cluster.local
```
Expected: one line with a cluster IP. Empty output means the Service did not come across; check `kubectl -n ping-devops-cmuir get svc opensearch-mcp-server`.

- [ ] **Step 3: Prove tools still list through the gateway**

Follow the working harness in `privilege/LESSONS-LEARNED.md` to drive a `tools/list`. Expected: HTTP `200` with a non-empty tool array — not a bare `403` (a Privilege policy denial) and not a `404` (wrong Agentic App path segment).

- [ ] **Step 4: Update the repo's namespace references**

Rewrite every `ping-devops-curtismuir` occurrence in the files listed above to `ping-devops-cmuir`, EXCEPT historical incident narrative in `privilege/LESSONS-LEARNED.md` — past events keep their original namespace, with a dated note that the namespace was consolidated on 2026-09-08.

- [ ] **Step 5: Verify no live-config reference remains**

Run:
```bash
grep -rn "ping-devops-curtismuir" k8s/ privilege/ pingone-privgateway-helm-main/ run-k8.sh > /tmp/remaining.txt
cat /tmp/remaining.txt
```
Expected: only historical narrative lines in `LESSONS-LEARNED.md`, plus the `run-k8.sh:513` comment that documents email-to-namespace derivation (which stays — it explains the mechanism, it is not a live target).

- [ ] **Step 6: Commit**

```bash
git add k8s/ privilege/ pingone-privgateway-helm-main/
git commit -m "refactor(k8s): consolidate the Privilege gateway into ping-devops-cmuir"
```

---

### Task 1.6: Retire the empty namespace

- [ ] **Step 1: Confirm it is empty**

Run:
```bash
kubectl --context us -n ping-devops-curtismuir get all,ingress,pvc,cm,secret
```
Expected: no Deployments, Services, Ingresses, or PVCs. Only `kube-root-ca.crt` and any leftover Helm release secrets may remain. If a PVC is still listed, STOP — it holds a claim on a PV you may still need.

- [ ] **Step 2: Wait 24 hours before deleting**

Leave the namespace empty but present for one working day. This is the cheap insurance: if Phase 1 broke something subtle, the `Released` PVs and the Helm history are still trivially reachable. Set a reminder; do not delete on the same day.

- [ ] **Step 3: Delete the namespace**

```bash
kubectl --context us delete namespace ping-devops-curtismuir
```

- [ ] **Step 4: Verify one namespace remains**

Run:
```bash
kubectl --context us get ns | grep ping-devops
```
Expected: `ping-devops-cmuir` only.

- [ ] **Step 5: Restore the reclaim policy on the live volumes**

The PVs are still `Retain`, which means a future legitimate PVC deletion will leak an EBS volume rather than clean it up. That is the safer default and it is a reasonable place to stop — but record the choice:

```bash
kubectl --context us get pv pvc-60ffe628-89d2-4931-8a64-e72a022b4e25 pvc-21ba9758-c8be-4390-b50a-307ddbd6e1df \
  -o custom-columns='PV:.metadata.name,RECLAIM:.spec.persistentVolumeReclaimPolicy'
```
Add a `TECH_DEBT.md` entry noting both PVs are deliberately `Retain` and that deleting their PVCs leaves `vol-06966509423ec278d` and `vol-0bed7d31a3e8977fd` orphaned in EC2.

- [ ] **Step 6: Commit the debt note**

```bash
git add TECH_DEBT.md
git commit -m "docs(tech-debt): record Retain reclaim policy on the migrated gateway volumes"
```

---

## Phase 2: Collapse tenant `0428ba4f` into `01d89b06`

Only proceed if Task 0.2 returned GO. This phase changes identity only — no workloads move.

Today a login to the gateway goes: gateway OIDC (`0428ba4f`) yields External IdP "AI Demo Tenant" yields `01d89b06`, and the shadow user `demouser` on `0428ba4f` is account-linked to `demoUser` on `01d89b06`. Removing the hop means the gateway talks to `01d89b06` directly.

### Task 2.1: Create the gateway's OIDC client in `01d89b06`

**Interfaces:**
- Produces: a new client id and secret used by Task 2.2's Helm values.

- [ ] **Step 1: Read the existing client's configuration**

Record from `0428ba4f` application `1a403855-81f6-45eb-b233-fed59abc5c73` ("AI Gateway"): grant types, response types, redirect URIs, token endpoint auth method, and scopes.

- [ ] **Step 2: Create the matching application in `01d89b06`**

Create an OIDC Web App named `AI Gateway` in `01d89b06` with the SAME redirect URIs — the gateway's `serverUrl` is unchanged, so its callback is unchanged. Do NOT reuse `a6219652`; that is the Privilege service client and must not be touched.

**It MUST carry the `REFRESH_TOKEN` grant and permit the `offline_access` scope.** The gateway requests `offline_access` as of Helm rev 22 (Revision 3). PingOne accepts an ungranted scope at `/authorize` without complaint and simply issues no refresh token, so a missing grant does not surface until you notice the gateway re-running its full identity dance. This repo has already lost a day to exactly that failure on a different app (`6586d3de`, PR #1181).

- [ ] **Step 2a: Confirm the grant before moving on**

Read the new application's `grantTypes` via the Management API or console and confirm `REFRESH_TOKEN` is present alongside `AUTHORIZATION_CODE`. Do not infer it from a successful `/authorize` — that call succeeds either way.

- [ ] **Step 3: Verify discovery works against the new tenant**

Run:
```bash
curl -s -o /dev/null -w '%{http_code}\n' \
  https://auth.pingone.com/01d89b06-66d5-430e-9f28-65636843788b/as/.well-known/openid-configuration
```
Expected: `200`.

---

### Task 2.2: Repoint the gateway's OIDC

- [ ] **Step 1: Update the oidc values, keeping `offline_access`**

In `/tmp/ns-migration-rollback/agentless-mcpgw.values.yaml`, replace every `0428ba4f-169c-436b-aff9-b230496e0e3b` with `01d89b06-66d5-430e-9f28-65636843788b`, and set `oidc.clientId` / `oidc.clientSecret` to the values from Task 2.1. Leave `oidc.serverUrl` alone.

`oidc.scopes` was added 2026-09-08 (Helm rev 22) and MUST survive the move:

```yaml
oidc:
  scopes: openid profile email offline_access p1:read:env p1:read:user p1:read:application
```

If the captured values file predates rev 22 it will not contain this line — add it. Without `offline_access` the gateway re-runs its full identity dance instead of refreshing, which is the behaviour Phase 2 exists to reduce.

- [ ] **Step 2: Verify the old tenant id is gone and the scope survived**

Run:
```bash
grep -c '0428ba4f' /tmp/ns-migration-rollback/agentless-mcpgw.values.yaml
grep -c 'offline_access' /tmp/ns-migration-rollback/agentless-mcpgw.values.yaml
```
Expected: `0` then `1`. A `0` on the second line means the scope was dropped — go back to Step 1.

- [ ] **Step 3: Apply**

Subcommand before the global flag, or the permission rule will not match:

```bash
helm upgrade --kube-context us agentless-mcpgw \
  ./pingone-privgateway-helm-main/agentless/agentless-mcpgw \
  -n ping-devops-cmuir \
  -f /tmp/ns-migration-rollback/agentless-mcpgw.values.yaml
```

- [ ] **Step 4: Restart — the upgrade alone changes nothing the process can see**

This edit touches only `agentless-mcpgw-oidc-config`, a Secret, so the pod
template is unchanged and Helm triggers no rollout. The Secret is also mounted
as a single FILE, which Kubernetes never auto-updates. Without this step the
release reports `STATUS: deployed` while the gateway keeps authenticating
against `0428ba4f`.

```bash
kubectl rollout restart --context us -n ping-devops-cmuir deploy/agentless-mcpgw
kubectl rollout status  --context us -n ping-devops-cmuir deploy/agentless-mcpgw --timeout=300s
```

- [ ] **Step 5: Verify from INSIDE the container, then the endpoint**

Run:
```bash
kubectl exec --context us -n ping-devops-cmuir deploy/agentless-mcpgw -c agentless-mcpgw \
  -- grep -h '^OIDC_AUTH_URL\|^OIDC_SCOPES' /var/lib/procyon/config/pingone.env
curl -s -o /dev/null -w '%{http_code}\n' https://mcpgw.ai-demo.ping-devops.com/opensearch22/sse
```
Expected: the auth URL names `01d89b06`, the scopes include `offline_access`, and the endpoint returns `401`. Reading `kubectl get secret` instead proves nothing — it shows the new value whether or not the process has it. A `502` is the derived-listen-port trap, not an auth failure.

---

### Task 2.3: Prove a federation-free login

- [ ] **Step 1: Drive the full authorize flow**

Use the working harness described in `project-privilege-gateway-federated-to-main-tenant` — a DCR client plus PKCE, driven from the DESKTOP browser via `child_process.exec('open <url>')`. The Playwright MCP browser runs in its own network namespace and cannot reach a loopback redirect listener on the host; it fails on the authorize navigation with `ERR_CONNECTION_REFUSED` and looks like a broken flow.

- [ ] **Step 2: Confirm the login page is the main tenant's**

Expected: signing in as `demoUser` with the main-tenant password succeeds with NO tenant-selection screen and NO second password prompt. A second prompt means a sign-on policy on the new `01d89b06` app has a stray `LOGIN` action after another action — policy actions run IN SEQUENCE, not as alternatives.

- [ ] **Step 3: Confirm the token exchange and a tool call**

Expected: `token exchange 200`, then `tools/list 200` with a non-empty array. A bare `403` is a Privilege policy denial — the grant may still be recorded against the `0428ba4f` shadow user rather than the `01d89b06` user; re-grant the Agentic App policy to the `01d89b06` principal.

- [ ] **Step 4: Confirm the access token shape is unchanged**

Expected: an opaque 64-character `access_token`, and NO `id_token` even with `openid` in scope. Do not attempt to decode it; use introspection. This matches the pre-migration behaviour and confirms nothing else shifted.

---

### Task 2.4: Retire the federation

Only after Task 2.3 passes end to end. Until then the federation is the working fallback.

- [ ] **Step 1: Look up the assignment id, then unassign it**

The assignment id is per-application and must be read first:

```
GET /environments/0428ba4f-169c-436b-aff9-b230496e0e3b/applications/1a403855-81f6-45eb-b233-fed59abc5c73/signOnPolicyAssignments
```

Take the `id` of the entry whose `signOnPolicy.id` is `c695564c-28bd-4d46-b97c-44cf321fb772`, then:

```
DELETE /environments/0428ba4f-169c-436b-aff9-b230496e0e3b/applications/1a403855-81f6-45eb-b233-fed59abc5c73/signOnPolicyAssignments/{that-id}
```

This returns the old AI Gateway app to the environment default `Single_Factor`, which is also the documented revert path. Record the id — re-creating the assignment is the rollback.

- [ ] **Step 2: Leave the IdP and policy in place for one week**

Do NOT delete IdP `122422d9-d722-42d0-981c-0ba935f8f57b` or policy `c695564c-28bd-4d46-b97c-44cf321fb772` yet. Unassigning is reversible in one call; deleting is not.

- [ ] **Step 3: Verify the gateway still works with the federation unassigned**

Re-run Task 2.3 Steps 1-3. Expected: identical results. If anything regresses, re-assign the policy from Step 1 and stop.

- [ ] **Step 4: Delete the federation objects**

After a week of clean operation, delete IdP `122422d9-d722-42d0-981c-0ba935f8f57b` and sign-on policy `AI_Demo_Federation` (`c695564c-28bd-4d46-b97c-44cf321fb772`) from `0428ba4f`, and application `fa486771-e81f-43e1-b648-958925162ddf` ("Demo AI App - Privilege Tenant Federation") from `01d89b06`.

- [ ] **Step 5: Narrow the over-privileged worker**

Independent security debt surfaced by the federation work: worker `89ad8921` ("Demo AI App - Introspection Worker") holds Environment Admin at ORG level, which lets it read every application secret in every environment. With the federation gone it no longer needs cross-tenant reach. Narrow it to the AI Demo environment and confirm introspection still works.

- [ ] **Step 6: Update the docs and commit**

```bash
git add privilege/ docs/
git commit -m "docs(privilege): record the single-tenant cutover to 01d89b06"
```

---

## Rollback

**Phase 1, before Task 1.4:** nothing destructive has happened. Undo Task 1.3 by deleting the copied secrets from cmuir; undo Task 1.1 by patching the PVs back to `Delete`.

**Phase 1, after Task 1.4:** reverse the same mechanism. `helm uninstall agentless-mcpgw -n ping-devops-cmuir`, remove the `claimRef` from both PVs, recreate the PVCs in `ping-devops-curtismuir` with `volumeName` set, and `helm install` there using the pristine `agentless-mcpgw.values.yaml` from Task 0.1. This works only while `ping-devops-curtismuir` still exists — which is why Task 1.6 waits 24 hours.

**Phase 2, any point:** `helm upgrade` with the Task 0.1 values file restores the `0428ba4f` OIDC. If the federation policy was already unassigned in Task 2.4 Step 1, re-assign it. Nothing in Phase 2 is destructive until Task 2.4 Step 4, which is gated behind a week of clean operation.

---

## Success Criteria

- `kubectl get ns | grep ping-devops` returns exactly one namespace.
- `mcpgw.ai-demo.ping-devops.com` and `mcp-resource-server.ping-devops.com` resolve and answer, unchanged.
- The gateway pod reads `6/6 Running` with no x509 or enrollment errors in its boot log.
- `tools/list` through the gateway returns `200` with a non-empty array.
- Signing in to the gateway as `demoUser` uses the `01d89b06` login page with a single password prompt and no tenant hop.
- `grep -rn "0428ba4f"` finds no live configuration — only historical narrative.
- Grafana in `ping-devops-cmuir` still accepts both PingOne SSO and the local admin fallback.
- Reading `/var/lib/procyon/config/pingone.env` **inside the running gateway container** shows an `OIDC_AUTH_URL` naming `01d89b06` and `OIDC_SCOPES` containing `offline_access`. Passing this from `kubectl get secret` instead does not count — see Revision 5.
- Every Agentic App's registered backend ends in `/mcp`, and the gateway log contains no `outside entry path` rejection during a full `tools/list`.
- Phase 2 only: the gateway's token response carries a `refresh_token`. If it does not, the `01d89b06` client is missing the `REFRESH_TOKEN` grant and the `offline_access` scope is inert.

