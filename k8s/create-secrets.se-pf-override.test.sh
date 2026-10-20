#!/usr/bin/env bash
# create-secrets.se-pf-override.test.sh — self-check for override_pf_for_se and
# the SE_OAUTH_PROVIDER pin in k8s/aws/deploy.sh.
#
# Stubs kubectl on PATH (records every secret/configmap patch body and answers
# the configmap origin lookup) and sources ONLY the function under test out of
# create-secrets.sh. No cluster needed.
#
# Usage: bash k8s/create-secrets.se-pf-override.test.sh
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="$HERE/create-secrets.sh"
DEPLOY="$HERE/aws/deploy.sh"
PASS=0
FAIL=0
ok()  { PASS=$((PASS+1)); echo "  ok   $1"; }
bad() { FAIL=$((FAIL+1)); echo "  FAIL $1"; }
check(){ if [[ "$2" == "$3" ]]; then ok "$1"; else bad "$1"; printf '       expected: %s\n       got:      %s\n' "$3" "$2"; fi; }
contains(){ if [[ "$2" == *"$3"* ]]; then ok "$1"; else bad "$1 (missing '$3')"; fi; }
absent(){ if [[ "$2" != *"$3"* ]]; then ok "$1"; else bad "$1 (unexpectedly contains '$3')"; fi; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/bin" "$TMP/assets/demo_api_server"
export PATH="$TMP/bin:$PATH"
export PATCHES="$TMP/patches" CM_ORIGIN_FILE="$TMP/cm_origin"

cat > "$TMP/bin/kubectl" <<'STUB'
#!/usr/bin/env bash
case "$*" in
  *"get configmap ai-demo-config"*) cat "$CM_ORIGIN_FILE" 2>/dev/null ;;
  *"patch secret ai-demo-secrets"*) cat >> "$PATCHES"; echo >> "$PATCHES" ;;
  *"patch configmap"*) echo "$*" >> "$PATCHES" ;;
esac
STUB
chmod +x "$TMP/bin/kubectl"

eval "$(awk '/^override_pf_for_se\(\) \{/,/^\}/' "$SCRIPT")"
info() { echo "[INFO] $1"; }
warn() { echo "[WARN] $1"; }
NS=test-ns
ASSET_ROOT="$TMP/assets"

run() {  # $1 issuer  $2 mcp url  $3 public origin  -> sets OUT (stdout), PATCH (bodies)
  : > "$PATCHES"
  CALLER_SE_PF_ISSUER="$1" CALLER_SE_OAUTH_MCP_URL="$2" CALLER_PUBLIC_APP_URL="$3"
  OUT="$(override_pf_for_se 2>&1)"
  PATCH="$(cat "$PATCHES")"
}

echo "unset SE_PF_ISSUER"
rm -f "$TMP/assets/demo_api_server/.env" "$CM_ORIGIN_FILE"
run "" "" "https://ai-demo.ping-devops.com"
check "no patch issued" "$PATCH" ""
check "no output" "$OUT" ""
run "" "https://mcp.example" "https://ai-demo.ping-devops.com"
check "SE_OAUTH_MCP_URL alone does nothing" "$PATCH" ""

echo "SE_PF_ISSUER set"
run "https://pf.se.example:9031/" "" "https://ai-demo.ping-devops.com/"
I="https://pf.se.example:9031"
contains "PF_ISSUER"                 "$PATCH" "\"PF_ISSUER\":\"$I\""
contains "PF_DISCOVERY_ENDPOINT"     "$PATCH" "\"PF_DISCOVERY_ENDPOINT\":\"$I/.well-known/openid-configuration\""
contains "PF_AUTHORIZATION_ENDPOINT" "$PATCH" "\"PF_AUTHORIZATION_ENDPOINT\":\"$I/as/authorization.oauth2\""
contains "PF_TOKEN_ENDPOINT"         "$PATCH" "\"PF_TOKEN_ENDPOINT\":\"$I/as/token.oauth2\""
contains "PF_USERINFO_ENDPOINT"      "$PATCH" "\"PF_USERINFO_ENDPOINT\":\"$I/idp/userinfo.openid\""
contains "PF_JWKS_URI"               "$PATCH" "\"PF_JWKS_URI\":\"$I/pf/JWKS\""
contains "PF_INTROSPECTION_ENDPOINT" "$PATCH" "\"PF_INTROSPECTION_ENDPOINT\":\"$I/as/introspect.oauth2\""
contains "PF_REVOCATION_ENDPOINT"    "$PATCH" "\"PF_REVOCATION_ENDPOINT\":\"$I/as/revoke_token.oauth2\""
contains "PF_PAR_ENDPOINT"           "$PATCH" "\"PF_PAR_ENDPOINT\":\"$I/as/par.oauth2\""
contains "PF_USER_REDIRECT_URI"      "$PATCH" "\"PF_USER_REDIRECT_URI\":\"https://ai-demo.ping-devops.com/api/auth/oauth/user/callback\""
absent   "no ID-JAG keys without SE_OAUTH_MCP_URL" "$PATCH" "PF_ID_JAG"
absent   "never touches PF_IDJAG_ISSUER_PF_URL" "$PATCH" "PF_IDJAG_ISSUER_PF_URL"
check    "valid JSON" "$(printf '%s' "$PATCH" | python3 -c 'import json,sys; json.load(sys.stdin); print("ok")')" "ok"
contains "logs the issuer" "$OUT" "$I"
absent   "no warning" "$OUT" "[WARN]"

