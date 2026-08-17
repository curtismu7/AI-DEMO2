#!/usr/bin/env bash
# scripts/sync-status.sh — print whether the shared main checkout (the one
# Docker bind-mounts) is actually serving what merged, and if not, why.
#
# sync-main-checkout.sh backs off silently by design when it finds unexplained
# dirty files, and the launchd job that runs it every 15 min logs where nobody
# looks. The result is a stack quietly serving stale code with no error
# anywhere. This reads .claude/sync-status.json, written on every sync run.
#
# Usage: scripts/sync-status.sh        (or: npm run sync:status)
# Exit 0 = in sync. Exit 1 = stale, blocked, or never run.

set -euo pipefail
cd "$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")"

STATUS_FILE=".claude/sync-status.json"

if [ ! -f "$STATUS_FILE" ]; then
  echo "[sync-status] no $STATUS_FILE yet — run scripts/sync-main-checkout.sh once to create it."
  exit 1
fi

BEHIND="$(git rev-list --count HEAD..origin/main 2>/dev/null || echo 0)"

STATUS_FILE="$STATUS_FILE" BEHIND="$BEHIND" node -e '
  const fs = require("node:fs");
  const s = JSON.parse(fs.readFileSync(process.env.STATUS_FILE, "utf8"));
  const behind = Number(process.env.BEHIND || 0);
  const ago = (iso) => {
    if (!iso) return "never";
    const mins = Math.round((Date.now() - Date.parse(iso)) / 60000);
    if (mins < 60) return `${mins}m ago`;
    const h = Math.floor(mins / 60);
    return `${h}h${String(mins % 60).padStart(2, "0")}m ago`;
  };

  if (s.outcome === "blocked") {
    console.log(`[sync-status] BLOCKED — checkout is ${behind} commit(s) behind origin/main.`);
    console.log(`              last successful sync: ${ago(s.lastSuccessAt)}`);
    console.log("              blocked by:");
    for (const f of String(s.reason || "").split(";").filter(Boolean)) console.log(`                ${f}`);
    console.log("              fix: scripts/park-main-edits.sh   (parks them on a wip branch, then syncs)");
    process.exit(1);
  }
  if (s.outcome === "failed") {
    console.log(`[sync-status] FAILED — ${s.reason || "see the sync log"}; ${behind} commit(s) behind.`);
    console.log(`              last successful sync: ${ago(s.lastSuccessAt)}`);
    process.exit(1);
  }
  if (behind > 0) {
    console.log(`[sync-status] STALE — last run said "${s.outcome}" ${ago(s.checkedAt)}, but the checkout is now ${behind} commit(s) behind origin/main.`);
    process.exit(1);
  }
  console.log(`[sync-status] in sync — last successful sync ${ago(s.lastSuccessAt)} (${(s.remoteSha || "").slice(0, 12)}).`);
'
