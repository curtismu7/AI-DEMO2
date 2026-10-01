#!/usr/bin/env bash
# Regression tests for compact-lmdb.sh, built up across three live incidents
# (2026-10-01) that each only surfaced once the previous one was fixed:
#   1. The copy step ran node:22-alpine with the HOST's bind-mounted
#      node_modules, which only ever has a native lmdb build for the host's
#      own platform — on a Mac host that's darwin-arm64, which Alpine (musl)
#      cannot load. Fix: use the BFF's own image, whose baked-in node_modules
#      matches its own runtime.
#   2. That image runs as USER appuser (uid 1001), which can't mkdir in this
#      one-off container's fresh /data mount. Fix: --user root for the copy.
#   3. IN_VOLUME_DIR pointed at /data/persistent/lmdb, one path segment too
#      deep — the volume IS the container's /app/data/persistent, not its
#      parent, so the live dir is /data/lmdb. The wrong path meant the script
#      had never actually run this far before: it silently compacted an
#      empty, unrelated directory and swapped the (empty) result in, every DB
#      reporting 0 entries. Nothing was lost only because the real data sat
#      untouched at the real path the whole time. Fix: correct the path, AND
#      add a guard that refuses to swap when the copy found zero entries —
#      so a FUTURE path mistake fails loudly instead of repeating this.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="$HERE/compact-lmdb.sh"
FAKE_IMAGE="ai-demo-demo-api-server:test-tag"

make_mock_docker() {
  local bindir="$1" entry_count="$2" runlog="$3"
  mkdir -p "$bindir"
  cat > "$bindir/docker" <<MOCK_DOCKER
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
# The entry-count read (docker run ... alpine cat .../.entry-count) — answered
# here, BEFORE the generic run-logging case, so it never pollutes runlog.
if [[ "\$*" == *"alpine cat "* ]]; then
  echo "$entry_count"
  exit 0
fi
if [[ "\$1" == "run" ]]; then
  echo "\$@" >> "$runlog"
  exit 0
fi
echo "unmocked docker invocation: \$*" >&2
exit 2
MOCK_DOCKER
  chmod +x "$bindir/docker"
}

# ── Test 1: a normal run (nonzero entries) proceeds through both docker-image
#    fixes and all the way to the swap step. ─────────────────────────────────
T1="$(mktemp -d)"
trap 'rm -rf "$T1"' EXIT
make_mock_docker "$T1/bin" 42 "$T1/docker-run.log"

PATH="$T1/bin:$PATH" bash "$SCRIPT" >"$T1/stdout.log" 2>&1 || {
  echo "FAIL: a run with live entries should succeed" >&2
  cat "$T1/stdout.log" >&2
  exit 1
}

# Each logged invocation can embed a multi-line -e payload, so assertions
# check the whole log's content rather than splitting it by line number.
LOG="$T1/docker-run.log"

if grep -q 'node:22-alpine' "$LOG"; then
  echo "FAIL: copy step still names the generic node:22-alpine image — the platform mismatch is back" >&2
  exit 1
fi
if ! grep -q -- "$FAKE_IMAGE" "$LOG"; then
  echo "FAIL: copy step did not use the resolved BFF image ($FAKE_IMAGE)" >&2
  exit 1
fi
if ! grep -q -- '--entrypoint node' "$LOG"; then
  echo "FAIL: copy step must override the BFF image's entrypoint to run node directly" >&2
  exit 1
fi
if ! grep -q -- '--user root' "$LOG"; then
  echo "FAIL: copy step must run as root — the image's own USER (uid 1001) can't mkdir in this one-off mount" >&2
  exit 1
fi
if grep -q -- ':/repo:ro' "$LOG"; then
  echo "FAIL: copy step should no longer need the read-only host repo mount" >&2
  exit 1
fi
if grep -q -- '/data/persistent/lmdb' "$LOG"; then
  echo "FAIL: a step still opens /data/persistent/lmdb — the wrong, one-segment-too-deep path is back" >&2
  exit 1
fi
if ! grep -q -- "'/data/lmdb'" "$LOG"; then
  echo "FAIL: copy step did not open the real path, /data/lmdb" >&2
  exit 1
fi
if ! grep -q -- 'cd /data/lmdb' "$LOG"; then
  echo "FAIL: swap step did not run against the real /data/lmdb path (or did not run at all)" >&2
  exit 1
fi

echo "PASS: a normal run uses the BFF's own image, the real /data/lmdb path, and reaches the swap"

# ── Test 2: zero entries (the wrong-path failure mode) must refuse to swap. ──
T2="$(mktemp -d)"
make_mock_docker "$T2/bin" 0 "$T2/docker-run.log"

if PATH="$T2/bin:$PATH" bash "$SCRIPT" >"$T2/stdout.log" 2>&1; then
  echo "FAIL: a copy that found zero entries everywhere must not exit 0" >&2
  cat "$T2/stdout.log" >&2
  rm -rf "$T2"
  exit 1
fi
if grep -q 'cd /data/lmdb' "$T2/docker-run.log" 2>/dev/null; then
  echo "FAIL: the swap step ran even though the copy found zero entries — live data.mdb would have been overwritten with nothing" >&2
  rm -rf "$T2"
  exit 1
fi
rm -rf "$T2"

echo "PASS: a zero-entry copy refuses to swap, instead of silently discarding live data"
