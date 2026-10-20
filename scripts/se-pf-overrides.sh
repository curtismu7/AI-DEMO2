#!/usr/bin/env bash
# scripts/se-pf-overrides.sh -- owner-run: re-apply the SE PingFederate settings after a full SE deploy.
#
# Why: k8s/create-secrets.sh rebuilds `ai-demo-secrets` from the Mac's demo_api_server/.env (local
# Docker values), and k8s/aws/deploy.sh re-pins OAUTH_PROVIDER=pingone in ConfigMap `ai-demo-config`.
# Run this once after each full SE deploy to put the SE PingFederate values back.
#
# What it sets (additive; other keys in the Secret are left alone):
#   Secret ai-demo-secrets   PF_ISSUER, PF_DISCOVERY_ENDPOINT, PF_AUTHORIZATION_ENDPOINT,
#                            PF_TOKEN_ENDPOINT, PF_USERINFO_ENDPOINT, PF_JWKS_URI,
#                            PF_INTROSPECTION_ENDPOINT, PF_REVOCATION_ENDPOINT, PF_PAR_ENDPOINT
#                            -- all read from the live discovery document of SE_PF_URL
#                            PF_USER_REDIRECT_URI     <PUBLIC_APP_URL>/api/auth/oauth/user/callback
#                            PF_ID_JAG_AUDIENCE       SE_OAUTH_MCP_URL
#                            PF_ID_JAG_RESOURCE       SE_OAUTH_MCP_URL/mcp
#   ConfigMap ai-demo-config OAUTH_PROVIDER -> "" only with --unpin (the UI provider toggle works
#                            again; an empty value is ignored by configStore)
# Then: kubectl rollout restart deployment/demo-api-server, and waits for rollout status.
#
# NOT touched: PF_IDJAG_ISSUER_PF_URL and anything for the pf-pf playground mode. pf-pf needs a
# LOCAL PingFederate as the resource authorization server and is meant for the local app. Pointing
# PF_ISSUER at the SE PingFederate makes pf-pf fail with invalid_target on SE.
#
# Usage:
#   scripts/se-pf-overrides.sh                 # print the plan (keys and URLs, no secrets); change nothing
#   scripts/se-pf-overrides.sh --apply         # same plan, then type "yes" to write
#   scripts/se-pf-overrides.sh --apply --unpin # also blank OAUTH_PROVIDER in the ConfigMap
#   scripts/se-pf-overrides.sh --help
#
# Environment (all optional):
#   SE_NS=ping-devops-cmuir                      namespace
#   SE_PF_URL=https://cmuir-pf.ping-devops.com   PingFederate base URL (must equal the issuer)
#   SE_OAUTH_MCP_URL=https://cmuir-mcp.ping-devops.com
#   PUBLIC_APP_URL=<origin>                      else read from ConfigMap ai-demo-config
#
# Safety: values are written with `kubectl patch --type merge --patch-file` (a 0600 temp file,
# removed on exit), never on the command line and never printed. Nothing changes without --apply
# and a typed "yes".
#
# NOT verified against a live cluster: written and tested with stubbed kubectl/curl only
# (scripts/se-pf-overrides.test.sh).
set -euo pipefail

SE_NS="${SE_NS:-ping-devops-cmuir}"
SE_PF_URL="${SE_PF_URL:-https://cmuir-pf.ping-devops.com}"
SE_OAUTH_MCP_URL="${SE_OAUTH_MCP_URL:-https://cmuir-mcp.ping-devops.com}"
SECRET_NAME="ai-demo-secrets"
CONFIGMAP_NAME="ai-demo-config"
DEPLOYMENT="demo-api-server"
APPLY=0
UNPIN=0

for a in "$@"; do
  case "$a" in
    --apply) APPLY=1 ;;
    --unpin) UNPIN=1 ;;
    -h|--help) sed -n '2,37p' "$0"; exit 0 ;;
    *) echo "unknown option: $a (try --help)" >&2; exit 64 ;;
  esac
done

die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
say() { printf '%s\n' "$*"; }
retry() { # retry <tries> <cmd...>
  local n="$1" i=1 delay=2; shift
  until "$@"; do
    [ "$i" -ge "$n" ] && return 1
    say "  retry $i/$n in ${delay}s ..."; sleep "$delay"; delay=$((delay * 2)); i=$((i + 1))
  done
}

for tool in kubectl curl node; do
  command -v "$tool" >/dev/null 2>&1 || die "$tool not found on PATH"
done

SE_PF_URL="${SE_PF_URL%/}"
SE_OAUTH_MCP_URL="${SE_OAUTH_MCP_URL%/}"

WORK="$(mktemp -d)"
chmod 700 "$WORK"
trap 'rm -rf "${WORK:?}"' EXIT

# ---------- 1. discovery document ----------
DISCOVERY_URL="$SE_PF_URL/.well-known/openid-configuration"
say "Fetching $DISCOVERY_URL"
retry 3 curl -fsS --max-time 20 -o "$WORK/discovery.json" "$DISCOVERY_URL" \
  || die "could not fetch the discovery document from $DISCOVERY_URL"

# ---------- 2. public app URL ----------
PUBLIC_APP_URL="${PUBLIC_APP_URL:-}"
if [ -z "$PUBLIC_APP_URL" ]; then
  PUBLIC_APP_URL="$(kubectl get configmap "$CONFIGMAP_NAME" -n "$SE_NS" \
    -o jsonpath='{.data.PUBLIC_APP_URL}' 2>/dev/null || true)"
