#!/usr/bin/env bash
# scripts/install-hooks.sh
# Run once after cloning to activate the project git hooks.
# Safe to run multiple times.

set -e

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HOOKS_DIR="$REPO_ROOT/.githooks"
GIT_DIR="$REPO_ROOT/.git"

if [ ! -d "$GIT_DIR" ]; then
  echo "Error: not a git repository ($REPO_ROOT)"
  exit 1
fi

# Point git at our hooks directory
git -C "$REPO_ROOT" config core.hooksPath .githooks

# Make all hooks executable
chmod +x "$HOOKS_DIR"/*

echo "Git hooks installed from .githooks/"
echo "Active hooks:"
ls "$HOOKS_DIR" | while read -r hook; do echo "  - $hook"; done
echo ""
echo "To skip a hook on a specific commit: git commit --no-verify"
