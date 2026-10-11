# Share the AI-DEMO2 stack via public GHCR + one-command K8s setup

**Date:** 2026-10-11
**Status:** Draft — awaiting user review

## Goal

Let other Pingers run the full AI-DEMO2 demo on their Macs with **three manual
steps and no image builds**: install OrbStack, clone the repo, run one script.
The stack is already Kubernetes-native; this design closes the distribution gap
(registry + manifest prefixes + recipient bootstrap) without changing how the
demo runs.

## Non-goals

- No AWS/EKS deployment path changes (`run-k8.sh se-*` verbs stay as-is).
- No host-side model serving for recipients (MLX mode stays author-only).
- No Docker Hub publishing (GHCR chosen; both author accounts have
  `write:packages`).
- No redesign of `create-secrets.sh`, `deploy.sh`, or `smoke.sh` — we wrap them.

## Decisions (user-approved)

| Decision | Choice |
| --- | --- |
| Registry | GHCR, public images |
| PingOne env | Each recipient bootstraps their own environment |
| Bootstrap Node dependency | `share-setup.sh` brew-installs Node silently |
| GHCR namespaces | **Split across two accounts** — `curtismu7` and `cmuir_pingcorp` (both verified logged in via `gh` with `write:packages`) — to avoid overloading one account |
| Recipient prereqs | OrbStack + Homebrew only (plus GitHub for the clone) |

## Architecture

### 1. Image publishing (author side)

New script `k8s/publish.sh`, invoked as `./run-k8.sh publish`:

1. **Preconditions:** clean-enough tree, both GHCR logins verified
   (`gh auth token` per active account), local `ai-demo-k8-*:latest` images
   present (build first if missing).
2. **Secret-scan gate (blocking):** for each image, `docker inspect` config env
   + a trivy/grep pass over layers for PingOne client secrets, worker tokens,
   `.env` contents, private keys. Any hit aborts the push. This runs *every*
   publish, not once — images are rebuilt regularly and .env leakage is the
   one failure that can't be rolled back.
3. **Tag:** each `ai-demo-k8-<svc>:latest` →
   `ghcr.io/<acct>/ai-demo-<svc>:v1.YYMMDD` **and** `:latest`.
4. **Split rule:** images alternate across the two accounts (roughly half
   each — see table below). The mapping lives in one array in `publish.sh`,
   same pattern as the existing GHCR push array in `run-k8.sh se-build`.
5. **Push** both tags.

Public visibility is flipped once, per package, in GitHub settings after first
push (author-only manual step, documented in the script header).

Initial split (21 images, ~11/10):

- **curtismu7:** ui, api-server, authz-server, mcp-server, mcp-gateway,
  langchain-agent, llamaindex-agent, agent-service, hitl-service,
  mcp-resource-server, api-resource-server
- **cmuir_pingcorp:** ungoverned-agent, tier-manager, llm-proxy, promptguard,
  mcp-proxy, mcp-weather, mcp-brave, mcp-jwt-verifier, mcp-code-search,
  mcp-audit (if shipped)

Third-party images (llama.cpp, grafana, prom, weaviate, tika, jaeger, Ping
mcpgw) stay where they are — they're already public and pinned by digest.

### 2. Manifest registry prefixes (recipient side)

New kustomize overlay `k8s/overlays/ghcr/kustomization.yaml` with a
`images:` transformer that maps each bare `ai-demo-k8-*` name to its
`ghcr.io/<acct>/ai-demo-k8-*` full path. Recipients run
`kubectl apply -k k8s/overlays/ghcr/` (wired into `deploy.sh` behind a
`DEPLOY_SOURCE=ghcr` env var so the default local-build path is untouched).
The small-machine overlay composes with it: `-k` supports one overlay per
run, so `deploy.sh` applies `overlays/ghcr` then `overlays/small` via
`kubectl apply -f` on the small overlay's rendered output, or the ghcr overlay
becomes the base of a combined overlay — decided at implementation; either
keeps both overlays untouched.

### 3. Recipient one-command setup

New script `k8s/share-setup.sh`:

1. Verify OrbStack reachable (`kubectl cluster-info`) — bail with a link to
   OrbStack's K8s enable docs if not.
