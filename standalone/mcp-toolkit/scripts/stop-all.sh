#!/usr/bin/env bash
# Stops whatever scripts/start-all.sh started.
#
# Kills the whole process GROUP (negative PID), not just the recorded PID —
# `npm start` forks its own child (and the build-then-start tools fork
# again for that), so the recorded PID is a wrapper a few processes above
# the one actually holding the port. start-all.sh's `set -m` put the whole
# tree in one group for exactly this kill to reach all of it.
set -euo pipefail
cd "$(dirname "$0")/.."

for pidfile in .pids/*.pid; do
  [ -f "$pidfile" ] || continue
  name="$(basename "$pidfile" .pid)"
  pid="$(cat "$pidfile")"
  if kill -0 "$pid" 2>/dev/null; then
    echo "== $name: stopping (pid $pid) =="
    kill -- "-$pid" 2>/dev/null || kill "$pid"
  else
    echo "== $name: not running =="
  fi
  rm -f "$pidfile"
done
