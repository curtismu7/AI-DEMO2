#!/usr/bin/env bash
# make-packages-public.sh — flip all AI-DEMO2 GHCR container packages to public.
#
# GitHub's package-visibility REST endpoint rejects OAuth tokens (gho_, what
# `gh auth` issues), so this script needs a CLASSIC PAT with write:packages:
#   1. GitHub → Settings → Developer settings → Tokens (classic) →
#      Generate new token (classic)
#   2. Check write:packages (read:packages comes with it)
#   3. Copy the ghp_… token
#   4. Run:  GH_TOKEN_PAT=ghp_xxx ./scripts/make-packages-public.sh
#   5. Revoke the PAT afterwards — it is only needed for this one operation.
#
# Idempotent: already-public packages are skipped. Dry-run by default; pass
# --apply to actually change visibility.

set -euo pipefail

OWNER="${OWNER:-cmuir_pingcorp}"
APPLY=0
[ "${1:-}" = "--apply" ] && APPLY=1

if [ -z "${GH_TOKEN_PAT:-}" ]; then
  echo "ERROR: set GH_TOKEN_PAT to a classic PAT (ghp_…) with write:packages."
  echo "See the header comment in this script for the 4-step PAT recipe."
  exit 1
fi

# Package list: everything CI publishes to ghcr.io/$OWNER.
PACKAGES="${PACKAGES:-$(gh api "users/$OWNER/packages?package_type=container" --paginate --jq '.[].name' 2>/dev/null)}"
if [ -z "$PACKAGES" ]; then
  echo "ERROR: no packages listed for user '$OWNER' — check gh auth and the owner name."
  exit 1
fi

echo "Found $(echo "$PACKAGES" | wc -l | tr -d ' ') packages for @$OWNER"
echo ""

changed=0; skipped=0; failed=0
for p in $PACKAGES; do
  vis="$(curl -s -H "Authorization: Bearer $GH_TOKEN_PAT" \
    "https://api.github.com/users/$OWNER/packages/container/$p" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("visibility","?"))' 2>/dev/null || echo "?")"
  case "$vis" in
    public)
      echo "  [skip]   $p (already public)"
      skipped=$((skipped+1));;
    private)
      if [ "$APPLY" = "1" ]; then
        code="$(curl -s -o /dev/null -w '%{http_code}' -X PATCH \
          -H "Authorization: Bearer $GH_TOKEN_PAT" \
          -H "Accept: application/vnd.github+json" \
          "https://api.github.com/users/$OWNER/packages/container/$p/visibility" \
          -d '{"visibility":"public"}')"
        if [ "$code" = "200" ] || [ "$code" = "204" ]; then
          echo "  [public] $p"
          changed=$((changed+1))
        else
          echo "  [FAIL]   $p (HTTP $code — see https://github.com/settings/tokens)"
          failed=$((failed+1))
        fi
      else
        echo "  [would]  $p (private → public; dry-run, pass --apply)"
      fi;;
    *)
      echo "  [FAIL]   $p (could not read visibility)"
      failed=$((failed+1));;
  esac
done

echo ""
if [ "$APPLY" = "1" ]; then
  echo "Done: $changed made public, $skipped already public, $failed failed."
else
  echo "Dry-run: $(echo "$PACKAGES" | grep -c .) checked. Re-run with --apply to change visibility."
fi
echo ""
echo "Afterwards:"
echo "  1. Revoke the PAT: https://github.com/settings/tokens"
echo "  2. On ONE package's settings page → Manage Actions access →"
echo "     confirm AI-DEMO2 has Read/Write (keeps CI pushes working)."
echo "  3. Verify anonymous pull:  docker pull ghcr.io/$OWNER/ai-demo-mcp-weather:latest"
