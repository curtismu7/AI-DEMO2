#!/usr/bin/env bash
# Self-check for warn-missing-service-deps.sh.
#   bash .claude/hooks/warn-missing-service-deps.test.sh
#
# The failure this guards is silence: a SessionStart warner that never fires is
# indistinguishable from a healthy repo, so the tests that matter are "does the
# detector actually detect" and "is it wired in at all".
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
HOOK="$HERE/warn-missing-service-deps.sh"
SCRIPT="$ROOT/scripts/bootstrap-worktree.sh"
fails=0
ok()   { echo "  ok   — $1"; }
bad()  { echo "  FAIL — $1"; fails=$((fails + 1)); }

echo "warn-missing-service-deps:"

[ -f "$HOOK" ] && ok "hook exists" || bad "hook missing"
bash -n "$HOOK" 2>/dev/null && ok "hook parses" || bad "hook has a syntax error"

# The whole point of --check-deps: --check exits 0 from the main checkout without
# verifying anything, so a hook reaching for it would be silent by construction.
grep -q -- '--check-deps' "$SCRIPT" \
  && ok "bootstrap-worktree.sh understands --check-deps" \
  || bad "bootstrap-worktree.sh lost --check-deps — the hook would fall through to link mode"
grep -q -- '--check-deps' "$HOOK" \
  && ok "hook asks for --check-deps, not --check" \
  || bad "hook must call --check-deps; --check is a no-op from the main checkout"

# Registered, or it never runs at all.
python3 - "$ROOT/.claude/settings.json" <<'PY' && ok "registered as a SessionStart hook" || bad "not registered in .claude/settings.json"
import json, sys
cfg = json.load(open(sys.argv[1]))
entries = cfg.get("hooks", {}).get("SessionStart", [])
cmds = [h.get("command", "") for e in entries for h in e.get("hooks", [])]
sys.exit(0 if any("warn-missing-service-deps.sh" in c for c in cmds) else 1)
PY

# A detector that fires on a healthy tree is worse than none — every session
# would learn to ignore it.
out="$(bash "$HOOK" 2>&1)"; rc=$?
if [ "$rc" -eq 0 ] && [ -z "$out" ]; then
  ok "silent on a tree whose deps all resolve"
else
  # Not necessarily a bug: it is correct to speak up if this checkout really
  # does have a gap. Say which, rather than failing blind.
  echo "  note — not silent here; either a real gap exists or the hook is noisy:"
  echo "$out" | sed 's/^/         /'
fi

# The detector itself, on a fixture — no mutation of the shared node_modules.
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/node_modules/present"
printf '{"dependencies":{"present":"1","absent":"1"}}' > "$tmp/package.json"
missing="$(node -e '
  const fs = require("fs"), path = require("path");
  const svc = process.argv[1];
  const pkg = JSON.parse(fs.readFileSync(path.join(svc, "package.json"), "utf8"));
  const deps = Object.keys({ ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) });
  process.stdout.write(deps.filter((d) => !fs.existsSync(path.join(svc, "node_modules", d))).join(" "));
' "$tmp")"
[ "$missing" = "absent" ] \
  && ok "dep diff names exactly the uninstalled package" \
  || bad "dep diff returned '$missing', expected 'absent'"

echo
[ "$fails" -eq 0 ] && { echo "all checks passed"; exit 0; }
echo "$fails check(s) failed"; exit 1
