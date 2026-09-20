# Task 1 report — bounded MCP recovery controller

## Status

Completed with concern. Commit: `0037dd3d7332c56987f434dbee8fce3f4b99ceac` (`feat: bound MCP recovery attempts`).

## Files changed

- `librechat/client-overrides/McpRecoveryController.ts`
- `librechat/client-overrides/McpRecoveryController.spec.ts`
- `librechat/client-overrides/McpErrorRecovery.ts`
- `librechat/client-overrides/McpErrorRecovery.spec.ts`
- `librechat/patches/apply-persistent-conversation-starters.mjs`
- `librechat/Dockerfile`

## Implementation

- Added a typed, single-flight recovery controller with normalized/deduplicated server names.
- Bound each initialization with `Promise.race` and the supplied timeout.
- Returns explicit `recovered`, `no-server`, `in-flight`, `authentication-required`, `reconnect-failed`, `timeout`, and `delete-failed` statuses.
- Deletes the message only when every selected server reconnects with `success: true` and no OAuth requirement.
- Clears the in-flight guard in `finally`, allowing a later explicit retry.
- Copied the controller and its tests into the LibreChat client image and included both recovery test files in the image test gate.

## Exact commands and results

```text
git worktree add -b mcp-recovery-controller /private/tmp/ai-demo2-mcp-recovery-controller HEAD
```

Result: success; isolated worktree created on branch `mcp-recovery-controller`.

```text
docker build -f librechat/Dockerfile -t ai-demo-librechat:recovery-red .
```

Result: expected failure, before implementation validation. The command uses repository root as Docker context, but this Dockerfile copies `patches/` and `client-overrides/` relative to `librechat/`:

```text
ERROR: failed to build: failed to solve: failed to compute cache key:
"/patches/apply-persistent-conversation-starters.mjs": not found
"/client-overrides": not found
```

```text
docker build -f Dockerfile -t ai-demo-librechat:recovery-green .
```

Working directory: `/private/tmp/ai-demo2-mcp-recovery-controller/librechat` (the correct Docker build context).

Complete focused test result from the build:

```text
> cross-env NODE_ENV=development jest --ci --logHeapUsage ChatView.spec.tsx ScheduleExplanation.spec.tsx McpErrorRecovery.spec.ts McpRecoveryController.spec.ts --runInBand

PASS src/components/Chat/Messages/Content/McpRecoveryController.spec.ts (184 MB heap size)
PASS src/components/Chat/__tests__/ChatView.spec.tsx (18.929 s, 1288 MB heap size)
PASS src/components/SidePanel/Schedules/__tests__/ScheduleExplanation.spec.tsx (1259 MB heap size)
PASS src/components/Chat/Messages/Content/McpErrorRecovery.spec.ts (1277 MB heap size)

Test Suites: 4 passed, 4 total
Tests:       24 passed, 24 total
Snapshots:   0 total
Ran all test suites matching ChatView.spec.tsx|ScheduleExplanation.spec.tsx|McpErrorRecovery.spec.ts|McpRecoveryController.spec.ts.
```

Complete production-build result from the same image layer:

```text
PWA v1.3.0
mode      generateSW
precache  54 entries (12966.71 KiB)
files generated
  dist/sw.js
  dist/workbox-1b73dcc2.js
✓ built in 4.02s

removed 1175 packages, and audited 1823 packages in 4s

291 packages are looking for funding
  run `npm fund` for details

found 0 vulnerabilities
```

Final non-cached image-export verification:

```text
#9 exporting to image
#9 exporting layers 0.0s done
#9 exporting manifest sha256:f9097baafdd060019248ecf3ac85df7cb6dba743f0ff4d99c44bdae5e8545807 done
#9 naming to docker.io/library/ai-demo-librechat:recovery-green done
#9 unpacking to docker.io/library/ai-demo-librechat:recovery-green 18.5s done
#9 DONE 18.8s
```

