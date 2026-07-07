#!/bin/bash
# setup-mlx-venv.sh — Python venv with Apple's mlx-lm for the MLX demo agent mode.
#
# Usage: bash demo_llm_proxy/setup-mlx-venv.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV_DIR="${MLX_VENV_DIR:-$SCRIPT_DIR/.mlx-venv}"

pick_python() {
  for py in python3.12 python3.11 python3; do
    if command -v "$py" >/dev/null 2>&1; then
      echo "$py"
      return 0
    fi
  done
  return 1
}

PY="$(pick_python)" || { echo "❌ python3.11+ not found"; exit 1; }

echo "🔷 Creating mlx-lm venv at $VENV_DIR (using $PY)"
"$PY" -m venv "$VENV_DIR"
"$VENV_DIR/bin/pip" install --upgrade pip
"$VENV_DIR/bin/pip" install 'mlx-lm==0.31.3' 'transformers>=5.0,<5.13'

echo "✅ mlx-lm installed. Start demo server:"
echo "   bash demo_llm_proxy/start-mlx-lm.sh start"
