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
# deploy.sh derives K8S_DIR (manifests) and REPO_ROOT (scripts/, .env) from
# its OWN path, so the test runs a COPY of deploy.sh inside a stub tree that
# mirrors those paths: stub manifests, symlinked scripts/ and
# demo_api_server/ (read-only usage), kubectl/git/gh stubbed on PATH, and
# SKIP_SECRET_CREATE=1 so the vault is never touched. Nothing here can reach
# a real cluster or mutate the repo.

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

HEAD_SHA="aaaa0000bbbb1111cccc2222dddd3333eeee4444"

# ── Stub kubectl: log `apply -f -` stdin, answer the reads deploy.sh makes ──
cat > "$STUB_DIR/kubectl" <<STUB
#!/bin/bash
APPLY_LOG="$APPLY_LOG"
if [[ "\$1 \$2 \$3" == "apply -f -" ]]; then
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
case "\$1" in
  rollout|scale|patch|exec|get|wait|delete|create) exit 0 ;;
esac
exit 0
STUB
chmod +x "$STUB_DIR/kubectl"

# Stub git: deploy.sh derives GHCR owner + HEAD sha from it (with -C anywhere).
cat > "$STUB_DIR/git" <<STUB
#!/bin/bash
case "\$*" in
  *"remote get-url"*) echo "https://github.com/testorg/ai-demo2.git" ;;
  *"rev-parse HEAD"*) echo "$HEAD_SHA" ;;
  *) exit 0 ;;
esac
STUB
chmod +x "$STUB_DIR/git"

# Stub gh: deploy.sh creates the GHCR pull secret when gh exists.
cat > "$STUB_DIR/gh" <<'STUB'
#!/bin/bash
case "$1" in
  api) echo "testorg" ;;
  auth) echo "fake-token" ;;
  *) exit 0 ;;
esac
STUB
chmod +x "$STUB_DIR/gh"

# ── Stub tree: mirrors the paths deploy.sh derives from its own location ────
K8S_TMP="$STUB_DIR/k8s"
mkdir -p "$K8S_TMP/aws"
# scripts/ and demo_api_server/ are copied READ-ONLY by usage — deploy.sh
# only executes scripts/gen-service-topology.js and reads .env from there.
# COPY (not symlink): `cat >` over a symlinked stub follows the link and
# clobbers the real repo file (that bug wiped gen-service-topology.js once).
cp -R "$BASEDIR/scripts/." "$STUB_DIR/scripts/"
cat > "$STUB_DIR/scripts/gen-service-topology.js" <<'STUB'
process.stdout.write('{"data":{"PUBLIC_APP_URL":"https://ai-demo.ping-devops.com"}}');
STUB
ln -s "$BASEDIR/demo_api_server" "$STUB_DIR/demo_api_server"

cp "$BASEDIR/k8s/aws/deploy.sh" "$K8S_TMP/aws/deploy.sh"
cp "$BASEDIR/k8s/aws/nginx-http-configmap.yaml" "$K8S_TMP/aws/" 2>/dev/null || : > "$K8S_TMP/aws/nginx-http-configmap.yaml"
cp "$BASEDIR/k8s/aws/ingress.yaml" "$K8S_TMP/aws/" 2>/dev/null || : > "$K8S_TMP/aws/ingress.yaml"
cp "$BASEDIR"/k8s/*.yaml "$K8S_TMP/" 2>/dev/null

# The two manifests under test — minimal, fully controlled.
mk_manifest() { # mk_manifest <file> <name> <image-line>
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
cat > "$K8S_TMP/01-namespace.yaml" <<'YML'
apiVersion: v1
kind: Namespace
metadata:
  name: ai-demo
YML

run_deploy() { # run_deploy <logfile> [FOCUS_DEPLOYMENTS value]
  : > "$APPLY_LOG"
  local log="$1"; shift
  if [[ $# -gt 0 ]]; then
    FOCUS_DEPLOYMENTS="$1" \
      K8S_NAMESPACE=ping-devops-cmuir \
      SKIP_DEMO_FLAG_RESET=1 SKIP_SECRET_CREATE=1 \
      PATH="$STUB_DIR:$PATH" \
      bash "$K8S_TMP/aws/deploy.sh" </dev/null >"$log" 2>&1 || true
  else
    K8S_NAMESPACE=ping-devops-cmuir \
      SKIP_DEMO_FLAG_RESET=1 SKIP_SECRET_CREATE=1 \
      PATH="$STUB_DIR:$PATH" \
      bash "$K8S_TMP/aws/deploy.sh" </dev/null >"$log" 2>&1 || true
  fi
  cat "$APPLY_LOG"
}

# ── Run 1: focused deploy, frontend only ─────────────────────────────────────
APPLIED="$(run_deploy "$STUB_DIR/run1.log" frontend)"

check "focused deploy rewrote frontend to sha-<HEAD>" \
  grep -q "image: ghcr.io/testorg/ai-demo-frontend:sha-$HEAD_SHA" <<<"$APPLIED"

check "focused deploy left demo-api-server on :latest (no roll)" \
  grep -q "image: ai-demo-k8-api-server:latest" <<<"$APPLIED"

check "focused deploy did NOT put a nonexistent sha tag on demo-api-server" \
  bash -c "! grep 'ai-demo-demo-api-server' <<'$STUB_DIR/apply.log' | grep -q 'sha-$HEAD_SHA'"

check "focused deploy flipped imagePullPolicy to Always" \
  bash -c "! grep -q 'imagePullPolicy: IfNotPresent' '$STUB_DIR/apply.log'"

# ── Run 2: full deploy (knob unset) — old behavior intact ────────────────────
APPLIED="$(run_deploy "$STUB_DIR/run2.log")"

check "full deploy (knob unset) rewrites frontend to sha-<HEAD>" \
  grep -q "ai-demo-frontend:sha-$HEAD_SHA" <<<"$APPLIED"

check "full deploy (knob unset) also rewrites demo-api-server to sha-<HEAD>" \
  grep -q "ai-demo-demo-api-server:sha-$HEAD_SHA" <<<"$APPLIED"

# ── Run 3: comma list focuses both services ──────────────────────────────────
APPLIED="$(run_deploy "$STUB_DIR/run3.log" "frontend,demo-api-server")"

if [[ "$(grep -c "sha-$HEAD_SHA" <<<"$APPLIED")" == "2" ]]; then
  echo "ok: comma-list focus rewrites BOTH services to sha-<HEAD>"
else
  echo "FAIL: comma-list focus rewrites BOTH services to sha-<HEAD> (count=$(grep -c "sha-$HEAD_SHA" <<<"$APPLIED"))"
  FAIL=1
fi

echo
if [[ "$FAIL" == "0" ]]; then
  echo "All focus-deploy checks passed."
else
  echo "FAILURES above — FOCUS_DEPLOYMENTS knob regressed."
fi
exit "$FAIL"