fi
[ -n "$PUBLIC_APP_URL" ] \
  || die "PUBLIC_APP_URL is not set and ConfigMap $CONFIGMAP_NAME in $SE_NS has none. Re-run with PUBLIC_APP_URL=https://<host>"
PUBLIC_APP_URL="${PUBLIC_APP_URL%/}"

# ---------- 3. build the Secret patch (validates the discovery document) ----------
SECRET_PATCH="$WORK/secret-patch.json"
KEYS_FILE="$WORK/plan.txt"
DISCOVERY_FILE="$WORK/discovery.json" PF_URL="$SE_PF_URL" DISC_URL="$DISCOVERY_URL" \
REDIRECT_URI="$PUBLIC_APP_URL/api/auth/oauth/user/callback" \
JAG_AUD="$SE_OAUTH_MCP_URL" JAG_RES="$SE_OAUTH_MCP_URL/mcp" \
PATCH_OUT="$SECRET_PATCH" PLAN_OUT="$KEYS_FILE" node -e '
const fs = require("fs");
const e = process.env;
let d;
try { d = JSON.parse(fs.readFileSync(e.DISCOVERY_FILE, "utf8")); }
catch (_) { console.error("ERROR: the discovery document is not valid JSON"); process.exit(1); }
const norm = (u) => String(u || "").replace(/\/+$/, "");
if (norm(d.issuer) !== norm(e.PF_URL)) {
  console.error("ERROR: discovery issuer does not match SE_PF_URL (issuer=" + d.issuer + ", SE_PF_URL=" + e.PF_URL + ")");
  process.exit(1);
}
const map = [
  ["PF_ISSUER", d.issuer],
  ["PF_DISCOVERY_ENDPOINT", e.DISC_URL],
  ["PF_AUTHORIZATION_ENDPOINT", d.authorization_endpoint],
  ["PF_TOKEN_ENDPOINT", d.token_endpoint],
  ["PF_USERINFO_ENDPOINT", d.userinfo_endpoint],
  ["PF_JWKS_URI", d.jwks_uri],
  ["PF_INTROSPECTION_ENDPOINT", d.introspection_endpoint],
  ["PF_REVOCATION_ENDPOINT", d.revocation_endpoint],
  ["PF_PAR_ENDPOINT", d.pushed_authorization_request_endpoint],
];
const missing = map.filter(([, v]) => !v || typeof v !== "string").map(([k]) => k);
if (missing.length) {
  console.error("ERROR: discovery document is missing values for: " + missing.join(", "));
  process.exit(1);
}
map.push(["PF_USER_REDIRECT_URI", e.REDIRECT_URI], ["PF_ID_JAG_AUDIENCE", e.JAG_AUD], ["PF_ID_JAG_RESOURCE", e.JAG_RES]);
fs.writeFileSync(e.PATCH_OUT, JSON.stringify({ stringData: Object.fromEntries(map) }), { mode: 0o600 });
fs.writeFileSync(e.PLAN_OUT, map.map(([k, v]) => "  " + k + " = " + v).join("\n") + "\n");
' || exit 1

# ---------- 4. plan ----------
say ""
say "Plan (namespace $SE_NS)"
say "Secret/$SECRET_NAME  additive merge of:"
cat "$KEYS_FILE"
if [ "$UNPIN" = 1 ]; then
  say "ConfigMap/$CONFIGMAP_NAME  OAUTH_PROVIDER -> \"\" (unpin)"
else
  say "ConfigMap/$CONFIGMAP_NAME  untouched (pass --unpin to blank OAUTH_PROVIDER)"
fi
say "Then: kubectl rollout restart deployment/$DEPLOYMENT and wait for rollout status"
say "Not touched: PF_IDJAG_ISSUER_PF_URL and pf-pf playground settings"

if [ "$APPLY" != 1 ]; then
  say ""
  say "Plan only; nothing changed. Re-run with --apply to write."
  exit 0
fi

# ---------- 5. apply ----------
say ""
read -r -p "Apply to namespace $SE_NS? Type yes to continue: " ans || ans=""
[ "$ans" = "yes" ] || { say "Stopped at your request; nothing changed."; exit 0; }

retry 3 kubectl patch secret "$SECRET_NAME" -n "$SE_NS" --type merge --patch-file "$SECRET_PATCH" >/dev/null \
  || die "patching Secret/$SECRET_NAME failed"
say "Patched Secret/$SECRET_NAME"

if [ "$UNPIN" = 1 ]; then
  printf '{"data":{"OAUTH_PROVIDER":""}}' >"$WORK/cm-patch.json"
  retry 3 kubectl patch configmap "$CONFIGMAP_NAME" -n "$SE_NS" --type merge --patch-file "$WORK/cm-patch.json" >/dev/null \
    || die "patching ConfigMap/$CONFIGMAP_NAME failed"
  say "Patched ConfigMap/$CONFIGMAP_NAME (OAUTH_PROVIDER unpinned)"
fi

kubectl rollout restart "deployment/$DEPLOYMENT" -n "$SE_NS" || die "rollout restart failed"
kubectl rollout status "deployment/$DEPLOYMENT" -n "$SE_NS" --timeout=300s || die "rollout did not finish within 300s"
say "Done."
