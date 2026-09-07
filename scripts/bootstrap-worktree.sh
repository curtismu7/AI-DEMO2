#!/usr/bin/env bash
# scripts/bootstrap-worktree.sh — make a fresh .claude/worktrees/* worktree
# runnable in one command: symlink every Node service's node_modules from the
# main checkout, then verify each service's DECLARED deps actually resolve
# through the link.
#
# Why this exists (2026-08-18, measured in one session): worktrees never
# inherit installed deps (lockfiles are gitignored), and hand-symlinking per
# service produced three real failures in a day —
#   - an `ls … | head -1 || ln -s …` one-liner whose pipe swallowed the ls
#     failure, so the link was never created and a whole test suite "failed"
#     on MODULE_NOT_FOUND that read as a code problem;
#   - a main-checkout node_modules missing a newly-declared dep
#     (@dotenvx/dotenvx), surfacing as a tsc build break in the worktree;
#   - the same axios-shaped miss in demo_authz_server.
# The verify step below catches BOTH failure shapes: a missing link, and a
# link whose target predates a dependency the worktree's package.json declares
# (fix: npm install in the MAIN checkout's service dir).
#
# Usage, from inside the worktree:
#   bash scripts/bootstrap-worktree.sh          # link + verify
#   bash scripts/bootstrap-worktree.sh --check  # verify only, change nothing
#
# Exit 0 = every service linked and every declared dep resolves.
set -euo pipefail

CHECK_ONLY=0
CHECK_DEPS=0
[ "${1:-}" = "--check" ] && CHECK_ONLY=1
[ "${1:-}" = "--check-deps" ] && CHECK_DEPS=1

# The worktree this runs from, and the main checkout its .git points at.
WT="$(git rev-parse --show-toplevel)"
MAIN="$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")"

# --check-deps verifies MAIN's own installed trees and links nothing, so unlike
# every other mode it is meaningful FROM the main checkout — which is where most
# sessions start. `--check` there returns "nothing to link" and exit 0 without
# verifying a single dependency, so a caller that wanted the gap detector and
# reached for `--check` would be silent by construction.
#
# The gap it finds: every package-lock.json here is gitignored, so worktrees take
# their deps by symlinking MAIN's node_modules. A dependency added to a service's
# package.json therefore reaches nobody until someone runs an install in MAIN,
# and nothing surfaces it until a worktree fails to compile — which is how the
# same prom-client omission sat unnoticed in three services at once (2026-09-07).
if [ "$CHECK_DEPS" = "1" ]; then
  gaps=0
  for pkg in "$MAIN"/package.json "$MAIN"/*/package.json; do
    [ -f "$pkg" ] || continue
    svc="$(dirname "$pkg")"
    rel="${svc#"$MAIN"}"; rel="${rel#/}"
    [ -d "$svc/node_modules" ] || continue   # never installed here — not a gap
    missing="$(node -e '
      const fs = require("fs"), path = require("path");
      const svc = process.argv[1];
      const pkg = JSON.parse(fs.readFileSync(path.join(svc, "package.json"), "utf8"));
      const deps = Object.keys({ ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) });
      const gone = deps.filter((d) => !fs.existsSync(path.join(svc, "node_modules", d)));
      process.stdout.write(gone.join(" "));
    ' "$svc")"
    if [ -n "$missing" ]; then
      echo "${rel:-.}: declared but not installed — $missing"
      echo "  fix: npm --prefix '$svc' install"
      gaps=$((gaps + 1))
    fi
  done
  [ "$gaps" -gt 0 ] && exit 1
  exit 0
fi

if [ "$WT" = "$MAIN" ]; then
  echo "[bootstrap-worktree] this IS the main checkout — nothing to link."
  exit 0
fi

fails=0
linked=0
checked=0

# Every dir (repo root included) whose MAIN copy has both a package.json and an
# installed node_modules is linkable. Depth 1 covers all Node services here.
for pkg in "$MAIN"/package.json "$MAIN"/*/package.json; do
  [ -f "$pkg" ] || continue
  svc_main="$(dirname "$pkg")"
  rel="${svc_main#"$MAIN"}"; rel="${rel#/}"
  svc_wt="$WT${rel:+/$rel}"
  label="${rel:-.}"

  [ -d "$svc_main/node_modules" ] || continue   # never installed in main — skip
  [ -f "$svc_wt/package.json" ] || continue      # service absent in this branch

  if [ ! -e "$svc_wt/node_modules" ]; then
    if [ "$CHECK_ONLY" = "1" ]; then
      echo "[bootstrap-worktree] MISSING link: $label/node_modules"
      fails=$((fails + 1))
      continue
    fi
    ln -s "$svc_main/node_modules" "$svc_wt/node_modules"
    linked=$((linked + 1))
  fi

  # Verify every dep the WORKTREE's package.json declares exists in the linked
  # tree — this is what catches a main checkout that predates a new dependency.
  missing="$(node -e '
    const fs = require("fs"), path = require("path");
    const svc = process.argv[1];
    const pkg = JSON.parse(fs.readFileSync(path.join(svc, "package.json"), "utf8"));
    const deps = Object.keys({ ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) });
    const gone = deps.filter((d) => !fs.existsSync(path.join(svc, "node_modules", d)));
    process.stdout.write(gone.join(" "));
  ' "$svc_wt")"
  checked=$((checked + 1))
  if [ -n "$missing" ]; then
    echo "[bootstrap-worktree] $label: declared dep(s) NOT in the linked node_modules: $missing"
    echo "                     fix: npm --prefix '$svc_main' install   (main checkout owns the real tree)"
    fails=$((fails + 1))
  fi
done

if [ "$fails" -gt 0 ]; then
  echo "[bootstrap-worktree] FAILED — $fails service(s) unresolved (see above)."
  exit 1
fi
echo "[bootstrap-worktree] OK — $checked service(s) verified${linked:+, $linked newly linked}."
