# Authorize publish-time probe (kill-switch demo)

One-page spec and runbook. Added 2026-11-22.

## What and for whom
The kill-switch demo claims "a policy change is a kill switch". That is only meaningful if we know how fast a published Authorize change applies.
This adds ONE inert rule to the live tree so the demo owner can time a publish. Measured 2026-11-22 (one run, a person did the console steps): the
decision flipped from PERMIT to DENY within about 10 s of clicking Publish, on every decision endpoint at once.

## The rule that matters: never import a standalone package
A P1AZ publish **replaces the entire authorization version**. A package that is not "export of the live tree + additions" makes its lone root
set the whole tree: every live rule stops being evaluated (this happened once: a $50 call with no audience and no actor went from DENY to PERMIT).
So the probe is **merged into an export**, like `merge-airline-booking-rules.js`. `merge-ks-timing-probe.js` refuses a package with no target policy or more than one PolicySet (for example a KS-only standalone file), a malformed export, a partly-present probe, and an output path equal to its input. It cannot tell a fresh console export from an older copy such as the repo snapshot, so always start from an export taken just before you import.

## What it adds (inert for real traffic)
| Object | Detail |
|---|---|
| attribute `KsProbe` | STRING, default `none`, read from the decision request. Real traffic never sends it. |
| condition `KsProbeIsDenyMe` | `KsProbe == "deny-me"` |
| statement `ks_deny` | DENY |
| rule `KS Timing Probe Deny` | attached to policy `AI Demo Transaction Authorization`, ahead of its catch-all |
Only a request carrying `KsProbe=deny-me` is denied. The policy gets a new (deterministic) version so PingOne attaches the new child.

## Steps
1. Console: Authorize, Trust Framework, **Export** the live policy. Keep that file: it is the undo.
2. `node snapshots/merge-ks-timing-probe.js export.json ks-timing.merged.snapshot.json`
   (refuses and writes nothing if the export lacks the target policy or is malformed; prints "nothing to do" if the probe is already there).
3. Console: Trust Framework, **Import** the merged file. The preview should list only `KsProbe`, `KsProbeIsDenyMe`, `KS Timing Probe Denied`,
   `KS Timing Probe Deny` and `AI Demo Transaction Authorization` as modified. Anything else, or anything removed: cancel.
4. **Publish** (give the version a label). Time it with a read-only probe, e.g. a decision request with `KsProbe=deny-me` polled every few seconds.
5. Undo: import the export from step 1 and publish again.

## Acceptance criteria
- The merged package differs from the export by exactly four added objects and one modified policy (`snapshots/merge-ks-timing-probe.test.js`).
- Still exactly one PolicySet; ids unique; every reference resolves.
- A normal request fires exactly the same deny rules before and after; `KsProbe=deny-me` fires only `KS Timing Probe Deny` (offline evaluator, non-MCP context; the evaluator ignores policy applicability, so only a live decision proves it).
- Applicability: the rule sits in "AI Demo Transaction Authorization", which applies only to non-MCP requests. MCP-context requests go to "AI Demo MCP Delegation Authorization" and never reach the probe. Send the probe as `{"parameters":{"KsProbe":"deny-me"}}` with no MCP `DecisionContext`, as the watcher does.
- Idempotent: merging a package that already has the probe changes nothing.

## Unhappy paths
- Standalone or KS-only package, no target policy, or more than one PolicySet: refused, nothing written.
- The export was edited in the console since: that is fine, the merge adds to whatever the export contains; re-export before merging.
- **Re-importing the repo's own snapshot** (`AI_Demo_Transaction_Authorization_P1AZ.snapshot.json`, e.g. from `setup:fresh` follow-up steps) replaces the tree
  and therefore **removes the probe** (and any console-made changes). Re-run the steps above if you want it back.
- Decision endpoints cannot be deleted with the worker credential (403); a throwaway endpoint made for timing must be deleted in the console.

## Out of scope
Putting the probe into the generated repo snapshot (`gen-authorize-snapshot.js`): the probe is a demo-only instrument, not product policy.
