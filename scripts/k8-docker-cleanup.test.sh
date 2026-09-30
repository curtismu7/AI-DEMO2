#!/usr/bin/env bash
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HELPER="$HERE/k8-docker-cleanup.sh"
RUN_K8="$HERE/../run-k8.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

mkdir -p "$TMP/bin"
cat > "$TMP/bin/docker" <<'MOCK_DOCKER'
#!/usr/bin/env bash
if [[ "${1:-}" == "ps" && "$*" == *"name=^ai-demo-pingfederate$"* ]]; then
  [[ "${MOCK_PF_EXISTS:-0}" == "1" ]] && echo id-pf
  exit 0
fi
if [[ "${1:-}" == "ps" ]]; then
  cat <<'ROWS'
id-bff ai-demo-api-server
id-pf ai-demo-pingfederate
id-chat librechat-server
ROWS
  exit 0
fi
if [[ "${1:-}" == "network" && "${2:-}" == "ls" ]]; then
  echo net-compose
  exit 0
fi
exit 2
MOCK_DOCKER
chmod +x "$TMP/bin/docker"

source "$HELPER"
type k8_docker_cleanup_network_ids >/dev/null 2>&1 || {
  echo "FAIL: network cleanup selection must preserve PF's Docker network" >&2
  exit 1
}
grep -Fq 'source "$BASEDIR/scripts/k8-docker-cleanup.sh"' "$RUN_K8" || {
  echo "FAIL: run-k8.sh must source the tested cleanup selectors" >&2
  exit 1
}
grep -Fq 'containers="$(k8_docker_cleanup_container_ids)"' "$RUN_K8" || {
  echo "FAIL: run-k8.sh must use the tested container selector" >&2
  exit 1
}
grep -Fq 'for net in $(k8_docker_cleanup_network_ids)' "$RUN_K8" || {
  echo "FAIL: run-k8.sh must use the tested network selector" >&2
  exit 1
}
actual="$(PATH="$TMP/bin:$PATH" k8_docker_cleanup_container_ids)"
expected=$'id-bff\nid-chat'

if [[ "$actual" != "$expected" ]]; then
  printf 'FAIL: K8 cleanup candidates should preserve PF\nexpected:\n%s\ngot:\n%s\n' "$expected" "$actual" >&2
  exit 1
fi

networks="$(MOCK_PF_EXISTS=1 PATH="$TMP/bin:$PATH" k8_docker_cleanup_network_ids)"
if [[ -n "$networks" ]]; then
  printf 'FAIL: K8 cleanup should preserve PF network\ngot: %s\n' "$networks" >&2
  exit 1
fi

networks="$(MOCK_PF_EXISTS=0 PATH="$TMP/bin:$PATH" k8_docker_cleanup_network_ids)"
if [[ "$networks" != "net-compose" ]]; then
  printf 'FAIL: cleanup should remove Compose networks when PF is absent\nexpected: net-compose\ngot: %s\n' "$networks" >&2
  exit 1
fi

echo "K8 Docker cleanup preserves PingFederate and its network: passed"
