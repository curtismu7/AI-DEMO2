#!/usr/bin/env bash
#
# install-ollama-launchagent.sh — make Ollama bind 0.0.0.0 on every login so the
# dockerized BFF can reach it via host.docker.internal.
#
# Why: the macOS Ollama app / `ollama serve` binds 127.0.0.1 by default, which is
# unreachable from inside Docker containers — the BFF then reports the Ollama
# provider as "not configured". The Ollama.app reads OLLAMA_HOST from the
# environment, so we persist OLLAMA_HOST=0.0.0.0 via a launchd setenv agent that
# runs at every login. The app (the durable, auto-restarting server) then binds
# all interfaces. We do NOT run a second `ollama serve` — that would fight the
# app for port 11434 (and a KeepAlive server agent just thrashes when it can't
# bind).
#
# Usage:
#   scripts/install-ollama-launchagent.sh           # install + apply now
#   scripts/install-ollama-launchagent.sh --uninstall
#
set -euo pipefail

LABEL="com.ollama.env"
PLIST="$HOME/Library/LaunchAgents/${LABEL}.plist"
OLD_LABEL="com.ollama.serve"   # superseded server agent — migrate it away
OLD_PLIST="$HOME/Library/LaunchAgents/${OLD_LABEL}.plist"
UID_="$(id -u)"

if [[ "$(uname)" != "Darwin" ]]; then
  echo "This installer is macOS-only (launchd). On Linux, export OLLAMA_HOST=0.0.0.0 for the ollama service." >&2
  exit 1
fi

# Remove the old KeepAlive server agent if a previous version installed it (it
# can't bind when the GUI app owns 11434 and just thrashes).
launchctl bootout "gui/${UID_}/${OLD_LABEL}" 2>/dev/null || true
rm -f "$OLD_PLIST"

if [[ "${1:-}" == "--uninstall" ]]; then
  launchctl bootout "gui/${UID_}/${LABEL}" 2>/dev/null || true
  rm -f "$PLIST"
  launchctl unsetenv OLLAMA_HOST 2>/dev/null || true
  echo "[OK] Removed ${LABEL} (Ollama keeps its default 127.0.0.1 bind on next restart)."
  exit 0
fi

if ! command -v ollama >/dev/null 2>&1; then
  echo "ollama not found on PATH. Install it first: brew install ollama (or https://ollama.ai)" >&2
  exit 1
fi

mkdir -p "$HOME/Library/LaunchAgents"
cat > "$PLIST" <<PLISTEOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/launchctl</string>
    <string>setenv</string>
    <string>OLLAMA_HOST</string>
    <string>0.0.0.0</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
</dict>
</plist>
PLISTEOF

# Load the agent (tolerate "already loaded" — bootstrap returns I/O error 5 then).
launchctl bootout "gui/${UID_}/${LABEL}" 2>/dev/null || true
launchctl bootstrap "gui/${UID_}" "$PLIST" 2>/dev/null || true
launchctl setenv OLLAMA_HOST 0.0.0.0   # apply now (the agent re-applies at each login)

# Restart the server so it picks up the bind: if Ollama is not bound to all
# interfaces, bounce it (the app inherits OLLAMA_HOST), else (re)launch it.
if ! lsof -nP -iTCP:11434 -sTCP:LISTEN 2>/dev/null | grep -q '\*:11434'; then
  osascript -e 'quit app "Ollama"' 2>/dev/null || true
  pkill -f "ollama serve" 2>/dev/null || true
  sleep 2
  if [[ -d /Applications/Ollama.app ]]; then
    open -a Ollama 2>/dev/null || true
  else
    OLLAMA_HOST=0.0.0.0 nohup ollama serve >/tmp/ollama-launchagent.log 2>&1 &
  fi
fi

for _ in 1 2 3 4 5 6 7 8 9 10; do
  sleep 1
  curl -sf --max-time 2 http://127.0.0.1:11434/api/version >/dev/null 2>&1 && break
done

if lsof -nP -iTCP:11434 -sTCP:LISTEN 2>/dev/null | grep -q '\*:11434'; then
  echo "[OK] OLLAMA_HOST=0.0.0.0 persisted (every login); Ollama bound to 0.0.0.0:11434."
  echo "     Pull the BFF model if needed:   ollama pull qwen2.5:3b"
else
  echo "[WARN] OLLAMA_HOST persisted but 0.0.0.0 bind not confirmed — restart Ollama and re-check." >&2
fi
