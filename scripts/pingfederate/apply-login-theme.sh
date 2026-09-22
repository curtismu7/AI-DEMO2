#!/usr/bin/env bash
# Applies the demo login theme (dark PingOne AI IAM Demo header with Ping logo,
# editable password field styling) to the running PingFederate container's
# persistent template volume. Run after recreating the PF volume from scratch.
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

# PF runs as uid 9031 and the volume files are owned by other uids — write as root.
docker exec -i -u 0 "$container" sh -c 'cat > /opt/out/instance/server/default/conf/template/assets/css/main.css && chown 9031:0 /opt/out/instance/server/default/conf/template/assets/css/main.css && chmod 644 /opt/out/instance/server/default/conf/template/assets/css/main.css' < "$css_dir/login-main.css"
docker cp "$css_dir/ping-logo.svg" "$container:/opt/out/instance/server/default/conf/template/assets/images/ping-logo.svg"
docker exec -u 0 "$container" sh -c 'chown 9031:0 /opt/out/instance/server/default/conf/template/assets/images/ping-logo.svg && chmod 644 /opt/out/instance/server/default/conf/template/assets/images/ping-logo.svg'
echo "Applied demo login theme (header + Ping logo) to $container"
