#!/usr/bin/env bash
# Launch the pac Monaco editor over pac/policies/ for the local Policy-as-Code
# demo: edit YAML, live validation, run the policy's tests, visualise the
# decision tree, deploy to the PaC decision endpoint — all from one page.
#
# LOCAL ONLY. The editor serves an UNAUTHENTICATED REST API (/api/file,
# /api/deploy, /api/generate, ...) that can read and write files under the
# policy directory and deploy policy to the live PingOne environment using the
# worker credentials. Anyone who can reach the port can do both.
#
# The jar binds 127.0.0.1 only (verified with lsof), so it is not reachable off
# the machine by default — but that is the jar's behaviour, not something this
# script enforces, and there is no bind-address flag to pin it. So do not
# reverse-proxy it, iframe it from the demo UI, or run it on the SE AWS cluster.
# Run it beside the demo on the presenter's machine and screen-share it.
set -euo pipefail

# shellcheck source=scripts/pac-common.sh
source "$(cd "$(dirname "$0")" && pwd)/pac-common.sh"

PORT="${PAC_EDIT_PORT:-9099}"
POLICY_DIR="${1:-$ROOT/pac/policies}"

pac_setup

if [ ! -d "$POLICY_DIR" ]; then
  echo "ERROR: policy directory not found: $POLICY_DIR" >&2
  pac_fallback
fi

# The editor reads endpoint aliases from the same ephemeral ~/.pac/endpoints.json
# pac_setup builds, so its Deploy button targets the PaC endpoint and the worker
# secret still never lands in the real home directory. The trap in pac-common.sh
# shreds it when this script exits.
echo "pac editor: serving $POLICY_DIR on http://127.0.0.1:$PORT"
echo "pac editor: deploy target = $PAC_DECISION_ENDPOINT_ID (alias '$PAC_ENDPOINT_ALIAS')"
echo "pac editor: localhost only — unauthenticated API, do not expose. Ctrl+C to stop."
echo ""

# Deliberately NOT `exec`. exec replaces this shell with the JVM, which discards
# the EXIT trap pac-common.sh installed — the ephemeral home holding the worker
# secret would then survive after the editor is stopped (verified: it did).
# Running the JVM as a child keeps the trap alive, so Ctrl+C shreds the config.
java -Duser.home="$PAC_HOME" -jar "$PAC_JAR" edit "$POLICY_DIR" --port "$PORT"