echo "SE_OAUTH_MCP_URL set"
run "$I" "https://mcp.se.example/" "https://ai-demo.ping-devops.com"
contains "PF_ID_JAG_AUDIENCE" "$PATCH" "\"PF_ID_JAG_AUDIENCE\":\"https://mcp.se.example\""
contains "PF_ID_JAG_RESOURCE" "$PATCH" "\"PF_ID_JAG_RESOURCE\":\"https://mcp.se.example/mcp\""

echo "values read from demo_api_server/.env"
printf 'FOO=bar\nSE_PF_ISSUER="https://pf.env.example"\nSE_OAUTH_MCP_URL=https://mcp.env.example\n' > "$TMP/assets/demo_api_server/.env"
run "" "" "https://ai-demo.ping-devops.com"
contains "issuer read from .env" "$PATCH" "\"PF_ISSUER\":\"https://pf.env.example\""
contains "mcp url read from .env" "$PATCH" "\"PF_ID_JAG_RESOURCE\":\"https://mcp.env.example/mcp\""
rm -f "$TMP/assets/demo_api_server/.env"

echo "origin from configmap fallback"
echo "https://cm.example" > "$CM_ORIGIN_FILE"
run "$I" "" ""
contains "redirect uses configmap origin" "$PATCH" "\"PF_USER_REDIRECT_URI\":\"https://cm.example/api/auth/oauth/user/callback\""
contains "warns about fallback" "$OUT" "falling back to existing configmap origin"

echo "no origin known"
rm -f "$CM_ORIGIN_FILE"
run "$I" "" ""
contains "warns" "$OUT" "[WARN]"
contains "still patches PF_ISSUER" "$PATCH" "\"PF_ISSUER\":\"$I\""
absent   "skips PF_USER_REDIRECT_URI only" "$PATCH" "PF_USER_REDIRECT_URI"

echo "deploy.sh OAUTH_PROVIDER pin"
# Extract the configmap patch command (command line + its continuation line).
awk '/kubectl patch configmap ai-demo-config -n "\$NS" --type merge -p/ {print; getline; print; exit}' "$DEPLOY" > "$TMP/pin.sh"
check "pin snippet extracted (2 lines)" "$(wc -l < "$TMP/pin.sh" | tr -d ' ')" "2"
render() { : > "$PATCHES"; ( NS=test-ns; HOSTED_ACCESS_REQUIRED_GROUP_ID=""; . "$TMP/pin.sh" ); cat "$PATCHES"; }
unset SE_OAUTH_PROVIDER
contains "default pins pingone" "$(render)" '"OAUTH_PROVIDER":"pingone"'
SE_OAUTH_PROVIDER=""; export SE_OAUTH_PROVIDER
contains "empty SE_OAUTH_PROVIDER un-pins" "$(render)" '"OAUTH_PROVIDER":""'
SE_OAUTH_PROVIDER=pingfederate
contains "explicit value is honoured" "$(render)" '"OAUTH_PROVIDER":"pingfederate"'
unset SE_OAUTH_PROVIDER
contains "rest of the patch intact" "$(render)" '"HOSTED_ACCESS_GATE_ENABLED":"true"'

echo
echo "RESULT pass=$PASS fail=$FAIL"
[ "$FAIL" -eq 0 ]
