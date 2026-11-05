#!/bin/zsh
# Build ONE flat folder holding the latest of every Privilege doc, from the repo.
# The repo (origin/main) is the only place docs are edited; this folder is generated.
# Usage: scripts/sync-privilege-docs.sh [OUT_DIR] [--rclone]
#   OUT_DIR   default: ~/Documents/Privilege Sensor Docs/upload-bundle
#   --rclone  also copy to the shared Drive folder (needs a working `rclone config reconnect gdrive:`)
set -eu
REPO=$(git rev-parse --show-toplevel)
OUT=${1:-"$HOME/Documents/Privilege Sensor Docs/upload-bundle"}
[[ $OUT == --* ]] && OUT="$HOME/Documents/Privilege Sensor Docs/upload-bundle"
FOLDER=13SG0IDSMTkGyQTJd6NTdG7KTEh3Aw4Nd
STAGE=$(mktemp -d)

git -C "$REPO" fetch -q origin main
git -C "$REPO" archive "${REF:-origin/main}" privilege docs | tar -x -C "$STAGE"

rm -rf "$OUT"; mkdir -p "$OUT/screenshots"
# privilege/*.md and *.pdf. Older guides live on Drive under lowercase
# privilege-<name>.md names, so keep those names.
for f in "$STAGE"/privilege/*.md "$STAGE"/privilege/*.pdf; do
  b=$(basename "$f")
  case "$b" in
    GATEWAY-*|SENSOR-*|SECRETS-HUB-WITH-*|A2A-DEMO-AND-SETUP-*|NEW-DEMO-ENVIRONMENT.md)
      n="privilege-$(echo "$b" | tr 'A-Z' 'a-z')" ;;
    *) n="$b" ;;
  esac
  cp "$f" "$OUT/$n"
done
# Drive-only originals (gateway guides + PDFs), the Confluence pages, privilege docs in docs/
cp "$STAGE"/privilege/drive-originals/* "$OUT/" 2>/dev/null || true
cp "$STAGE"/privilege/confluence/*.html "$OUT/" 2>/dev/null || true
cp "$STAGE"/privilege/confluence/pf-token-privilege-screens/* "$OUT/screenshots/" 2>/dev/null || true
cp "$STAGE"/docs/privilege-*.md "$STAGE"/docs/privilege-*.html \
   "$STAGE"/docs/2026-10-07-cimd-privilege-client-documents.md "$OUT/" 2>/dev/null || true
rm -r "$STAGE"
echo "bundle: $OUT ($(ls "$OUT" | wc -l | tr -d ' ') entries)"

if [[ " $* " == *" --rclone "* ]]; then
  rclone copy "$OUT" gdrive: --drive-root-folder-id "$FOLDER" -v 2>&1 | grep -E 'Copied|ERROR|Transferred: +[0-9]+ /'
  rclone check "$OUT" gdrive: --drive-root-folder-id "$FOLDER" --one-way 2>&1 | grep -E 'differences|matching'
fi
