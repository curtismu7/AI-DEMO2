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
ROLE_IDS=(PF_STANDARD_AGENT_EXCHANGE_CLIENT_ID=pf-fresh-agent-exchange PF_STANDARD_TOKEN_EXCHANGE_CLIENT_ID=pf-fresh-mcp-exchange
          PF_AI_AGENT_ACTOR_CLIENT_ID=pf-fresh-agent-actor PF_MCP_SERVICE_ACTOR_CLIENT_ID=pf-fresh-mcp-actor)
SECRETS="$TMP/secrets.env"

# provision-all.sh runs under `env -i`: only this allowlist reaches it, so a developer shell that holds PingOne /
# vault / BFF variables cannot make it touch PingOne.
run_all() {
  set +e
  env -i PATH="$PATH" HOME="$HOME" TMPDIR="${TMPDIR:-/tmp}" PF_BASE="$PF_BASE" PINGFEDERATE_CONTAINER_NAME="$CONTAINER" \
    PINGFEDERATE_ADMIN_PASSWORD="$PINGFEDERATE_ADMIN_PASSWORD" PF_SECRETS_FILE="$SECRETS" \
    PF_BASE_URL=https://local.ping-devops.com:9031 "${ROLE_IDS[@]}" bash "$HERE/provision-all.sh" >"$1" 2>&1
  local rc=$?
  set -e
  return $rc
}
fail() { echo "FAIL $*"; exit 1; }
count() { node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1])).items.length)' "$1"; }
snapshot() { # -> sets C_CLIENTS C_ATMS C_SPS
  get oauth/clients "$TMP/s-clients.json" >/dev/null; get oauth/accessTokenManagers "$TMP/s-atms.json" >/dev/null; get idp/spConnections "$TMP/s-sps.json" >/dev/null
  C_CLIENTS="$(count "$TMP/s-clients.json")"; C_ATMS="$(count "$TMP/s-atms.json")"; C_SPS="$(count "$TMP/s-sps.json")"
}
wait_admin() { for _ in $(seq 1 60); do [[ "$(get oauth/clients "$TMP/w.json" 2>/dev/null || true)" == "200" ]] && return 0; sleep 5; done; fail "admin API did not come back"; }
started() { docker inspect "$CONTAINER" --format '{{.State.StartedAt}}'; }

# ---- run 1: from zero
run_all "$TMP/run1.log" || { cat "$TMP/run1.log"; fail "run 1 exited non-zero"; }
echo "run 1 ok (exit 0)"
grep -q "switched to JDBC and restarted" "$TMP/run1.log" || fail "run 1 did not switch storage"
grep -q "JDBC active at runtime" "$TMP/run1.log" || fail "run 1 did not prove JDBC at runtime"
grep -q "SKIP PingOne steps" "$TMP/run1.log" || fail "PingOne steps were not skipped (isolation broken?)"
grep -q "SKIP Step 9" "$TMP/run1.log" && grep -q "SKIP CIMD/RAR" "$TMP/run1.log" && grep -q "SKIP vault introspection" "$TMP/run1.log" || fail "optional vault/BFF steps were not skipped"
echo "ok   PingOne, vault, Step 9 and CIMD/RAR steps all skipped under env -i"

# storage mode, in the config file and at runtime (restart once, clients must survive)
docker exec "$CONTAINER" grep -q '^client\.manager=.*ClientManagerJdbcImpl' /opt/out/instance/server/default/conf/service-points.conf || fail "client.manager is not JDBC"
echo "ok   client.manager=ClientManagerJdbcImpl"
snapshot
echo "after run 1: clients=$C_CLIENTS token managers=$C_ATMS sp connections=$C_SPS"
[[ "$C_CLIENTS" == "5" && "$C_ATMS" == "3" && "$C_SPS" == "12" ]] || fail "unexpected counts after run 1"
docker restart "$CONTAINER" >/dev/null
wait_admin
get oauth/clients "$TMP/restart.json" >/dev/null
[[ "$(count "$TMP/restart.json")" == "$C_CLIENTS" ]] || fail "clients did not survive a PF restart"
echo "ok   $C_CLIENTS clients survive a PF restart (JDBC store)"

# ---- read-backs
for path in oauth/clients/ai-demo-pf-introspection oauth/tokenExchange/processor/policies/aiDemoStandardTePolicy \
            idp/tokenProcessors/aiDemoPfAccessSubjectProcessor keyPairs/signing/aidemopf-atm-signing keyPairs/signing/aidemopf-idjag-signing \
            "oauth/accessTokenMappings/urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Atoken-exchange%7CaiDemoStandardTePolicy%7CaiDemoPfJwtAtm" \
            "oauth/accessTokenMappings/urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Atoken-exchange%7CaiDemoStandardTePolicy%7CaiDemoPfMcpGatewayJwtAtm" \
            "oauth/accessTokenMappings/urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Atoken-exchange%7CaiDemoStandardTePolicy%7CaiDemoPfAgentGwJwtAtm"; do
  [[ "$(get "$path" "$TMP/rb.json")" == "200" ]] || fail "read-back of $path is not HTTP 200"
  echo "ok   read-back ${path%%%7C*}"
