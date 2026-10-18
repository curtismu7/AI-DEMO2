#!/usr/bin/env bash
# Applies the demo sign-on theme to a running PingFederate's template directory:
#   - appends assets/login-theme.css + login-theme-<theme>.css to PF's stock assets/css/main.css
#     (cut at the "ai-demo-theme:start" marker first), so every PF page is branded;
#   - installs our html.form.login.template.html (stock 13.1.3 markup + title, product line,
#     real labels) with the theme's title and product line filled in;
#   - copies the logo (ping) or mark (acme) and the font the theme uses.
# PF reads templates per request, so no restart is needed. Re-running is safe. Run it again after
# a fresh PF volume or a PF upgrade: both put the stock main.css back (that is how the theme was
# lost before; run-docker.sh and ensure-se-pingfederate.sh now call this on every run).
#
# Usage:
#   ./apply-login-theme.sh [--theme ping|acme] [container]       local Docker (default ai-demo-pingfederate)
#   ./apply-login-theme.sh --k8s <namespace> [--theme ping|acme]  cluster, pod pingfederate-0
# Themes: ping = our PingFederate (default); acme = the "Acme Corp" outside IdP (ping-devops-cmuir).
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
assets="$here/assets"
logo="$here/../../demo_api_ui/public/branding/ping-logo.png"
tpl=/opt/out/instance/server/default/conf/template
theme=ping ns="" container=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --theme) theme="${2:?--theme needs ping or acme}"; shift 2 ;;
    --k8s) ns="${2:?--k8s needs a namespace}"; shift 2 ;;
    -h|--help) sed -n '2,16p' "$0"; exit 0 ;;
    *) container="$1"; shift ;;
  esac
done

case "$theme" in
  ping) title="Sign in to Ping Identity AI demo"; product="AI IAM Core on PingFederate" ;;
  acme) title="Sign in to Acme Corp"; product="Workforce SSO, demo outside IdP" ;;
  *) echo "error: unknown theme '$theme' (ping or acme)" >&2; exit 2 ;;
esac
container="${container:-ai-demo-pingfederate}"
target="${ns:+$ns/pingfederate-0}"; target="${target:-$container}"

# run <sh snippet>: runs inside PF with this script's stdin. Docker runs as root (volume files have
# mixed owners), so put() hands files back to PF's uid; in the cluster PF's own uid writes them.
run() {
  if [[ -n "$ns" ]]; then kubectl -n "$ns" exec -i pingfederate-0 -- sh -c "$1"
  else docker exec -i -u 0 "$container" sh -c "$1"; fi
}
# put <path under the template dir>: writes stdin there.
put() {
  run "mkdir -p \"\$(dirname '$tpl/$1')\" && cat > '$tpl/$1' && { chown 9031:0 '$tpl/$1' 2>/dev/null || true; } && chmod 644 '$tpl/$1'"
}

run "test -d $tpl" </dev/null || { echo "error: no PingFederate template directory in $target" >&2; exit 1; }

# main.css: drop any earlier theme (ours from the marker on, or the pre-2026 "Demo login theme"
# block) and append the current one. Rewritten in place (cat >) so the file keeps its owner.
cat "$assets/login-theme.css" "$assets/login-theme-$theme.css" | run "
  f=$tpl/assets/css/main.css; t=/tmp/ai-demo-main.\$\$.css
  sed -e '/ai-demo-theme:start/,\$d' -e '/^\/\* Demo login theme for PingFederate/,\$d' \"\$f\" > \"\$t\" &&
  cat >> \"\$t\" && cat \"\$t\" > \"\$f\" && rm -f \"\$t\""

sed -e "s|@@TITLE@@|$title|g" -e "s|@@PRODUCT@@|$product|g" "$assets/html.form.login.template.html" \
  | put html.form.login.template.html

if [[ "$theme" == ping ]]; then
  put assets/images/ping-identity-logo.png < "$logo"
  put assets/fonts/ai-demo-montserrat-latin.woff2 < "$assets/montserrat-latin.woff2"
  # PingOne MFA adapter pages load pingone-mfa.css, not main.css: import our MFA theme once at its top.
  if run "test -f $tpl/assets/css/pingone-mfa.css" </dev/null; then
    put assets/css/ai-demo-mfa-theme.css < "$assets/pingone-mfa-theme.css"
    run "f=$tpl/assets/css/pingone-mfa.css; grep -q 'ai-demo-mfa-theme.css' \"\$f\" || {
      { printf '@import url(\"ai-demo-mfa-theme.css\");\n'; cat \"\$f\"; } > /tmp/ai-demo-mfa.css && cat /tmp/ai-demo-mfa.css > \"\$f\" && rm -f /tmp/ai-demo-mfa.css; }" </dev/null
  fi
else
  put assets/images/acme-mark.svg < "$assets/acme-mark.svg"
fi

# Local only: the SLO success page must return the user to the app, or the UC40 logout handoff strands
# them on PF's static "Sign Off Successful" page (post_logout_redirect_uri alone does not redirect,
# verified 2026-09-26). LogoutPage continues the ID-JAG handoff into the PF login automatically.
if [[ -z "$ns" ]]; then
  run "f=$tpl/idp.slo.success.page.template.html; grep -q 'ai-demo: send the user back' \"\$f\" 2>/dev/null && exit 0
    sed -i 's|<meta http-equiv=\"x-ua-compatible\" content=\"IE=edge\" />|<meta http-equiv=\"x-ua-compatible\" content=\"IE=edge\" />\n    <!-- ai-demo: send the user back to the app after SLO; LogoutPage continues the ID-JAG handoff -->\n    <meta http-equiv=\"refresh\" content=\"1;url=https://local.ping-devops.com:4000/logout\" />|' \"\$f\"
    chown 9031:0 \"\$f\" && chmod 644 \"\$f\"" </dev/null
fi

echo "Applied the $theme sign-on theme to $target"
