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

# shellcheck source=scripts/pac-common.sh
source "$(cd "$(dirname "$0")" && pwd)/pac-common.sh"

POLICY="${1:-$ROOT/pac/policies/transaction-authorization.yaml}"

pac_setup

if [ ! -f "$POLICY" ]; then
  echo "ERROR: policy file not found: $POLICY" >&2
  pac_fallback
fi

pac() { java -Duser.home="$PAC_HOME" -jar "$PAC_JAR" "$@"; }

echo "pac: validating $POLICY"
pac validate "$POLICY" || pac_fallback

# `pac test` prints "All N test(s) passed." only when it actually ran tests. A
# policy file with no tests: block still exits 0, which would wave through an
# untested package — same "0 tests == pass" trap scripts/test-snapshots.sh closes.
echo "pac: running policy tests"
test_out="$(pac test "$POLICY" 2>&1)" || { echo "$test_out" >&2; pac_fallback; }
echo "$test_out" | grep -viE '^WARNING'
if ! echo "$test_out" | grep -qE 'All [0-9]+ test\(s\) passed\.'; then
  echo "ERROR: no passing test summary from pac test — refusing to deploy." >&2
  echo "       Add a tests: block to $POLICY." >&2
  pac_fallback
fi

echo "pac: deploying to alias '$PAC_ENDPOINT_ALIAS' ($PAC_DECISION_ENDPOINT_ID)"
pac deploy "$POLICY" -e "$PAC_ENDPOINT_ALIAS" 2>&1 | grep -viE '^WARNING' || pac_fallback

echo "pac: deployed."
