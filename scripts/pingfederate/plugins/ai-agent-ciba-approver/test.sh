#!/usr/bin/env sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
OUT="$ROOT/build/test-classes"
rm -rf "$OUT"
mkdir -p "$OUT"

if ! command -v javac >/dev/null 2>&1 || ! command -v java >/dev/null 2>&1; then
  echo "JDK 17 or newer is required to run the approval status tests" >&2
  exit 2
fi

javac --release 17 -d "$OUT" \
  "$ROOT/java/com/pingidentity/demo/ciba/ApprovalStatus.java" \
  "$ROOT/test/com/pingidentity/demo/ciba/ApprovalStatusTest.java"
java -ea -cp "$OUT" com.pingidentity.demo.ciba.ApprovalStatusTest
