#!/usr/bin/env bash
# ci-cached-npm-ci.sh <service-dir>
#
# `npm ci` for a service, but reuse a previously installed node_modules when
# its package-lock.json is unchanged. On the persistent self-hosted runners a
# plain `npm ci --prefix demo_api_server` reinstalled 2357 packages (~2.5 min)
# in three jobs of every run, with a lockfile that changes a few times a month.
#
# Cache: $CI_DEPS_CACHE/<service>/<key>/node_modules, where <key> hashes the
# lockfile, Node major and CPU arch. A hit symlinks it into the checkout; a
# miss runs a real `npm ci` and publishes the result with an atomic rename, so
# two runners racing on the same key both end up with a complete tree.
#
# ponytail: the cached tree is shared read-only by convention, not enforced.
# Do not point this at a service whose tools write into node_modules (the UI's
# vite/vitest caches do) without giving it a per-runner cache dir first.
set -euo pipefail

dir="${1:?usage: ci-cached-npm-ci.sh <service-dir>}"
lock="$dir/package-lock.json"
[ -f "$lock" ] || { echo "[ci-deps] no $lock — cannot key a cache" >&2; exit 1; }

cache_root="${CI_DEPS_CACHE:-$HOME/.cache/ai-demo-ci-deps}"
key="$( { cat "$lock"; node -p 'process.versions.node.split(".")[0] + "-" + process.arch'; } | shasum -a 256 | cut -c1-16)"
slot="$cache_root/$dir/$key"

if [ ! -d "$slot/node_modules" ]; then
  echo "[ci-deps] miss $dir ($key) — running npm ci"
  rm -rf "$dir/node_modules"
  npm ci --prefix "$dir" --no-audit --no-fund
  mkdir -p "$cache_root/$dir"
  # mkdir is the claim: only one runner can create the slot. The loser keeps
  # the winner's tree and throws its own away.
  if mkdir "$slot" 2>/dev/null; then
    mv "$dir/node_modules" "$slot/node_modules"
  fi
  # Drop slots for older lockfiles (unused for 14+ days).
  find "$cache_root/$dir" -mindepth 1 -maxdepth 1 -type d -mtime +14 ! -name "$key" -exec rm -rf {} + 2>/dev/null || true
else
  echo "[ci-deps] hit  $dir ($key)"
  touch "$slot"
fi

rm -rf "$dir/node_modules"
ln -s "$slot/node_modules" "$dir/node_modules"
