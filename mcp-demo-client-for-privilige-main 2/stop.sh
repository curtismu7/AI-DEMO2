#!/usr/bin/env bash
DIR="$(cd "$(dirname "$0")" && pwd)"
PIDFILE="$DIR/.mcp-demo.pid"

if [ ! -f "$PIDFILE" ]; then
  echo "Not running (no PID file found)."
  exit 0
fi

PID=$(cat "$PIDFILE")
if kill -0 "$PID" 2>/dev/null; then
  kill "$PID"
  rm -f "$PIDFILE"
  echo "Stopped (PID $PID)"
else
  echo "Process $PID not found (already stopped)."
  rm -f "$PIDFILE"
fi
