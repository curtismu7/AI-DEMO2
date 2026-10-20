#!/usr/bin/env bash
# se-pf-overrides.test.sh -- self-check for scripts/se-pf-overrides.sh using stubbed kubectl and curl.
# Usage: bash scripts/se-pf-overrides.test.sh
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="$HERE/se-pf-overrides.sh"
PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); echo "  ok   $1"; }
bad() { FAIL=$((FAIL+1)); echo "  FAIL $1"; }
check(){ if [[ "$2" == "$3" ]]; then ok "$1"; else bad "$1"; printf '       expected: [%s]\n       got:      [%s]\n' "$3" "$2"; fi; }

TMP="$(mktemp -d)"
trap 'rm -rf "${TMP:?}"' EXIT
BIN="$TMP/bin"; mkdir -p "$BIN"
export STUB_LOG="$TMP/calls.log" STUB_PATCHES="$TMP/patches"

cat > "$BIN/curl" <<'STUB'
#!/usr/bin/env bash
out=""; while [ $# -gt 0 ]; do case "$1" in -o) out="$2"; shift ;; esac; shift; done
cp "$STUB_DISCOVERY" "$out"
STUB
cat > "$BIN/kubectl" <<'STUB'
#!/usr/bin/env bash
echo "kubectl $*" >> "$STUB_LOG"
case "$1" in
  get) printf '%s' "${STUB_CM_PUBLIC_APP_URL:-}" ;;
  patch)
    pf=""; kind="$2"
    while [ $# -gt 0 ]; do [ "$1" = "--patch-file" ] && pf="$2"; shift; done
    cp "$pf" "$STUB_PATCHES/$kind.json" ;;
esac
exit 0
STUB
chmod +x "$BIN/curl" "$BIN/kubectl"

good='{"issuer":"https://cmuir-pf.ping-devops.com","authorization_endpoint":"https://cmuir-pf.ping-devops.com/as/authorization.oauth2","token_endpoint":"https://cmuir-pf.ping-devops.com/as/token.oauth2","userinfo_endpoint":"https://cmuir-pf.ping-devops.com/idp/userinfo.openid","jwks_uri":"https://cmuir-pf.ping-devops.com/pf/JWKS","introspection_endpoint":"https://cmuir-pf.ping-devops.com/as/introspect.oauth2","revocation_endpoint":"https://cmuir-pf.ping-devops.com/as/revoke_token.oauth2","pushed_authorization_request_endpoint":"https://cmuir-pf.ping-devops.com/as/par.oauth2"}'
echo "$good" > "$TMP/good.json"
node -e 'const d=JSON.parse(process.argv[1]);d.issuer="https://other.example.com";console.log(JSON.stringify(d))' "$good" > "$TMP/badissuer.json"
node -e 'const d=JSON.parse(process.argv[1]);delete d.revocation_endpoint;console.log(JSON.stringify(d))' "$good" > "$TMP/missing.json"

run() { # run <stdin> <args...>; sets RC, resets recorded calls
  local input="$1"; shift
  rm -rf "${STUB_PATCHES:?}"; mkdir -p "$STUB_PATCHES"; : > "$STUB_LOG"
  printf '%s' "$input" | PATH="$BIN:$PATH" bash "$SCRIPT" "$@" >"$TMP/out" 2>"$TMP/err"
  RC=$?
}
export STUB_DISCOVERY="$TMP/good.json"
unset PUBLIC_APP_URL STUB_CM_PUBLIC_APP_URL

echo "plan mode"
PUBLIC_APP_URL=https://app.example.com run ""
check "exit 0" "$RC" "0"
check "no patch, no restart" "$(grep -c 'patch\|rollout' "$STUB_LOG")" "0"
grep -q 'PF_TOKEN_ENDPOINT = https://cmuir-pf' "$TMP/out" && ok "prints keys and URLs" || bad "prints keys and URLs"

echo "--apply"
export PUBLIC_APP_URL=https://app.example.com/
run "yes
" --apply
check "exit 0" "$RC" "0"
got="$(node -e 'const p=require(process.argv[1]).stringData;console.log(Object.keys(p).length, p.PF_ISSUER, p.PF_DISCOVERY_ENDPOINT, p.PF_PAR_ENDPOINT, p.PF_USER_REDIRECT_URI, p.PF_ID_JAG_AUDIENCE, p.PF_ID_JAG_RESOURCE, "PF_IDJAG_ISSUER_PF_URL" in p)' "$STUB_PATCHES/secret.json")"
check "secret patch keys and values" "$got" "12 https://cmuir-pf.ping-devops.com https://cmuir-pf.ping-devops.com/.well-known/openid-configuration https://cmuir-pf.ping-devops.com/as/par.oauth2 https://app.example.com/api/auth/oauth/user/callback https://cmuir-mcp.ping-devops.com https://cmuir-mcp.ping-devops.com/mcp false"
check "ConfigMap untouched without --unpin" "$(ls "$STUB_PATCHES" | tr '\n' ' ')" "secret.json "
grep -q 'patch secret ai-demo-secrets -n ping-devops-cmuir --type merge --patch-file' "$STUB_LOG" && ok "default namespace and merge patch" || bad "default namespace and merge patch"
grep -q 'rollout restart deployment/demo-api-server' "$STUB_LOG" && grep -q 'rollout status' "$STUB_LOG" && ok "restart and status" || bad "restart and status"
grep -q 'cmuir-pf' "$STUB_LOG" && bad "values leaked onto kubectl command line" || ok "no values on command line"

echo "--apply, answer not yes"
run "no
" --apply
check "no patch" "$(grep -c patch "$STUB_LOG")" "0"

echo "--unpin"
run "yes
" --apply --unpin
check "configmap patched" "$(cat "$STUB_PATCHES/configmap.json")" '{"data":{"OAUTH_PROVIDER":""}}'

echo "failures"
STUB_DISCOVERY="$TMP/badissuer.json" run "yes
" --apply
check "issuer mismatch aborts" "$RC:$(grep -c patch "$STUB_LOG")" "1:0"
grep -q 'issuer' "$TMP/err" && ok "issuer error message" || bad "issuer error message"
STUB_DISCOVERY="$TMP/missing.json" run "yes
" --apply
check "missing endpoint aborts" "$RC:$(grep -c patch "$STUB_LOG")" "1:0"
grep -q 'PF_REVOCATION_ENDPOINT' "$TMP/err" && ok "names missing key" || bad "names missing key"
unset PUBLIC_APP_URL
run "yes
" --apply
check "missing PUBLIC_APP_URL fails" "$RC:$(grep -c patch "$STUB_LOG")" "1:0"
grep -q 'PUBLIC_APP_URL' "$TMP/err" && ok "clear message" || bad "clear message"
STUB_CM_PUBLIC_APP_URL=https://cm.example.com run "yes
" --apply
check "falls back to ConfigMap PUBLIC_APP_URL" "$(node -e 'console.log(require(process.argv[1]).stringData.PF_USER_REDIRECT_URI)' "$STUB_PATCHES/secret.json")" "https://cm.example.com/api/auth/oauth/user/callback"

echo
echo "passed=$PASS failed=$FAIL"
[ "$FAIL" = 0 ]
