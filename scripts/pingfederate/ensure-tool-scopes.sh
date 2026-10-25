#!/usr/bin/env bash
# ensure-tool-scopes.sh — register every MCP tool scope the gateway checks on the PingFederate authorization server.
#
# PF scopes are hand-maintained; the ones the tools require (ping-gateway/config/scope-topology.json) were partly
# missing, so any tool needing an absent scope (code_search, show_permit, admin_delete_user …) failed under PF with
# "requested scope is invalid". Idempotent: appends only scopes PF does not already have, keeps every other setting,
# and backs up the settings first. Local PF only (PF_BASE defaults to local.ping-devops.com:9999).
set -euo pipefail

PF_BASE="${PF_BASE:-https://local.ping-devops.com:9999/pf-admin-api/v1}"
if [[ -z "${PINGFEDERATE_ADMIN_PASSWORD:-}" ]]; then
  PINGFEDERATE_ADMIN_PASSWORD=$(docker inspect ai-demo-pingfederate \
    --format '{{range .Config.Env}}{{println .}}{{end}}' \
    | awk -F= '$1=="PING_IDENTITY_PASSWORD"{print substr($0, index($0,"=")+1)}')
fi
AUTH="administrator:${PINGFEDERATE_ADMIN_PASSWORD}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TOPOLOGY="${TOPOLOGY:-$ROOT/ping-gateway/config/scope-topology.json}"
TMP="${TMPDIR:-/tmp}/pf-tool-scopes-$$"; mkdir -p "$TMP"
api() { curl -sk -u "$AUTH" -H "X-XSRF-Header: x" "$@"; }

api "$PF_BASE/oauth/authServerSettings" > "$TMP/before.json"
cp "$TMP/before.json" "$TMP/backup.json"

python3 - "$TMP" "$TOPOLOGY" <<'PY'
import json, sys
tmp, topo = sys.argv[1], sys.argv[2]
settings = json.load(open(f'{tmp}/before.json'))
have = {s['name'] for s in settings.get('scopes', [])}
need = {}
for name, tool in json.load(open(topo)).get('tools', {}).items():
    for sc in tool.get('requiredScopes', []):
        need.setdefault(sc, name)
added = [sc for sc in sorted(need) if sc not in have]
for sc in added:
    settings['scopes'].append({'name': sc, 'description': f'Tool scope ({need[sc]})', 'dynamic': False})
json.dump(settings, open(f'{tmp}/new.json', 'w'))
print('scopes to add:', ', '.join(added) if added else 'none')
open(f'{tmp}/added.count', 'w').write(str(len(added)))
PY

if [[ "$(cat "$TMP/added.count")" == "0" ]]; then echo "nothing to do (backup: $TMP/backup.json)"; exit 0; fi
code=$(api -o "$TMP/resp.json" -w '%{http_code}' -H "Content-Type: application/json" -X PUT -d @"$TMP/new.json" "$PF_BASE/oauth/authServerSettings")
echo "PUT authServerSettings -> HTTP $code (backup: $TMP/backup.json)"
[[ "$code" == "200" ]] || { head -c 400 "$TMP/resp.json"; echo; exit 1; }
