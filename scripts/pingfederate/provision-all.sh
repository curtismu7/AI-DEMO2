#!/usr/bin/env bash
# provision-all.sh — rebuild the demo's PingFederate configuration on a fresh PF volume, one command:
#
#   PINGFEDERATE_ADMIN_PASSWORD=... bash scripts/pingfederate/provision-all.sh
#
# Dependency order (from each script's header; every step needs the ones above it):
#   1. JDBC client storage   service-points.conf client.manager=...ClientManagerJdbcImpl + restart.
#                            PF does not migrate clients between storage types, so this MUST precede every
#                            client below (a fresh volume is file-based; CIMD needs JDBC). Inline here.
#   2. provision-core.js     base URL, signing key, the 3 JWT token managers, access-token subject processor,
#                            aiDemoStandardTePolicy + one ATM mapping per manager, the 4 role clients
#                            (needs the ATMs and the policy), the introspection client. No PingOne, no vault.
#   3. provision-a2a-sp-connections.sh        12 A2A SP connections; needs aiDemoStandardTePolicy (step 2)
#                            and a signing key. The tenant claim is the PingOne environment id
#                            (PINGONE_ENVIRONMENT_ID; a placeholder is used when unset).
#   4. provision-a2a-specialist-pf-clients.sh 11 specialist clients; needs the ATM (step 2) and PingOne-issued
#                            client ids/secrets from an env file (PF_A2A_ENV_FILE) -> optional.
#   Optional, vault / BFF .env based (the repo's own flows; off by default, set the switch to run):
#   5. PF_USE_VAULT=1          provision-introspection-client.js  (secret into the vault instead of PF_SECRETS_FILE)
#   6. PF_STEP9=1              provision-pf-step9.sh  (python; needs the PF MCP actor client from step 2 and
#                              demo_api_server/.env; adds the Banking API Step 9 policy and mapping)
#   7. PF_AI_AGENT_FEATURES=1  provision-ai-agent-features.js  (CIMD + RAR; needs the vault, the RAR plugin JAR in
#                              PF's deploy dir, and a BFF reachable for the lookup)
#   Optional, PingOne (needs a PingOne environment: PINGONE_BOOTSTRAP_ENV_ID/_CLIENT_ID/_CLIENT_SECRET plus
#   P1_POPULATION_ID, P1_APPLICATION_ID, PF_USER_CLIENT_ID; skipped with a notice otherwise):
#   8. create-pingone-connection.js -> create-pingone-mfa-adapter.js -> enable-pf-mfa-step-up.js
#      (the adapter needs the connection; the step-up policy needs the adapter), then
#      provision-pf-pingone-user-gate.sh (needs aiDemoStandardTePolicy) and enable-pi-flow-user-client.js
#      (needs the BFF's end-user client PF_USER_CLIENT_ID).
#   Not run: provision-readiness-lane.js (readiness lane user/redirect; needs the user client and vault) and the
#   list-*.js helpers.
#
# Target: PF_BASE (default https://local.ping-devops.com:9999/pf-admin-api/v1), container
# PINGFEDERATE_CONTAINER_NAME (default ai-demo-pingfederate). Admin password from PINGFEDERATE_ADMIN_PASSWORD,
# else read from the container's environment; never printed. Client secrets: <ROLE>_CLIENT_SECRET env, else
# PF_SECRETS_FILE (default scripts/pingfederate/.pf-client-secrets.env, gitignored, mode 600), generated once.
# Exit 0 iff the admin API lists the expected clients and token managers (checked by provision-core.js).
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
export PF_BASE="${PF_BASE:-https://local.ping-devops.com:9999/pf-admin-api/v1}"
export PF_ADMIN_BASE="$PF_BASE" PF_API_BASE="$PF_BASE"
CONTAINER="${PINGFEDERATE_CONTAINER_NAME:-ai-demo-pingfederate}"
CONF=/opt/out/instance/server/default/conf/service-points.conf

if [[ -z "${PINGFEDERATE_ADMIN_PASSWORD:-}" ]]; then
  PINGFEDERATE_ADMIN_PASSWORD="$(docker exec "$CONTAINER" sh -c 'printf %s "$PING_IDENTITY_PASSWORD"')"
