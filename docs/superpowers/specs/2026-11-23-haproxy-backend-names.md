# HAProxy backend names (mcpgw-lb) spec

**Status:** draft   **Owner:** Curtis (decides before any cluster change)

## Goal
Let the `mcpgw-lb` backends carry the standard gateway names (`mcpgw-<where>-<role><n>`, privilege/NAMING-CONVENTION.md section 8) instead of `gateway-pingid-1/2/3` and `gateway-old-1`, without breaking OAuth logins through the shared host. The only thing that blocks a rename today is the callback strip regex `~gateway-[0-9]+` hard-coded in `templates/loadbalancer-haproxy.yaml`: a node tag that does not look like `gateway-<n>` is not removed from `state`, so the gateway rejects the callback. This PR changes the chart and the overlay. **It deploys nothing.**

## Findings (read-only, 2026-11-23)
- Live release `agentless-mcpgw` (ns `ping-devops-curtismuir`) holds the names in its own values: `ownName gateway-old-1` (parked), peers `gateway-pingid-1/2/3`. Revision 99 is `failed` (a Deployment apply error, 2026-11-20); 98 is the last `deployed`. The repo overlay `gateway1-lb.values.yaml` is stale (still `gateway-2`, `gateway-3`).
- Nothing in code or tests names a backend: `routes/adminLbRuntime.js` accepts any `[\w.-]+`. `X-Served-By` and `node=` appear only in docs and UI text.
- `balance hash ... hash-type consistent` positions servers by id (order of the `server` lines), not by name, so renaming in the same order does not move any client to another node.

## Acceptance criteria (each a runnable check)
1. The strip is built from the configured node names (`ownName` + `peers[].name`) and `loadBalancer.legacyNodeNames` (tags from before a rename: the overlay lists `gateway-old-1`, `gateway-pingid-1/2/3`), longest first, with the generic `gateway-[0-9]+` last. Check: `helm template` contains each name in the `regsub` and in the `use-server` / `server` lines.
2. A node or legacy name must match `^[A-Za-z0-9][A-Za-z0-9_-]{5,}$` (no regex or HAProxy-special characters, no leading dash, at least 6 characters because each name is stripped from the whole query) and be unique across ownName, peers and legacy names; otherwise the render fails with a clear message. Check: bad, short, dash-leading and duplicate names, as peer, ownName and legacy.
3. Behaviour: `code=A~B&state=xyz~<node>` becomes `code=A~B&state=xyz` for each configured node, for a node that starts with `gateway-<n>` (`gateway-2-new`), for the real old tags (`gateway-pingid-1`, `gateway-old-1`) and for a historic `gateway-<n>`, and a `~` inside `code` is never touched by a name of 6+ characters. Check: run HAProxy with the rendered strip expression against those queries.
4. The rendered `haproxy.cfg` passes `haproxy -c` with exit status 0 (3.2-alpine, the live image).
5. Rendering the **current live values** with the new chart differs from the old chart only in the `regsub` line (names unchanged); rendering with the renamed overlay differs from live only in those names and the regex. Check: diff of the two ConfigMaps, `KEY=value` lines masked.
6. Server order and `disabled` parking are unchanged by the rename (consistent hash stays put).
7. `gateway1-lb.values.yaml` shows the target topology: `mcpgw-ct-retired1` (own, parked), peers `mcpgw-cm-pool1`, `mcpgw-cm-spare1` (parked), `mcpgw-ct-pool2`.
8. `privilege/NAMING-CONVENTION.md` section 8 and its change log record the change (the standard requires it); `GATEWAY-LOAD-BALANCER.md` names the node-name rule.
9. A repo test covers 1-4 and runs in `hygiene:check:core`; it skips with a message locally when `helm`, `docker` or `openssl` is missing and FAILS in CI (`CI=true`) so a runner without them cannot pass with no coverage.

## Unhappy paths
- A login in flight during the rollout carries an old tag (`gateway-pingid-N`, `gateway-old-1`): stripped via `legacyNodeNames`, and routed by the hash when no server has that name (documented fallback). Found in review: the first version only stripped `gateway-<n>`, which the live tags are not.
- `helm upgrade` fails midway (rev 97/99 did): not applied by this PR; the apply plan below uses `--dry-run=server` first, and rollback is `helm rollback agentless-mcpgw 98`.
- Names containing regex characters, empty names, duplicate names: render fails (2); duplicates are rejected too.
- The ConfigMap is Helm-owned: hand edits (`disabled` on parked servers) are overwritten by an upgrade, so parking must be in values (`ownParked`, `parked`). The overlay carries it.

## Out of scope
Applying to the cluster; renaming Kubernetes Deployments, Helm releases or hostnames; the 8690 mesh noise; fixing failed revision 99.

## Protected / must not break
OAuth login through `mcpgw.ai-demo...`, client pinning, X-Served-By, the admin park/unpark route, the demo's lab hosts.

## Apply notes
- The live ConfigMap has `disabled` on the spare from a hand edit that Helm never recorded; a plain upgrade of the old values would silently un-park it. The overlay sets `parked: true` on `mcpgw-cm-spare1`, so applying it keeps it parked.
- With the overlay the LB pod template changes (checksum of the loadBalancer values), so the two LB pods roll; with the new chart and the old values only the ConfigMap changes and the pods do not roll.
- Revision 99 of `agentless-mcpgw` is `failed`; the last `deployed` is 98 (rollback target).

## Apply plan (after the owner's go, not part of this PR)
`helm upgrade agentless-mcpgw ... --reuse-values -f gateway1-lb.values.yaml --dry-run=server`, diff against `helm get manifest`, upgrade, check both LB pods are Ready, then `health up` per node if HAProxy still holds one out (`rise 60`), then a login through the shared host and the keyed door checks.

## Verification plan
Unit/hygiene test, `haproxy -c`, the runtime strip test, the live-values diff; independent review of the diff; CI on the PR. Nothing is applied to the cluster without the owner's go in the conversation.
