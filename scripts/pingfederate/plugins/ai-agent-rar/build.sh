#!/usr/bin/env sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PF_HOME=${PF_HOME:-}
if [ -z "$PF_HOME" ] || [ ! -d "$PF_HOME/server/default/lib" ]; then
  echo "Set PF_HOME to the PingFederate installation (for example /opt/out/instance)" >&2
  exit 2
fi
if ! command -v javac >/dev/null 2>&1 || ! command -v jar >/dev/null 2>&1; then
  echo "JDK 17 or newer is required to build the PF RAR plugin" >&2
  exit 2
fi

OUT="$ROOT/build/classes"
JAR_FILE="$ROOT/build/pf-ai-agent-rar.jar"
rm -rf "$OUT"
mkdir -p "$OUT" "$ROOT/build"
CLASSPATH="$PF_HOME/server/default/lib/*:$PF_HOME/lib/*:$PF_HOME/sdk/lib/*"
javac --release 17 -cp "$CLASSPATH" -d "$OUT" \
  "$ROOT/java/com/pingidentity/demo/rar/AiAgentAuthorizationDetailPolicy.java" \
  "$ROOT/java/com/pingidentity/demo/rar/AiAgentAuthorizationDetailProcessor.java"
jar --create --file "$JAR_FILE" -C "$OUT" . -C "$ROOT" PF-INF
if ! jar --list --file "$JAR_FILE" | grep -Fx 'PF-INF/authorization-detail-processors' >/dev/null; then
  echo "Built JAR is missing PF-INF/authorization-detail-processors" >&2
  exit 1
fi
printf 'Built %s\n' "$JAR_FILE"
