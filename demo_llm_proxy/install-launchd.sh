#!/bin/bash
# install-launchd.sh — keep the local LLM backend alive across logins/reboots so
# the agent's "llama.cpp only" mode never silently dies.
#
# Installs a per-user LaunchAgent that runs `supervise-swap.sh` at login
# (RunAtLoad) and every 5 minutes (StartInterval). supervise-swap keeps the
# tier-manager daemon (:8097) up and loads the RESIDENT tiers
# (LLM_PROXY_RESIDENT_TIERS, default :8091 + :8096 ≈ 14GB) so neither the BFF
# nor the agent ever pays a model swap.
#
# On a memory-constrained machine, export LLM_PROXY_RESIDENT_TIERS="" before
# installing: supervise-swap then falls back to SWAP MODE, keeping at most one
# tier resident (~2-11GB) and letting the router swap up on demand and decay back.
#
# macOS only. Usage:
#   bash demo_llm_proxy/install-launchd.sh            # install + load now
#   bash demo_llm_proxy/install-launchd.sh uninstall  # unload + remove
set -euo pipefail

LABEL="com.ai-demo.llama-models"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"

# Tiers kept loaded at all times. Both the BFF's phi-4-mini (:8091) and the
# agent's gpt-oss-20b (:8096) stay resident (~14GB) so neither surface pays a
# model swap. Export LLM_PROXY_RESIDENT_TIERS="" before installing to keep the
# old one-tier-at-a-time swap behavior on a memory-constrained machine.
RESIDENT_TIERS="${LLM_PROXY_RESIDENT_TIERS-8091,8096}"

if [ "${1:-install}" = "uninstall" ]; then
  launchctl unload "$PLIST" 2>/dev/null || true
  rm -f "$PLIST"
  echo "Removed $LABEL"
  exit 0
fi

# Resolve the supervisor to an ABSOLUTE path in the MAIN checkout (not a git
# worktree, which may be deleted) so the agent keeps working after cleanup.
# --path-format=absolute is required: from the main checkout `--git-common-dir`
# returns a relative `.git`, which would resolve MAIN_ROOT one level too high.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMMON_DIR="$(git -C "$SCRIPT_DIR" rev-parse --path-format=absolute --git-common-dir 2>/dev/null \
  || (cd "$SCRIPT_DIR" && cd "$(git rev-parse --git-common-dir)" && pwd))"
MAIN_ROOT="$(dirname "$COMMON_DIR")"
SUPERVISE_SCRIPT="$MAIN_ROOT/demo_llm_proxy/supervise-swap.sh"
if [ ! -f "$SUPERVISE_SCRIPT" ]; then
  echo "ERROR: supervisor not found at $SUPERVISE_SCRIPT" >&2
  exit 1
fi

# launchd runs with a minimal PATH; the scripts call bare `llama-server`
# (Homebrew) and `node`. Include their real bin dir so they resolve under launchd.
LLAMA_BIN="$(command -v llama-server || echo /opt/homebrew/bin/llama-server)"
NODE_BIN="$(command -v node || echo /opt/homebrew/bin/node)"
PATH_ENV="$(dirname "$LLAMA_BIN"):$(dirname "$NODE_BIN"):/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

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
    <string>$SUPERVISE_SCRIPT</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>$PATH_ENV</string>
    <key>LLM_PROXY_RESIDENT_TIERS</key><string>$RESIDENT_TIERS</string>
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
echo "  supervisor: $SUPERVISE_SCRIPT"
echo "  PATH:       $PATH_ENV"
echo "  plist:      $PLIST"
echo "  log:        /tmp/llama-models/launchd.log"
echo "  SWAP MODE: tier-manager + smallest tier only (at most one model resident);"
echo "  router swaps up on demand and decays back. Re-checks every 5 min."
echo "  Uninstall:  bash demo_llm_proxy/install-launchd.sh uninstall"
