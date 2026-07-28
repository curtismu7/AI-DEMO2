#!/usr/bin/env bash
# =============================================================================
# rebuild-pingone.sh — Fully rebuild PingOne apps inside an existing environment
#
# Usage:
#   bash scripts/rebuild-pingone.sh
#
# What it does:
#   1. Loads/prompts for required PingOne management credentials
#   2. Obtains a management API access token via client_credentials
#   3. Deletes all "Demo AI App - *" applications (and legacy "Demo *" names)
#   4. Deletes target resource servers (Demo API, Demo MCP Server, etc.)
#   5. Runs bootstrapPingOne.js --non-interactive to reprovision everything
#   6. Reminds you to restart services after the new .env is written
#
# The PINGONE_ENVIRONMENT_ID is never changed — apps are rebuilt inside the
# existing environment, not moved to a new one.
#
# Env vars (all can also be exported before running):
#   PINGONE_ENVIRONMENT_ID       required
#   PINGONE_REGION               default: com
#   PINGONE_WORKER_CLIENT_ID     required
#   PINGONE_WORKER_CLIENT_SECRET required
#   PUBLIC_APP_URL               default: https://ai-demo.ping-devops.com
#   DEMO_PASSWORD                default: Baseball123!
# =============================================================================
set -euo pipefail

# ── Helpers ───────────────────────────────────────────────────────────────────

