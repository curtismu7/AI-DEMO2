#!/usr/bin/env bash
# Applies the demo login theme (dark PingOne AI IAM Demo header, editable
# password field styling) to the running PingFederate container's persistent
# template volume. Run after recreating the PF volume from scratch.
#
# Usage: ./apply-login-theme.sh [container-name]
set -euo pipefail

container="${1:-pf-client-migration-admin}"
css_dir="$(cd "$(dirname "$0")/assets" && pwd)"

for c in "$container" ai-demo-pingfederate; do
  if docker exec "$c" test -d /opt/out/instance/server/default/conf/template 2>/dev/null; then
    container="$c"
    found=1
    break
  fi
done
if [[ "${found:-0}" != 1 ]]; then
  echo "error: no PF container with /opt/out templates found" >&2
  exit 1
fi

docker cp "$css_dir/login-main.css" "$container:/opt/out/instance/server/default/conf/template/assets/css/main.css"
echo "Applied demo login theme to $container"
