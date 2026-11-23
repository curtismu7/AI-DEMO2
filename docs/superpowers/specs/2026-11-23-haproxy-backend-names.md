# HAProxy backend names (mcpgw-lb) spec

**Status:** draft   **Owner:** Curtis (decides before any cluster change)

## Goal
Let the `mcpgw-lb` backends carry the standard gateway names (`mcpgw-<where>-<role><n>`, privilege/NAMING-CONVENTION.md section 8) instead of `gateway-pingid-1/2/3` and `gateway-old-1`, without breaking OAuth logins through the shared host. The only thing that blocks a rename today is the callback strip regex `~gateway-[0-9]+` hard-coded in `templates/loadbalancer-haproxy.yaml`: a node tag that does not look like `gateway-<n>` is not removed from `state`, so the gateway rejects the callback. This PR changes the chart and the overlay. **It deploys nothing.**

## Findings (read-only, 2026-11-23)
- Live release `agentless-mcpgw` (ns `ping-devops-curtismuir`) holds the names in its own values: `ownName gateway-old-1` (parked), peers `gateway-pingid-1/2/3`. Revision 99 is `failed` (a Deployment apply error, 2026-11-20); 98 is the last `deployed`. The repo overlay `gateway1-lb.values.yaml` is stale (still `gateway-2`, `gateway-3`).
- Nothing in code or tests names a backend: `routes/adminLbRuntime.js` accepts any `[\w.-]+`. `X-Served-By` and `node=` appear only in docs and UI text.
- `balance hash ... hash-type consistent` positions servers by id (order of the `server` lines), not by name, so renaming in the same order does not move any client to another node.

## Acceptance criteria (each a runnable check)
1. The strip pattern is built from the configured node names (`ownName` + `peers[].name`) plus the legacy `gateway-[0-9]+` for in-flight logins, not from a fixed prefix. Check: `helm template` with renamed peers contains each name in the `regsub` and in the `use-server` / `server` lines.
2. A node name outside `[A-Za-z0-9_-]` fails the render with a clear message (it would otherwise change the regex). Check: render with a bad name exits non-zero.
3. Behaviour: a callback query `code=A~B&state=xyz~<node>` becomes `code=A~B&state=xyz` for each configured node and for a legacy `gateway-3` tag, and a `~` inside `code` is never touched. Check: run HAProxy with the rendered strip expression against those queries.
4. The rendered `haproxy.cfg` passes `haproxy -c` (3.2-alpine, the live image).
5. Rendering the **current live values** with the new chart differs from the old chart only in the `regsub` line (names unchanged); rendering with the renamed overlay differs from live only in those names and the regex. Check: diff of the two ConfigMaps, `KEY=value` lines masked.
6. Server order and `disabled` parking are unchanged by the rename (consistent hash stays put).
7. `gateway1-lb.values.yaml` shows the target topology: `mcpgw-ct-retired1` (own, parked), peers `mcpgw-cm-pool1`, `mcpgw-cm-spare1` (parked), `mcpgw-ct-pool2`.
8. `privilege/NAMING-CONVENTION.md` section 8 and its change log record the change (the standard requires it); `GATEWAY-LOAD-BALANCER.md` names the node-name rule.
9. A repo test covers 1-4 and runs in `hygiene:check:core`; it skips with a message when `helm` or `docker` is missing.

## Unhappy paths
- A login in flight during the rollout carries an old tag: still stripped (legacy alternative), and routed by the hash when no server has that name (documented fallback).
- `helm upgrade` fails midway (rev 97/99 did): not applied by this PR; the apply plan below uses `--dry-run=server` first, and rollback is `helm rollback agentless-mcpgw 98`.
- Names containing regex characters, empty names, duplicate names: render fails (2); duplicates are rejected too.
- The ConfigMap is Helm-owned: hand edits (`disabled` on parked servers) are overwritten by an upgrade, so parking must be in values (`ownParked`, `parked`). The overlay carries it.

## Out of scope
Applying to the cluster; renaming Kubernetes Deployments, Helm releases or hostnames; the 8690 mesh noise; fixing failed revision 99.

## Protected / must not break
OAuth login through `mcpgw.ai-demo...`, client pinning, X-Served-By, the admin park/unpark route, the demo's lab hosts.

## Apply plan (after the owner's go, not part of this PR)
`helm upgrade agentless-mcpgw ... --reuse-values -f gateway1-lb.values.yaml --dry-run=server`, diff against `helm get manifest`, upgrade, check both LB pods are Ready, then `health up` per node if HAProxy still holds one out (`rise 60`), then a login through the shared host and the keyed door checks.

## Verification plan
Unit/hygiene test, `haproxy -c`, the runtime strip test, the live-values diff; independent review of the diff; CI on the PR. Nothing is applied to the cluster without the owner's go in the conversation.
