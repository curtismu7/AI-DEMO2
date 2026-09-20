#!/usr/bin/env bash
set -euo pipefail

# Contract test for the recipient-facing installer: PingOne bootstrap must not
# silently fall back to a second credential flow or proceed without all three
# worker-app credentials.
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
INSTALLER="$ROOT_DIR/install.sh"

grep -q 'PingOne Environment ID (UUID)' "$INSTALLER"
grep -q 'Worker Client ID' "$INSTALLER"
grep -q 'Worker Client Secret (hidden)' "$INSTALLER"

if grep -q 'press Enter to skip' "$INSTALLER"; then
  echo "installer still allows skipping PingOne worker credentials" >&2
  exit 1
fi

if grep -q 'setup will prompt (browser form)' "$INSTALLER"; then
  echo "installer still falls back to the browser credential form" >&2
  exit 1
fi

grep -q 'PINGONE_BOOTSTRAP_ENV_ID' "$INSTALLER"
grep -q 'PINGONE_BOOTSTRAP_CLIENT_ID' "$INSTALLER"
grep -q 'PINGONE_BOOTSTRAP_CLIENT_SECRET' "$INSTALLER"

echo "install PingOne credential contract: PASS"
