# Per-service Docker deployment state

## Goal

Prevent a stale deployment marker for one Docker service from causing unrelated
services to rebuild, while allowing operators to deploy an explicitly selected
set of services.

## Design

- Store the last deployed commit for each managed service below the Git common
  directory at `deploy-live/services/<service>.sha`.
- Keep `.git/deploy-live.last` as a compatibility fallback for services that do
  not have a per-service marker yet. A successful normal deployment updates the
  per-service markers; the legacy marker remains only as a migration aid.
- Build each service's changed-file range from its own marker to the current
  checkout, then feed that range through the existing path-to-action map.
- Support `--services=service-a,service-b` to restrict planning and execution to
  the named services. This mode still uses the current checkout and Docker
  health checks, but never schedules other services.
- Write a service marker only after its requested Docker action has completed and
  its container is running. A failed or stopped service remains behind so the
  next invocation retries it.

## Verification

- Shell syntax check for `deploy-live.sh`.
- Regression test with fake Git/Docker/run-docker commands proving independent
  service markers do not schedule unrelated services.
- Regression test proving `--services` limits both actions and marker updates.
- Existing deploy-live unmanaged-service and monitoring dispatch tests.
