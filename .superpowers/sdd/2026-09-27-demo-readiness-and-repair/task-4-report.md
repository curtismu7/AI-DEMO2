# Task 4 — Preview-bound configuration repair report

## Implementation

- Added `demoReadinessRepairService` with preview and apply interfaces. The
  preview digest covers the canonical selected target set and every change or
  blocked row. Plans expire after fifteen minutes.
- Apply requires a nonempty administrator confirmation, the matching digest,
  and the same canonical target set. It rereads every automatic candidate before
  the first write. A changed current value, expiry, target-set change, ambiguous
  ID, missing source reference, unknown digest, or repeat confirmation rejects
  before mutation.
- Only declared `automatic` classes with injected read, write, and readback
  adapters can enter a plan's mutable changes. Each write receives the digest
  as its idempotency key and is followed by adapter readback. A retry after a
  timeout is safe when the fresh reread already equals the expected value.
- `demo-feature-flag` now declares `requiresIsolatedWorker`; the repair service
  requires that worker marker and a restore adapter, and restores the prior
  worker value in `finally`. Presenter runtime state is not an adapter target.
- The audit service now returns structured source-backed candidates for a
  uniquely missing PingOne resource scope or app grant. It does not produce a
  candidate where observed values include unexpected values, object identity is
  incomplete, or a target is missing.
- Local Gateway Exchange #3 remains `release-only`; no supported in-process
  regenerate, restart, and loaded-config readback adapter exists at the BFF
  boundary. Hosted SE remains read-only. PingOne Authorize and all PingFederate
  classes remain manual or release-only and do not receive mutation calls.

## Verification

Ran from `demo_api_server` with mocked mutation boundaries only:

```text
CI=true npx jest tests/demoReadinessRepairService.test.js --forceExit
PASS tests/demoReadinessRepairService.test.js
Tests: 9 passed, 9 total

CI=true npx jest tests/demoReadinessAuditService.test.js tests/demoReadinessReport.test.js --forceExit
PASS tests/demoReadinessAuditService.test.js
PASS tests/demoReadinessReport.test.js
Tests: 76 passed, 76 total
```

The repair suite covers exact preview values/source reference and digest change,
changed target sets, expired plans, changed current values, ambiguous IDs,
repeated confirmation, confirmed readback, timeout retry, isolated feature-flag
restore on success and failure, and blocked Authorize mutation. The audit suite
covers candidate emission without writes. No live service, Docker, PingOne
provisioning/reset, or hosted deployment was invoked.

## Limits

No route, CLI, or Admin UI calls the repair service in this task. That later
integration must preserve the preview-before-confirmation boundary and provide
real PingOne adapter implementations with the same reread/write/readback
contract.

## Fix round 1

- Apply now requires `verifyAdminConfirmation` to validate a trusted assertion
  and return an administrator subject. A nonempty caller string cannot reach a
  mutation adapter.
- Each automatic class now names a fixed `contractReader` in repairability
  configuration. The reader supplies the target, exact object identity,
  expected value, source reference, and operation. Candidate values must match
  the contract; malformed or unsupported candidates stay blocked with a safe
  operator instruction.
- Feature flags no longer accept a caller-supplied worker label. Their adapter
  must create an opaque isolated worker context. Every observed flag path,
  including already-applied retry and write failure, restores the original
  worker value and performs worker readback before completion.
- A paginated PingOne scope response now blocks the scope finding and produces
  no automatic candidate.

Focused red regressions were run before implementation and failed for all five
review findings. After the fix:

```text
CI=true npx jest tests/demoReadinessRepairService.test.js --forceExit
PASS tests/demoReadinessRepairService.test.js
Tests: 15 passed, 15 total

CI=true npx jest tests/demoReadinessAuditService.test.js --forceExit
PASS tests/demoReadinessAuditService.test.js
Tests: 46 passed, 46 total
```

The final feature-flag regression also covers a failure while reading the
isolated worker: the service restores the planned original value and verifies
that restore before propagating the read failure.

## Fix round 2

- Isolated-worker cleanup now catches each restore and restore-readback failure,
  continues through every created worker, and throws an `AggregateError` only
  after all cleanup attempts. If apply and cleanup both fail, the aggregate
  retains the original apply error as its first error and `applyError` property.
- Source-contract validation now accepts any defined expected value, including a
  legitimate boolean `false` feature-flag expectation.

Focused red regressions first demonstrated that one failing restore stopped the
next worker cleanup and that `expected: false` produced no plan. After the
change:

```text
CI=true npx jest tests/demoReadinessRepairService.test.js --forceExit
PASS tests/demoReadinessRepairService.test.js
Tests: 18 passed, 18 total
```

The suite includes two worker contexts where the first cleanup fails and the
later context is still restored/read back, plus a combined apply-and-cleanup
failure that retains both errors.
