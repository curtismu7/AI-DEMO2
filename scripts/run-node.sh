#!/usr/bin/env bash
#
# run-node.sh — invoke a Node CLI script under a guaranteed-correct Node major.
#
# Why this exists: npm run scripts inherit whatever Node major the shell has
# active. On a shell where nvm hasn't been sourced (fresh terminal, no
# ~/.zshrc bootstrap, CI runner, etc.), `node --version` is often the
# system Node 18 — and our scripts pre-flight a Node 20+ floor and exit.
# Users then have to source nvm by hand and re-run, which is exactly the
# kind of friction setup:fresh exists to eliminate.
#
# Usage (from a package.json script):
#   "reset": "bash scripts/run-node.sh demo_api_server/scripts/setupFresh.js --clean --reset-pingone"
#
# Behavior:
#   1. If current Node major >= 20, exec the script as-is.
#   2. Otherwise, source nvm and `nvm use 20` (or the major from
#      package.json#engines.node), then exec the script.
#   3. If nvm isn't installed or can't switch, print a clear error matching
#      the one our Node scripts already print, and exit 1.

set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "usage: $0 <node-script> [args...]" >&2
  exit 2
fi

BASEDIR="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPT_REL="$1"
shift

# Resolve required Node major from root package.json#engines.node. Accepts
# "20.x", ">=20", "20", ">=20.0.0" — first digit run wins. Defaults to 20.
NODE_MIN=20
if command -v node >/dev/null 2>&1; then
  parsed=$(node -e "
    try {
      const e = require('${BASEDIR}/package.json').engines;
      const m = e && e.node && String(e.node).match(/(\\d+)/);
      process.stdout.write(m ? m[1] : '20');
    } catch (_) { process.stdout.write('20'); }
  " 2>/dev/null || echo 20)
  NODE_MIN="${parsed:-20}"
fi

current_major() {
  command -v node >/dev/null 2>&1 || { echo ''; return; }
  node -e "process.stdout.write(process.version.replace('v','').split('.')[0])" 2>/dev/null
}

CUR="$(current_major)"
if [[ -n "${CUR}" ]] && [[ "${CUR}" -ge "${NODE_MIN}" ]] 2>/dev/null; then
  exec node "${BASEDIR}/${SCRIPT_REL}" "$@"
fi

# Need to switch. Try nvm.
NVM_DIR_PATH="${NVM_DIR:-$HOME/.nvm}"
if [[ -s "${NVM_DIR_PATH}/nvm.sh" ]]; then
  # shellcheck disable=SC1091
  \. "${NVM_DIR_PATH}/nvm.sh"
  if command -v nvm >/dev/null 2>&1; then
    if nvm use "${NODE_MIN}" >/dev/null 2>&1; then
      echo "[run-node] Switched to Node $(node --version) via nvm (was Node ${CUR:-missing})." >&2
      exec node "${BASEDIR}/${SCRIPT_REL}" "$@"
    fi
    # nvm doesn't have N installed yet — try to install it.
    echo "[run-node] Node ${NODE_MIN} not installed via nvm. Installing now…" >&2
    if nvm install "${NODE_MIN}" >/dev/null 2>&1 && nvm use "${NODE_MIN}" >/dev/null 2>&1; then
      echo "[run-node] Installed Node $(node --version) via nvm." >&2
      exec node "${BASEDIR}/${SCRIPT_REL}" "$@"
    fi
  fi
fi

# Couldn't recover. Print the same actionable error our Node scripts print.
cat >&2 <<EOF
Node ${NODE_MIN}+ required, but this shell is using Node v${CUR:-(missing)}.

Fix (zsh/bash) — load nvm into this shell, then switch:
  export NVM_DIR="\$HOME/.nvm"
  [ -s "\$NVM_DIR/nvm.sh" ] && \\. "\$NVM_DIR/nvm.sh"
  nvm install ${NODE_MIN} && nvm use ${NODE_MIN}

Persist for future shells: append the two export/source lines above to
  ~/.zshrc (zsh)   or   ~/.bashrc (bash)

No nvm yet? Install: https://github.com/nvm-sh/nvm#installing-and-updating

Then re-run from the banking-demo repo.
EOF
exit 1