2. `brew install` kubectl, helm, node if missing (quietly; brew is the only
   assumed tool).
3. Prompt for PingOne worker creds (or accept
   `PINGONE_*` env vars / a pre-filled `.env`).
4. `cd demo_api_server && npm run pingone:bootstrap` — same flow the author
   uses, generates `demo_api_server/.env`.
5. `k8s/create-secrets.sh` (unchanged).
6. `DEPLOY_SOURCE=ghcr k8s/deploy.sh` (pulls public images, seeds LLM models
   from HuggingFace in-cluster, forwards ports).
7. `k8s/smoke.sh` — prints pass/fail table.

Estimated recipient total: **~10 min machine time** (OrbStack install is the
long pole), then the script runs unattended.

### 4. Versioning

Date tags `v1.YYMMDD` (matches the mcpgw ECR convention already in use).
`latest` always points at the newest publish. Recipient docs pin nothing —
they pull `latest`.

## Security

- **Blocking scan before every push** (see §1.2). Catches: baked `.env`,
  PingOne secrets, TLS private keys, worker tokens.
- Recipient secrets never transit the registry — each Mac creates its own
  K8s secrets from its own bootstrap.
- Public images contain no credentials by design; the demo's PingOne
  environment is per-recipient.
- `.dockerignore` already excludes `**/.env` (verified) — the scan is defense
  in depth, not the only line.

## Testing

- `publish.sh`: dry-run mode lists tag+push pairs without pushing; test that
  the secret-scan gate aborts on a deliberately planted image.
- `overlays/ghcr`: `kubectl apply --dry-run=server -k` renders and validates
  all resources; compare rendered image fields against the split table.
- `share-setup.sh`: run once on a clean VM/second Mac if available; minimum,
  a fresh OrbStack profile.
- End-to-end acceptance: on a recipient-like machine, three steps →
  `smoke.sh` all green.

## Privilege / MCPGW independence (verified in code)

The base demo does not require PingOne Privilege. `ping-mcpgw` ships at
`replicas: 0`; `deploy.sh` scales it only when `ping-mcpgw-secrets` exists and
otherwise warns; `create-secrets.sh` guards every Privilege file behind
`if [ -f ]`. Recipients without a Privilege license lose only the governed
MCPGW door (`*.mcpgw.ai-demo.ping-devops.com` per-app ingress, policy
enforcement, session recording) and `mode mcpgw`.

Recipient hazards found during verification (commit `ae9405667` fixes the
first two):

1. **secrets.vault hard dependency (the bigger one, found during the fix
   pass)** — `create-secrets.sh` aborted without `VAULT_PASSWORD` and the
   gitignored `secrets.vault`, which fresh clones never have. The vault is
   now optional when the file is absent: every key resolves from its service
   `.env`; the old fail-closed rules still apply when `secrets.vault` exists.
2. **Procyon node sensor** — the rollout check was fatal (`|| die`) and the
   default audience is the author's registered NHI. It now degrades to a
   warning; recipients (or `share-setup.sh`) can still set
   `PROCYON_NODESENSOR_ENABLED=0` to skip the install entirely.
3. **Author-bound public hostnames** — `02-configmap.yaml` points
   `PRIVILEGE_A2A_PUBLIC_URL` and `A2A_DELEGATE_TARGETS` at
   `mcpgw.ai-demo.ping-devops.com` (the author's SE ingress). Verified NOT a
   blocker: consumers degrade gracefully (delegation returns no targets
   without `PRIVILEGE_A2A_AGENT_KEY`, which vault-less recipients don't
   have). Recipients doing A2A demos need their own ingress and a configmap
   override — documented, not fixed.

## Open items for implementation

- Exact small-overlay composition method (§2) — pick whichever touches no
  existing overlay file.
- Whether `mcp-audit` is part of the shipped set (it exists locally, not in
  manifests reviewed) — confirm during publish-script implementation.
- GitHub org vs personal repos for the clone URL in docs (repo is currently
  under one account; the other account may host a mirror if needed).
- `share-setup.sh` must export `PROCYON_NODESENSOR_ENABLED=0` by default and
  surface the configmap hostname caveat in its final output.