fi
export PINGFEDERATE_ADMIN_PASSWORD

wait_admin() {
  local code
  for _ in $(seq 1 60); do
    code="$(curl -sk -u "administrator:${PINGFEDERATE_ADMIN_PASSWORD}" -H 'X-XSRF-Header: x' -o /dev/null -w '%{http_code}' "$PF_BASE/oauth/clients" || true)"
    [[ "$code" == "200" ]] && return 0
    sleep 5
  done
  echo "[provision-all] FAIL: PF admin API at $PF_BASE not ready (last HTTP $code)"; return 1
}

echo "[provision-all] 1/4 JDBC client storage"
wait_admin
if docker exec "$CONTAINER" grep -q '^client\.manager=.*ClientManagerJdbcImpl' "$CONF"; then
  echo "[provision-all] already on JDBC: no-op"
else
  # the file has CRLF endings: match the line start only, never anchor the end with $
  docker exec "$CONTAINER" sed -i '/^client\.manager=/s/ClientManagerXmlFileImpl/ClientManagerJdbcImpl/' "$CONF"
  docker exec "$CONTAINER" grep -q '^client\.manager=.*ClientManagerJdbcImpl' "$CONF" \
    || { echo "[provision-all] FAIL: client.manager is not ClientManagerJdbcImpl after the edit"; exit 1; }
  docker restart "$CONTAINER" >/dev/null
  sleep 10
  wait_admin
  echo "[provision-all] switched to JDBC and restarted"
fi

echo "[provision-all] 2/4 core objects"
core_args=()
[[ "${PF_USE_VAULT:-}" == "1" ]] && core_args+=(--no-introspection)
node "$HERE/provision-core.js" ${core_args[@]+"${core_args[@]}"}

echo "[provision-all] 3/4 A2A SP connections"
PINGONE_ENVIRONMENT_ID="${PINGONE_ENVIRONMENT_ID:-pf-edition-no-pingone-environment}" bash "$HERE/provision-a2a-sp-connections.sh"
if [[ -n "${PF_A2A_ENV_FILE:-}" && -f "$PF_A2A_ENV_FILE" ]]; then
  ENV_FILE="$PF_A2A_ENV_FILE" bash "$HERE/provision-a2a-specialist-pf-clients.sh"
else
  echo "[provision-all] SKIP A2A specialist clients: set PF_A2A_ENV_FILE to an env file with PINGONE_A2A_<V>_AGENT_CLIENT_ID/_SECRET"
fi

echo "[provision-all] 4/4 optional steps"
if [[ "${PF_USE_VAULT:-}" == "1" ]]; then node "$HERE/provision-introspection-client.js" --apply; else echo "[provision-all] SKIP vault introspection script (PF_USE_VAULT!=1); core made the client"; fi
if [[ "${PF_STEP9:-}" == "1" ]]; then python3 "$HERE/provision-pf-step9.sh" --apply; else echo "[provision-all] SKIP Step 9 (PF_STEP9!=1)"; fi
if [[ "${PF_AI_AGENT_FEATURES:-}" == "1" ]]; then node "$HERE/provision-ai-agent-features.js" --apply; else echo "[provision-all] SKIP CIMD/RAR (PF_AI_AGENT_FEATURES!=1)"; fi

p1_missing=()
for v in PINGONE_BOOTSTRAP_ENV_ID PINGONE_BOOTSTRAP_CLIENT_ID PINGONE_BOOTSTRAP_CLIENT_SECRET P1_POPULATION_ID P1_APPLICATION_ID PF_USER_CLIENT_ID; do
  [[ -n "${!v:-}" ]] || p1_missing+=("$v")
done
if [[ ${#p1_missing[@]} -eq 0 ]]; then
  node "$HERE/create-pingone-connection.js" --apply
  node "$HERE/create-pingone-mfa-adapter.js" --apply
  node "$HERE/enable-pf-mfa-step-up.js" --apply
  python3 "$HERE/provision-pf-pingone-user-gate.sh" --apply
  node "$HERE/enable-pi-flow-user-client.js" --apply
else
  echo "[provision-all] SKIP PingOne steps (connection, MFA adapter, step-up, user gate, pi.flow client): unset ${p1_missing[*]}"
fi
echo "[provision-all] done"
