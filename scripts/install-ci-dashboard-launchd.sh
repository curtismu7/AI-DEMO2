#!/bin/bash
# install-ci-dashboard-launchd.sh — keep the CI queue dashboard (admin nav ->
# CI Queue Dashboard, http://127.0.0.1:57500/) running without anyone starting it.
#
# Installs a per-user LaunchAgent that runs scripts/ci-queue-dashboard/server.js
# at login with KeepAlive, so launchd restarts it if it dies. It is a host
# process, not a container: it uses the host's authenticated `gh` and controls
# this Mac's launchd runners. Same shape as install-opensearch-port-forward-launchd.sh.
#
# macOS only. Usage:
#   bash scripts/install-ci-dashboard-launchd.sh            # install + load now
#   bash scripts/install-ci-dashboard-launchd.sh uninstall  # unload + remove
set -euo pipefail

LABEL="com.aidemo2.ci-dashboard"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="$HOME/Library/Logs/aidemo2-ci-dashboard.log"
PORT=57500

if [ "${1:-install}" = "uninstall" ]; then
  launchctl unload "$PLIST" 2>/dev/null || true
  rm -f "$PLIST"
  echo "Removed $LABEL"
  exit 0
fi

# Resolve the server in the MAIN checkout (a worktree may be deleted).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMMON_DIR="$(git -C "$SCRIPT_DIR" rev-parse --path-format=absolute --git-common-dir)"
MAIN_ROOT="$(dirname "$COMMON_DIR")"
SERVER="$MAIN_ROOT/scripts/ci-queue-dashboard/server.js"
if [ ! -f "$SERVER" ]; then
  echo "ERROR: $SERVER not found (merge and sync the main checkout first)" >&2
  exit 1
fi

NODE_BIN="$(command -v node || true)"
GH_BIN="$(command -v gh || true)"
[ -n "$NODE_BIN" ] || { echo "ERROR: node not found (Node 22+ required)" >&2; exit 1; }
[ -n "$GH_BIN" ] || { echo "ERROR: gh not found — install it and run: gh auth login" >&2; exit 1; }
# launchd runs with a minimal PATH; the server shells out to gh.
PATH_ENV="$(dirname "$NODE_BIN"):$(dirname "$GH_BIN"):/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

mkdir -p "$HOME/Library/LaunchAgents" "$(dirname "$LOG")"

cat > "$PLIST" <<PLISTEOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE_BIN</string>
    <string>$SERVER</string>
  </array>
  <key>WorkingDirectory</key><string>$MAIN_ROOT</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>$PATH_ENV</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
</dict>
</plist>
PLISTEOF

launchctl unload "$PLIST" 2>/dev/null || true
# A dashboard started by hand (npm run ci:dashboard) holds the port and would
# make the agent crash-loop on EADDRINUSE; the agent replaces it.
if lsof -nP -iTCP:$PORT -sTCP:LISTEN >/dev/null 2>&1; then
  pkill -f "scripts/ci-queue-dashboard/server.js" 2>/dev/null || true
  sleep 1
fi
launchctl load "$PLIST"

echo "Installed and loaded $LABEL"
echo "  server:    $SERVER"
echo "  PATH:      $PATH_ENV"
echo "  plist:     $PLIST"
echo "  log:       $LOG"
echo "  Uninstall: bash scripts/install-ci-dashboard-launchd.sh uninstall"
