#!/bin/bash
# Start one process in a new session so the supervisor/launchd process group
# can exit without taking the long-running child with it.
set -euo pipefail

if [ "$#" -eq 0 ]; then
  echo "usage: $0 command [args...]" >&2
  exit 2
fi

if command -v setsid >/dev/null 2>&1; then
  exec setsid "$@"
fi

if command -v perl >/dev/null 2>&1; then
  # Match start-local-models.sh: in a LaunchAgent child, setsid succeeds and
  # detaches from launchd's process group. A shell test can make this process
  # a process-group leader, where POSIX requires setsid() to fail; keep running
  # in that case instead of exiting before exec.
  exec perl -e 'use POSIX qw(setsid); setsid(); exec @ARGV or die "exec failed: $!\n"' "$@"
fi

echo "start-detached: requires setsid or Perl POSIX::setsid" >&2
exit 1