done

# ---- roles: expected = profile oauth-client roles whose id env var this test sets (must be exactly 4), plus a2a SPs
EXPECTED_ROLE_CLIENTS=4
env "${ROLE_IDS[@]}" node - "$ROOT" "$TMP" "$EXPECTED_ROLE_CLIENTS" <<'JS'
const fs = require('fs');
const [root, tmp, expectedCount] = process.argv.slice(2);
const rd = (f) => JSON.parse(fs.readFileSync(`${tmp}/${f}.json`, 'utf8'));
const profiles = JSON.parse(fs.readFileSync(`${root}/demo_api_server/config/demoReadinessPingFederateProfiles.json`, 'utf8'));
const clients = new Set(rd('s-clients').items.map((c) => c.clientId));
const atms = new Set(rd('s-atms').items.map((a) => a.id));
const sps = rd('s-sps').items.map((s) => s.id).filter((id) => id.startsWith('aiDemoA2a'));
let bad = 0;
const fail = (m) => { console.log(`FAIL ${m}`); bad++; };
const verified = [], notVerified = [];
for (const [role, r] of Object.entries(profiles.roles)) {
  if (r.kind === 'oauth-client') {
    const id = /^[A-Z][A-Z0-9_]+$/.test(r.objectId) ? process.env[r.objectId] : r.objectId;
    if (id && /^[A-Z][A-Z0-9_]+$/.test(r.objectId)) { clients.has(id) ? verified.push(`${role}: ${id}`) : fail(`${role}: client ${id} missing`); }
    else notVerified.push(`${role} (${/^[A-Z]/.test(r.objectId) ? `env ${r.objectId} not provisioned by provision-all.sh` : `client ${r.objectId} has no provisioner`})`);
  } else if (role === 'a2a-specialist') {
    sps.length === 12 ? verified.push(`${role}: ${sps.length} SP connections`) : fail(`${role}: ${sps.length} of 12 SP connections`);
  }
}
const roleClients = verified.filter((v) => !v.startsWith('a2a')).length;
if (roleClients !== Number(expectedCount)) fail(`verified ${roleClients} role clients, expected exactly ${expectedCount}`);
for (const id of Object.keys(profiles.accessTokenManagers)) atms.has(id) ? verified.push(`token manager ${id}`) : fail(`token manager ${id} missing`);
for (const v of verified) console.log(`ok   ${v}`);
for (const n of notVerified) console.log(`NOT VERIFIED ${n}`);
process.exit(bad ? 1 : 0);
JS

# ---- run 2: idempotent. Nothing created, nothing duplicated, no storage switch, no PF restart.
S1="$(started)"
run_all "$TMP/run2.log" || { cat "$TMP/run2.log"; fail "run 2 exited non-zero"; }
echo "run 2 ok (exit 0)"
grep -q "already on JDBC: no-op" "$TMP/run2.log" || fail "run 2 did not no-op the storage switch"
grep -q "restarted" "$TMP/run2.log" && fail "run 2 restarted PF"
grep -q ": created" "$TMP/run2.log" && fail "run 2 created something"
grep -q "^created aiDemoA2a" "$TMP/run2.log" && fail "run 2 re-created SP connections"
[[ "$(started)" == "$S1" ]] || fail "PF container was restarted by run 2"
O_CLIENTS="$C_CLIENTS"; O_ATMS="$C_ATMS"; O_SPS="$C_SPS"
snapshot
[[ "$C_CLIENTS-$C_ATMS-$C_SPS" == "$O_CLIENTS-$O_ATMS-$O_SPS" ]] || fail "counts changed on run 2 ($C_CLIENTS-$C_ATMS-$C_SPS)"
echo "ok   run 2 idempotent: counts unchanged ($C_CLIENTS clients, $C_ATMS token managers, $C_SPS SPs), no re-switch, no restart"

# ---- run 3: lost secrets file. Existing clients must NOT get new secrets; the operator is told.
cp "$SECRETS" "$TMP/secrets.keep"
rm -f "$SECRETS"
run_all "$TMP/run3.log" || { cat "$TMP/run3.log"; fail "run 3 exited non-zero"; }
grep -q "cannot be recovered" "$TMP/run3.log" || fail "run 3 did not report the unrecoverable secrets"
[[ ! -s "$SECRETS" ]] || fail "run 3 wrote new secrets for existing clients"
echo "ok   run 3 (secrets file lost): warned, wrote no new secret"

# ---- no secret value in any log
for log in run1 run2 run3 ; do
  grep -qF "$PINGFEDERATE_ADMIN_PASSWORD" "$TMP/$log.log" && fail "$log.log contains the admin password"
  while IFS='=' read -r _ value; do
    [[ -n "$value" ]] && grep -qF "$value" "$TMP/$log.log" && fail "$log.log contains a client secret"
  done < "$TMP/secrets.keep"
done
echo "PASS provision-all.test.sh"
