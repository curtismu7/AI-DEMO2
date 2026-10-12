#!/bin/bash
# Runnable check for the FOCUS_DEPLOYMENTS knob in k8s/aws/deploy.sh.
# Run: bash scripts/test-se-update-focus.sh
#
# se-update-code.sh <svc> must be a genuinely focused deploy: only the named
# deployment's image is rewritten to the sha tag; every other first-party
# image line stays as the manifest ships it (`:latest`) so `kubectl apply`
# sees an unchanged pod template and does not roll it. Before this knob,
# deploy.sh retagged ALL deployments to sha-$(git rev-parse HEAD) — a tag
# that only exists in GHCR for CI-built commits — and a single-service deploy
# put 14 deployments into ImagePullBackOff (measured 2026-10-11).
#
# deploy.sh is driven end-to-end with kubectl and git stubbed on PATH, so
# nothing here touches a real cluster. apply_patched's output is captured by
# pointing K8S_DIR at a temp tree and logging the kubectl apply stdin.

BASEDIR="$(cd "$(dirname "$0")/.." && pwd)"
FAIL=0
STUB_DIR="$(mktemp -d)"
APPLY_LOG="$STUB_DIR/apply.log"
trap 'rm -rf "$STUB_DIR"' EXIT

check() { # check <desc> <cmd...>
  local desc="$1"; shift
  if "$@" >/dev/null 2>&1; then
    echo "ok: $desc"
  else
    echo "FAIL: $desc"; FAIL=1
  fi
}

# ── Stub kubectl: log `apply -f -` stdin, answer the reads deploy.sh makes ──
cat > "$STUB_DIR/kubectl" <<STUB
#!/bin/bash
APPLY_LOG="$APPLY_LOG"
if [[ "\$1" == "apply" && "\$2" == "-f" && "\$3" == "-" ]]; then
  cat >> "\$APPLY_LOG"
  echo "-----MANIFEST-BOUNDARY-----" >> "\$APPLY_LOG"
  echo "deployment.apps/x configured"
  exit 0
fi
case "\$1 \$2" in
  "config current-context") echo "us"; exit 0 ;;
  "get namespace") exit 0 ;;
  "get ingress") exit 0 ;;
esac
# rollout status / scale / create secret / patch / exec: succeed silently
case "\$1" in
  rollout|scale|patch|exec|get) exit 0 ;;
esac
exit 0
STUB
chmod +x "$STUB_DIR/kubectl"

# Stub git: deploy.sh derives GHCR owner + HEAD sha from it. Deploy.sh calls
# `git -C "$K8S_DIR"` — the stub must accept and ignore -C.
cat > "$STUB_DIR/git" <<'STUB'
#!/bin/bash
case "$*" in
  *"remote get-url"*) echo "https://github.com/testorg/ai-demo2.git" ;;
  *"rev-parse HEAD"*) echo "aaaa0000bbbb1111cccc2222dddd3333eeee4444" ;;
  *) exit 0 ;;
esac
STUB
chmod +x "$STUB_DIR/git"

# deploy.sh also calls aws (EKS path is skipped when EKS_CLUSTER_NAME unset),
# kubelogin, and sh -c 'command -v gh'. Stub gh above; nothing else needed.

# Stub gh: deploy.sh creates the pull secret when gh exists.
cat > "$STUB_DIR/gh" <<'STUB'
#!/bin/bash
case "$1" in
  api) echo "testorg" ;;
  auth) echo "fake-token" ;;
  *) exit 0 ;;
esac
STUB
chmod +x "$STUB_DIR/gh"

# Minimal manifest tree: two deployments — frontend (in focus) and
# demo-api-server (NOT in focus, ships :latest) — plus a third-party image
# that must remain digest-pinned either way.
K8S_TMP="$STUB_DIR/k8s"
mkdir -p "$K8S_TMP/aws"
mk_manifest() { # mk_manifest <file> <api-server-image-line>
  cat > "$K8S_TMP/$1" <<YML
apiVersion: apps/v1
kind: Deployment
metadata:
  name: $2
  namespace: ai-demo
spec:
  template:
    spec:
      containers:
        - name: app
          image: $3
          imagePullPolicy: IfNotPresent
YML
}
mk_manifest 10-frontend-deployment.yaml frontend "ai-demo-k8-ui:latest"
mk_manifest 20-api-server-deployment.yaml demo-api-server "ai-demo-k8-api-server:latest"

