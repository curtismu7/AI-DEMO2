#!/usr/bin/env bash
# provision-all.test.sh — fresh-container test for provision-all.sh.
#
# Starts a SEPARATE PingFederate (compose project `pf-fresh`, container
# pf-fresh-pingfederate, host ports 19999/19031, own volumes/network), proves it
# has zero OAuth clients, runs provision-all.sh against it, then asserts the
# role clients, the three token managers and the A2A SP connections exist.
# Tears the project down (down -v) on exit. Never touches ai-demo-pingfederate.
#
# Needs (else prints SKIP and exits 0):
#   PF_FRESH_PROFILE_PATH           dir holding instance/server/default/conf/pingfederate.lic
#   PINGFEDERATE_ADMIN_PASSWORD     throwaway admin password for the fresh PF (never echoed)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
HERE="$ROOT/scripts/pingfederate"
CONTAINER="pf-fresh-pingfederate"
PORT=19999
export PF_BASE="https://localhost:${PORT}/pf-admin-api/v1"

if [[ -z "${PF_FRESH_PROFILE_PATH:-}" || -z "${PINGFEDERATE_ADMIN_PASSWORD:-}" ]] || ! docker info >/dev/null 2>&1; then
  echo "SKIP: no fresh PF available (set PF_FRESH_PROFILE_PATH + PINGFEDERATE_ADMIN_PASSWORD and run Docker/OrbStack)"
  exit 0
fi
if [[ "$(docker context show)" != "orbstack" ]]; then echo "FAIL: docker context must be orbstack"; exit 1; fi
if [[ -n "$(lsof -tiTCP:${PORT} -sTCP:LISTEN 2>/dev/null || true)" ]] && ! docker ps -q --filter "name=^${CONTAINER}$" | grep -q .; then
  echo "FAIL: host port ${PORT} is already in use by something else"; exit 1
fi

TMP="$(mktemp -d)"
CURLRC="$TMP/curlrc"
umask 077
printf 'insecure\nsilent\nuser = "administrator:%s"\nheader = "X-XSRF-Header: x"\n' "$PINGFEDERATE_ADMIN_PASSWORD" > "$CURLRC"

dc() {
  PINGFEDERATE_PROFILE_PATH="$PF_FRESH_PROFILE_PATH" PINGFEDERATE_CONTAINER_NAME="$CONTAINER" \
    docker compose -p pf-fresh -f "$HERE/docker-compose.local.yml" -f "$HERE/docker-compose.fresh.yml" "$@"
}
cleanup() { dc down -v >"$TMP/down.log" 2>&1 || echo "WARN: pf-fresh teardown failed, see $TMP/down.log"; rm -f "$CURLRC"; }
trap cleanup EXIT

get() { curl -K "$CURLRC" -o "$2" -w '%{http_code}' "$PF_BASE/$1"; }

dc up -d >"$TMP/up.log" 2>&1
echo "waiting for the fresh PF admin API ..."
for _ in $(seq 1 90); do
  [[ "$(get oauth/clients "$TMP/before.json" 2>/dev/null || true)" == "200" ]] && break
  sleep 5
done
[[ "$(get oauth/clients "$TMP/before.json")" == "200" ]] || { echo "FAIL: fresh PF admin API never came up"; exit 1; }

before="$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1])).items.length)' "$TMP/before.json")"
[[ "$before" == "0" ]] || { echo "FAIL: fresh PF already has $before clients"; exit 1; }
echo "ok: fresh PF has 0 clients before provisioning"

# Role client ids are env-var NAMES in demoReadinessPingFederateProfiles.json; the repo resolves them from the environment.
export PF_STANDARD_AGENT_EXCHANGE_CLIENT_ID=pf-fresh-agent-exchange
export PF_STANDARD_TOKEN_EXCHANGE_CLIENT_ID=pf-fresh-mcp-exchange
export PF_AI_AGENT_ACTOR_CLIENT_ID=pf-fresh-agent-actor
export PF_MCP_SERVICE_ACTOR_CLIENT_ID=pf-fresh-mcp-actor
export PINGFEDERATE_CONTAINER_NAME="$CONTAINER"
export PF_SECRETS_FILE="$TMP/secrets.env"

set +e
bash "$HERE/provision-all.sh" >"$TMP/provision.log" 2>&1
rc=$?
set -e
echo "provision-all.sh exit=$rc (log: $TMP/provision.log, kept until exit)"
cat "$TMP/provision.log"
[[ $rc -eq 0 ]] || { echo "FAIL: provision-all.sh exited $rc"; exit 1; }

get oauth/clients "$TMP/after.json" >/dev/null
get oauth/accessTokenManagers "$TMP/atms.json" >/dev/null
get idp/spConnections "$TMP/sps.json" >/dev/null

node - "$ROOT" "$TMP" <<'JS'
const fs = require('fs');
const [root, tmp] = process.argv.slice(2);
const rd = (f) => JSON.parse(fs.readFileSync(`${tmp}/${f}.json`, 'utf8'));
const profiles = JSON.parse(fs.readFileSync(`${root}/demo_api_server/config/demoReadinessPingFederateProfiles.json`, 'utf8'));
const clients = new Set(rd('after').items.map((c) => c.clientId));
const atms = new Set(rd('atms').items.map((a) => a.id));
const sps = rd('sps').items.map((s) => s.id).filter((id) => id.startsWith('aiDemoA2a'));
let bad = 0;
const fail = (m) => { console.log(`FAIL ${m}`); bad++; };
const ok = (m) => console.log(`ok   ${m}`);
const notVerified = [];
for (const [role, r] of Object.entries(profiles.roles)) {
  if (r.kind === 'oauth-client') {
    const id = /^[A-Z][A-Z0-9_]+$/.test(r.objectId) ? process.env[r.objectId] : r.objectId;
    if (!id) { notVerified.push(`${role} (env ${r.objectId} unset: no provisioner reads it)`); continue; }
    if (clients.has(id)) ok(`${role}: client ${id}`); else if (['standard-agent-exchanger','standard-mcp-exchanger','ai-agent-actor','mcp-service-actor'].includes(role)) fail(`${role}: client ${id} missing`); else notVerified.push(`${role} (client ${id} not provisioned by provision-all.sh)`);
  } else if (role === 'a2a-specialist') {
    if (sps.length === 12) ok(`a2a-specialist: ${sps.length} SP connections`); else fail(`a2a-specialist: ${sps.length} of 12 SP connections`);
  }
}
for (const id of Object.keys(profiles.accessTokenManagers)) atms.has(id) ? ok(`token manager ${id}`) : fail(`token manager ${id} missing`);
for (const n of notVerified) console.log(`NOT VERIFIED ${n}`);
process.exit(bad ? 1 : 0);
JS
echo "PASS provision-all.test.sh"
