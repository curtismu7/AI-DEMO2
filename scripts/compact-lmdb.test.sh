#!/usr/bin/env bash
# Regression test for the 2026-10-01 incident: the copy step ran node:22-alpine
# with the HOST's bind-mounted node_modules, which only ever has a native lmdb
# build for the host's own platform — on a Mac host that's darwin-arm64, which
# Alpine (musl) cannot load. Fix: resolve and use the BFF's own image, whose
# baked-in node_modules matches its own runtime. This test mocks `docker` and
# asserts the copy step's `docker run` never again names a generic node image.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="$HERE/compact-lmdb.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

FAKE_IMAGE="ai-demo-demo-api-server:test-tag"

mkdir -p "$TMP/bin"
cat > "$TMP/bin/docker" <<MOCK_DOCKER
#!/usr/bin/env bash
case "\$1 \$2" in
  "volume inspect") exit 0 ;;
esac
if [[ "\$1" == "inspect" && "\$2" == "ai-demo-api-server" && "\$3" == "--format" ]]; then
  echo "$FAKE_IMAGE"
  exit 0
fi
if [[ "\$1" == "inspect" && "\$2" == "ai-demo-api-server" ]]; then
  exit 0
fi
if [[ "\$1" == "ps" ]]; then
  echo ai-demo-api-server
  exit 0
fi
if [[ "\$1" == "stop" || "\$1" == "start" ]]; then
  exit 0
fi
if [[ "\$1" == "run" ]]; then
  echo "\$@" >> "$TMP/docker-run.log"
  exit 0
fi
echo "unmocked docker invocation: \$*" >&2
exit 2
MOCK_DOCKER
chmod +x "$TMP/bin/docker"

PATH="$TMP/bin:$PATH" bash "$SCRIPT" >"$TMP/stdout.log" 2>&1 || {
  echo "FAIL: script exited non-zero" >&2
  cat "$TMP/stdout.log" >&2
  exit 1
}

COPY_RUN="$(head -1 "$TMP/docker-run.log")"

if grep -q 'node:22-alpine' "$TMP/docker-run.log"; then
  echo "FAIL: copy step still names the generic node:22-alpine image — the platform mismatch is back" >&2
  exit 1
fi
if [[ "$COPY_RUN" != *"$FAKE_IMAGE"* ]]; then
  echo "FAIL: copy step did not use the resolved BFF image ($FAKE_IMAGE)" >&2
  echo "  got: $COPY_RUN" >&2
  exit 1
fi
if [[ "$COPY_RUN" != *"--entrypoint node"* ]]; then
  echo "FAIL: copy step must override the BFF image's entrypoint to run node directly" >&2
  exit 1
fi
if [[ "$COPY_RUN" == *":/repo:ro"* ]]; then
  echo "FAIL: copy step should no longer need the read-only host repo mount" >&2
  exit 1
fi

echo "PASS: compact-lmdb.sh copy step uses the BFF's own image, not node:22-alpine"
