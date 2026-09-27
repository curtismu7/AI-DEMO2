#!/usr/bin/env sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
OUT="$ROOT/build/test-classes"
rm -rf "$ROOT/build/test-classes"
mkdir -p "$OUT"

if ! command -v javac >/dev/null 2>&1 || ! command -v java >/dev/null 2>&1; then
  echo "JDK 17 or newer is required to run the RAR policy tests" >&2
  exit 2
fi

javac --release 17 -d "$OUT" \
  "$ROOT/java/com/pingidentity/demo/rar/AiAgentAuthorizationDetailPolicy.java" \
  "$ROOT/test/com/pingidentity/demo/rar/AiAgentAuthorizationDetailPolicyTest.java"
java -ea -cp "$OUT" com.pingidentity.demo.rar.AiAgentAuthorizationDetailPolicyTest
