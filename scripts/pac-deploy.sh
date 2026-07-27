#!/usr/bin/env bash
# Compile, test and deploy a Policy-as-Code YAML file to a PingOne Authorize
# decision endpoint via the pac CLI.
#
# Primary path. If any step here fails, the fallback is to hand the same rules
# to the `p1az-import-generator` skill, which emits a snapshot JSON file that a
# human imports through the console — see pac/README.md.
#
# Tests run before deploy on purpose: `pac deploy` does a PUT of a whole
# deployment package, so a bad compile replaces the live policy tree at the
# target endpoint rather than merging into it.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
POLICY="${1:-$ROOT/pac/policies/amount-gate.yaml}"
ALIAS="${PAC_ENDPOINT_ALIAS:-demo}"

fallback() {
  echo "" >&2
  echo "pac path failed. Fallback: generate a console import file instead." >&2
  echo "  Use the p1az-import-generator skill with the same rules, then import" >&2
  echo "  the JSON via PingOne console -> Authorize -> policy editor -> Import." >&2
  exit 1
}

# pac.jar is 33MB, so it is not committed. Point PAC_JAR at your copy.
PAC_JAR="${PAC_JAR:-$ROOT/pac/pac.jar}"
if [ ! -f "$PAC_JAR" ]; then
  echo "ERROR: pac.jar not found at $PAC_JAR" >&2
  echo "       Set PAC_JAR=/path/to/pac.jar (see pac/README.md)." >&2
  fallback
fi

# macOS ships /usr/bin/java as a stub that exists on PATH even with no JDK
# installed — it only prints "Unable to locate a Java Runtime". So probe by
# running it, not with `command -v`. Homebrew's openjdk is keg-only and is not
# on PATH by default, hence the explicit fallback location.
if ! java -version >/dev/null 2>&1; then
  if [ -x /opt/homebrew/opt/openjdk/bin/java ]; then
    export PATH="/opt/homebrew/opt/openjdk/bin:$PATH"
  else
    echo "ERROR: no working java runtime. pac.jar needs Java 21+ (brew install openjdk)." >&2
    fallback
  fi
fi

if [ ! -f "$POLICY" ]; then
  echo "ERROR: policy file not found: $POLICY" >&2
  fallback
fi

echo "pac: validating $POLICY"
java -jar "$PAC_JAR" validate "$POLICY" || fallback

# `pac test` prints "All N test(s) passed." only when it actually ran tests. A
# policy file with no tests: block still exits 0, which would wave through an
# untested package — same "0 tests == pass" trap scripts/test-snapshots.sh closes.
echo "pac: running policy tests"
test_out="$(java -jar "$PAC_JAR" test "$POLICY" 2>&1)" || { echo "$test_out" >&2; fallback; }
echo "$test_out" | grep -viE '^WARNING'
if ! echo "$test_out" | grep -qE 'All [0-9]+ test\(s\) passed\.'; then
  echo "ERROR: no passing test summary from pac test — refusing to deploy." >&2
  echo "       Add a tests: block to $POLICY." >&2
  fallback
fi

echo "pac: deploying to endpoint alias '$ALIAS'"
java -jar "$PAC_JAR" deploy "$POLICY" -e "$ALIAS" 2>&1 | grep -viE '^WARNING' || fallback

echo "pac: deployed."
