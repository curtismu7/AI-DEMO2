#!/bin/bash
# install-launchd.sh — keep the local llama-server model tiers alive across
# logins/reboots so the agent's "llama.cpp only" mode never silently dies.
#
# Installs a per-user LaunchAgent that:
#   - runs `start-local-models.sh start` at login (RunAtLoad), and
#   - re-runs it every 5 minutes (StartInterval) — `start` is idempotent, so
#     this only (re)starts tiers that have died; running tiers are left alone.
#
# macOS only. Usage:
#   bash demo_llm_proxy/install-launchd.sh            # install + load now
#   bash demo_llm_proxy/install-launchd.sh uninstall  # unload + remove
set -euo pipefail

LABEL="com.ai-demo.llama-models"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"

if [ "${1:-install}" = "uninstall" ]; then
  launchctl unload "$PLIST" 2>/dev/null || true
  rm -f "$PLIST"
  echo "Removed $LABEL"
  exit 0
fi

# Resolve the start script to an ABSOLUTE path in the MAIN checkout (not a git
# worktree, which may be deleted) so the agent keeps working after cleanup.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MAIN_ROOT="$(cd "$(dirname "$(git -C "$SCRIPT_DIR" rev-parse --git-common-dir)")" && pwd)"
START_SCRIPT="$MAIN_ROOT/demo_llm_proxy/start-local-models.sh"
if [ ! -f "$START_SCRIPT" ]; then
  echo "ERROR: start script not found at $START_SCRIPT" >&2
  exit 1
fi

# launchd runs with a minimal PATH; the script calls a bare `llama-server`
# (Homebrew). Include its real bin dir so it resolves under launchd.
LLAMA_BIN="$(command -v llama-server || echo /opt/homebrew/bin/llama-server)"
BIN_DIR="$(dirname "$LLAMA_BIN")"
PATH_ENV="$BIN_DIR:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

mkdir -p "$HOME/Library/LaunchAgents" /tmp/llama-models

cat > "$PLIST" <<PLISTEOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>$START_SCRIPT</string>
    <string>start</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>$PATH_ENV</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>StartInterval</key><integer>300</integer>
  <key>StandardOutPath</key><string>/tmp/llama-models/launchd.log</string>
  <key>StandardErrorPath</key><string>/tmp/llama-models/launchd.log</string>
</dict>
</plist>
PLISTEOF

launchctl unload "$PLIST" 2>/dev/null || true
launchctl load "$PLIST"

echo "Installed and loaded $LABEL"
echo "  start script: $START_SCRIPT"
echo "  PATH:         $PATH_ENV"
echo "  plist:        $PLIST"
echo "  log:          /tmp/llama-models/launchd.log"
echo "  loads all 5 tiers at login + self-heals every 5 min (idempotent)."
echo "  Uninstall:    bash demo_llm_proxy/install-launchd.sh uninstall"