log()  { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
ok()   { printf '\033[1;32m✅ %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m⚠️  %s\033[0m\n' "$*"; }
err()  { printf '\033[1;31m❌ %s\033[0m\n' "$*" >&2; }

prompt_if_missing() {
  local var_name="$1"
  local prompt_text="$2"
  local is_secret="${3:-false}"
  if [[ -z "${!var_name:-}" ]]; then
    if [[ "$is_secret" == "true" ]]; then
      read -rsp "  ${prompt_text}: " "${var_name}"
      echo
    else
      read -rp  "  ${prompt_text}: " "${var_name}"
    fi
    export "${var_name?}"
  fi
}

# ── 1. Load / prompt for credentials ─────────────────────────────────────────

log "PingOne credentials"

prompt_if_missing PINGONE_ENVIRONMENT_ID     "Environment ID (UUID)"
prompt_if_missing PINGONE_WORKER_CLIENT_ID   "Worker Client ID"
prompt_if_missing PINGONE_WORKER_CLIENT_SECRET "Worker Client Secret" true

# Defaults
PINGONE_REGION="${PINGONE_REGION:-com}"
PUBLIC_APP_URL="${PUBLIC_APP_URL:-https://ai-demo.ping-devops.com}"
DEMO_PASSWORD="${DEMO_PASSWORD:-Baseball123!}"

echo "  Environment : ${PINGONE_ENVIRONMENT_ID}"
echo "  Region      : ${PINGONE_REGION}"
echo "  Worker ID   : ${PINGONE_WORKER_CLIENT_ID}"
echo "  App URL     : ${PUBLIC_APP_URL}"

# ── 2. Obtain management access token ────────────────────────────────────────

log "Obtaining management access token"

AUTH_URL="https://auth.pingone.${PINGONE_REGION}/${PINGONE_ENVIRONMENT_ID}/as/token"

TOKEN_RESPONSE=$(curl -sf \
  --request POST "${AUTH_URL}" \
  --user "${PINGONE_WORKER_CLIENT_ID}:${PINGONE_WORKER_CLIENT_SECRET}" \
  --header "Content-Type: application/x-www-form-urlencoded" \
  --data "grant_type=client_credentials") || {
    err "Failed to obtain token from ${AUTH_URL}"
    err "Check PINGONE_WORKER_CLIENT_ID / PINGONE_WORKER_CLIENT_SECRET and region."
    exit 1
  }

MGMT_TOKEN=$(printf '%s' "$TOKEN_RESPONSE" | grep -o '"access_token":"[^"]*"' | cut -d'"' -f4)

if [[ -z "$MGMT_TOKEN" ]]; then
  err "Token response did not contain access_token: ${TOKEN_RESPONSE}"
  exit 1
fi

ok "Management token obtained"

# ── PingOne API base ──────────────────────────────────────────────────────────

API_BASE="https://api.pingone.${PINGONE_REGION}/v1/environments/${PINGONE_ENVIRONMENT_ID}"

ping_get() {
  # Usage: ping_get <path>   — returns raw JSON, exits on curl error
  curl -sf \
    --header "Authorization: Bearer ${MGMT_TOKEN}" \
    --header "Content-Type: application/json" \
    "${API_BASE}${1}"
}

ping_delete() {
  # Usage: ping_delete <path>   — 204 or 404 both treated as success
  local status
  status=$(curl -s -o /dev/null -w "%{http_code}" \
    --request DELETE \
    --header "Authorization: Bearer ${MGMT_TOKEN}" \
    "${API_BASE}${1}")
  # 204 = deleted, 404 = already gone — both are fine
  if [[ "$status" != "204" && "$status" != "404" ]]; then
    warn "DELETE ${1} returned HTTP ${status} (continuing)"
  fi
}

# ── 3. Delete matching applications ──────────────────────────────────────────

log "Wiping applications"

# Name prefixes to delete (matches "Demo AI App - *", legacy "Demo *", and the
# A2A specialist app provisioned before the Demo rename)
APP_PREFIXES=("Demo AI App -" "Demo Admin App" "Demo User App" "Demo MCP" "Demo Agent" "Demo Worker" "Demo " "Super Banking Holdings Specialist Agent")

APPS_JSON=$(ping_get "/applications?limit=100") || {
  err "Failed to list applications"
  exit 1
}

# Extract id and name pairs — one per line as "id|name"
APP_PAIRS=$(printf '%s' "$APPS_JSON" \
  | grep -o '"id":"[^"]*"\|"name":"[^"]*"' \
  | paste - - \
  | sed 's/"id":"//;s/"",/"|/;s/"name":"//;s/"//')

deleted_apps=0
while IFS='|' read -r app_id app_name; do
  [[ -z "$app_id" || -z "$app_name" ]] && continue
  for prefix in "${APP_PREFIXES[@]}"; do
    if [[ "$app_name" == ${prefix}* ]]; then
      printf '  Deleting app: %s (%s)\n' "$app_name" "$app_id"
      ping_delete "/applications/${app_id}"
      (( deleted_apps++ )) || true
      break
    fi
  done
done <<< "$APP_PAIRS"

if [[ $deleted_apps -eq 0 ]]; then
  echo "  No matching apps found — nothing to delete"
else
  ok "Deleted ${deleted_apps} application(s)"
fi

# ── 4. Delete matching resource servers ──────────────────────────────────────

log "Wiping resource servers"

# Exact names bootstrap creates (see scope-topology.json provisioning.resourceNames;
# the A2A resources are self-mapped and keep their "Super Banking" names live)
RESOURCE_NAMES=("Demo API" "Demo MCP Server" "Demo MCP Gateway" "Demo Agent Gateway"
  "Demo MCP Invest" "Demo MCP JWT Verifier" "Demo PingGateway MCP" "Demo A2A Intermediate"
  "Super Banking A2A Intermediate - Investment Advisor"
  "Super Banking A2A Intermediate - Records Specialist"
  "Super Banking A2A Intermediate - Purchase History Specialist"
  "Super Banking A2A Intermediate - Membership Specialist"
  "Super Banking A2A Intermediate - Payroll Specialist"
  "Super Banking A2A Intermediate - Tax Records Specialist"
  "Super Banking A2A Intermediate - Financial Aid Specialist"
  "Super Banking A2A Intermediate - Supplier Contract Specialist"
  "Super Banking A2A Intermediate - Holdings Specialist"
  "Super Banking A2A MCP Gateway")

RESOURCES_JSON=$(ping_get "/resources?limit=100") || {
  err "Failed to list resource servers"
  exit 1
}

RESOURCE_PAIRS=$(printf '%s' "$RESOURCES_JSON" \
  | grep -o '"id":"[^"]*"\|"name":"[^"]*"' \
  | paste - - \
  | sed 's/"id":"//;s/"",/"|/;s/"name":"//;s/"//')

deleted_resources=0
while IFS='|' read -r res_id res_name; do
  [[ -z "$res_id" || -z "$res_name" ]] && continue
  for target in "${RESOURCE_NAMES[@]}"; do
    if [[ "$res_name" == "$target" ]]; then
      printf '  Deleting resource: %s (%s)\n' "$res_name" "$res_id"
      ping_delete "/resources/${res_id}"
      (( deleted_resources++ )) || true
      break
    fi
  done
done <<< "$RESOURCE_PAIRS"

if [[ $deleted_resources -eq 0 ]]; then
  echo "  No matching resource servers found — nothing to delete"
else
  ok "Deleted ${deleted_resources} resource server(s)"
fi

# ── 5. Run bootstrap ──────────────────────────────────────────────────────────

log "Running bootstrapPingOne.js --non-interactive"

# Locate repo root relative to this script so it works from any cwd
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
BOOTSTRAP="${REPO_ROOT}/demo_api_server/scripts/bootstrapPingOne.js"

if [[ ! -f "$BOOTSTRAP" ]]; then
  err "Bootstrap script not found at: ${BOOTSTRAP}"
  exit 1
fi

# Bootstrap reads these specific env var names
export PINGONE_BOOTSTRAP_ENV_ID="$PINGONE_ENVIRONMENT_ID"
export PINGONE_BOOTSTRAP_REGION="$PINGONE_REGION"
export PINGONE_BOOTSTRAP_CLIENT_ID="$PINGONE_WORKER_CLIENT_ID"
export PINGONE_BOOTSTRAP_CLIENT_SECRET="$PINGONE_WORKER_CLIENT_SECRET"
export PUBLIC_APP_URL="$PUBLIC_APP_URL"
export DEMO_PASSWORD="$DEMO_PASSWORD"

cd "${REPO_ROOT}/demo_api_server"
if ! node scripts/bootstrapPingOne.js --non-interactive; then
  err "Bootstrap failed — see output above"
  exit 1
fi

# ── 6. Summary ────────────────────────────────────────────────────────────────

printf '\n'
ok ".env updated with new credentials — restart all services for changes to take effect"
printf '\n'
printf '  Services to restart:\n'
printf '    demo_api_server   (e.g. npm start, or docker compose restart api)\n'
printf '    demo_api_ui       (e.g. npm start)\n'
printf '    Any MCP/gateway services that read .env\n'
printf '\n'
printf '  Updated .env is at: %s/demo_api_server/.env\n' "${REPO_ROOT}"
printf '\n'
