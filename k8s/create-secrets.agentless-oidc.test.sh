#!/usr/bin/env bash
# create-secrets.agentless-oidc.test.sh — self-check for align_agentless_gateway_oidc.
#
# That function rewrites a LIVE gateway's pingone.env and restarts it, so the two
# things worth proving without a cluster are: it changes only the OIDC fields
# derived from ai-demo-secrets (SERVER_URL and OIDC_SCOPES are the gateway's own
# and must survive), and it does not restart a gateway that is already correct.
#
# Stubs kubectl on PATH and sources ONLY the function under test out of
# create-secrets.sh, so nothing else in that script runs.
#
# Usage: bash k8s/create-secrets.agentless-oidc.test.sh
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="$HERE/create-secrets.sh"
PASS=0
FAIL=0
ok()  { PASS=$((PASS+1)); echo "  ok   $1"; }
bad() { FAIL=$((FAIL+1)); echo "  FAIL $1"; }
check(){ if [[ "$2" == "$3" ]]; then ok "$1"; else bad "$1"; printf '       expected: %s\n       got:      %s\n' "$3" "$2"; fi; }
contains(){ if [[ "$2" == *"$3"* ]]; then ok "$1"; else bad "$1 (missing '$3')"; fi; }
absent(){ if [[ "$2" != *"$3"* ]]; then ok "$1"; else bad "$1 (unexpectedly contains '$3')"; fi; }

CURRENT_ENV='SERVER_URL=https://cmuir-agentless-mcpgw.ping-devops.com
OIDC_CLIENT_ID=a6219652-47af-4ed2-8dea-20e9940b3377
OIDC_CLIENT_SECRET=STALE-secret-from-before-the-rotation
OIDC_AUTH_URL=https://auth.pingone.com/OLD-ENV/as/authorize
OIDC_TOKEN_URL=https://auth.pingone.com/OLD-ENV/as/token
OIDC_USER_URL=https://auth.pingone.com/OLD-ENV/as/userinfo
OIDC_SCOPES=openid profile email p1:read:env p1:read:user p1:read:application'

setup() {
  ROOT="$(cd "$(mktemp -d)" && pwd -P)"
  mkdir -p "$ROOT/bin"
  : > "$ROOT/patched"      # what got written to the secret
  : > "$ROOT/restarted"    # whether the deployment was restarted
  export SECRET_PRESENT="${1:-yes}"
  export CID="${2:-a6219652-47af-4ed2-8dea-20e9940b3377}"
  export SEC="${3:-NEW-secret-after-the-rotation}"
  export ENVID="${4:-01d89b06-66d5-430e-9f28-65636843788b}"
  export PINGONE_ENV="${5:-$CURRENT_ENV}"
  # `${2:-default}` substitutes the default for an EMPTY argument too, so
  # passing "" could not express "this credential is missing" — the case that
  # matters most, since writing a gateway that cannot authenticate is the one
  # outcome worse than leaving it stale. Use an explicit sentinel.
  [ "$CID" = none ] && export CID=""
  [ "$SEC" = none ] && export SEC=""
  [ "$ENVID" = none ] && export ENVID=""
  export ROOT

  cat > "$ROOT/bin/kubectl" <<'STUB'
#!/usr/bin/env bash
args="$*"
case "$args" in
  *"get secret agentless-mcpgw-oidc-config"*"pingone"*)
      printf '%s' "$PINGONE_ENV" | base64 ;;
  *"get secret agentless-mcpgw-oidc-config"*)
      [ "$SECRET_PRESENT" = "yes" ] || exit 1 ;;
  *PRIVILEGE_SSO_CLIENT_ID*)     printf '%s' "$CID"   | base64 ;;
  *PRIVILEGE_SSO_CLIENT_SECRET*) printf '%s' "$SEC"   | base64 ;;
  *PRIVILEGE_SSO_ENV_ID*)        printf '%s' "$ENVID" | base64 ;;
  *"patch secret agentless-mcpgw-oidc-config"*) cat > "$ROOT/patched" ;;
  *"rollout restart"*) echo yes > "$ROOT/restarted" ;;
