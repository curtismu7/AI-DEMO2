#!/bin/bash
# install-opensearch-port-forward-launchd.sh — keep LibreChat's opensearch-direct
# door working across session ends, logins, reboots, sleep and pod restarts.
#
# Installs a per-user LaunchAgent that runs scripts/opensearch-port-forward.sh at
# login with KeepAlive, so launchd restarts it whenever the tunnel drops. Same
# shape as demo_llm_proxy/install-launchd.sh.
#
# macOS only. Usage:
#   bash scripts/install-opensearch-port-forward-launchd.sh            # install + load now
#   bash scripts/install-opensearch-port-forward-launchd.sh uninstall  # unload + remove
set -euo pipefail

LABEL="com.aidemo2.opensearch-port-forward"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="$HOME/Library/Logs/aidemo2-opensearch-port-forward.log"

if [ "${1:-install}" = "uninstall" ]; then
  launchctl unload "$PLIST" 2>/dev/null || true
  rm -f "$PLIST"
  echo "Removed $LABEL"
  exit 0
fi

# Resolve the script in the MAIN checkout (a worktree may be deleted), the same
# way demo_llm_proxy/install-launchd.sh does.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMMON_DIR="$(git -C "$SCRIPT_DIR" rev-parse --path-format=absolute --git-common-dir)"
MAIN_ROOT="$(dirname "$COMMON_DIR")"
FORWARD_SCRIPT="$MAIN_ROOT/scripts/opensearch-port-forward.sh"
if [ ! -f "$FORWARD_SCRIPT" ]; then
  echo "ERROR: $FORWARD_SCRIPT not found (merge and sync the main checkout first)" >&2
  exit 1
fi

# launchd runs with a minimal PATH. kubectl's exec credential plugin
# (kubectl-oidc_login) must resolve too, or every port-forward fails to authenticate.
KUBECTL_BIN="$(command -v kubectl || echo /usr/local/bin/kubectl)"
OIDC_BIN="$(command -v kubectl-oidc_login || echo /opt/homebrew/bin/kubectl-oidc_login)"
PATH_ENV="$(dirname "$KUBECTL_BIN"):$(dirname "$OIDC_BIN"):/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

mkdir -p "$HOME/Library/LaunchAgents" "$(dirname "$LOG")"

cat > "$PLIST" <<PLISTEOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>$FORWARD_SCRIPT</string>
  </array>
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
launchctl load "$PLIST"

echo "Installed and loaded $LABEL"
echo "  script:    $FORWARD_SCRIPT"
echo "  PATH:      $PATH_ENV"
echo "  plist:     $PLIST"
echo "  log:       $LOG"
echo "  Uninstall: bash scripts/install-opensearch-port-forward-launchd.sh uninstall"