# deploy.sh iterates a fixed manifest list — only ship the two files above by
# pointing every other entry at an empty file.
for f in 73-jaeger-deployment.yaml 30-mcp-server-deployment.yaml 57-mcp-weather-deployment.yaml \
         63-mcp-resource-server-deployment.yaml 64-api-resource-server-deployment.yaml \
         62-hitl-service-deployment.yaml 58-mcp-brave-deployment.yaml 56-llm-stack.yaml \
         72-rag-stack.yaml 60-mcp-gateway-deployment.yaml 71-ping-gateway-deployment.yaml \
         61-agent-service-deployment.yaml 40-agent-service-deployment.yaml \
         76-prometheus-deployment.yaml 83-alertmanager-deployment.yaml 81-loki-deployment.yaml \
         82-alloy-deployment.yaml 77-grafana-deployment.yaml 04-network-policies.yaml \
         02-configmap.yaml 21-api-server-logs-pvc.yaml 31-mcp-server-oauth-state-pvc.yaml \
         54-seed-llm-models.yaml; do
  : > "$K8S_TMP/$f"
done
# nginx configmap + ingress live in aws/ — stub those too, plus namespace yaml.
: > "$K8S_TMP/aws/nginx-http-configmap.yaml"
cat > "$K8S_TMP/aws/ingress.yaml" <<'YML'
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: ai-demo-ingress
YML
cat > "$K8S_TMP/01-namespace.yaml" <<'YML'
apiVersion: v1
kind: Namespace
metadata:
  name: ai-demo
YML

# ── Run 1: focused deploy, frontend only ─────────────────────────────────────
: > "$APPLY_LOG"
FOCUS_DEPLOYMENTS=frontend \
  K8S_NAMESPACE=ping-devops-cmuir \
  SKIP_DEMO_FLAG_RESET=1 \
  PATH="$STUB_DIR:$PATH" \
  bash "$BASEDIR/k8s/aws/deploy.sh" >/dev/null 2>&1
APPLIED="$APPLY_LOG"

check "focused deploy rewrote frontend to sha-<HEAD>" \
  grep -q "image: ghcr.io/testorg/ai-demo-frontend:sha-aaaa0000bbbb1111cccc2222dddd3333eeee4444" <<<"$APPLIED"

check "focused deploy left demo-api-server on :latest (no roll)" \
  grep -q "image: ai-demo-k8-api-server:latest" <<<"$APPLIED"

check "focused deploy did NOT put a nonexistent sha tag on demo-api-server" \
  bash -c "! grep 'ai-demo-demo-api-server' <<<'$APPLIED' | grep -q 'sha-aaaa0000'"

check "focused deploy flipped imagePullPolicy to Always" \
  bash -c "! grep 'imagePullPolicy: IfNotPresent' <<<'$APPLIED'"

# ── Run 2: full deploy (knob unset) — old behavior intact ────────────────────
: > "$APPLY_LOG"
K8S_NAMESPACE=ping-devops-cmuir \
  SKIP_DEMO_FLAG_RESET=1 \
  PATH="$STUB_DIR:$PATH" \
  bash "$BASEDIR/k8s/aws/deploy.sh" >/dev/null 2>&1
APPLIED="$APPLY_LOG"

check "full deploy (knob unset) rewrites frontend to sha-<HEAD>" \
  grep -q "ai-demo-frontend:sha-aaaa0000bbbb1111cccc2222dddd3333eeee4444" <<<"$APPLIED"

check "full deploy (knob unset) also rewrites demo-api-server to sha-<HEAD>" \
  grep -q "ai-demo-demo-api-server:sha-aaaa0000bbbb1111cccc2222dddd3333eeee4444" <<<"$APPLIED"

# ── Run 3: comma list focuses both services ──────────────────────────────────
: > "$APPLY_LOG"
FOCUS_DEPLOYMENTS="frontend,demo-api-server" \
  K8S_NAMESPACE=ping-devops-cmuir \
  SKIP_DEMO_FLAG_RESET=1 \
  PATH="$STUB_DIR:$PATH" \
  bash "$BASEDIR/k8s/aws/deploy.sh" >/dev/null 2>&1
APPLIED="$APPLY_LOG"

check "comma-list focus rewrites BOTH services to sha-<HEAD>" \
  bash -c "grep -c 'sha-aaaa0000bbbb1111cccc2222dddd3333eeee4444' <<<'$APPLIED' | grep -q '^2$'"

echo
if [[ "$FAIL" == "0" ]]; then
  echo "All focus-deploy checks passed."
else
  echo "FAILURES above — FOCUS_DEPLOYMENTS knob regressed."
fi
exit "$FAIL"
