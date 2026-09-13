#!/usr/bin/env bash
# scripts/prune-docker-build-leftovers.sh
#
# Removes Docker images and build cache left behind by rebuilds. Runs every 6 hours
# from launchd (com.aidemo2.docker-prune). The build-time prune in run-docker.sh and
# k8s/update.sh only covers builds that go through those two scripts; this catches
# everything else, including builds other sessions run with raw `docker compose`.
#
# Unchecked, these leftovers reached 291 untagged images and 42.73GB of build cache
# on 2026-09-13 and filled the disk until the Docker daemon stopped answering.
#
# `until=24h` spares anything built in the last day, so a build another session just
# finished is never taken. Volumes are never touched: `docker volume prune` also
# deletes named volumes no container is using, which includes other projects'
# databases.
#
# Usage: scripts/prune-docker-build-leftovers.sh
# Exit 0 = pruned, or nothing to prune. Non-zero = a prune failed, see the log.

set -euo pipefail

# launchd starts jobs with PATH=/usr/bin:/bin:/usr/sbin:/sbin, which does not include
# /usr/local/bin, where the OrbStack docker CLI is linked. Without this, every run
# would fail with "docker: command not found" into a log nobody reads.
export PATH="/usr/local/bin:${PATH}"

LOG_PREFIX="[prune-docker-build-leftovers $(date '+%Y-%m-%d %H:%M:%S')]"

free_gib() { df -g /System/Volumes/Data | awk 'NR==2 {print $4}'; }

before="$(free_gib)"

# Captured into variables rather than echoed inline: a failing command substitution
# inside `echo "$(...)"` does not trip `set -e`, so a failed prune would log a blank
# line and exit 0.
images="$(docker image prune -f --filter 'until=24h')"
cache="$(docker builder prune -f --filter 'until=24h')"

echo "${LOG_PREFIX} images: ${images##*$'\n'}"
echo "${LOG_PREFIX} build cache: ${cache##*$'\n'}"
echo "${LOG_PREFIX} free disk: ${before} GiB -> $(free_gib) GiB"