The upstream production build emitted its existing direct-`eval` and large-chunk warnings; neither was introduced by this task and both were non-fatal.

```text
node --check librechat/patches/apply-persistent-conversation-starters.mjs
git diff --check
git diff --cached --check
```

Result: all exited 0.

```text
git add librechat/client-overrides/McpRecoveryController.ts librechat/client-overrides/McpRecoveryController.spec.ts librechat/client-overrides/McpErrorRecovery.ts librechat/client-overrides/McpErrorRecovery.spec.ts librechat/patches/apply-persistent-conversation-starters.mjs librechat/Dockerfile
git commit -m "feat: bound MCP recovery attempts"
```

Result:

```text
[mcp-recovery-controller 0037dd3d7] feat: bound MCP recovery attempts
6 files changed, 273 insertions(+), 1 deletion(-)
```

## Concern

## Fix round 1 — timeout operation lock

### Finding addressed

After a timeout, the controller previously cleared its attempt-level single-flight state while the underlying `initializeServer` promise could still be pending. A later explicit recovery could therefore launch another forced initialization for the same server.

The controller now retains a per-server operation map until each underlying initialization settles (fulfilled or rejected). A recovery remains bounded by its timeout, but a later click returns `{ status: 'in-flight' }` without starting a second initialization while the server operation remains unsettled. The existing result contract is unchanged.

### Regression coverage

Added `does not start another initialization after a timeout until the original settles` to `McpRecoveryController.spec.ts`. It uses fake timers, lets the first recovery time out, invokes a later recovery while the first initialization remains pending, and proves `initializeServer` has still been called exactly once.

### Exact commands and output

```text
docker build -f Dockerfile -t ai-demo-librechat:recovery-round1-red .
```

Working directory: `/private/tmp/ai-demo2-mcp-recovery-controller/librechat`.

Expected failing regression output before the fix:

```text
FAIL src/components/Chat/Messages/Content/McpRecoveryController.spec.ts
● MCP recovery controller › does not start another initialization after a timeout until the original settles

Expected number of calls: 1
Received number of calls: 2
```

```text
docker build -f Dockerfile -t ai-demo-librechat:recovery-round1-green .
```

Focused test output after the fix:

```text
> cross-env NODE_ENV=development jest --ci --logHeapUsage ChatView.spec.tsx ScheduleExplanation.spec.tsx McpErrorRecovery.spec.ts McpRecoveryController.spec.ts --runInBand

PASS src/components/Chat/Messages/Content/McpRecoveryController.spec.ts (195 MB heap size)
PASS src/components/Chat/__tests__/ChatView.spec.tsx (16.195 s, 1354 MB heap size)
PASS src/components/SidePanel/Schedules/__tests__/ScheduleExplanation.spec.tsx (1377 MB heap size)
PASS src/components/Chat/Messages/Content/McpErrorRecovery.spec.ts (1394 MB heap size)
```

The image then completed the production client build and image export:

```text
✓ built in 6.12s
found 0 vulnerabilities
#9 naming to docker.io/library/ai-demo-librechat:recovery-round1-green done
#9 DONE 63.2s
```

```text
git diff --check
git diff --cached --check
git add librechat/client-overrides/McpRecoveryController.ts librechat/client-overrides/McpRecoveryController.spec.ts
git commit -m "fix: prevent overlapping MCP recovery reconnects"
```

Results: both diff checks exited 0; commit created:

```text
[mcp-recovery-controller 6e4204b26] fix: prevent overlapping MCP recovery reconnects
2 files changed, 48 insertions(+), 6 deletions(-)
```

The assigned base checkout did not contain the previously described LibreChat rendered recovery/error-UI changes or the original `McpErrorRecovery` files. Task 1 therefore adds only the controller and pure helper layer as required and intentionally does not wire it into `MessageContent`; that integration remains Task 2. The plan's root-context Docker command is also invalid for the current Dockerfile layout; the successful gate used `librechat/` as its context.
