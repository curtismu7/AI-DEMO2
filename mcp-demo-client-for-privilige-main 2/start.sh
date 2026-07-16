#!/usr/bin/env bash
set -e
DIR="$(cd "$(dirname "$0")" && pwd)"
PIDFILE="$DIR/.mcp-demo.pid"

if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
  echo "Already running (PID $(cat "$PIDFILE")). Use ./stop.sh to stop it first."
  exit 0
fi

nohup node "$DIR/server.js" >> "$DIR/mcp-demo.log" 2>&1 &
echo $! > "$PIDFILE"
sleep 1

if kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
  echo "Started (PID $(cat "$PIDFILE"))"
  echo "  App:  http://127.0.0.1:33418"
  echo "  Logs: $DIR/mcp-demo.log"
else
  echo "Failed to start. Check mcp-demo.log"
  rm -f "$PIDFILE"
  exit 1
fi
