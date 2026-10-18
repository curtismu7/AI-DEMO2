#!/usr/bin/env bash
# apply-login-theme.test.sh: the sign-on template keeps everything PingFederate needs, and the apply
# script themes a template dir idempotently. No PF or cluster: kubectl is a shim that runs the
# script's in-pod shell snippets against a temp dir.  Run: bash scripts/pingfederate/apply-login-theme.test.sh
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
fail() { echo "FAIL: $*" >&2; exit 1; }

# 1. Every Velocity variable, id and field name of PF 13.1.3's stock html.form.login.template.html.
tplsrc="$HERE/assets/html.form.login.template.html"
for ref in '$CSPNonce' '$CurrentPingFedBaseURL' '$HttpServletRequest' '$adapterId' '$adapterIdField' \
  '$altAuthSources' '$authenticatorEnabled' '$authenticatorScriptNames' '$authnMessageKey' '$cancel' \
  '$captchaAttributes' '$captchaEnabled' '$captchaScriptName' '$changePasswordUrl' \
  '$clientSideAuthenticatorAttributes' '$enableRememberUsername' '$errorMessageKey' \
  '$isChainedUsernameAvailable' '$locale' '$loginFailed' '$messageKeyPrefix' '$myDevice' '$myDeviceChecked' \
  '$ok' '$pass' '$passwordReset' '$registrationEnabled' '$registrationValue' '$rememberUsername' \
  '$rememberUsernameChecked' '$rememberUsernameCookieExists' '$showMyDeviceCheckbox' '$supportsPasswordChange' \
  '$supportsPasswordReset' '$supportsUsernameRecovery' '$templateMessages' '$url' '$username' \
  '$usernameEditable' '$usernameRecovery' \
  'name="$name"' 'name="$pass"' 'name="$ok"' 'name="$cancel"' 'name="$adapterIdField"' 'name="$rememberUsername"' \
  'name="$myDevice"' 'name="$passwordReset"' 'name="$usernameRecovery"' 'name="$registrationValue"' \
  'id="username"' 'id="password"' 'id="signOnButton"' 'id="signOnButtonSpan"' 'id="reveal"' 'id="username-text"' \
  'id="password-text"' 'id="forgotPasswordLink"' 'id="recoverUsernameLink"' 'id="registrationLink"' \
  'id="rememberUsername"' 'id="myDevice"' 'id="captchaEnabled"' 'id="authenticatorField"' \
  'action="$url"' '#parse("alt-authn-source.template.html")' "nonce=\"\$CSPNonce\"" 'assets/css/main.css' \
  "registerEventHandler('signOnButton', 'click', postOk)" "document.forms[0]['\$ok'].value = 'clicked'"; do
  grep -qF -- "$ref" "$tplsrc" || fail "login template lost: $ref"
done
grep -q 'for="username"' "$tplsrc" && grep -q 'for="password"' "$tplsrc" || fail "login labels are not <label for>"
grep -q '^/\* ai-demo-theme:start' "$HERE/assets/login-theme.css" || fail "login-theme.css must start with the marker"

# 2. The apply script, through a kubectl shim, against a fake template dir.
root="$TMP/out/instance/server/default/conf/template"
mkdir -p "$root/assets/css" "$root/assets/images" "$root/assets/fonts" "$TMP/bin"
printf 'body { color: stock; }\n/* Demo login theme for PingFederate (pre-2026 block) */\nbody::before { content: "old"; }\n' > "$root/assets/css/main.css"
printf '.stock-mfa {}\n' > "$root/assets/css/pingone-mfa.css"
cat > "$TMP/bin/kubectl" <<EOF
#!/bin/sh
# kubectl -n NS exec -i POD -- sh -c SNIPPET: run SNIPPET locally with /opt/out mapped into the temp dir.
echo "kubectl \$*" | head -c 60 >> "$TMP/calls.log"; echo >> "$TMP/calls.log"
while [ "\$1" != "-c" ]; do shift; done
exec sh -c "\$(printf '%s' "\$2" | sed "s|/opt/out|$TMP/out|g")"
EOF
chmod +x "$TMP/bin/kubectl"
apply() { PATH="$TMP/bin:$PATH" bash "$HERE/apply-login-theme.sh" "$@" >/dev/null; }

apply --k8s test-ns
apply --k8s test-ns
css="$root/assets/css/main.css"
[[ "$(grep -c 'ai-demo-theme:start' "$css")" == 1 ]] || fail "re-run must leave exactly one theme block"
grep -q 'color: stock' "$css" || fail "stock main.css rules were dropped"
grep -q 'content: "old"' "$css" && fail "the pre-2026 theme block was not removed"
grep -q 'ping-identity-logo.png' "$css" || fail "ping theme tokens missing"
grep -q 'Sign in to Ping Identity AI demo' "$root/html.form.login.template.html" || fail "ping title not filled in"
grep -q '@@' "$root/html.form.login.template.html" && fail "unfilled placeholder in the login template"
[[ -s "$root/assets/images/ping-identity-logo.png" && -s "$root/assets/fonts/ai-demo-montserrat-latin.woff2" ]] || fail "ping logo/font not copied"
[[ "$(grep -c 'ai-demo-mfa-theme.css' "$root/assets/css/pingone-mfa.css")" == 1 ]] || fail "MFA import must be added exactly once"
grep -q 'kubectl -n test-ns exec -i pingfederate-0' "$TMP/calls.log" || fail "k8s mode must exec in pingfederate-0 of the namespace"

apply --k8s test-ns --theme acme
[[ "$(grep -c 'ai-demo-theme:start' "$css")" == 1 ]] || fail "theme switch must leave exactly one theme block"
grep -q 'ping-identity-logo.png\|Montserrat' "$css" && fail "acme theme still carries Ping's logo or font"
grep -q 'content: "Acme Corp' "$css" || fail "acme tokens missing"
grep -q 'Sign in to Acme Corp' "$root/html.form.login.template.html" || fail "acme title not filled in"
[[ -s "$root/assets/images/acme-mark.svg" ]] || fail "acme mark not copied"

PATH="$TMP/bin:$PATH" bash "$HERE/apply-login-theme.sh" --k8s test-ns --theme nope >/dev/null 2>&1 && fail "unknown theme must fail"
echo "apply-login-theme.test.sh: ok"