esac
exit 0
STUB
  chmod +x "$ROOT/bin/kubectl"
  PATH="$ROOT/bin:$PATH"

  NS=test-ns
  info() { :; }
  warn() { echo "WARN:$*" >> "$ROOT/warnings"; }
  : > "$ROOT/warnings"

  # Source ONLY the function under test.
  eval "$(awk '/^align_agentless_gateway_oidc\(\) \{/,/^\}/' "$SCRIPT")"
}

# The patched secret arrives as {"stringData":{"pingone.env":"<json string>"}}.
patched_env() {
  python3 -c 'import json,sys
raw = open(sys.argv[1]).read()
print(json.loads(raw)["stringData"]["pingone.env"] if raw.strip() else "")' "$ROOT/patched"
}

echo "align_agentless_gateway_oidc"

# ── 1. rotation reaches the gateway, and touches nothing it should not ────────
setup yes
align_agentless_gateway_oidc
OUT="$(patched_env)"
contains "rotated secret is written"        "$OUT" "OIDC_CLIENT_SECRET=NEW-secret-after-the-rotation"
absent   "stale secret is gone"             "$OUT" "STALE-secret-from-before-the-rotation"
contains "env id rewrites the authorize URL" "$OUT" "OIDC_AUTH_URL=https://auth.pingone.com/01d89b06-66d5-430e-9f28-65636843788b/as/authorize"
contains "env id rewrites the token URL"     "$OUT" "OIDC_TOKEN_URL=https://auth.pingone.com/01d89b06-66d5-430e-9f28-65636843788b/as/token"
contains "env id rewrites the userinfo URL"  "$OUT" "OIDC_USER_URL=https://auth.pingone.com/01d89b06-66d5-430e-9f28-65636843788b/as/userinfo"
# The gateway's own fields must survive — clobbering SERVER_URL breaks its callback.
contains "SERVER_URL preserved"             "$OUT" "SERVER_URL=https://cmuir-agentless-mcpgw.ping-devops.com"
contains "OIDC_SCOPES preserved"            "$OUT" "OIDC_SCOPES=openid profile email p1:read:env p1:read:user p1:read:application"
check    "gateway restarted"                "$(cat "$ROOT/restarted" 2>/dev/null)" "yes"

# ── 2. already correct: no write, no restart ─────────────────────────────────
ALREADY="$(printf '%s\n' "$CURRENT_ENV" | sed -E \
  -e "s#^OIDC_CLIENT_SECRET=.*#OIDC_CLIENT_SECRET=NEW-secret-after-the-rotation#" \
  -e "s#^OIDC_AUTH_URL=.*#OIDC_AUTH_URL=https://auth.pingone.com/01d89b06-66d5-430e-9f28-65636843788b/as/authorize#" \
  -e "s#^OIDC_TOKEN_URL=.*#OIDC_TOKEN_URL=https://auth.pingone.com/01d89b06-66d5-430e-9f28-65636843788b/as/token#" \
  -e "s#^OIDC_USER_URL=.*#OIDC_USER_URL=https://auth.pingone.com/01d89b06-66d5-430e-9f28-65636843788b/as/userinfo#")"
setup yes "a6219652-47af-4ed2-8dea-20e9940b3377" "NEW-secret-after-the-rotation" "01d89b06-66d5-430e-9f28-65636843788b" "$ALREADY"
align_agentless_gateway_oidc
check "no patch when already in sync"   "$(cat "$ROOT/patched")"    ""
check "no restart when already in sync" "$(cat "$ROOT/restarted" 2>/dev/null)" ""

# ── 3. missing credentials: warn, never write a gateway that cannot auth ──────
setup yes none none none
align_agentless_gateway_oidc
check    "no patch when PRIVILEGE_SSO_* missing" "$(cat "$ROOT/patched")" ""
contains "warns when PRIVILEGE_SSO_* missing"    "$(cat "$ROOT/warnings")" "left alone"

# ── 4. gateway not installed: silent no-op, the chart owns first install ──────
setup no
align_agentless_gateway_oidc
check "no patch when the gateway is absent"    "$(cat "$ROOT/patched")" ""
check "no warning when the gateway is absent"  "$(cat "$ROOT/warnings")" ""

echo
echo "  $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
