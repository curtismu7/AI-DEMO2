#!/usr/bin/env bash
# Guard: run-k8.sh must build from the REPO ROOT, not the caller's cwd.
#
# `docker compose -f docker-compose.yml build` resolves every build context
# relative to that file, so a bare relative -f follows $PWD. Running the SE
# build from a git worktree therefore built THAT tree, which has never had the
# generated `langchain_agent/repo-src`, and compose failed with:
#
#   target langchain-agent: failed to solve: "/langchain_agent/repo-src": not found
#
# The expensive part was not the failure — it was that `run-pingaws.sh build`
# still exited 0, so nothing was pushed while the deploy reported success and
# the cluster quietly kept serving the previous images. This has cost two
# sessions. Both build paths are covered: build() (local/OrbStack) and
# aws_build() (the one run-pingaws.sh uses for SE).
#
# docker and gh are stubbed, so this never reaches a daemon, a registry or a
# cluster, and it needs no .env.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

fail=0
check() { # check <description> <expected> <actual>
  if [ "$2" = "$3" ]; then
    printf '  ok   %s\n' "$1"
  else
    printf '  FAIL %s\n         expected: %s\n         actual:   %s\n' "$1" "$2" "$3"
    fail=1
  fi
}

# Stubs record the cwd compose was invoked from, then succeed.
mkdir -p "$TMP/bin"
cat > "$TMP/bin/docker" <<STUB
#!/usr/bin/env bash
# Drain stdin on \`login --password-stdin\`: without it the upstream
# \`gh auth token |\` takes SIGPIPE, and under pipefail the login "fails".
[ "\${1:-}" = "login" ] && cat >/dev/null 2>&1
[ "\${1:-}" = "compose" ] && pwd >> "$TMP/compose-cwd"
exit 0
STUB
cat > "$TMP/bin/gh" <<'STUB'
#!/usr/bin/env bash
echo stub-token
STUB
chmod +x "$TMP/bin/docker" "$TMP/bin/gh"

# Run from a directory that is NOT the repo root — the condition that triggered
# the bug. The temp dir has no docker-compose.yml at all.
run_from_elsewhere() {
  : > "$TMP/compose-cwd"
  ( cd "$TMP" && PATH="$TMP/bin:$PATH" GITHUB_OWNER=stub IMAGE_TAG=test \
      bash "$ROOT/run-k8.sh" "$1" >"$TMP/out-$1.log" 2>&1 )
  sort -u "$TMP/compose-cwd" 2>/dev/null | tr '\n' ',' | sed 's/,$//'
}

echo "run-k8.sh build cwd guard"

# Every compose invocation must report the repo root, and there must be at
# least one — an empty recording would let this pass vacuously.
for cmd in build aws-build; do
  got="$(run_from_elsewhere "$cmd")"
  if [ -z "$got" ]; then
    printf '  FAIL %s: compose was never invoked (guard would pass vacuously)\n' "$cmd"
    printf '         last lines of its output:\n'
    sed 's/^/           /' "$TMP/out-$cmd.log" | tail -6
    fail=1
  else
    check "$cmd runs compose from the repo root" "$ROOT" "$got"
  fi
done

if [ "$fail" -eq 0 ]; then echo "PASS"; else echo "FAILED"; fi
exit "$fail"
